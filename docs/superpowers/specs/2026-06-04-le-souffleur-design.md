# le souffleur — Design Doc

**Date:** 2026-06-04
**Status:** Approved for planning
**One-liner:** Point it at a webpage or paper; it reads the content aloud in a clean reading view while you follow along with synced sentence + word highlighting. Single session, local-first, no accounts, no cloud.

The name (*le souffleur* — the theatrical prompter who feeds actors their lines) reflects the core experience: it reads to you while you follow along.

---

## 1. Goal & scope

Built for getting through long papers. The whole job is two hard things:

1. Get clean, correctly-ordered text out of web pages and academic papers.
2. Read it aloud with accurate follow-along highlighting.

Everything else is plumbing.

### First milestone (this build) — P0

- **Input:** enter a URL (arxiv-aware), or paste raw text.
- **TTS:** Kokoro-82M neural voices, local, on the RTX 4070 (CUDA, CPU fallback).
- **Follow-along:** current sentence highlighted; current word highlighted; auto-scroll keeps the active word centered; already-read text dimmed; click any word/sentence to start reading from there.
- **Controls:** play / pause / resume / stop; skip by sentence; speed 0.5×–4.5× live without losing position; keyboard shortcuts (space, ←/→); voice picker.
- **Layout:** Hybrid — calm single reading column, slim top control bar that doubles as a progress scrubber, collapsible outline drawer.

### Explicitly deferred (P1+, NOT this build)

PDF / Docling extraction; forced-alignment word timing (whisperX); equation / figure / footnote read-policy toggles; pitch & volume; Piper engine; multi-language; browser extension / bookmarklet; any persistence, library, resume, or cloud.

---

## 2. Architecture

> **Revised (see implementation plan):** a **Rust (axum) server** is the user-facing app and owns I/O + serving; a **Python sidecar** keeps the hard parts (extraction, Kokoro TTS). The original Python-only single-server design is preserved below struck through for context.

```
Browser (vanilla ES modules, HTML/CSS)
   │  HTTP over localhost
Rust (axum) server  [:8000]   — user-facing, stateless, no DB
   ├─ GET  /*             → serves the static frontend
   ├─ GET  /voices        → [{id, name, lang, engine}]   (static list, owned in Rust)
   ├─ POST /extract  {url | text}  → fetch (reqwest) + arxiv rewrite, proxy to sidecar
   └─ POST /synthesize {text, voice_id}  → proxy to sidecar, stream audio/wav
        │  HTTP over localhost
Python sidecar  [:8001, dedicated 3.12 venv]
   ├─ POST /extract  {html | text}  → {title, lang, segments[], outline[]}
   └─ POST /synthesize {text, voice_id}  → audio/wav
   internals: trafilatura extraction · pysbd segmentation · Kokoro TTS (CUDA→CPU)
```

**Tradeoff:** two processes (Rust binary + Python venv) talk over localhost — Kokoro keeps Python alive, so this is not a single binary, but all I/O, serving, and orchestration move to Rust. (Original Python-only design: one FastAPI process served the frontend and owned all three endpoints.)

**Stateless backend, no persistence.** The current document and reading position live in the browser tab for the session only.

### Runtime / environment

- This machine has system **Python 3.14**, which has no PyTorch/Kokoro wheels yet. The backend therefore runs in a **dedicated Python 3.12 virtualenv**.
- **espeak-ng** (Kokoro's phonemizer backend) must be installed at the system level.
- **PyTorch with CUDA (cu12x)** to run Kokoro on the RTX 4070; CPU fallback works and is still faster than real-time.
- **No ffmpeg dependency** — audio is delivered as WAV (Kokoro outputs 24 kHz mono).
- Do **not** install Ollama / LM Studio — there is no LLM in this app.

---

## 3. Backend

### 3.1 `POST /extract`

Input is `{url}` **or** `{text}`. Output:

```json
{
  "title": "string",
  "language": "en",
  "segments": [{ "id": 0, "text": "A sentence.", "paraIndex": 0, "sectionIndex": 2 }],
  "outline":  [{ "sectionIndex": 0, "title": "Introduction" }]
}
```

**Extraction pipeline:**

- **arxiv URL** → rewrite to the HTML version (ar5iv / arxiv-HTML) and parse that. Far cleaner than the PDF and avoids the two-column reading-order trap entirely.
- **Other URL** → fetch the page, run **trafilatura** for main-content extraction (fallback **readability-lxml**) to strip nav, ads, headers/footers.
- **Paste text** → used directly.

**Post-processing (all inputs):**

- Split into paragraphs, preserving heading structure for the outline.
- **Sentence-segment** each paragraph with **pysbd** (handles abbreviations and citation markers).
- Emit `segments[]` (sentence + paragraph index + section index) and `outline[]` (heading list).

**P0 paper cleanup:** drop the References / Bibliography section; strip inline citation markers (e.g. `[12]`). Equation / figure / footnote policy toggles are deferred to P1 (they mostly need the structured PDF path).

### 3.2 `POST /synthesize`

Input `{text, voice_id}` — one sentence at a time. Returns `audio/wav`.

- **No speed parameter.** Speed is applied client-side via `playbackRate`, so changing speed never triggers a re-synth and never loses position. Always synthesized at 1.0×.
- Duration is read by the client from the decoded audio (`loadedmetadata`).
- Kokoro runs on CUDA with automatic CPU fallback.

### 3.3 `GET /voices`

Returns the Kokoro presets: `[{id, name, lang, engine}]`. Default `af_heart`; also `af_bella`, `am_michael`, `bm_george`, etc. English-first for P0.

---

## 4. Frontend (vanilla ES modules, no build step)

Served as static files by FastAPI. Six modules, each with one job:

| Module | Responsibility |
|---|---|
| `api.js` | `fetch` wrappers for `/extract`, `/synthesize`, `/voices`. |
| `reader.js` | Render `segments[]` into the DOM: each sentence a `<span class="sentence">`, each word a nested `<span class="word">` (highlight + click-to-jump targets). Build the outline drawer from `outline[]`. |
| `player.js` | Playback engine. Owns the audio element + a **prefetch buffer** (`Map<sentenceId → objectURL>`). Plays sentence N; while it plays, fires synth for N+1/N+2; on `ended`, immediately plays the next buffered sentence (gapless). Handles play/pause/stop/skip/jump; revokes stale object URLs to free memory. |
| `sync.js` | Highlight controller. Pure function `wordSchedule(sentence, durationSec) → [{wordIdx, start, end}]` distributes the sentence's duration across words by character length, with extra weight after commas/periods for natural pauses. A `requestAnimationFrame` loop reads `audio.currentTime`, lights the active word, dims read sentences, and auto-scrolls to keep the active word centered. Tracking `currentTime` (not wall-clock) makes `playbackRate` changes Just Work. |
| `controls.js` | Play/pause/stop, skip-sentence, speed slider (0.5×–4.5×), voice picker; keyboard (`space` = play/pause, `←/→` = skip sentence). |
| `main.js` | Wires everything; holds session state (`segments`, `currentIndex`). |

### Audio & word-sync strategy

**On-demand per-sentence synthesis with look-ahead prefetch.** Sentence boundaries are exact (we split the text). Word boundaries are approximated by char-proportional timing within each sentence's known duration — the spec's P0 baseline. Forced alignment (whisperX) is a P1 accuracy upgrade behind the same `wordSchedule` interface.

- **Time-to-first-audio:** one sentence (well under the ~2s target).
- **Click-to-jump:** synth (or pull from buffer) the target sentence and play; `sync` re-anchors highlight + scroll.
- **Live speed change:** set `audio.playbackRate`; position preserved.

### Layout — Hybrid

Calm single reading column, serif body on a light background. A slim dark top bar carries the controls and shows the current section; a thin progress scrubber runs just beneath it. An **☰** button slides an outline drawer in over a dimmed page for jumping between sections, then tucks away. Highlight treatment: amber solid current word, soft tint current sentence, dimmed already-read text.

---

## 5. Error handling (fail soft — never hang the read)

- **Extraction empty/fails** → clear message; fall back to the paste-text box.
- **arxiv HTML unavailable** → "HTML version not found" message (PDF is the P1 follow-up); paste-text still available.
- **A sentence fails to synthesize** → log, skip that one sentence, keep playing. One bad sentence never stalls the paper.
- **Backend down / network error** → visible banner, not a silent stall.
- **Prefetch race** (next sentence not ready at `ended`) → brief "buffering" state, resume when ready.

---

## 6. Testing

- **Backend (TDD, pytest):**
  - Extraction against fixture HTML, including an arxiv fixture → References stripped, expected `segments` / `outline`.
  - Sentence-segmentation edge cases (abbreviations, citation markers).
  - `/synthesize` returns valid WAV with plausible duration.
  - `/voices` response shape.
- **`wordSchedule()` (Node built-in test runner, no build step):** the pure timing function — where ±1-word accuracy lives.
- **Manual acceptance run-through** against §7, including the offline check.

---

## 7. Acceptance criteria

- Paste an arxiv **URL** → clean body text in reading order, references/nav stripped, within a couple seconds.
- Click play → audio starts < ~2s; current word highlighted within ±1 word; view auto-scrolls to keep it centered; read text dims.
- Click a sentence mid-document → reading jumps there.
- Speed 0.5×–4.5× live without losing position.
- Outline drawer lets you jump between section headings of a long paper.
- **Offline check:** with networking disabled, reading **pasted text** + follow-along works end to end.

---

## 8. Licensing note

Kokoro is Apache 2.0; Piper (deferred fallback) is MIT — both clean for sharing. Mind these if the project is ever shared or used commercially.
