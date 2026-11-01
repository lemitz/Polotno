//! Превью PDF: первая страница в PNG и число страниц. Рендерит сама Windows (`Windows.Data.Pdf`),
//! так что отдельный PDF-движок в приложение не тащим.

use crate::att::{path_of, store_bytes};
use crate::util::{err, Res};
use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
pub struct PdfInfo {
    thumb: String,
    pages: u32,
}

#[cfg(windows)]
fn render(path: &std::path::Path, width: u32) -> windows::core::Result<(Vec<u8>, u32)> {
    use windows::{
        core::HSTRING,
        Data::Pdf::{PdfDocument, PdfPageRenderOptions},
        Storage::{
            StorageFile,
            Streams::{DataReader, InMemoryRandomAccessStream},
        },
        Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
    };
    // поток из пула tokio: WinRT на нём ещё не инициализирован (ошибку «уже инициализирован» игнорируем)
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))?.join()?;
    let doc = PdfDocument::LoadFromFileAsync(&file)?.join()?;
    let pages = doc.PageCount()?;
    let page = doc.GetPage(0)?;
    let opts = PdfPageRenderOptions::new()?;
    opts.SetDestinationWidth(width)?;
    let stream = InMemoryRandomAccessStream::new()?;
    page.RenderWithOptionsToStreamAsync(&stream, &opts)?.join()?;
    let size = stream.Size()? as u32;
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
    reader.LoadAsync(size)?.join()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf)?;
    Ok((buf, pages))
}

#[tauri::command]
pub async fn pdf_info(app: AppHandle, file: String) -> Res<PdfInfo> {
    let path = path_of(&app, &file)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            let (png, pages) = render(&path, 900).map_err(|e| format!("PDF не открылся: {e}"))?;
            let a = store_bytes(&app, "page1.png", &png)?;
            Ok(PdfInfo { thumb: a.file, pages })
        }
        #[cfg(not(windows))]
        {
            let _ = (path, app);
            Err::<PdfInfo, String>("превью PDF есть только в Windows".into())
        }
    })
    .await
    .map_err(err)?
}
