#!/usr/bin/env bash
# saas_e2e.sh — Phase 21 SaaS Management (+ landing page) suite.
# Covers, against the dockerized stack:
#   - public boundary: landing page serves a demo CTA; /auth/register is gone
#     (no public self-registration; accounts are institute-provisioned)
#   - institute-admin provisioning: create teacher + student via POST /users,
#     list, duplicate-member conflict, role allow-list, self-deactivation guard
#   - API-enforced authorization: teachers and students cannot list/create
#     users; deactivation blocks tenant access; reactivation restores it
#   - tenant isolation: cross-institute user lists and status edits stay scoped
# Exits non-zero on any FAIL. Requires live dockerized api+web with the demo
# seed applied (adds admin@catlium.dev). Login is throttled 5/min; this suite
# uses only 3 logins.

set -u
BASE="http://localhost:3000/api/v1"
WEB="http://localhost:3001"
BODY_FILE="/tmp/opencode/saas_body.tmp"
JAR_A="/tmp/opencode/saas_admin.txt"
JAR_T="/tmp/opencode/saas_teacher.txt"
JAR_S="/tmp/opencode/saas_student.txt"
PASS=0
FAIL=0
FAILURES=()

DI="99999999-9999-9999-9999-999999999999"
IA="11111111-1111-1111-1111-111111111111"
RAND="$(date +%s)"
JAR="$JAR_A"
INST="$DI"

ok() { local code="$1" exp="$2" label="$3"
  if [ "$code" = "$exp" ]; then PASS=$((PASS+1)); echo "  ok $label";
  else FAIL=$((FAIL+1)); FAILURES+=("$label: expected $exp got $code"); echo "  FAIL $label (got $code, want $exp)"; fi
}
body_has() { local sub="$1" label="$2"
  if grep -qF "$sub" "$BODY_FILE"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$label: missing '$sub' in body"); echo "  FAIL $label (missing '$sub')"; fi
}
body_not_has() { local sub="$1" label="$2"
  if ! grep -qF "$sub" "$BODY_FILE"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$label: forbidden '$sub' leaked into body"); echo "  FAIL $label (contains '$sub')"; fi
}
req() { local method="$1" path="$2"; shift 2
  curl -s -b "$JAR" -X "$method" "$BASE$path" -H "x-institute-id: $INST" "$@" -o "$BODY_FILE" -w '%{http_code}'
}
jget() { grep -oP "\"$1\"\s*:\s*\"?[^\",}]*" "$BODY_FILE" | head -1 | sed -E "s/\"$1\"\s*:\s*\"?//"; }
email_id() { # email_id <email> — reads $BODY_FILE, prints id of user with that email
  python3 - "$1" <<'PYEOF' | head -1
import json, sys
d = json.load(open('/tmp/opencode/saas_body.tmp'))
for u in d.get('users', []):
    if u.get('email') == sys.argv[1]:
        print(u['id'])
        break
PYEOF
}
login() { # login <email> <jar> — retries once on auth-throttle backoff
  local email="$1" jar="$2" code n
  for n in 1 2 3; do
    code=$(curl -s -c "$jar" -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$email\",\"password\":\"Password123!\"}" -o /dev/null -w '%{http_code}')
    if [ "$code" = "200" ]; then return 0; fi
    sleep 7
  done
  echo "  FATAL: login $email rc=$code"; exit 1
}

ADMIN_ID=""
TEACH_EMAIL="saas.teacher.$RAND@test.dev"
STUD_EMAIL="saas.student.$RAND@test.dev"

echo "== SAAS-01 public boundary =="
code=$(curl -s -L -o "$BODY_FILE" -w '%{http_code}' "$WEB/")
ok "$code" 200 "SAAS-01a landing page -> 200"
body_has "Request a Demo" "SAAS-01b landing promotes demo CTA"
code=$(curl -s -X POST "$BASE/auth/register" -H 'Content-Type: application/json' \
  -d '{"name":"R","email":"r@test.dev","password":"Password123!"}' -o "$BODY_FILE" -w '%{http_code}')
ok "$code" 404 "SAAS-01c /auth/register -> 404 (no public self-registration)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$WEB/register")
ok "$code" 404 "SAAS-01d web /register -> 404"

echo "== SAAS-02 institute-admin access =="
rm -f "$JAR_A"; login "admin@catlium.dev" "$JAR_A"
ok "$(req GET /auth/me)" 200 "SAAS-02a seeded admin me -> 200"
ok "$(req GET /memberships)" 200 "SAAS-02b memberships -> 200"
body_has "CatLium Demo Institute" "SAAS-02c admin belongs to demo institute"
L=$(req GET /users)
ok "$L" 200 "SAAS-02d admin lists institute users -> 200"
ADMIN_ID=$(email_id admin@catlium.dev)
body_has "admin@catlium.dev" "SAAS-02e admin visible in list"
body_has "INSTITUTE_ADMIN" "SAAS-02f admin role exposed"

echo "== SAAS-03 provisioning + conflict =="
SET=$(req POST /users -H 'Content-Type: application/json' \
  -d "{\"email\":\"$TEACH_EMAIL\",\"password\":\"Password123!\",\"name\":\"Saas Teacher\",\"role\":\"TEACHER\"}")
ok "$SET" 201 "SAAS-03a create teacher -> 201"
body_has "TEACHER" "SAAS-03b teacher role"
SES=$(req POST /users -H 'Content-Type: application/json' \
  -d "{\"email\":\"$STUD_EMAIL\",\"password\":\"Password123!\",\"name\":\"Saas Student\",\"role\":\"STUDENT\"}")
ok "$SES" 201 "SAAS-03c create student -> 201"
body_has "STUDENT" "SAAS-03d student role"
STUD_ID=$(jget id)
CONF=$(req POST /users -H 'Content-Type: application/json' \
  -d "{\"email\":\"$STUD_EMAIL\",\"password\":\"Password123!\",\"name\":\"Saas Student\",\"role\":\"STUDENT\"}")
ok "$CONF" 409 "SAAS-03e duplicate member -> 409"
CONF2=$(req POST /users -H 'Content-Type: application/json' \
  -d "{\"email\":\"student@catlium.dev\",\"password\":\"Password123!\",\"name\":\"x\",\"role\":\"TEACHER\"}")
ok "$CONF2" 409 "SAAS-03f existing seeded member re-provision -> 409"

echo "== SAAS-04 create validation =="
B1=$(req POST /users -H 'Content-Type: application/json' \
  -d "{\"email\":\"nope\",\"password\":\"Password123!\",\"name\":\"Bad\",\"role\":\"TEACHER\"}")
ok "$B1" 400 "SAAS-04a invalid email -> 400"
B2=$(req POST /users -H 'Content-Type: application/json' \
  -d "{\"email\":\"saas.bad.$RAND@test.dev\",\"password\":\"Password123!\",\"name\":\"Bad\",\"role\":\"INSTITUTE_ADMIN\"}")
ok "$B2" 400 "SAAS-04b role INSTITUTE_ADMIN not assignable -> 400"
B3=$(req POST /users -H 'Content-Type: application/json' \
  -d "{\"email\":\"saas.bad.$RAND@test.dev\",\"password\":\"Password123!\",\"name\":\"Bad\",\"role\":\"PRINCIPAL\"}")
ok "$B3" 400 "SAAS-04c unknown role -> 400"
B4=$(req POST /users -H 'Content-Type: application/json' \
  -d "{\"email\":\"saas.bad2.$RAND@test.dev\",\"password\":\"short\",\"name\":\"Bad\",\"role\":\"STUDENT\"}")
ok "$B4" 400 "SAAS-04d weak password -> 400"

echo "== SAAS-05 API-enforced role boundaries =="
rm -f "$JAR_T"; login "$TEACH_EMAIL" "$JAR_T"; JAR="$JAR_T"
ok "$(req GET /users)" 403 "SAAS-05a teacher cannot list users -> 403"
ok "$(req POST /users -H 'Content-Type: application/json' \
  -d "{\"email\":\"saas.x.$RAND@test.dev\",\"password\":\"Password123!\",\"name\":\"X\",\"role\":\"STUDENT\"}")" 403 "SAAS-05b teacher cannot create users -> 403"
rm -f "$JAR_S"; login "$STUD_EMAIL" "$JAR_S"; JAR="$JAR_S"
ok "$(req GET /users)" 403 "SAAS-05c student cannot list users -> 403"
ok "$(req PATCH /users/$ADMIN_ID/status -H 'Content-Type: application/json' -d '{"status":"deactivated"}')" 403 "SAAS-05d student cannot touch admin status -> 403"

echo "== SAAS-06 deactivate / reactivate =="
JAR="$JAR_A"
ok "$(req PATCH /users/$STUD_ID/status -H 'Content-Type: application/json' -d '{"status":"deactivated"}')" 200 "SAAS-06a admin deactivates student -> 200"
body_has '"status":"deactivated"' "SAAS-06b status reflected"
JAR="$JAR_S"
ok "$(req GET /auth/me)" 200 "SAAS-06c student session still authenticated (global)"
ok "$(req GET /users)" 403 "SAAS-06d deactivated student blocked from tenant endpoints -> 403"
ok "$(req GET /attempts/available)" 403 "SAAS-06e tenant access denied while deactivated -> 403"
JAR="$JAR_A"
ok "$(req PATCH /users/$ADMIN_ID/status -H 'Content-Type: application/json' -d '{"status":"deactivated"}')" 400 "SAAS-06f admin cannot self-deactivate -> 400"
ok "$(req PATCH /users/$STUD_ID/status -H 'Content-Type: application/json' -d '{"status":"active"}')" 200 "SAAS-06g reactivate student -> 200"
JAR="$JAR_S"
ok "$(req GET /attempts/available)" 200 "SAAS-06h student regains tenant access after reactivation -> 200"
ok "$(req GET /users)" 403 "SAAS-06i still forbidden from admin list -> 403"

echo "== SAAS-07 tenant isolation of user management =="
JAR="$JAR_A"; INST="$IA"
ok "$(req GET /users)" 403 "SAAS-07a foreign-institute roster denied -> 403 (not a member there)"
ok "$(req POST /users -H 'Content-Type: application/json' \
  -d "{\"email\":\"saas.leak.$RAND@test.dev\",\"password\":\"Password123!\",\"name\":\"Leak\",\"role\":\"STUDENT\"}")" 403 "SAAS-07b foreign context cannot provision -> 403"
ok "$(req PATCH /users/$STUD_ID/status -H 'Content-Type: application/json' -d '{"status":"deactivated"}')" 403 "SAAS-07c foreign-institute status edit -> 403"
INST="$DI"
ok "$(req PATCH /users/$STUD_ID/status -H 'Content-Type: application/json' -d '{"status":"active"}')" 200 "SAAS-07d demo-institute context still scopes to it -> 200"
ok "$(req GET /users)" 200 "SAAS-07e roster switch back to own institute -> 200"
body_has "$TEACH_EMAIL" "SAAS-07f created users visible in own institute roster"

echo
echo "==========================================="
echo "SAAS E2E: PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
echo "ALL PASS"