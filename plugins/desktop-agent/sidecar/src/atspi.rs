//! The accessibility tree, over raw D-Bus.
//!
//! AT-SPI is the only source of *named* regions: it says that a rectangle is a button
//! called "Save" rather than that it is a rectangle. It is opt-in for the target
//! application, so an app that exposes nothing yields nothing, and the pixel detector on
//! the host covers that case.
//!
//! The `atspi` crate would wrap this. It is not used: the interfaces needed here are four
//! methods and two properties, the crate's typed event machinery is for a client that
//! subscribes rather than one that walks once, and this keeps the dependency list at the
//! three crates already present.

use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::OwnedObjectPath;

use crate::compositor::Rect;

const ACCESSIBLE: &str = "org.a11y.atspi.Accessible";
const COMPONENT: &str = "org.a11y.atspi.Component";
/// `GetExtents` in screen coordinates, which is what a capture is measured in too.
const COORD_SCREEN: u32 = 0;
/// Bit 1 of the state bitfield: the window the user is working in.
const STATE_ACTIVE: u32 = 1;

pub struct Node {
    pub rect: Rect,
    pub name: Option<String>,
    pub role: String,
    pub sensitive: bool,
}

/// Roles worth pointing at. A pane, a filler and a panel are structure, not something a
/// user clicks, and returning them would bury the handful of regions that matter.
const INTERACTIVE: &[&str] = &[
    "push button",
    "toggle button",
    "check box",
    "radio button",
    "menu item",
    "check menu item",
    "radio menu item",
    "menu",
    "link",
    "combo box",
    "entry",
    "text",
    "password text",
    "slider",
    "spin button",
    "page tab",
    "list item",
    "table cell",
];

/**
 * `password text` is the whole test. The brief called for AT-SPI's `SENSITIVE` state as a
 * second signal, and that is wrong: in AT-SPI `SENSITIVE` means the widget is *enabled*,
 * so treating it as "holds a secret" would redact almost every control on the screen.
 */
fn is_sensitive(role: &str) -> bool {
    role == "password text"
}

/// The a11y bus is a bus of its own; the session bus only says where it is.
fn connect() -> Result<Connection, String> {
    let session = Connection::session().map_err(|error| error.to_string())?;
    let bus = Proxy::new(&session, "org.a11y.Bus", "/org/a11y/bus", "org.a11y.Bus")
        .map_err(|error| error.to_string())?;
    let address: String = bus.call("GetAddress", &()).map_err(|error| error.to_string())?;

    zbus::blocking::connection::Builder::address(address.as_str())
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())
}

/// One accessible object: the bus name that owns it and the path to it.
type Reference = (String, OwnedObjectPath);

fn accessible<'a>(connection: &'a Connection, reference: &Reference) -> Result<Proxy<'a>, String> {
    Proxy::new(connection, reference.0.clone(), reference.1.clone(), ACCESSIBLE).map_err(|error| error.to_string())
}

fn children(connection: &Connection, reference: &Reference) -> Vec<Reference> {
    let Ok(proxy) = accessible(connection, reference) else { return Vec::new() };
    proxy.call::<_, _, Vec<Reference>>("GetChildren", &()).unwrap_or_default()
}

fn role_name(connection: &Connection, reference: &Reference) -> String {
    accessible(connection, reference)
        .and_then(|proxy| proxy.call::<_, _, String>("GetRoleName", &()).map_err(|error| error.to_string()))
        .unwrap_or_default()
}

fn name_of(connection: &Connection, reference: &Reference) -> Option<String> {
    let proxy = accessible(connection, reference).ok()?;
    let name: String = proxy.get_property("Name").ok()?;
    Some(name).filter(|entry| !entry.is_empty())
}

fn is_active(connection: &Connection, reference: &Reference) -> bool {
    let Ok(proxy) = accessible(connection, reference) else { return false };
    let Ok(states) = proxy.call::<_, _, Vec<u32>>("GetState", &()) else { return false };
    states.first().is_some_and(|low| low & (1 << STATE_ACTIVE) != 0)
}

fn extents(connection: &Connection, reference: &Reference) -> Option<Rect> {
    let proxy = Proxy::new(connection, reference.0.clone(), reference.1.clone(), COMPONENT).ok()?;
    let (x, y, width, height): (i32, i32, i32, i32) = proxy.call("GetExtents", &(COORD_SCREEN)).ok()?;
    if width <= 0 || height <= 0 {
        return None;
    }
    Some(Rect { x, y, width, height })
}

/// The window the user is working in. Applications are the root's children and windows are
/// theirs, so the search is two levels deep and stops at the first active window — walking
/// every application's whole tree to find one focused node would cost seconds.
fn active_window(connection: &Connection) -> Option<Reference> {
    let root: Reference = (
        "org.a11y.atspi.Registry".to_string(),
        OwnedObjectPath::try_from("/org/a11y/atspi/accessible/root").ok()?,
    );
    for application in children(connection, &root) {
        for window in children(connection, &application) {
            if is_active(connection, &window) {
                return Some(window);
            }
        }
    }
    None
}

/// Every interactive node inside the active window, breadth-first so a budget that runs out
/// leaves the top of the interface described rather than one deep corner of it.
pub fn regions(max_nodes: usize) -> Result<Vec<Node>, String> {
    let connection = connect()?;
    let window = active_window(&connection).ok_or("no application exposes an active window")?;

    let mut found = Vec::new();
    let mut queue = vec![window];
    let mut visited = 0;

    while let Some(reference) = queue.first().cloned() {
        queue.remove(0);
        visited += 1;
        if visited > max_nodes {
            break;
        }

        let role = role_name(&connection, &reference);
        if INTERACTIVE.contains(&role.as_str()) {
            if let Some(rect) = extents(&connection, &reference) {
                found.push(Node {
                    rect,
                    name: name_of(&connection, &reference),
                    sensitive: is_sensitive(&role),
                    role,
                });
            }
        }
        queue.extend(children(&connection, &reference));
    }

    Ok(found)
}

/// What must be blacked out before a capture reaches disk. Answers an empty list rather
/// than an error: a machine with no accessibility bus redacts nothing and the pane says so.
pub fn sensitive_rects(max_nodes: usize) -> Vec<Rect> {
    regions(max_nodes)
        .unwrap_or_default()
        .into_iter()
        .filter(|node| node.sensitive)
        .map(|node| node.rect)
        .collect()
}
