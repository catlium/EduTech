#!/usr/bin/env python3
"""Deterministic OpenAI-compatible mock used by the syllabus E2E harness.

Serves POST /v1/chat/completions and always returns the same syllabus-structure
JSON, so the full AI happy path (enqueue -> worker -> proposal) is reproducible
without a live model. Point the AI worker at this via
WORKER_AI_PROVIDER_URL=http://127.0.0.1:8899/v1
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

SYLLABUS = {
    "chapters": [
        {
            "name": "Number Systems",
            "description": "Foundations of numbers",
            "topics": [
                {"name": "Rational and Irrational Numbers", "description": "Number families"},
                {"name": "Operations on Real Numbers"},
            ],
        },
        {
            "name": "Algebra",
            "topics": [
                {"name": "Linear Equations"},
                {"name": "Quadratic Equations", "description": "Quadratic formula"},
            ],
        },
        {"name": "Geometry", "description": "Shapes and space", "topics": []},
    ]
}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)
        body = json.dumps(
            {"choices": [{"message": {"content": json.dumps(SYLLABUS)}}]}
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):  # noqa: A002 (stdlib, not ours)
        sys.stderr.write("[mock-ai] %s\n" % (args[0] if args else ""))


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8899), Handler).serve_forever()