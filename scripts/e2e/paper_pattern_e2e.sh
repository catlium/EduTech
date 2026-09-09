#!/usr/bin/env bash
# paper_pattern_e2e.sh — Phase 18 (Paper Pattern / Blueprint) end-to-end harness.
# Covers: CRUD, TEXT-source AI analysis -> REVIEW draft, deterministic validate,
# approve -> APPROVED (immutable), assessment creation from a blueprint, and
# blueprint-constrained question generation (satisfied true/false) + marks
# override linking. Plus negative/security: student 403, cross-tenant 403/404,
# no-cookie 401, version-mismatch 409, invalid-approve 400.
#
# Requirements (in addition to the api + postgres + rabbitmq stack):
#   - demo seed applied and stack running (docker compose base + dev + demo)
#   - dockerized worker-ai (WORKER_AI_MODEL=auto) + mock-ai rebuilt with the
#     BLUEPRINT canned payload — no local worker needed.
# Exits non-zero on any FAIL.

set -u
BASE="http://localhost:3000/api/v1"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CJ="/tmp/opencode/pp_ck.txt"
CJS="/tmp/opencode/pp_ck_s.txt"
BODY_FILE="/tmp/opencode/pp_body.tmp"
PASS=0
FAIL=0
FAILURES=()

DEMO="99999999-9999-9999-9999-999999999999"
FOREIGN="11111111-1111-1111-1111-111111111111"
RAND="$(date +%s)"
UUIDA="8f2c0a6e-9b4e-4f6a-9f1c-0000000000a1"
UUIDB="8f2c0a6e-9b4e-4f6a-9f1c-0000000000a2"

# --- helpers (self-contained, same convention as sibling suites) ----------
ok() { local code="$1" exp="$2" label="$3"
  if [ "$code" = "$exp" ]; then PASS=$((PASS+1)); echo "  ok $label";
  else FAIL=$((FAIL+1)); FAILURES+=("$label: expected $exp got $code"); echo "  FAIL $label (got $code, want $exp)"; fi }
notok() { local code="$1" exp="$2" label="$3"
  if [ "$code" != "$exp" ]; then PASS=$((PASS+1)); echo "  ok $label";
  else FAIL=$((FAIL+1)); FAILURES+=("$label: unexpected $exp"); echo "  FAIL $label (got $code, should not be $exp)"; fi }
body_has() { local sub="$1" label="$2"
  if grep -qF "$sub" "$BODY_FILE"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$label: missing '$sub' in body"); echo "  FAIL $label (missing '$sub')"; fi }
body_missing() { local sub="$1" label="$2"
  if ! grep -qF "$sub" "$BODY_FILE"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$label: unexpected '$sub' in body"); echo "  FAIL $label (found '$sub')"; fi }
req() { # req <method> <path> [curl args...]
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
login_user() { local email="$1" jar="$2"
  local attempt code
  for attempt in 1 2 3; do
    code=$(curl -s -c "$jar" -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$email\",\"password\":\"Password123!\"}" -o /dev/null -w '%{http_code}')
    if [ "$code" = "200" ]; then return 0; fi
    echo "  login $email rc=$code, sleeping 35s (auth throttle)"; sleep 35
  done
  echo "  FATAL: could not login $email"; exit 1
}
poll_job() { # poll_job <jobId> <seconds> — polls GET /jobs/:jobId; echoes final status
  local job_id="$1" timeout="$2" started deadlines status
  started=$(date +%s)
  while true; do
    req GET "/jobs/$job_id" -H "x-institute-id: $DEMO" >/dev/null 2>&1 || true
    status=$(jget status)
    if [ "$status" = "completed" ] || [ "$status" = "failed" ]; then echo "$status"; return 0; fi
    deadlines=$(date +%s)
    if [ $((deadlines - started)) -gt "$timeout" ]; then echo "timeout"; return 1; fi
    sleep 2
  done
}

echo "== fixtures: login =="
login_user "teacher@catlium.dev" "$CJ"
login_user "student@catlium.dev" "$CJS"

echo "== PP-01 subject + confirmed syllabus (gives chapters/topics + READY material) =="
CS=$(req POST /academic/subjects -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"name\":\"Patterns Subject $RAND\",\"slug\":\"patterns-$RAND\"}")
ok "$CS" 201 "PP-01 create subject 201"
SUBJ=$(jget id)
CM=$(req POST /materials/text -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"title\":\"Patterns syllabus $RAND\",\"subjectId\":\"$SUBJ\",\"text\":\"1. Numbers: rational and irrational numbers, operations on real numbers. 2. Algebra: linear equations, quadratic equations. 3. Geometry: shapes and space.\"}")
ok "$CM" 201 "PP-01 syllabus material 201"
body_has '"processingStatus":"READY"' "PP-01 material READY"
MAT_SYL=$(jget id)
GG=$(req POST "/academic/subjects/$SUBJ/syllabus/generate" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d "{\"materialId\":\"$MAT_SYL\"}")
ok "$GG" 202 "PP-01 syllabus generate 202"
JOB=$(jget jobId); status=$(poll_job "$JOB" 45)
ok "$status" "completed" "PP-01 syllabus job completes"
CF=$(req POST "/academic/subjects/$SUBJ/syllabus/confirm" -H "x-institute-id: $DEMO")
ok "$CF" 201 "PP-01 confirm 201"
CH=$(req GET "/academic/subjects/$SUBJ/chapters" -H "x-institute-id: $DEMO")
CHAP=$(grep -oP '"id":"[0-9a-f-]{36}"' "$BODY_FILE" | head -1 | cut -d'"' -f4)
TP=$(req GET "/academic/chapters/$CHAP/topics" -H "x-institute-id: $DEMO")
TOPIC=$(grep -oP '"id":"[0-9a-f-]{36}"' "$BODY_FILE" | head -1 | cut -d'"' -f4)
CN=$(req POST /materials/text -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"title\":\"Patterns content $RAND\",\"topicId\":\"$TOPIC\",\"text\":\"Rational numbers include integers, fractions, terminating and repeating decimals.\"}")
ok "$CN" 201 "PP-01 content material 201"
echo "  subject=$SUBJ topic=$TOPIC"

echo "== PP-02 duplicate-query guard: two jobs, same source+pattern =="
P1=$(req POST /paper-patterns -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"title\":\"Blueprint One $RAND\",\"subjectId\":\"$SUBJ\"}")
ok "$P1" 201 "PP-02 create pattern 201"
PAT1=$(jget id)
GA=$(req POST "/paper-patterns/$PAT1/analyze" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"source\":{\"type\":\"TEXT\",\"text\":\"This paper pattern:\nSection A: 10 multiple choice questions, 1 mark each.\nSection B: 5 true or false questions, 2 marks each.\nTotal 20 marks, 40 minutes.\"}}")
ok "$GA" 202 "PP-02 analyze 202"
body_has '"operation":"AI_GENERATE_BLUEPRINT"' "PP-02 blueprint operation"
JOB=$(jget jobId)
# A second analyze of the same pattern while the first is still queued must 409
# (partial unique index on active generation jobs); the first may have already
# completed, in which case a 202 is equally valid — so assert "not failed".
GA2=$(req POST "/paper-patterns/$PAT1/analyze" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"source\":{\"type\":\"TEXT\",\"text\":\"same\"}}")
notok "$GA2" "500" "PP-02 duplicate analyze never 500"
status=$(poll_job "$JOB" 60)
ok "$status" "completed" "PP-02 analyze job completes"
req GET "/paper-patterns/$PAT1/analyze/$JOB" -H "x-institute-id: $DEMO" >/dev/null
body_has '"status":"REVIEW"' "PP-02 job result status REVIEW"
body_has '"sectionCount":2' "PP-02 job result 2 sections"
body_has '"totalMarks":20' "PP-02 job result totalMarks 20"

echo "== PP-03 analyzed draft written onto the pattern (REVIEW) =="
GP=$(req GET "/paper-patterns/$PAT1" -H "x-institute-id: $DEMO")
ok "$GP" 200 "PP-03 get pattern 200"
body_has '"status":"REVIEW"' "PP-03 pattern moved to REVIEW"
body_has '"Section A — Multiple Choice"' "PP-03 section A stored"
body_has '"Section B — True or False"' "PP-03 section B stored"
body_has '"durationMinutes":40' "PP-03 duration stored"
body_has '"sourceMaterialId":' "PP-03 source material recorded"

echo "== PP-04 validate (deterministic) on the AI draft =="
VA=$(req POST "/paper-patterns/$PAT1/validate" -H "x-institute-id: $DEMO")
ok "$VA" 200 "PP-04 validate 200"
body_has '"valid":true' "PP-04 draft is valid"
body_has '"errors":[]' "PP-04 no errors"

echo "== PP-05 approve -> APPROVED =="
AP=$(req POST "/paper-patterns/$PAT1/approve" -H "x-institute-id: $DEMO")
ok "$AP" 200 "PP-05 approve 200"
body_has '"status":"APPROVED"' "PP-05 pattern APPROVED"
body_has '"approvedAt":' "PP-05 approvedAt set"
body_has '"validatedAt":' "PP-05 validatedAt set"

echo "== PP-06 APPROVED is immutable =="
ED=$(req PATCH "/paper-patterns/$PAT1" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{"title":"Hacked"}')
ok "$ED" 409 "PP-06 edit APPROVED -> 409"
RA=$(req POST "/paper-patterns/$PAT1/analyze" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{"source":{"type":"TEXT","text":"x"}}')
ok "$RA" 409 "PP-06 re-analyze APPROVED -> 409"
AP2=$(req POST "/paper-patterns/$PAT1/approve" -H "x-institute-id: $DEMO")
ok "$AP2" 409 "PP-06 approve again -> 409"

echo "== PP-07 manual DRAFT pattern: invalid arithmetic caught at validate/approve =="
P2=$(req POST /paper-patterns -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"title\":\"Invalid Pattern $RAND\",\"subjectId\":\"$SUBJ\",\"structure\":{\"totalMarks\":20,\"durationMinutes\":40,\"instructions\":[],\"sections\":[{\"id\":\"$UUIDA\",\"name\":\"Section A\",\"questionType\":\"MCQ\",\"count\":10,\"marksPerQuestion\":1,\"totalMarks\":50,\"compulsory\":true}]}}")
ok "$P2" 201 "PP-07 create invalid pattern 201"
PAT2=$(jget id)
VI=$(req POST "/paper-patterns/$PAT2/validate" -H "x-institute-id: $DEMO")
ok "$VI" 200 "PP-07 validate 200"
body_has '"valid":false' "PP-07 arithmetic flagged invalid"
body_has "does not match" "PP-07 mismatch described"
AI=$(req POST "/paper-patterns/$PAT2/approve" -H "x-institute-id: $DEMO")
ok "$AI" 400 "PP-07 approve invalid -> 400"

echo "== PP-08 optimistic versioning on DRAFT edits =="
P3=$(req POST /paper-patterns -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"title\":\"Versioned $RAND\",\"subjectId\":\"$SUBJ\"}")
ok "$P3" 201 "PP-08 create pattern 201"
PAT3=$(jget id)
PV=$(req PATCH "/paper-patterns/$PAT3" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{"title":"v1 update","version":2}')
ok "$PV" 409 "PP-08 stale version -> 409"
PD=$(req PATCH "/paper-patterns/$PAT3" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{"title":"v1 update ok","version":1}')
ok "$PD" 200 "PP-08 current version edit 200"
body_has '"version":2' "PP-08 optimistic bump to 2"

echo "== PP-09 assessment from an APPROVED blueprint =="
AS=$(req POST "/paper-patterns/$PAT1/assessment" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{}')
ok "$AS" 201 "PP-09 assessment 201"
ASSESS=$(jget id)
body_has '"blueprintId":"'$PAT1'"' "PP-09 blueprint provenance"
body_has '"durationMinutes":40' "PP-09 duration from blueprint"
body_has '"maxMarks":20' "PP-09 maxMarks from blueprint"
body_has '"status":"DRAFT"' "PP-09 draft assessment"
AN=$(req POST "/paper-patterns/$PAT3/assessment" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{}')
ok "$AN" 400 "PP-09 assessment from non-approved -> 400"

echo "== PP-10 marks override when linking questions =="
# Reuse the 3 AI-generated MCQs: approve them, then link with a marks override.
GQ=$(req POST /questions/generate -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"topicId\":\"$TOPIC\",\"questionType\":\"MCQ\",\"count\":3,\"difficulty\":\"EASY\"}")
ok "$GQ" 202 "PP-10 questions generate 202"
JOB=$(jget jobId); status=$(poll_job "$JOB" 45)
ok "$status" "completed" "PP-10 questions job completes"
req GET "/questions/generate/$JOB" -H "x-institute-id: $DEMO" >/dev/null
QIDS=$(grep -oP '"questionIds":\[[^]]*\]' "$BODY_FILE" | grep -oP '[0-9a-f-]{36}' | tr '\n' ' ')
QID_LIST=$(printf '"%s",' $QIDS | sed 's/,$//')
Q1=$(printf '%s' "$QIDS" | awk '{print $1}')
Q2=$(printf '%s' "$QIDS" | awk '{print $2}')
for QID in $QIDS; do
  APQ=$(req POST /questions/$QID/approve -H "x-institute-id: $DEMO")
  ok "$APQ" 201 "PP-10 approve question"
done
LQ=$(req POST "/assessments/$ASSESS/questions" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"questionIds\":[$QID_LIST],\"marks\":{\"$Q1\":5,\"$Q2\":3}}")
ok "$LQ" 201 "PP-10 link questions with marks 201"
body_has '"marks":5' "PP-10 first override marks 5"
body_has '"marks":3' "PP-10 second override marks 3"
BM=$(req POST "/assessments/$ASSESS/questions" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"questionIds\":[$QID_LIST],\"marks\":{\"$Q1\":0}}")
ok "$BM" 400 "PP-10 marks below 1 -> 400"

echo "== PP-11 blueprint-constrained generation (satisfied true) =="
PB=$(req POST /paper-patterns -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"title\":\"Tiny 3 MCQ Pattern $RAND\",\"subjectId\":\"$SUBJ\",\"structure\":{\"totalMarks\":3,\"durationMinutes\":10,\"instructions\":[],\"sections\":[{\"id\":\"$UUIDB\",\"name\":\"Section A\",\"questionType\":\"MCQ\",\"count\":3,\"marksPerQuestion\":1,\"totalMarks\":3,\"compulsory\":true}]}}")
ok "$PB" 201 "PP-11 create tiny pattern 201"
PAT_TINY=$(jget id)
VT=$(req POST "/paper-patterns/$PAT_TINY/validate" -H "x-institute-id: $DEMO")
ok "$VT" 200 "PP-11 tiny pattern valid"
AT=$(req POST "/paper-patterns/$PAT_TINY/approve" -H "x-institute-id: $DEMO")
ok "$AT" 200 "PP-11 tiny pattern approved"
GB=$(req POST /questions/generate -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"topicId\":\"$TOPIC\",\"questionType\":\"MCQ\",\"count\":3,\"difficulty\":\"EASY\",\"blueprintId\":\"$PAT_TINY\"}")
ok "$GB" 202 "PP-11 constrained generate 202"
JOB=$(jget jobId); status=$(poll_job "$JOB" 45)
ok "$status" "completed" "PP-11 constrained job completes"
req GET "/questions/generate/$JOB" -H "x-institute-id: $DEMO" >/dev/null
body_has '"satisfied":true' "PP-11 blueprint satisfied"

echo "== PP-12 blueprint-constrained generation (satisfied false) =="
# Full 10-MCQ blueprint (PAT1) vs a 3-question generation -> quota missed.
GB2=$(req POST /questions/generate -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"topicId\":\"$TOPIC\",\"questionType\":\"MCQ\",\"count\":3,\"difficulty\":\"EASY\",\"blueprintId\":\"$PAT1\"}")
ok "$GB2" 202 "PP-12 constrained generate 202"
JOB=$(jget jobId); status=$(poll_job "$JOB" 45)
ok "$status" "completed" "PP-12 constrained job completes"
req GET "/questions/generate/$JOB" -H "x-institute-id: $DEMO" >/dev/null
body_has '"satisfied":false' "PP-12 blueprint not satisfied"
body_has "expects 10 MCQ questions, this generation produced 3" "PP-12 quota mismatch reported"

echo "== PP-13 generation with a non-approved blueprint -> 400 =="
GB3=$(req POST /questions/generate -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"topicId\":\"$TOPIC\",\"questionType\":\"MCQ\",\"count\":3,\"difficulty\":\"EASY\",\"blueprintId\":\"$PAT3\"}")
ok "$GB3" 400 "PP-13 non-approved blueprint -> 400"

echo "== PP-14 security: student blocked from blueprint writes =="
SC1=$(req_as "$CJS" POST /paper-patterns -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{"title":"Sneaky","subjectId":"'$SUBJ'"}')
ok "$SC1" 403 "PP-14 student create -> 403"
SC2=$(req_as "$CJS" POST "/paper-patterns/$PAT1/analyze" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{"source":{"type":"TEXT","text":"x"}}')
ok "$SC2" 403 "PP-14 student analyze -> 403"
SC3=$(req_as "$CJS" POST "/paper-patterns/$PAT1/approve" -H "x-institute-id: $DEMO")
ok "$SC3" 403 "PP-14 student approve -> 403"
SC4=$(req_as "$CJS" POST "/paper-patterns/$PAT1/assessment" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{}')
ok "$SC4" 403 "PP-14 student assessment -> 403"
scd=$(req_as "$CJS" GET "/paper-patterns/$PAT1" -H "x-institute-id: $DEMO")
ok "$scd" 403 "PP-14 student read -> 403"

echo "== PP-15 cross-tenant isolation =="
XT=$(req GET "/paper-patterns/$PAT1" -H "x-institute-id: $FOREIGN")
ok "$XT" 403 "PP-15 foreign tenant read -> 403"
XW=$(req POST "/paper-patterns/$PAT1/approve" -H "x-institute-id: $FOREIGN")
ok "$XW" 403 "PP-15 foreign tenant approve -> 403"
NF=$(req GET "/paper-patterns/00000000-0000-4000-8000-000000000000" -H "x-institute-id: $DEMO")
ok "$NF" 404 "PP-15 missing pattern -> 404"
NC=$(curl -s -X GET "$BASE/paper-patterns/$PAT1" -H "x-institute-id: $DEMO" -o /dev/null -w "%{http_code}")
ok "$NC" 401 "PP-15 no cookie -> 401"

echo ""
echo "=========================================="
echo "RESULT: PASS=$PASS FAIL=$FAIL"
echo "=========================================="
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi