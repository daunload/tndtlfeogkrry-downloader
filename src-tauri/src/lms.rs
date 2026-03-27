use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};

use crate::auth::eval_lms;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseItem {
    pub id: String,
    pub name: String,
    pub term: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoItem {
    pub title: String,
    pub content_id: String,
    pub duration: u64,
    pub file_size: u64,
    pub thumbnail_url: String,
    pub week_position: u32,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiPageFileItem {
    pub title: String,
    pub download_url: String,
    pub api_endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiPageItem {
    pub title: String,
    pub course_id: String,
    pub week_position: u32,
    pub available: bool,
    pub url: String,
    pub files: Vec<WikiPageFileItem>,
}

// ---------------------------------------------------------------------------
// XML parsing — extract media URL from content.php response
// ---------------------------------------------------------------------------

/// Extracts video download URL from `content.php` XML using 4 strategies in priority order.
pub fn extract_media_url(xml: &str) -> Option<String> {
    // We gather relevant fields by walking the XML event stream, tracking the
    // path of nested element names so we can match on specific locations.

    let mut reader = Reader::from_str(xml);

    // Collected values (first-found wins for each slot)
    let mut media_uri_service_root: Option<String> = None;
    let mut media_uri_playing_info: Option<String> = None;
    let mut media_uri_content: Option<String> = None;
    let mut main_media_story: Option<String> = None;
    let mut main_media_playing: Option<String> = None;
    let mut content_uri: Option<String> = None;
    let mut desktop_html5_uri: Option<String> = None;

    // Simple path tracking: stack of tag names
    let mut path: Vec<String> = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                path.push(name);
            }
            Ok(Event::End(_)) => {
                path.pop();
            }
            Ok(Event::Text(ref e)) => {
                let text = e.unescape().unwrap_or_default().trim().to_string();
                if text.is_empty() {
                    buf.clear();
                    continue;
                }

                let current_tag = path.last().map(|s| s.as_str()).unwrap_or("");

                match current_tag {
                    "media_uri" => {
                        // Determine location by looking at ancestors
                        if path_contains(&path, "service_root") && path_contains(&path, "media") {
                            if media_uri_service_root.is_none() {
                                media_uri_service_root = Some(text.clone());
                            }
                        } else if path_contains(&path, "content_playing_info") {
                            // Could be inside main_media > desktop > html5
                            if path_contains(&path, "desktop") && path_contains(&path, "html5") {
                                if desktop_html5_uri.is_none() {
                                    desktop_html5_uri = Some(text.clone());
                                }
                            } else if media_uri_playing_info.is_none() {
                                media_uri_playing_info = Some(text.clone());
                            }
                        } else if path_contains(&path, "content") {
                            if media_uri_content.is_none() {
                                media_uri_content = Some(text.clone());
                            }
                        }
                    }
                    "main_media" => {
                        // Only capture if it looks like a filename (not a parent element)
                        // Since Start events push to path and this is Text, it means
                        // main_media is a leaf element with text content.
                        if path_contains(&path, "story_list") || path_contains(&path, "story") {
                            if main_media_story.is_none() {
                                main_media_story = Some(text.clone());
                            }
                        } else if path_contains(&path, "content_playing_info")
                            && path_contains(&path, "main_media_list")
                        {
                            if main_media_playing.is_none() {
                                main_media_playing = Some(text.clone());
                            }
                        }
                    }
                    "content_uri" => {
                        if path_contains(&path, "content_playing_info") && content_uri.is_none() {
                            content_uri = Some(text.clone());
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    // Resolve media_uri by priority
    let media_uri = media_uri_service_root
        .or(media_uri_playing_info)
        .or(media_uri_content);

    let file_name = main_media_story.or(main_media_playing);

    // Strategy 1: [MEDIA_FILE] template substitution
    if let (Some(ref uri), Some(ref fname)) = (&media_uri, &file_name) {
        if uri.contains("[MEDIA_FILE]") {
            return Some(uri.replace("[MEDIA_FILE]", fname));
        }
    }

    // Strategy 2: Direct .mp4 URL (no brackets)
    if let Some(ref uri) = media_uri {
        if uri.contains(".mp4") && !uri.contains('[') {
            return Some(uri.clone());
        }
    }

    // Strategy 3: desktop HTML5 path
    if let Some(ref uri) = desktop_html5_uri {
        if uri.contains(".mp4") {
            return Some(uri.clone());
        }
    }

    // Strategy 4: content_uri fallback
    if let Some(ref fname) = file_name {
        if let Some(ref c_uri) = content_uri {
            let base = if c_uri.ends_with("web_files") {
                c_uri.replace("web_files", "media_files")
            } else {
                c_uri.clone()
            };
            return Some(format!("{}/{}", base.trim_end_matches('/'), fname));
        }
    }

    None
}

/// Check if any ancestor in the path contains the given tag name.
fn path_contains(path: &[String], tag: &str) -> bool {
    path.iter().any(|s| s == tag)
}

// ---------------------------------------------------------------------------
// HTML entity decoding
// ---------------------------------------------------------------------------

fn decode_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

// ---------------------------------------------------------------------------
// Wiki file extraction from HTML
// ---------------------------------------------------------------------------

fn is_pdf_file(title: &str, download_url: &str) -> bool {
    let lower_title = title.to_lowercase();
    let lower_url = download_url.to_lowercase();
    // Check title or URL path for .pdf
    lower_title.ends_with(".pdf") || lower_url.contains(".pdf")
}

fn extract_wiki_files_from_html(html: &str) -> Vec<WikiPageFileItem> {
    let mut files = Vec::new();

    // Match <a> tags with class containing "instructure_file_link"
    let anchor_re = regex_lite::Regex::new(
        r#"(?is)<a\b[^>]*class=["'][^"']*instructure_file_link[^"']*["'][^>]*>[\s\S]*?</a>"#,
    )
    .unwrap();

    let title_re = regex_lite::Regex::new(r#"(?i)\btitle="([^"]*)"#).unwrap();
    let title_re_sq = regex_lite::Regex::new(r#"(?i)\btitle='([^']*)"#).unwrap();
    let href_re = regex_lite::Regex::new(r#"(?i)\bhref="([^"]*)"#).unwrap();
    let href_re_sq = regex_lite::Regex::new(r#"(?i)\bhref='([^']*)"#).unwrap();
    let api_re = regex_lite::Regex::new(r#"(?i)\bdata-api-endpoint="([^"]*)"#).unwrap();
    let api_re_sq = regex_lite::Regex::new(r#"(?i)\bdata-api-endpoint='([^']*)"#).unwrap();
    let inner_text_re = regex_lite::Regex::new(r#"(?is)>([\s\S]*?)</a>"#).unwrap();

    for anchor in anchor_re.find_iter(html) {
        let anchor_str = anchor.as_str();

        let title_match = title_re
            .captures(anchor_str)
            .or_else(|| title_re_sq.captures(anchor_str))
            .map(|c| c[1].to_string());
        let inner_text = inner_text_re
            .captures(anchor_str)
            .map(|c| c[1].trim().to_string());

        let title = decode_html_entities(
            &title_match
                .or(inner_text)
                .unwrap_or_else(|| "첨부파일".to_string()),
        );

        let href = match href_re
            .captures(anchor_str)
            .or_else(|| href_re_sq.captures(anchor_str))
        {
            Some(c) => c[1].trim().to_string(),
            None => continue,
        };

        let download_url = {
            let decoded = decode_html_entities(&href);
            if decoded.starts_with("http://") || decoded.starts_with("https://") {
                decoded
            } else {
                format!(
                    "https://canvas.ssu.ac.kr{}",
                    if decoded.starts_with('/') {
                        decoded
                    } else {
                        format!("/{}", decoded)
                    }
                )
            }
        };

        if !is_pdf_file(&title, &download_url) {
            continue;
        }

        let api_endpoint = api_re
            .captures(anchor_str)
            .or_else(|| api_re_sq.captures(anchor_str))
            .map(|c| decode_html_entities(&c[1]));

        files.push(WikiPageFileItem {
            title,
            download_url,
            api_endpoint,
        });
    }

    files
}

// ---------------------------------------------------------------------------
// Canvas API — fetch courses
// ---------------------------------------------------------------------------

const VIDEO_TYPES: &[&str] = &["everlec", "movie", "video", "mp4"];

/// Fetch dashboard course cards via LMS WebviewWindow (inherits session cookies).
pub async fn fetch_courses_api(state: &AppState) -> Result<Vec<CourseItem>, String> {
    let js = r#"
(function() {
    fetch('/api/v1/dashboard/dashboard_cards', {credentials: 'include'})
        .then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
        })
        .then(function(text) {
            var data = JSON.parse(text.replace(/^while\(1\);/, ''));
            __sendToRust({type: 'courses', data: data});
        })
        .catch(function(e) {
            __sendToRust({type: 'courses', error: e.message});
        });
})();
"#;

    let result = eval_lms(state, "courses", js).await?;

    if let Some(err) = result.get("error").and_then(|v| v.as_str()) {
        if err.contains("401") || err.contains("403") {
            return Err("로그인이 만료되었습니다. 다시 로그인해주세요.".into());
        }
        return Err(err.to_string());
    }

    let cards = result
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or("courses 응답 형식 오류")?;

    let courses = cards
        .iter()
        .filter_map(|c| {
            let id = c.get("id")?.to_string().trim_matches('"').to_string();
            let name = c.get("shortName")?.as_str()?.to_string();
            let term = c
                .get("term")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some(CourseItem { id, name, term })
        })
        .collect();

    Ok(courses)
}

// ---------------------------------------------------------------------------
// Canvas API — fetch modules
// ---------------------------------------------------------------------------

/// Fetch course modules (videos + wiki pages) via LMS WebviewWindow.
pub async fn fetch_modules_api(
    state: &AppState,
    course_id: &str,
) -> Result<(Vec<VideoItem>, Vec<WikiPageItem>), String> {
    // JS: learningx 모듈 목록 + wiki page body를 한 번에 fetch
    let js = format!(
        r#"
(async function() {{
    try {{
        var courseId = {course_id:?};
        var xnToken = (document.cookie.match(/xn_api_token=([^;]+)/) || [])[1] || '';
        var csrfMeta = document.querySelector('meta[name="csrf-token"]');
        var csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';

        var lxHeaders = {{Accept: 'application/json'}};
        if (xnToken) lxHeaders['Authorization'] = 'Bearer ' + xnToken;
        if (csrfToken) lxHeaders['X-CSRF-Token'] = csrfToken;

        var r = await fetch(
            'https://canvas.ssu.ac.kr/learningx/api/v1/courses/' + courseId + '/modules?include_detail=true',
            {{credentials: 'include', headers: lxHeaders}}
        );
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var modules = await r.json();

        // wiki_page 아이템에 body 추가 (병렬 fetch)
        var wikiTasks = [];
        for (var i = 0; i < modules.length; i++) {{
            var items = modules[i].module_items || [];
            for (var j = 0; j < items.length; j++) {{
                var item = items[j];
                var icd = item.content_data && item.content_data.item_content_data;
                var itemType = (icd && icd.content_type) || item.content_type || '';
                if (itemType === 'wiki_page' && item.content_data && item.content_data.url) {{
                    (function(theItem) {{
                        var slug = theItem.content_data.url;
                        var url = '/api/v1/courses/' + courseId + '/pages/' + encodeURIComponent(slug);
                        wikiTasks.push(
                            fetch(url, {{credentials: 'include', headers: {{Accept: 'application/json'}}}})
                                .then(function(pr) {{ return pr.ok ? pr.json() : null; }})
                                .then(function(pd) {{
                                    if (pd && pd.body) theItem.__wiki_body = pd.body;
                                    return null;
                                }})
                                .catch(function() {{ return null; }})
                        );
                    }})(item);
                }}
            }}
        }}
        await Promise.all(wikiTasks);

        __sendToRust({{type: 'modules', data: modules}});
    }} catch(e) {{
        __sendToRust({{type: 'modules', error: e.message}});
    }}
}})();
"#,
        course_id = course_id,
    );

    let result = eval_lms(state, "modules", &js).await?;

    if let Some(err) = result.get("error").and_then(|v| v.as_str()) {
        if err.contains("401") || err.contains("403") {
            return Err("로그인이 만료되었습니다. 다시 로그인해주세요.".into());
        }
        return Err(err.to_string());
    }

    let modules = result
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or("modules 응답 형식 오류")?;

    let mut videos: Vec<VideoItem> = Vec::new();
    let mut wiki_pages: Vec<WikiPageItem> = Vec::new();

    for module in modules {
        let items = match module.get("module_items").and_then(|v| v.as_array()) {
            Some(items) => items,
            None => continue,
        };

        for item in items {
            let item_type = item
                .pointer("/content_data/item_content_data/content_type")
                .or_else(|| item.get("content_type"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if VIDEO_TYPES.contains(&item_type) {
                let data = match item.pointer("/content_data/item_content_data") {
                    Some(d) => d,
                    None => continue,
                };
                if let Some(cid) = data.get("content_id").and_then(|v| v.as_str()) {
                    videos.push(VideoItem {
                        title: item
                            .get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        content_id: cid.to_string(),
                        duration: data.get("duration").and_then(|v| v.as_u64()).unwrap_or(0),
                        file_size: data
                            .get("total_file_size")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                        thumbnail_url: data
                            .get("thumbnail_url")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        week_position: item
                            .pointer("/content_data/week_position")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as u32,
                        available: cid != "not_open",
                    });
                }
                continue;
            }

            if item_type == "wiki_page" {
                let page_slug = match item.pointer("/content_data/url").and_then(|v| v.as_str()) {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let body = item
                    .get("__wiki_body")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let files = extract_wiki_files_from_html(body);
                if files.is_empty() {
                    continue;
                }
                let module_item_id = item
                    .get("module_item_id")
                    .map(|v| v.to_string().trim_matches('"').to_string())
                    .unwrap_or_default();
                wiki_pages.push(WikiPageItem {
                    title: item
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    course_id: course_id.to_string(),
                    week_position: item
                        .pointer("/content_data/week_position")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as u32,
                    available: true,
                    url: format!(
                        "https://canvas.ssu.ac.kr/courses/{}/pages/{}?module_item_id={}",
                        course_id, page_slug, module_item_id
                    ),
                    files,
                });
            }
        }
    }

    Ok((videos, wiki_pages))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strategy1_media_file_template() {
        let xml = r#"
        <content>
            <content_playing_info>
                <media_uri>https://example.com/[MEDIA_FILE]</media_uri>
                <story_list><story><main_media_list><main_media>lecture.mp4</main_media></main_media_list></story></story_list>
            </content_playing_info>
        </content>"#;
        assert_eq!(
            extract_media_url(xml),
            Some("https://example.com/lecture.mp4".to_string())
        );
    }

    #[test]
    fn test_strategy2_direct_mp4() {
        let xml = r#"
        <content>
            <content_playing_info>
                <media_uri>https://example.com/video.mp4</media_uri>
            </content_playing_info>
        </content>"#;
        assert_eq!(
            extract_media_url(xml),
            Some("https://example.com/video.mp4".to_string())
        );
    }

    #[test]
    fn test_strategy3_desktop_html5() {
        let xml = r#"
        <content>
            <content_playing_info>
                <media_uri>https://example.com/index.html</media_uri>
                <main_media>
                    <desktop><html5><media_uri>https://example.com/desktop.mp4</media_uri></html5></desktop>
                </main_media>
            </content_playing_info>
        </content>"#;
        assert_eq!(
            extract_media_url(xml),
            Some("https://example.com/desktop.mp4".to_string())
        );
    }

    #[test]
    fn test_strategy4_content_uri_fallback() {
        let xml = r#"
        <content>
            <content_playing_info>
                <main_media_list><main_media>lecture.mp4</main_media></main_media_list>
                <content_uri>https://example.com/web_files</content_uri>
            </content_playing_info>
        </content>"#;
        assert_eq!(
            extract_media_url(xml),
            Some("https://example.com/media_files/lecture.mp4".to_string())
        );
    }

    #[test]
    fn test_no_media_url() {
        let xml = r#"<content><content_playing_info></content_playing_info></content>"#;
        assert_eq!(extract_media_url(xml), None);
    }

    #[test]
    fn test_decode_html_entities() {
        assert_eq!(
            decode_html_entities("a&amp;b&lt;c&gt;d&quot;e&#39;f"),
            "a&b<c>d\"e'f"
        );
    }

    #[test]
    fn test_extract_wiki_files_pdf() {
        let html = r#"<a class="instructure_file_link" title="notes.pdf" href="https://canvas.ssu.ac.kr/files/123/download" data-api-endpoint="https://canvas.ssu.ac.kr/api/v1/files/123">notes.pdf</a>"#;
        let files = extract_wiki_files_from_html(html);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].title, "notes.pdf");
        assert!(files[0].api_endpoint.is_some());
    }

    #[test]
    fn test_extract_wiki_files_non_pdf_skipped() {
        let html = r#"<a class="instructure_file_link" title="image.png" href="https://canvas.ssu.ac.kr/files/123/download">image.png</a>"#;
        let files = extract_wiki_files_from_html(html);
        assert_eq!(files.len(), 0);
    }

    #[test]
    fn test_service_root_media_uri_priority() {
        let xml = r#"
        <content>
            <service_root><media><media_uri>https://example.com/[MEDIA_FILE]</media_uri></media></service_root>
            <content_playing_info>
                <media_uri>https://other.com/[MEDIA_FILE]</media_uri>
                <story_list><story><main_media_list><main_media>vid.mp4</main_media></main_media_list></story></story_list>
            </content_playing_info>
        </content>"#;
        assert_eq!(
            extract_media_url(xml),
            Some("https://example.com/vid.mp4".to_string())
        );
    }
}
