# le souffleur

Local-first reader: point it at a URL or paste text, and it reads the content
aloud with synced sentence + word follow-along highlighting. Built for getting
through long papers. Single session — no accounts, no cloud.

Architecture: a Rust (axum) server on :8000 serves the frontend and proxies to a
Python sidecar on :8001 that does extraction (trafilatura/pysbd) and Kokoro TTS.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) (manages the Python 3.12 venv; can fetch 3.12 itself)
- A Rust toolchain ([rustup](https://rustup.rs))
- `espeak-ng` (Kokoro's phonemizer backend) — `sudo apt install espeak-ng`
- Node.js (only for the frontend unit tests)
- An NVIDIA GPU is **optional** — CPU works (still faster than real-time)

## Setup (one time)

```bash
sudo apt install espeak-ng
```

Python sidecar (dedicated 3.12 venv — a system Python newer than 3.12 may lack
PyTorch/Kokoro wheels; `uv` pins 3.12):

```bash
cd backend
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python torch --index-url https://download.pytorch.org/whl/cu124
uv pip install --python .venv/bin/python kokoro soundfile fastapi "uvicorn[standard]" \
    trafilatura readability-lxml lxml pysbd "transformers<5" pytest
```

**No NVIDIA GPU?** Drop the `--index-url …/cu124` flag on the torch line to get the
CPU build. `transformers<5` is required: transformers 5.x needs torch 2.7+ symbols
and breaks Kokoro's import on torch 2.6.

Rust server needs a stable toolchain (`rustup`).

On first `/synthesize`, Kokoro downloads its model (~300 MB) to the Hugging Face
cache; the first sentence after a cold start is slow, the rest are fast.

## Run

```bash
./dev.sh        # starts the Python sidecar (:8001) and the Rust server (:8000)
```

Open http://localhost:8000

## Chrome extension (read any page, no pasting)

A Manifest-V3 side-panel reader that reads the page you're on. It talks to the
local app, so `./dev.sh` must be running.

```bash
extension/build.sh     # copy the shared reader modules into extension/lib/
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select the `extension/` folder. Click the toolbar icon on any page
to open the side panel, then **▶ Read this page**.

Re-run `extension/build.sh` whenever the frontend JS changes.

## Test

```bash
cd backend && .venv/bin/pytest                  # python (skips integration)
cd backend && .venv/bin/pytest -m integration   # real Kokoro synthesis
cd server && cargo test                          # rust
node --test 'frontend/test/**/*.test.js'         # frontend pure logic
```

## Moving to a new machine

Everything needed lives in git. These are **not** committed and regenerate from
the steps above, so don't copy them: `backend/.venv/`, `server/target/`,
`extension/lib/`, and the Kokoro model (re-downloads on first synth).

To carry the full history as one file (no remote needed):

```bash
# on the old machine
git bundle create le-souffleur.bundle --all
# move le-souffleur.bundle to the new machine, then:
git clone le-souffleur.bundle le-souffleur && cd le-souffleur
```

Then follow **Prerequisites** → **Setup** → **Run**. Rebuild the extension libs
with `extension/build.sh` before loading it unpacked.
