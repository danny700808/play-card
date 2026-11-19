import unittest
from shipping_deadlines import deadline_fields


class DeadlineTests(unittest.TestCase):
    def read(self, value, observed='2026-11-19T23:30:00+08:00'):
        return deadline_fields(value, observed, 'EasyStore 蝦皮通路後台')

    def test_explicit_date_and_time(self):
        r = self.read('2026/11/20 16:30')
        self.assertEqual(r['shippingDeadlineAt'], '2026-11-20T16:30:00+08:00')
        self.assertEqual(r['shippingDeadlinePrecision'], 'minute')

    def test_date_only_does_not_claim_a_cutoff_hour(self):
        r = self.read('2026年11月20日')
        self.assertEqual(r['shippingDeadlinePrecision'], 'date')
        self.assertNotIn('23:59', r['shippingDeadlineText'])

    def test_relative_day_is_anchored_and_does_not_drift(self):
        r = self.read('明天', '2026-12-31T23:30:00+08:00')
        self.assertEqual(r['shippingDeadlineAt'], '2027-01-01T00:00:00+08:00')
        self.assertEqual(r['shippingDeadlineText'], '2027-01-01（平台原文：明天）')

    def test_unrecognized_or_invalid_dates_are_not_guessed(self):
        for value in ['2026/02/30', '11/20', '3 天內', '2026/11/20 25:30']:
            self.assertNotIn('shippingDeadlineAt', self.read(value))
        for value in ['', None, '<script>', 'a'*101]:
            self.assertEqual(self.read(value), {})


if __name__ == '__main__':
    unittest.main()
