// Prevents an additional console window from appearing on Windows in
// release builds. DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Emitter;

/// Returns the contents of the project file the OS launched ScriptBreak
/// with, or `None` if there wasn't one.
///
/// On Windows and Linux, double-clicking a `.scriptbreak` (or `.json`)
/// file passes its path as `argv[1]`, which is what this command reads.
///
/// On macOS, Finder delivers the file via an Apple Event instead of argv,
/// so this command alone won't see it there — see the `RunEvent::Opened`
/// handling in `main()` below, which emits an `open-project-file` event
/// that the frontend can listen for instead.
#[tauri::command]
fn initial_file() -> Option<String> {
    let path = std::env::args().nth(1)?;
    let path = std::path::Path::new(&path);
    if !path.exists() {
        return None;
    }

    let has_project_ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("scriptbreak") || ext.eq_ignore_ascii_case("json"))
        .unwrap_or(false);
    if !has_project_ext {
        return None;
    }

    std::fs::read_to_string(path).ok()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![initial_file])
        .build(tauri::generate_context!())
        .expect("error while building ScriptBreak")
        .run(|_app, _event| {
            // macOS (and iOS/Android) deliver "open this file" requests as a
            // RunEvent::Opened rather than as argv, so we handle it here and
            // forward the file's contents to the frontend as an event. The
            // frontend should call `listen("open-project-file", ...)` via
            // `window.__TAURI__.event.listen` to receive it.
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let tauri::RunEvent::Opened { urls } = &_event {
                if let Some(url) = urls.first() {
                    if let Ok(path) = url.to_file_path() {
                        if let Ok(contents) = std::fs::read_to_string(&path) {
                            let _ = _app.emit("open-project-file", contents);
                        }
                    }
                }
            }
        });
}
