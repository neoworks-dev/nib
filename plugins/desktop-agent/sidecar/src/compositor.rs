//! Compositor IPC: the focused window, the cursor, and the geometry of both.
//!
//! Wayland has no protocol for any of this — a client cannot ask where the pointer is or
//! what has focus — so the answer comes from whichever compositor socket is open. Two are
//! spoken here; a compositor with neither reports the capability as unavailable rather
//! than being worked around.
//!
//! Nothing is assumed from the compositor's *name*. Each capability is probed by making
//! the query and seeing whether it answers.

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::Duration;

use serde_json::Value;

const TIMEOUT: Duration = Duration::from_millis(400);

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Ipc {
    Hyprland,
    Sway,
}

pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

pub struct Window {
    pub app_id: Option<String>,
    pub title: Option<String>,
    pub pid: Option<i64>,
    pub rect: Option<Rect>,
}

fn env_var(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

/// The socket to talk to, or none. Existence is not enough on its own — a stale socket
/// outlives its compositor — but a failed query downgrades the capability anyway.
pub fn detect() -> Option<(Ipc, PathBuf)> {
    if let Some(signature) = env_var("HYPRLAND_INSTANCE_SIGNATURE") {
        let runtime = env_var("XDG_RUNTIME_DIR").unwrap_or_else(|| "/run/user/1000".into());
        for candidate in [
            PathBuf::from(&runtime).join("hypr").join(&signature).join(".socket.sock"),
            PathBuf::from("/tmp/hypr").join(&signature).join(".socket.sock"),
        ] {
            if candidate.exists() {
                return Some((Ipc::Hyprland, candidate));
            }
        }
    }
    if let Some(sock) = env_var("SWAYSOCK") {
        let path = PathBuf::from(sock);
        if path.exists() {
            return Some((Ipc::Sway, path));
        }
    }
    None
}

/// Hyprland's protocol is a bare request line and a reply read to EOF; `j/` asks for JSON.
fn hyprland_query(path: &PathBuf, command: &str) -> Result<Value, String> {
    let mut stream = UnixStream::connect(path).map_err(|error| error.to_string())?;
    stream.set_read_timeout(Some(TIMEOUT)).ok();
    stream.set_write_timeout(Some(TIMEOUT)).ok();
    stream
        .write_all(format!("j/{command}").as_bytes())
        .map_err(|error| error.to_string())?;

    let mut body = String::new();
    stream.read_to_string(&mut body).map_err(|error| error.to_string())?;
    serde_json::from_str(&body).map_err(|error| error.to_string())
}

/// sway speaks i3's framed binary protocol: a magic string, a little-endian length and a
/// message type, then a JSON payload.
fn sway_query(path: &PathBuf, message_type: u32) -> Result<Value, String> {
    let mut stream = UnixStream::connect(path).map_err(|error| error.to_string())?;
    stream.set_read_timeout(Some(TIMEOUT)).ok();
    stream.set_write_timeout(Some(TIMEOUT)).ok();

    let mut request = Vec::from(*b"i3-ipc");
    request.extend_from_slice(&0u32.to_ne_bytes());
    request.extend_from_slice(&message_type.to_ne_bytes());
    stream.write_all(&request).map_err(|error| error.to_string())?;

    let mut header = [0u8; 14];
    stream.read_exact(&mut header).map_err(|error| error.to_string())?;
    if &header[0..6] != b"i3-ipc" {
        return Err("the reply did not carry the i3-ipc magic".into());
    }
    let length = u32::from_ne_bytes([header[6], header[7], header[8], header[9]]) as usize;
    let mut body = vec![0u8; length];
    stream.read_exact(&mut body).map_err(|error| error.to_string())?;
    serde_json::from_slice(&body).map_err(|error| error.to_string())
}

const SWAY_GET_TREE: u32 = 4;
const SWAY_GET_OUTPUTS: u32 = 3;

fn number(value: Option<&Value>) -> Option<i32> {
    value?.as_f64().map(|number| number.round() as i32)
}

fn text(value: Option<&Value>) -> Option<String> {
    value?.as_str().filter(|entry| !entry.is_empty()).map(str::to_string)
}

fn rect_from(value: Option<&Value>) -> Option<Rect> {
    let raw = value?;
    Some(Rect {
        x: number(raw.get("x"))?,
        y: number(raw.get("y"))?,
        width: number(raw.get("width"))?,
        height: number(raw.get("height"))?,
    })
}

/// Depth-first walk for the node sway marks focused. `focused` is set on exactly one
/// node in the whole tree, so the first hit is the answer.
fn sway_focused(node: &Value) -> Option<&Value> {
    if node.get("focused").and_then(Value::as_bool) == Some(true) {
        return Some(node);
    }
    for key in ["nodes", "floating_nodes"] {
        for child in node.get(key).and_then(Value::as_array).into_iter().flatten() {
            if let Some(found) = sway_focused(child) {
                return Some(found);
            }
        }
    }
    None
}

pub fn focused_window(ipc: Ipc, path: &PathBuf) -> Result<Window, String> {
    match ipc {
        Ipc::Hyprland => {
            let active = hyprland_query(path, "activewindow")?;
            // An empty object is Hyprland's answer for "nothing is focused".
            if active.as_object().is_none_or(serde_json::Map::is_empty) {
                return Err("no window has focus".into());
            }
            let at = active.get("at").and_then(Value::as_array);
            let size = active.get("size").and_then(Value::as_array);
            let rect = match (at, size) {
                (Some(at), Some(size)) => (|| {
                    Some(Rect {
                        x: number(at.first())?,
                        y: number(at.get(1))?,
                        width: number(size.first())?,
                        height: number(size.get(1))?,
                    })
                })(),
                _ => None,
            };
            Ok(Window {
                app_id: text(active.get("class")),
                title: text(active.get("title")),
                pid: active.get("pid").and_then(Value::as_i64).filter(|pid| *pid > 0),
                rect,
            })
        }
        Ipc::Sway => {
            let tree = sway_query(path, SWAY_GET_TREE)?;
            let focused = sway_focused(&tree).ok_or("no window has focus")?;
            Ok(Window {
                // Wayland views carry `app_id`; an XWayland one carries `window_properties.class`.
                app_id: text(focused.get("app_id")).or_else(|| {
                    text(focused.get("window_properties").and_then(|properties| properties.get("class")))
                }),
                title: text(focused.get("name")),
                pid: focused.get("pid").and_then(Value::as_i64).filter(|pid| *pid > 0),
                rect: rect_from(focused.get("rect")),
            })
        }
    }
}

pub fn cursor_position(ipc: Ipc, path: &PathBuf) -> Result<(i32, i32), String> {
    match ipc {
        Ipc::Hyprland => {
            let position = hyprland_query(path, "cursorpos")?;
            Ok((
                number(position.get("x")).ok_or("no x in the cursor position")?,
                number(position.get("y")).ok_or("no y in the cursor position")?,
            ))
        }
        // sway's IPC exposes no cursor position at all. Reported rather than guessed.
        Ipc::Sway => Err("sway does not report the cursor position".into()),
    }
}

pub struct Output {
    pub name: String,
    /// Layout coordinates, which is the space capture rects and overlay rects are in.
    pub rect: Rect,
}

/// Where each output sits in the layout, so a capture in image pixels can be mapped back
/// onto the desktop for the overlay to draw on.
pub fn outputs(ipc: Ipc, path: &PathBuf) -> Result<Vec<Output>, String> {
    let raw = match ipc {
        Ipc::Hyprland => hyprland_query(path, "monitors")?,
        Ipc::Sway => sway_query(path, SWAY_GET_OUTPUTS)?,
    };
    let list = raw.as_array().ok_or("the compositor did not answer with a list")?;

    let mut outputs = Vec::new();
    for entry in list {
        let Some(name) = text(entry.get("name")) else { continue };
        let scale = entry.get("scale").and_then(Value::as_f64).unwrap_or(1.0).max(0.1);
        let rect = match ipc {
            // Hyprland reports the mode's pixel size; everything else here is in layout
            // units, so a scaled output has to be divided down to match.
            Ipc::Hyprland => Rect {
                x: number(entry.get("x")).unwrap_or(0),
                y: number(entry.get("y")).unwrap_or(0),
                width: (number(entry.get("width")).unwrap_or(0) as f64 / scale).round() as i32,
                height: (number(entry.get("height")).unwrap_or(0) as f64 / scale).round() as i32,
            },
            Ipc::Sway => match rect_from(entry.get("rect")) {
                Some(rect) => rect,
                None => continue,
            },
        };
        outputs.push(Output { name, rect });
    }
    Ok(outputs)
}
