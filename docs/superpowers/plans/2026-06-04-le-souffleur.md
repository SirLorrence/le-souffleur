# le souffleur Implementation Plan (Rust front + Python sidecar)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local-first web app that reads webpages and pasted text aloud with synced sentence + word follow-along highlighting, built for getting through long papers.

**Architecture:** A **Rust (`axum`) server** on `:8000` is the user-facing app — it serves the vanilla-JS frontend, owns the static `/voices` list, performs arxiv URL rewriting + page fetching (`reqwest`), and proxies `/extract` and `/synthesize` to a **Python sidecar** on `:8001`. The Python sidecar keeps the hard parts: `trafilatura`/`pysbd` extraction and Kokoro TTS (WAV encoding stays next to the model). The frontend plays sentences on demand with a look-ahead prefetch buffer and drives highlighting via char-proportional timing against `audio.currentTime`.

**Tradeoff (accepted):** two processes talk over localhost. Python stays alive for Kokoro, so this is not a single binary — but all I/O, serving, and orchestration are Rust.

**Tech Stack:** Rust (axum, tokio, tower-http, reqwest, serde); Python 3.12 (FastAPI, uvicorn, trafilatura, pysbd, Kokoro-82M on PyTorch CUDA, soundfile); vanilla HTML/CSS/JS (ES modules). Tests: `cargo test`, `pytest`, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-06-04-le-souffleur-design.md` (architecture there describes the earlier Python-only design; this plan supersedes it with the Rust-front split).

---

## Coordination protocol (READ FIRST — two workers share this doc)

Every task is tagged with an owner:

- **[QWEN]** — easy, fully-specified, mechanical work (scaffolding, pure functions with tests provided, HTML/CSS transcription, simple wiring). Qwen implements these directly from the code in this doc.
- **[CLAUDE]** — harder work requiring judgment, integration, or correctness reasoning (I/O/proxy/streaming, extraction reading-order, TTS/model, the sync + player state machines, cross-module glue).

Rules:
1. **Only implement tasks tagged for you.** Check the box on each step as you complete it.
2. **Respect `Depends on`.** Do not start a task until the tasks it depends on are committed.
3. **One owner per file.** The task list is arranged so owners touch disjoint files. Never edit a file another owner is mid-task on.
4. **[QWEN] escape hatch:** if a [QWEN] task's tests won't pass after one honest attempt, or it requires a judgment call not spelled out here, STOP and leave a note — do not guess. A [CLAUDE] pass will pick it up.
5. **Commit per task** with the message given in the task's final step.

**Dependency / ownership overview:**

| Task | Owner | Depends on | Files |
|---|---|---|---|
| P1 Python env + scaffold | CLAUDE | — | `backend/` skeleton, `.gitignore`, `README.md` |
| P2 Request models | QWEN | P1 | `backend/app/models.py` |
| P3 Segmentation | QWEN | P1 | `backend/app/segment.py` |
| P4 Extraction | CLAUDE | P3 | `backend/app/extract.py` |
| P5 TTS | CLAUDE | P1 | `backend/app/tts.py` |
| P6 Python service | QWEN | P2,P4,P5 | `backend/app/main.py` |
| R1 Rust scaffold + static + /voices | QWEN | — | `server/Cargo.toml`, `server/src/main.rs` |
| R2 arxiv URL rewrite | QWEN | R1 | `server/src/arxiv.rs` |
| R3 fetch + proxy handlers | CLAUDE | R1,R2 | `server/src/main.rs`, `server/src/arxiv.rs` |
| F1 Layout shell | QWEN | — | `frontend/index.html`, `frontend/styles.css` |
| F2 API client | QWEN | — | `frontend/js/api.js` |
| F3 Word-timing + sync | CLAUDE | — | `frontend/js/sync.js`, `frontend/test/sync.test.js` |
| F4 Reader rendering | CLAUDE | — | `frontend/js/reader.js` |
| F5 Player + prefetch | CLAUDE | F2 | `frontend/js/player.js` |
| F6 Controls | QWEN | — | `frontend/js/controls.js` |
| F7 Bootstrap wiring | CLAUDE | F1–F6,R1 | `frontend/js/main.js` |
| D1 Run scripts + acceptance | CLAUDE | all | `dev.sh`, run-through |

---

## File Structure

```
le-souffleur/
  .gitignore
  README.md
  dev.sh                        # runs Python sidecar + Rust server together
  backend/                      # Python sidecar (internal, :8001)
    pyproject.toml
    app/
      __init__.py
      models.py                 # {html|text} + synth request models
      segment.py                # citation stripping + sentence segmentation (pure)
      extract.py                # html/text -> {title, language, segments, outline}  (NO fetch)
      tts.py                    # Kokoro wrapper, voice list, wav encoding
      main.py                   # FastAPI: /extract, /synthesize  (no static, no /voices)
    tests/
      test_segment.py
      test_extract.py
      test_tts.py
      test_api.py
  server/                       # Rust user-facing server (:8000)
    Cargo.toml
    src/
      main.rs                   # axum app: /voices, /extract, /synthesize, static fallback
      arxiv.rs                  # arxiv URL rewrite + reqwest fetch (+ unit tests)
  frontend/                     # vanilla ES modules, served by Rust
    index.html
    styles.css
    js/
      api.js
      sync.js
      reader.js
      player.js
      controls.js
      main.js
    test/
      sync.test.js
```

**Backend test command convention:** run from `backend/` so `pyproject.toml`'s `pythonpath = ["."]` resolves `app`:
`cd /home/laurence-zeromatter/side-quests/le-souffleur/backend && .venv/bin/pytest <args>`

**Rust test command convention:** run from `server/`:
`cd /home/laurence-zeromatter/side-quests/le-souffleur/server && cargo test`

---

## Task P1 — Python env + project scaffold  **[CLAUDE]**

**Depends on:** none.
**Files:** `.gitignore`, `README.md`, `dev.sh`, `backend/pyproject.toml`, `backend/app/__init__.py`

- [ ] **Step 1: Init git and directory tree**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git init
mkdir -p backend/app backend/tests server/src frontend/js frontend/test
touch backend/app/__init__.py
```

- [ ] **Step 2: Write `.gitignore`**

```
# Python
backend/.venv/
__pycache__/
*.pyc
.pytest_cache/

# Rust
server/target/

# Brainstorm scratch
.superpowers/

# OS / editor
.DS_Store
```

- [ ] **Step 3: Write `backend/pyproject.toml`**

```toml
[project]
name = "le-souffleur-backend"
version = "0.1.0"
requires-python = ">=3.12,<3.13"

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
# Skip the slow real-Kokoro tests by default; run them with `-m integration`.
addopts = "-m 'not integration'"
markers = [
    "integration: tests that run real Kokoro synthesis (slow, needs model download)",
]
```

- [ ] **Step 4: Write `README.md`**

````markdown
# le souffleur

Local-first reader: point it at a URL or paste text, and it reads the content
aloud with synced sentence + word follow-along highlighting. Built for getting
through long papers. Single session — no accounts, no cloud.

Architecture: a Rust (axum) server on :8000 serves the frontend and proxies to a
Python sidecar on :8001 that does extraction (trafilatura/pysbd) and Kokoro TTS.

## Setup (one time)

System dependency (Kokoro's phonemizer backend):

```bash
sudo apt install espeak-ng
```

Python sidecar (dedicated 3.12 venv — system Python 3.14 has no PyTorch/Kokoro
wheels yet; [uv](https://docs.astral.sh/uv/) manages 3.12):

```bash
cd backend
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python torch --index-url https://download.pytorch.org/whl/cu124
uv pip install --python .venv/bin/python kokoro soundfile fastapi "uvicorn[standard]" \
    trafilatura readability-lxml lxml pysbd pytest
```

Rust server needs a stable toolchain (`rustup`).

## Run

```bash
./dev.sh        # starts the Python sidecar (:8001) and the Rust server (:8000)
```

Open http://localhost:8000

## Test

```bash
cd backend && .venv/bin/pytest                  # python (skips integration)
cd backend && .venv/bin/pytest -m integration   # real Kokoro synthesis
cd server && cargo test                          # rust
node --test frontend/test                        # frontend pure logic
```
````

- [ ] **Step 5: Write `dev.sh` (run both processes)**

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Python sidecar on :8001
( cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --port 8001 ) &
PY_PID=$!
trap 'kill $PY_PID 2>/dev/null || true' EXIT

# Rust server on :8000 (serves the frontend, proxies to the sidecar)
cd "$ROOT/server"
SOUFFLEUR_FRONTEND="$ROOT/frontend" SOUFFLEUR_TTS_URL="http://127.0.0.1:8001" \
    cargo run --release
```

Then: `chmod +x /home/laurence-zeromatter/side-quests/le-souffleur/dev.sh`

- [ ] **Step 6: Create the Python 3.12 environment**

```bash
command -v uv || curl -LsSf https://astral.sh/uv/install.sh | sh
cd /home/laurence-zeromatter/side-quests/le-souffleur/backend
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python torch --index-url https://download.pytorch.org/whl/cu124
uv pip install --python .venv/bin/python kokoro soundfile fastapi "uvicorn[standard]" \
    trafilatura readability-lxml lxml pysbd pytest
sudo apt install -y espeak-ng
```

- [ ] **Step 7: Verify Python + CUDA**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur/backend
.venv/bin/python -c "import sys, torch; print(sys.version.split()[0]); print('cuda:', torch.cuda.is_available())"
```

Expected: a `3.12.x` version and `cuda: True` (CPU fallback is fine if `False`).

- [ ] **Step 8: Verify the Rust toolchain**

```bash
rustc --version && cargo --version
```

Expected: both print versions. If missing: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`.

- [ ] **Step 9: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add .gitignore README.md dev.sh backend/pyproject.toml backend/app/__init__.py
git commit -m "chore: project scaffold, env setup, run script"
```

---

## Task P2 — Request models  **[QWEN]**

**Depends on:** P1.
**Files:** Create `backend/app/models.py`; Create `backend/tests/test_api.py`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_api.py`:

```python
import pytest
from pydantic import ValidationError
from app.models import ExtractRequest, SynthRequest


def test_extract_request_requires_html_or_text():
    with pytest.raises(ValidationError):
        ExtractRequest()


def test_extract_request_accepts_text_only():
    req = ExtractRequest(text="hello world")
    assert req.text == "hello world"
    assert req.html is None


def test_extract_request_accepts_html():
    req = ExtractRequest(html="<p>hi</p>", source_url="https://x.test")
    assert req.html == "<p>hi</p>"
    assert req.source_url == "https://x.test"


def test_synth_request_defaults_voice():
    assert SynthRequest(text="hello").voice_id == "af_heart"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/laurence-zeromatter/side-quests/le-souffleur/backend && .venv/bin/pytest tests/test_api.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models'`.

- [ ] **Step 3: Write `backend/app/models.py`**

```python
from typing import Optional

from pydantic import BaseModel, model_validator


class ExtractRequest(BaseModel):
    """The Rust server sends either fetched `html` (for URLs) or raw `text`."""

    html: Optional[str] = None
    text: Optional[str] = None
    source_url: Optional[str] = None

    @model_validator(mode="after")
    def _one_required(self) -> "ExtractRequest":
        if not ((self.html and self.html.strip()) or (self.text and self.text.strip())):
            raise ValueError("Provide either html or text")
        return self


class SynthRequest(BaseModel):
    text: str
    voice_id: str = "af_heart"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/laurence-zeromatter/side-quests/le-souffleur/backend && .venv/bin/pytest tests/test_api.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add backend/app/models.py backend/tests/test_api.py
git commit -m "feat: request models for extract and synthesize"
```

---

## Task P3 — Sentence segmentation (pure)  **[QWEN]**

**Depends on:** P1.
**Files:** Create `backend/app/segment.py`; Create `backend/tests/test_segment.py`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_segment.py`:

```python
from app.segment import strip_citations, split_sentences


def test_strip_citations_removes_bracketed_numbers():
    assert strip_citations("As shown [12] and prior work [3, 4].") == "As shown and prior work."


def test_strip_citations_leaves_other_brackets():
    assert strip_citations("The set [a, b] is small.") == "The set [a, b] is small."


def test_split_sentences_basic():
    assert split_sentences("First sentence. Second one here.") == [
        "First sentence.",
        "Second one here.",
    ]


def test_split_sentences_handles_abbreviations():
    assert split_sentences("We used approx. 5 layers. It worked.") == [
        "We used approx. 5 layers.",
        "It worked.",
    ]


def test_split_sentences_drops_empty():
    assert split_sentences("   ") == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/laurence-zeromatter/side-quests/le-souffleur/backend && .venv/bin/pytest tests/test_segment.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.segment'`.

- [ ] **Step 3: Write `backend/app/segment.py`**

```python
import re

import pysbd

# A citation marker is one or more comma-separated digit groups in brackets:
# [12], [3, 4]. The leading \s* swallows the preceding space.
_CITATION = re.compile(r"\s*\[\d+(?:\s*,\s*\d+)*\]")

_segmenter = pysbd.Segmenter(language="en", clean=False)


def strip_citations(text: str) -> str:
    return _CITATION.sub("", text)


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _segmenter.segment(text) if s.strip()]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/laurence-zeromatter/side-quests/le-souffleur/backend && .venv/bin/pytest tests/test_segment.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add backend/app/segment.py backend/tests/test_segment.py
git commit -m "feat: citation stripping and sentence segmentation"
```

---

## Task P4 — Extraction (markdown parsing + html/text entry points)  **[CLAUDE]**

**Depends on:** P3.
**Files:** Create `backend/app/extract.py`; Create `backend/tests/test_extract.py`.

This module does **not** fetch — the Rust server fetches and passes HTML. The accuracy-critical pure unit is `markdown_to_segments`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_extract.py`:

```python
import pytest
from app.extract import markdown_to_segments, extract, extract_from_text, ExtractionError


SAMPLE_MD = """# A Sample Paper

## 1 Introduction

Neural readers help people. We build one here [1].

## 2 Method

We train an encoder. It is fast.

## References

[1] Someone. A paper. 2020.
"""


def test_markdown_to_segments_splits_sentences():
    segments, _ = markdown_to_segments(SAMPLE_MD)
    texts = [s["text"] for s in segments]
    assert "Neural readers help people." in texts
    assert "We build one here." in texts  # citation stripped
    assert "We train an encoder." in texts
    assert "It is fast." in texts


def test_markdown_to_segments_drops_references():
    segments, outline = markdown_to_segments(SAMPLE_MD)
    joined = " ".join(s["text"] for s in segments)
    assert "Someone" not in joined
    assert all(o["title"] != "References" for o in outline)


def test_markdown_to_segments_builds_outline_and_sections():
    segments, outline = markdown_to_segments(SAMPLE_MD)
    assert [o["title"] for o in outline] == ["1 Introduction", "2 Method"]
    section_ids = {o["sectionIndex"] for o in outline}
    assert {s["sectionIndex"] for s in segments} <= section_ids


def test_markdown_to_segments_sequential_ids():
    segments, _ = markdown_to_segments(SAMPLE_MD)
    assert [s["id"] for s in segments] == list(range(len(segments)))


def test_extract_from_text():
    result = extract_from_text("Hello there. This is plain text.")
    assert result["language"] == "en"
    assert [s["text"] for s in result["segments"]] == [
        "Hello there.",
        "This is plain text.",
    ]


def test_extract_dispatches_text():
    result = extract(text="One. Two.")
    assert [s["text"] for s in result["segments"]] == ["One.", "Two."]


def test_extract_requires_input():
    with pytest.raises(ExtractionError):
        extract()


def test_extract_from_html_uses_trafilatura(monkeypatch):
    monkeypatch.setattr("app.extract.trafilatura.extract", lambda *a, **k: SAMPLE_MD)
    monkeypatch.setattr("app.extract.trafilatura.extract_metadata", lambda html: None)
    from app.extract import extract_from_html
    result = extract_from_html("<html>ignored</html>", source_url="https://arxiv.org/abs/x")
    assert any(s["text"] == "We train an encoder." for s in result["segments"])
    assert result["title"]  # falls back to source_url when metadata is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/laurence-zeromatter/side-quests/le-souffleur/backend && .venv/bin/pytest tests/test_extract.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.extract'`.

- [ ] **Step 3: Write `backend/app/extract.py`**

```python
import re
from typing import Optional

import trafilatura

from .segment import split_sentences, strip_citations

_REFERENCE_WORDS = {"references", "bibliography", "acknowledgements", "acknowledgments"}
_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


class ExtractionError(Exception):
    """Raised when content cannot be extracted."""


def _is_reference_heading(title: str) -> bool:
    words = title.split()
    if not words:
        return False
    return re.sub(r"[^a-z]", "", words[0].lower()) in _REFERENCE_WORDS


def markdown_to_segments(markdown: str):
    """Parse markdown into (segments, outline).

    Headings (`# ..`) start sections and populate the outline; content before
    the first heading is section 0. Everything from a References/Bibliography
    heading onward is dropped.
    """
    segments: list[dict] = []
    outline: list[dict] = []
    seg_id = 0
    para_index = 0
    current_section = 0

    for raw in markdown.splitlines():
        line = raw.strip()
        if not line:
            continue
        heading = _HEADING.match(line)
        if heading:
            title = heading.group(2).strip()
            if _is_reference_heading(title):
                break
            current_section = len(outline) + 1
            outline.append({"sectionIndex": current_section, "title": title})
            continue
        for sentence in split_sentences(strip_citations(line)):
            segments.append(
                {
                    "id": seg_id,
                    "text": sentence,
                    "paraIndex": para_index,
                    "sectionIndex": current_section,
                }
            )
            seg_id += 1
        para_index += 1

    return segments, outline


def _result(title: str, markdown: str, language: str = "en") -> dict:
    segments, outline = markdown_to_segments(markdown)
    return {"title": title, "language": language, "segments": segments, "outline": outline}


def extract_from_text(text: str) -> dict:
    title = text.strip().splitlines()[0][:80] if text.strip() else "Pasted text"
    return _result(title, text)


def extract_from_html(html: str, source_url: Optional[str] = None) -> dict:
    markdown = trafilatura.extract(
        html, output_format="markdown", include_formatting=True, favor_recall=True
    )
    if not markdown:
        raise ExtractionError("Could not extract readable content from the page.")
    title = source_url or "Untitled"
    meta = trafilatura.extract_metadata(html)
    if meta and meta.title:
        title = meta.title
    return _result(title, markdown)


def extract(html: Optional[str] = None, text: Optional[str] = None,
            source_url: Optional[str] = None) -> dict:
    if text and text.strip():
        return extract_from_text(text)
    if html and html.strip():
        return extract_from_html(html, source_url=source_url)
    raise ExtractionError("Provide either html or text.")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/laurence-zeromatter/side-quests/le-souffleur/backend && .venv/bin/pytest tests/test_extract.py -v`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add backend/app/extract.py backend/tests/test_extract.py
git commit -m "feat: extraction (markdown parsing, html/text entry points, references stripping)"
```

---

## Task P5 — TTS (Kokoro wrapper + WAV encoding)  **[CLAUDE]**

**Depends on:** P1.
**Files:** Create `backend/app/tts.py`; Create `backend/tests/test_tts.py`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_tts.py`:

```python
import io
import wave

import numpy as np
import pytest

from app import tts


def test_list_voices_includes_default():
    voices = tts.list_voices()
    assert "af_heart" in {v["id"] for v in voices}
    for v in voices:
        assert {"id", "name", "lang", "engine"} <= set(v)


def test_to_wav_bytes_roundtrip_duration():
    sr = tts.SAMPLE_RATE
    data = tts.to_wav_bytes(np.zeros(sr, dtype=np.float32), sr)  # 1 second
    with wave.open(io.BytesIO(data)) as w:
        assert w.getframerate() == sr
        assert w.getnframes() == sr
        assert w.getnchannels() == 1


def test_to_wav_bytes_empty_is_valid():
    data = tts.to_wav_bytes(np.zeros(0, dtype=np.float32), tts.SAMPLE_RATE)
    with wave.open(io.BytesIO(data)) as w:
        assert w.getnframes() == 0


@pytest.mark.integration
def test_synthesize_real_audio():
    samples, sr = tts.synthesize("Hello world.", "af_heart")
    assert sr == tts.SAMPLE_RATE
    assert samples.shape[0] > sr * 0.2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/laurence-zeromatter/side-quests/le-souffleur/backend && .venv/bin/pytest tests/test_tts.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.tts'`.

- [ ] **Step 3: Write `backend/app/tts.py`**

```python
import io

import numpy as np
import soundfile as sf

SAMPLE_RATE = 24000

VOICES = [
    {"id": "af_heart", "name": "Heart (US, female)", "lang": "en-us", "engine": "kokoro"},
    {"id": "af_bella", "name": "Bella (US, female)", "lang": "en-us", "engine": "kokoro"},
    {"id": "am_michael", "name": "Michael (US, male)", "lang": "en-us", "engine": "kokoro"},
    {"id": "bm_george", "name": "George (UK, male)", "lang": "en-gb", "engine": "kokoro"},
]

# KPipeline is created lazily and cached per language code so the model loads
# once. lang_code 'a' = American English, 'b' = British.
_pipelines: dict[str, object] = {}


def list_voices() -> list[dict]:
    return VOICES


def _get_pipeline(lang_code: str):
    if lang_code not in _pipelines:
        from kokoro import KPipeline

        _pipelines[lang_code] = KPipeline(lang_code=lang_code)
    return _pipelines[lang_code]


def synthesize(text: str, voice_id: str):
    """Synthesize one sentence. Returns (float32 mono samples, sample_rate)."""
    pipeline = _get_pipeline(voice_id[0])  # 'a' or 'b'
    chunks = [
        np.asarray(audio, dtype=np.float32)
        for _, _, audio in pipeline(text, voice=voice_id)
    ]
    if not chunks:
        return np.zeros(0, dtype=np.float32), SAMPLE_RATE
    return np.concatenate(chunks), SAMPLE_RATE


def to_wav_bytes(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> bytes:
    buffer = io.BytesIO()
    sf.write(buffer, samples, sample_rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()
```

- [ ] **Step 4: Run unit tests**

Run: `cd /home/laurence-zeromatter/side-quests/le-souffleur/backend && .venv/bin/pytest tests/test_tts.py -v`
Expected: 3 passed, 1 deselected.

- [ ] **Step 5: Run the integration test once (real Kokoro)**

Run: `cd /home/laurence-zeromatter/side-quests/le-souffleur/backend && .venv/bin/pytest tests/test_tts.py -m integration -v`
Expected: downloads the model on first run, then PASS. (If it fails on `espeak`, confirm `espeak-ng` from P1.)

- [ ] **Step 6: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add backend/app/tts.py backend/tests/test_tts.py
git commit -m "feat: Kokoro TTS wrapper and WAV encoding"
```

---

## Task P6 — Python service (`/extract`, `/synthesize`)  **[QWEN]**

**Depends on:** P2, P4, P5.
**Files:** Create `backend/app/main.py`; append route tests to `backend/tests/test_api.py`.

This is the internal sidecar — no static serving, no `/voices` (Rust owns those).

- [ ] **Step 1: Append the failing tests to `backend/tests/test_api.py`**

Add to `backend/tests/test_api.py`:

```python
import io
import wave

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_extract_endpoint_text():
    resp = client.post("/extract", json={"text": "One. Two."})
    assert resp.status_code == 200
    assert [s["text"] for s in resp.json()["segments"]] == ["One.", "Two."]


def test_extract_endpoint_requires_input():
    resp = client.post("/extract", json={})
    assert resp.status_code == 422


def test_extract_endpoint_reports_failure(monkeypatch):
    def boom(**kwargs):
        from app.extract import ExtractionError
        raise ExtractionError("Could not extract readable content from the page.")
    monkeypatch.setattr("app.extract.extract", boom)
    resp = client.post("/extract", json={"html": "<p></p>"})
    assert resp.status_code == 422
    assert "extract" in resp.json()["detail"].lower()


def test_synthesize_endpoint_returns_wav(monkeypatch):
    import numpy as np
    monkeypatch.setattr(
        "app.tts.synthesize",
        lambda text, voice_id: (np.zeros(12000, dtype=np.float32), 24000),
    )
    resp = client.post("/synthesize", json={"text": "Hi.", "voice_id": "af_heart"})
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "audio/wav"
    with wave.open(io.BytesIO(resp.content)) as w:
        assert w.getframerate() == 24000
        assert w.getnframes() == 12000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/laurence-zeromatter/side-quests/le-souffleur/backend && .venv/bin/pytest tests/test_api.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.main'`.

- [ ] **Step 3: Write `backend/app/main.py`**

```python
from fastapi import FastAPI, HTTPException, Response

from . import extract as extract_mod
from . import tts
from .models import ExtractRequest, SynthRequest

app = FastAPI(title="le souffleur (sidecar)")


@app.post("/extract")
def post_extract(req: ExtractRequest) -> dict:
    try:
        return extract_mod.extract(html=req.html, text=req.text, source_url=req.source_url)
    except extract_mod.ExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.post("/synthesize")
def post_synthesize(req: SynthRequest) -> Response:
    samples, sample_rate = tts.synthesize(req.text, req.voice_id)
    return Response(content=tts.to_wav_bytes(samples, sample_rate), media_type="audio/wav")
```

- [ ] **Step 4: Run the full backend suite**

Run: `cd /home/laurence-zeromatter/side-quests/le-souffleur/backend && .venv/bin/pytest -v`
Expected: all pass, 1 deselected (integration).

- [ ] **Step 5: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add backend/app/main.py backend/tests/test_api.py
git commit -m "feat: Python sidecar service (extract, synthesize)"
```

---

## Task R1 — Rust scaffold + static serving + `/voices`  **[QWEN]**

**Depends on:** none.
**Files:** Create `server/Cargo.toml`, `server/src/main.rs`.

- [ ] **Step 1: Write `server/Cargo.toml`**

```toml
[package]
name = "souffleur-server"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
tower-http = { version = "0.5", features = ["fs"] }
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 2: Write `server/src/main.rs` (scaffold: state, /voices, static fallback; placeholder handlers)**

```rust
use std::env;

use axum::{
    extract::State,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
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

// Proxy handlers are filled in by Task R3.
async fn post_extract(State(_st): State<AppState>) -> Response {
    (axum::http::StatusCode::NOT_IMPLEMENTED, "extract: see Task R3").into_response()
}

async fn post_synthesize(State(_st): State<AppState>) -> Response {
    (axum::http::StatusCode::NOT_IMPLEMENTED, "synthesize: see Task R3").into_response()
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
```

- [ ] **Step 3: Create a placeholder `arxiv.rs` so it compiles (Task R2 fills it)**

Create `server/src/arxiv.rs`:

```rust
// Filled in by Task R2.
```

- [ ] **Step 4: Build and run, verify /voices and static serving**

```bash
mkdir -p /home/laurence-zeromatter/side-quests/le-souffleur/frontend
echo "<!doctype html><title>le souffleur</title><h1>placeholder</h1>" \
    > /home/laurence-zeromatter/side-quests/le-souffleur/frontend/index.html
cd /home/laurence-zeromatter/side-quests/le-souffleur/server
SOUFFLEUR_FRONTEND=../frontend cargo run &
sleep 5
curl -s http://localhost:8000/voices
curl -s http://localhost:8000/ | head -1
kill %1
```

Expected: `/voices` returns the JSON array including `af_heart`; `/` returns the placeholder HTML.

- [ ] **Step 5: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add server/Cargo.toml server/Cargo.lock server/src/main.rs server/src/arxiv.rs
git commit -m "feat: rust server scaffold, static serving, voices endpoint"
```

---

## Task R2 — arxiv URL rewrite (pure, tested)  **[QWEN]**

**Depends on:** R1.
**Files:** Modify `server/src/arxiv.rs`.

- [ ] **Step 1: Write `server/src/arxiv.rs` with functions + failing tests**

Replace `server/src/arxiv.rs` with:

```rust
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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /home/laurence-zeromatter/side-quests/le-souffleur/server && cargo test`
Expected: 5 tests pass (the unused `fetch_html` may warn — that's fine; R3 uses it).

- [ ] **Step 3: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add server/src/arxiv.rs
git commit -m "feat: arxiv url rewrite and html fetch helper"
```

---

## Task R3 — Fetch + proxy handlers  **[CLAUDE]**

**Depends on:** R1, R2.
**Files:** Modify `server/src/main.rs`.

- [ ] **Step 1: Replace the placeholder handlers in `server/src/main.rs`**

Add imports at the top (merge with existing `use` block):

```rust
use axum::http::{header, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
```

Replace `post_extract` and `post_synthesize` with:

```rust
#[derive(Deserialize)]
struct ExtractBody {
    url: Option<String>,
    text: Option<String>,
}

async fn post_extract(State(st): State<AppState>, Json(body): Json<ExtractBody>) -> Response {
    // Build the payload the Python sidecar expects: {text} or {html, source_url}.
    let payload: Value = if let Some(text) = body.text.filter(|t| !t.trim().is_empty()) {
        json!({ "text": text })
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
            Json(json!({ "detail": "Provide url or text" })),
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
```

- [ ] **Step 2: Build**

Run: `cd /home/laurence-zeromatter/side-quests/le-souffleur/server && cargo build`
Expected: compiles cleanly (warnings OK).

- [ ] **Step 3: Integration check against the running Python sidecar**

```bash
# Terminal A: Python sidecar
cd /home/laurence-zeromatter/side-quests/le-souffleur/backend && .venv/bin/uvicorn app.main:app --port 8001
# Terminal B:
cd /home/laurence-zeromatter/side-quests/le-souffleur/server && SOUFFLEUR_FRONTEND=../frontend cargo run
# Terminal C:
curl -s -X POST http://localhost:8000/extract -H 'Content-Type: application/json' \
  -d '{"text":"One. Two."}'
```

Expected: JSON with two segments (`"One."`, `"Two."`) — proving the Rust→Python `/extract` proxy works. (`/synthesize` is exercised end-to-end in D1.)

- [ ] **Step 4: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add server/src/main.rs
git commit -m "feat: rust extract/synthesize proxy handlers with url fetch"
```

---

## Task F1 — Frontend layout shell (Hybrid)  **[QWEN]**

**Depends on:** none.
**Files:** Create `frontend/index.html` (replaces the R1 placeholder), `frontend/styles.css`.

- [ ] **Step 1: Write `frontend/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>le souffleur</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <section id="start" class="start">
    <h1>le souffleur</h1>
    <p class="tagline">Paste a URL or some text. It reads to you while you follow along.</p>
    <input id="url-input" type="url" placeholder="https://arxiv.org/abs/…  (or leave blank and paste below)">
    <textarea id="text-input" placeholder="…or paste raw text here"></textarea>
    <button id="load-btn">Read this</button>
    <p id="start-error" class="error" hidden></p>
  </section>

  <main id="reader" class="reader" hidden>
    <header class="topbar">
      <button id="outline-btn" class="icon" title="Outline" aria-label="Toggle outline">&#9776;</button>
      <span class="sep"></span>
      <button id="prev-btn" class="icon" title="Previous sentence (←)">&#9664;&#9664;</button>
      <button id="play-btn" class="icon play" title="Play / pause (space)">&#9658;</button>
      <button id="next-btn" class="icon" title="Next sentence (→)">&#9654;&#9654;</button>
      <button id="stop-btn" class="icon" title="Stop">&#9632;</button>
      <span class="sep"></span>
      <label class="speed">
        <span id="speed-label">1.0×</span>
        <input id="speed-input" type="range" min="0.5" max="4.5" step="0.1" value="1.0">
      </label>
      <span class="sep"></span>
      <select id="voice-select" title="Voice"></select>
      <span id="section-label" class="section-label"></span>
    </header>
    <div class="scrubber"><div id="scrubber-fill" class="scrubber-fill"></div></div>

    <aside id="drawer" class="drawer" hidden>
      <div class="drawer-title">Outline</div>
      <nav id="outline-nav"></nav>
    </aside>
    <div id="drawer-scrim" class="drawer-scrim" hidden></div>

    <article id="content" class="content"></article>
  </main>

  <script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `frontend/styles.css`**

```css
:root {
  --bg: #fbfaf7;
  --ink: #222;
  --sentence: #fff3c4;
  --word: #f5b301;
  --bar: #1f1f1f;
  --bar-ink: #fff;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: Georgia, "Times New Roman", serif;
}

.start { max-width: 640px; margin: 12vh auto 0; padding: 0 24px; text-align: center; }
.start h1 { font-size: 2.4rem; margin-bottom: 0.2em; }
.tagline { color: #666; margin-bottom: 1.6em; }
.start input, .start textarea {
  width: 100%; font: inherit; font-size: 1rem; padding: 12px 14px; margin-bottom: 12px;
  border: 1px solid #d8d4ca; border-radius: 8px; background: #fff;
}
.start textarea { min-height: 160px; resize: vertical; }
#load-btn {
  font: inherit; font-size: 1rem; padding: 12px 28px; border: none; border-radius: 8px;
  background: var(--bar); color: var(--bar-ink); cursor: pointer;
}
.error { color: #b00020; }

.topbar {
  position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 12px;
  height: 44px; padding: 0 14px; background: var(--bar); color: var(--bar-ink);
  font-family: system-ui, sans-serif; font-size: 0.85rem;
}
.topbar .icon { background: none; border: none; color: var(--bar-ink); cursor: pointer; font-size: 1rem; padding: 4px 6px; }
.topbar .icon.play { font-size: 1.2rem; }
.topbar .sep { width: 1px; height: 20px; background: rgba(255,255,255,0.25); }
.speed { display: flex; align-items: center; gap: 8px; }
.speed input { width: 120px; }
#voice-select { font: inherit; font-size: 0.8rem; }
.section-label { margin-left: auto; opacity: 0.6; }

.scrubber { position: sticky; top: 44px; z-index: 5; height: 3px; background: #e7e3da; }
.scrubber-fill { height: 3px; width: 0; background: var(--word); transition: width 0.1s linear; }

.content { max-width: 680px; margin: 40px auto 50vh; padding: 0 24px; font-size: 1.18rem; line-height: 1.95; }
.content h2.heading { font-size: 1.4rem; margin: 1.6em 0 0.6em; }
.content p { margin: 0 0 1em; }

.sentence { border-radius: 3px; }
.sentence.read { opacity: 0.35; }
.sentence.active { background: var(--sentence); }
.word { cursor: pointer; border-radius: 3px; padding: 0 1px; }
.word.active { background: var(--word); color: #000; }

.drawer {
  position: fixed; top: 47px; left: 0; bottom: 0; width: 320px; max-width: 80vw; z-index: 7;
  background: #f0eee8; border-right: 1px solid #d8d4ca; box-shadow: 6px 0 18px rgba(0,0,0,0.18);
  padding: 16px; overflow-y: auto; font-family: system-ui, sans-serif;
}
.drawer-title { font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.5; margin-bottom: 10px; }
#outline-nav a { display: block; padding: 5px 8px; border-radius: 4px; color: #444; text-decoration: none; font-size: 0.9rem; line-height: 1.6; }
#outline-nav a.current { background: var(--word); color: #000; font-weight: 600; }
.drawer-scrim { position: fixed; inset: 47px 0 0 0; z-index: 6; background: rgba(251, 250, 247, 0.55); }

[hidden] { display: none !important; }
```

- [ ] **Step 3: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add frontend/index.html frontend/styles.css
git commit -m "feat: frontend layout shell (Hybrid reading view + start screen)"
```

---

## Task F2 — API client (`api.js`)  **[QWEN]**

**Depends on:** none.
**Files:** Create `frontend/js/api.js`.

- [ ] **Step 1: Write `frontend/js/api.js`**

```javascript
// Thin fetch wrappers around the Rust server. All return Promises.

export async function extract({ url, text }) {
  const resp = await fetch("/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url || null, text: text || null }),
  });
  if (!resp.ok) {
    let detail = `Extraction failed (${resp.status})`;
    try {
      const body = await resp.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch (_) { /* keep default */ }
    throw new Error(detail);
  }
  return resp.json();
}

export async function getVoices() {
  const resp = await fetch("/voices");
  if (!resp.ok) throw new Error(`Could not load voices (${resp.status})`);
  return resp.json();
}

// Returns an object URL for the synthesized sentence's WAV audio.
export async function synthesizeUrl(text, voiceId) {
  const resp = await fetch("/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: voiceId }),
  });
  if (!resp.ok) throw new Error(`Synthesis failed (${resp.status})`);
  return URL.createObjectURL(await resp.blob());
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add frontend/js/api.js
git commit -m "feat: frontend API client"
```

---

## Task F3 — Word-timing schedule + sync controller  **[CLAUDE]**

**Depends on:** none.
**Files:** Create `frontend/js/sync.js`, `frontend/test/sync.test.js`.

- [ ] **Step 1: Write the failing test**

Create `frontend/test/sync.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { wordSchedule } from "../js/sync.js";

test("schedule has one slot per word", () => {
  assert.equal(wordSchedule(["one", "two", "three"], 3).length, 3);
});

test("schedule starts at zero and ends at duration", () => {
  const s = wordSchedule(["one", "two", "three"], 3);
  assert.equal(s[0].start, 0);
  assert.ok(Math.abs(s.at(-1).end - 3) < 1e-9);
});

test("schedule is monotonic and contiguous", () => {
  const s = wordSchedule(["alpha", "b", "gamma", "d"], 4);
  for (let i = 0; i < s.length; i++) {
    assert.ok(s[i].end >= s[i].start);
    if (i > 0) assert.ok(Math.abs(s[i].start - s[i - 1].end) < 1e-9);
  }
});

test("longer words get more time than shorter words", () => {
  const s = wordSchedule(["a", "elephant"], 2);
  assert.ok(s[1].end - s[1].start > s[0].end - s[0].start);
});

test("a sentence-final period adds extra dwell time", () => {
  const plain = wordSchedule(["cat", "cat"], 2);
  const ended = wordSchedule(["cat", "cat."], 2);
  assert.ok(ended[1].end - ended[1].start > plain[1].end - plain[1].start);
});

test("empty word list returns empty schedule", () => {
  assert.deepEqual(wordSchedule([], 3), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test /home/laurence-zeromatter/side-quests/le-souffleur/frontend/test`
Expected: FAIL — cannot find `wordSchedule`.

- [ ] **Step 3: Write `frontend/js/sync.js` (pure function first)**

```javascript
// Distribute a sentence's audio duration across its words by character length,
// with extra dwell after punctuation. Pure and unit-tested.
export function wordSchedule(words, durationSec) {
  if (words.length === 0) return [];

  const weights = words.map((w) => {
    let weight = Math.max(w.replace(/[^\p{L}\p{N}]/gu, "").length, 1);
    if (/[,;:]$/.test(w)) weight += 2;
    if (/[.!?]["')\]]?$/.test(w)) weight += 4;
    return weight;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return weights.map((weight) => {
    const slot = { start: t, end: t + (weight / total) * durationSec };
    t = slot.end;
    return slot;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test /home/laurence-zeromatter/side-quests/le-souffleur/frontend/test`
Expected: 6 passing.

- [ ] **Step 5: Append the `SyncController` to `frontend/js/sync.js`**

```javascript
// Drives sentence/word highlighting and auto-scroll against audio playback.
export class SyncController {
  constructor(audio, reader, { onProgress } = {}) {
    this.audio = audio;
    this.reader = reader;
    this.onProgress = onProgress || (() => {});
    this._schedule = [];
    this._words = [];
    this._activeWord = -1;
    this._rafId = null;
    this._tick = this._tick.bind(this);
    // Resume the highlight loop on any playback resume (button, keyboard,
    // end-of-sentence advance). _loop cancels the pending frame first, so this
    // never double-ticks.
    this.audio.addEventListener("play", () => {
      if (this._schedule.length) this._loop();
    });
  }

  beginSentence(segmentId, words) {
    this._clearWord();
    this._words = this.reader.wordElements(segmentId);
    this._schedule = wordSchedule(words, this.audio.duration || 0.0001);
    this._activeWord = -1;
    this.reader.markActiveSentence(segmentId);
    this._loop();
  }

  _loop() {
    cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame(this._tick);
  }

  _tick() {
    const t = this.audio.currentTime;
    let idx = this._schedule.findIndex((s) => t >= s.start && t < s.end);
    if (idx === -1 && t >= (this._schedule.at(-1)?.end ?? 0)) {
      idx = this._schedule.length - 1;
    }
    if (idx !== -1 && idx !== this._activeWord) this._setActiveWord(idx);
    if (this.audio.duration) this.onProgress(this.audio.currentTime / this.audio.duration);
    if (!this.audio.paused && !this.audio.ended) this._loop();
  }

  _setActiveWord(idx) {
    this._clearWord();
    const el = this._words[idx];
    if (el) {
      el.classList.add("active");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    this._activeWord = idx;
  }

  _clearWord() {
    if (this._activeWord >= 0 && this._words[this._activeWord]) {
      this._words[this._activeWord].classList.remove("active");
    }
  }

  stop() {
    cancelAnimationFrame(this._rafId);
    this._clearWord();
  }
}
```

- [ ] **Step 6: Re-run pure tests**

Run: `node --test /home/laurence-zeromatter/side-quests/le-souffleur/frontend/test`
Expected: 6 passing.

- [ ] **Step 7: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add frontend/js/sync.js frontend/test/sync.test.js
git commit -m "feat: word-timing schedule and sync controller"
```

---

## Task F4 — Reader rendering (`reader.js`)  **[CLAUDE]**

**Depends on:** none.
**Files:** Create `frontend/js/reader.js`.

- [ ] **Step 1: Write `frontend/js/reader.js`**

```javascript
// Renders segments into the content element and exposes element lookups.
export class Reader {
  constructor(contentEl, outlineNavEl) {
    this.contentEl = contentEl;
    this.outlineNavEl = outlineNavEl;
    this._sentenceEls = new Map();   // segmentId -> sentence span
    this._wordEls = new Map();       // segmentId -> [word spans]
    this._sectionAnchors = new Map();// sectionIndex -> heading element
    this._onWordClick = () => {};
    this._onSectionJump = () => {};
  }

  onWordClick(fn) { this._onWordClick = fn; }
  onSectionJump(fn) { this._onSectionJump = fn; }

  render(segments, outline) {
    this.contentEl.innerHTML = "";
    this._sentenceEls.clear();
    this._wordEls.clear();
    this._sectionAnchors.clear();

    const titleBySection = new Map(outline.map((o) => [o.sectionIndex, o.title]));
    let currentPara = null;
    let lastPara = -1;
    let lastSection = -1;

    for (const seg of segments) {
      if (seg.sectionIndex !== lastSection) {
        lastSection = seg.sectionIndex;
        const title = titleBySection.get(seg.sectionIndex);
        if (title) {
          const h = document.createElement("h2");
          h.className = "heading";
          h.textContent = title;
          this.contentEl.appendChild(h);
          this._sectionAnchors.set(seg.sectionIndex, h);
        }
        currentPara = null;
        lastPara = -1;
      }
      if (seg.paraIndex !== lastPara) {
        currentPara = document.createElement("p");
        this.contentEl.appendChild(currentPara);
        lastPara = seg.paraIndex;
      }
      currentPara.appendChild(this._buildSentence(seg));
      currentPara.appendChild(document.createTextNode(" "));
    }

    this._buildOutline(outline);
  }

  _buildSentence(seg) {
    const span = document.createElement("span");
    span.className = "sentence";
    span.dataset.segId = seg.id;
    const wordEls = [];
    const words = seg.text.split(/\s+/).filter(Boolean);
    words.forEach((word, i) => {
      const w = document.createElement("span");
      w.className = "word";
      w.textContent = word;
      w.addEventListener("click", () => this._onWordClick(seg.id));
      span.appendChild(w);
      if (i < words.length - 1) span.appendChild(document.createTextNode(" "));
      wordEls.push(w);
    });
    this._sentenceEls.set(seg.id, span);
    this._wordEls.set(seg.id, wordEls);
    return span;
  }

  _buildOutline(outline) {
    this.outlineNavEl.innerHTML = "";
    for (const o of outline) {
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = o.title;
      a.dataset.sectionIndex = o.sectionIndex;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        this._onSectionJump(o.sectionIndex);
      });
      this.outlineNavEl.appendChild(a);
    }
  }

  wordElements(segmentId) { return this._wordEls.get(segmentId) || []; }
  sentenceElement(segmentId) { return this._sentenceEls.get(segmentId); }

  firstSegmentOfSection(segments, sectionIndex) {
    const seg = segments.find((s) => s.sectionIndex === sectionIndex);
    return seg ? seg.id : 0;
  }

  markActiveSentence(segmentId) {
    for (const [id, el] of this._sentenceEls) {
      el.classList.remove("active");
      el.classList.toggle("read", Number(id) < Number(segmentId));
    }
    const active = this._sentenceEls.get(segmentId);
    if (active) { active.classList.add("active"); active.classList.remove("read"); }
  }

  highlightOutline(sectionIndex) {
    for (const a of this.outlineNavEl.querySelectorAll("a")) {
      a.classList.toggle("current", Number(a.dataset.sectionIndex) === Number(sectionIndex));
    }
  }

  scrollToSection(sectionIndex) {
    const el = this._sectionAnchors.get(sectionIndex);
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add frontend/js/reader.js
git commit -m "feat: reader rendering, sentence/word spans, outline drawer"
```

---

## Task F5 — Playback engine + prefetch (`player.js`)  **[CLAUDE]**

**Depends on:** F2.
**Files:** Create `frontend/js/player.js`.

- [ ] **Step 1: Write `frontend/js/player.js`**

```javascript
import { synthesizeUrl } from "./api.js";

const PREFETCH_AHEAD = 2;

export class Player {
  constructor(segments, { getVoice, onSentenceStart, onEnded, onBuffering } = {}) {
    this.segments = segments;
    this.getVoice = getVoice || (() => "af_heart");
    this.onSentenceStart = onSentenceStart || (() => {});
    this.onEnded = onEnded || (() => {});
    this.onBuffering = onBuffering || (() => {});

    this.audio = new Audio();
    this.audio.preload = "auto";
    this.index = 0;
    this.speed = 1.0;
    this._buffer = new Map(); // segmentId -> objectURL
    this._playing = false;

    this.audio.addEventListener("ended", () => this._advance());
  }

  setSpeed(rate) {
    this.speed = rate;
    this.audio.playbackRate = rate;
  }

  async _ensure(index) {
    if (index < 0 || index >= this.segments.length) return null;
    const seg = this.segments[index];
    if (this._buffer.has(seg.id)) return this._buffer.get(seg.id);
    try {
      const url = await synthesizeUrl(seg.text, this.getVoice());
      this._buffer.set(seg.id, url);
      return url;
    } catch (err) {
      console.warn("synthesis failed for segment", seg.id, err);
      return null;
    }
  }

  _prefetch() {
    for (let i = 1; i <= PREFETCH_AHEAD; i++) this._ensure(this.index + i);
  }

  _trim() {
    const keepFrom = this.segments[this.index].id - 1;
    for (const [id, url] of this._buffer) {
      if (id < keepFrom) {
        URL.revokeObjectURL(url);
        this._buffer.delete(id);
      }
    }
  }

  async playFrom(index) {
    if (index < 0 || index >= this.segments.length) return;
    this.index = index;
    this._playing = true;
    this.onBuffering(true);
    const url = await this._ensure(index);
    this.onBuffering(false);
    if (!url) { this._advance(); return; }          // skip a failed sentence
    if (!this._playing || this.index !== index) return; // superseded by a jump
    this.audio.src = url;
    this.audio.playbackRate = this.speed;
    await this.audio.play();
    const seg = this.segments[index];
    this.onSentenceStart(seg, seg.text.split(/\s+/).filter(Boolean));
    this._prefetch();
    this._trim();
  }

  _advance() {
    if (!this._playing) return;
    if (this.index + 1 >= this.segments.length) {
      this._playing = false;
      this.onEnded();
      return;
    }
    this.playFrom(this.index + 1);
  }

  play() {
    if (this.audio.src && this.audio.paused && !this.audio.ended) {
      this._playing = true;
      this.audio.play();
    } else {
      this.playFrom(this.index);
    }
  }

  pause() { this._playing = false; this.audio.pause(); }
  isPaused() { return this.audio.paused; }

  stop() {
    this._playing = false;
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  next() { this.playFrom(this.index + 1); }
  prev() { this.playFrom(Math.max(0, this.index - 1)); }
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add frontend/js/player.js
git commit -m "feat: playback engine with look-ahead prefetch buffer"
```

---

## Task F6 — Controls + keyboard (`controls.js`)  **[QWEN]**

**Depends on:** none.
**Files:** Create `frontend/js/controls.js`.

- [ ] **Step 1: Write `frontend/js/controls.js`**

```javascript
// Wires the top-bar controls and keyboard shortcuts to the player.
export function wireControls({ player, els, onVoiceChange }) {
  const setPlayIcon = () => {
    els.playBtn.innerHTML = player.isPaused() ? "&#9658;" : "&#10073;&#10073;";
  };

  const togglePlay = () => {
    if (player.isPaused()) player.play();
    else player.pause();
    setPlayIcon();
  };

  els.playBtn.addEventListener("click", togglePlay);
  els.nextBtn.addEventListener("click", () => { player.next(); setPlayIcon(); });
  els.prevBtn.addEventListener("click", () => { player.prev(); setPlayIcon(); });
  els.stopBtn.addEventListener("click", () => { player.stop(); setPlayIcon(); });

  els.speedInput.addEventListener("input", () => {
    const rate = parseFloat(els.speedInput.value);
    player.setSpeed(rate);
    els.speedLabel.textContent = `${rate.toFixed(1)}×`;
  });

  els.voiceSelect.addEventListener("change", () => onVoiceChange(els.voiceSelect.value));

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.code === "ArrowRight") { e.preventDefault(); player.next(); setPlayIcon(); }
    else if (e.code === "ArrowLeft") { e.preventDefault(); player.prev(); setPlayIcon(); }
  });

  player.audio.addEventListener("play", setPlayIcon);
  player.audio.addEventListener("pause", setPlayIcon);

  return { setPlayIcon };
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add frontend/js/controls.js
git commit -m "feat: playback controls and keyboard shortcuts"
```

---

## Task F7 — Bootstrap & wiring (`main.js`)  **[CLAUDE]**

**Depends on:** F1–F6, R1.
**Files:** Create `frontend/js/main.js`.

- [ ] **Step 1: Write `frontend/js/main.js`**

```javascript
import { extract, getVoices } from "./api.js";
import { Reader } from "./reader.js";
import { Player } from "./player.js";
import { SyncController } from "./sync.js";
import { wireControls } from "./controls.js";

const $ = (id) => document.getElementById(id);
const state = { segments: [], outline: [], voice: "af_heart" };

async function init() {
  try {
    const voices = await getVoices();
    const select = $("voice-select");
    for (const v of voices) {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.name;
      select.appendChild(opt);
    }
    state.voice = voices[0]?.id || "af_heart";
    select.value = state.voice;
  } catch (err) {
    console.warn("voices unavailable", err);
  }
  $("load-btn").addEventListener("click", loadDocument);
}

async function loadDocument() {
  const url = $("url-input").value.trim();
  const text = $("text-input").value.trim();
  const errEl = $("start-error");
  errEl.hidden = true;
  if (!url && !text) {
    errEl.textContent = "Enter a URL or paste some text.";
    errEl.hidden = false;
    return;
  }
  $("load-btn").disabled = true;
  $("load-btn").textContent = "Loading…";
  try {
    const doc = await extract({ url, text });
    if (!doc.segments.length) throw new Error("No readable content found.");
    state.segments = doc.segments;
    state.outline = doc.outline;
    startReader();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    $("load-btn").disabled = false;
    $("load-btn").textContent = "Read this";
  }
}

function sectionTitleFor(sectionIndex) {
  const o = state.outline.find((o) => o.sectionIndex === sectionIndex);
  return o ? o.title : "";
}

function startReader() {
  $("start").hidden = true;
  $("reader").hidden = false;

  const reader = new Reader($("content"), $("outline-nav"));
  reader.render(state.segments, state.outline);

  const player = new Player(state.segments, {
    getVoice: () => state.voice,
    onBuffering: (on) => {
      if (on) $("section-label").textContent = "buffering…";
    },
    onSentenceStart: (seg, words) => {
      sync.beginSentence(seg.id, words);
      reader.highlightOutline(seg.sectionIndex);
      $("section-label").textContent = sectionTitleFor(seg.sectionIndex);
    },
    onEnded: () => { $("section-label").textContent = "done"; },
  });

  const sync = new SyncController(player.audio, reader, {
    onProgress: (frac) => { $("scrubber-fill").style.width = `${Math.min(100, frac * 100)}%`; },
  });

  const controls = wireControls({
    player,
    els: {
      playBtn: $("play-btn"), nextBtn: $("next-btn"), prevBtn: $("prev-btn"),
      stopBtn: $("stop-btn"), speedInput: $("speed-input"), speedLabel: $("speed-label"),
      voiceSelect: $("voice-select"),
    },
    onVoiceChange: (id) => { state.voice = id; },
  });

  reader.onWordClick((segmentId) => {
    player.playFrom(state.segments.findIndex((s) => s.id === segmentId));
    controls.setPlayIcon();
  });

  const openDrawer = () => { $("drawer").hidden = false; $("drawer-scrim").hidden = false; };
  const closeDrawer = () => { $("drawer").hidden = true; $("drawer-scrim").hidden = true; };

  reader.onSectionJump((sectionIndex) => {
    const id = reader.firstSegmentOfSection(state.segments, sectionIndex);
    reader.scrollToSection(sectionIndex);
    closeDrawer();
    player.playFrom(state.segments.findIndex((s) => s.id === id));
    controls.setPlayIcon();
  });

  $("outline-btn").addEventListener("click", () => {
    if ($("drawer").hidden) openDrawer(); else closeDrawer();
  });
  $("drawer-scrim").addEventListener("click", closeDrawer);
}

init();
```

- [ ] **Step 2: Commit**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add frontend/js/main.js
git commit -m "feat: bootstrap and wiring — end-to-end reading loop"
```

---

## Task D1 — Acceptance run-through  **[CLAUDE]**

**Depends on:** all tasks.
**Files:** none (verification + any small fixes).

- [ ] **Step 1: Run all automated tests**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur/backend && .venv/bin/pytest -v
cd /home/laurence-zeromatter/side-quests/le-souffleur/backend && .venv/bin/pytest -m integration -v
cd /home/laurence-zeromatter/side-quests/le-souffleur/server && cargo test
node --test /home/laurence-zeromatter/side-quests/le-souffleur/frontend/test
```

Expected: all green.

- [ ] **Step 2: Start both processes and walk the acceptance criteria**

```bash
/home/laurence-zeromatter/side-quests/le-souffleur/dev.sh
```

Open http://localhost:8000 and verify:
- [ ] Paste an arxiv **URL** (e.g. `https://arxiv.org/abs/1706.03762`) → clean body in reading order; References/nav stripped; appears within a couple seconds.
- [ ] Click play → audio starts < ~2s; current word highlighted within ±1 word; auto-scrolls to keep it centered; read text dims.
- [ ] Click a sentence mid-document → reading jumps there.
- [ ] Speed slider 0.5×–4.5× changes pace live without losing position.
- [ ] Outline drawer (☰) jumps between section headings.

- [ ] **Step 3: Offline check**

Disable networking, restart `dev.sh`, paste raw text (no URL), confirm reading + follow-along works end to end (Kokoro + extraction are local; only URL fetch needs the network).

- [ ] **Step 4: Commit any fixes**

```bash
cd /home/laurence-zeromatter/side-quests/le-souffleur
git add -A
git commit -m "test: acceptance run-through and fixes"
```

---

## Notes for implementers

- **Reading order is the whole point.** If an arxiv paper reads out of order or includes references, inspect the markdown trafilatura produced (`trafilatura.extract(html, output_format="markdown")`) before touching `markdown_to_segments`.
- **Word-sync drift** is expected — char-proportional timing is the P0 baseline. Forced alignment (whisperX) is the P1 upgrade and slots in behind `wordSchedule`/`SyncController`.
- **First-run latency:** Kokoro downloads ~300 MB on the first `synthesize`; the first sentence after a cold start is slow, the rest are fast.
- **Two processes:** the Rust server is useless without the Python sidecar running. `dev.sh` starts both; if you run them by hand, start the sidecar (`:8001`) first.
- **CPU fallback:** if `torch.cuda.is_available()` is False, everything still works on CPU (still faster than real-time).
```
