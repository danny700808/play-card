"""Private first-page previews. Original platform documents remain unchanged."""
import hashlib
import io
import json
import threading

_render_lock = threading.Lock()  # PDFium is not thread safe.


def _trim_preview_margin(image):
    """Zoom the screen preview only, retaining all nonwhite marks and padding."""
    from PIL import Image, ImageChops
    rgb = image.convert("RGB")
    background = Image.new("RGB", rgb.size, "white")
    difference = ImageChops.difference(rgb, background)
    bounds = difference.getbbox()
    difference.close()
    background.close()
    if not bounds:
        return rgb
    padding = max(20, round(max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * .04))
    left, top, right, bottom = bounds
    result = rgb.crop((max(0, left - padding), max(0, top - padding),
                       min(rgb.width, right + padding), min(rgb.height, bottom + padding)))
    rgb.close()
    return result


def print_pdf(content, data_dir, row):
    """Unlock a print copy using the owner's password; never rasterize/reflow it."""
    if row["platform"] != "MOMO":
        return None
    settings_file = data_dir / "document-settings.json"
    if not settings_file.exists():
        return None
    password = str(json.loads(settings_file.read_text(encoding="utf-8")).get("momoPdfPassword", ""))
    if not password:
        return None
    try:
        import pypdfium2 as pdfium
        import pypdfium2.raw as raw
    except ImportError:
        return None
    digest = hashlib.sha256(content + ("print-v1:" + password).encode()).hexdigest()
    target = data_dir / f"print-{digest}.pdf"
    with _render_lock:
        if target.is_file():
            return target.read_bytes()
        try:
            output = io.BytesIO()
            with pdfium.PdfDocument(content, password=password) as pdf:
                pdf.save(output, flags=raw.FPDF_REMOVE_SECURITY)
            result = output.getvalue()
            # Fail closed if the saved copy still requires a password.
            with pdfium.PdfDocument(result) as check:
                if not len(check):
                    return None
        except pdfium.PdfiumError:
            return None
        temporary = target.with_suffix(".tmp")
        temporary.write_bytes(result)
        temporary.replace(target)
        return result


def preview_pdf(content, data_dir, row):
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return None
    settings_file = data_dir / "document-settings.json"
    settings = json.loads(settings_file.read_text(encoding="utf-8")) if settings_file.exists() else {}
    password = str(settings.get("momoPdfPassword", "")) if row["platform"] == "MOMO" else ""
    # Verified Coupang HCT PDFs contain sideways text on a portrait page.
    # Only the on-screen preview is turned upright; printing uses the original PDF.
    rotation = 270 if row["platform"] == "Coupang" and row.get("carrierCode") == "TWL_HCT" else 0
    trim = row["platform"] == "MOMO" and row.get("shippingMethod") in ("seven", "family")
    digest = hashlib.sha256(content + f"preview-v2:{rotation}:{trim}:{password}".encode()).hexdigest()
    target = data_dir / f"preview-{digest}.png"
    with _render_lock:
        if target.is_file():
            return target.read_bytes()
        try:
            with pdfium.PdfDocument(content, password=password or None) as pdf:
                if not len(pdf):
                    return None
                page = pdf[0]
                width, height = page.get_size()
                scale = min(2, 1400 / max(width, height))
                bitmap = page.render(scale=scale, rotation=rotation)
                image = bitmap.to_pil()
                if trim:
                    cropped = _trim_preview_margin(image)
                    image.close()
                    image = cropped
                output = io.BytesIO()
                image.save(output, format="PNG")
                image.close()
                bitmap.close()
                page.close()
        except pdfium.PdfiumError:
            return None
        temporary = target.with_suffix(".tmp")
        temporary.write_bytes(output.getvalue())
        temporary.replace(target)
        return output.getvalue()
