use std::env;

use axum::{
    extract::State,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use axum::http::{header, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tower_http::services::ServeDir;

mod arxiv;

#[derive(Clone)]
struct AppState {
    client: reqwest::Client,
    tts_url: String,
}

#[derive(Serialize)]
struct Voice {
    id: &'static str,
    name: &'static str,
    lang: &'static str,
    engine: &'static str,
}

fn voices() -> Vec<Voice> {
    vec![
        Voice { id: "af_heart", name: "Heart (US, female)", lang: "en-us", engine: "kokoro" },
        Voice { id: "af_bella", name: "Bella (US, female)", lang: "en-us", engine: "kokoro" },
        Voice { id: "am_michael", name: "Michael (US, male)", lang: "en-us", engine: "kokoro" },
        Voice { id: "bm_george", name: "George (UK, male)", lang: "en-gb", engine: "kokoro" },
    ]
}

async fn get_voices() -> Json<Vec<Voice>> {
    Json(voices())
}

#[derive(Deserialize)]
struct ExtractBody {
    url: Option<String>,
    text: Option<String>,
    html: Option<String>,
    source_url: Option<String>,
}

async fn post_extract(State(st): State<AppState>, Json(body): Json<ExtractBody>) -> Response {
    // Build the payload the Python sidecar expects: {text} or {html, source_url}.
    let payload: Value = if let Some(text) = body.text.filter(|t| !t.trim().is_empty()) {
        json!({ "text": text })
    } else if let Some(html) = body.html.filter(|h| !h.trim().is_empty()) {
        json!({ "html": html, "source_url": body.source_url.unwrap_or_default() })
    } else if let Some(url) = body.url.filter(|u| !u.trim().is_empty()) {
        match arxiv::fetch_html(&st.client, &url).await {
            Ok(html) => json!({ "html": html, "source_url": url }),
            Err(msg) => {
                return (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({ "detail": msg })))
                    .into_response()
            }
        }
    } else {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "detail": "Provide url, text, or html" })),
        )
            .into_response();
    };

    match st
        .client
        .post(format!("{}/extract", st.tts_url))
        .json(&payload)
        .send()
        .await
    {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let bytes = resp.bytes().await.unwrap_or_default();
            (status, [(header::CONTENT_TYPE, "application/json")], bytes).into_response()
        }
        Err(_) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "detail": "Extraction service unavailable" })),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct SynthBody {
    text: String,
    #[serde(default = "default_voice")]
    voice_id: String,
}

fn default_voice() -> String {
    "af_heart".to_string()
}

async fn post_synthesize(State(st): State<AppState>, Json(body): Json<SynthBody>) -> Response {
    match st
        .client
        .post(format!("{}/synthesize", st.tts_url))
        .json(&json!({ "text": body.text, "voice_id": body.voice_id }))
        .send()
        .await
    {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let bytes = resp.bytes().await.unwrap_or_default();
            (status, [(header::CONTENT_TYPE, "audio/wav")], bytes).into_response()
        }
        Err(_) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "detail": "TTS service unavailable" })),
        )
            .into_response(),
    }
}

#[tokio::main]
async fn main() {
    let tts_url =
        env::var("SOUFFLEUR_TTS_URL").unwrap_or_else(|_| "http://127.0.0.1:8001".to_string());
    let frontend_dir =
        env::var("SOUFFLEUR_FRONTEND").unwrap_or_else(|_| "../frontend".to_string());
    let port = env::var("SOUFFLEUR_PORT").unwrap_or_else(|_| "8000".to_string());

    let state = AppState { client: reqwest::Client::new(), tts_url };

    let app = Router::new()
        .route("/voices", get(get_voices))
        .route("/extract", post(post_extract))
        .route("/synthesize", post(post_synthesize))
        .fallback_service(ServeDir::new(&frontend_dir).append_index_html_on_directories(true))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .unwrap();
    println!("le souffleur on http://localhost:{port}");
    axum::serve(listener, app).await.unwrap();
}
