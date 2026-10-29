#!/usr/bin/env python3
"""Tiny static server for playing Mining Simulator locally.

Plain `python3 -m http.server` sends no cache headers, so browsers hang on to
`js/game.js` and you end up running yesterday's code against today's HTML.
This always sends no-store, so a refresh is always a real refresh.

    python3 serve.py [port]      # defaults to 8000
"""

import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the console quiet


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        print(f"Mining Simulator → http://localhost:{PORT}  (serving {ROOT})")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
