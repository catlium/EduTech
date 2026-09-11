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
   - ``summary-mock``   -> AI_GENERATE_SUMMARY SummaryPayload
   - ``questions-mock`` -> AI_GENERATE_QUESTIONS GeneratedQuestions (3 identical
                          MCQs, EASY)
  - ``blueprint-mock`` -> AI_GENERATE_BLUEPRINT BlueprintPayload (Section A:
                          MCQ 10 x 1 compulsory; Section B: TRUE_FALSE 5 x 2
                          compulsory; 20 total marks, 40 minutes)

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

SUMMARY = {
    "title": "Rational Numbers — demo summary",
    "summary": "Rational numbers are numbers that can be written as a ratio of two "
    "integers (p/q with q != 0). They include integers, proper fractions, and "
    "terminating or repeating decimals.",
    "keyConcepts": ["Ratio of two integers", "Terminating decimals", "Repeating decimals"],
    "importantPoints": [
        "A rational number is expressible as p/q with q != 0.",
        "Decimals that terminate or repeat are rational.",
    ],
}

MOCK_QUESTIONS = [
    {
        "stem": "Which set includes fractions and repeating decimals?",
        "questionType": "MCQ",
        "difficulty": "EASY",
        "explanation": "Fractions and repeating decimals all land in the rationals.",
        "payload": {
            "choices": [
                {"id": "A", "text": "Rational Numbers"},
                {"id": "B", "text": "Irrational Numbers"},
            ],
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

# Blueprint: Section A MCQ 10 x 1, Section B TRUE_FALSE 5 x 2. The paper
# pattern_e2e.sh harness remixes these into multiple named patterns (full
# quota, partial quota, invalid marks) by mutating this dict per run.
BLUEPRINT = {
    "totalMarks": 20,
    "durationMinutes": 40,
    "instructions": ["Answer all questions where required."],
    "sections": [
        {
            "id": "sec-a",
            "name": "Section A — Multiple Choice",
            "questionType": "MCQ",
            "count": 10,
            "marksPerQuestion": 1,
            "totalMarks": 10,
            "compulsory": True,
            "attemptCount": None,
        },
        {
            "id": "sec-b",
            "name": "Section B — True or False",
            "questionType": "TRUE_FALSE",
            "count": 5,
            "marksPerQuestion": 2,
            "totalMarks": 10,
            "compulsory": True,
            "attemptCount": None,
        },
    ],
}

# ── Content package: all 4 types in one response ────────────────────────────
CONTENT_PACKAGE = {
    "note": NOTE,
    "summary": SUMMARY,
    "flashcards": {
        "title": "Rational Numbers — flashcards",
        "description": "Key terms and concepts.",
        "cards": [
            {
                "id": "fc1",
                "front": "What is a rational number?",
                "back": "A number expressible as p/q with q != 0.",
            },
            {
                "id": "fc2",
                "front": "Are terminating decimals rational?",
                "back": "Yes, they can be written as a ratio.",
            },
        ],
    },
    "concepts": {
        "title": "Rational Numbers — concepts",
        "concepts": [
            {
                "name": "Rational number",
                "description": "A number expressible as a fraction of two integers.",
            },
            {
                "name": "Irrational number",
                "description": "A number that cannot be expressed as p/q.",
            },
        ],
    },
}

# ── Bank mode: produce questions covering all requested buckets ──────────────
BANK_QUESTIONS = {
    "questions": [
        {
            "stem": "Which set includes fractions and repeating decimals?",
            "questionType": "MCQ",
            "difficulty": "EASY",
            "explanation": "Fractions and repeating decimals all land in the rationals.",
            "payload": {
                "choices": [
                    {"id": "A", "text": "Rational Numbers"},
                    {"id": "B", "text": "Irrational Numbers"},
                ],
                "correctChoiceId": "A",
            },
        },
        {
            "stem": "Rational numbers can be written as p/q with q != 0.",
            "questionType": "TRUE_FALSE",
            "difficulty": "MEDIUM",
            "explanation": "Definition of a rational number.",
            "payload": {"correctAnswer": True},
        },
        {
            "stem": "The number 0.333... is _",
            "questionType": "FILL_IN_BLANK",
            "difficulty": "MEDIUM",
            "payload": {"acceptableAnswers": ["rational", "a rational number", "1/3"]},
        },
        {
            "stem": "Which of these is irrational?",
            "questionType": "MCQ",
            "difficulty": "HARD",
            "payload": {
                "choices": [{"id": "A", "text": "sqrt(2)"}, {"id": "B", "text": "0.5"}],
                "correctChoiceId": "A",
            },
        },
        {
            "stem": "0.5 is a rational number.",
            "questionType": "TRUE_FALSE",
            "difficulty": "EASY",
            "payload": {"correctAnswer": True},
        },
        {
            "stem": "pi is _",
            "questionType": "FILL_IN_BLANK",
            "difficulty": "HARD",
            "payload": {"acceptableAnswers": ["irrational", "an irrational number"]},
        },
    ],
}


def _pick(model: str, messages: list | None = None) -> dict:
    if "syllabus" in model:
        return SYLLABUS
    if "note" in model:
        return NOTE
    if "question" in model:
        return QUESTIONS
    if "blueprint" in model:
        return BLUEPRINT
    # WORKER_AI_MODEL=auto (the dockerized demo default): the worker embeds the
    # operation into its prompt, so dispatch deterministically on that instead
    # of silently returning the syllabus payload for every operation.
    probe = " ".join(
        str(m.get("content", "")) for m in (messages or [])
    ).lower()
    if "generate the following study resources" in probe:
        return CONTENT_PACKAGE
    if "required quotas" in probe or "generate" in probe and "questions covering" in probe:
        return BANK_QUESTIONS
    if "study-summary" in probe or "study summary" in probe:
        return SUMMARY
    if "study notes" in probe:
        return NOTE
    if "paper pattern" in probe:
        return BLUEPRINT
    if "syllabus structure" in probe:
        return SYLLABUS
    if "questions" in probe:
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
        messages: list | None = None
        try:
            payload = json.loads(raw)
            model = str(payload.get("model", "syllabus-mock"))
            messages = payload.get("messages")
        except (ValueError, TypeError):
            pass
        body = json.dumps(
            {"choices": [{"message": {"content": json.dumps(_pick(model, messages))}}]}
        ).encode()
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