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
            return {'job': {'id': p['id'], 'orders': list(p['orders'].values())}}

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
            p['results'] = found
            p['error'] = body.get('error') if body.get('error') in ('login', 'missing', 'timeout', 'layout') else ''
            p['done'] = True
            self.condition.notify_all()
            return {'ok': True}

    def read(self, orders, timeout=55):
        if not orders or not self.config():
            return {}, 'not-configured'
        with self.condition:
            if time.monotonic() - self.last_seen > 75:
                return {}, 'offline'
            job = {'id': secrets.token_urlsafe(24), 'orders': {r['key']: r for r in orders},
                   'expires': time.monotonic() + timeout, 'claimed': False, 'done': False}
            self.pending = job
            try:
                self.condition.wait_for(lambda: job['done'], timeout)
                return job.get('results', {}), job.get('error', 'timeout')
            finally:
                self.pending = None
