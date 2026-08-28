//! Taking a picture of the desktop, and blacking out what must not leave the machine.
//!
//! Two paths, both writing a PNG to disk and reporting the path: the bytes never travel
//! over the pipe. The portal is the sanctioned one and the only one that works everywhere;
//! `grim` is the fast path for a region or a window, where the portal would either prompt
//! for the whole screen or hand over a picker we do not control.

use std::collections::HashMap;
use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use zbus::zvariant::Value as ZValue;

use crate::compositor::{self, Ipc, Rect};
use crate::portal;

/// How long the user has to answer a portal dialog before the request is given up on.
const PORTAL_TIMEOUT: Duration = Duration::from_secs(120);

pub struct Capture {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub output: Option<String>,
    /// The desktop-layout box this image covers, where it is known. Without it a region
    /// found in the picture cannot be pointed at on the screen, so the overlay is not offered.
    pub layout: Option<Rect>,
    /// How many sensitive fields were filled in before the file was reported.
    pub redacted: usize,
}

/// A refusal is an answer. `code` is one of the protocol's closed set.
pub type CaptureError = (&'static str, String);

fn temp_path() -> PathBuf {
    let runtime = std::env::var("XDG_RUNTIME_DIR")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "/tmp".into());
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    PathBuf::from(runtime).join(format!("nib-capture-{nanos}.png"))
}

fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var("PATH").ok()?;
    std::env::split_paths(&path)
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
}

/// Reads the IHDR chunk rather than decoding: the size is wanted for every capture, the
/// pixels only for one that has something to redact.
fn png_size(path: &Path) -> Result<(u32, u32), String> {
    let decoder = png::Decoder::new(File::open(path).map_err(|error| error.to_string())?);
    let reader = decoder.read_info().map_err(|error| error.to_string())?;
    let info = reader.info();
    Ok((info.width, info.height))
}

fn grim(arguments: &[String], target: &Path) -> Result<(), CaptureError> {
    let Some(binary) = which("grim") else {
        return Err(("not-found", "grim is not installed, and the portal cannot capture a region".into()));
    };
    let status = Command::new(binary)
        .args(arguments)
        .arg(target)
        .status()
        .map_err(|error| ("internal", error.to_string()))?;
    if !status.success() {
        return Err(("internal", format!("grim exited with {status}")));
    }
    Ok(())
}

fn geometry(rect: &Rect) -> String {
    format!("{},{} {}x{}", rect.x, rect.y, rect.width, rect.height)
}

fn rect_from_request(raw: &Value) -> Option<Rect> {
    let rect = raw.get("rect")?;
    let read = |key: &str| rect.get(key)?.as_f64().map(|number| number.round() as i32);
    let width = read("width")?;
    let height = read("height")?;
    if width <= 0 || height <= 0 {
        return None;
    }
    Some(Rect { x: read("x")?, y: read("y")?, width, height })
}

/// The whole desktop as one box. Used to decide whether a portal screenshot can be mapped
/// back onto the screen: if its pixel size does not match, it captured something else and
/// no mapping is reported rather than a wrong one.
fn layout_union(outputs: &[compositor::Output]) -> Option<Rect> {
    if outputs.is_empty() {
        return None;
    }
    let left = outputs.iter().map(|output| output.rect.x).min()?;
    let top = outputs.iter().map(|output| output.rect.y).min()?;
    let right = outputs.iter().map(|output| output.rect.x + output.rect.width).max()?;
    let bottom = outputs.iter().map(|output| output.rect.y + output.rect.height).max()?;
    Some(Rect { x: left, y: top, width: right - left, height: bottom - top })
}

fn portal_screenshot(target: &Path) -> Result<PathBuf, CaptureError> {
    let mut options: HashMap<&str, ZValue<'_>> = HashMap::new();
    options.insert("interactive", ZValue::from(false));

    let response = portal::call_request("org.freedesktop.portal.Screenshot", "Screenshot", "", options, PORTAL_TIMEOUT)
        .map_err(|error| ("internal", error))?;
    if response.code != 0 {
        return Err(("denied", "the desktop refused the screenshot".into()));
    }
    let uri = response
        .results
        .get("uri")
        .and_then(|value| String::try_from(value.try_clone().ok()?).ok())
        .ok_or(("internal", "the portal answered without a file".to_string()))?;
    let source = portal::path_from_uri(&uri).ok_or(("internal", format!("the portal answered with {uri}")))?;

    // Moved into our own runtime directory so the lifetime of the file is ours: the host
    // deletes it after the upload, and a portal temp file is not ours to leave lying about.
    let source = PathBuf::from(source);
    if std::fs::rename(&source, target).is_ok() {
        return Ok(target.to_path_buf());
    }
    std::fs::copy(&source, target).map_err(|error| ("internal", error.to_string()))?;
    let _ = std::fs::remove_file(&source);
    Ok(target.to_path_buf())
}

pub struct CaptureContext {
    pub ipc: Option<(Ipc, PathBuf)>,
    /// Layout rects to fill in before the file is reported, in desktop coordinates.
    pub sensitive: Vec<Rect>,
}

pub fn capture(request: &Value, context: &CaptureContext) -> Result<Capture, CaptureError> {
    let mode = request.get("mode").and_then(Value::as_str).unwrap_or("screen");
    let target = temp_path();
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let outputs = context
        .ipc
        .as_ref()
        .and_then(|(ipc, path)| compositor::outputs(*ipc, path).ok())
        .unwrap_or_default();

    let (path, output, layout) = match mode {
        "region" => {
            let rect = rect_from_request(request)
                .ok_or(("unsupported", "a region capture needs a rectangle".to_string()))?;
            grim(&["-g".into(), geometry(&rect)], &target)?;
            let name = outputs
                .iter()
                .find(|output| {
                    rect.x >= output.rect.x
                        && rect.y >= output.rect.y
                        && rect.x < output.rect.x + output.rect.width
                        && rect.y < output.rect.y + output.rect.height
                })
                .map(|output| output.name.clone());
            (target.clone(), name, Some(rect))
        }
        "window" => {
            let (ipc, socket) = context
                .ipc
                .as_ref()
                .ok_or(("unsupported", "this compositor exposes no window geometry".to_string()))?;
            let window = compositor::focused_window(*ipc, socket).map_err(|error| ("not-found", error))?;
            let rect = window
                .rect
                .ok_or(("not-found", "the focused window reported no geometry".to_string()))?;
            grim(&["-g".into(), geometry(&rect)], &target)?;
            (target.clone(), None, Some(rect))
        }
        _ => {
            let requested = request.get("output").and_then(Value::as_str);
            match requested {
                // An explicit output is grim's job: the portal takes no such argument.
                Some(name) => {
                    grim(&["-o".into(), name.to_string()], &target)?;
                    let rect = outputs.iter().find(|output| output.name == name).map(|output| Rect {
                        x: output.rect.x,
                        y: output.rect.y,
                        width: output.rect.width,
                        height: output.rect.height,
                    });
                    (target.clone(), Some(name.to_string()), rect)
                }
                None => {
                    let captured = portal_screenshot(&target)?;
                    (captured, None, layout_union(&outputs))
                }
            }
        }
    };

    let (width, height) = png_size(&path).map_err(|error| ("internal", error))?;

    // A layout box only means something if the image actually covers it. A portal that
    // captured one output of two would otherwise place every region in the wrong place.
    let layout = layout.filter(|rect| {
        if rect.width <= 0 || rect.height <= 0 {
            return false;
        }
        let ratio = (width as f64 / rect.width as f64) - (height as f64 / rect.height as f64);
        ratio.abs() < 0.05
    });

    let redacted = redact(&path, &context.sensitive, layout.as_ref(), width, height);

    Ok(Capture {
        path: path.to_string_lossy().into_owned(),
        width,
        height,
        output,
        layout,
        redacted,
    })
}

/// Fills every sensitive rect with a flat block, in place, before the path is reported —
/// so the redacted version is the only version that ever exists on disk.
///
/// Returns how many were filled. A decode this cannot handle fills nothing and says zero,
/// which the pane renders as "nothing was redacted" rather than as a silent success.
fn redact(path: &Path, sensitive: &[Rect], layout: Option<&Rect>, width: u32, height: u32) -> usize {
    if sensitive.is_empty() {
        return 0;
    }
    let Some(layout) = layout else { return 0 };
    if layout.width <= 0 || layout.height <= 0 {
        return 0;
    }

    let Ok(file) = File::open(path) else { return 0 };
    let Ok(mut reader) = png::Decoder::new(file).read_info() else { return 0 };
    let mut buffer = vec![0u8; reader.output_buffer_size()];
    let Ok(frame) = reader.next_frame(&mut buffer) else { return 0 };
    if frame.bit_depth != png::BitDepth::Eight {
        return 0;
    }
    let channels = match frame.color_type {
        png::ColorType::Rgba => 4,
        png::ColorType::Rgb => 3,
        _ => return 0,
    };

    let scale_x = width as f64 / layout.width as f64;
    let scale_y = height as f64 / layout.height as f64;
    let mut filled = 0;

    for rect in sensitive {
        let left = (((rect.x - layout.x) as f64) * scale_x).floor().max(0.0) as u32;
        let top = (((rect.y - layout.y) as f64) * scale_y).floor().max(0.0) as u32;
        let right = ((((rect.x - layout.x + rect.width) as f64) * scale_x).ceil() as u32).min(width);
        let bottom = ((((rect.y - layout.y + rect.height) as f64) * scale_y).ceil() as u32).min(height);
        if right <= left || bottom <= top {
            continue;
        }
        for y in top..bottom {
            let row = (y as usize) * (width as usize) * channels;
            for x in left..right {
                let offset = row + (x as usize) * channels;
                buffer[offset] = 0;
                buffer[offset + 1] = 0;
                buffer[offset + 2] = 0;
                if channels == 4 {
                    buffer[offset + 3] = 255;
                }
            }
        }
        filled += 1;
    }

    if filled == 0 {
        return 0;
    }

    let Ok(file) = File::create(path) else { return 0 };
    let mut encoder = png::Encoder::new(BufWriter::new(file), width, height);
    encoder.set_color(frame.color_type);
    encoder.set_depth(png::BitDepth::Eight);
    let Ok(mut writer) = encoder.write_header() else { return 0 };
    if writer.write_image_data(&buffer[..frame.buffer_size()]).is_err() {
        return 0;
    }
    filled
}
