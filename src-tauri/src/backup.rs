//! Автобэкапы: снимок `index.json` и `projects/*.json` в `backups/<id>/`.
//! При запуске, раз в 10 минут (если были изменения) и вручную. Вложения не копируются:
//! сборщик мусора не удаляет файлы, на которые ссылается хоть один бэкап.
//! Хранятся последние 40 снимков и по одному на день за 30 дней.

use crate::store::Dirty;
use crate::util::{data_dir, err, now_ms, safe_id, sub_dir, write_atomic, Res};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::atomic::Ordering,
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

const KEEP_LAST: usize = 40;
const KEEP_DAYS: u64 = 30;
const EVERY_MS: u64 = 10 * 60 * 1000;

#[derive(Serialize)]
pub struct BackupProject {
    id: String,
    name: String,
    cards: usize,
}

#[derive(Serialize)]
pub struct BackupInfo {
    id: String,
    time: u64,
    reason: String,
    projects: Vec<BackupProject>,
}

fn root(app: &AppHandle) -> Res<PathBuf> {
    sub_dir(app, "backups")
}

/// `b<время>-<причина>`
fn parse_id(id: &str) -> Option<(u64, String)> {
    let rest = id.strip_prefix('b')?;
    let (t, r) = rest.split_once('-')?;
    Some((t.parse().ok()?, r.to_string()))
}

fn list_ids(app: &AppHandle) -> Res<Vec<(u64, String, String)>> {
    let mut v: Vec<_> = fs::read_dir(root(app)?)
        .map_err(err)?
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let id = e.file_name().to_string_lossy().into_owned();
            parse_id(&id).map(|(t, r)| (t, r, id))
        })
        .collect();
    v.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(v)
}

pub fn snapshot(app: &AppHandle, reason: &str) -> Res<Option<String>> {
    let dir = data_dir(app)?;
    let index = dir.join("index.json");
    if !index.exists() {
        return Ok(None);
    }
    let id = format!("b{}-{reason}", now_ms());
    let dst = root(app)?.join(&id);
    fs::create_dir_all(dst.join("projects")).map_err(err)?;
    fs::copy(&index, dst.join("index.json")).map_err(err)?;
    if let Ok(rd) = fs::read_dir(dir.join("projects")) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "json") {
                fs::copy(&p, dst.join("projects").join(e.file_name())).map_err(err)?;
            }
        }
    }
    rotate(app)?;
    Ok(Some(id))
}

fn rotate(app: &AppHandle) -> Res<()> {
    let ids = list_ids(app)?;
    let now = now_ms();
    let mut days = HashSet::new();
    for (i, (t, _, id)) in ids.iter().enumerate() {
        let day = t / 86_400_000;
        let keep = i < KEEP_LAST || (now.saturating_sub(*t) < KEEP_DAYS * 86_400_000 && days.insert(day));
        if i < KEEP_LAST {
            days.insert(day);
        }
        if !keep {
            let _ = fs::remove_dir_all(root(app)?.join(id));
        }
    }
    Ok(())
}

/// Фоновый поток: снимок при запуске и раз в 10 минут, если что-то менялось.
pub fn start(app: AppHandle) {
    thread::spawn(move || {
        let newest = list_ids(&app).ok().and_then(|v| v.first().map(|x| x.0)).unwrap_or(0);
        if now_ms().saturating_sub(newest) > EVERY_MS {
            let _ = snapshot(&app, "start");
        }
        let _ = crate::att::gc(&app);
        let mut last = now_ms();
        loop {
            thread::sleep(Duration::from_secs(60));
            let dirty = &app.state::<Dirty>().0;
            if now_ms().saturating_sub(last) >= EVERY_MS && dirty.swap(false, Ordering::Relaxed) {
                let _ = snapshot(&app, "auto");
                last = now_ms();
            }
        }
    });
}

fn read_projects(dir: &Path) -> Vec<BackupProject> {
    let Ok(t) = fs::read_to_string(dir.join("index.json")) else { return vec![] };
    let Ok(idx) = serde_json::from_str::<Value>(&t) else { return vec![] };
    idx["projects"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|m| {
            let id = m["id"].as_str()?.to_string();
            let cards = fs::read_to_string(dir.join("projects").join(format!("{id}.json")))
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .and_then(|p| p["cards"].as_array().map(|a| a.len()))
                .unwrap_or(0);
            Some(BackupProject { name: m["name"].as_str().unwrap_or("").to_string(), id, cards })
        })
        .collect()
}

#[tauri::command]
pub async fn backup_list(app: AppHandle) -> Res<Vec<BackupInfo>> {
    let r = root(&app)?;
    Ok(list_ids(&app)?
        .into_iter()
        .map(|(time, reason, id)| BackupInfo { projects: read_projects(&r.join(&id)), id, time, reason })
        .collect())
}

#[tauri::command]
pub async fn backup_now(app: AppHandle) -> Res<Option<String>> {
    snapshot(&app, "manual")
}

fn backup_dir(app: &AppHandle, bid: &str) -> Res<PathBuf> {
    if parse_id(bid).is_none() || bid.contains(['/', '\\', '.']) {
        return Err("плохой id бэкапа".into());
    }
    Ok(root(app)?.join(bid))
}

/// Одно полотно из бэкапа (JSON) — чтобы вернуть его копией.
#[tauri::command]
pub async fn backup_project(app: AppHandle, bid: String, pid: String) -> Res<String> {
    if !safe_id(&pid) {
        return Err("плохой id полотна".into());
    }
    fs::read_to_string(backup_dir(&app, &bid)?.join("projects").join(format!("{pid}.json"))).map_err(err)
}

/// Откатить всю рабочую область к бэкапу. Перед этим снимаем текущее состояние,
/// так что откат тоже можно откатить.
#[tauri::command]
pub async fn backup_restore(app: AppHandle, bid: String) -> Res<()> {
    let src = backup_dir(&app, &bid)?;
    if !src.join("index.json").exists() {
        return Err("бэкап пустой".into());
    }
    snapshot(&app, "before-restore")?;
    let dir = data_dir(&app)?;
    let projects = dir.join("projects");
    if let Ok(rd) = fs::read_dir(&projects) {
        for e in rd.flatten() {
            let _ = fs::remove_file(e.path());
        }
    }
    fs::create_dir_all(&projects).map_err(err)?;
    for e in fs::read_dir(src.join("projects")).map_err(err)?.flatten() {
        fs::copy(e.path(), projects.join(e.file_name())).map_err(err)?;
    }
    write_atomic(&dir.join("index.json"), &fs::read(src.join("index.json")).map_err(err)?)?;
    let _ = app.emit("workspace-restored", ());
    Ok(())
}
