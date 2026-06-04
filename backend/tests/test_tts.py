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
