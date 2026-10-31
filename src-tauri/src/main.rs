// В релизе без консольного окна
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};

/// Файл, с которым запустили приложение (двойной клик по .polotno), ждёт, пока его заберёт фронт.
struct PendingOpen(Mutex<Option<String>>);
/// Последовательная запись рабочего файла.
struct SaveLock(Mutex<()>);

const EXTS: [&str; 2] = [".polotno", ".json"];

/// Флаги, которые Tauri ставит по умолчанию (их надо повторить, если задаёшь свои).
const BASE_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
/// Дополнительные флаги по умолчанию. Кадры идут с частотой монитора (vsync), потолок 260 стоит во фронте.
/// `--disable-frame-rate-limit` и `--disable-gpu-vsync` в WebView2 не снимают лимит, а роняют его до 60:
/// первый не доходит до GPU-процесса, второй включает запасной таймер на 60 Гц.
const WEBVIEW_ARGS: &str = "";

fn file_arg(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| {
            let l = a.to_lowercase();
            !a.starts_with('-') && EXTS.iter().any(|e| l.ends_with(e))
        })
        .cloned()
}

fn workspace_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("workspace.json"))
}

/// Запись через временный файл: при сбое посреди записи старые данные остаются целыми.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_workspace(app: AppHandle) -> Result<Option<String>, String> {
    let p = workspace_path(&app)?;
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_workspace(app: AppHandle, lock: State<'_, SaveLock>, data: String) -> Result<(), String> {
    let p = workspace_path(&app)?;
    let _g = lock.0.lock().map_err(|e| e.to_string())?;
    write_atomic(&p, data.as_bytes())
}

#[tauri::command]
async fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_text(path: String, data: String) -> Result<(), String> {
    write_atomic(Path::new(&path), data.as_bytes())
}

#[tauri::command]
async fn write_base64(path: String, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn take_pending_open(pending: State<'_, PendingOpen>) -> Option<String> {
    pending.0.lock().ok().and_then(|mut p| p.take())
}

fn main() {
    let initial = file_arg(&std::env::args().collect::<Vec<_>>());

    tauri::Builder::default()
        // второй запуск (например, двойной клик по файлу) отдаёт файл уже открытому окну
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
            if let Some(f) = file_arg(&args) {
                let _ = app.emit("open-file", f);
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // флаги WebView2 можно переопределить без пересборки: POLOTNO_WEBVIEW_ARGS
            let args = std::env::var("POLOTNO_WEBVIEW_ARGS")
                .unwrap_or_else(|_| WEBVIEW_ARGS.to_string());
            let cfg = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .expect("в tauri.conf.json нет окна main");
            tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?
                .additional_browser_args(&format!("{BASE_ARGS} {args}"))
                .build()?;
            Ok(())
        })
        .manage(PendingOpen(Mutex::new(initial)))
        .manage(SaveLock(Mutex::new(())))
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            save_workspace,
            read_text,
            write_text,
            write_base64,
            take_pending_open
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить Полотно");
}
