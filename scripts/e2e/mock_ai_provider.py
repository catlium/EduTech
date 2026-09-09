#!/usr/bin/env python3
"""Deterministic OpenAI-compatible mock used by the E2E harnesses.

Serves POST /v1/chat/completions and returns a response chosen by the
``model`` field in the request body, so the full AI happy path (enqueue ->
worker -> validated output) is reproducible without a live model. Point the AI
worker at this via WORKER_AI_PROVIDER_URL=http://127.0.0.1:8899/v1 and select
the canned output via WORKER_AI_MODEL:

  - ``syllabus-mock``  -> syllabus proposal JSON (contract preserved for
                          ``syllabus_e2e.sh``)
  - ``note-mock``      -> AI_GENERATE_NOTE NotePayload
  - ``questions-mock`` -> AI_GENERATE_QUESTIONS GeneratedQuestions (3 identical
                          MCQs, EASY)

Anything else falls back to the syllabus response.
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

NOTE = {
    "title": "Rational Numbers — demo note",
    "blocks": [
        {"id": "b1", "type": "heading", "content": "Rational Numbers"},
        {
            "id": "b2",
            "type": "paragraph",
            "content": "Numbers that can be written as a ratio of two integers.",
        },
        {
            "id": "b3",
            "type": "list",
            "items": ["Integers", "Fractions", "Terminating and repeating decimals"],
        },
    ],
}

MOCK_QUESTIONS = [
    {
        "stem": "Which set includes fractions and repeating decimals?",
        "questionType": "MCQ",
        "difficulty": "EASY",
        "explanation": "Fractions and repeating decimals all land in the rationals.",
        "payload": {
            "choices": [{"id": "A", "text": "Rational Numbers"}, {"id": "B", "text": "Irrational Numbers"}],
            "correctChoiceId": "A",
        },
    },
    {
        "stem": "Which of these equals 2 + 2?",
        "questionType": "MCQ",
        "difficulty": "EASY",
        "payload": {
            "choices": [{"id": "A", "text": "4"}, {"id": "B", "text": "5"}],
            "correctChoiceId": "A",
        },
    },
    {
        "stem": "Which of these is the smallest prime number?",
        "questionType": "MCQ",
        "difficulty": "EASY",
        "payload": {
            "choices": [{"id": "A", "text": "1"}, {"id": "B", "text": "2"}],
            "correctChoiceId": "B",
        },
    },
]

QUESTIONS = {"questions": MOCK_QUESTIONS}


def _pick(model: str) -> dict:
    if "syllabus" in model:
        return SYLLABUS
    if "note" in model:
        return NOTE
    if "question" in model:
        return QUESTIONS
    return SYLLABUS


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Minimal liveness probe for the container healthcheck.
        body = b'{"status":"ok"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        model = "syllabus-mock"
        try:
            model = json.loads(raw).get("model", "syllabus-mock")
        except (ValueError, TypeError):
            pass
        body = json.dumps({"choices": [{"message": {"content": json.dumps(_pick(model))}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):  # noqa: A002 (stdlib, not ours)
        sys.stderr.write("[mock-ai] %s\n" % (args[0] if args else ""))


if __name__ == "__main__":
    import os

    host = os.environ.get("MOCK_AI_HOST", "127.0.0.1")
    port = int(os.environ.get("MOCK_AI_PORT", "8899"))
    HTTPServer((host, port), Handler).serve_forever()