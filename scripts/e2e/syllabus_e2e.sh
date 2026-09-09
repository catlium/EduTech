#!/usr/bin/env bash
# syllabus_e2e.sh — Wave 1 (AI Syllabus generation) end-to-end harness.
# Covers the full happy path: subject + text material -> generate -> job ->
# PENDING_REVIEW proposal -> teacher edit (PATCH) -> confirm -> chapters/topics.
# Plus the negative/security block (403 student, 404 before generate, 400 no
# material, 409 after confirm, 400 invalid structure).
#
# Requirements (in addition to the api + postgres + rabbitmq stack):
#   - demo seed applied (packages/database: pnpm seed)
#   - an AI worker venv at apps/workers/.venv (ruff/mypy dev deps install pika+pydantic)
# The script starts a deterministic mock AI provider + the local AI worker itself.
# Exits non-zero on any FAIL.

set -u
BASE="http://localhost:3000/api/v1"
MOCK_PORT=8899
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CJ="/tmp/opencode/syl_ck.txt"
CJS="/tmp/opencode/syl_ck_s.txt"
BODY_FILE="/tmp/opencode/syl_body.tmp"
PASS=0
FAIL=0
FAILURES=()

DEMO="99999999-9999-9999-9999-999999999999"
RAND="$(date +%s)"
MOCK_PID=""
WRKR_PID=""

# --- helpers ---------------------------------------------------------------
ok() { # ok <http_code> <expected> <label>
  local code="$1" exp="$2" label="$3"
  if [ "$code" = "$exp" ]; then PASS=$((PASS+1)); echo "  ok $label";
  else FAIL=$((FAIL+1)); FAILURES+=("$label: expected $exp got $code"); echo "  FAIL $label (got $code, want $exp)"; fi
}
notok() { # notok <http_code> <code_should_not_be> <label>
  local code="$1" exp="$2" label="$3"
  if [ "$code" != "$exp" ]; then PASS=$((PASS+1)); echo "  ok $label";
  else FAIL=$((FAIL+1)); FAILURES+=("$label: unexpected $exp"); echo "  FAIL $label (got $code, should not be $exp)"; fi
}
body_has() { # body_has <substring> <label> (reads $BODY_FILE)
  local sub="$1" label="$2"
  if grep -qF "$sub" "$BODY_FILE"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$label: missing '$sub' in body"); echo "  FAIL $label (missing '$sub')"; fi
}
body_missing() { # body_missing <substring> <label>
  local sub="$1" label="$2"
  if ! grep -qF "$sub" "$BODY_FILE"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$label: unexpected '$sub' in body"); echo "  FAIL $label (found '$sub')"; fi
}
# req <method> <path> [curl args...] — writes body to $BODY_FILE, echoes http code
req() {
  local method="$1" path="$2"; shift 2
  local code
  code=$(curl -s -b "$CJ" -X "$method" "$BASE$path" "$@" -o "$BODY_FILE" -w '%{http_code}')
  echo "$code"
}
req_as() { # req_as <jar> <method> <path> [curl args...]
  local jar="$1" method="$2" path="$3"; shift 3
  local code
  code=$(curl -s -b "$jar" -X "$method" "$BASE$path" "$@" -o "$BODY_FILE" -w '%{http_code}')
  echo "$code"
}
jget() { # jget <key> — reads $BODY_FILE, prints first value for key
  grep -oP "\"$1\"\s*:\s*\"?[^\",}]*" "$BODY_FILE" | head -1 | sed -E "s/\"$1\"\s*:\s*\"?//"
}
login_user() { # login_user <email> <jar>
  local email="$1" jar="$2"
  if [ -f "$jar" ] && grep -q "access_token" "$jar"; then
    if curl -s -b "$jar" "$BASE/auth/me" -o /dev/null -w '%{http_code}' | grep -q 200; then return 0; fi
    echo "  stale jar for $email, re-logging in"; rm -f "$jar"
  fi
  local attempt code
  for attempt in 1 2 3; do
    code=$(curl -s -c "$jar" -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$email\",\"password\":\"Password123!\"}" -o /dev/null -w '%{http_code}')
    if [ "$code" = "200" ]; then return 0; fi
    echo "  login $email rc=$code, sleeping 35s (auth throttle)"; sleep 35
  done
  echo "  FATAL: could not login $email"; exit 1
}
poll_job() { # poll_job <jobId> <seconds> — waits until job terminal; echoes final status
  local job_id="$1" timeout="$2" started deadlines status
  started=$(date +%s)
  while true; do
    req GET "/academic/subjects/$SUBJ/syllabus/jobs/$job_id" -H "x-institute-id: $DEMO" >/dev/null 2>&1 || true
    status=$(jget status)
    if [ "$status" = "completed" ] || [ "$status" = "failed" ]; then echo "$status"; return 0; fi
    deadlines=$(date +%s)
    if [ $((deadlines - started)) -gt "$timeout" ]; then echo "timeout"; return 1; fi
    sleep 2
  done
}

cleanup() {
  [ -n "$WRKR_PID" ] && kill "$WRKR_PID" 2>/dev/null
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null
}
trap cleanup EXIT

# --- bring up deterministic AI provider + worker ---------------------------
echo "== starting mock AI provider (port $MOCK_PORT) + local AI worker =="
python3 "$REPO_ROOT/scripts/e2e/mock_ai_provider.py" &
MOCK_PID=$!
sleep 1
(
  cd "$REPO_ROOT/apps/workers" || exit 1
  env WORKER_ROLE=ai \
      WORKER_RABBITMQ_URL="amqp://catlium:catlium_dev_secret@localhost:5672" \
      WORKER_DATABASE_URL="postgresql://catlium:catlium_dev_secret@localhost:5432/catlium_dev" \
      WORKER_AI_PROVIDER_URL="http://127.0.0.1:$MOCK_PORT/v1" \
      WORKER_AI_MODEL="syllabus-mock" \
      ./.venv/bin/python -m worker.app
) >/tmp/opencode/syl_worker.log 2>&1 &
WRKR_PID=$!
sleep 2

echo "== fixtures: login =="
login_user "teacher@catlium.dev" "$CJ"
login_user "student@catlium.dev" "$CJS"

echo "== SYL-01 create subject + syllabus text material =="
CS=$(req POST /academic/subjects -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"name\":\"Mathematics Demo $RAND\",\"slug\":\"math-demo-$RAND\"}")
ok "$CS" 201 "SYL-01 create subject 201"
SUBJ=$(jget id)
echo "  subject=$SUBJ"

CM=$(req POST /materials/text -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"title\":\"Mathematics syllabus $RAND\",\"subjectId\":\"$SUBJ\",\"text\":\"1. Numbers: rational and irrational numbers, operations on real numbers. 2. Algebra: linear equations, quadratic equations. 3. Geometry: shapes and space.\"}")
ok "$CM" 201 "SYL-01 create text material 201"
body_has '"processingStatus":"READY"' "SYL-01 material READY"
MAT=$(jget id)
echo "  material=$MAT"

echo "== SYL-02 no proposal before generate =="
NG=$(req GET "/academic/subjects/$SUBJ/syllabus" -H "x-institute-id: $DEMO")
ok "$NG" 404 "SYL-02 proposal before generate -> 404"

echo "== SYL-03 generate -> queued, job completes =="
GG=$(req POST "/academic/subjects/$SUBJ/syllabus/generate" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d "{\"materialId\":\"$MAT\"}")
ok "$GG" 202 "SYL-03 generate 202"
body_has '"status":"QUEUED"' "SYL-03 queued"
JOB=$(jget jobId)
echo "  job=$JOB"
status=$(poll_job "$JOB" 45)
ok "$status" "completed" "SYL-03 job completes"
req GET "/academic/subjects/$SUBJ/syllabus/jobs/$JOB" -H "x-institute-id: $DEMO" >/dev/null
body_has '"proposalId"' "SYL-03 job result proposalId"

echo "== SYL-04 proposal present + PENDING_REVIEW =="
GP=$(req GET "/academic/subjects/$SUBJ/syllabus" -H "x-institute-id: $DEMO")
ok "$GP" 200 "SYL-04 get proposal 200"
body_has '"status":"PENDING_REVIEW"' "SYL-04 pending review"
body_has '"Number Systems"' "SYL-04 chapter 1 name"
body_has '"Rational and Irrational Numbers"' "SYL-04 topic 1 name"
body_has '"Algebra"' "SYL-04 chapter 2 name"
body_has '"Geometry"' "SYL-04 chapter 3 name"
PROP=$(jget id)

echo "== SYL-05 teacher edits proposal (PATCH) =="
PU=$(req PATCH "/academic/subjects/$SUBJ/syllabus" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d '{"structure":{"chapters":[{"name":"Number Systems","description":"Foundations of numbers","topics":[{"name":"Rational and Irrational Numbers"},{"name":"Operations on Real Numbers"}]},{"name":"Advanced Algebra","topics":[{"name":"Linear Equations"}]},{"name":"Geometry","description":"Shapes and space","topics":[]}]}}')
ok "$PU" 200 "SYL-05 patch proposal 200"
body_has '"Advanced Algebra"' "SYL-05 edited chapter stored"
body_has '"Linear Equations"' "SYL-05 kept topic stored"
body_missing '"Quadratic Equations"' "SYL-05 dropped topic removed"

echo "== SYL-06 invalid structure rejected =="
PI=$(req PATCH "/academic/subjects/$SUBJ/syllabus" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d '{"structure":{"chapters":[]}}')
ok "$PI" 400 "SYL-06 empty chapters -> 400"

echo "== SYL-07 confirm -> chapters + topics created =="
CF=$(req POST "/academic/subjects/$SUBJ/syllabus/confirm" -H "x-institute-id: $DEMO")
ok "$CF" 201 "SYL-07 confirm 201"
body_has '"status":"CONFIRMED"' "SYL-07 proposal CONFIRMED"
body_has '"confirmedAt":' "SYL-07 confirmedAt set"
CH=$(req GET "/academic/subjects/$SUBJ/chapters" -H "x-institute-id: $DEMO")
ok "$CH" 200 "SYL-07 chapters list 200"
CH_COUNT=$(grep -oP '"chapterId"|"id":"[0-9a-f-]{36}"' "$BODY_FILE" | wc -l)
body_has '"Advanced Algebra"' "SYL-07 edited chapter created"
body_has '"Number Systems"' "SYL-07 chapter 1 created"
body_has '"Geometry"' "SYL-07 chapter 3 created"
CHAP=$(grep -oP '"id":"[0-9a-f-]{36}"' "$BODY_FILE" | head -1 | cut -d'"' -f4)
echo "  chapters: $CH_COUNT rows, first=$CHAP"

TP=$(req GET "/academic/chapters/$CHAP/topics" -H "x-institute-id: $DEMO")
ok "$TP" 200 "SYL-07 topics of chapter 200"
body_has '"Rational and Irrational Numbers"' "SYL-07 chapter topics created"

echo "== SYL-08 terminal-state guards =="
RG=$(req POST "/academic/subjects/$SUBJ/syllabus/generate" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d "{\"materialId\":\"$MAT\"}")
ok "$RG" 409 "SYL-08 regenerate after confirm -> 409"
RP=$(req PATCH "/academic/subjects/$SUBJ/syllabus" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{"structure":{"chapters":[{"name":"X"}]}}')
ok "$RP" 409 "SYL-08 patch after confirm -> 409"
RC=$(req POST "/academic/subjects/$SUBJ/syllabus/confirm" -H "x-institute-id: $DEMO")
ok "$RC" 409 "SYL-08 confirm again -> 409"

echo "== SYL-09 generate without material -> 400 =="
CS2=$(req POST /academic/subjects -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"name\":\"Empty Subject $RAND\",\"slug\":\"empty-$RAND\"}")
ok "$CS2" 201 "SYL-09 create subject 201"
SUBJ2=$(jget id)
GEM=$(req POST "/academic/subjects/$SUBJ2/syllabus/generate" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{}')
ok "$GEM" 400 "SYL-09 no material -> 400"

echo "== SYL-10 security: student cannot write, can read =="
SG=$(req_as "$CJS" POST "/academic/subjects/$SUBJ/syllabus/generate" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{}')
ok "$SG" 403 "SYL-10 student generate -> 403"
SP=$(req_as "$CJS" PATCH "/academic/subjects/$SUBJ/syllabus" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{"structure":{"chapters":[{"name":"X"}]}}')
ok "$SP" 403 "SYL-10 student patch -> 403"
SC=$(req_as "$CJS" POST "/academic/subjects/$SUBJ/syllabus/confirm" -H "x-institute-id: $DEMO")
ok "$SC" 403 "SYL-10 student confirm -> 403"
SR=$(req_as "$CJS" GET "/academic/subjects/$SUBJ/syllabus" -H "x-institute-id: $DEMO")
ok "$SR" 200 "SYL-10 student read -> 200"

echo "== SYL-11 cross-tenant isolation =="
# Subject belongs to DEMO institute; calling from a signed-in non-member returns 403/404.
XN=$(req GET "/academic/subjects/$SUBJ/syllabus" -H "x-institute-id: 11111111-1111-1111-1111-111111111111")
ok "$XN" 403 "SYL-11 foreign tenant read -> 403"
NC=$(curl -s -X GET "$BASE/academic/subjects/$SUBJ/syllabus" -H "x-institute-id: $DEMO" -o /dev/null -w "%{http_code}")
ok "$NC" 401 "SYL-11 no cookie -> 401"

echo ""
echo "=========================================="
echo "RESULT: PASS=$PASS FAIL=$FAIL"
echo "=========================================="
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi