use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

pub const SPLIT_THRESHOLD_BYTES: u64 = 19 * 1024 * 1024;
pub const MAX_CONCURRENT_DOWNLOADS: usize = 3;
pub const MAX_CONCURRENT_TRANSCRIPTIONS: usize = 2;
pub const DEFAULT_GEMINI_MODEL: &str = "gemini-2.0-flash";
pub const GEMINI_MAX_RETRIES: u32 = 3;
pub const DOWNLOAD_TIMEOUT_SECS: u64 = 300;
pub const MAX_FILENAME_BYTES: usize = 255;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeminiModelOption {
    pub id: String,
    pub label: String,
    pub description: String,
}

pub fn gemini_model_options() -> Vec<GeminiModelOption> {
    vec![
        GeminiModelOption {
            id: "gemini-3.1-pro".into(),
            label: "Gemini 3.1 Pro".into(),
            description: "고급 지능, 복잡한 문제 해결, 강력한 에이전트 및 분위기 코딩 기능".into(),
        },
        GeminiModelOption {
            id: "gemini-3-flash".into(),
            label: "Gemini 3 Flash".into(),
            description: "더 큰 모델에 필적하는 프런티어급 성능을 훨씬 저렴한 비용으로 제공".into(),
        },
        GeminiModelOption {
            id: "gemini-3.1-flash-lite".into(),
            label: "Gemini 3.1 Flash-Lite".into(),
            description: "프런티어급 성능을 더 낮은 비용으로 제공하는 빠른 경량 모델".into(),
        },
        GeminiModelOption {
            id: "gemini-2.5-flash".into(),
            label: "Gemini 2.5 Flash".into(),
            description: "짧은 지연 시간과 대용량 작업에 적합한 최고 가성비 모델".into(),
        },
        GeminiModelOption {
            id: "gemini-2.5-flash-lite".into(),
            label: "Gemini 2.5 Flash-Lite".into(),
            description: "2.5 계열에서 가장 빠르고 예산 친화적인 멀티모달 모델".into(),
        },
        GeminiModelOption {
            id: "gemini-2.0-flash".into(),
            label: "Gemini 2.0 Flash (기본)".into(),
            description: "STT에 최적화된 빠르고 가벼운 모델, 무료 할당량 넉넉".into(),
        },
    ]
}

pub fn is_valid_gemini_model(model: &str) -> bool {
    gemini_model_options().iter().any(|m| m.id == model)
}

/// macOS HFS+ NFD 변환 시 255바이트 제한 초과를 방지하는 안전한 파일명 생성
pub fn to_safe_file_name(title: &str, reserve_bytes: usize) -> String {
    let mut name: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | '?' | '%' | '*' | ':' | '|' | '"' | '<' | '>' => '_',
            _ => c,
        })
        .collect();

    let limit = MAX_FILENAME_BYTES - reserve_bytes;

    while nfd_byte_length(&name) > limit {
        name.pop();
    }

    name
}

fn nfd_byte_length(s: &str) -> usize {
    s.nfd().collect::<String>().len()
}
