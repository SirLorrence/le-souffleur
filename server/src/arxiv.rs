use reqwest::Client;

/// If `url` is an arxiv abs/pdf/html link, return the canonical arxiv HTML URL.
pub fn arxiv_html_url(url: &str) -> Option<String> {
    for marker in ["arxiv.org/abs/", "arxiv.org/pdf/", "arxiv.org/html/"] {
        if let Some(pos) = url.find(marker) {
            let rest = &url[pos + marker.len()..];
            let end = rest.find(['?', '#']).unwrap_or(rest.len());
            let id = rest[..end].strip_suffix(".pdf").unwrap_or(&rest[..end]);
            if id.is_empty() {
                return None;
            }
            return Some(format!("https://arxiv.org/html/{id}"));
        }
    }
    None
}

/// HTML-source candidates to try in order: arxiv HTML, ar5iv, then the original.
pub fn candidates(url: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(html) = arxiv_html_url(url) {
        out.push(html.clone()); // official arxiv HTML first
        out.push(html.replace("https://arxiv.org/html/", "https://ar5iv.labs.arxiv.org/html/"));
    }
    out.push(url.to_string());
    out
}

/// Fetch the first candidate returning 200 with a non-empty body. Returns HTML.
pub async fn fetch_html(client: &Client, url: &str) -> Result<String, String> {
    for candidate in candidates(url) {
        if let Ok(resp) = client
            .get(&candidate)
            .header("User-Agent", "le-souffleur/0.1 (local reader)")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(text) = resp.text().await {
                    if !text.is_empty() {
                        return Ok(text);
                    }
                }
            }
        }
    }
    Err("Could not fetch the page.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abs_url_rewrites_to_html() {
        assert_eq!(
            arxiv_html_url("https://arxiv.org/abs/1706.03762").as_deref(),
            Some("https://arxiv.org/html/1706.03762")
        );
    }

    #[test]
    fn pdf_url_strips_suffix() {
        assert_eq!(
            arxiv_html_url("https://arxiv.org/pdf/1706.03762.pdf").as_deref(),
            Some("https://arxiv.org/html/1706.03762")
        );
    }

    #[test]
    fn query_and_fragment_are_trimmed() {
        assert_eq!(
            arxiv_html_url("https://arxiv.org/abs/2401.00001v2?foo=bar#sec").as_deref(),
            Some("https://arxiv.org/html/2401.00001v2")
        );
    }

    #[test]
    fn non_arxiv_returns_none() {
        assert!(arxiv_html_url("https://example.com/paper").is_none());
    }

    #[test]
    fn candidates_includes_ar5iv_and_original() {
        let c = candidates("https://arxiv.org/abs/1234.5678");
        assert!(c.iter().any(|u| u.contains("ar5iv.labs.arxiv.org")));
        assert!(c.iter().any(|u| u == "https://arxiv.org/abs/1234.5678"));
    }
}
