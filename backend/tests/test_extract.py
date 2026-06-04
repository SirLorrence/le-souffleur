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
