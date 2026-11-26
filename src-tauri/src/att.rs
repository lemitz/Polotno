//! Вложения: картинки, видео, аудио, PDF и прочие файлы лежат отдельными файлами в `attachments/`,
//! а в карточке хранится только ссылка `att:<имя файла>`. Файл `.polotno` — zip с рабочей областью
//! и нужными вложениями внутри; старый `.polotno`/`.json` (просто JSON) тоже читается.

use crate::util::{att_refs, data_dir, err, rand_id, safe_file, sub_dir, write_atomic, Res};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    io::{Read, Seek, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use tauri::{ipc::InvokeBody, AppHandle};

#[derive(Serialize)]
pub struct AttInfo {
    pub file: String,
    pub name: String,
    pub size: u64,
    pub mime: String,
}

pub fn ext_of(name: &str) -> String {
    let e: String = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    if e.is_empty() { "bin".into() } else { e }
}

pub fn mime_of(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" | "jfif" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "flac" => "audio/flac",
        "m4a" | "aac" => "audio/aac",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

pub fn dir(app: &AppHandle) -> Res<PathBuf> {
    sub_dir(app, "attachments")
}

pub fn path_of(app: &AppHandle, file: &str) -> Res<PathBuf> {
    if !safe_file(file) {
        return Err(format!("плохое имя вложения: {file}"));
    }
    Ok(dir(app)?.join(file))
}

/// Сохраняет байты как новое вложение.
pub fn store_bytes(app: &AppHandle, name: &str, bytes: &[u8]) -> Res<AttInfo> {
    let ext = ext_of(name);
    let file = format!("{}.{ext}", rand_id());
    write_atomic(&dir(app)?.join(&file), bytes)?;
    Ok(AttInfo { file, name: name.to_string(), size: bytes.len() as u64, mime: mime_of(&ext).into() })
}

#[tauri::command]
pub fn att_dir(app: AppHandle) -> Res<String> {
    Ok(dir(&app)?.to_string_lossy().into_owned())
}

/// Копирует файлы с диска (перетащили из проводника) во вложения.
#[tauri::command]
pub async fn att_import(app: AppHandle, paths: Vec<String>) -> Res<Vec<AttInfo>> {
    tauri::async_runtime::spawn_blocking(move || {
        let d = dir(&app)?;
        let mut out = Vec::new();
        for p in paths {
            let src = PathBuf::from(&p);
            let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
            let ext = ext_of(&name);
            let file = format!("{}.{ext}", rand_id());
            let size = fs::copy(&src, d.join(&file)).map_err(|e| format!("{name}: {e}"))?;
            out.push(AttInfo { file, name, size, mime: mime_of(&ext).into() });
        }
        Ok(out)
    })
    .await
    .map_err(err)?
}

/// Байты из фронта (вставка картинки из буфера, перенос data: URL).
/// Тело: 4 байта длины имени (little-endian), имя файла в UTF-8, затем содержимое.
#[tauri::command]
pub async fn att_save(app: AppHandle, request: tauri::ipc::Request<'_>) -> Res<AttInfo> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("ждал байты".into());
    };
    if body.len() < 4 {
        return Err("пустой запрос".into());
    }
    let n = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
    if 4 + n > body.len() || n > 1024 {
        return Err("битое имя файла".into());
    }
    let name = String::from_utf8_lossy(&body[4..4 + n]).into_owned();
    store_bytes(&app, if name.is_empty() { "file.bin" } else { &name }, &body[4 + n..])
}

/// Вложение как data: URL (экспорт в JSON для сайта, встраивание в SVG).
#[tauri::command]
pub async fn att_read_b64(app: AppHandle, file: String) -> Res<String> {
    use base64::Engine;
    let p = path_of(&app, &file)?;
    let bytes = fs::read(&p).map_err(err)?;
    Ok(format!("data:{};base64,{}", mime_of(&ext_of(&file)), base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Сохранить копию вложения туда, куда выбрал пользователь.
#[tauri::command]
pub async fn att_export(app: AppHandle, file: String, path: String) -> Res<()> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::copy(path_of(&app, &file)?, path).map(|_| ()).map_err(err)
}

/// Открыть вложение программой по умолчанию (PDF-читалка, плеер).
#[tauri::command]
pub async fn att_open(app: AppHandle, file: String) -> Res<()> {
    let p = path_of(&app, &file)?;
    tauri_plugin_opener::open_path(p, None::<&str>).map_err(err)
}

/// Сохранить рабочую область в `.polotno` (zip: workspace.json + attachments/…).
#[tauri::command]
pub async fn polotno_export(app: AppHandle, path: String, data: String) -> Res<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut refs = HashSet::new();
        att_refs(&data, &mut refs);
        let mut tmp = PathBuf::from(&path).into_os_string();
        tmp.push(".tmp");
        let tmp = PathBuf::from(tmp);
        {
            let f = fs::File::create(&tmp).map_err(err)?;
            let mut z = zip::ZipWriter::new(f);
            let deflate = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            let stored = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored)
                .large_file(true);
            z.start_file("workspace.json", deflate).map_err(err)?;
            z.write_all(data.as_bytes()).map_err(err)?;
            for file in refs {
                let Ok(p) = path_of(&app, &file) else { continue };
                let Ok(mut src) = fs::File::open(&p) else { continue };
                // медиа уже сжато, жать второй раз смысла нет
                z.start_file(format!("attachments/{file}"), stored).map_err(err)?;
                std::io::copy(&mut src, &mut z).map_err(err)?;
            }
            z.finish().map_err(err)?;
        }
        fs::rename(&tmp, &path).map_err(err)
    })
    .await
    .map_err(err)?
}

fn import_zip<R: Read + Seek>(mut z: zip::ZipArchive<R>, d: &Path) -> Res<String> {
    let mut json = None;
    for i in 0..z.len() {
        let mut e = z.by_index(i).map_err(err)?;
        let name = e.name().map_err(err)?.to_string();
        if name == "workspace.json" {
            let mut s = String::new();
            e.read_to_string(&mut s).map_err(err)?;
            json = Some(s);
        } else if let Some(file) = name.strip_prefix("attachments/") {
            // имена случайные, совпадение значит тот же файл
            if safe_file(file) && !d.join(file).exists() {
                let mut out = fs::File::create(d.join(file)).map_err(err)?;
                std::io::copy(&mut e, &mut out).map_err(err)?;
            }
        }
    }
    json.ok_or_else(|| "в архиве нет workspace.json".to_string())
}

fn import_path(path: &Path, attachments_dir: impl FnOnce() -> Res<PathBuf>) -> Res<String> {
    let mut f = fs::File::open(path).map_err(err)?;
    let mut head = [0u8; 2];
    let n = f.read(&mut head).map_err(err)?;
    if n < 2 || &head != b"PK" {
        return fs::read_to_string(path).map_err(err);
    }
    let z = zip::ZipArchive::new(fs::File::open(path).map_err(err)?).map_err(err)?;
    import_zip(z, &attachments_dir()?)
}

/// Прочитать `.polotno` (zip или старый JSON) или `.json`. Вложения из zip раскладываются по месту.
#[tauri::command]
pub async fn polotno_import(app: AppHandle, path: String) -> Res<String> {
    tauri::async_runtime::spawn_blocking(move || import_path(Path::new(&path), || dir(&app)))
        .await
        .map_err(err)?
}

/// Убирает вложения, на которые больше никто не ссылается: ни полотна, ни бэкапы.
/// Свежие (моложе суток) не трогаем: их могли добавить, но ещё не сохранить.
pub fn gc(app: &AppHandle) -> Res<usize> {
    let root = data_dir(app)?;
    let mut refs = HashSet::new();
    let mut stack = vec![root.join("projects"), root.join("backups")];
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().is_some_and(|x| x == "json") {
                if let Ok(t) = fs::read_to_string(&p) {
                    att_refs(&t, &mut refs);
                }
            }
        }
    }
    let mut removed = 0;
    let old = SystemTime::now() - Duration::from_secs(24 * 3600);
    for e in fs::read_dir(dir(app)?).map_err(err)?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let fresh = e.metadata().and_then(|m| m.modified()).map(|t| t > old).unwrap_or(true);
        if !fresh && !refs.contains(&name) && fs::remove_file(e.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::{import_path, import_zip};
    use std::{
        fs,
        io::{Cursor, Write},
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };
    use zip::{write::SimpleFileOptions, ZipWriter};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
            let path = std::env::temp_dir().join(format!("polotno-att-import-{}-{unique}", std::process::id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, contents) in entries {
            writer.start_file(*name, SimpleFileOptions::default()).unwrap();
            writer.write_all(contents).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn imports_legacy_json_unchanged() {
        let temp = TempDir::new();
        let path = temp.0.join("legacy.polotno");
        let json = "{\n  \"name\": \"legacy workspace\"\n}\n";
        fs::write(&path, json).unwrap();

        let imported = import_path(&path, || Err("unexpected attachment directory request".into())).unwrap();

        assert_eq!(imported, json);
    }

    #[test]
    fn rejects_malformed_zip_and_non_utf8_legacy_json() {
        let temp = TempDir::new();
        let malformed_zip = temp.0.join("malformed.polotno");
        fs::write(&malformed_zip, b"PKnot a zip").unwrap();
        assert!(import_path(&malformed_zip, || Ok(temp.0.clone())).is_err());

        let non_utf8_json = temp.0.join("non-utf8.json");
        fs::write(&non_utf8_json, b"{\xff}").unwrap();
        assert!(import_path(&non_utf8_json, || Err("unexpected attachment directory request".into())).is_err());
    }

    #[test]
    fn imports_workspace_and_flat_attachment_entries() {
        let temp = TempDir::new();
        let destination = temp.0.join("attachments");
        fs::create_dir(&destination).unwrap();
        let bytes = archive(&[
            ("workspace.json", br#"{"name":"test"}"#),
            ("attachments/image-1.png", b"image bytes"),
        ]);
        let zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();

        let workspace = import_zip(zip, &destination).unwrap();

        assert_eq!(workspace, r#"{"name":"test"}"#);
        assert_eq!(fs::read(destination.join("image-1.png")).unwrap(), b"image bytes");
    }

    #[test]
    fn rejects_traversal_and_nested_attachment_names() {
        let temp = TempDir::new();
        let destination = temp.0.join("attachments");
        fs::create_dir(&destination).unwrap();
        let bytes = archive(&[
            ("workspace.json", b"{}"),
            ("attachments/../escaped.txt", b"traversal"),
            ("attachments/nested/file.txt", b"nested"),
        ]);
        let zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();

        assert_eq!(import_zip(zip, &destination).unwrap(), "{}");
        assert!(!temp.0.join("escaped.txt").exists());
        assert!(!temp.0.join("nested").exists());
        assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);
    }
}
