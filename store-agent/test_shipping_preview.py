import io
import tempfile
import unittest
from pathlib import Path
from PIL import Image, ImageDraw
import pypdfium2 as pdfium
from shipping_preview import preview_pdf, print_pdf, _trim_preview_margin


class PreviewTests(unittest.TestCase):
    def test_preview_zoom_preserves_content_and_quiet_margin(self):
        with Image.new("RGB", (1000, 1400), "white") as image:
            draw = ImageDraw.Draw(image)
            draw.rectangle((80, 90, 379, 489), outline="black", width=2)
            # Faint text or marks must not be thresholded away.
            draw.point((430, 550), fill=(254, 254, 254))
            with _trim_preview_margin(image) as result:
                self.assertEqual(result.size, (391, 501))
                self.assertEqual(result.getpixel((20, 20)), (0, 0, 0))
                self.assertEqual(result.getpixel((370, 480)), (254, 254, 254))
                self.assertEqual(result.getpixel((0, 0)), (255, 255, 255))
            self.assertEqual(image.size, (1000, 1400))

    def test_empty_preview_keeps_original_size(self):
        with Image.new("RGB", (200, 300), "white") as image:
            with _trim_preview_margin(image) as result:
                self.assertEqual(result.size, image.size)

    def sample(self):
        output = io.BytesIO()
        with pdfium.PdfDocument.new() as pdf:
            page = pdf.new_page(200, 300)
            page.close()
            pdf.save(output)
        return output.getvalue()

    def test_preview_is_separate_from_original_and_cache_is_content_bound(self):
        content = self.sample()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            result = preview_pdf(content, root, {"platform": "EasyStore"})
            self.assertTrue(result.startswith(b"\x89PNG"))
            with Image.open(io.BytesIO(result)) as image:
                self.assertEqual(image.size, (400, 600))
            self.assertEqual(preview_pdf(content, root, {"platform": "EasyStore"}), result)
            self.assertTrue(content.startswith(b"%PDF-"))
            self.assertEqual(len(list(root.glob("preview-*.png"))), 1)

    def test_verified_hct_orientation_is_only_applied_to_preview(self):
        content = self.sample()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            result = preview_pdf(content, root, {"platform": "Coupang", "carrierCode": "TWL_HCT"})
            with Image.open(io.BytesIO(result)) as image:
                self.assertEqual(image.size, (600, 400))
            with pdfium.PdfDocument(content) as pdf:
                page = pdf[0]
                self.assertEqual(page.get_size(), (200, 300))
                self.assertEqual(page.get_rotation(), 0)
                page.close()

    def test_unreadable_pdf_does_not_prevent_original_document_download(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertIsNone(preview_pdf(b"%PDF-unreadable", Path(folder), {"platform": "MOMO"}))

    def test_print_copy_requires_owner_password_setting_and_preserves_pages(self):
        content = self.sample()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.assertIsNone(print_pdf(content, root, {"platform": "MOMO"}))
            (root / "document-settings.json").write_text('{"momoPdfPassword":"test-password"}')
            result = print_pdf(content, root, {"platform": "MOMO"})
            with pdfium.PdfDocument(result) as pdf:
                self.assertEqual(len(pdf), 1)
                page = pdf[0]
                self.assertEqual(page.get_size(), (200, 300))
                page.close()
            self.assertEqual(print_pdf(content, root, {"platform": "MOMO"}), result)
            self.assertIsNone(print_pdf(content, root, {"platform": "Coupang"}))


if __name__ == "__main__":
    unittest.main()
