#!/usr/bin/env bash
# web_workflow_e2e.sh — Phase 19 frontend workflow suite for the Next.js web app.
# Extends web_smoke_e2e.sh (public pages / anon redirects / CORS) with the
# Phase 19 product routes. Asserts, against the running web server:
#   - every Phase 19 workspace route redirects anonymous visitors to /login
#   - a cookie-holder is allowed through to the workspace shell (server renders,
#     no >=500 crash, no 404) for every Phase 19 route
#   - middleware still guards all teacher + student + shared prefixes
# Role-guard (student blocked from teacher pages) is CLIENT-side JS and cannot
# be asserted with curl — covered by browser validation instead.
# Exits non-zero on any FAIL. Requires web reachable at $WEB_URL (the caller
# must start the stack: docker compose up -d, or pnpm dev:web).

set -u
WEB="${WEB_URL:-http://localhost:3001}"
BODY_FILE="/tmp/opencode/web_body2.tmp"
HDR_FILE="/tmp/opencode/web_hdr2.tmp"
PASS=0
FAIL=0
FAILURES=()

ok() { local code="$1" exp="$2" label="$3"
  if [ "$code" = "$exp" ]; then PASS=$((PASS+1)); echo "  ok $label";
  else FAIL=$((FAIL+1)); FAILURES+=("$label: expected $exp got $code"); echo "  FAIL $label (got $code, want $exp)"; fi
}
redirect_ok() { local code="$1" loc="$2" label="$3"
  case "$code" in 301|302|303|307|308) : ;; *) code="BAD:$code";; esac
  if [ "$code" != "BAD:$code" ] && printf '%s' "$loc" | grep -q '/login'; then
    PASS=$((PASS+1)); echo "  ok $label (redirect -> $loc)"
  else
    FAIL=$((FAIL+1)); FAILURES+=("$label: got $code loc=$loc"); echo "  FAIL $label (got $code loc=$loc)"
  fi
}

echo "== WEB-10 wait for server =="
UP=""
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "$WEB/login" 2>/dev/null; then UP=1; break; fi
  sleep 2
done
if [ -z "$UP" ]; then echo "FATAL: web not reachable at $WEB (start it first)"; exit 1; fi
PASS=$((PASS+1)); echo "  ok WEB-10 web reachable"
sleep 1

echo "== WEB-11 middleware: Phase 19 routes redirect anon -> /login =="
for path in \
  content "content/00000000-0000-4000-8000-000000000000" \
  materials/00000000-0000-4000-8000-000000000000 \
  paper-patterns "paper-patterns/new" "paper-patterns/00000000-0000-4000-8000-000000000000" \
  practice "practice/sessions/00000000-0000-4000-8000-000000000000" \
  "assessments/00000000-0000-4000-8000-000000000000" \
  "subjects/00000000-0000-4000-8000-000000000000/topics/00000000-0000-4000-8000-000000000000" \
  "student/learning" "student/learning/00000000-0000-4000-8000-000000000000" \
  "student/learning/00000000-0000-4000-8000-000000000000/topics/00000000-0000-4000-8000-000000000000" \
  ; do
  code=$(curl -s -o /dev/null -D "$HDR_FILE" -w '%{http_code}' "$WEB/$path")
  loc=$(grep -i '^location:' "$HDR_FILE" | tr -d '\r' | sed 's/[Ll]ocation: //;s|\r||')
  redirect_ok "$code" "$loc" "WEB-11 $path redirects"
done

echo "== WEB-12 cookie-holder reaches Phase 19 workspace shells =="
for path in \
  content "content/00000000-0000-4000-8000-000000000000" \
  materials/00000000-0000-4000-8000-000000000000 \
  paper-patterns "paper-patterns/new" "paper-patterns/00000000-0000-4000-8000-000000000000" \
  practice "practice/sessions/00000000-0000-4000-8000-000000000000" \
  "assessments/00000000-0000-4000-8000-000000000000" \
  "subjects/00000000-0000-4000-8000-000000000000/topics/00000000-0000-4000-8000-000000000000" \
  "student/learning" "student/learning/00000000-0000-4000-8000-000000000000" \
  "student/learning/00000000-0000-4000-8000-000000000000/topics/00000000-0000-4000-8000-000000000000" \
  ; do
  code=$(curl -s -b "access_token=smoke" -o /dev/null -w '%{http_code}' "$WEB/$path")
  ok "$code" 200 "WEB-12 /$path with cookie -> 200"
done

echo "== WEB-13 curriculum routes covered before Phase 19 =="
for path in dashboard subjects materials questions assessments "student/dashboard"; do
  code=$(curl -s -b "access_token=smoke" -o /dev/null -w '%{http_code}' "$WEB/$path")
  ok "$code" 200 "WEB-13 /$path with cookie -> 200"
done

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "WEB WORKFLOW E2E: PASS=$PASS FAIL=0"
  echo "ALL PASS"
  exit 0
else
  echo "WEB WORKFLOW E2E: PASS=$PASS FAIL=$FAIL"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi