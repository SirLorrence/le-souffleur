import pytest
import io
import wave
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
