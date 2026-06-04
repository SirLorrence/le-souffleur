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
