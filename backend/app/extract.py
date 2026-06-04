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
    seen_heading = False

    for raw in markdown.splitlines():
        line = raw.strip()
        if not line:
            continue
        heading = _HEADING.match(line)
        if heading:
            level = len(heading.group(1))
            title = heading.group(2).strip()
            if _is_reference_heading(title):
                break
            # A leading top-level (#) heading is the document title, not a
            # navigable section — skip it from the outline. Later headings
            # (including subsequent H1s) become sections.
            if not seen_heading and level == 1:
                seen_heading = True
                continue
            seen_heading = True
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
