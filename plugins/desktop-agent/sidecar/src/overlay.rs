//! The Wayland overlay: one `zwlr_layer_shell_v1` surface per highlight, plus one for the
//! pointer ring.
//!
//! Chromium speaks `xdg-shell` only, so no Electron window can be placed above another
//! application at an absolute position on Wayland. That is the entire reason this process
//! exists. A future patch that "simplifies" this into a transparent `BrowserWindow` is
//! wrong on native Wayland, and this comment is the rejection.
//!
//! Every surface gets an **empty input region**, so clicks land on the application beneath.
//! A surface that could receive a click is one the user could not click through, which is
//! also why this overlay cannot be a step towards input injection.
//!
//! Surfaces are per region rather than one fullscreen layer: a 200x60 highlight is a 48 KB
//! buffer where a 4K fullscreen surface is a 33 MB one for the same handful of rectangles.
//!
//! **No text is drawn.** A label would need a font rasteriser and a font stack; the label a
//! region carries is rendered in the pane and in the prompt instead. `OverlayRegion.label`
//! travels over the protocol and is ignored here.

use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

use smithay_client_toolkit::compositor::{CompositorHandler, CompositorState};
use smithay_client_toolkit::output::{OutputHandler, OutputState};
use smithay_client_toolkit::registry::{ProvidesRegistryState, RegistryState};
use smithay_client_toolkit::shell::wlr_layer::{
    Anchor, KeyboardInteractivity, Layer, LayerShell, LayerSurface, LayerShellHandler, LayerSurfaceConfigure,
};
use smithay_client_toolkit::shell::WaylandSurface;
use smithay_client_toolkit::shm::slot::SlotPool;
use smithay_client_toolkit::shm::{Shm, ShmHandler};
use smithay_client_toolkit::{
    delegate_compositor, delegate_layer, delegate_output, delegate_registry, delegate_shm, registry_handlers,
};
use wayland_client::globals::registry_queue_init;
use wayland_client::protocol::{wl_output, wl_region, wl_shm, wl_surface};
use wayland_client::{Connection, Dispatch, EventQueue, QueueHandle};

use crate::compositor::Rect;

/// Room for the stroke to sit outside the region it marks, so a highlight never covers the
/// thing it points at.
const PADDING: i32 = 4;
const STROKE: f32 = 2.0;
const RING_RADIUS: i32 = 22;

#[derive(Clone, Copy)]
pub enum Tone {
    Accent,
    Warn,
    Muted,
}

impl Tone {
    pub fn parse(raw: &str) -> Self {
        match raw {
            "warn" => Tone::Warn,
            "muted" => Tone::Muted,
            _ => Tone::Accent,
        }
    }

    fn rgb(self) -> (u8, u8, u8) {
        match self {
            Tone::Accent => (96, 165, 250),
            Tone::Warn => (251, 191, 36),
            Tone::Muted => (148, 163, 184),
        }
    }
}

pub struct Highlight {
    /// Desktop layout coordinates. Which output that lands on is worked out here.
    pub rect: Rect,
    pub tone: Tone,
}

pub enum Command {
    /// Replaces whatever is shown; an empty list with no ring clears the overlay.
    Show { regions: Vec<Highlight>, ring: Option<Tone> },
    /// Moves the pointer ring. Ignored when no ring is shown.
    Pointer { x: i32, y: i32 },
    Quit,
}

/// Runs until `Quit` or the channel closes. Blocking: a Wayland client owns its event
/// queue, so the caller gives this a thread of its own.
///
/// `ready` carries the outcome of everything that can fail at startup — no compositor, no
/// layer-shell, no shm — back to the caller before the first command is applied. Without it
/// the caller would answer "the overlay is up" for a thread that had already died, because
/// sending into a channel whose receiver has not been dropped yet still succeeds.
pub fn run(commands: Receiver<Command>, ready: Sender<Result<(), String>>) -> Result<(), String> {
    let (mut state, mut queue) = match start() {
        Ok(started) => {
            let _ = ready.send(Ok(()));
            started
        }
        Err(reason) => {
            let _ = ready.send(Err(reason.clone()));
            return Err(reason);
        }
    };
    let handle = queue.handle();

    loop {
        match commands.recv_timeout(Duration::from_millis(50)) {
            Ok(Command::Quit) | Err(RecvTimeoutError::Disconnected) => break,
            Ok(command) => state.apply(command, &handle),
            Err(RecvTimeoutError::Timeout) => {}
        }
        // A roundtrip both flushes our requests and drains the socket, so `configure`
        // arrives promptly without a second event source to poll for.
        if queue.roundtrip(&mut state).is_err() || state.exit {
            break;
        }
    }

    state.panels.clear();
    state.ring = None;
    let _ = queue.roundtrip(&mut state);
    Ok(())
}

/// Everything that can fail before a single command is looked at: no compositor, a
/// compositor with no `wlr-layer-shell`, no shm. Each is a capability answer, not a crash.
fn start() -> Result<(Overlay, EventQueue<Overlay>), String> {
    let connection = Connection::connect_to_env().map_err(|error| error.to_string())?;
    let (globals, mut queue) = registry_queue_init(&connection).map_err(|error| error.to_string())?;
    let handle = queue.handle();

    let shm = Shm::bind(&globals, &handle).map_err(|error| error.to_string())?;
    let pool = SlotPool::new(512 * 512 * 4, &shm).map_err(|error| error.to_string())?;

    let mut state = Overlay {
        registry: RegistryState::new(&globals),
        output: OutputState::new(&globals, &handle),
        compositor: CompositorState::bind(&globals, &handle).map_err(|error| error.to_string())?,
        layers: LayerShell::bind(&globals, &handle).map_err(|error| error.to_string())?,
        pool,
        shm,
        panels: Vec::new(),
        ring: None,
        exit: false,
    };

    // Outputs arrive as registry events, and a highlight cannot be placed before its
    // output's logical position is known.
    queue.roundtrip(&mut state).map_err(|error| error.to_string())?;
    Ok((state, queue))
}

struct Panel {
    layer: LayerSurface,
    width: i32,
    height: i32,
    tone: Tone,
    /// A ring is drawn as a circle, a highlight as a rectangle outline.
    ring: bool,
}

struct Overlay {
    registry: RegistryState,
    output: OutputState,
    compositor: CompositorState,
    layers: LayerShell,
    pool: SlotPool,
    shm: Shm,
    panels: Vec<Panel>,
    ring: Option<Panel>,
    exit: bool,
}

/// An output and where it sits in the layout, so a rect in layout coordinates can be turned
/// into the output-relative margins a layer surface is placed by.
struct Placement {
    output: wl_output::WlOutput,
    x: i32,
    y: i32,
}

impl Overlay {
    /// The output a layout point falls on, or the first one — a point outside every output
    /// is better drawn somewhere than dropped silently.
    fn placement(&self, x: i32, y: i32) -> Option<Placement> {
        let mut first: Option<Placement> = None;
        for output in self.output.outputs() {
            let Some(info) = self.output.info(&output) else { continue };
            let (left, top) = info.logical_position.unwrap_or((0, 0));
            let (width, height) = info.logical_size.unwrap_or((0, 0));
            if first.is_none() {
                first = Some(Placement { output: output.clone(), x: left, y: top });
            }
            if x >= left && y >= top && x < left + width && y < top + height {
                return Some(Placement { output, x: left, y: top });
            }
        }
        first
    }

    fn apply(&mut self, command: Command, handle: &QueueHandle<Self>) {
        match command {
            Command::Show { regions, ring } => {
                self.panels.clear();
                self.ring = None;
                for region in regions {
                    if let Some(panel) = self.panel(
                        handle,
                        region.rect.x - PADDING,
                        region.rect.y - PADDING,
                        region.rect.width + PADDING * 2,
                        region.rect.height + PADDING * 2,
                        region.tone,
                        false,
                    ) {
                        self.panels.push(panel);
                    }
                }
                if let Some(tone) = ring {
                    self.ring = self.panel(handle, 0, 0, RING_RADIUS * 2, RING_RADIUS * 2, tone, true);
                }
            }
            Command::Pointer { x, y } => {
                // The ring is anchored to one output; a cursor that crosses to another
                // would need the surface rebuilt there, which is step 5's known limit.
                if let Some(ring) = &self.ring {
                    ring.layer.set_margin(y - RING_RADIUS, 0, 0, x - RING_RADIUS);
                    ring.layer.commit();
                }
            }
            Command::Quit => self.exit = true,
        }
    }

    fn panel(
        &mut self,
        handle: &QueueHandle<Self>,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        tone: Tone,
        ring: bool,
    ) -> Option<Panel> {
        let placement = self.placement(x, y)?;
        let surface = self.compositor.create_surface(handle);

        // The whole point of the overlay: a region with no rectangles in it receives no
        // pointer events, so every click reaches the application underneath.
        let empty = self.compositor.wl_compositor().create_region(handle, ());
        surface.set_input_region(Some(&empty));
        empty.destroy();

        let layer = self.layers.create_layer_surface(
            handle,
            surface,
            Layer::Overlay,
            Some("nib-overlay"),
            Some(&placement.output),
        );
        layer.set_anchor(Anchor::TOP | Anchor::LEFT);
        layer.set_margin(y - placement.y, 0, 0, x - placement.x);
        layer.set_size(width.max(1) as u32, height.max(1) as u32);
        layer.set_keyboard_interactivity(KeyboardInteractivity::None);
        // -1 keeps the overlay out of every other client's exclusive-zone arithmetic, so a
        // bar does not move because a highlight appeared.
        layer.set_exclusive_zone(-1);
        layer.commit();

        Some(Panel { layer, width: width.max(1), height: height.max(1), tone, ring })
    }

    /// Paints one panel into a fresh shm buffer. Called on `configure`, the first point at
    /// which the compositor and the surface agree on a size.
    fn draw(&mut self, index: usize, ring: bool) {
        let Some((width, height, tone, is_ring)) = (if ring {
            self.ring.as_ref().map(|panel| (panel.width, panel.height, panel.tone, panel.ring))
        } else {
            self.panels.get(index).map(|panel| (panel.width, panel.height, panel.tone, panel.ring))
        }) else {
            return;
        };

        let Ok((buffer, canvas)) = self.pool.create_buffer(width, height, width * 4, wl_shm::Format::Argb8888) else {
            return;
        };
        let Some(mut pixmap) = tiny_skia::Pixmap::new(width as u32, height as u32) else { return };

        let (red, green, blue) = tone.rgb();
        let mut outline = tiny_skia::Paint::default();
        outline.anti_alias = true;
        outline.set_color_rgba8(red, green, blue, 255);
        let mut wash = tiny_skia::Paint::default();
        wash.anti_alias = true;
        // Enough to read the highlight over a busy window, not enough to hide it.
        wash.set_color_rgba8(red, green, blue, 38);
        let stroke = tiny_skia::Stroke { width: STROKE, ..tiny_skia::Stroke::default() };

        let path = if is_ring {
            tiny_skia::PathBuilder::from_circle(width as f32 / 2.0, height as f32 / 2.0, (width as f32 / 2.0) - STROKE)
        } else {
            let inset = STROKE / 2.0;
            tiny_skia::Rect::from_ltrb(inset, inset, width as f32 - inset, height as f32 - inset)
                .map(tiny_skia::PathBuilder::from_rect)
        };

        if let Some(path) = path {
            pixmap.fill_path(&path, &wash, tiny_skia::FillRule::Winding, tiny_skia::Transform::identity(), None);
            pixmap.stroke_path(&path, &outline, &stroke, tiny_skia::Transform::identity(), None);
        }

        // tiny-skia hands back premultiplied RGBA; `Argb8888` is BGRA in memory on a
        // little-endian machine, so red and blue swap on the way out.
        for (target, source) in canvas.chunks_exact_mut(4).zip(pixmap.data().chunks_exact(4)) {
            target[0] = source[2];
            target[1] = source[1];
            target[2] = source[0];
            target[3] = source[3];
        }

        let panel = if ring {
            match self.ring.as_ref() {
                Some(panel) => panel,
                None => return,
            }
        } else {
            match self.panels.get(index) {
                Some(panel) => panel,
                None => return,
            }
        };
        let surface = panel.layer.wl_surface();
        surface.damage_buffer(0, 0, width, height);
        if buffer.attach_to(surface).is_ok() {
            surface.commit();
        }
    }
}

impl CompositorHandler for Overlay {
    fn scale_factor_changed(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &wl_surface::WlSurface, _: i32) {}
    fn transform_changed(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_surface::WlSurface,
        _: wl_output::Transform,
    ) {
    }
    fn frame(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &wl_surface::WlSurface, _: u32) {}
    fn surface_enter(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_surface::WlSurface,
        _: &wl_output::WlOutput,
    ) {
    }
    fn surface_leave(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        _: &wl_surface::WlSurface,
        _: &wl_output::WlOutput,
    ) {
    }
}

impl LayerShellHandler for Overlay {
    fn closed(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &LayerSurface) {
        self.exit = true;
    }

    fn configure(
        &mut self,
        _: &Connection,
        _: &QueueHandle<Self>,
        layer: &LayerSurface,
        _: LayerSurfaceConfigure,
        _: u32,
    ) {
        if self.ring.as_ref().is_some_and(|panel| panel.layer.wl_surface() == layer.wl_surface()) {
            self.draw(0, true);
            return;
        }
        if let Some(index) = self
            .panels
            .iter()
            .position(|panel| panel.layer.wl_surface() == layer.wl_surface())
        {
            self.draw(index, false);
        }
    }
}

impl OutputHandler for Overlay {
    fn output_state(&mut self) -> &mut OutputState {
        &mut self.output
    }
    fn new_output(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
    fn update_output(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
    fn output_destroyed(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_output::WlOutput) {}
}

impl ShmHandler for Overlay {
    fn shm_state(&mut self) -> &mut Shm {
        &mut self.shm
    }
}

/// `wl_region` carries no events; the binding still wants somewhere to send them.
impl Dispatch<wl_region::WlRegion, ()> for Overlay {
    fn event(
        _: &mut Self,
        _: &wl_region::WlRegion,
        _: wl_region::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl ProvidesRegistryState for Overlay {
    fn registry(&mut self) -> &mut RegistryState {
        &mut self.registry
    }
    registry_handlers![OutputState];
}

delegate_compositor!(Overlay);
delegate_output!(Overlay);
delegate_shm!(Overlay);
delegate_layer!(Overlay);
delegate_registry!(Overlay);
