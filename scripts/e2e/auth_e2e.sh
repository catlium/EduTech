#!/usr/bin/env bash
# auth_e2e.sh — Phase 16 dedicated authentication lifecycle suite.
# Covers the register/login/refresh/logout surface that the other suites only
# hit incidentally: register validation + uniqueness, wrong/unknown login,
# refresh-token rotation (reuse of a rotated-out token must 401), logout
# revocation, and the memberships hub. Anonymous-access guards are asserted too.
# Exits non-zero on any FAIL. Requires a live dockerized API (localhost:3000).
# NOTE: auth routes are throttled 5/min per route; this suite makes <=3 calls
# per route so it never trips the limiter and is safe back-to-back with the
# other suites. No seed required — it registers its own user.

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

RAND="$(date +%s)"
EMAIL="auth_${RAND}@test.dev"
rm -f "$JAR"

echo "== AUTH-01 register validation =="
ok "$(post /auth/register '{"name":"A","email":"not-an-email","password":"x"}' "$JAR")" 400 "AUTH-01a invalid register -> 400"

echo "== AUTH-02 register + me =="
ok "$(post /auth/register "{\"name\":\"Auth Tester\",\"email\":\"$EMAIL\",\"password\":\"Password123!\"}" "$JAR")" 201 "AUTH-02a register -> 201"
ok "$(curl -s -b "$JAR" -X GET "$BASE/auth/me" -o "$BODY_FILE" -w '%{http_code}')" 200 "AUTH-02b me -> 200"
body_has "auth_${RAND}" "AUTH-02c me echoes email"

echo "== AUTH-03 duplicate register -> 409 =="
ok "$(post /auth/register "{\"name\":\"Auth Tester\",\"email\":\"$EMAIL\",\"password\":\"Password123!\"}" "$JAR")" 409 "AUTH-03a duplicate email -> 409"

echo "== AUTH-04 login failures =="
ok "$(post /auth/login "{\"email\":\"$EMAIL\",\"password\":\"WrongPass123!\"}" "$JAR")" 401 "AUTH-04a wrong password -> 401"
ok "$(post /auth/login '{"email":"nobody@test.dev","password":"Password123!"}' "$JAR")" 401 "AUTH-04b unknown email -> 401"

echo "== AUTH-05 refresh rotation: reusing a rotated-out token -> 401 =="
OLD_RT=$(grep -P "\trefresh_token\t" "$JAR" | head -1 | awk '{print $NF}')
OLD_CSRF=$(grep -P "\tcsrf_token\t" "$JAR" | head -1 | awk '{print $NF}')
ok "$(curl -s -b "$JAR" -c "$JAR" -X POST "$BASE/auth/refresh" -H "x-csrf-token: $OLD_CSRF" -o "$BODY_FILE" -w '%{http_code}')" 200 "AUTH-05a refresh -> 200"
ok "$(curl -s -b "refresh_token=$OLD_RT; csrf_token=$OLD_CSRF" -X POST "$BASE/auth/refresh" -H "x-csrf-token: $OLD_CSRF" -o "$BODY_FILE" -w '%{http_code}')" 401 "AUTH-05b rotated-out refresh token -> 401"

echo "== AUTH-06 logout revocation =="
CRF=$(grep -P "\tcsrf_token\t" "$JAR" | head -1 | awk '{print $NF}')
ok "$(curl -s -b "$JAR" -c "$JAR" -X POST "$BASE/auth/logout" -H "x-csrf-token: $CRF" -o "$BODY_FILE" -w '%{http_code}')" 200 "AUTH-06a logout -> 200"
ok "$(curl -s -b "$JAR" -X GET "$BASE/auth/me" -o "$BODY_FILE" -w '%{http_code}')" 401 "AUTH-06b me after logout -> 401"

echo "== AUTH-07 memberships hub + anonymous guards =="
ok "$(post /auth/login "{\"email\":\"$EMAIL\",\"password\":\"Password123!\"}" "$JAR")" 200 "AUTH-07a login -> 200"
ok "$(curl -s -b "$JAR" -X GET "$BASE/memberships" -o "$BODY_FILE" -w '%{http_code}')" 200 "AUTH-07b memberships -> 200"
ok "$(curl -s -X GET "$BASE/memberships" -o "$BODY_FILE" -w '%{http_code}')" 401 "AUTH-07c memberships anon -> 401"
ok "$(curl -s -X GET "$BASE/auth/me" -o "$BODY_FILE" -w '%{http_code}')" 401 "AUTH-07d me anon -> 401"

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