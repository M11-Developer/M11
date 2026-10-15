#!/usr/bin/env python3
"""خادم ثابت لنسخة الويب — بلا إنترنت، بلا تبعيات، يخدم مجلد web/ فقط.

  python3 tools/serve.py [--port 8000] [--bind 0.0.0.0] [--root web]

يضبط رؤوس منع التخزين المؤقت و MIME للنوعيات المطلوبة (woff2/ogg/json/png).
"""
from __future__ import annotations
import argparse
import os
import posixpath
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

EXTRA_MIME = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ogg": "audio/ogg",
    ".webp": "image/webp",
    ".png": "image/png",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".wasm": "application/wasm",
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=kw.pop("directory", "."), **kw)

    def guess_type(self, path):
        ext = posixpath.splitext(path)[1].lower()
        if ext in EXTRA_MIME:
            return EXTRA_MIME[ext]
        return super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        # نسمح بتضمين المعاينة داخل iframe
        self.send_header("X-Frame-Options", "ALLOWALL")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--bind", default="0.0.0.0")
    ap.add_argument("--root", default="web")
    args = ap.parse_args(argv)
    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        print("مجلد غير موجود:", root)
        return 1
    os.chdir(root)
    srv = ThreadingHTTPServer((args.bind, args.port), lambda *a, **kw: Handler(*a, directory=root, **kw))
    print(f"خادم ميكا 11 يعمل على http://{args.bind}:{args.port} (الجذر: {root})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nإيقاف…")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
