//! Окна: каждое полотно можно открыть в своём окне. Одно полотно живёт максимум в одном окне.

use crate::util::{err, safe_id, Res};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window};

/// Флаги, которые Tauri ставит по умолчанию (их надо повторить, если задаёшь свои).
const BASE_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
/// Дополнительные флаги по умолчанию. Кадры идут с частотой монитора (vsync), потолок 260 стоит во фронте.
/// `--disable-frame-rate-limit` и `--disable-gpu-vsync` в WebView2 не снимают лимит, а роняют его до 60:
/// первый не доходит до GPU-процесса, второй включает запасной таймер на 60 Гц.
const WEBVIEW_ARGS: &str = "";

#[derive(Default)]
pub struct Wins {
    /// полотно → метка окна
    owners: Mutex<HashMap<String, String>>,
    /// окно, которое последним было в фокусе (туда идут файлы из проводника)
    pub last_focus: Mutex<String>,
    seq: AtomicU32,
}

fn browser_args() -> String {
    // флаги WebView2 можно переопределить без пересборки: POLOTNO_WEBVIEW_ARGS
    let extra = std::env::var("POLOTNO_WEBVIEW_ARGS").unwrap_or_else(|_| WEBVIEW_ARGS.to_string());
    format!("{BASE_ARGS} {extra}")
}

pub fn build_window(app: &AppHandle, label: &str, project: Option<&str>) -> tauri::Result<WebviewWindow> {
    let mut cfg = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .expect("в tauri.conf.json нет окна main");
    cfg.label = label.to_string();
    if let Some(p) = project {
        cfg.url = WebviewUrl::App(format!("index.html?p={p}").into());
    }
    if label != "main" {
        // доп. окна стартуют обычными, чтобы их можно было разнести по мониторам
        cfg.maximized = false;
        cfg.width = 1280.0;
        cfg.height = 820.0;
    }
    WebviewWindowBuilder::from_config(app, &cfg)?.additional_browser_args(&browser_args()).build()
}

pub fn focus(w: &WebviewWindow) {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
}

/// Окно, куда отдавать файлы из проводника: последнее в фокусе, иначе любое.
pub fn target_window(app: &AppHandle) -> Option<WebviewWindow> {
    let last = app.state::<Wins>().last_focus.lock().ok().map(|s| s.clone()).unwrap_or_default();
    app.get_webview_window(&last)
        .or_else(|| app.get_webview_window("main"))
        .or_else(|| app.webview_windows().into_values().next())
}

/// Окно сообщает, что открыло полотно. Если оно уже открыто в другом окне, показываем то окно
/// и возвращаем его метку: значит, здесь открывать нельзя.
#[tauri::command]
pub fn claim_project(app: AppHandle, window: Window, wins: tauri::State<'_, Wins>, id: String) -> Res<Option<String>> {
    let me = window.label().to_string();
    let mut owners = wins.owners.lock().map_err(err)?;
    if let Some(other) = owners.get(&id).cloned() {
        if other != me {
            if let Some(w) = app.get_webview_window(&other) {
                focus(&w);
                return Ok(Some(other));
            }
        }
    }
    owners.retain(|_, l| l != &me);
    owners.insert(id, me);
    Ok(None)
}

/// Какие полотна сейчас открыты в каких окнах.
#[tauri::command]
pub fn open_projects(wins: tauri::State<'_, Wins>) -> Res<HashMap<String, String>> {
    Ok(wins.owners.lock().map_err(err)?.clone())
}

/// Открыть полотно в новом окне (или показать окно, где оно уже открыто).
#[tauri::command]
pub async fn open_window(app: AppHandle, project: String) -> Res<()> {
    if !safe_id(&project) {
        return Err("плохой id полотна".into());
    }
    let wins = app.state::<Wins>();
    let owner = wins.owners.lock().map_err(err)?.get(&project).cloned();
    if let Some(w) = owner.and_then(|l| app.get_webview_window(&l)) {
        focus(&w);
        return Ok(());
    }
    // метки w1, w2… переиспользуются: окно-состояние (размер, позиция) запоминается по метке
    let label = (1..)
        .map(|n| format!("w{n}"))
        .find(|l| app.get_webview_window(l).is_none())
        .unwrap_or_else(|| format!("w{}", wins.seq.fetch_add(1, Ordering::Relaxed) + 1000));
    wins.owners.lock().map_err(err)?.insert(project.clone(), label.clone());
    build_window(&app, &label, Some(&project)).map_err(err)?;
    Ok(())
}

pub fn on_destroyed(app: &AppHandle, label: &str) {
    if let Ok(mut o) = app.state::<Wins>().owners.lock() {
        o.retain(|_, l| l != label);
    }
}
