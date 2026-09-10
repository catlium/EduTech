#!/usr/bin/env bash
# auth_e2e.sh — Phase 16 dedicated authentication lifecycle suite.
# Covers the login/refresh/logout surface that the other suites only hit
# incidentally: login validation, wrong/unknown login, refresh-token rotation
# (reuse of a rotated-out token must 401), logout revocation, and the
# memberships hub. Anonymous-access guards are asserted too. Since Phase 21
# removed public self-registration, register must be 404 and the suite logs in
# with the seeded demo teacher.
# Exits non-zero on any FAIL. Requires a live dockerized API (localhost:3000).
# NOTE: auth routes are throttled 5/min per route; this suite makes <=3 calls
# per route so it never trips the limiter and is safe back-to-back with the
# other suites. Requires the demo seed (teacher@catlium.dev).

set -u
BASE="http://localhost:3000/api/v1"
BODY_FILE="/tmp/opencode/auth_body.tmp"
JAR="/tmp/opencode/auth_jar.txt"
TMP="/tmp/opencode"
PASS=0
FAIL=0
FAILURES=()

ok() { local code="$1" exp="$2" label="$3"
  if [ "$code" = "$exp" ]; then PASS=$((PASS+1)); echo "  ok $label";
  else FAIL=$((FAIL+1)); FAILURES+=("$label: expected $exp got $code"); echo "  FAIL $label (got $code, want $exp)"; fi
}
body_has() { local sub="$1" label="$2"
  if grep -qF "$sub" "$BODY_FILE"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$label: missing '$sub' in body"); echo "  FAIL $label (missing '$sub')"; fi
}
jget() { grep -oP "\"$1\"\s*:\s*\"?[^\",}]*" "$BODY_FILE" | head -1 | sed -E "s/\"$1\"\s*:\s*\"?//"; }
post() { local path="$1" data="$2" jar="$3"
  curl -s -b "$jar" -c "$jar" -X POST "$BASE$path" -H 'Content-Type: application/json' \
    -d "$data" -o "$BODY_FILE" -w '%{http_code}'
}
post_login() { # post_login <data> — retries 429 (auth throttle is shared across suites)
  local data="$1" n code
  for n in 1 2 3 4; do
    code=$(curl -s -b "$JAR" -c "$JAR" -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
      -d "$data" -o "$BODY_FILE" -w '%{http_code}')
    if [ "$code" != "429" ]; then echo "$code"; return; fi
    sleep 15
  done
  echo "$code"
}

rm -f "$JAR"

echo "== AUTH-01 public registration removed =="
ok "$(post /auth/register '{"name":"N","email":"n@test.dev","password":"Password123!"}' "$JAR")" 404 "AUTH-01a register -> 404"

echo "== AUTH-02 seeded login + me =="
ok "$(post_login '{"email":"teacher@catlium.dev","password":"Password123!"}')" 200 "AUTH-02a login -> 200"
ok "$(curl -s -b "$JAR" -X GET "$BASE/auth/me" -o "$BODY_FILE" -w '%{http_code}')" 200 "AUTH-02b me -> 200"
body_has "teacher@catlium.dev" "AUTH-02c me echoes email"

echo "== AUTH-03 login failures =="
ok "$(post_login '{"email":"teacher@catlium.dev","password":"WrongPass123!"}')" 401 "AUTH-03a wrong password -> 401"
ok "$(post_login '{"email":"nobody@test.dev","password":"Password123!"}')" 401 "AUTH-03b unknown email -> 401"

echo "== AUTH-04 refresh rotation: reusing a rotated-out token -> 401 =="
OLD_RT=$(grep -P "\trefresh_token\t" "$JAR" | head -1 | awk '{print $NF}')
OLD_CSRF=$(grep -P "\tcsrf_token\t" "$JAR" | head -1 | awk '{print $NF}')
ok "$(curl -s -b "$JAR" -c "$JAR" -X POST "$BASE/auth/refresh" -H "x-csrf-token: $OLD_CSRF" -o "$BODY_FILE" -w '%{http_code}')" 200 "AUTH-04a refresh -> 200"
ok "$(curl -s -b "refresh_token=$OLD_RT; csrf_token=$OLD_CSRF" -X POST "$BASE/auth/refresh" -H "x-csrf-token: $OLD_CSRF" -o "$BODY_FILE" -w '%{http_code}')" 401 "AUTH-04b rotated-out refresh token -> 401"

echo "== AUTH-05 logout revocation =="
CRF=$(grep -P "\tcsrf_token\t" "$JAR" | head -1 | awk '{print $NF}')
ok "$(curl -s -b "$JAR" -c "$JAR" -X POST "$BASE/auth/logout" -H "x-csrf-token: $CRF" -o "$BODY_FILE" -w '%{http_code}')" 200 "AUTH-05a logout -> 200"
ok "$(curl -s -b "$JAR" -X GET "$BASE/auth/me" -o "$BODY_FILE" -w '%{http_code}')" 401 "AUTH-05b me after logout -> 401"

echo "== AUTH-06 memberships hub + anonymous guards =="
ok "$(post_login '{"email":"teacher@catlium.dev","password":"Password123!"}')" 200 "AUTH-06a login -> 200"
ok "$(curl -s -b "$JAR" -X GET "$BASE/memberships" -o "$BODY_FILE" -w '%{http_code}')" 200 "AUTH-06b memberships -> 200"
ok "$(curl -s -X GET "$BASE/memberships" -o "$BODY_FILE" -w '%{http_code}')" 401 "AUTH-06c memberships anon -> 401"
ok "$(curl -s -X GET "$BASE/auth/me" -o "$BODY_FILE" -w '%{http_code}')" 401 "AUTH-06d me anon -> 401"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "AUTH E2E: PASS=$PASS FAIL=0"
  echo "ALL PASS"
  exit 0
else
  echo "AUTH E2E: PASS=$PASS FAIL=$FAIL"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi