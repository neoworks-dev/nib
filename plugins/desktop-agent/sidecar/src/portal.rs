//! The XDG desktop portal, over raw D-Bus.
//!
//! `ashpd` would wrap this, at the cost of pulling an async runtime into a process whose
//! only other need is a blocking socket read. The portal's request pattern is small enough
//! to write out: a method call returns a `Request` object path, and the answer arrives
//! later as a `Response` signal on it.
//!
//! The signal is subscribed to *before* the call, using the request path the portal is
//! obliged to derive from our unique name and the handle token. Subscribing after the call
//! would race a portal that answers immediately — which one with a permission already
//! stored does.

use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use zbus::blocking::Connection;
use zbus::zvariant::{OwnedValue, Value};

pub const DESTINATION: &str = "org.freedesktop.portal.Desktop";
pub const OBJECT_PATH: &str = "/org/freedesktop/portal/desktop";

/// Distinct per request, and part of the object path the portal answers on.
fn handle_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    format!("nib{nanos}")
}

/// `:1.42` becomes `1_42`, which is how the portal spells a sender inside a request path.
fn sender_fragment(connection: &Connection) -> Result<String, String> {
    let unique = connection
        .inner()
        .unique_name()
        .ok_or("the session bus gave this process no unique name")?
        .to_string();
    Ok(unique.trim_start_matches(':').replace('.', "_"))
}

pub struct PortalResponse {
    pub code: u32,
    pub results: HashMap<String, OwnedValue>,
}

/// Calls a portal method that answers with a `Request`, and waits for that request's
/// `Response`. Blocking, so callers run it off the message loop.
pub fn call_request(
    interface: &str,
    method: &str,
    parent_window: &str,
    mut options: HashMap<&str, Value<'_>>,
    timeout: Duration,
) -> Result<PortalResponse, String> {
    let connection = Connection::session().map_err(|error| error.to_string())?;
    let token = handle_token();
    let expected_path = format!(
        "/org/freedesktop/portal/desktop/request/{}/{token}",
        sender_fragment(&connection)?
    );
    options.insert("handle_token", Value::from(token.clone()));

    let request = zbus::blocking::Proxy::new(
        &connection,
        DESTINATION,
        expected_path.as_str(),
        "org.freedesktop.portal.Request",
    )
    .map_err(|error| error.to_string())?;
    let mut responses = request
        .receive_signal("Response")
        .map_err(|error| error.to_string())?;

    let proxy = zbus::blocking::Proxy::new(&connection, DESTINATION, OBJECT_PATH, interface)
        .map_err(|error| error.to_string())?;
    proxy
        .call_noreply(method, &(parent_window, &options))
        .map_err(|error| error.to_string())?;

    // The iterator blocks, so the wait is bounded by a thread that stops listening rather
    // than by a timeout parameter the API does not have.
    let deadline = SystemTime::now() + timeout;
    loop {
        if SystemTime::now() > deadline {
            return Err(format!("the portal did not answer `{method}` in time"));
        }
        let Some(message) = responses.next() else {
            return Err("the portal closed the request without answering".into());
        };
        let (code, results): (u32, HashMap<String, OwnedValue>) =
            message.body().deserialize().map_err(|error| error.to_string())?;
        return Ok(PortalResponse { code, results });
    }
}

/// `file:///tmp/a%20b.png` to `/tmp/a b.png`. The portal always answers with a `file:` URI,
/// and percent-decoding it by hand beats a dependency for one function.
pub fn path_from_uri(uri: &str) -> Option<String> {
    let encoded = uri.strip_prefix("file://")?;
    let bytes = encoded.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = (bytes[index + 1] as char).to_digit(16);
            let low = (bytes[index + 2] as char).to_digit(16);
            if let (Some(high), Some(low)) = (high, low) {
                decoded.push((high * 16 + low) as u8);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(decoded).ok()
}
