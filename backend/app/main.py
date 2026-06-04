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
