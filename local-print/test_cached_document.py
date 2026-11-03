import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from reportlab.pdfgen import canvas
from cached_document import find_document

ORDER = '261103TEST0001'
TRACKING = 'TW0000000000001'


class CachedDocumentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.jobs = Path(self.temp.name)
        self.folder = self.jobs / 'job'
        self.folder.mkdir()
        output = io.BytesIO()
        page = canvas.Canvas(output)
        page.drawString(20, 100, ORDER + ' ' + TRACKING)
        page.showPage()
        page.save()
        self.raw = output.getvalue()
        (self.folder / 'source.pdf').write_bytes(self.raw)
        self.digest = hashlib.sha256('蝦皮'.encode() + b'\0' + self.raw).hexdigest()
        self.state = {'status': 'submitted', 'digest': 'layout-hash', 'sourceDigest': self.digest}
        self.preview = patch('cached_document.render_preview', return_value={'tracking': TRACKING})
        self.render = self.preview.start()
        self.addCleanup(self.preview.stop)

    def save(self):
        (self.folder / 'status.json').write_text(json.dumps(self.state), encoding='utf-8')

    def test_footer_jobs_recover_original_without_mutating_files(self):
        for status in ('preview', 'prepared', 'submitted', 'uncertain', 'submitting'):
            with self.subTest(status=status):
                self.state['status'] = status
                self.save()
                before = {p.name: p.read_bytes() for p in self.folder.iterdir()}
                result = find_document(self.jobs, ORDER, TRACKING)
                self.assertEqual(result['source'], 'saved_original')
                self.assertEqual(result['tracking'], TRACKING)
                self.assertEqual(before, {p.name: p.read_bytes() for p in self.folder.iterdir()})
        self.render.assert_called_with(self.raw, ORDER, TRACKING)

    def test_legacy_jobs_still_work(self):
        self.state = {'status': 'submitted', 'digest': self.digest}
        self.save()
        self.assertEqual(find_document(self.jobs, ORDER, TRACKING)['source'], 'saved_original')

    def test_wrong_channel_or_changed_source_is_rejected(self):
        for digest in ('tampered', hashlib.sha256('MOMO'.encode() + b'\0' + self.raw).hexdigest()):
            self.state['sourceDigest'] = digest
            self.save()
            with self.assertRaisesRegex(ValueError, 'not_ready'):
                find_document(self.jobs, ORDER, TRACKING)
        self.render.assert_not_called()

    def test_other_order_and_tracking_cannot_be_returned(self):
        self.save()
        for order, tracking in [('261103AAAAAAAA', TRACKING), (ORDER, 'TW0000000000000')]:
            with self.assertRaisesRegex(ValueError, 'not_ready'):
                find_document(self.jobs, order, tracking)
        self.render.assert_not_called()

    def test_failed_or_incomplete_jobs_are_not_reused(self):
        for status in ('failed', 'preparing', 'superseded'):
            self.state['status'] = status
            self.save()
            with self.assertRaisesRegex(ValueError, 'not_ready'):
                find_document(self.jobs, ORDER, TRACKING)
        self.render.assert_not_called()

    def test_barcode_verification_cannot_be_bypassed(self):
        self.save()
        self.render.side_effect = ValueError('order_changed')
        with self.assertRaisesRegex(ValueError, 'not_ready'):
            find_document(self.jobs, ORDER, TRACKING)


if __name__ == '__main__':
    unittest.main()
