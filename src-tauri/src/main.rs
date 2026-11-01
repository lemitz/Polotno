// В релизе без консольного окна
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod att;
mod backup;
mod pdf;
mod preview;
mod store;
mod update;
mod util;
mod wins;

use std::{
    fs,
    path::Path,
    sync::{atomic::AtomicBool, Mutex},
};
use tauri::{Emitter, Manager, State, WindowEvent};
use util::{err, Res};

/// Файл, с которым запустили приложение (двойной клик по .polotno), ждёт, пока его заберёт фронт.
struct PendingOpen(Mutex<Option<String>>);

const EXTS: [&str; 2] = [".polotno", ".json"];

fn file_arg(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| {
            let l = a.to_lowercase();
            !a.starts_with('-') && EXTS.iter().any(|e| l.ends_with(e))
        })
        .cloned()
}

#[tauri::command]
async fn read_text(path: String) -> Res<String> {
    fs::read_to_string(path).map_err(err)
}

#[tauri::command]
async fn write_text(path: String, data: String) -> Res<()> {
    util::write_atomic(Path::new(&path), data.as_bytes())
}

#[tauri::command]
async fn write_base64(path: String, data: String) -> Res<()> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.trim()).map_err(err)?;
    fs::write(path, bytes).map_err(err)
}

#[tauri::command]
fn take_pending_open(pending: State<'_, PendingOpen>) -> Option<String> {
    pending.0.lock().ok().and_then(|mut p| p.take())
}

fn main() {
    // TLS для превью ссылок (reqwest + rustls, провайдер ring — тот же, что у плагина обновлений)
    let _ = rustls::crypto::ring::default_provider().install_default();
    let initial = file_arg(&std::env::args().collect::<Vec<_>>());

    tauri::Builder::default()
        // второй запуск (например, двойной клик по файлу) отдаёт файл уже открытому окну
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(w) = wins::target_window(app) {
                wins::focus(&w);
                if let Some(f) = file_arg(&args) {
                    let _ = w.emit_to(w.label(), "open-file", f);
                }
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PendingOpen(Mutex::new(initial)))
        .manage(store::Dirty(AtomicBool::new(false)))
        .manage(wins::Wins::default())
        .setup(|app| {
            if let Err(e) = store::migrate(app.handle()) {
                eprintln!("миграция workspace.json: {e}");
            }
            wins::build_window(app.handle(), "main", None)?;
            backup::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(true) => {
                if let Ok(mut l) = window.app_handle().state::<wins::Wins>().last_focus.lock() {
                    *l = window.label().to_string();
                }
            }
            WindowEvent::Destroyed => wins::on_destroyed(window.app_handle(), window.label()),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            write_base64,
            take_pending_open,
            store::ws_index,
            store::index_save,
            store::project_load,
            store::project_save,
            store::project_delete,
            wins::claim_project,
            wins::open_projects,
            wins::open_window,
            att::att_dir,
            att::att_import,
            att::att_save,
            att::att_read_b64,
            att::att_export,
            att::att_open,
            att::polotno_export,
            att::polotno_import,
            backup::backup_list,
            backup::backup_now,
            backup::backup_project,
            backup::backup_restore,
            preview::link_preview,
            pdf::pdf_info,
            update::is_installed,
            update::update_check,
            update::update_install
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить Полотно");
}
