"""Image extraction: whole-image PaddleOCR (no PDF page semantics)."""

from __future__ import annotations

from io import BytesIO
from typing import TYPE_CHECKING

import numpy as np
from PIL import Image

from ocr_engine.errors import ExtractionError
from ocr_engine.paddle import ocr_image_with_retry

if TYPE_CHECKING:
    from ocr_engine.config import EngineConfig


def extract_image(content: bytes, config: EngineConfig) -> str:
    """Extract text from a PNG/JPEG/WebP image using local PaddleOCR."""
    try:
        image = Image.open(BytesIO(content)).convert("RGB")
    except Exception as exc:
        raise ExtractionError("Unreadable image", status_code=422) from exc
    return ocr_image_with_retry(np.asarray(image), 1, config)