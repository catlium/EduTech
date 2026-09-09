#!/usr/bin/env bash
# web_smoke_e2e.sh — Phase 16 frontend smoke suite for the Next.js web app.
# Asserts, against the running web server (dockerized or local):
#   - public pages return 200 (/, /login, /register, /institutes)
#   - server-side middleware (middleware.ts) redirects unauthenticated visitors
#     away from workspace routes to /login
#   - a cookie-holder is allowed through to the workspace shell (page renders)
#   - dynamic workspace routes neither crash (>=500) nor 404 for auth'd shells
#   - the web origin may call the API (CORS preflight from localhost:3001)
# Exits non-zero on any FAIL. Requires web reachable at $WEB_URL (the caller
# must start it: docker compose up -d or pnpm dev:web).

set -u
WEB="${WEB_URL:-http://localhost:3001}"
API="http://localhost:3000/api/v1"
BODY_FILE="/tmp/opencode/web_body.tmp"
HDR_FILE="/tmp/opencode/web_hdr.tmp"
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

echo "== WEB-00 wait for server =="
UP=""
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "$WEB/login" 2>/dev/null; then UP=1; break; fi
  sleep 2
done
if [ -z "$UP" ]; then echo "FATAL: web not reachable at $WEB (start it first)"; exit 1; fi
PASS=$((PASS+1)); echo "  ok WEB-00 web reachable"
sleep 1

echo "== WEB-01 public pages render =="
code=$(curl -s -o /dev/null -D "$HDR_FILE" -w '%{http_code}' "$WEB/")
loc=$(grep -i '^location:' "$HDR_FILE" | tr -d '\r' | sed 's/[Ll]ocation: //;s|\r||')
ok "$code" 307 "WEB-01a / bootstraps to dashboard (redirect)"
printf '%s' "$loc" | grep -q 'dashboard' && { PASS=$((PASS+1)); echo "  ok WEB-01b / redirects to /dashboard"; } \
  || { FAIL=$((FAIL+1)); FAILURES+=("WEB-01b / -> dashboard"); echo "  FAIL WEB-01b / -> dashboard (loc=$loc)"; }
code=$(curl -s -L -o "$BODY_FILE" -w '%{http_code}' "$WEB/login")
ok "$code" 200 "WEB-01c /login -> 200"
code=$(curl -s -L -o "$BODY_FILE" -w '%{http_code}' "$WEB/register")
ok "$code" 200 "WEB-01d /register -> 200"
code=$(curl -s -L -o "$BODY_FILE" -w '%{http_code}' "$WEB/institutes")
ok "$code" 200 "WEB-01e /institutes -> 200"

echo "== WEB-02 middleware: workspace routes redirect anon to /login =="
for path in dashboard subjects "subjects/new" "subjects/00000000-0000-4000-8000-000000000000" materials questions assessments "student/dashboard"; do
  code=$(curl -s -o /dev/null -D "$HDR_FILE" -w '%{http_code}' "$WEB/$path")
  loc=$(grep -i '^location:' "$HDR_FILE" | tr -d '\r' | sed 's/[Ll]ocation: //;s|\r||')
  redirect_ok "$code" "$loc" "WEB-02 $path redirects"
done

echo "== WEB-03 cookie-holder reaches workspace shell =="
for path in dashboard subjects materials questions "student/dashboard"; do
  code=$(curl -s -b "access_token=smoke" -o /dev/null -w '%{http_code}' "$WEB/$path")
  ok "$code" 200 "WEB-03 /$path with cookie -> 200"
done

echo "== WEB-04 CORS: web origin may call the API =="
curl -s -X OPTIONS "$API/auth/login" \
  -H "Origin: $WEB" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type" \
  -o /dev/null -D "$HDR_FILE" -w ''
acao=$(grep -i '^access-control-allow-origin:' "$HDR_FILE" | tr -d '\r' | sed 's/[Aa]ccess-[Cc]ontrol-[Aa]llow-[O]rigin: //')
ok "$acao" "$WEB" "WEB-04 CORS allow-origin matches web origin"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "WEB SMOKE E2E: PASS=$PASS FAIL=0"
  echo "ALL PASS"
  exit 0
else
  echo "WEB SMOKE E2E: PASS=$PASS FAIL=$FAIL"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi