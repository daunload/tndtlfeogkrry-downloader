use std::future::Future;
use std::path::Path;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::config::GEMINI_MAX_RETRIES;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
}

#[derive(Debug, Serialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum GeminiPart {
    Text {
        text: String,
    },
    InlineData {
        inline_data: InlineData,
    },
    FileData {
        file_data: FileData,
    },
}

#[derive(Debug, Serialize)]
struct InlineData {
    mime_type: String,
    data: String,
}

#[derive(Debug, Serialize)]
struct FileData {
    file_uri: String,
    mime_type: String,
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<Candidate>>,
}

#[derive(Debug, Deserialize)]
struct Candidate {
    content: Option<CandidateContent>,
}

#[derive(Debug, Deserialize)]
struct CandidateContent {
    parts: Option<Vec<CandidatePart>>,
}

#[derive(Debug, Deserialize)]
struct CandidatePart {
    text: Option<String>,
}

// ---------------------------------------------------------------------------
// File API types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct UploadResponse {
    file: UploadedFile,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadedFile {
    name: String,
    uri: String,
    mime_type: String,
    state: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetFileResponse {
    #[allow(dead_code)]
    name: String,
    #[allow(dead_code)]
    uri: String,
    #[allow(dead_code)]
    mime_type: String,
    state: String,
}

// ---------------------------------------------------------------------------
// Core API call
// ---------------------------------------------------------------------------

async fn generate_content(
    api_key: &str,
    model: &str,
    parts: Vec<GeminiPart>,
) -> Result<String, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, api_key
    );

    let body = GeminiRequest {
        contents: vec![GeminiContent { parts }],
    };

    let client = Client::new();
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini API 요청 실패: {}", e))?;

    let status = resp.status();
    let resp_text = resp
        .text()
        .await
        .map_err(|e| format!("응답 읽기 실패: {}", e))?;

    if !status.is_success() {
        return Err(format!("Gemini API 오류 ({}): {}", status.as_u16(), resp_text));
    }

    let parsed: GeminiResponse =
        serde_json::from_str(&resp_text).map_err(|e| format!("응답 파싱 실패: {}", e))?;

    parsed
        .candidates
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.content)
        .and_then(|c| c.parts)
        .and_then(|p| p.into_iter().next())
        .and_then(|p| p.text)
        .ok_or_else(|| "Gemini 응답에서 텍스트를 찾을 수 없습니다".to_string())
}

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

pub async fn with_retry<F, Fut>(f: F, max_retries: u32) -> Result<String, String>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<String, String>>,
{
    let mut last_err = String::new();

    for attempt in 0..=max_retries {
        match f().await {
            Ok(result) => return Ok(result),
            Err(e) => {
                // Quota exhaustion — fail immediately
                if e.contains("exceeded your current quota")
                    || (e.contains("Quota exceeded") && e.contains("limit: 0"))
                {
                    return Err(
                        "Gemini API 할당량이 초과되었습니다. 잠시 후 다시 시도해주세요."
                            .to_string(),
                    );
                }

                last_err = e.clone();

                if attempt < max_retries && e.contains("429") {
                    // Check for server-suggested delay
                    let delay_secs = extract_retry_delay(&e).unwrap_or_else(|| {
                        2u64.pow(attempt) * 2
                    });
                    tokio::time::sleep(Duration::from_millis(delay_secs * 1000)).await;
                } else if attempt < max_retries {
                    // Brief pause for other transient errors
                    tokio::time::sleep(Duration::from_millis(1000)).await;
                }
            }
        }
    }

    Err(last_err)
}

/// Try to extract "retry in Xs" delay from error message
fn extract_retry_delay(err: &str) -> Option<u64> {
    // Look for patterns like "retry in 30s" or "retry in 5s"
    let lower = err.to_lowercase();
    if let Some(pos) = lower.find("retry in ") {
        let rest = &lower[pos + 9..];
        let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        num_str.parse().ok()
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// MIME type helper
// ---------------------------------------------------------------------------

fn audio_mime_type(path: &str) -> &'static str {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "m4a" | "aac" => "audio/aac",
        _ => "audio/mp3",
    }
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

pub async fn transcribe_one(
    audio_path: &str,
    api_key: &str,
    model: &str,
    use_file_api: bool,
) -> Result<String, String> {
    let prompt = "이 오디오의 내용을 한국어 텍스트로 정확하게 받아적어주세요. \
                  강의 내용이므로 전문 용어를 정확히 표기하고, 문단을 적절히 나눠주세요.";

    let mime = audio_mime_type(audio_path).to_string();

    if use_file_api {
        let (file_uri, file_mime, file_name) =
            upload_and_wait_for_active(audio_path, api_key).await?;

        let parts = vec![
            GeminiPart::Text {
                text: prompt.to_string(),
            },
            GeminiPart::FileData {
                file_data: FileData {
                    file_uri,
                    mime_type: file_mime,
                },
            },
        ];

        let api_key_owned = api_key.to_string();
        let model_owned = model.to_string();

        let result = with_retry(
            || {
                let parts_clone = vec![
                    GeminiPart::Text {
                        text: prompt.to_string(),
                    },
                    GeminiPart::FileData {
                        file_data: FileData {
                            file_uri: parts[1].file_uri_ref().unwrap().to_string(),
                            mime_type: parts[1].mime_type_ref().unwrap().to_string(),
                        },
                    },
                ];
                let key = api_key_owned.clone();
                let mdl = model_owned.clone();
                async move { generate_content(&key, &mdl, parts_clone).await }
            },
            GEMINI_MAX_RETRIES,
        )
        .await;

        // Clean up uploaded file
        delete_uploaded_file(&file_name, api_key).await;

        result
    } else {
        let file_bytes = tokio::fs::read(audio_path)
            .await
            .map_err(|e| format!("오디오 파일 읽기 실패: {}", e))?;
        let b64 = STANDARD.encode(&file_bytes);

        let api_key_owned = api_key.to_string();
        let model_owned = model.to_string();

        with_retry(
            || {
                let parts = vec![
                    GeminiPart::Text {
                        text: prompt.to_string(),
                    },
                    GeminiPart::InlineData {
                        inline_data: InlineData {
                            mime_type: mime.clone(),
                            data: b64.clone(),
                        },
                    },
                ];
                let key = api_key_owned.clone();
                let mdl = model_owned.clone();
                async move { generate_content(&key, &mdl, parts).await }
            },
            GEMINI_MAX_RETRIES,
        )
        .await
    }
}

impl GeminiPart {
    fn file_uri_ref(&self) -> Option<&str> {
        match self {
            GeminiPart::FileData { file_data } => Some(&file_data.file_uri),
            _ => None,
        }
    }
    fn mime_type_ref(&self) -> Option<&str> {
        match self {
            GeminiPart::FileData { file_data } => Some(&file_data.mime_type),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Summarization
// ---------------------------------------------------------------------------

pub async fn summarize_text(
    text: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let prompt = format!(
        "다음 강의 내용을 시험 대비용으로 요약해주세요:\n\n\
         1. 핵심 개념 3-5개를 추출하고 각각 간결하게 설명\n\
         2. 개념 간의 관계를 설명\n\
         3. 시험에 나올 만한 중요 포인트 5개\n\
         4. 한 줄 결론\n\n\
         강의 내용:\n{}",
        text
    );

    let api_key_owned = api_key.to_string();
    let model_owned = model.to_string();

    with_retry(
        || {
            let parts = vec![GeminiPart::Text {
                text: prompt.clone(),
            }];
            let key = api_key_owned.clone();
            let mdl = model_owned.clone();
            async move { generate_content(&key, &mdl, parts).await }
        },
        GEMINI_MAX_RETRIES,
    )
    .await
}

pub async fn summarize_pdf(
    pdf_path: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let (file_uri, file_mime, file_name) =
        upload_and_wait_for_active(pdf_path, api_key).await?;

    let prompt = "다음 PDF 강의 자료를 시험 대비용으로 요약해주세요:\n\n\
                  1. 핵심 개념 3-5개를 추출하고 각각 간결하게 설명\n\
                  2. 개념 간의 관계를 설명\n\
                  3. 시험에 나올 만한 중요 포인트 5개\n\
                  4. 한 줄 결론"
        .to_string();

    let api_key_owned = api_key.to_string();
    let model_owned = model.to_string();
    let file_uri_clone = file_uri.clone();
    let file_mime_clone = file_mime.clone();

    let result = with_retry(
        || {
            let parts = vec![
                GeminiPart::Text {
                    text: prompt.clone(),
                },
                GeminiPart::FileData {
                    file_data: FileData {
                        file_uri: file_uri_clone.clone(),
                        mime_type: file_mime_clone.clone(),
                    },
                },
            ];
            let key = api_key_owned.clone();
            let mdl = model_owned.clone();
            async move { generate_content(&key, &mdl, parts).await }
        },
        GEMINI_MAX_RETRIES,
    )
    .await;

    delete_uploaded_file(&file_name, api_key).await;

    result
}

// ---------------------------------------------------------------------------
// File API
// ---------------------------------------------------------------------------

pub async fn upload_and_wait_for_active(
    file_path: &str,
    api_key: &str,
) -> Result<(String, String, String), String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/upload/v1beta/files?key={}",
        api_key
    );

    let path = Path::new(file_path);
    let file_name_display = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let mime = match ext.as_str() {
        "m4a" | "aac" => "audio/aac",
        "mp3" => "audio/mp3",
        "mp4" => "video/mp4",
        "pdf" => "application/pdf",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    };

    let file_bytes = tokio::fs::read(file_path)
        .await
        .map_err(|e| format!("파일 읽기 실패: {}", e))?;

    let metadata = serde_json::json!({
        "file": {
            "display_name": file_name_display
        }
    });

    let metadata_part = reqwest::multipart::Part::text(metadata.to_string())
        .mime_str("application/json")
        .map_err(|e| format!("메타데이터 설정 실패: {}", e))?;

    let file_part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(file_name_display.to_string())
        .mime_str(mime)
        .map_err(|e| format!("파일 파트 설정 실패: {}", e))?;

    let form = reqwest::multipart::Form::new()
        .part("metadata", metadata_part)
        .part("file", file_part);

    let client = Client::new();
    let resp = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("파일 업로드 실패: {}", e))?;

    let status = resp.status();
    let resp_text = resp
        .text()
        .await
        .map_err(|e| format!("업로드 응답 읽기 실패: {}", e))?;

    if !status.is_success() {
        return Err(format!("파일 업로드 오류 ({}): {}", status.as_u16(), resp_text));
    }

    let upload_resp: UploadResponse =
        serde_json::from_str(&resp_text).map_err(|e| format!("업로드 응답 파싱 실패: {}", e))?;

    let file_obj = upload_resp.file;
    let api_file_name = file_obj.name.clone();
    let file_uri = file_obj.uri.clone();
    let file_mime_type = file_obj.mime_type.clone();

    // Poll until ACTIVE
    if file_obj.state != "ACTIVE" {
        let get_url = format!(
            "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
            api_file_name, api_key
        );

        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;

            let check_resp = client
                .get(&get_url)
                .send()
                .await
                .map_err(|e| format!("파일 상태 확인 실패: {}", e))?;

            let check_text = check_resp
                .text()
                .await
                .map_err(|e| format!("상태 응답 읽기 실패: {}", e))?;

            let file_status: GetFileResponse = serde_json::from_str(&check_text)
                .map_err(|e| format!("상태 응답 파싱 실패: {}", e))?;

            if file_status.state == "ACTIVE" {
                break;
            }
            if file_status.state == "FAILED" {
                return Err("파일 처리 실패".to_string());
            }
        }
    }

    Ok((file_uri, file_mime_type, api_file_name))
}

pub async fn delete_uploaded_file(file_name: &str, api_key: &str) {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
        file_name, api_key
    );

    let client = Client::new();
    let _ = client.delete(&url).send().await;
}
