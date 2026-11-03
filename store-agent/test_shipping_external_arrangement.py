"""External Wing arrangement is handled, but never evidence of printing."""
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from shipping_core import Workbench, normalize_cp, now
from shipping_remote import packing_snapshot
from test_shipping_workbench import cp


class ExternalArrangementTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.config = self.root / 'config.json'
        self.config.write_text('{}')
        self.w = Workbench(self.config, self.root / 'data')
        self.raw = cp('DEPARTURE', 'ORIGINAL')
        self.raw['orderedAt'] = now()
        self.row = normalize_cp(self.raw)
        self.key = self.row['key']
        self.w.rows[self.key] = self.row

    def database_state(self):
        with self.w.connect() as db:
            return {table: [tuple(r) for r in db.execute('SELECT * FROM ' + table)]
                    for table in ('handling', 'jobs', 'events', 'documents')}

    def test_refresh_and_remote_snapshot_classify_without_writing_history(self):
        before = self.database_state()
        with patch.object(self.w, 'read_cp', return_value=[self.row]), \
             patch.object(self.w, 'read_es', return_value=[]), \
             patch.object(self.w, 'read_momo', return_value=[]), \
             patch.object(self.w, 'refresh_images'), \
             patch.object(self.w, '_cp_request') as mutate:
            local = self.w.refresh()['orders'][0]
            remote = packing_snapshot(self.w)['orders'][0]
        mutate.assert_not_called()
        for row in (local, remote):
            self.assertTrue(row['handled'])
            self.assertEqual(row['handlingAction'], 'arranged')
            self.assertEqual(row['handlingSource'], '平台')
            self.assertEqual(row['handledAt'], '')
            self.assertEqual(row['printCount'], 0)
            self.assertFalse(row['documentReady'])
            self.assertFalse(row['canCreate'])
            self.assertTrue(row['canDownload'])
            self.assertEqual(row['tracking'], 'ORIGINAL')
        self.assertEqual(self.database_state(), before)

    def test_original_document_preview_is_download_only_and_read_only(self):
        before = self.database_state()
        with patch.object(self.w, 'fresh_cp', return_value=copy.deepcopy(self.row)), \
             patch.object(self.w, '_cp_request') as mutate:
            preview = self.w.preview(self.key)
        self.assertEqual(preview['action'], 'download')
        self.assertEqual(preview['tracking'], 'ORIGINAL')
        self.assertFalse(preview['canCreate'])
        self.assertTrue(preview['fingerprint'])
        mutate.assert_not_called()
        self.assertEqual(self.database_state(), before)

    def test_restart_keeps_platform_classification_without_fabricated_record(self):
        self.w.snapshot()
        other = Workbench(self.config, self.w.data_dir)
        other.rows[self.key] = normalize_cp(self.raw)
        self.assertEqual(other.snapshot()['orders'][0]['handlingAction'], 'arranged')
        self.assertEqual(self.database_state(), {'handling': [], 'jobs': [], 'events': [], 'documents': []})

    def test_no_number_unknown_status_cancelled_or_stale_is_not_arranged(self):
        cancelled = copy.deepcopy(self.raw)
        cancelled['orderItems'][0]['holdCountForCancel'] = 1
        cases = [normalize_cp(cp('DEPARTURE')), normalize_cp(cp('INSTRUCT', 'ORIGINAL')),
                 normalize_cp(cp('UNKNOWN', 'ORIGINAL')), normalize_cp(cancelled),
                 {**self.row, 'stage': 'cancelled'}, {**self.row, 'tracking': '   '},
                 {**self.row, 'platform': 'EasyStore'}]
        for row in cases:
            with self.subTest(status=row['status'], stage=row['stage'], tracking=row['tracking']):
                self.w.rows = {self.key: row}
                self.assertNotEqual(self.w.snapshot()['orders'][0]['handlingAction'], 'arranged')
        self.w.rows = {self.key: self.row}
        self.w.errors['Coupang'] = 'read failed'
        stale = self.w.snapshot()['orders'][0]
        self.assertFalse(stale['handled'])
        self.assertFalse(stale['canDownload'])
        self.assertNotEqual(stale['handlingAction'], 'arranged')

    def test_local_print_history_and_explicit_reopen_still_take_precedence(self):
        for action in ('print_requested', 'printed', 'shipped', 'reopen'):
            with self.subTest(action=action):
                self.w.mark_handled(self.key, action, '店內確認')
                before = self.database_state()
                row = self.w.snapshot()['orders'][0]
                self.assertEqual(row['handlingAction'], action)
                self.assertEqual(row['handlingSource'], '店內確認')
                self.assertEqual(row['handled'], action != 'reopen')
                self.assertEqual(self.database_state(), before)

    def test_changed_local_binding_still_requires_review(self):
        self.w.mark_handled(self.key, 'print_requested')
        before = self.database_state()
        self.w.rows[self.key] = {**self.row, 'tracking': 'DIFFERENT'}
        row = self.w.snapshot()['orders'][0]
        self.assertFalse(row['handled'])
        self.assertTrue(row['handlingChanged'])
        self.assertFalse(row['documentReady'])
        self.assertNotEqual(row['handlingAction'], 'arranged')
        self.assertEqual(self.database_state(), before)


if __name__ == '__main__':
    unittest.main()
