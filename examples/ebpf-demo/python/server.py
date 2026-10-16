"""HTTP service with no OTel SDK. Logs the traceparent it receives, then calls each URL in CALLS."""
import os
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CALLS = [u for u in os.environ.get("CALLS", "").split(",") if u]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        print(f"recv path={self.path} traceparent={self.headers.get('traceparent')!r}", flush=True)
        for u in CALLS:
            try:
                urllib.request.urlopen(u, timeout=5).read()
            except Exception as e:
                print(f"call {u}: {e}", file=sys.stderr, flush=True)
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("", int(os.environ["PORT"])), Handler).serve_forever()
