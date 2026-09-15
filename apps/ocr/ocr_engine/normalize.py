"""Deterministic text normalization (NOT an LLM).

Collapses whitespace/control artifacts without merging paragraphs or inventing
missing text: lines are preserved (lists, headings, math and OCR reading order
survive), page separators collapse to one blank line, repeated spaces and tabs
collapse, and control/zero-width characters are dropped.
"""

from __future__ import annotations

import re
import unicodedata


def normalize_text(text: str) -> str:
    text = text.replace("\x0c", "\n").replace("\xa0", " ")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(
        ch for ch in text if ch == "\n" or ch == "\t" or unicodedata.category(ch)[0] != "C"
    )

    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]

    out: list[str] = []
    prev_blank = True
    for line in lines:
        if not line:
            if not prev_blank:
                out.append("")
            prev_blank = True
        else:
            out.append(line)
            prev_blank = False

    while out and not out[0]:
        out.pop(0)
    while out and not out[-1]:
        out.pop()
    return "\n".join(out)