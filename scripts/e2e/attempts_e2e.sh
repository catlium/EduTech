#!/usr/bin/env bash
# attempts_e2e.sh — Wave 2 (Student Examination Attempts) end-to-end harness.
# Covers: available assessment scoping, start/snapshot, sanitized DTOs (NO
# answer-key leakage), per-type answer save, duplicate-write safety, submit
# idempotency, server-side deadline enforcement, snapshot immutability,
# cross-student isolation, teacher ledger, tenant isolation.
# Exits non-zero on any FAIL. Requires live dockerized stack (api + postgres)
# with the idempotent demo seed applied (pnpm db:seed).

set -u
BASE="http://localhost:3000/api/v1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_URL="postgresql://catlium:catlium_dev_secret@localhost:5432/catlium_dev"
CJ="/tmp/opencode/att_teacher.txt"
CJS="/tmp/opencode/att_student.txt"
CJS2="/tmp/opencode/att_student2.txt"
BODY_FILE="/tmp/opencode/att_body.tmp"
PASS=0
FAIL=0
FAILURES=()

DI="99999999-9999-9999-9999-999999999999"
IA="11111111-1111-1111-1111-111111111111"
RAND="$(date +%s)"
JAR="$CJ"
INST="$DI"

# ── helpers ────────────────────────────────────────────────────────────────
ok() { # ok <http_code> <expected> <label>
  local code="$1" exp="$2" label="$3"
  if [ "$code" = "$exp" ]; then PASS=$((PASS+1)); echo "  ok $label";
  else FAIL=$((FAIL+1)); FAILURES+=("$label: expected $exp got $code"); echo "  FAIL $label (got $code, want $exp)"; fi
}
body_has() { # body_has <substring> <label>
  local sub="$1" label="$2"
  if grep -qF "$sub" "$BODY_FILE"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$label: missing '$sub' in body"); echo "  FAIL $label (missing '$sub')"; fi
}
body_not_has() { # body_not_has <substring> <label>
  local sub="$1" label="$2"
  if ! grep -qE "$sub" "$BODY_FILE"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$label: forbidden '$sub' leaked into body"); echo "  FAIL $label (contains '$sub')"; fi
}
req() { # req <method> <path> [curl args...] — writes body to $BODY_FILE, echoes http code
  local method="$1" path="$2"; shift 2
  curl -s -b "$JAR" -X "$method" "$BASE$path" -H "x-institute-id: $INST" "$@" -o "$BODY_FILE" -w '%{http_code}'
}
jget() { # jget <key> — reads $BODY_FILE, prints first value for key
  grep -oP "\"$1\"\s*:\s*\"?[^\",}]*" "$BODY_FILE" | head -1 | sed -E "s/\"$1\"\s*:\s*\"?//"
}
login_user() { # login_user <email> <jar>
  local email="$1" jar="$2"
  if [ -f "$jar" ] && grep -q "access_token" "$jar"; then return 0; fi
  local code
  code=$(curl -s -c "$jar" -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"Password123!\"}" -o /dev/null -w '%{http_code}')
  if [ "$code" != "200" ]; then echo "  FATAL: login $email rc=$code"; exit 1; fi
}
sql() { # sql <statement> — node+pg (resolves inside packages/database), prints first col of first row
  (cd "$ROOT/packages/database" && DATABASE_URL="$DB_URL" \
    node --input-type=module -e '
      import pg from "pg";
      const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await c.connect();
      const r = await c.query(process.argv[1]);
      if (r.rows.length > 0) console.log(Object.values(r.rows[0])[0] ?? "");
      await c.end();
    ' "$1")
}
pick_id() { # pick_id <name> — reads $BODY_FILE, prints id of the object whose name/title matches
  python3 - "$1" <<'PYEOF' | head -1
import json, sys
d = json.load(open('/tmp/opencode/att_body.tmp'))
arr = None
for k in ('subjects', 'assessments', 'attempts', 'questions'):
    if isinstance(d, dict) and d.get(k) is not None:
        arr = d[k]; break
if arr is None and isinstance(d, dict):
    for k in ('subject', 'assessment', 'attempt', 'question', 'chapter', 'topic'):
        if isinstance(d.get(k), dict):
            arr = [d[k]]; break
for x in arr or []:
    if x.get('name') == sys.argv[1] or x.get('title') == sys.argv[1]:
        print(x['id']); break
PYEOF
}

echo "== fixtures: seed check + login =="
login_user "teacher@catlium.dev" "$CJ"
login_user "student@catlium.dev" "$CJS"

echo "== fixtures: academic scope (subject/chapter/topic) =="
JAR="$CJ"
req POST /academic/subjects -H 'Content-Type: application/json' -d "{\"name\":\"Attempts $RAND\",\"slug\":\"attempts-$RAND\"}" >/dev/null
SUBJ=$(pick_id "Attempts $RAND")
req POST "/academic/subjects/$SUBJ/chapters" -H 'Content-Type: application/json' -d '{"name":"Ch1","slug":"ch1"}' >/dev/null
CHID=$(pick_id Ch1)
req POST "/academic/chapters/$CHID/topics" -H 'Content-Type: application/json' -d '{"name":"Tp1","slug":"tp1"}' >/dev/null
TOPIC=$(pick_id Tp1)
echo "subject=$SUBJ topic=$TOPIC"

echo "== fixtures: questions (2 MCQ, 1 TF, 1 FIB) + approve =="
MC1A="ba111111-1111-4111-8111-000000000001"
MC1B="ba222222-2222-4222-8222-000000000001"
MC2A="ba333333-3333-4333-8333-000000000002"
MC2B="ba444444-4444-4444-8444-000000000002"
req POST /questions -H 'Content-Type: application/json' \
  -d "{\"stem\":\"$RAND immut stem q1\",\"questionType\":\"MCQ\",\"source\":\"MANUAL\",\"difficulty\":\"EASY\",\"topicId\":\"$TOPIC\",\"payload\":{\"choices\":[{\"id\":\"$MC1A\",\"text\":\"Alpha\"},{\"id\":\"$MC1B\",\"text\":\"Beta\"}],\"correctChoiceId\":\"$MC1B\"}}" >/dev/null
Q1=$(jget id)
req POST /questions -H 'Content-Type: application/json' \
  -d "{\"stem\":\"q2 mcq\",\"questionType\":\"MCQ\",\"source\":\"MANUAL\",\"difficulty\":\"EASY\",\"topicId\":\"$TOPIC\",\"payload\":{\"choices\":[{\"id\":\"$MC2A\",\"text\":\"X\"},{\"id\":\"$MC2B\",\"text\":\"Y\"}],\"correctChoiceId\":\"$MC2A\"}}" >/dev/null
Q2=$(jget id)
req POST /questions -H 'Content-Type: application/json' \
  -d "{\"stem\":\"tf q\",\"questionType\":\"TRUE_FALSE\",\"source\":\"MANUAL\",\"difficulty\":\"MEDIUM\",\"topicId\":\"$TOPIC\",\"payload\":{\"correctAnswer\":true}}" >/dev/null
QTF=$(jget id)
req POST /questions -H 'Content-Type: application/json' \
  -d "{\"stem\":\"fib q\",\"questionType\":\"FILL_IN_BLANK\",\"source\":\"MANUAL\",\"difficulty\":\"EASY\",\"topicId\":\"$TOPIC\",\"payload\":{\"acceptableAnswers\":[\"Photosynthesis\"]}}" >/dev/null
QFB=$(jget id)
for Q in "$Q1" "$Q2" "$QTF" "$QFB"; do
  req POST "/questions/$Q/approve" >/dev/null
done
echo "Q1=$Q1 Q2=$Q2 QTF=$QTF QFB=$QFB"

echo "== fixtures: assessments (open / draft / scheduled / closed) =="
ST_FUT=$(date -u -d "+2 days" +"%Y-%m-%dT%H:%M:%S.000Z")
EN_FUT=$(date -u -d "+3 days" +"%Y-%m-%dT%H:%M:%S.000Z")
ST_SCHED=$(date -u -d "+1 day +30 minutes" +"%Y-%m-%dT%H:%M:%S.000Z")
EN_SCHED=$(date -u -d "+2 days" +"%Y-%m-%dT%H:%M:%S.000Z")

create_ass() { # create_ass <title> <startsAt> <endsAt> — creates DRAFT with 60min/100 marks
  req POST /assessments -H 'Content-Type: application/json' \
    -d "{\"title\":\"$1\",\"description\":\"d\",\"durationMinutes\":60,\"maxMarks\":100,\"instructions\":{\"text\":\"Read carefully\"},\"startsAt\":\"$2\",\"endsAt\":\"$3\"}" >/dev/null
  jget id
}
link_approve_publish() { # link_approve_publish <assessmentId>
  req POST "/assessments/$1/questions" -H 'Content-Type: application/json' \
    -d "{\"questionIds\":[\"$Q1\",\"$Q2\",\"$QTF\",\"$QFB\"]}" >/dev/null
  req POST "/assessments/$1/publish" >/dev/null
  req POST "/assessments/$1/activate" >/dev/null
}

A_OPEN=$(create_ass "ATT OPEN $RAND" "$ST_FUT" "$EN_FUT")
link_approve_publish "$A_OPEN"
# make it currently-open (creation requires future start; shift via SQL)
sql "UPDATE assessments SET starts_at = now() - interval '1 hour' WHERE id = '$A_OPEN'" >/dev/null

A_DRAFT=$(create_ass "ATT DRAFT $RAND" "$ST_FUT" "$EN_FUT")
req POST "/assessments/$A_DRAFT/questions" -H 'Content-Type: application/json' \
  -d "{\"questionIds\":[\"$Q1\"]}" >/dev/null

A_SCHED=$(create_ass "ATT SCHED $RAND" "$ST_SCHED" "$EN_SCHED")
link_approve_publish "$A_SCHED"

A_CLOSED=$(create_ass "ATT CLOSED $RAND" "$ST_FUT" "$EN_FUT")
link_approve_publish "$A_CLOSED"
sql "UPDATE assessments SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' WHERE id = '$A_CLOSED'" >/dev/null

echo "== AT-01 available assessment scoping (student) =="
JAR="$CJS"; INST="$DI"
AV=$(req GET /attempts/available)
ok "$AV" 200 "AT-01a available 200"
body_has "ATT OPEN $RAND" "AT-01b available lists open assessment"
body_not_has "\"ATT DRAFT $RAND\"" "AT-01c DRAFT excluded from available"
body_not_has "\"ATT SCHED $RAND\"" "AT-01d scheduled-not-started excluded"
body_not_has "\"ATT CLOSED $RAND\"" "AT-01e closed assessment excluded"
body_has '"questionCount":4' "AT-01f open assessment questionCount 4"

echo "== AT-02 start guards =="
ST_DRAFT=$(req POST /attempts -H 'Content-Type: application/json' -d "{\"assessmentId\":\"$A_DRAFT\"}")
ok "$ST_DRAFT" 400 "AT-02a start DRAFT -> 400"
ST_SCHED=$(req POST /attempts -H 'Content-Type: application/json' -d "{\"assessmentId\":\"$A_SCHED\"}")
ok "$ST_SCHED" 400 "AT-02b start scheduled-not-started -> 400"
ST_CLOSED=$(req POST /attempts -H 'Content-Type: application/json' -d "{\"assessmentId\":\"$A_CLOSED\"}")
ok "$ST_CLOSED" 400 "AT-02c start closed -> 400"

echo "== AT-03 start + snapshot sanitization =="
ST=$(req POST /attempts -H 'Content-Type: application/json' -d "{\"assessmentId\":\"$A_OPEN\"}")
ok "$ST" 201 "AT-03a start 201"
body_has '"status":"IN_PROGRESS"' "AT-03b IN_PROGRESS"
body_has '"totalMarks":4' "AT-03c totalMarks snapshot 4"
body_has '"deadline"' "AT-03d deadline present"
body_has '"questions"' "AT-03e questions array present"
ATTID=$(jget id)
body_not_has "correctChoiceId|correctAnswer|acceptableAnswers|explanation" "AT-03f NO answer-key leakage on start"
echo "attempt=$ATTID"

echo "== AT-04 snapshot immutability (archive source question, attempt unchanged) =="
JAR="$CJ"
req POST "/questions/$Q1/archive" >/dev/null
JAR="$CJS"
GETI=$(req GET "/attempts/$ATTID")
ok "$GETI" 200 "AT-04a detail 200 after source archive"
body_has "$RAND immut stem q1" "AT-04b snapshotted stem preserved"
body_has '"id":"'"$MC1A"'"' "AT-04c snapshotted choices preserved"

echo "== AT-05 detail structure =="
body_has '"attemptQuestionId"' "AT-05a attemptQuestionId present"
body_has '"questionType":"MCQ"' "AT-05b MCQ snapshot"
body_has '"questionType":"TRUE_FALSE"' "AT-05c TF snapshot"
body_has '"questionType":"FILL_IN_BLANK"' "AT-05d FIB snapshot"
AQIDS=$(grep -oP '"attemptQuestionId":"[0-9a-f-]+"' "$BODY_FILE" | sed -E 's/.*:"([0-9a-f-]+)"/\1/')
readarray -t AQ <<< "$AQIDS"
if [ "${#AQ[@]}" -ge 4 ]; then PASS=$((PASS+1)); echo "  ok AT-05e got 4+ attemptQuestionIds";
else FAIL=$((FAIL+1)); FAILURES+=("AT-05e: expected >=4 attempt questions, got ${#AQ[@]}"); echo "  FAIL AT-05e (got ${#AQ[@]})"; fi
AQ1="${AQ[0]}"; AQ2="${AQ[1]}"; AQ3="${AQ[2]}"; AQ4="${AQ[3]}"

echo "== AT-06 save responses (per type, idempotent overwrite) =="
S1=$(req PUT "/attempts/$ATTID/questions/$AQ1" -H 'Content-Type: application/json' -d "{\"answer\":{\"choiceId\":\"$MC1A\"}}")
ok "$S1" 200 "AT-06a save MCQ 200"
body_has '"saved":true' "AT-06b saved flag"
S2=$(req PUT "/attempts/$ATTID/questions/$AQ3" -H 'Content-Type: application/json' -d '{"answer":{"value":true}}')
ok "$S2" 200 "AT-06c save TRUE_FALSE 200"
S3=$(req PUT "/attempts/$ATTID/questions/$AQ4" -H 'Content-Type: application/json' -d '{"answer":{"value":"Photosynthesis"}}')
ok "$S3" 200 "AT-06d save FILL_IN_BLANK 200"
S4=$(req PUT "/attempts/$ATTID/questions/$AQ1" -H 'Content-Type: application/json' -d "{\"answer\":{\"choiceId\":\"$MC1B\"}}")
ok "$S4" 200 "AT-06e re-save MCQ (overwrite) 200"
GETA=$(req GET "/attempts/$ATTID")
body_has "\"answer\":{\"choiceId\":\"$MC1B\"}" "AT-06f overwritten answer persisted"

echo "== AT-07 answer validation =="
BAD1=$(req PUT "/attempts/$ATTID/questions/$AQ1" -H 'Content-Type: application/json' -d '{"answer":{"choiceId":"00000000-0000-4000-8000-000000000000"}}')
ok "$BAD1" 400 "AT-07a unknown MCQ choiceId -> 400"
BAD2=$(req PUT "/attempts/$ATTID/questions/$AQ3" -H 'Content-Type: application/json' -d '{"answer":{"value":"nope"}}')
ok "$BAD2" 400 "AT-07b TF non-boolean -> 400"
BAD3=$(req PUT "/attempts/$ATTID/questions/$AQ4" -H 'Content-Type: application/json' -d '{"answer":{"value":""}}')
ok "$BAD3" 400 "AT-07c FIB empty -> 400"
BAD4=$(req PUT "/attempts/$ATTID/questions/$AQ2" -H 'Content-Type: application/json' -d '{"answer":{"choiceId":"'$MC1A'"}}')
ok "$BAD4" 400 "AT-07d choiceId from another question -> 400"

echo "== AT-08 submit (idempotent) + lock =="
SU=$(req POST "/attempts/$ATTID/submit")
ok "$SU" 200 "AT-08a submit 200"
body_has '"status":"SUBMITTED"' "AT-08b SUBMITTED"
body_has '"submittedAt"' "AT-08c submittedAt set"
body_has '"score":3' "AT-08h graded score populated after submit"
SU2=$(req POST "/attempts/$ATTID/submit")
ok "$SU2" 200 "AT-08d re-submit idempotent 200"
body_has '"status":"SUBMITTED"' "AT-08e still SUBMITTED"
LOCK=$(req PUT "/attempts/$ATTID/questions/$AQ2" -H 'Content-Type: application/json' -d '{"answer":{"choiceId":"'$MC2A'"}}')
ok "$LOCK" 400 "AT-08f answer after submit -> 400"
FIN=$(req GET "/attempts/$ATTID")
ok "$FIN" 200 "AT-08g final detail 200"
body_has "\"answer\":{\"choiceId\":\"$MC1B\"}" "AT-08i student sees own saved answer after submit"
body_not_has "correctChoiceId|correctAnswer|acceptableAnswers|explanation" "AT-08j NO answer-key leakage in detail after submit"

echo "== AT-09 cross-student isolation =="
S2_EMAIL="att.s2.$RAND@test.com"
HEX12=$(printf '%012x' $((RAND % 0xFFFFFFFFFFFF)))
MEM2="88888888-8888-4888-8888-$HEX12"
curl -s -c "$CJS2" -X POST "$BASE/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$S2_EMAIL\",\"password\":\"Password123!\",\"name\":\"Att S2\"}" -o "$BODY_FILE"
S2ID=$(jget id)
sql "INSERT INTO memberships (id, user_id, institute_id, status) VALUES ('$MEM2','$S2ID','$DI','active') ON CONFLICT DO NOTHING" >/dev/null
sql "INSERT INTO membership_roles (membership_id, role) VALUES ('$MEM2','STUDENT') ON CONFLICT DO NOTHING" >/dev/null
login_user "$S2_EMAIL" "$CJS2"
JAR="$CJS2"
XG=$(req GET "/attempts/$ATTID")
ok "$XG" 404 "AT-09a student cannot read other student's attempt -> 404"
XS=$(req PUT "/attempts/$ATTID/questions/$AQ2" -H 'Content-Type: application/json' -d '{"answer":{"choiceId":"'$MC2A'"}}')
ok "$XS" 404 "AT-09b student cannot answer other student's attempt -> 404"
XSU=$(req POST "/attempts/$ATTID/submit")
ok "$XSU" 404 "AT-09c student cannot submit other student's attempt -> 404"

echo "== AT-10 teacher ledger + role gate =="
JAR="$CJ"
TL=$(req GET "/assessments/$A_OPEN/attempts")
ok "$TL" 200 "AT-10a teacher ledger 200"
body_has "student@catlium.dev" "AT-10b ledger shows student email"
body_has '"status":"SUBMITTED"' "AT-10c ledger shows SUBMITTED"
body_not_has '"score":null' "AT-10d ledger score populated after evaluation"
body_has '"score":3' "AT-10e ledger shows graded score 3"
JAR="$CJS"
TFB=$(req GET "/assessments/$A_OPEN/attempts")
ok "$TFB" 403 "AT-10f student forbidden from teacher ledger -> 403"

echo "== AT-11 tenant isolation =="
JAR="$CJS2"
INST="$IA"
TI=$(req GET /attempts/available)
ok "$TI" 403 "AT-11a non-member institute -> 403"
INST="$DI"

echo "== AT-12 server-side deadline enforcement =="
JAR="$CJS"
ST2=$(req POST /attempts -H 'Content-Type: application/json' -d "{\"assessmentId\":\"$A_OPEN\"}")
ok "$ST2" 201 "AT-12a second attempt 201"
ATT2=$(jget id)
sql "UPDATE attempts SET deadline = now() - interval '1 minute' WHERE id = '$ATT2'" >/dev/null
EX=$(req PUT "/attempts/$ATT2/questions/$AQ2" -H 'Content-Type: application/json' -d '{"answer":{"choiceId":"'$MC2A'"}}')
ok "$EX" 400 "AT-12b answer after deadline -> 400"
EXD=$(req GET "/attempts/$ATT2")
ok "$EXD" 200 "AT-12c detail 200"
body_has '"status":"EXPIRED"' "AT-12d attempt transitioned to EXPIRED"
body_has '"submittedAt"' "AT-12e submittedAt set (= deadline)"
EXS=$(req POST "/attempts/$ATT2/submit")
ok "$EXS" 200 "AT-12f submit on expired is idempotent 200"
body_has '"status":"EXPIRED"' "AT-12g stays EXPIRED"
RES2=$(req GET "/attempts/$ATT2/result")
ok "$RES2" 200 "AT-12h expired result 200"
body_has '"score":0' "AT-12i expired attempt graded 0 (no saved answers)"
body_has '"status":"EXPIRED"' "AT-12j result shows EXPIRED"

echo "== AT-13 no-duplicate-concurrent-start =="
JAR="$CJS"
START13=$(req POST /attempts -H 'Content-Type: application/json' -d "{\"assessmentId\":\"$A_OPEN\"}")
ok "$START13" 201 "AT-13a fresh start 201"
AT13=$(jget id)
DUP=$(req POST /attempts -H 'Content-Type: application/json' -d "{\"assessmentId\":\"$A_OPEN\"}")
ok "$DUP" 409 "AT-13b duplicate IN_PROGRESS start -> 409"

echo "== AT-14 result review (Phase 10) =="
JAR="$CJS"
RES=$(req GET "/attempts/$ATTID/result")
ok "$RES" 200 "AT-14a student result 200"
body_has '"score":3' "AT-14b graded score 3"
body_has '"totalMarks":4' "AT-14c totalMarks 4"
CORRC=$(jq '[.result.questions[].isCorrect] | map(select(. == true)) | length' "$BODY_FILE")
[ "$CORRC" = "3" ] && PASS=$((PASS+1)) && echo "  ok AT-14d 3 correct questions" \
  || { FAIL=$((FAIL+1)); FAILURES+=("AT-14d: expected 3 correct, got $CORRC"); echo "  FAIL AT-14d (correct=$CORRC)"; }
SUMM=$(jq '[.result.questions[].marksAwarded] | add' "$BODY_FILE")
[ "$SUMM" = "3" ] && PASS=$((PASS+1)) && echo "  ok AT-14e marksAwarded sums to 3" \
  || { FAIL=$((FAIL+1)); FAILURES+=("AT-14e: expected sum 3, got $SUMM"); echo "  FAIL AT-14e (sum=$SUMM)"; }
UNANS=$(jq '[.result.questions[].marksAwarded] | map(select(. == 0)) | length' "$BODY_FILE")
[ "$UNANS" = "1" ] && PASS=$((PASS+1)) && echo "  ok AT-14f unanswered question scored 0" \
  || { FAIL=$((FAIL+1)); FAILURES+=("AT-14f: expected 1 zero-mark question, got $UNANS"); echo "  FAIL AT-14f (zero=$UNANS)"; }
body_has '"correctAnswer"' "AT-14g correct answer revealed for review"
body_has "\"answer\":{\"choiceId\":\"$MC1B\"}" "AT-14h student saved answer shown"
body_has "\"correctAnswer\":{\"choiceId\":\"$MC1B\"}" "AT-14i MCQ correct answer revealed"
INP=$(req GET "/attempts/$AT13/result")
ok "$INP" 400 "AT-14j IN_PROGRESS result -> 400"
JAR="$CJS2"
XR=$(req GET "/attempts/$ATTID/result")
ok "$XR" 404 "AT-14k cross-student result -> 404"

echo
echo "==========================================="
echo "ATTEMPTS E2E: PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
echo "ALL PASS"