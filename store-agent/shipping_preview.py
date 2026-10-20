"""Private first-page previews. Original platform documents remain unchanged."""
import hashlib
import io
import json
import threading

_render_lock = threading.Lock()  # PDFium is not thread safe.


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
    digest = hashlib.sha256(content + f"preview-v1:{rotation}:{password}".encode()).hexdigest()
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
