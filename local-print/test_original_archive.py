import base64
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from reportlab.pdfgen import canvas
from cached_document import find_document
from preview import preview_and_save

ORDER = '261103TEST0001'
TRACKING = 'TW0000000000001'


class OriginalArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / 'originals'
        self.jobs = self.root / 'jobs'
        self.jobs.mkdir()
        output = io.BytesIO()
        c = canvas.Canvas(output)
        c.drawString(20, 100, ORDER + ' ' + TRACKING)
        c.showPage()
        c.save()
        self.raw = output.getvalue()
        self.result = {'tracking': TRACKING, 'previewDataUrl': 'data:image/png;base64,test'}

    def acquire(self, tracking=TRACKING):
        with patch('preview.render_preview', return_value=self.result) as verify:
            result = preview_and_save(self.raw, ORDER, tracking, self.archive)
            verify.assert_called_once_with(self.raw, ORDER, tracking)
            self.assertEqual(result, self.result)

    def retrieve(self):
        with patch('cached_document.render_preview', return_value=self.result) as verify:
            result = find_document(self.jobs, ORDER, TRACKING)
            verify.assert_called_once_with(self.raw, ORDER, TRACKING)
            self.assertEqual(base64.b64decode(result['pdfBase64']), self.raw)
            return result

    def test_successful_preview_survives_without_sku_footer_or_print_job(self):
        self.acquire()
        self.assertEqual(list(self.jobs.iterdir()), [])
        self.assertEqual(self.retrieve()['source'], 'saved_original')
        self.assertEqual(len(list(self.archive.glob('*/source.pdf'))), 1)

    def test_tracking_resolved_from_barcode_is_the_persisted_identity(self):
        self.acquire('')
        metadata = json.loads(next(self.archive.glob('*/metadata.json')).read_text(encoding='utf-8'))
        self.assertEqual(metadata['tracking'], TRACKING)
        self.retrieve()

    def test_repeated_preview_keeps_one_identical_original(self):
        self.acquire()
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.archive.glob('*/*')}
        self.acquire()
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.archive.glob('*/*')})

    def test_failed_identity_or_barcode_verification_saves_nothing(self):
        with patch('preview.render_preview', side_effect=ValueError('order_changed')):
            with self.assertRaisesRegex(ValueError, 'order_changed'):
                preview_and_save(self.raw, ORDER, TRACKING, self.archive)
        self.assertFalse(self.archive.exists())

    def test_corrupted_archived_pdf_is_not_reused(self):
        self.acquire()
        next(self.archive.glob('*/source.pdf')).write_bytes(self.raw + b'changed')
        with patch('cached_document.render_preview') as verify:
            with self.assertRaisesRegex(ValueError, 'not_ready'):
                find_document(self.jobs, ORDER, TRACKING)
            verify.assert_not_called()

    def test_wrong_order_or_tracking_metadata_is_not_reused(self):
        self.acquire()
        path = next(self.archive.glob('*/metadata.json'))
        original = json.loads(path.read_text(encoding='utf-8'))
        for key, value in [('orderNo', 'OTHER'), ('tracking', 'OTHER'), ('channel', 'MOMO')]:
            path.write_text(json.dumps({**original, key: value}), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'not_ready'):
                find_document(self.jobs, ORDER, TRACKING)

    def test_archive_failure_is_not_reported_as_saved_success(self):
        with patch('preview.render_preview', return_value=self.result), patch('preview.save_original', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                preview_and_save(self.raw, ORDER, TRACKING, self.archive)


if __name__ == '__main__':
    unittest.main()
