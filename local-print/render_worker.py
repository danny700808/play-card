"""Private JSON-lines renderer. PDFium stays in one thread in this process."""
import base64
from collections import OrderedDict
import copy
import hashlib
import json
from pathlib import Path
import re
import sys


class Renderer:
    def __init__(self, root, max_bytes=48 * 1024 * 1024, max_entries=8):
        self.root = Path(root)
        self.cache = OrderedDict()
        self.cache_bytes = 0
        self.max_bytes = max_bytes
        self.max_entries = max_entries

    def prepare(self, payload):
        from prepare import prepare
        job = Path(payload['job'])
        options = payload['options']
        raw = (job / 'source.pdf').read_bytes()
        # Include every rendering input, including password, footer, tracking,
        # channel and profile. The digest and cache never leave this process.
        key = hashlib.sha256(raw + b'\0' + json.dumps(
            options, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).digest()
        cached = self.cache.get(key)
        if cached:
            result, files, _size = cached
            for name, content in files.items():
                (job / name).write_bytes(content)
            self.cache.move_to_end(key)
            return copy.deepcopy(result)
        result = prepare(job, options['channel'], options.get('password', ''),
                         print_profile=options.get('printProfile', ''),
                         shipping_method=options.get('shippingMethod', ''),
                         tracking=options.get('tracking', ''),
                         packing_footer=options.get('packingFooter'))
        # Cache only output from a fully successful barcode-checked conversion.
        # No status.json, job ID, source PDF or print permission is reused.
        pages = result.get('pages')
        if type(pages) is not int or not 1 <= pages <= 50:
            raise ValueError('Invalid prepared page count')
        names = ['labels.pdf'] + [f'label-{i}-print.png' for i in range(1, pages + 1)]
        if (job / 'original-labels.pdf').is_file():
            names.append('original-labels.pdf')
        files = {name: (job / name).read_bytes() for name in names}
        size = sum(map(len, files.values()))
        if size <= self.max_bytes:
            while self.cache and (len(self.cache) >= self.max_entries
                                  or self.cache_bytes + size > self.max_bytes):
                _, old = self.cache.popitem(last=False)
                self.cache_bytes -= old[2]
            self.cache[key] = (copy.deepcopy(result), files, size)
            self.cache_bytes += size
        return result

    def dispatch(self, operation, payload):
        if operation == 'warmup':
            import prepare  # Imports renderer dependencies once, before user work.
            from packing_footer import font
            font()
            return {'ready': True}
        if operation == 'prepare':
            return self.prepare(payload)
        if operation == 'preview':
            from preview import preview_and_save
            return preview_and_save(base64.b64decode(payload['pdfBase64'], validate=True),
                                    payload['orderNo'], payload.get('tracking', ''),
                                    self.root / 'originals')
        if operation == 'cached-document':
            from cached_document import find_document
            return find_document(self.root / 'jobs', payload['orderNo'], payload['tracking'])
        raise ValueError('unsupported')


def main():
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    renderer = Renderer(Path(__file__).resolve().parent)
    for line in sys.stdin:
        identifier, operation = '', ''
        try:
            request = json.loads(line)
            identifier, operation = request['id'], request['operation']
            if not isinstance(identifier, str) or not re.fullmatch(r'[a-f0-9]{32}', identifier):
                raise ValueError('Invalid request identifier')
            result = renderer.dispatch(operation, request['payload'])
            answer = {'id': identifier, 'ok': True, 'result': result}
        except Exception as error:
            if operation in ('preview', 'cached-document'):
                code = str(error) if str(error) in ('order_changed', 'unsupported', 'not_ready') else 'failed'
                result = {'code': code}
            else:
                result = {'error': str(error) if isinstance(error, ValueError)
                          else '本機標籤處理失敗，尚未送印。'}
            answer = {'id': identifier, 'ok': False, 'result': result}
        print(json.dumps(answer, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
