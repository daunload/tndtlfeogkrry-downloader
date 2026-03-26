use std::time::SystemTime;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::config::DOWNLOAD_TIMEOUT_SECS;
use crate::lms::extract_media_url;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Event payload
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressData {
    pub content_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percent: u32,
    pub status: Option<String>,
    pub batch_completed: Option<u32>,
    pub batch_total: Option<u32>,
}

// ---------------------------------------------------------------------------
// download_file — stream download with progress events
// ---------------------------------------------------------------------------

/// Downloads a file via HTTPS with streaming progress events.
///
/// `progress_multiplier` controls the percent range: 100 for mp4 (full bar),
/// 90 for m4a (remaining 10% is AAC extraction).
pub async fn download_file(
    client: &reqwest::Client,
    url: &str,
    save_path: &str,
    content_id: &str,
    app: &AppHandle,
    progress_multiplier: u32,
) -> Result<(), String> {
    let timeout = std::time::Duration::from_secs(DOWNLOAD_TIMEOUT_SECS);

    let resp = client
        .get(url)
        .header("Referer", "https://commons.ssu.ac.kr/")
        .header("Origin", "https://commons.ssu.ac.kr")
        .timeout(timeout)
        .send()
        .await
        .map_err(|e| format!("다운로드 요청 실패: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();

    let mut file = tokio::fs::File::create(save_path)
        .await
        .map_err(|e| format!("파일 생성 실패: {}", e))?;

    let mut downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("스트림 읽기 실패: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("파일 쓰기 실패: {}", e))?;

        downloaded += chunk.len() as u64;

        let percent = if total > 0 {
            ((downloaded as f64 / total as f64) * progress_multiplier as f64) as u32
        } else {
            0
        };

        let _ = app.emit(
            "download-progress",
            DownloadProgressData {
                content_id: content_id.to_string(),
                downloaded,
                total,
                percent,
                status: None,
                batch_completed: None,
                batch_total: None,
            },
        );
    }

    file.flush()
        .await
        .map_err(|e| format!("파일 플러시 실패: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// download_one — full download pipeline for a single video
// ---------------------------------------------------------------------------

/// Downloads a single video by content ID.
///
/// 1. Fetches XML from `content.php` to resolve the media URL.
/// 2. Downloads the file (MP4 or M4A).
/// 3. For M4A: extracts AAC from the downloaded MP4 container.
///
/// Returns the final file path on success.
pub async fn download_one(
    state: &AppState,
    app: &AppHandle,
    content_id: &str,
    save_path: &str,
    format: &str, // "mp4" or "m4a"
) -> Result<String, String> {
    let cookies = state.get_cookies().await;
    if cookies.is_empty() {
        return Err("로그인이 필요합니다.".into());
    }

    // Fetch content XML
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let xml_url = format!(
        "https://commons.ssu.ac.kr/em/content.php?content_id={}&_={}",
        content_id, timestamp
    );

    let xml_resp = state
        .http_client
        .get(&xml_url)
        .header("Cookie", &cookies)
        .send()
        .await
        .map_err(|e| format!("XML 요청 실패: {}", e))?;

    let xml_text = xml_resp
        .text()
        .await
        .map_err(|e| format!("XML 읽기 실패: {}", e))?;

    let media_url =
        extract_media_url(&xml_text).ok_or("미디어 URL을 찾을 수 없습니다".to_string())?;

    if format == "m4a" {
        // Download to temporary MP4
        let tmp_path = format!("{}.tmp.mp4", save_path);

        download_file(
            &state.http_client,
            &media_url,
            &tmp_path,
            content_id,
            app,
            90,
        )
        .await?;

        // Emit extracting status
        let _ = app.emit(
            "download-progress",
            DownloadProgressData {
                content_id: content_id.to_string(),
                downloaded: 0,
                total: 0,
                percent: 92,
                status: Some("extracting".to_string()),
                batch_completed: None,
                batch_total: None,
            },
        );

        // Extract AAC (blocking I/O via symphonia)
        let tmp_clone = tmp_path.clone();
        let m4a_path = save_path.to_string();
        let m4a_clone = m4a_path.clone();

        tokio::task::spawn_blocking(move || crate::media::extract_aac(&tmp_clone, &m4a_clone))
            .await
            .map_err(|e| format!("AAC 추출 태스크 실패: {}", e))??;

        // Clean up tmp file
        let _ = tokio::fs::remove_file(&tmp_path).await;

        // Emit done
        let _ = app.emit(
            "download-progress",
            DownloadProgressData {
                content_id: content_id.to_string(),
                downloaded: 0,
                total: 0,
                percent: 100,
                status: Some("done".to_string()),
                batch_completed: None,
                batch_total: None,
            },
        );

        Ok(m4a_path)
    } else {
        // MP4 — download directly
        download_file(
            &state.http_client,
            &media_url,
            save_path,
            content_id,
            app,
            100,
        )
        .await?;

        // Emit done
        let _ = app.emit(
            "download-progress",
            DownloadProgressData {
                content_id: content_id.to_string(),
                downloaded: 0,
                total: 0,
                percent: 100,
                status: Some("done".to_string()),
                batch_completed: None,
                batch_total: None,
            },
        );

        Ok(save_path.to_string())
    }
}
