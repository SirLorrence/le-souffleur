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
