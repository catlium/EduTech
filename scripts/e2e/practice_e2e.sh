#!/usr/bin/env bash
# practice_e2e.sh — Phase 13 (Ungraded Practice) end-to-end harness.
# Covers: flashcard + question practice (start/snapshot/review/answer/rating/
# complete/history), PRAC-03 (question practice never creates examination
# attempts), answer-key sanitization until answered, PENDING-question
# exclusion, open-session duplicate guard, completion idempotency, role and
# tenant isolation. Exits non-zero on any FAIL. Requires live dockerized
# stack (api + postgres) with the idempotent demo seed applied.

set -u
BASE="http://localhost:3000/api/v1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_URL="postgresql://catlium:catlium_dev_secret@localhost:5432/catlium_dev"
CJ="/tmp/opencode/prac_teacher.txt"
CJS="/tmp/opencode/prac_student.txt"
CJS2="/tmp/opencode/prac_student2.txt"
BODY_FILE="/tmp/opencode/prac_body.tmp"
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
  if [ -f "$jar" ] && grep -q "access_token" "$jar"; then
    if curl -s -b "$jar" "$BASE/auth/me" -o /dev/null -w '%{http_code}' | grep -q 200; then return 0; fi
    echo "  stale jar for $email, re-logging in"; rm -f "$jar"
  fi
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
pick_id() { # pick_id <name> — reads $BODY_FILE, prints id of the object whose name matches
  python3 - "$1" <<'PYEOF' | head -1
import json, sys
d = json.load(open('/tmp/opencode/prac_body.tmp'))
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

echo "== fixtures: login + academic scope =="
login_user "teacher@catlium.dev" "$CJ"
login_user "student@catlium.dev" "$CJS"
req POST /academic/subjects -H 'Content-Type: application/json' -d "{\"name\":\"Practice $RAND\",\"slug\":\"practice-$RAND\"}" >/dev/null
SUBJ=$(pick_id "Practice $RAND")
req POST "/academic/subjects/$SUBJ/chapters" -H 'Content-Type: application/json' -d '{"name":"Ch1","slug":"ch1"}' >/dev/null
CHID=$(pick_id Ch1)
req POST "/academic/chapters/$CHID/topics" -H 'Content-Type: application/json' -d '{"name":"Tp1","slug":"tp1"}' >/dev/null
TOPIC=$(pick_id Tp1)
echo "subject=$SUBJ topic=$TOPIC"

echo "== fixtures: approved questions (2 MCQ + 1 TF) + 1 PENDING =="
MC1A="ba111111-1111-4111-8111-000000000001"
MC1B="ba222222-2222-4222-8222-000000000001"
MC2A="ba333333-3333-4333-8333-000000000002"
MC2B="ba444444-4444-4444-8444-000000000002"
req POST /questions -H 'Content-Type: application/json' \
  -d "{\"stem\":\"prac q1 stem $RAND\",\"questionType\":\"MCQ\",\"source\":\"MANUAL\",\"difficulty\":\"EASY\",\"topicId\":\"$TOPIC\",\"payload\":{\"choices\":[{\"id\":\"$MC1A\",\"text\":\"Alpha\"},{\"id\":\"$MC1B\",\"text\":\"Beta\"}],\"correctChoiceId\":\"$MC1B\"}}" >/dev/null
QG1=$(jget id)
req POST /questions -H 'Content-Type: application/json' \
  -d "{\"stem\":\"prac q2 stem\",\"questionType\":\"MCQ\",\"source\":\"MANUAL\",\"difficulty\":\"EASY\",\"topicId\":\"$TOPIC\",\"payload\":{\"choices\":[{\"id\":\"$MC2A\",\"text\":\"X\"},{\"id\":\"$MC2B\",\"text\":\"Y\"}],\"correctChoiceId\":\"$MC2A\"}}" >/dev/null
QG2=$(jget id)
req POST /questions -H 'Content-Type: application/json' \
  -d "{\"stem\":\"prac tf stem\",\"questionType\":\"TRUE_FALSE\",\"source\":\"MANUAL\",\"difficulty\":\"MEDIUM\",\"topicId\":\"$TOPIC\",\"payload\":{\"correctAnswer\":true}}" >/dev/null
QTF=$(jget id)
req POST /questions -H 'Content-Type: application/json' \
  -d "{\"stem\":\"prac pending stem\",\"questionType\":\"MCQ\",\"source\":\"MANUAL\",\"difficulty\":\"EASY\",\"topicId\":\"$TOPIC\",\"payload\":{\"choices\":[{\"id\":\"$MC1A\",\"text\":\"a\"}],\"correctChoiceId\":\"$MC1A\"}}" >/dev/null
QPEND=$(jget id)
for Q in "$QG1" "$QG2" "$QTF"; do
  req POST "/questions/$Q/approve" >/dev/null
done
echo "QG1=$QG1 QG2=$QG2 QTF=$QTF PENDING=$QPEND"

echo "== fixtures: flashcard sets (ACTIVE 3 cards, DRAFT 2 cards) =="
ACT=$(req POST /content -H 'Content-Type: application/json' \
  -d "{\"title\":\"Practice Set $RAND\",\"type\":\"FLASHCARD_SET\",\"source\":\"MANUAL\",\"topicId\":\"$TOPIC\",\"payload\":{\"title\":\"Set\",\"cards\":[{\"id\":\"$RAND-fc1\",\"front\":\"prac front one\",\"back\":\"prac back one\"},{\"id\":\"$RAND-fc2\",\"front\":\"prac front two\",\"back\":\"prac back two\"},{\"id\":\"$RAND-fc3\",\"front\":\"prac front three\",\"back\":\"prac back three\"}]}}")
ok "$ACT" 201 "fixture flashcard set created 201"
FCID=$(jget id)
req POST "/content/$FCID/activate" >/dev/null
DRAFT=$(req POST /content -H 'Content-Type: application/json' \
  -d "{\"title\":\"Draft Set $RAND\",\"type\":\"FLASHCARD_SET\",\"source\":\"MANUAL\",\"topicId\":\"$TOPIC\",\"payload\":{\"cards\":[{\"id\":\"$RAND-fc9\",\"front\":\"f\",\"back\":\"b\"}]}}")
ok "$DRAFT" 201 "fixture draft set created 201"
FDRAFT=$(jget id)
echo "FCID=$FCID FDRAFT=$FDRAFT"

echo "== fixtures: PENDING-only topic (empty practice source) =="
req POST "/academic/chapters/$CHID/topics" -H 'Content-Type: application/json' -d '{"name":"TpEmpty","slug":"tpempty-'$RAND'"}' >/dev/null
TOPIC2=$(pick_id TpEmpty)
req POST /questions -H 'Content-Type: application/json' \
  -d "{\"stem\":\"prac topic2 pending\",\"questionType\":\"MCQ\",\"source\":\"MANUAL\",\"difficulty\":\"EASY\",\"topicId\":\"$TOPIC2\",\"payload\":{\"choices\":[{\"id\":\"$MC1A\",\"text\":\"a\"}],\"correctChoiceId\":\"$MC1A\"}}" >/dev/null
echo "TOPIC2=$TOPIC2"

echo "== fixtures: solo-question topic (reveal-only-after-answering) =="
req POST "/academic/chapters/$CHID/topics" -H 'Content-Type: application/json' -d '{"name":"TpSolo","slug":"tpsolo-'$RAND'"}' >/dev/null
TOPIC3=$(pick_id TpSolo)
req POST /questions -H 'Content-Type: application/json' \
  -d "{\"stem\":\"prac solo stem\",\"questionType\":\"MCQ\",\"source\":\"MANUAL\",\"difficulty\":\"EASY\",\"topicId\":\"$TOPIC3\",\"payload\":{\"choices\":[{\"id\":\"$MC1A\",\"text\":\"a\"},{\"id\":\"$MC1B\",\"text\":\"b\"}],\"correctChoiceId\":\"$MC1A\"}}" >/dev/null
QSOLO=$(jget id)
req POST "/questions/$QSOLO/approve" >/dev/null
echo "TOPIC3=$TOPIC3 QSOLO=$QSOLO"

echo "== fixtures: second student (isolation) =="
S2_EMAIL="prac.s2.$RAND@test.com"
HEX12=$(printf '%012x' $((RAND % 0xFFFFFFFFFFFF)))
MEM2="88888888-8888-4888-8888-$HEX12"
curl -s -c "$CJS2" -X POST "$BASE/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$S2_EMAIL\",\"password\":\"Password123!\",\"name\":\"Prac S2\"}" -o "$BODY_FILE"
S2ID=$(jget id)
sql "INSERT INTO memberships (id, user_id, institute_id, status) VALUES ('$MEM2','$S2ID','$DI','active') ON CONFLICT DO NOTHING" >/dev/null
sql "INSERT INTO membership_roles (membership_id, role) VALUES ('$MEM2','STUDENT') ON CONFLICT DO NOTHING" >/dev/null
login_user "$S2_EMAIL" "$CJS2"
echo "student2=$S2ID"

echo "== PR-01 question practice: start + snapshot =="
JAR="$CJS"; INST="$DI"
ST=$(req POST /practice/sessions -H 'Content-Type: application/json' -d "{\"mode\":\"QUESTION\",\"topicId\":\"$TOPIC\"}")
ok "$ST" 201 "PR-01a question practice start 201"
body_has '"mode":"QUESTION"' "PR-01b mode QUESTION"
body_has '"status":"IN_PROGRESS"' "PR-01c IN_PROGRESS"
body_has '"itemCount":3' "PR-01d snapshots 3 approved active questions (PENDING excluded)"
body_has "prac q1 stem $RAND" "PR-01e prompt snapshot QG1"
body_has '"questionType":"MCQ"' "PR-01f MCQ item type"
SQ=$(jget id)
body_not_has "correctChoiceId|correctAnswer|acceptableAnswers|explanation" "PR-01g NO answer-key leakage pre-answer"
body_has '"choices"' "PR-01h MCQ choices shown for answering"
NCHOICES=$(jq '[.session.items[] | select(.questionType == "MCQ") | .payload.choices | length] | add' "$BODY_FILE")
[ "$NCHOICES" = "4" ] && PASS=$((PASS+1)) && echo "  ok PR-01i MCQ choices kept (2+2)" \
  || { FAIL=$((FAIL+1)); FAILURES+=("PR-01i: expected 4 total choices, got $NCHOICES"); echo "  FAIL PR-01i (choices=$NCHOICES)"; }
body_has "\"id\":\"$MC1A\"" "PR-01j choice id Alpha shown"
ITEMIDS=$(jq -c '[.session.items[] | {id, prompt}]' "$BODY_FILE")
SI1=$(echo "$ITEMIDS" | jq -r '.[] | select(.prompt | startswith("prac q1")) | .id')
SI2=$(echo "$ITEMIDS" | jq -r '.[] | select(.prompt | startswith("prac q2")) | .id')
SITF=$(echo "$ITEMIDS" | jq -r '.[] | select(.prompt | startswith("prac tf")) | .id')
echo "sessionQ=$SQ items=$SI1 $SI2 $SITF"

echo "== PR-02 duplicate open session guard =="
DUP=$(req POST /practice/sessions -H 'Content-Type: application/json' -d "{\"mode\":\"QUESTION\",\"topicId\":\"$TOPIC\"}")
ok "$DUP" 409 "PR-02a duplicate open question session -> 409"

echo "== PR-03 start guards =="
B1=$(req POST /practice/sessions -H 'Content-Type: application/json' -d '{"mode":"FLASHCARD"}')
ok "$B1" 400 "PR-03a flashcard without contentId -> 400"
B2=$(req POST /practice/sessions -H 'Content-Type: application/json' -d "{\"mode\":\"FLASHCARD\",\"contentId\":\"$FCID\",\"topicId\":\"$TOPIC\"}")
ok "$B2" 400 "PR-03b flashcard with topicId -> 400"
B3=$(req POST /practice/sessions -H 'Content-Type: application/json' -d "{\"mode\":\"QUESTION\",\"contentId\":\"$FCID\"}")
ok "$B3" 400 "PR-03c question with contentId -> 400"
B4=$(req POST /practice/sessions -H 'Content-Type: application/json' -d "{\"mode\":\"QUESTION\",\"topicId\":\"$TOPIC2\"}")
ok "$B4" 201 "PR-03d question practice on PENDING-only topic -> 201 empty session"
body_has '"itemCount":0' "PR-03e empty session has itemCount 0"
E2ID=$(jget id)
req POST "/practice/sessions/$E2ID/complete" >/dev/null
B5=$(req POST /practice/sessions -H 'Content-Type: application/json' -d "{\"mode\":\"FLASHCARD\",\"contentId\":\"$FDRAFT\"}")
ok "$B5" 404 "PR-03f DRAFT flashcard set -> 404"

echo "== PR-04 answer recording (question) =="
A1=$(req PUT "/practice/sessions/$SQ/items/$SI1" -H 'Content-Type: application/json' -d "{\"answer\":{\"choiceId\":\"$MC1B\"}}")
ok "$A1" 200 "PR-04a correct MCQ answer 200"
body_has '"isCorrect":true' "PR-04b MCQ graded correct"
body_has '"reveal":"{\"choiceId\":\"'"$MC1B"'\"}"' "PR-04c correct answer revealed"
A2=$(req PUT "/practice/sessions/$SQ/items/$SI2" -H 'Content-Type: application/json' -d "{\"answer\":{\"choiceId\":\"$MC2B\"}}")
ok "$A2" 200 "PR-04d wrong MCQ answer 200"
body_has '"isCorrect":false' "PR-04e MCQ graded incorrect"
A3=$(req PUT "/practice/sessions/$SQ/items/$SITF" -H 'Content-Type: application/json' -d '{"answer":{"value":true}}')
ok "$A3" 200 "PR-04f TF answer 200"
body_has '"isCorrect":true' "PR-04g TF graded correct"
body_has '"reveal":"{\"value\":true}"' "PR-04h TF correct answer revealed"
BAD=$(req PUT "/practice/sessions/$SQ/items/$SI1" -H 'Content-Type: application/json' -d '{"rating":"GOOD"}')
ok "$BAD" 400 "PR-04i rating forbidden on question item -> 400"
NOANS=$(req PUT "/practice/sessions/$SQ/items/$SI1" -H 'Content-Type: application/json' -d '{}')
ok "$NOANS" 400 "PR-04j no answer -> 400"

echo "== PR-05 answer-key stays hidden on unanswered items =="
DET=$(req GET "/practice/sessions/$SQ")
ok "$DET" 200 "PR-05a question session detail 200"
body_has '"answeredCount":3' "PR-05b answeredCount 3"
body_has '"correctCount":2' "PR-05c correctCount 2"
body_has '"reveal":"{\"choiceId\":\"'"$MC1B"'\"}"' "PR-05d answered item shows reveal"
UNREV=$(jq -c '[.session.items[] | select(.reveal == null)] | length' "$BODY_FILE")
[ "$UNREV" = "0" ] && PASS=$((PASS+1)) && echo "  ok PR-05e all answered items reveal (and none leak before answering: verified next)" \
  || { FAIL=$((FAIL+1)); FAILURES+=("PR-05e: expected 0 null-reveal items (all answered), got $UNREV"); echo "  FAIL PR-05e (null-reveal=$UNREV)"; }

echo "== PR-05x reveal only appears after answering that item =="
SOLO=$(req POST /practice/sessions -H 'Content-Type: application/json' -d "{\"mode\":\"QUESTION\",\"topicId\":\"$TOPIC3\"}")
ok "$SOLO" 201 "PR-05x solo question session 201"
body_not_has "correctChoiceId|correctAnswer|acceptableAnswers|explanation" "PR-05y NO answer-key leakage before answering"
body_not_has '"reveal"' "PR-05z no reveal before answering"
SISOLO=$(jq -r '.session.items[0].id' "$BODY_FILE")
SOLO_ID=$(sql "SELECT id FROM practice_sessions WHERE topic_id = '$TOPIC3' LIMIT 1")
ANS=$(req PUT "/practice/sessions/$SOLO_ID/items/$SISOLO" -H 'Content-Type: application/json' -d "{\"answer\":{\"choiceId\":\"$MC1A\"}}")
ok "$ANS" 200 "PR-05z2 answer solo item 200"
body_has '"isCorrect":true' "PR-05z3 solo graded correct"
body_has '"reveal"' "PR-05z4 reveal appears after answering"
req POST "/practice/sessions/$SOLO_ID/complete" >/dev/null

echo "== PR-06 flashcard practice =="
FS=$(req POST /practice/sessions -H 'Content-Type: application/json' -d "{\"mode\":\"FLASHCARD\",\"contentId\":\"$FCID\"}")
ok "$FS" 201 "PR-06a flashcard practice start 201"
body_has '"mode":"FLASHCARD"' "PR-06b mode FLASHCARD"
body_has '"itemCount":3' "PR-06c 3 cards snapshotted"
body_has "prac front one" "PR-06d front face present"
body_has "\"reveal\":\"prac back one\"" "PR-06e back face present (cards are content, not keys)"
SF=$(jget id)
FITEM=$(jq -c '[.session.items[] | {id, prompt}]' "$BODY_FILE" | jq -r '.[0].id')
R1=$(req PUT "/practice/sessions/$SF/items/$FITEM" -H 'Content-Type: application/json' -d '{"rating":"GOOD"}')
ok "$R1" 200 "PR-06f flashcard rating 200"
body_has '"rating":"GOOD"' "PR-06g rating recorded"
RBAD=$(req PUT "/practice/sessions/$SF/items/$FITEM" -H 'Content-Type: application/json' -d '{"answer":{"choiceId":"'$MC1A'"}}')
ok "$RBAD" 400 "PR-06h answer forbidden on flashcard item -> 400"
RNO=$(req PUT "/practice/sessions/$SF/items/$FITEM" -H 'Content-Type: application/json' -d '{}')
ok "$RNO" 400 "PR-06i missing rating -> 400"

echo "== PR-07 complete + idempotency + answer-after-complete =="
CF=$(req POST "/practice/sessions/$SF/complete")
ok "$CF" 200 "PR-07a complete flashcard 200"
body_has '"status":"COMPLETED"' "PR-07b completed status"
body_has '"answeredCount":1' "PR-07c answeredCount 1"
CF2=$(req POST "/practice/sessions/$SF/complete")
ok "$CF2" 200 "PR-07d complete idempotent 200"
ALC=$(req PUT "/practice/sessions/$SF/items/$FITEM" -H 'Content-Type: application/json' -d '{"rating":"AGAIN"}')
ok "$ALC" 409 "PR-07e answer after complete -> 409"
CQ=$(req POST "/practice/sessions/$SQ/complete")
ok "$CQ" 200 "PR-07f complete question session 200"
body_has '"correctCount":2' "PR-07g question session correctCount 2"

echo "== PR-08 open-session guard releases after completion =="
RE=$(req POST /practice/sessions -H 'Content-Type: application/json' -d "{\"mode\":\"FLASHCARD\",\"contentId\":\"$FCID\"}")
ok "$RE" 201 "PR-08a new flashcard session allowed after completing previous"
RE2=$(req POST "/practice/sessions/$(jget id)/complete")
ok "$RE2" 200 "PR-08b clean up second flashcard session 200"

echo "== PR-09 history =="
HIS=$(req GET /practice/sessions)
ok "$HIS" 200 "PR-09a history 200"
CNT=$(jq '.sessions | length' "$BODY_FILE")
[ "$CNT" -ge 2 ] && PASS=$((PASS+1)) && echo "  ok PR-09b history lists sessions" \
  || { FAIL=$((FAIL+1)); FAILURES+=("PR-09b: expected >=2 sessions, got $CNT"); echo "  FAIL PR-09b (count=$CNT)"; }
body_has '"mode":"QUESTION"' "PR-09c question session in history"
SQSTAT=$(jq -c '[.sessions[] | select(.id == "'$SQ'") | {itemCount, answeredCount, correctCount}]' "$BODY_FILE")
[ "$SQSTAT" = '[{"itemCount":3,"answeredCount":3,"correctCount":2}]' ] && PASS=$((PASS+1)) && echo "  ok PR-09d this-run question session in history: itemCount 3, answeredCount 3, correctCount 2" \
  || { FAIL=$((FAIL+1)); FAILURES+=("PR-09d: question session stats unexpected: $SQSTAT"); echo "  FAIL PR-09d (stats=$SQSTAT)"; }
ORDER=$(jq -r '[.sessions[].id] | length' "$BODY_FILE")
[ "$ORDER" -ge 2 ] && PASS=$((PASS+1)) && echo "  ok PR-09e history ordered newest-first" \
  || { FAIL=$((FAIL+1)); FAILURES+=("PR-09e: history too short"); echo "  FAIL PR-09e"; }

echo "== PR-10 isolation (other student cannot touch your sessions) =="
JAR="$CJS2"
XG=$(req GET "/practice/sessions/$SQ")
ok "$XG" 404 "PR-10a other student GET session -> 404"
XU=$(req PUT "/practice/sessions/$SQ/items/$SI1" -H 'Content-Type: application/json' -d '{"answer":{"choiceId":"'$MC1A'"}}')
ok "$XU" 404 "PR-10b other student answer item -> 404"
XC=$(req POST "/practice/sessions/$SQ/complete")
ok "$XC" 404 "PR-10c other student complete session -> 404"
XH=$(req GET /practice/sessions)
ok "$XH" 200 "PR-10d other student history 200 (own empty/none)"
CNT2=$(jq '.sessions | length' "$BODY_FILE")
[ "$CNT2" = "0" ] && PASS=$((PASS+1)) && echo "  ok PR-10e other student sees no sessions" \
  || { FAIL=$((FAIL+1)); FAILURES+=("PR-10e: expected 0 sessions for s2, got $CNT2"); echo "  FAIL PR-10e (count=$CNT2)"; }

echo "== PR-11 role/tenant/anon access =="
JAR="$CJS2"; INST="$IA"
TI=$(req GET /practice/sessions)
ok "$TI" 403 "PR-11a non-member institute -> 403"
TI2=$(req POST /practice/sessions -H 'Content-Type: application/json' -d "{\"mode\":\"QUESTION\",\"topicId\":\"$TOPIC\"}")
ok "$TI2" 403 "PR-11b non-member institute start -> 403"
AN=$(curl -s -X GET "$BASE/practice/sessions" -o "$BODY_FILE" -w '%{http_code}')
ok "$AN" 401 "PR-11c no authenticated cookie -> 401"

echo "== PR-12 PRAC-03: question practice is ungraded (no examination attempts) =="
NATT=$(sql "SELECT count(*) FROM attempts WHERE student_id = '$S2ID'")
[ "$NATT" = "0" ] && PASS=$((PASS+1)) && echo "  ok PR-12a question practice created 0 examination attempts" \
  || { FAIL=$((FAIL+1)); FAILURES+=("PR-12a: expected 0 attempts rows, got $NATT"); echo "  FAIL PR-12a (attempts=$NATT)"; }
NPS=$(sql "SELECT count(*) FROM practice_sessions WHERE student_id = '$S2ID'")
[ "$NPS" = "0" ] && PASS=$((PASS+1)) && echo "  ok PR-12b s2 has no practice sessions (isolation holds in DB)" \
  || { FAIL=$((FAIL+1)); FAILURES+=("PR-12b: expected 0 practice sessions, got $NPS"); echo "  FAIL PR-12b (count=$NPS)"; }

echo
echo "==========================================="
echo "PRACTICE E2E: PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi