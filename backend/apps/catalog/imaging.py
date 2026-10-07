"""Content-based validation of uploaded images.

The filename and the client's Content-Type are never trusted. The bytes are decoded with Pillow, the real format is
read from them, and the picture is re-encoded from its pixels, which drops EXIF/GPS data and any payload hidden in
metadata or appended after the image (polyglot files).
"""

import io
from dataclasses import dataclass

from django.conf import settings
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework.exceptions import ValidationError

# Pillow format name -> (our name, extension)
_FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}


@dataclass
class ProcessedImage:
    data: bytes
    format: str  # jpg | png | webp
    width: int
    height: int

    @property
    def size_bytes(self):
        return len(self.data)


def _invalid(message, code="invalid_image"):
    return ValidationError({"image": [message]}, code=code)


def process_upload(uploaded) -> ProcessedImage:
    max_bytes = settings.IMAGE_MAX_BYTES
    if uploaded.size > max_bytes:
        raise _invalid(f"Image is larger than {max_bytes // 1024} KB.", "image_too_large")
    if uploaded.size == 0:
        raise _invalid("The file is empty.")
    raw = uploaded.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise _invalid(f"Image is larger than {max_bytes // 1024} KB.", "image_too_large")

    Image.MAX_IMAGE_PIXELS = settings.IMAGE_MAX_PIXELS
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            fmt = probe.format
            probe.verify()
        if fmt not in _FORMATS or fmt.lower().replace("jpeg", "jpeg") not in _allowed():
            raise _invalid("Unsupported image type. Allowed: " + ", ".join(sorted(_allowed())) + ".", "unsupported_image_type")
        with Image.open(io.BytesIO(raw)) as img:
            if getattr(img, "is_animated", False) and getattr(img, "n_frames", 1) > 1:
                raise _invalid("Animated images are not supported.", "unsupported_image_type")
            img.load()
            img = ImageOps.exif_transpose(img)  # honour orientation before the EXIF is dropped
            width, height = img.size
            out = io.BytesIO()
            if fmt == "JPEG":
                img.convert("RGB").save(out, "JPEG", quality=88, optimize=True)
            elif fmt == "PNG":
                img.save(out, "PNG", optimize=True)
            else:
                img.save(out, "WEBP", quality=88)
    except ValidationError:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise _invalid("The file is not a valid image.")
    except Exception:  # truncated / corrupt data surfaces as many Pillow exception types
        raise _invalid("The file is not a valid image.")

    data = out.getvalue()
    if len(data) > max_bytes:
        raise _invalid(f"Image is larger than {max_bytes // 1024} KB.", "image_too_large")
    return ProcessedImage(data=data, format=_FORMATS[fmt], width=width, height=height)


def _allowed():
    return set(settings.IMAGE_ALLOWED_FORMATS) | ({"jpeg"} if "jpg" in settings.IMAGE_ALLOWED_FORMATS else set())
