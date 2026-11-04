"""One private, serial PDF worker. It can render documents, never print them."""
import json
import queue
import subprocess
import sys
import threading
import uuid
from pathlib import Path
from types import SimpleNamespace


class RenderClient:
    def __init__(self, root, python=None):
        self.root = Path(root)
        self.python = python or sys.executable
        self.process = None
        self.lock = threading.Lock()

    def _stop(self):
        process, self.process = self.process, None
        if process is None:
            return
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
        for stream in (process.stdin, process.stdout):
            if stream:
                stream.close()

    def close(self):
        with self.lock:
            self._stop()

    def call(self, operation, payload, timeout=90):
        if operation not in ('warmup', 'prepare', 'preview', 'cached-document'):
            raise ValueError('Unsupported render operation')
        with self.lock:
            if self.process is None or self.process.poll() is not None:
                self._stop()
                self.process = subprocess.Popen(
                    [self.python, '-u', str(self.root / 'render_worker.py')],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL, text=True, encoding='utf-8',
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            process = self.process
            request_id = uuid.uuid4().hex
            request = json.dumps({'id': request_id, 'operation': operation,
                                  'payload': payload}, ensure_ascii=False)
            answers = queue.Queue(maxsize=1)

            def exchange():
                try:
                    process.stdin.write(request + '\n')
                    process.stdin.flush()
                    line = process.stdout.readline()
                    answers.put(json.loads(line))
                except Exception:
                    answers.put(None)

            # Include large pipe writes and worker startup in the timeout.
            thread = threading.Thread(target=exchange, daemon=True)
            thread.start()
            try:
                answer = answers.get(timeout=timeout)
                if (not isinstance(answer, dict) or answer.get('id') != request_id
                        or type(answer.get('ok')) is not bool
                        or not isinstance(answer.get('result'), dict)):
                    raise RuntimeError('Invalid render worker reply')
                return SimpleNamespace(returncode=0 if answer['ok'] else 1,
                                       stdout=json.dumps(answer['result'], ensure_ascii=False))
            except Exception:
                self._stop()
                thread.join(timeout=1)
                # Never retry this request automatically, even though the
                # worker has no shipment or physical-print capability.
                raise RuntimeError('Local document rendering did not complete') from None
