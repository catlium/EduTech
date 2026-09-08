#!/usr/bin/env bash
# demo_e2e.sh — Demo Milestone full-journey E2E harness.
# Mirrors the definition of immediate success (docs/architecture/demo-milestone.md):
#
#   TEACHER: create subject -> syllabus material -> AI syllabus -> confirm
#            chapters/topics -> content material -> AI note -> AI questions ->
#            approve -> create quiz -> link -> publish -> activate
#   STUDENT: see quiz -> start attempt -> answer -> submit -> evaluated result
#
# All AI steps run through the real NestJS API + RabbitMQ + worker against a
# deterministic mock OpenAI-compatible provider (model-keyed responses). The
# student answers deliberately wrong MAYBE one question so the result review
# shows both correct and incorrect grading.
#
# Requirements: live api + postgres + rabbitmq stack (dockerized), demo seed
# applied (pnpm db:seed), and a local worker venv at apps/workers/.venv.
# Exits non-zero on any FAIL.
#
# The mock provider + ai worker are started and torn down by this script.

set -u
BASE="http://localhost:3000/api/v1"
MOCK_PORT=8899
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_URL="postgresql://catlium:catlium_dev_secret@localhost:5432/catlium_dev"
CJ="/tmp/opencode/demo_teacher.txt"
CJS="/tmp/opencode/demo_student.txt"
BODY_FILE="/tmp/opencode/demo_body.tmp"
QMAP="/tmp/opencode/demo_qmap.txt"
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
body_has() { # body_has <substring> <label> (reads $BODY_FILE)
  local sub="$1" label="$2"
  if grep -qF "$sub" "$BODY_FILE"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$label: missing '$sub' in body"); echo "  FAIL $label (missing '$sub')"; fi
}
body_not_has() { # body_not_has <regex> <label>
  local sub="$1" label="$2"
  if ! grep -qE "$sub" "$BODY_FILE"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$label: forbidden '$sub' appeared"); echo "  FAIL $label (contains '$sub')"; fi
}
req() { # req <method> <path> [curl args...] — uses $CJ, writes body to $BODY_FILE, echoes http code
  local method="$1" path="$2"; shift 2
  curl -s -b "$CJ" -X "$method" "$BASE$path" "$@" -o "$BODY_FILE" -w '%{http_code}'
}
req_as() { # req_as <jar> <method> <path> [curl args...]
  local jar="$1" method="$2" path="$3"; shift 3
  curl -s -b "$jar" -X "$method" "$BASE$path" "$@" -o "$BODY_FILE" -w '%{http_code}'
}
jget() { # jget <key> — reads $BODY_FILE, prints first value for key
  grep -oP "\"$1\"\s*:\s*\"?[^\",}]*" "$BODY_FILE" | head -1 | sed -E "s/\"$1\"\s*:\s*\"?//"
}
login_user() { # login_user <email> <jar>
  local email="$1" jar="$2"
  if [ -f "$jar" ] && grep -q "access_token" "$jar"; then return 0; fi
  local attempt code
  for attempt in 1 2 3; do
    code=$(curl -s -c "$jar" -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$email\",\"password\":\"Password123!\"}" -o /dev/null -w '%{http_code}')
    if [ "$code" = "200" ]; then return 0; fi
    echo "  login $email rc=$code, sleeping 35s (auth throttle)"; sleep 35
  done
  echo "  FATAL: could not login $email"; exit 1
}
sql() { # sql <statement> — node+pg (resolves inside packages/database)
  (cd "$REPO_ROOT/packages/database" && DATABASE_URL="$DB_URL" \
    node --input-type=module -e '
      import pg from "pg";
      const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await c.connect();
      await c.query(process.argv[1]);
      await c.end();
    ' "$1")
}
poll_job() { # poll_job <jobId> <timeout_s> — polls GET /jobs/:jobId; echoes final status
  local job_id="$1" timeout="$2" started now status
  started=$(date +%s)
  while true; do
    req GET "/jobs/$job_id" -H "x-institute-id: $DEMO" >/dev/null 2>&1 || true
    status=$(jget status)
    if [ "$status" = "completed" ] || [ "$status" = "failed" ]; then echo "$status"; return 0; fi
    now=$(date +%s)
    if [ $((now - started)) -gt "$timeout" ]; then echo "timeout"; return 1; fi
    sleep 2
  done
}
start_ai_worker() { # start_ai_worker <model> — replaces the running AI worker
  [ -n "$WRKR_PID" ] && kill "$WRKR_PID" 2>/dev/null
  (
    cd "$REPO_ROOT/apps/workers" || exit 1
    env WORKER_ROLE=ai \
        WORKER_RABBITMQ_URL="amqp://catlium:catlium_dev_secret@localhost:5672" \
        WORKER_DATABASE_URL="postgresql://catlium:catlium_dev_secret@localhost:5432/catlium_dev" \
        WORKER_AI_PROVIDER_URL="http://127.0.0.1:$MOCK_PORT/v1" \
        WORKER_AI_MODEL="$1" \
        ./.venv/bin/python -m worker.app
  ) >/tmp/opencode/demo_worker.log 2>&1 &
  WRKR_PID=$!
  sleep 2
}

cleanup() {
  [ -n "$WRKR_PID" ] && kill "$WRKR_PID" 2>/dev/null
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null
}
trap cleanup EXIT

# --- bring up mock provider + (initially) the syllabus AI worker ----------
echo "== starting mock AI provider (port $MOCK_PORT) + local AI worker =="
python3 "$REPO_ROOT/scripts/e2e/mock_ai_provider.py" & MOCK_PID=$!
sleep 1
start_ai_worker "syllabus-mock"

echo "== DEMO-01 login =="
login_user "teacher@catlium.dev" "$CJ"
login_user "student@catlium.dev" "$CJS"

echo "== DEMO-02 teacher: create subject =="
CS=$(req POST /academic/subjects -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"name\":\"Demo Subject $RAND\",\"slug\":\"demo-subject-$RAND\"}")
ok "$CS" 201 "DEMO-02 create subject 201"
SUBJ=$(jget id)

echo "== DEMO-03 syllabus material (text, READY) =="
CM=$(req POST /materials/text -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"title\":\"Demo syllabus $RAND\",\"subjectId\":\"$SUBJ\",\"text\":\"1. Number Systems: rational numbers, irrational numbers, real numbers. 2. Algebra: linear equations, quadratic equations. 3. Geometry: shapes, space.\"}")
ok "$CM" 201 "DEMO-03 syllabus material 201"
body_has '"processingStatus":"READY"' "DEMO-03 material READY"
MAT_SYL=$(jget id)

echo "== DEMO-04 AI syllabus generation =="
GG=$(req POST "/academic/subjects/$SUBJ/syllabus/generate" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d "{\"materialId\":\"$MAT_SYL\"}")
ok "$GG" 202 "DEMO-04 syllabus generate 202"
JOB=$(jget jobId)
status=$(poll_job "$JOB" 45)
ok "$status" "completed" "DEMO-04 syllabus job completes"

echo "== DEMO-05 confirm syllabus -> chapters/topics =="
CF=$(req POST "/academic/subjects/$SUBJ/syllabus/confirm" -H "x-institute-id: $DEMO")
ok "$CF" 201 "DEMO-05 confirm 201"
body_has '"status":"CONFIRMED"' "DEMO-05 proposal CONFIRMED"
CH=$(req GET "/academic/subjects/$SUBJ/chapters" -H "x-institute-id: $DEMO")
ok "$CH" 200 "DEMO-05 chapters list 200"
body_has '"Number Systems"' "DEMO-05 chapter created"
CHAP=$(grep -oP '"id":"[0-9a-f-]{36}"' "$BODY_FILE" | head -1 | cut -d'"' -f4)
TP=$(req GET "/academic/chapters/$CHAP/topics" -H "x-institute-id: $DEMO")
ok "$TP" 200 "DEMO-05 topics list 200"
body_has '"Rational and Irrational Numbers"' "DEMO-05 topic created"
TOPIC=$(grep -oP '"id":"[0-9a-f-]{36}"' "$BODY_FILE" | head -1 | cut -d'"' -f4)

echo "== DEMO-06 content material (text, READY) =="
CN=$(req POST /materials/text -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"title\":\"Demo content $RAND\",\"topicId\":\"$TOPIC\",\"text\":\"Rational numbers include integers, fractions, terminating and repeating decimals.\"}")
ok "$CN" 201 "DEMO-06 content material 201"
body_has '"processingStatus":"READY"' "DEMO-06 material READY"
MAT_NOTE=$(jget id)

echo "== DEMO-07 AI note generation (content) =="
start_ai_worker "note-mock"
GN=$(req POST /content/generate -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"operation\":\"AI_GENERATE_NOTE\",\"sourceType\":\"MATERIAL\",\"sourceId\":\"$MAT_NOTE\"}")
ok "$GN" 202 "DEMO-07 note generate 202"
JOB=$(jget jobId)
status=$(poll_job "$JOB" 45)
ok "$status" "completed" "DEMO-07 note job completes"
req GET "/jobs/$JOB" -H "x-institute-id: $DEMO" >/dev/null
body_has '"contentId"' "DEMO-07 note persisted (contentId)"

echo "== DEMO-08 AI question generation (3 MCQ) =="
start_ai_worker "questions-mock"
GQ=$(req POST /questions/generate -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"topicId\":\"$TOPIC\",\"questionType\":\"MCQ\",\"count\":3,\"difficulty\":\"EASY\"}")
ok "$GQ" 202 "DEMO-08 questions generate 202"
JOB=$(jget jobId)
status=$(poll_job "$JOB" 45)
ok "$status" "completed" "DEMO-08 questions job completes"
req GET "/questions/generate/$JOB" -H "x-institute-id: $DEMO" >/dev/null
body_has '"questionIds"' "DEMO-08 questions persisted"

echo "== DEMO-09 teacher approves the 3 AI questions =="
QIDS=$(grep -oP '"questionIds":\[[^]]*\]' "$BODY_FILE" | grep -oP '[0-9a-f-]{36}' | tr '\n' ' ')
[ -n "$QIDS" ] && PASS=$((PASS+1)) && echo "  ok DEMO-09 captured 3 question ids" \
  || { FAIL=$((FAIL+1)); FAILURES+=("DEMO-09: no question ids from job result"); echo "  FAIL DEMO-09 (no ids)"; }
QID_LIST=$(printf '"%s",' $QIDS | sed 's/,$//')
BA=$(req POST /questions/batch-approve -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"questionIds\":[$QID_LIST]}")
ok "$BA" 201 "DEMO-09 batch approve 201"

echo "== DEMO-10 capture correct-answer map =="
: > "$QMAP"
MATCHED=0
for q in $QIDS; do
  Q=$(req GET "/questions/$q" -H "x-institute-id: $DEMO")
  if [ "$Q" = "200" ] && [ "$(jget id)" = "$q" ]; then
    correct=$(jq -r '.question.payload.correctChoiceId' "$BODY_FILE")
    wrong=$(jq -r --arg c "$correct" '.question.payload.choices[] | select(.id != $c) | .id' "$BODY_FILE" | head -1)
    echo "$q $correct $wrong" >> "$QMAP"
    MATCHED=$((MATCHED+1))
  fi
done
[ "$MATCHED" -eq 3 ] && PASS=$((PASS+1)) && echo "  ok DEMO-10 mapped $MATCHED questions" \
  || { FAIL=$((FAIL+1)); FAILURES+=("DEMO-10: expected 3 mapped, got $MATCHED"); echo "  FAIL DEMO-10 (mapped=$MATCHED)"; }

echo "== DEMO-11 create quiz (draft) =="
# API requires a future startsAt; the harness backdates the window via SQL the
# moment the quiz is created so the student phase below is in-window (same
# "DB is the clock" technique as attempts_e2e.sh AT-12).
ST_NOW=$(date -u -d '+2 days' +"%Y-%m-%dT%H:%M:%S.000Z")
EN_NOW=$(date -u -d '+3 days' +"%Y-%m-%dT%H:%M:%S.000Z")
CA=$(req POST /assessments -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"title\":\"Demo Quiz $RAND\",\"description\":\"Full journey quiz\",\"durationMinutes\":60,\"maxMarks\":100,\"instructions\":{\"text\":\"Read carefully\"},\"startsAt\":\"$ST_NOW\",\"endsAt\":\"$EN_NOW\"}")
ok "$CA" 201 "DEMO-11 create assessment 201"
ASSESS=$(jget id)
sql "UPDATE assessments SET starts_at = now() - interval '1 minute', ends_at = now() + interval '1 day' WHERE id = '$ASSESS'" >/dev/null

echo "== DEMO-12 link questions + publish + activate =="
LQ=$(req POST "/assessments/$ASSESS/questions" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"questionIds\":[$QID_LIST]}")
ok "$LQ" 201 "DEMO-12 link questions 201"
PUB=$(req POST "/assessments/$ASSESS/publish" -H "x-institute-id: $DEMO")
ok "$PUB" 201 "DEMO-12 publish 201"
ACT=$(req POST "/assessments/$ASSESS/activate" -H "x-institute-id: $DEMO")
ok "$ACT" 201 "DEMO-12 activate 201"

echo "== DEMO-13 student sees the quiz =="
JAR="$CJS"
AV=$(req_as "$CJS" GET /attempts/available -H "x-institute-id: $DEMO")
ok "$AV" 200 "DEMO-13 available 200"
body_has "Demo Quiz $RAND" "DEMO-13 quiz listed"
body_not_has "correctChoiceId|correctAnswer|acceptableAnswers|explanation" "DEMO-13 no answer-key in available list"

echo "== DEMO-14 student starts attempt =="
ST=$(req_as "$CJS" POST /attempts -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d "{\"assessmentId\":\"$ASSESS\"}")
ok "$ST" 201 "DEMO-14 start attempt 201"
body_has '"status":"IN_PROGRESS"' "DEMO-14 IN_PROGRESS"
body_has '"totalMarks":3' "DEMO-14 total 3 marks"
body_not_has "correctChoiceId|correctAnswer|acceptableAnswers|explanation" "DEMO-14 snapshot sanitized"
ATT=$(jget id)

echo "== DEMO-15 student answers (2 correct, 1 wrong) =="
DET=$(req_as "$CJS" GET "/attempts/$ATT" -H "x-institute-id: $DEMO")
ok "$DET" 200 "DEMO-15 detail for answer ids 200"
idx=0
answered=0
while read -r aq qid; do
  correct=$(awk -v q="$qid" '$1==q {print $2}' "$QMAP")
  wrong=$(awk -v q="$qid" '$1==q {print $3}' "$QMAP")
  if [ "$idx" -eq 0 ]; then choice="$wrong"; else choice="$correct"; fi
  rc=$(req_as "$CJS" PUT "/attempts/$ATT/questions/$aq" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
    -d "{\"answer\":{\"choiceId\":\"$choice\"}}")
  if [ "$rc" = "200" ]; then answered=$((answered+1)); fi
  idx=$((idx+1))
done < <(jq -r '.attempt.questions[] | "\(.attemptQuestionId) \(.questionId)"' "$BODY_FILE")
[ "$answered" -eq 3 ] && PASS=$((PASS+1)) && echo "  ok DEMO-15 answered 3 questions" \
  || { FAIL=$((FAIL+1)); FAILURES+=("DEMO-15: expected 3 saves, got $answered"); echo "  FAIL DEMO-15 (saved=$answered)"; }

echo "== DEMO-16 submit -> automatic evaluation =="
SU=$(req_as "$CJS" POST "/attempts/$ATT/submit" -H "x-institute-id: $DEMO")
ok "$SU" 200 "DEMO-16 submit 200"
body_has '"status":"SUBMITTED"' "DEMO-16 SUBMITTED"
body_has '"score":2' "DEMO-16 graded score 2 (2 correct, 1 wrong)"

echo "== DEMO-17 detail stays answer-key-free after submit =="
FIN=$(req_as "$CJS" GET "/attempts/$ATT" -H "x-institute-id: $DEMO")
ok "$FIN" 200 "DEMO-17 detail 200"
body_not_has "correctChoiceId|correctAnswer|acceptableAnswers|explanation" "DEMO-17 no answer-key leak"

echo "== DEMO-18 evaluated result review =="
RES=$(req_as "$CJS" GET "/attempts/$ATT/result" -H "x-institute-id: $DEMO")
ok "$RES" 200 "DEMO-18 result 200"
body_has '"score":2' "DEMO-18 score 2"
body_has '"totalMarks":3' "DEMO-18 total 3"
CORRC=$(jq '[.result.questions[].isCorrect] | map(select(. == true)) | length' "$BODY_FILE")
[ "$CORRC" = "2" ] && PASS=$((PASS+1)) && echo "  ok DEMO-18 2 correct questions" \
  || { FAIL=$((FAIL+1)); FAILURES+=("DEMO-18: expected 2 correct, got $CORRC"); echo "  FAIL DEMO-18 (correct=$CORRC)"; }
INC=$(jq '[.result.questions[] | select(.isCorrect == false) | .marksAwarded] | length' "$BODY_FILE")
[ "$INC" = "1" ] && PASS=$((PASS+1)) && echo "  ok DEMO-18 1 wrong question" \
  || { FAIL=$((FAIL+1)); FAILURES+=("DEMO-18: expected 1 incorrect, got $INC"); echo "  FAIL DEMO-18 (incorrect=$INC)"; }
body_has '"correctAnswer"' "DEMO-18 correct answer revealed"
body_has '"isCorrect":false' "DEMO-18 wrong answer flagged"

echo "== DEMO-19 teacher ledger shows evaluated score =="
JAR="$CJ"
TL=$(req GET "/assessments/$ASSESS/attempts" -H "x-institute-id: $DEMO")
ok "$TL" 200 "DEMO-19 ledger 200"
body_has "student@catlium.dev" "DEMO-19 student in ledger"
body_has '"score":2' "DEMO-19 ledger score 2"
body_has '"status":"SUBMITTED"' "DEMO-19 ledger SUBMITTED"
TFB=$(req_as "$CJS" GET "/assessments/$ASSESS/attempts" -H "x-institute-id: $DEMO")
ok "$TFB" 403 "DEMO-19 student ledger -> 403"

echo
echo "==========================================="
echo "DEMO E2E: PASS=$PASS FAIL=$FAIL"
echo "==========================================="
if [ "$FAIL" -gt 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
echo "ALL PASS"