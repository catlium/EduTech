"""Chunking behavior: small stays single, large splits, boundaries survive."""

from worker.ai.chunking import chunk_text


def test_small_document_is_single_processing_unit() -> None:
    text = "\n\n".join(f"Paragraph {i}: some words to pad this out." for i in range(4))
    chunks = chunk_text(text, max_chars=1000, overlap_chars=100)
    assert len(chunks) == 1
    assert chunks[0] == text


def test_large_document_splits_into_multiple_chunks() -> None:
    text = "\n\n".join(f"Paragraph {i}: " + "word " * 25 for i in range(60))
    chunks = chunk_text(text, max_chars=500, overlap_chars=0)
    assert len(chunks) > 1
    assert all(len(chunk) <= 500 for chunk in chunks)
    # Every paragraph survives, in order, un-split.
    positions = [next(i for i, c in enumerate(chunks) if f"Paragraph {p}:" in c) for p in range(60)]
    assert positions == sorted(positions)


def test_paragraph_boundaries_never_split_for_sized_paragraphs() -> None:
    text = "\n\n".join(f"Para {i}: " + "word " * 10 for i in range(40))
    chunks = chunk_text(text, max_chars=200, overlap_chars=0)
    # Each sized paragraph is fully contained in exactly one chunk.
    for para_no in range(40):
        para = (f"Para {para_no}: " + "word " * 10).strip()
        containing = [i for i, c in enumerate(chunks) if para in c]
        assert len(containing) == 1


def test_overlap_carries_context_across_boundary() -> None:
    text = "\n\n".join(f"Para {i}: " + "content " * 20 for i in range(30))
    chunks = chunk_text(text, max_chars=300, overlap_chars=80)
    assert len(chunks) > 1
    # The tail of a chunk is repeated at the head of the next chunk.
    assert chunks[1].startswith(chunks[0][-80:])


def test_oversized_line_hard_splits_only_as_last_resort() -> None:
    line = "x" * 500
    chunks = chunk_text(line, max_chars=120, overlap_chars=0)
    assert all(len(c) <= 120 for c in chunks)
    assert "".join(chunks) == line


def test_empty_text_returns_no_chunks() -> None:
    assert chunk_text("", max_chars=500) == []
    assert chunk_text("   \n\n  ", max_chars=500) == []


def test_invalid_arguments_rejected() -> None:
    try:
        chunk_text("x", max_chars=0)
    except ValueError:
        pass
    else:  # pragma: no cover
        raise AssertionError("max_chars=0 must raise")
    try:
        chunk_text("x", max_chars=10, overlap_chars=-1)
    except ValueError:
        pass
    else:  # pragma: no cover
        raise AssertionError("negative overlap must raise")