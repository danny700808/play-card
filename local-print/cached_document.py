"""Find a previously prepared official Shopee original. Never creates jobs or prints."""
import base64
import hashlib
import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from preview import PdfReader, render_preview


def find_document(jobs, order_no, tracking, archive=None):
    if not re.fullmatch(r'[A-Z0-9]{12,24}', order_no) or not re.fullmatch(r'[A-Za-z0-9-]{1,40}', tracking):
        raise ValueError('order_changed')
    # Only existing print jobs from the Shopee pipeline qualify. The channel is
    # part of the persisted digest, including jobs made before channel metadata.
    archive = Path(archive) if archive is not None else jobs.parent / 'originals'
    paths = sorted([*jobs.glob('*/status.json'), *archive.glob('*/metadata.json')],
                   key=lambda p: p.stat().st_mtime, reverse=True)
    for path in paths:
        try:
            state = json.loads(path.read_text(encoding='utf-8'))
            if path.name == 'metadata.json':
                if (state.get('version') != 1 or state.get('channel') != '蝦皮'
                        or state.get('orderNo') != order_no or state.get('tracking') != tracking):
                    continue
            elif state.get('status') not in ('preview', 'prepared', 'submitted', 'uncertain', 'submitting'):
                continue
            source = path.parent / 'source.pdf'
            if not 20 < source.stat().st_size <= 15 * 1024 * 1024:
                continue
            raw = source.read_bytes()
            # Footer jobs hash layout/amount into digest; sourceDigest still
            # binds the untouched official PDF to the Shopee channel.
            source_digest = hashlib.sha256('蝦皮'.encode() + b'\0' + raw).hexdigest()
            if source_digest not in (state.get('sourceDigest'), state.get('digest')):
                continue
            reader = PdfReader(io.BytesIO(raw))
            if reader.is_encrypted or len(reader.pages) != 1:
                continue
            text = reader.pages[0].extract_text() or ''
            if not re.search(r'(?<![A-Z0-9])'+re.escape(order_no)+r'(?![A-Z0-9])', text) or tracking not in text:
                continue
            result = render_preview(raw, order_no, tracking)
            return dict(result, pdfBase64=base64.b64encode(raw).decode(), source='saved_original')
        except Exception:
            continue
    raise ValueError('not_ready')


if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8'); sys.stdout.reconfigure(encoding='utf-8')
    try:
        request = json.load(sys.stdin)
        print(json.dumps(find_document(ROOT / 'jobs', request['orderNo'], request['tracking'])))
    except Exception as error:
        code = str(error) if str(error) in ('not_ready', 'order_changed') else 'failed'
        print(json.dumps({'code': code}))
        raise SystemExit(1)
