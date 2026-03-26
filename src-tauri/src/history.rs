use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;

// ---------------------------------------------------------------------------
// Download history types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub content_id: String,
    pub title: String,
    pub course_id: String,
    pub course_name: String,
    pub file_path: String,
    pub format: String,
    pub file_size: u64,
    pub duration: u64,
    pub downloaded_at: String,
    pub txt_path: Option<String>,
    pub summary_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecordWithStatus {
    #[serde(flatten)]
    pub record: DownloadRecord,
    pub file_exists: bool,
    pub txt_exists: bool,
    pub summary_exists: bool,
}

// ---------------------------------------------------------------------------
// Wiki history types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiFileHistoryRecord {
    pub file_id: String,
    pub title: String,
    pub course_id: String,
    pub course_name: String,
    pub file_path: String,
    pub file_size: u64,
    pub downloaded_at: String,
    pub summary_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiFileHistoryRecordWithStatus {
    #[serde(flatten)]
    pub record: WikiFileHistoryRecord,
    pub file_exists: bool,
    pub summary_exists: bool,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn history_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("download-history.json")
}

fn wiki_history_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("wiki-history.json")
}

fn ensure_parent(path: &PathBuf) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
}

// ---------------------------------------------------------------------------
// Download history functions
// ---------------------------------------------------------------------------

pub fn load_history(app: &AppHandle) -> Vec<DownloadRecord> {
    let path = history_path(app);
    if !path.exists() {
        return Vec::new();
    }
    let data = match fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

pub fn save_history(app: &AppHandle, records: &[DownloadRecord]) {
    let path = history_path(app);
    ensure_parent(&path);
    if let Ok(json) = serde_json::to_string_pretty(records) {
        let _ = fs::write(&path, json);
    }
}

pub fn add_record(app: &AppHandle, record: DownloadRecord) {
    let mut records = load_history(app);

    if let Some(existing) = records.iter_mut().find(|r| r.content_id == record.content_id) {
        // Preserve existing txt_path / summary_path if new record doesn't have them
        let txt = record.txt_path.clone().or_else(|| existing.txt_path.clone());
        let summary = record
            .summary_path
            .clone()
            .or_else(|| existing.summary_path.clone());
        *existing = record;
        existing.txt_path = txt;
        existing.summary_path = summary;
    } else {
        records.push(record);
    }

    save_history(app, &records);
}

pub fn update_transcription(
    app: &AppHandle,
    content_id: &str,
    txt_path: Option<String>,
    summary_path: Option<String>,
) {
    let mut records = load_history(app);

    if let Some(rec) = records.iter_mut().find(|r| r.content_id == content_id) {
        if txt_path.is_some() {
            rec.txt_path = txt_path;
        }
        if summary_path.is_some() {
            rec.summary_path = summary_path;
        }
        save_history(app, &records);
    }
}

pub fn remove_record(app: &AppHandle, content_id: &str) {
    let mut records = load_history(app);
    records.retain(|r| r.content_id != content_id);
    save_history(app, &records);
}

pub fn get_history_with_status(app: &AppHandle) -> Vec<DownloadRecordWithStatus> {
    let records = load_history(app);
    records
        .into_iter()
        .map(|r| {
            let file_exists = std::path::Path::new(&r.file_path).exists();
            let txt_exists = r
                .txt_path
                .as_ref()
                .map(|p| std::path::Path::new(p).exists())
                .unwrap_or(false);
            let summary_exists = r
                .summary_path
                .as_ref()
                .map(|p| std::path::Path::new(p).exists())
                .unwrap_or(false);
            DownloadRecordWithStatus {
                record: r,
                file_exists,
                txt_exists,
                summary_exists,
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Wiki history functions
// ---------------------------------------------------------------------------

pub fn load_wiki_history(app: &AppHandle) -> Vec<WikiFileHistoryRecord> {
    let path = wiki_history_path(app);
    if !path.exists() {
        return Vec::new();
    }
    let data = match fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

pub fn save_wiki_history(app: &AppHandle, records: &[WikiFileHistoryRecord]) {
    let path = wiki_history_path(app);
    ensure_parent(&path);
    if let Ok(json) = serde_json::to_string_pretty(records) {
        let _ = fs::write(&path, json);
    }
}

pub fn add_wiki_record(app: &AppHandle, record: WikiFileHistoryRecord) {
    let mut records = load_wiki_history(app);

    if let Some(existing) = records.iter_mut().find(|r| r.file_id == record.file_id) {
        let summary = record
            .summary_path
            .clone()
            .or_else(|| existing.summary_path.clone());
        *existing = record;
        existing.summary_path = summary;
    } else {
        records.push(record);
    }

    save_wiki_history(app, &records);
}
