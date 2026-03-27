use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Semaphore;

use crate::config::{
    self, GeminiModelOption, MAX_CONCURRENT_DOWNLOADS, GEMINI_MAX_RETRIES,
};
use crate::download::{self, DownloadProgressData};
use crate::gemini;
use crate::history::{
    self, DownloadRecord, DownloadRecordWithStatus, WikiFileHistoryRecord,
};
use crate::lms::{self, CourseItem, VideoItem, WikiPageItem};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Result wrapper
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ApiResult<T: Serialize> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T: Serialize> ApiResult<T> {
    fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    fn err(msg: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(msg),
        }
    }
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoRef {
    pub content_id: String,
    pub title: String,
    pub file_size: Option<u64>,
    pub duration: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadMeta {
    pub course_id: String,
    pub course_name: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn iso_now() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    let secs = d.as_secs();
    // Simple ISO-ish timestamp from unix seconds
    // Good enough for history records
    format!("{}Z", secs)
}

// ---------------------------------------------------------------------------
// Transcribe progress event payload
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeProgress {
    file_path: String,
    status: String,
    error: Option<String>,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// 1. Fetch courses from Canvas LMS
#[tauri::command]
pub async fn fetch_courses(app: AppHandle) -> ApiResult<Vec<CourseItem>> {
    let state = app.state::<AppState>();
    match lms::fetch_courses_api(&state).await {
        Ok(courses) => ApiResult::ok(courses),
        Err(e) => ApiResult::err(e),
    }
}

/// 2. Fetch modules (videos + wiki pages) for a course
#[tauri::command]
pub async fn fetch_modules(
    app: AppHandle,
    course_id: String,
) -> ApiResult<(Vec<VideoItem>, Vec<WikiPageItem>)> {
    let state = app.state::<AppState>();
    match lms::fetch_modules_api(&state, &course_id).await {
        Ok(result) => ApiResult::ok(result),
        Err(e) => ApiResult::err(e),
    }
}

/// 3. Download a single video + record history
#[tauri::command]
pub async fn download_video(
    app: AppHandle,
    content_id: String,
    title: String,
    folder_path: String,
    format: String,
    meta: Option<DownloadMeta>,
) -> ApiResult<String> {
    let ext = if format == "m4a" { "m4a" } else { "mp4" };
    let safe_name = config::to_safe_file_name(&title, ext.len() + 1);
    let save_path = Path::new(&folder_path)
        .join(format!("{}.{}", safe_name, ext))
        .to_string_lossy()
        .to_string();

    let state = app.state::<AppState>();
    match download::download_one(&state, &app, &content_id, &save_path, &format).await {
        Ok(final_path) => {
            // Record in history if meta is provided
            if let Some(m) = meta {
                let record = DownloadRecord {
                    content_id: content_id.clone(),
                    title,
                    course_id: m.course_id,
                    course_name: m.course_name,
                    file_path: final_path.clone(),
                    format: format.clone(),
                    file_size: 0,
                    duration: 0,
                    downloaded_at: iso_now(),
                    txt_path: None,
                    summary_path: None,
                };
                history::add_record(&app, record);
            }
            ApiResult::ok(final_path)
        }
        Err(e) => ApiResult::err(e),
    }
}

/// 4. Download all videos concurrently with semaphore
#[tauri::command]
pub async fn download_all(
    app: AppHandle,
    videos: Vec<VideoRef>,
    folder_path: String,
    format: String,
    meta: Option<DownloadMeta>,
) -> ApiResult<u32> {
    let batch_total = videos.len() as u32;
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS));
    let completed = Arc::new(tokio::sync::Mutex::new(0u32));

    let mut handles = Vec::new();

    for video in videos {
        let sem = semaphore.clone();
        let app_clone = app.clone();
        let folder = folder_path.clone();
        let fmt = format.clone();
        let meta_clone = meta.clone();
        let completed_clone = completed.clone();

        let handle = tokio::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| format!("세마포어 오류: {}", e))?;

            let ext = if fmt == "m4a" { "m4a" } else { "mp4" };
            let safe_name = config::to_safe_file_name(&video.title, ext.len() + 1);
            let save_path = Path::new(&folder)
                .join(format!("{}.{}", safe_name, ext))
                .to_string_lossy()
                .to_string();

            let state = app_clone.state::<AppState>();
            let result =
                download::download_one(&state, &app_clone, &video.content_id, &save_path, &fmt)
                    .await;

            // Update batch progress
            let mut count = completed_clone.lock().await;
            *count += 1;
            let batch_completed = *count;

            let _ = app_clone.emit(
                "download-progress",
                DownloadProgressData {
                    content_id: video.content_id.clone(),
                    downloaded: 0,
                    total: 0,
                    percent: 100,
                    status: Some("done".to_string()),
                    batch_completed: Some(batch_completed),
                    batch_total: Some(batch_total),
                },
            );

            // Record history on success
            if let Ok(ref final_path) = result {
                if let Some(ref m) = meta_clone {
                    let record = DownloadRecord {
                        content_id: video.content_id.clone(),
                        title: video.title.clone(),
                        course_id: m.course_id.clone(),
                        course_name: m.course_name.clone(),
                        file_path: final_path.clone(),
                        format: fmt.clone(),
                        file_size: video.file_size.unwrap_or(0),
                        duration: video.duration.unwrap_or(0),
                        downloaded_at: iso_now(),
                        txt_path: None,
                        summary_path: None,
                    };
                    history::add_record(&app_clone, record);
                }
            }

            result
        });

        handles.push(handle);
    }

    let mut success_count = 0u32;
    for handle in handles {
        match handle.await {
            Ok(Ok(_)) => success_count += 1,
            _ => {}
        }
    }

    ApiResult::ok(success_count)
}

/// 5. Transcribe audio file with optional summary
#[tauri::command]
pub async fn transcribe_audio(
    app: AppHandle,
    file_path: String,
    with_summary: bool,
    use_file_api: bool,
    api_key: String,
    model: String,
) -> ApiResult<String> {
    // Emit uploading status
    let _ = app.emit(
        "transcribe-progress",
        TranscribeProgress {
            file_path: file_path.clone(),
            status: "uploading".to_string(),
            error: None,
        },
    );

    // Emit transcribing status
    let _ = app.emit(
        "transcribe-progress",
        TranscribeProgress {
            file_path: file_path.clone(),
            status: "transcribing".to_string(),
            error: None,
        },
    );

    let api_key_clone = api_key.clone();
    let model_clone = model.clone();
    let file_path_clone = file_path.clone();

    let transcription = gemini::with_retry(
        || {
            let fp = file_path_clone.clone();
            let ak = api_key_clone.clone();
            let mdl = model_clone.clone();
            async move { gemini::transcribe_one(&fp, &ak, &mdl, use_file_api).await }
        },
        GEMINI_MAX_RETRIES,
    )
    .await;

    let text = match transcription {
        Ok(t) => t,
        Err(e) => {
            let _ = app.emit(
                "transcribe-progress",
                TranscribeProgress {
                    file_path: file_path.clone(),
                    status: "error".to_string(),
                    error: Some(e.clone()),
                },
            );
            return ApiResult::err(e);
        }
    };

    // Save transcription to {stem}.txt
    let path = Path::new(&file_path);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let txt_path = parent.join(format!("{}.txt", stem));

    if let Err(e) = tokio::fs::write(&txt_path, &text).await {
        return ApiResult::err(format!("텍스트 파일 저장 실패: {}", e));
    }

    let txt_path_str = txt_path.to_string_lossy().to_string();

    // Optional summary
    let mut summary_path_str: Option<String> = None;
    if with_summary {
        let _ = app.emit(
            "transcribe-progress",
            TranscribeProgress {
                file_path: file_path.clone(),
                status: "merging".to_string(),
                error: None,
            },
        );

        match gemini::summarize_text(&text, &api_key, &model).await {
            Ok(summary) => {
                let summary_path = parent.join(format!("{}_요약본.md", stem));
                if let Err(e) = tokio::fs::write(&summary_path, &summary).await {
                    return ApiResult::err(format!("요약본 저장 실패: {}", e));
                }
                summary_path_str = Some(summary_path.to_string_lossy().to_string());
            }
            Err(e) => {
                // Summary failure is non-fatal; we still have the transcription
                eprintln!("요약 실패: {}", e);
            }
        }
    }

    // Update history with transcription paths
    // Try to find a content_id from the file name (best effort)
    // The caller should update history separately if needed

    let _ = app.emit(
        "transcribe-progress",
        TranscribeProgress {
            file_path: file_path.clone(),
            status: "done".to_string(),
            error: None,
        },
    );

    // Return the txt path (and summary path in the result)
    let result = if let Some(ref sp) = summary_path_str {
        format!("{}|{}", txt_path_str, sp)
    } else {
        txt_path_str
    };

    ApiResult::ok(result)
}

/// 6. Get available Gemini model options
#[tauri::command]
pub fn get_gemini_model_options() -> ApiResult<Vec<GeminiModelOption>> {
    ApiResult::ok(config::gemini_model_options())
}

/// 7. Get download history with file existence status
#[tauri::command]
pub fn get_history(app: AppHandle) -> ApiResult<Vec<DownloadRecordWithStatus>> {
    ApiResult::ok(history::get_history_with_status(&app))
}

/// 8. Remove a history record by content_id
#[tauri::command]
pub fn remove_history_record(app: AppHandle, content_id: String) -> ApiResult<()> {
    history::remove_record(&app, &content_id);
    ApiResult::ok(())
}

/// 9. Download a wiki file (PDF) with cookie authentication
#[tauri::command]
pub async fn download_wiki_file(
    app: AppHandle,
    download_url: String,
    title: String,
    folder_path: String,
    meta: Option<DownloadMeta>,
) -> ApiResult<String> {
    let state = app.state::<AppState>();
    if state.lms_window.lock().await.is_none() {
        return ApiResult::err("로그인이 필요합니다.".into());
    }

    let safe_name = config::to_safe_file_name(&title, 0);
    let file_name = if safe_name.to_lowercase().ends_with(".pdf") {
        safe_name
    } else {
        format!("{}.pdf", safe_name)
    };

    let save_path = Path::new(&folder_path)
        .join(&file_name)
        .to_string_lossy()
        .to_string();

    let resp = state
        .http_client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("다운로드 요청 실패: {}", e));

    let resp = match resp {
        Ok(r) => r,
        Err(e) => return ApiResult::err(e),
    };

    if !resp.status().is_success() {
        return ApiResult::err(format!("HTTP {}", resp.status().as_u16()));
    }

    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => return ApiResult::err(format!("응답 읽기 실패: {}", e)),
    };

    let file_size = bytes.len() as u64;

    if let Err(e) = tokio::fs::write(&save_path, &bytes).await {
        return ApiResult::err(format!("파일 저장 실패: {}", e));
    }

    // Record wiki history
    if let Some(m) = meta {
        let record = WikiFileHistoryRecord {
            file_id: download_url.clone(),
            title: title.clone(),
            course_id: m.course_id,
            course_name: m.course_name,
            file_path: save_path.clone(),
            file_size,
            downloaded_at: iso_now(),
            summary_path: None,
        };
        history::add_wiki_record(&app, record);
    }

    ApiResult::ok(save_path)
}

/// 10. Summarize a PDF file and save the result
#[tauri::command]
pub async fn summarize_wiki_pdf(
    pdf_path: String,
    api_key: String,
    model: String,
) -> ApiResult<String> {
    match gemini::summarize_pdf(&pdf_path, &api_key, &model).await {
        Ok(summary) => {
            // Save summary next to the PDF
            let path = Path::new(&pdf_path);
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("output");
            let parent = path.parent().unwrap_or_else(|| Path::new("."));
            let summary_path = parent.join(format!("{}_요약본.md", stem));

            match tokio::fs::write(&summary_path, &summary).await {
                Ok(_) => ApiResult::ok(summary_path.to_string_lossy().to_string()),
                Err(e) => ApiResult::err(format!("요약본 저장 실패: {}", e)),
            }
        }
        Err(e) => ApiResult::err(e),
    }
}
