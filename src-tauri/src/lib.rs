use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;

static DATA_DIR: OnceLock<Mutex<PathBuf>> = OnceLock::new();
static FILE_WATCHER: OnceLock<Mutex<Option<RecommendedWatcher>>> = OnceLock::new();

#[derive(Clone, Serialize)]
struct DirEntry {
    path: String,
    name: String,
    entry_type: String,
    modified: u64,
}

#[derive(Clone, Serialize, Deserialize)]
struct Position {
    x: f64,
    y: f64,
}

fn init_data_dir() {
    let dir = if let Ok(exe) = std::env::current_exe() {
        let exe_str = exe.to_string_lossy();
        if exe_str.contains(".app/Contents/MacOS/") {
            let mut p = exe.clone();
            p.pop(); p.pop(); p.pop(); // MacOS → Contents → Foo.app
            if let Some(parent) = p.parent() {
                parent.to_path_buf()
            } else {
                std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
            }
        } else {
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
        }
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    DATA_DIR.get_or_init(|| Mutex::new(dir));
    FILE_WATCHER.get_or_init(|| Mutex::new(None));
}

fn get_data_dir() -> PathBuf {
    DATA_DIR.get().unwrap().lock().unwrap().clone()
}

fn set_data_dir(path: PathBuf) {
    *DATA_DIR.get().unwrap().lock().unwrap() = path;
}

fn start_watcher(app_handle: AppHandle) {
    let dir = get_data_dir();
    let handle = app_handle.clone();
    let (tx, rx) = std::sync::mpsc::channel();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            let _ = tx.send(res);
        },
        notify::Config::default(),
    )
    .ok();

    if let Some(ref mut w) = watcher {
        let _ = w.watch(&dir, RecursiveMode::NonRecursive);
    }

    *FILE_WATCHER.get().unwrap().lock().unwrap() = watcher;

    std::thread::spawn(move || {
        for res in rx {
            if let Ok(event) = res {
                let is_relevant = event.paths.iter().any(|p| {
                    if let Some(ext) = p.extension() {
                        let e = ext.to_string_lossy().to_lowercase();
                        e == "md" || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].contains(&e.as_str())
                    } else {
                        false
                    }
                });
                if is_relevant {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    let _ = handle.emit("files-changed", ());
                }
            }
        }
    });
}

fn list_directory_files() -> Vec<DirEntry> {
    let dir = get_data_dir();
    let mut entries = Vec::new();

    if let Ok(read_dir) = fs::read_dir(&dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_lower = ext.to_string_lossy().to_lowercase();
                    let entry_type = if ext_lower == "md" {
                        Some("md".to_string())
                    } else if ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].contains(&ext_lower.as_str()) {
                        Some("image".to_string())
                    } else {
                        None
                    };

                    if let Some(et) = entry_type {
                        let name = path.file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default();
                        let modified = entry.metadata()
                            .and_then(|m| m.modified())
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);

                        entries.push(DirEntry {
                            path: path.to_string_lossy().to_string(),
                            name,
                            entry_type: et,
                            modified,
                        });
                    }
                }
            }
        }
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    entries
}

#[tauri::command]
fn get_current_directory() -> String {
    get_data_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn read_directory() -> Vec<DirEntry> {
    list_directory_files()
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_positions() -> HashMap<String, Position> {
    let positions_path = get_data_dir().join("positions.json");
    if let Ok(data) = fs::read_to_string(&positions_path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        HashMap::new()
    }
}

#[tauri::command]
fn write_positions(positions: HashMap<String, Position>) -> Result<(), String> {
    let positions_path = get_data_dir().join("positions.json");
    let data = serde_json::to_string_pretty(&positions).map_err(|e| e.to_string())?;
    fs::write(positions_path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_image_data_url(path: String) -> Result<String, String> {
    let ext = PathBuf::from(&path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => "image/png",
    };

    let data = fs::read(&path).map_err(|e| e.to_string())?;
    let b64 = base64_encode(&data);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
async fn pick_directory(app: AppHandle) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();

    app.dialog()
        .file()
        .pick_folder(move |path| {
            let _ = tx.send(path);
        });

    match rx.await {
        Ok(Some(file_path)) => {
            let pb = PathBuf::from(file_path.to_string());
            set_data_dir(pb.clone());
            start_watcher(app);
            Ok(pb.to_string_lossy().to_string())
        }
        Ok(None) => Err("cancelled".to_string()),
        Err(_) => Err("cancelled".to_string()),
    }
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;
        result.push(CHARS[b0 >> 2] as char);
        result.push(CHARS[((b0 & 0x03) << 4) | (b1 >> 4)] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[b2 & 0x3f] as char);
        } else {
            result.push('=');
        }
    }
    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_data_dir();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_directory,
            read_file,
            write_file,
            read_positions,
            write_positions,
            get_image_data_url,
            get_current_directory,
            pick_directory,
        ])
        .setup(|app| {
            start_watcher(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}