use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

struct Term {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Terms {
    map: Mutex<HashMap<u32, Term>>,
    next: AtomicU32,
}

#[derive(Clone, Serialize)]
struct Data {
    id: u32,
    data: String,
}

#[tauri::command]
pub fn term_open(
    app: AppHandle,
    root: String,
    cols: u16,
    rows: u16,
    terms: State<'_, Terms>,
) -> Result<u32, String> {
    let pty = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new_default_prog();
    cmd.cwd(&root);
    cmd.env("TERM", "xterm-256color");
    let child = pty.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pty.slave);
    let mut reader = pty.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pty.master.take_writer().map_err(|e| e.to_string())?;
    let id = terms.next.fetch_add(1, Ordering::Relaxed);
    terms.map.lock().unwrap().insert(
        id,
        Term {
            master: pty.master,
            writer,
            child,
        },
    );
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    // Hold back a UTF-8 sequence split across reads.
                    let valid = match std::str::from_utf8(&pending) {
                        Ok(_) => pending.len(),
                        Err(e) if e.error_len().is_none() => e.valid_up_to(),
                        Err(_) => pending.len(),
                    };
                    let data = String::from_utf8_lossy(&pending[..valid]).into_owned();
                    pending.drain(..valid);
                    let _ = app.emit("term-data", Data { id, data });
                }
            }
        }
        let _ = app.emit("term-exit", id);
    });
    Ok(id)
}

#[tauri::command]
pub fn term_write(id: u32, data: String, terms: State<'_, Terms>) -> Result<(), String> {
    let mut map = terms.map.lock().unwrap();
    let t = map.get_mut(&id).ok_or("terminal closed")?;
    t.writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn term_resize(id: u32, cols: u16, rows: u16, terms: State<'_, Terms>) -> Result<(), String> {
    let map = terms.map.lock().unwrap();
    let t = map.get(&id).ok_or("terminal closed")?;
    t.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn term_close(id: u32, terms: State<'_, Terms>) {
    if let Some(mut t) = terms.map.lock().unwrap().remove(&id) {
        let _ = t.child.kill();
    }
}
