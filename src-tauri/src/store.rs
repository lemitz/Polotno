//! Рабочая область на диске: `index.json` (список полотен) и `projects/<id>.json` (по файлу на полотно).
//! Каждое окно пишет только своё полотно, поэтому окна не затирают изменения друг друга.

use crate::util::{data_dir, err, safe_id, sub_dir, write_atomic, Res};
use serde_json::{json, Value};
use std::{
    fs,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Emitter, State};

/// Были изменения с последнего бэкапа.
pub struct Dirty(pub AtomicBool);

fn project_path(app: &AppHandle, id: &str) -> Res<std::path::PathBuf> {
    if !safe_id(id) {
        return Err(format!("плохой id полотна: {id}"));
    }
    Ok(sub_dir(app, "projects")?.join(format!("{id}.json")))
}

/// Старый формат (v0.4.1): всё в одном `workspace.json`. Раскладываем по файлам один раз.
pub fn migrate(app: &AppHandle) -> Res<()> {
    let dir = data_dir(app)?;
    let legacy = dir.join("workspace.json");
    if !legacy.exists() || dir.join("index.json").exists() {
        return Ok(());
    }
    let v: Value = serde_json::from_str(&fs::read_to_string(&legacy).map_err(err)?).map_err(err)?;
    let mut metas = Vec::new();
    for (i, p) in v["projects"].as_array().cloned().unwrap_or_default().into_iter().enumerate() {
        let mut p = p;
        let id = p["id"].as_str().filter(|s| safe_id(s)).map(String::from).unwrap_or_else(|| format!("p{i}-{}", crate::util::rand_id()));
        p["id"] = json!(id);
        let name = p["name"].as_str().unwrap_or("Без названия").to_string();
        write_atomic(&project_path(app, &id)?, p.to_string().as_bytes())?;
        metas.push(json!({ "id": id, "name": name }));
    }
    let index = json!({ "projects": metas, "current": v["currentProject"] });
    write_atomic(&dir.join("index.json"), index.to_string().as_bytes())?;
    fs::rename(&legacy, dir.join("workspace.v041.json")).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub async fn ws_index(app: AppHandle) -> Res<Option<String>> {
    let p = data_dir(&app)?.join("index.json");
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(p).map(Some).map_err(err)
}

/// Сохраняет список полотен и рассылает его всем окнам.
#[tauri::command]
pub async fn index_save(app: AppHandle, dirty: State<'_, Dirty>, data: String) -> Res<()> {
    serde_json::from_str::<Value>(&data).map_err(err)?;
    write_atomic(&data_dir(&app)?.join("index.json"), data.as_bytes())?;
    dirty.0.store(true, Ordering::Relaxed);
    let _ = app.emit("index-changed", data);
    Ok(())
}

#[tauri::command]
pub async fn project_load(app: AppHandle, id: String) -> Res<Option<String>> {
    let p = project_path(&app, &id)?;
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(p).map(Some).map_err(err)
}

#[tauri::command]
pub async fn project_save(app: AppHandle, dirty: State<'_, Dirty>, id: String, data: String) -> Res<()> {
    write_atomic(&project_path(&app, &id)?, data.as_bytes())?;
    dirty.0.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn project_delete(app: AppHandle, dirty: State<'_, Dirty>, id: String) -> Res<()> {
    let p = project_path(&app, &id)?;
    if p.exists() {
        fs::remove_file(p).map_err(err)?;
    }
    dirty.0.store(true, Ordering::Relaxed);
    Ok(())
}
