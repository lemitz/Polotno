//! Превью ссылок: заголовок, описание и картинка страницы (Open Graph, Twitter Cards, <title>).
//! Страницу качает Rust, поэтому CORS не мешает. Картинка сохраняется во вложения и работает без сети.

use crate::att::store_bytes;
use crate::util::{err, Res};
use serde::Serialize;
use std::{
    net::{IpAddr, SocketAddr},
    time::Duration,
};
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

const MAX_REDIRECTS: usize = 8;

fn parse_http_url(raw: &str) -> Res<reqwest::Url> {
    if raw.len() > 4096 {
        return Err("URL is too long".into());
    }
    let mut url = reqwest::Url::parse(raw).map_err(err)?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err("Only credential-free HTTP(S) URLs are allowed".into());
    }
    url.set_fragment(None);
    Ok(url)
}

fn redirect_target(base: &reqwest::Url, location: &str) -> Res<reqwest::Url> {
    let target = base.join(location).map_err(err)?;
    parse_http_url(target.as_str())
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_broadcast()
                || ip.is_multicast()
                || a == 0
                || (a == 100 && (64..=127).contains(&b)) // shared address space
                || (a == 192 && b == 0) // IETF protocol assignments
                || (a == 192 && b == 0 && c == 2) // documentation
                || (a == 192 && b == 88 && c == 99) // deprecated 6to4 relay
                || (a == 192 && b == 168)
                || (a == 198 && (b == 18 || b == 19)) // benchmarking
                || (a == 198 && b == 51 && c == 100) // documentation
                || (a == 203 && b == 0 && c == 113) // documentation
                || a >= 224)
        }
        IpAddr::V6(ip) => {
            let s = ip.segments();
            // Only global unicast is considered. Exclude special-purpose 2001::/23,
            // documentation, and 6to4 (which can tunnel to an otherwise blocked IPv4).
            (s[0] & 0xe000) == 0x2000
                && !(s[0] == 0x2001 && s[1] <= 0x01ff)
                && !(s[0] == 0x2001 && s[1] == 0x0db8)
                && !(s[0] == 0x3fff && (s[1] & 0xfff0) == 0) // documentation (RFC 9637)
                && s[0] != 0x2002
                && !ip.is_unspecified()
                && !ip.is_loopback()
                && !ip.is_unique_local()
                && !ip.is_unicast_link_local()
                && !ip.is_multicast()
                && ip.to_ipv4().is_none()
        }
    }
}

async fn public_addresses(url: &reqwest::Url) -> Res<Vec<SocketAddr>> {
    let host = url.host_str().ok_or_else(|| "URL has no host".to_string())?;
    let port = url.port_or_known_default().ok_or_else(|| "URL has no port".to_string())?;
    let ips = if let Ok(ip) = host.parse::<IpAddr>() {
        vec![ip]
    } else {
        tokio::net::lookup_host((host, port)).await.map_err(err)?.map(|addr| addr.ip()).collect()
    };
    if ips.is_empty() || ips.iter().any(|ip| !is_public_ip(*ip)) {
        return Err("URL resolves to a non-public address".into());
    }
    Ok(ips.into_iter().map(|ip| SocketAddr::new(ip, port)).collect())
}

fn client(url: &reqwest::Url, addrs: &[SocketAddr]) -> Res<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(6))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy();
    if url.host_str().and_then(|host| host.parse::<IpAddr>().ok()).is_none() {
        builder = builder.resolve_to_addrs(url.host_str().unwrap_or_default(), addrs);
    }
    builder.build().map_err(err)
}

async fn get_limited(raw_url: &str, max: usize) -> Res<(reqwest::Url, String, Vec<u8>)> {
    let mut url = parse_http_url(raw_url)?;
    for redirects in 0..=MAX_REDIRECTS {
        // Validate and pin DNS results for every hop. Redirects are handled manually so
        // a server cannot redirect the request into localhost or another private network.
        let addrs = public_addresses(&url).await?;
        let c = client(&url, &addrs)?;
        let mut response = c.get(url.clone()).header("Accept-Language", "ru,en;q=0.8").send().await.map_err(err)?;
        if response.status().is_redirection() {
            if redirects == MAX_REDIRECTS {
                return Err("Too many redirects".into());
            }
            let location = response.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).ok_or_else(|| "Redirect has no valid Location".to_string())?;
            url = redirect_target(&url, location)?;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status().as_u16()));
        }
        let content_type = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(err)? {
            if body.len().saturating_add(chunk.len()) > max {
                return Err("Response is too large".into());
            }
            body.extend_from_slice(&chunk);
        }
        return Ok((url, content_type, body));
    }
    Err("Too many redirects".into())
}

fn raster_extension(content_type: &str, body: &[u8]) -> Option<&'static str> {
    let mime = content_type.split(';').next()?.trim();
    let (extension, valid) = match mime {
        "image/png" => ("png", body.starts_with(b"\x89PNG\r\n\x1a\n")),
        "image/jpeg" => ("jpg", body.starts_with(b"\xff\xd8\xff")),
        "image/gif" => ("gif", body.starts_with(b"GIF87a") || body.starts_with(b"GIF89a")),
        "image/webp" => ("webp", body.len() >= 12 && &body[..4] == b"RIFF" && &body[8..12] == b"WEBP"),
        "image/avif" => ("avif", body.len() >= 12 && &body[4..8] == b"ftyp" && (&body[8..12] == b"avif" || &body[8..12] == b"avis")),
        _ => return None, // SVG and other unsupported image types are deliberately not persisted.
    };
    (valid && !body.is_empty()).then_some(extension)
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
            get_limited("https://opengraph.githubassets.com/30a2d838a157320094b88c3d22294ee4cb8f022374ecdd127d8d37870a2ac473/lemitz/Polotno", MAX_IMAGE).await
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

    #[test]
    fn rejects_unsafe_urls_and_addresses() {
        assert!(parse_http_url("file:///etc/passwd").is_err());
        assert!(parse_http_url("http://user:pass@example.com/").is_err());
        let base = parse_http_url("https://example.com/a").unwrap();
        assert_eq!(redirect_target(&base, "/next").unwrap().as_str(), "https://example.com/next");
        assert!(redirect_target(&base, "file:///etc/passwd").is_err());
        assert!(redirect_target(&base, "https://user@example.com/").is_err());
        let localhost = parse_http_url("http://localhost/").unwrap();
        assert!(tauri::async_runtime::block_on(public_addresses(&localhost)).is_err());
        let private_redirect = redirect_target(&base, "http://127.0.0.1/").unwrap();
        assert!(tauri::async_runtime::block_on(public_addresses(&private_redirect)).is_err());
        for ip in ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "100.64.0.1", "224.0.0.1", "192.0.2.1"] {
            assert!(!is_public_ip(ip.parse().unwrap()), "must reject {ip}");
        }
        for ip in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(is_public_ip(ip.parse().unwrap()), "must accept {ip}");
        }
        for ip in ["::1", "fc00::1", "fe80::1", "2001:db8::1", "2002:0808:0808::1", "3fff::1"] {
            assert!(!is_public_ip(ip.parse().unwrap()), "must reject {ip}");
        }
    }

    #[test]
    fn only_stores_verified_raster_images() {
        assert_eq!(raster_extension("image/png", b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(raster_extension("image/svg+xml", b"<svg></svg>"), None);
        assert_eq!(raster_extension("image/bmp", b"BM\x00\x00"), None);
        assert_eq!(raster_extension("image/png", b"<html>not an image</html>"), None);
    }
}

#[tauri::command]
pub async fn link_preview(app: AppHandle, url: String) -> Res<Preview> {
    let (final_url, ct, body) = get_limited(&url, MAX_HTML).await?;
    let host = final_url.host_str().unwrap_or("").trim_start_matches("www.").to_string();
    let mut p = Preview { url: url.clone(), site: host.clone(), ..Default::default() };
    if ct.starts_with("image/") {
        if let Some(ext) = raster_extension(&ct, &body) {
            p.image = store_bytes(&app, &format!("preview.{ext}"), &body).ok().map(|a| a.file);
        }
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
            if let Ok((_, ict, bytes)) = get_limited(img_url.as_str(), MAX_IMAGE).await {
                if let Some(ext) = raster_extension(&ict, &bytes) {
                    p.image = store_bytes(&app, &format!("preview.{ext}"), &bytes).ok().map(|a| a.file);
                }
            }
        }
    }
    Ok(p)
}
