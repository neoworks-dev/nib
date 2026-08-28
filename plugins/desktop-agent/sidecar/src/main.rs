//! `nib-overlay` — the native half of the nib-ui desktop agent.
//!
//! Line-delimited JSON on stdin and stdout, one message per newline; stderr is log text the
//! host forwards and never parses. The host owns this process: when stdin closes the loop
//! ends and the process exits, which is the lifetime a unix socket would have made
//! ambiguous.
//!
//! Anything that can block on a user — a portal dialog — or that runs until told to stop —
//! the overlay, pointer polling — gets a thread of its own and writes its reply when it has
//! one. Replies are correlated by id, so answering out of order is not a special case.
//!
//! This process is **advisory**: it draws, it reads and it captures. There is no synthetic
//! input anywhere in it, and the overlay's empty input region means it could not deliver one
//! even by accident.

mod atspi;
mod capabilities;
mod capture;
mod compositor;
mod overlay;
mod portal;

use std::io::{self, BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::{json, Value};

const PROTOCOL_VERSION: u64 = 1;
/// Unsolicited events carry this instead of a request id.
const EVENT_ID: u64 = 0;
/// Ceiling on the accessibility walk, so a pathological tree cannot hang a request.
const MAX_ACCESSIBLE_NODES: usize = 1500;

fn main() {
    let mut sidecar = Sidecar::default();
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        if !sidecar.handle(&line) {
            break;
        }
    }
    sidecar.shutdown();
}

#[derive(Default)]
struct Sidecar {
    overlay: Option<Sender<overlay::Command>>,
    overlay_thread: Option<JoinHandle<()>>,
    pointer: Option<Arc<AtomicBool>>,
    focus: Option<Arc<AtomicBool>>,
}

impl Sidecar {
    /// Returns false when the message loop should end.
    fn handle(&mut self, line: &str) -> bool {
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            log("warn", "ignored a line that is not JSON");
            return true;
        };

        let id = message.get("id").and_then(Value::as_u64).unwrap_or(0);
        if message.get("v").and_then(Value::as_u64) != Some(PROTOCOL_VERSION) {
            // Answered rather than dropped: a version mismatch the host can render beats a
            // request that never comes back.
            error(id, "unsupported", "this sidecar speaks protocol version 1", false);
            return true;
        }

        match message.get("type").and_then(Value::as_str) {
            Some("hello") => report_capabilities(id),
            Some("capture") => self.capture(id, &message),
            Some("focus.query") => focus_query(id),
            Some("focus.subscribe") => self.focus_subscribe(id),
            Some("accessibility.tree") => accessibility_tree(id, &message),
            Some("overlay.show") | Some("overlay.update") => self.overlay_show(id, &message),
            Some("overlay.hide") => self.overlay_hide(id),
            Some("pointer.subscribe") => self.pointer_subscribe(id, &message),
            Some("pointer.unsubscribe") => self.pointer_unsubscribe(id),
            Some("shortcuts.bind") => error(
                id,
                "unsupported",
                "global shortcuts are not bound by this build; use a compositor keybind that focuses the app",
                false,
            ),
            Some("shutdown") => return false,
            Some(other) => error(id, "unsupported", &format!("`{other}` is not a request this sidecar knows"), false),
            None => log("warn", "ignored a message with no type"),
        }
        true
    }

    /// Blocks on a portal dialog the user may take a minute to answer, so it runs off the
    /// message loop; the reply carries the request id and arrives whenever it arrives.
    fn capture(&mut self, id: u64, message: &Value) {
        let request = message.get("request").cloned().unwrap_or_else(|| json!({ "mode": "screen" }));
        thread::spawn(move || {
            let context = capture::CaptureContext {
                ipc: compositor::detect(),
                // Read before the shutter, not after: what is on screen when the picture is
                // taken is what has to be blacked out of it.
                sensitive: atspi::sensitive_rects(MAX_ACCESSIBLE_NODES),
            };
            match capture::capture(&request, &context) {
                Ok(taken) => ok(
                    id,
                    json!({
                        "path": taken.path,
                        "width": taken.width,
                        "height": taken.height,
                        "output": taken.output,
                        "layout": taken.layout.map(|rect| json!({
                            "x": rect.x, "y": rect.y, "width": rect.width, "height": rect.height,
                        })),
                        "redacted": taken.redacted,
                        "takenAt": now_millis(),
                        "application": focused_identity(),
                    }),
                ),
                Err((code, detail)) => error(id, code, &detail, code == "internal"),
            }
        });
    }

    fn focus_subscribe(&mut self, id: u64) {
        if self.focus.is_some() {
            ok(id, json!({}));
            return;
        }
        let Some((ipc, path)) = compositor::detect() else {
            error(id, "unsupported", "this compositor exposes no focus information", false);
            return;
        };

        let running = Arc::new(AtomicBool::new(true));
        self.focus = Some(running.clone());
        thread::spawn(move || {
            let mut last = String::new();
            while running.load(Ordering::Relaxed) {
                if let Ok(window) = compositor::focused_window(ipc, &path) {
                    let identity = identity_json(&window);
                    let serialised = identity.to_string();
                    // Only a change is worth a message: the host renders this live.
                    if serialised != last {
                        last = serialised;
                        emit(json!({ "v": PROTOCOL_VERSION, "id": EVENT_ID, "type": "focus", "application": identity }));
                    }
                }
                thread::sleep(Duration::from_millis(500));
            }
        });
        ok(id, json!({}));
    }

    fn pointer_subscribe(&mut self, id: u64, message: &Value) {
        if self.pointer.is_some() {
            ok(id, json!({}));
            return;
        }
        let Some((ipc, path)) = compositor::detect() else {
            error(id, "unsupported", "this compositor exposes no cursor position", false);
            return;
        };
        // Probed rather than assumed: sway has an IPC socket and no cursor on it.
        if compositor::cursor_position(ipc, &path).is_err() {
            error(id, "unsupported", "this compositor's IPC does not report the cursor position", false);
            return;
        }

        let hz = message.get("hz").and_then(Value::as_f64).unwrap_or(30.0).clamp(1.0, 30.0);
        let interval = Duration::from_millis((1000.0 / hz) as u64);
        let running = Arc::new(AtomicBool::new(true));
        self.pointer = Some(running.clone());
        let overlay = self.overlay.clone();

        thread::spawn(move || {
            let mut last = (i32::MIN, i32::MIN);
            while running.load(Ordering::Relaxed) {
                if let Ok((x, y)) = compositor::cursor_position(ipc, &path) {
                    if (x, y) != last {
                        last = (x, y);
                        // The ring follows without a round trip through the host: a cursor
                        // that lags the pointer by a browser frame is worse than none.
                        if let Some(sender) = &overlay {
                            let _ = sender.send(overlay::Command::Pointer { x, y });
                        }
                        emit(json!({
                            "v": PROTOCOL_VERSION,
                            "id": EVENT_ID,
                            "type": "pointer",
                            "sample": { "x": x, "y": y, "output": Value::Null },
                        }));
                    }
                }
                thread::sleep(interval);
            }
        });
        ok(id, json!({}));
    }

    fn pointer_unsubscribe(&mut self, id: u64) {
        if let Some(running) = self.pointer.take() {
            running.store(false, Ordering::Relaxed);
        }
        ok(id, json!({}));
    }

    fn overlay_show(&mut self, id: u64, message: &Value) {
        let spec = message.get("spec");
        let regions: Vec<overlay::Highlight> = spec
            .and_then(|spec| spec.get("regions"))
            .and_then(Value::as_array)
            .map(|entries| entries.iter().filter_map(highlight_from).collect())
            .unwrap_or_default();
        let ring = spec
            .and_then(|spec| spec.get("pointer"))
            .map(|pointer| overlay::Tone::parse(pointer.get("tone").and_then(Value::as_str).unwrap_or("accent")));

        if regions.is_empty() && ring.is_none() {
            self.overlay_hide(id);
            return;
        }

        if self.overlay.is_none() && !self.start_overlay(id) {
            return;
        }

        let Some(sender) = &self.overlay else {
            error(id, "internal", "the overlay thread could not be started", true);
            return;
        };
        match sender.send(overlay::Command::Show { regions, ring }) {
            Ok(()) => ok(id, json!({})),
            Err(_) => {
                self.overlay = None;
                error(id, "internal", "the overlay stopped before the request reached it", true);
            }
        }
    }

    /// Waits for the overlay thread to say whether it got a surface at all.
    ///
    /// Sending into a channel whose receiver has not been dropped yet succeeds even when
    /// the thread behind it is already dying, so without this handshake a compositor with
    /// no layer-shell is reported to the host as a working overlay — which is exactly what
    /// it did before.
    fn start_overlay(&mut self, id: u64) -> bool {
        let (sender, receiver) = mpsc::channel();
        let (ready, started) = mpsc::channel();
        let thread = thread::spawn(move || {
            if let Err(reason) = overlay::run(receiver, ready) {
                log("error", &format!("the overlay could not start: {reason}"));
            }
        });

        match started.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(())) => {
                self.overlay = Some(sender);
                self.overlay_thread = Some(thread);
                true
            }
            Ok(Err(reason)) => {
                let _ = thread.join();
                error(id, "unsupported", &format!("the overlay could not be created: {reason}"), false);
                false
            }
            Err(_) => {
                error(id, "timeout", "the compositor did not answer the overlay's first request", true);
                false
            }
        }
    }

    fn overlay_hide(&mut self, id: u64) {
        self.stop_overlay();
        ok(id, json!({}));
    }

    fn stop_overlay(&mut self) {
        if let Some(sender) = self.overlay.take() {
            let _ = sender.send(overlay::Command::Quit);
        }
        if let Some(thread) = self.overlay_thread.take() {
            let _ = thread.join();
        }
    }

    /// Nothing may outlive this process: a layer surface with no process to ask it to leave
    /// is the worst failure this feature has.
    fn shutdown(&mut self) {
        if let Some(running) = self.pointer.take() {
            running.store(false, Ordering::Relaxed);
        }
        if let Some(running) = self.focus.take() {
            running.store(false, Ordering::Relaxed);
        }
        self.stop_overlay();
    }
}

fn highlight_from(raw: &Value) -> Option<overlay::Highlight> {
    let rect = raw.get("rect")?;
    let read = |key: &str| rect.get(key)?.as_f64().map(|number| number.round() as i32);
    let width = read("width")?;
    let height = read("height")?;
    if width <= 0 || height <= 0 {
        return None;
    }
    Some(overlay::Highlight {
        rect: compositor::Rect { x: read("x")?, y: read("y")?, width, height },
        tone: overlay::Tone::parse(raw.get("tone").and_then(Value::as_str).unwrap_or("accent")),
    })
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn identity_json(window: &compositor::Window) -> Value {
    json!({
        "appId": window.app_id,
        "atspiName": Value::Null,
        "desktopEntry": Value::Null,
        "title": window.title,
        "pid": window.pid,
    })
}

fn focused_identity() -> Value {
    let Some((ipc, path)) = compositor::detect() else { return Value::Null };
    match compositor::focused_window(ipc, &path) {
        Ok(window) => identity_json(&window),
        Err(_) => Value::Null,
    }
}

fn focus_query(id: u64) {
    let Some((ipc, path)) = compositor::detect() else {
        error(id, "unsupported", "this compositor exposes no focus information", false);
        return;
    };
    match compositor::focused_window(ipc, &path) {
        Ok(window) => ok(id, identity_json(&window)),
        Err(detail) => error(id, "not-found", &detail, true),
    }
}

/// Answers in **desktop layout coordinates**, not in the pixels of any capture: the sidecar
/// does not know which capture the host is asking about. The host maps them onto the image
/// using the layout box the capture reported.
fn accessibility_tree(id: u64, message: &Value) {
    let max_nodes = message
        .get("maxNodes")
        .and_then(Value::as_u64)
        .map(|value| (value as usize).min(MAX_ACCESSIBLE_NODES))
        .unwrap_or(500);

    thread::spawn(move || match atspi::regions(max_nodes) {
        Ok(nodes) => {
            let regions: Vec<Value> = nodes
                .iter()
                .enumerate()
                .map(|(index, node)| {
                    json!({
                        "id": format!("atspi-{index}"),
                        "rect": { "x": node.rect.x, "y": node.rect.y, "width": node.rect.width, "height": node.rect.height },
                        "label": node.name,
                        "role": node.role,
                        "source": "atspi",
                        "confidence": 1.0,
                        "sensitive": node.sensitive,
                    })
                })
                .collect();
            ok(id, Value::Array(regions));
        }
        Err(detail) => error(id, "not-found", &detail, false),
    });
}

fn report_capabilities(id: u64) {
    let probed = capabilities::probe();
    emit(json!({
        "v": PROTOCOL_VERSION,
        "id": id,
        "type": "capabilities",
        "capabilities": {
            "capture": probed.capture,
            "focus": probed.focus,
            "pointer": probed.pointer,
            "compositor": probed.compositor,
            "sessionType": probed.session_type,
            "layerShell": probed.layer_shell,
            "notes": probed.notes,
        },
    }));
}

fn ok(id: u64, payload: Value) {
    emit(json!({ "v": PROTOCOL_VERSION, "id": id, "type": "ok", "payload": payload }));
}

fn error(id: u64, code: &str, message: &str, retryable: bool) {
    emit(json!({
        "v": PROTOCOL_VERSION,
        "id": id,
        "type": "err",
        "code": code,
        "message": message,
        "retryable": retryable,
    }));
}

fn log(level: &str, message: &str) {
    let _ = writeln!(io::stderr(), "[{level}] {message}");
}

/// One line, one lock, one flush. Threads write replies concurrently, and a half-written
/// line would desynchronise the host's frame reader for good.
fn emit(message: Value) {
    let mut stdout = io::stdout().lock();
    let _ = writeln!(stdout, "{message}");
    let _ = stdout.flush();
}
