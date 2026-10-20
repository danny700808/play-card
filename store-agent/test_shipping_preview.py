import io
import tempfile
import unittest
from pathlib import Path
from PIL import Image
import pypdfium2 as pdfium
from shipping_preview import preview_pdf, print_pdf


class PreviewTests(unittest.TestCase):
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
