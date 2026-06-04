import re

import pysbd

# A citation marker is one or more comma-separated digit groups in brackets:
# [12], [3, 4]. The leading \s* swallows the preceding space.
_CITATION = re.compile(r"\s*\[\d+(?:\s*,\s*\d+)*\]")

_segmenter = pysbd.Segmenter(language="en", clean=False)
# pysbd's default list misses "approx" — add it so "approx. 5" isn't split.
_segmenter.language_module.Abbreviation.ABBREVIATIONS.append("approx")


def strip_citations(text: str) -> str:
    return _CITATION.sub("", text)


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _segmenter.segment(text) if s.strip()]
