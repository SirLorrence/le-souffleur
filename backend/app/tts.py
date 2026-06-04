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
