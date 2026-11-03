"""Persist a verified official PDF independently of print preparation."""
import hashlib
import json
import os
import uuid
from pathlib import Path


def save_original(root, raw, order_no, tracking):
    # Caller must first verify PDF identity and barcodes with render_preview.
    digest = hashlib.sha256('蝦皮'.encode() + b'\0' + raw).hexdigest()
    folder = Path(root) / digest
    folder.mkdir(parents=True, exist_ok=True)
    metadata = {'version': 1, 'channel': '蝦皮', 'orderNo': order_no,
                'tracking': tracking, 'sourceDigest': digest}
    for name, content in [('source.pdf', raw), ('metadata.json',
            json.dumps(metadata, ensure_ascii=False).encode('utf-8'))]:
        destination = folder / name
        if destination.is_file() and destination.read_bytes() == content:
            continue
        temporary = folder / ('.' + name + '-' + uuid.uuid4().hex + '.tmp')
        try:
            temporary.write_bytes(content)
            os.replace(temporary, destination)
        finally:
            if temporary.exists():
                temporary.unlink()
    return digest
