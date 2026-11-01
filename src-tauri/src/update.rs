//! Автообновление через GitHub Releases (`latest.json`, подпись minisign).
//! Проверяется только установленная версия: портативный exe обновлять некуда.

use crate::util::{err, Res};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize)]
pub struct UpdateInfo {
    version: String,
    current: String,
    notes: String,
    date: String,
}

fn updater(app: &AppHandle) -> Res<tauri_plugin_updater::Updater> {
    let mut b = app.updater_builder();
    // для проверки обновлений на локальном сервере: POLOTNO_UPDATE_ENDPOINT=http://127.0.0.1:8123/latest.json
    if let Ok(e) = std::env::var("POLOTNO_UPDATE_ENDPOINT") {
        b = b.endpoints(vec![e.parse().map_err(err)?]).map_err(err)?;
    }
    b.build().map_err(err)
}

/// Приложение стоит через установщик (а не запущено как портативный exe).
/// Признак — `uninstall.exe` рядом с exe: установщик кладёт его в любую выбранную папку,
/// у портативного exe его нет. (В 0.5.0 сверялась только папка по умолчанию, и установка
/// в другое место, например `Z:\Polotno`, считалась портативной — обновления не проверялись.)
#[tauri::command]
pub fn is_installed() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("uninstall.exe").is_file()))
        .unwrap_or(false)
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Res<Option<UpdateInfo>> {
    let Some(u) = updater(&app)?.check().await.map_err(err)? else { return Ok(None) };
    Ok(Some(UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone().unwrap_or_default(),
        date: u.date.map(|d| d.to_string()).unwrap_or_default(),
    }))
}

/// Скачать и поставить. Установщик NSIS в тихом режиме сам закрывает и перезапускает приложение.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Res<()> {
    let Some(u) = updater(&app)?.check().await.map_err(err)? else { return Err("обновлений нет".into()) };
    u.download_and_install(|_, _| {}, || {}).await.map_err(err)?;
    app.restart();
}
