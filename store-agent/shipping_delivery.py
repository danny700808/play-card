"""Narrow loopback bridge: read rendered EasyStore delivery names only.

The paired extension receives order identifiers, never credentials, addresses,
payments or shipping commands. Replies are bound to one short-lived refresh.
"""
import json
import re
import secrets
import threading
import time
from pathlib import Path


class DeliveryBridge:
    def __init__(self, data_dir):
        self.path = Path(data_dir) / 'delivery-bridge.json'
        self.condition = threading.Condition()
        self.read_lock = threading.Lock()
        self.last_seen = 0
        self.pending = None

    def config(self):
        try:
            cfg = json.loads(self.path.read_text(encoding='utf-8'))
            if (len(cfg.get('token', '')) >= 40
                    and re.fullmatch('[a-p]{32}', cfg.get('extensionId', ''))):
                return cfg
        except (OSError, ValueError, TypeError):
            pass
        return {}

    def origin(self):
        cfg = self.config()
        return 'chrome-extension://' + cfg['extensionId'] if cfg else ''

    def authorized(self, token, origin):
        cfg = self.config()
        return bool(cfg and origin in (None, self.origin()) and
                    secrets.compare_digest(str(token or ''), cfg['token']))

    def poll(self):
        with self.condition:
            self.last_seen = time.monotonic()
            p = self.pending
            if not p or p['expires'] <= self.last_seen or p['claimed']:
                return {'job': None}
            p['claimed'] = True
            return {'job': {'id': p['id'], 'orders': list(p['orders'].values()), 'kind': p.get('kind','shopee')}}

    def submit(self, body):
        with self.condition:
            p = self.pending
            if (not p or body.get('id') != p['id'] or p['done']
                    or time.monotonic() >= p['expires']):
                raise ValueError('Expired delivery lookup')
            incoming = body.get('results', [])
            if not isinstance(incoming, list) or len(incoming) > len(p['orders']):
                raise ValueError('Invalid delivery results')
            found = {}
            for row in incoming:
                expected = p['orders'].get(row.get('key')) if isinstance(row, dict) else None
                if p.get('kind') == 'momo':
                    deadline = row.get('shippingDeadlineText') if isinstance(row, dict) else None
                    if (not expected or any(row.get(k) != expected[k] for k in ('key','orderNo','externalId'))
                            or not re.fullmatch(r'MOMO:\d{14,15}:\d{1,6}(?:,\d{1,6}){0,99}', row['key'])
                            or row.get('evidenceUrl') != 'https://3p.momo.com.tw/order/all'
                            or row['key'] in found or not isinstance(deadline,str)
                            or not re.fullmatch(r'\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?',deadline)):
                        raise ValueError('Mismatched MOMO deadline result')
                    found[row['key']] = {'shippingDeadlineText':deadline, 'evidenceUrl':row['evidenceUrl']}
                    continue
                name = row.get('deliveryMethod', '') if isinstance(row, dict) else ''
                evidence = row.get('evidenceUrl', '') if isinstance(row, dict) else ''
                if (not expected or row.get('orderNo') != expected['orderNo']
                        or row.get('externalId') != expected['externalId']
                        or not isinstance(name, str) or not 1 <= len(name.strip()) <= 100
                        or re.search(r'[\x00-\x1f<>]', name)
                        or name.lower().strip() in ('shipping fee', 'shipping', '運費', '-')
                        or not re.fullmatch(r'https://admin\.easystore\.co/channels/shopee/taiwan/orders/\d+', evidence)
                        or row['key'] in found):
                    raise ValueError('Mismatched delivery result')
                found[row['key']] = {'deliveryMethod': name.strip(), 'evidenceUrl': evidence}
                deadline = row.get('shippingDeadlineText')
                if deadline is not None:
                    if not isinstance(deadline, str) or not 1 <= len(deadline.strip()) <= 100 or re.search(r'[\x00-\x1f<>]', deadline):
                        raise ValueError('Invalid shipping deadline')
                    found[row['key']]['shippingDeadlineText'] = deadline.strip()
            p['results'] = found
            p['error'] = body.get('error') if body.get('error') in ('login', 'missing', 'timeout', 'layout') else ''
            p['done'] = True
            self.condition.notify_all()
            return {'ok': True}

    def read(self, orders, timeout=55, kind='shopee'):
        # The platform refreshes run in parallel but the paired browser owns one
        # short-lived job at a time. Never overwrite a lookup awaiting its reply.
        started=time.monotonic()
        if not self.read_lock.acquire(timeout=timeout):
            return {}, 'timeout'
        try:
            return self._read(orders, max(.01, timeout-(time.monotonic()-started)), kind)
        finally:
            self.read_lock.release()

    def _read(self, orders, timeout, kind):
        if kind not in ('shopee','momo'):
            raise ValueError('Unsupported delivery lookup')
        if not orders or not self.config():
            return {}, 'not-configured'
        with self.condition:
            if time.monotonic() - self.last_seen > 75:
                return {}, 'offline'
            job = {'id': secrets.token_urlsafe(24), 'orders': {r['key']: r for r in orders},
                   'expires': time.monotonic() + timeout, 'claimed': False, 'done': False, 'kind':kind}
            self.pending = job
            try:
                self.condition.wait_for(lambda: job['done'], timeout)
                return job.get('results', {}), job.get('error', 'timeout')
            finally:
                self.pending = None

