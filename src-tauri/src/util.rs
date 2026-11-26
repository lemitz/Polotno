//! Общие мелочи: пути, атомарная запись, идентификаторы.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

pub type Res<T> = Result<T, String>;

pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// `%APPDATA%\by.kobyla.polotno`
pub fn data_dir(app: &AppHandle) -> Res<PathBuf> {
    let d = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(&d).map_err(err)?;
    Ok(d)
}

pub fn sub_dir(app: &AppHandle, name: &str) -> Res<PathBuf> {
    let d = data_dir(app)?.join(name);
    fs::create_dir_all(&d).map_err(err)?;
    Ok(d)
}

static WRITE: Mutex<()> = Mutex::new(());

/// Запись через временный файл: сбой посреди записи не оставляет битый файл.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Res<()> {
    let _g = WRITE.lock().map_err(err)?;
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    if let Err(e) = fs::write(&tmp, bytes) {
        let _ = fs::remove_file(&tmp);
        return Err(err(e));
    }
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(err(e));
    }
    Ok(())
}

/// Идентификатор полотна годится в имя файла.
pub fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Имя файла вложения: без путей и странных символов.
pub fn safe_file(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 96
        && !name.starts_with('.')
        && !name.contains("..")
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

static SEQ: AtomicU64 = AtomicU64::new(0);

/// Короткий уникальный идентификатор (время + счётчик + перемешивание).
pub fn rand_id() -> String {
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0);
    let mut x = t ^ n.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ (std::process::id() as u64).rotate_left(32);
    // splitmix64
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^= x >> 31;
    format!("{:x}{:04x}", t / 1_000_000, x & 0xffff_ffff_ffff)
}

/// Все ссылки на вложения (`att:имя`) в тексте JSON.
pub fn att_refs(text: &str, out: &mut std::collections::HashSet<String>) {
    let b = text.as_bytes();
    let mut i = 0;
    while let Some(p) = text[i..].find("att:") {
        let s = i + p + 4;
        let mut e = s;
        while e < b.len() && (b[e].is_ascii_alphanumeric() || b[e] == b'.' || b[e] == b'-' || b[e] == b'_') {
            e += 1;
        }
        if e > s {
            out.insert(text[s..e].trim_end_matches('.').to_string());
        }
        i = e.max(s);
    }
}

#[cfg(test)]
mod tests {
    use super::{rand_id, write_atomic};
    use std::{fs, path::PathBuf};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "polotno-util-test-{}-{}",
                std::process::id(),
                rand_id()
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

    #[test]
    fn write_atomic_replaces_existing_file() {
        let dir = TempDir::new();
        let target = dir.0.join("target.json");
        fs::write(&target, b"old contents").unwrap();

        write_atomic(&target, b"new contents").unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"new contents");
        assert!(!dir.0.join("target.json.tmp").exists());
    }

    #[test]
    fn write_atomic_failure_preserves_existing_file() {
        let dir = TempDir::new();
        let target = dir.0.join("target.json");
        fs::write(&target, b"keep me").unwrap();
        fs::create_dir(dir.0.join("target.json.tmp")).unwrap();

        assert!(write_atomic(&target, b"replacement").is_err());

        assert_eq!(fs::read(&target).unwrap(), b"keep me");
    }

    #[test]
    fn write_atomic_rename_failure_cleans_temporary_file() {
        let dir = TempDir::new();
        let target = dir.0.join("target.json");
        fs::create_dir(&target).unwrap();
        let marker = target.join("keep.txt");
        fs::write(&marker, b"keep me").unwrap();

        assert!(write_atomic(&target, b"replacement").is_err());

        assert_eq!(fs::read(&marker).unwrap(), b"keep me");
        assert_eq!(fs::read_dir(&target).unwrap().count(), 1);
        assert!(!dir.0.join("target.json.tmp").exists());
    }
}
