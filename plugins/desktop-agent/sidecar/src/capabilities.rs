//! What this machine can do, answered by asking rather than by assuming.
//!
//! Every probe fails soft: an unreachable bus, a compositor with no IPC socket or a
//! missing tool downgrades one capability and adds a note, and never aborts the report.
//! No compositor name decides anything — `compositor` is carried for the user to read.

use std::env;
use std::path::PathBuf;

use crate::compositor;

pub struct Capabilities {
    pub capture: &'static str,
    pub focus: &'static str,
    pub pointer: &'static str,
    pub compositor: Option<String>,
    pub session_type: &'static str,
    pub layer_shell: bool,
    pub notes: Vec<String>,
}

pub fn probe() -> Capabilities {
    let mut notes = Vec::new();
    let session_type = session_type();

    let layer_shell = if session_type == "wayland" {
        match probe_layer_shell() {
            Ok(present) => present,
            Err(reason) => {
                notes.push(format!("The Wayland registry could not be read: {reason}"));
                false
            }
        }
    } else {
        false
    };

    let ipc = compositor::detect();
    let portal = probe_portal_screenshot(&mut notes);
    let grim = which("grim").is_some();

    let capture = if portal {
        "portal"
    } else if grim {
        notes.push("The desktop portal has no Screenshot interface; falling back to grim.".into());
        "compositor-tools"
    } else {
        "unavailable"
    };
    if portal && !grim {
        notes.push("grim is not installed, so a region or a window capture falls back to the whole screen.".into());
    }

    // Probed by making the query, not inferred from the socket existing: a stale socket
    // outlives its compositor, and sway has an IPC socket with no cursor on it at all.
    let focus_works = ipc
        .as_ref()
        .is_some_and(|(kind, path)| compositor::focused_window(*kind, path).is_ok());
    let pointer_works = ipc
        .as_ref()
        .is_some_and(|(kind, path)| compositor::cursor_position(*kind, path).is_ok());

    let focus = if focus_works {
        "compositor-ipc"
    } else if probe_accessibility_bus() {
        "atspi"
    } else {
        "unavailable"
    };

    if !probe_accessibility_bus() {
        notes.push("No accessibility bus is running, so no element is named and nothing is redacted.".into());
    }

    Capabilities {
        capture,
        focus,
        pointer: if pointer_works { "compositor-ipc" } else { "unavailable" },
        compositor: compositor(),
        session_type,
        layer_shell,
        notes,
    }
}

fn env_var(name: &str) -> Option<String> {
    env::var(name).ok().filter(|value| !value.is_empty())
}

fn session_type() -> &'static str {
    match env_var("XDG_SESSION_TYPE").as_deref() {
        Some("wayland") => return "wayland",
        Some("x11") => return "x11",
        _ => {}
    }
    if env_var("WAYLAND_DISPLAY").is_some() {
        return "wayland";
    }
    if env_var("DISPLAY").is_some() {
        return "x11";
    }
    "unknown"
}

/// `XDG_CURRENT_DESKTOP` is a colon-separated list; the first entry is the session's own
/// name. The IPC variables are the fallback for a compositor that sets neither.
fn compositor() -> Option<String> {
    if let Some(desktop) = env_var("XDG_CURRENT_DESKTOP") {
        if let Some(first) = desktop.split(':').next().filter(|entry| !entry.is_empty()) {
            return Some(first.to_string());
        }
    }
    if env_var("HYPRLAND_INSTANCE_SIGNATURE").is_some() {
        return Some("Hyprland".into());
    }
    if env_var("SWAYSOCK").is_some() {
        return Some("sway".into());
    }
    None
}

fn which(name: &str) -> Option<PathBuf> {
    let path = env_var("PATH")?;
    env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

/// Introspects the portal rather than trusting that a running portal implements
/// `Screenshot`: the interface belongs to a backend, and a session can have a portal
/// process without one.
fn probe_portal_screenshot(notes: &mut Vec<String>) -> bool {
    let connection = match zbus::blocking::Connection::session() {
        Ok(connection) => connection,
        Err(error) => {
            notes.push(format!("No session bus, so no portal and no accessibility tree: {error}"));
            return false;
        }
    };

    let proxy = zbus::blocking::fdo::IntrospectableProxy::builder(&connection)
        .destination("org.freedesktop.portal.Desktop")
        .and_then(|builder| builder.path("/org/freedesktop/portal/desktop"))
        .and_then(|builder| builder.build());

    let proxy = match proxy {
        Ok(proxy) => proxy,
        Err(error) => {
            notes.push(format!("The desktop portal could not be addressed: {error}"));
            return false;
        }
    };

    match proxy.introspect() {
        Ok(xml) => xml.contains("org.freedesktop.portal.Screenshot"),
        Err(error) => {
            notes.push(format!("The desktop portal did not answer: {error}"));
            false
        }
    }
}

fn probe_accessibility_bus() -> bool {
    let Ok(connection) = zbus::blocking::Connection::session() else {
        return false;
    };
    let Ok(proxy) = zbus::blocking::fdo::DBusProxy::new(&connection) else {
        return false;
    };
    let Ok(names) = proxy.list_activatable_names() else {
        return false;
    };
    names.iter().any(|name| name.as_str() == "org.a11y.Bus")
}

/// A roundtrip over a throwaway connection: the globals arrive in the first batch, so
/// nothing here waits on a compositor that is slow to answer a request we never make.
fn probe_layer_shell() -> Result<bool, String> {
    use wayland_client::protocol::wl_registry::{self, WlRegistry};
    use wayland_client::{Connection, Dispatch, QueueHandle};

    #[derive(Default)]
    struct Globals {
        layer_shell: bool,
    }

    impl Dispatch<WlRegistry, ()> for Globals {
        fn event(
            state: &mut Self,
            _registry: &WlRegistry,
            event: wl_registry::Event,
            _data: &(),
            _connection: &Connection,
            _handle: &QueueHandle<Self>,
        ) {
            if let wl_registry::Event::Global { interface, .. } = event {
                if interface == "zwlr_layer_shell_v1" {
                    state.layer_shell = true;
                }
            }
        }
    }

    let connection = Connection::connect_to_env().map_err(|error| error.to_string())?;
    let mut queue = connection.new_event_queue::<Globals>();
    let _registry = connection.display().get_registry(&queue.handle(), ());

    let mut globals = Globals::default();
    queue.roundtrip(&mut globals).map_err(|error| error.to_string())?;
    Ok(globals.layer_shell)
}
