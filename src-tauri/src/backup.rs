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

fn list_ids_at(root: &Path) -> Res<Vec<(u64, String, String)>> {
    let mut v: Vec<_> = fs::read_dir(root)
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

fn list_ids(app: &AppHandle) -> Res<Vec<(u64, String, String)>> {
    list_ids_at(&root(app)?)
}

pub fn snapshot(app: &AppHandle, reason: &str) -> Res<Option<String>> {
    let dir = data_dir(app)?;
    if !dir.join("index.json").exists() {
        return Ok(None);
    }
    let backup_root = root(app)?;
    snapshot_at(&dir, &backup_root, reason, now_ms())
}

fn snapshot_at(data_dir: &Path, backup_root: &Path, reason: &str, time: u64) -> Res<Option<String>> {
    let index = data_dir.join("index.json");
    if !index.exists() {
        return Ok(None);
    }
    let id = format!("b{time}-{reason}");
    let dst = backup_root.join(&id);
    fs::create_dir_all(dst.join("projects")).map_err(err)?;
    fs::copy(&index, dst.join("index.json")).map_err(err)?;
    if let Ok(rd) = fs::read_dir(data_dir.join("projects")) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "json") {
                fs::copy(&p, dst.join("projects").join(e.file_name())).map_err(err)?;
            }
        }
    }
    rotate_at(backup_root, now_ms())?;
    Ok(Some(id))
}

fn rotate_at(backup_root: &Path, now: u64) -> Res<()> {
    let ids = list_ids_at(backup_root)?;
    let mut days = HashSet::new();
    for (i, (t, _, id)) in ids.iter().enumerate() {
        let day = t / 86_400_000;
        let keep = i < KEEP_LAST || (now.saturating_sub(*t) < KEEP_DAYS * 86_400_000 && days.insert(day));
        if i < KEEP_LAST {
            days.insert(day);
        }
        if !keep {
            let _ = fs::remove_dir_all(backup_root.join(id));
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

fn validate_backup_id(bid: &str) -> Res<()> {
    if parse_id(bid).is_none() || bid.contains(['/', '\\', '.']) {
        return Err("плохой id бэкапа".into());
    }
    Ok(())
}

fn backup_dir_at(backup_root: &Path, bid: &str) -> Res<PathBuf> {
    validate_backup_id(bid)?;
    Ok(backup_root.join(bid))
}

fn backup_dir(app: &AppHandle, bid: &str) -> Res<PathBuf> {
    validate_backup_id(bid)?;
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
fn restore_at(data_dir: &Path, backup_root: &Path, bid: &str) -> Res<()> {
    let src = backup_dir_at(backup_root, bid)?;
    if !src.join("index.json").exists() {
        return Err("бэкап пустой".into());
    }
    snapshot_at(data_dir, backup_root, "before-restore", now_ms())?;
    let projects = data_dir.join("projects");
    if let Ok(rd) = fs::read_dir(&projects) {
        for e in rd.flatten() {
            let _ = fs::remove_file(e.path());
        }
    }
    fs::create_dir_all(&projects).map_err(err)?;
    for e in fs::read_dir(src.join("projects")).map_err(err)?.flatten() {
        fs::copy(e.path(), projects.join(e.file_name())).map_err(err)?;
    }
    write_atomic(&data_dir.join("index.json"), &fs::read(src.join("index.json")).map_err(err)?)?;
    Ok(())
}

#[tauri::command]
pub async fn backup_restore(app: AppHandle, bid: String) -> Res<()> {
    let src = backup_dir(&app, &bid)?;
    if !src.join("index.json").exists() {
        return Err("бэкап пустой".into());
    }
    let dir = data_dir(&app)?;
    let backup_root = root(&app)?;
    restore_at(&dir, &backup_root, &bid)?;
    let _ = app.emit("workspace-restored", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{backup_dir_at, list_ids_at, restore_at, rotate_at, KEEP_DAYS, KEEP_LAST};
    use crate::util::now_ms;
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
    };

    const DAY_MS: u64 = 86_400_000;
    static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "polotno-backup-test-{}-{}-{}",
                std::process::id(),
                now_ms(),
                TEMP_SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn make_backup(root: &Path, time: u64, reason: &str) -> String {
        let id = format!("b{time}-{reason}");
        let backup = root.join(&id);
        fs::create_dir_all(backup.join("projects")).unwrap();
        fs::write(backup.join("index.json"), "{}").unwrap();
        id
    }

    #[test]
    fn rotation_keeps_latest_40_and_one_snapshot_per_recent_day() {
        let temp = TempDir::new();
        let root = &temp.0;
        let now = 100 * DAY_MS + 12 * 60 * 60 * 1000;

        // The 40 newest snapshots are all from today; five earlier snapshots
        // from that same day should not gain an additional daily-retention slot.
        let mut todays = Vec::new();
        for n in 0..45u64 {
            todays.push(make_backup(root, 100 * DAY_MS + n * 1000, &format!("today-{n}")));
        }
        let mut by_day = Vec::new();
        for age in 1..=35u64 {
            let day = 100 - age;
            let older = make_backup(root, day * DAY_MS + 10_000, &format!("day-{age}-old"));
            let newest = make_backup(root, day * DAY_MS + 20_000, &format!("day-{age}-new"));
            by_day.push((age, older, newest));
        }

        rotate_at(root, now).unwrap();
        let retained: std::collections::HashSet<_> =
            list_ids_at(root).unwrap().into_iter().map(|(_, _, id)| id).collect();

        assert_eq!(retained.len(), KEEP_LAST + (KEEP_DAYS as usize - 1));
        for id in todays.iter().rev().take(KEEP_LAST) {
            assert!(retained.contains(id), "latest snapshot {id} was pruned");
        }
        for id in todays.iter().take(5) {
            assert!(!retained.contains(id), "older same-day snapshot {id} was retained");
        }
        for (age, older, newest) in by_day {
            if age < KEEP_DAYS {
                assert!(!retained.contains(&older), "older snapshot for day {age} should be pruned");
                assert!(retained.contains(&newest), "daily snapshot for day {age} should be retained");
            } else {
                assert!(!retained.contains(&older), "out-of-window snapshot for day {age} was retained");
                assert!(!retained.contains(&newest), "out-of-window snapshot for day {age} was retained");
            }
        }
    }

    #[test]
    fn restore_copies_backup_and_saves_a_usable_pre_restore_rollback() {
        let temp = TempDir::new();
        let data = temp.0.join("data");
        let backup_root = temp.0.join("backups");
        let current_projects = data.join("projects");
        fs::create_dir_all(&current_projects).unwrap();
        fs::create_dir_all(&backup_root).unwrap();

        let original_index = br#"{"projects":[{"id":"old"}],"version":"before"}"#;
        fs::write(data.join("index.json"), original_index).unwrap();
        fs::write(current_projects.join("old.json"), br#"{"cards":["old"]}"#).unwrap();
        fs::write(current_projects.join("stale.json"), br#"{"cards":[]}"#).unwrap();

        let target_id = make_backup(&backup_root, now_ms().saturating_sub(1_000), "manual");
        let target = backup_root.join(&target_id);
        let target_index = br#"{"projects":[{"id":"new"}],"version":"restored"}"#;
        fs::write(target.join("index.json"), target_index).unwrap();
        fs::write(target.join("projects").join("new.json"), br#"{"cards":[1,2]}"#).unwrap();

        restore_at(&data, &backup_root, &target_id).unwrap();

        assert_eq!(fs::read(data.join("index.json")).unwrap(), target_index);
        assert_eq!(fs::read(current_projects.join("new.json")).unwrap(), br#"{"cards":[1,2]}"#);
        assert!(!current_projects.join("old.json").exists());
        assert!(!current_projects.join("stale.json").exists());

        let rollback_id = list_ids_at(&backup_root)
            .unwrap()
            .into_iter()
            .find(|(_, reason, _)| reason == "before-restore")
            .map(|(_, _, id)| id)
            .expect("restore should preserve a before-restore snapshot");
        let rollback = backup_root.join(&rollback_id);
        assert_eq!(fs::read(rollback.join("index.json")).unwrap(), original_index);
        assert_eq!(fs::read(rollback.join("projects/old.json")).unwrap(), br#"{"cards":["old"]}"#);
        assert_eq!(fs::read(rollback.join("projects/stale.json")).unwrap(), br#"{"cards":[]}"#);

        restore_at(&data, &backup_root, &rollback_id).unwrap();
        assert_eq!(fs::read(data.join("index.json")).unwrap(), original_index);
        assert_eq!(fs::read(current_projects.join("old.json")).unwrap(), br#"{"cards":["old"]}"#);
        assert_eq!(fs::read(current_projects.join("stale.json")).unwrap(), br#"{"cards":[]}"#);
        assert!(!current_projects.join("new.json").exists());
    }

    #[test]
    fn backup_path_validation_rejects_malformed_and_traversal_ids() {
        let temp = TempDir::new();
        let root = &temp.0;

        assert_eq!(backup_dir_at(root, "b123-manual").unwrap(), root.join("b123-manual"));
        for invalid in ["", "backup", "b-no-time", "../b1-x", "b1-foo/bar", "b1-foo\\bar", "b1-.."] {
            assert!(backup_dir_at(root, invalid).is_err(), "accepted invalid backup id {invalid:?}");
        }
    }
}
