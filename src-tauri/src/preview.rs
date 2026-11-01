//! Превью ссылок: заголовок, описание и картинка страницы (Open Graph, Twitter Cards, <title>).
//! Страницу качает Rust, поэтому CORS не мешает. Картинка сохраняется во вложения и работает без сети.

use crate::att::store_bytes;
use crate::util::{err, Res};
use serde::Serialize;
use std::time::Duration;
use tauri::AppHandle;

const MAX_HTML: usize = 1024 * 1024;
const MAX_IMAGE: usize = 6 * 1024 * 1024;
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Polotno";

#[derive(Serialize, Default)]
pub struct Preview {
    url: String,
    title: String,
    description: String,
    site: String,
    image: Option<String>,
}

fn client() -> Res<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(6))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(err)
}

async fn get_limited(c: &reqwest::Client, url: &str, max: usize) -> Res<(reqwest::Url, String, Vec<u8>)> {
    let mut r = c.get(url).header("Accept-Language", "ru,en;q=0.8").send().await.map_err(err)?;
    if !r.status().is_success() {
        return Err(format!("HTTP {}", r.status().as_u16()));
    }
    let final_url = r.url().clone();
    let ct = r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
    let mut buf = Vec::new();
    while let Some(chunk) = r.chunk().await.map_err(err)? {
        buf.extend_from_slice(&chunk);
        if buf.len() >= max {
            buf.truncate(max);
            break;
        }
    }
    Ok((final_url, ct, buf))
}

fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(p) = rest.find('&') {
        out.push_str(&rest[..p]);
        rest = &rest[p..];
        // ';' — ASCII, так что найденная позиция всегда на границе символа (кириллица не режется)
        let end = rest.as_bytes().iter().take(12).position(|&b| b == b';');
        let Some(e) = end else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let ent = &rest[1..e];
        let ch = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" => Some(' '),
            "mdash" => Some('—'),
            "ndash" => Some('–'),
            "laquo" => Some('«'),
            "raquo" => Some('»'),
            "hellip" => Some('…'),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[e + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Атрибуты тега: `<meta property="og:title" content="...">`.
fn attrs(tag: &str) -> Vec<(String, String)> {
    let b = tag.as_bytes();
    let mut i = 0;
    let mut out = Vec::new();
    while i < b.len() {
        while i < b.len() && !(b[i].is_ascii_alphabetic()) {
            i += 1;
        }
        let ks = i;
        while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'-' || b[i] == b':' || b[i] == b'_') {
            i += 1;
        }
        let key = tag[ks..i].to_ascii_lowercase();
        while i < b.len() && b[i] == b' ' {
            i += 1;
        }
        if i < b.len() && b[i] == b'=' {
            i += 1;
            while i < b.len() && b[i] == b' ' {
                i += 1;
            }
            let (vs, ve);
            if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
                let q = b[i];
                vs = i + 1;
                i = vs;
                while i < b.len() && b[i] != q {
                    i += 1;
                }
                ve = i;
                i += 1;
            } else {
                vs = i;
                while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'>' {
                    i += 1;
                }
                ve = i;
            }
            out.push((key, tag[vs..ve.min(tag.len())].to_string()));
        } else if key.is_empty() {
            i += 1;
        }
    }
    out
}

fn parse(html: &str) -> (String, String, String, String) {
    let lower = html.to_ascii_lowercase();
    let (mut title, mut desc, mut site, mut image) = (String::new(), String::new(), String::new(), String::new());
    let mut doc_title = String::new();
    if let Some(s) = lower.find("<title") {
        if let Some(gt) = lower[s..].find('>') {
            let from = s + gt + 1;
            if let Some(e) = lower[from..].find("</title") {
                doc_title = decode_entities(&html[from..from + e]);
            }
        }
    }
    let mut i = 0;
    while let Some(p) = lower[i..].find("<meta") {
        let s = i + p;
        let Some(e) = lower[s..].find('>') else { break };
        let a = attrs(&html[s + 5..s + e]);
        let get = |k: &str| a.iter().find(|(x, _)| x == k).map(|(_, v)| v.clone());
        let key = get("property").or_else(|| get("name")).unwrap_or_default().to_ascii_lowercase();
        if let Some(v) = get("content") {
            let v = decode_entities(&v);
            match key.as_str() {
                "og:title" | "twitter:title" if title.is_empty() => title = v,
                "og:description" | "twitter:description" | "description" if desc.is_empty() => desc = v,
                "og:site_name" if site.is_empty() => site = v,
                "og:image" | "og:image:url" | "og:image:secure_url" | "twitter:image" | "twitter:image:src" if image.is_empty() => image = v,
                _ => {}
            }
        }
        i = s + e;
    }
    if title.is_empty() {
        title = doc_title;
    }
    (title, desc, site, image)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_meta() {
        let html = r#"<html><head><title>Doc &amp; title</title><meta charset="utf-8"><meta property="og:title" content="OG title" /><meta name="description" content="Описание &laquo;тут&raquo;"><meta property="og:image" content="https://x.test/a.png" /></head></html>"#;
        let (t, d, _s, i) = parse(html);
        assert_eq!(t, "OG title");
        assert_eq!(d, "Описание «тут»");
        assert_eq!(i, "https://x.test/a.png");
    }
    #[test]
    fn fetches_image() {
        if std::env::var("PREVIEW_NET").is_err() { return }
        let _ = rustls::crypto::ring::default_provider().install_default();
        let r = tauri::async_runtime::block_on(async {
            let c = client()?;
            get_limited(&c, "https://opengraph.githubassets.com/30a2d838a157320094b88c3d22294ee4cb8f022374ecdd127d8d37870a2ac473/lemitz/Polotno", MAX_IMAGE).await
        });
        match r { Ok((u, ct, b)) => println!("ok {u} {ct} {}", b.len()), Err(e) => panic!("{e}") }
    }
    #[test]
    fn parses_saved_page() {
        let Ok(html) = std::fs::read_to_string(std::env::var("PREVIEW_HTML").unwrap_or_default()) else { return };
        let (t, d, s, i) = parse(&html);
        println!("title={t}\ndesc={d}\nsite={s}\nimage={i}");
        assert!(!i.is_empty());
    }
}

#[tauri::command]
pub async fn link_preview(app: AppHandle, url: String) -> Res<Preview> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("нужна ссылка http(s)".into());
    }
    let c = client()?;
    let (final_url, ct, body) = get_limited(&c, &url, MAX_HTML).await?;
    let host = final_url.host_str().unwrap_or("").trim_start_matches("www.").to_string();
    let mut p = Preview { url: url.clone(), site: host.clone(), ..Default::default() };
    if ct.starts_with("image/") {
        let ext = ct.trim_start_matches("image/").split(';').next().unwrap_or("png").replace("jpeg", "jpg");
        p.image = store_bytes(&app, &format!("preview.{ext}"), &body).ok().map(|a| a.file);
        p.title = final_url.path_segments().and_then(|s| s.last().map(String::from)).unwrap_or(host);
        return Ok(p);
    }
    let html = String::from_utf8_lossy(&body);
    let (title, desc, site, image) = parse(&html);
    p.title = title;
    p.description = desc.chars().take(400).collect();
    if !site.is_empty() {
        p.site = site;
    }
    if !image.is_empty() {
        if let Ok(img_url) = final_url.join(&image) {
            if let Ok((u, ict, bytes)) = get_limited(&c, img_url.as_str(), MAX_IMAGE).await {
                if ict.starts_with("image/") && bytes.len() < MAX_IMAGE {
                    let ext = ict.trim_start_matches("image/").split(';').next().unwrap_or("png").replace("jpeg", "jpg").replace("svg+xml", "svg");
                    let _ = u;
                    p.image = store_bytes(&app, &format!("preview.{ext}"), &bytes).ok().map(|a| a.file);
                }
            }
        }
    }
    Ok(p)
}
