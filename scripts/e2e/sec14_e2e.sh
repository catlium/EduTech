#!/usr/bin/env bash
# sec14_e2e.sh — Phase 14 Security Hardening end-to-end harness.
# Covers the cross-module validation + security findings:
#   SC-01 question-bank reads closed to students (403)
#   SC-02 assessment metadata/questions reads closed to students (403)
#   SC-03 attempt start concurrency (single winner + unique IN_PROGRESS)
#   SC-04 attempt submit concurrency (atomic evaluate: SUBMITTED + score set)
#   SC-05 answer after submit rejected
#   SC-06 practice start concurrency (single winner + unique IN_PROGRESS)
#   SC-07 practice answer after complete rejected
# Cross-tenant and answer-key sanitization are covered by attempts_e2e (AT-11)
# and p8_e2e (SE block); not duplicated here.
# Exits non-zero on any FAIL. Requires live dockerized stack (api + postgres)
# with the idempotent demo seed applied (pnpm db:seed).

set -u
BASE="http://localhost:3000/api/v1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_URL="postgresql://catlium:catlium_dev_secret@localhost:5432/catlium_dev"
CJ="/tmp/opencode/s14_teacher.txt"
CJS="/tmp/opencode/s14_student.txt"
BODY_FILE="/tmp/opencode/s14_body.tmp"
PASS=0
FAIL=0
FAILURES=()

DI="99999999-9999-9999-9999-999999999999"
RAND="$(date +%s)"
JAR="$CJ"
INST="$DI"
TMP="/tmp/opencode"
MC_A="ba000000-0000-4000-8000-0000000000a1"
MC_B="ba000000-0000-4000-8000-0000000000b2"

# ── helpers (same contract as attempts_e2e) ────────────────────────────────
ok() { local code="$1" exp="$2" label="$3"
  if [ "$code" = "$exp" ]; then PASS=$((PASS+1)); echo "  ok $label";
  else FAIL=$((FAIL+1)); FAILURES+=("$label: expected $exp got $code"); echo "  FAIL $label (got $code, want $exp)"; fi
}
count_eq() { local n="$1" exp="$2" label="$3"
  if [ "$n" = "$exp" ]; then PASS=$((PASS+1)); echo "  ok $label";
  else FAIL=$((FAIL+1)); FAILURES+=("$label: expected $exp got $n"); echo "  FAIL $label (got $n, want $exp)"; fi
}
body_has() { local sub="$1" label="$2"
  if grep -qF "$sub" "$BODY_FILE"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$label: missing '$sub' in body"); echo "  FAIL $label (missing '$sub')"; fi
}
req() { local method="$1" path="$2"; shift 2
  curl -s -b "$JAR" -X "$method" "$BASE$path" -H "x-institute-id: $INST" "$@" -o "$BODY_FILE" -w '%{http_code}'
}
jget() { grep -oP "\"$1\"\s*:\s*\"?[^\",}]*" "$BODY_FILE" | head -1 | sed -E "s/\"$1\"\s*:\s*\"?//"; }
login_user() { local email="$1" jar="$2"
  if [ -f "$jar" ] && grep -q "access_token" "$jar"; then
    if curl -s -b "$jar" "$BASE/auth/me" -o /dev/null -w '%{http_code}' | grep -q 200; then return 0; fi
    echo "  stale jar for $email, re-logging in"; rm -f "$jar"
  fi
  local code
  code=$(curl -s -c "$jar" -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"Password123!\"}" -o /dev/null -w '%{http_code}')
  if [ "$code" != "200" ]; then echo "  FATAL: login $email rc=$code"; exit 1; fi
}
sql() { (cd "$ROOT/packages/database" && DATABASE_URL="$DB_URL" \
    node --input-type=module -e '
      import pg from "pg";
      const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await c.connect();
      const r = await c.query(process.argv[1]);
      if (r.rows.length > 0) console.log(Object.values(r.rows[0])[0] ?? "");
      await c.end();
    ' "$1") }
pick_id() { python3 - "$1" <<'PYEOF' | head -1
import json, sys
d = json.load(open('/tmp/opencode/s14_body.tmp'))
arr = None
for k in ('subjects', 'assessments'):
    if isinstance(d, dict) and d.get(k) is not None:
        arr = d[k]; break
if arr is None and isinstance(d, dict):
    for k in ('subject', 'assessment', 'chapter', 'topic'):
        if isinstance(d.get(k), dict):
            arr = [d[k]]; break
for x in arr or []:
    if x.get('name') == sys.argv[1] or x.get('title') == sys.argv[1]:
        print(x['id']); break
PYEOF
}

echo "== fixtures: login =="
login_user "teacher@catlium.dev" "$CJ"
login_user "student@catlium.dev" "$CJS"

echo "== fixtures: academic scope + one MCQ =="
req POST /academic/subjects -H 'Content-Type: application/json' -d "{\"name\":\"Sec14 $RAND\",\"slug\":\"sec14-$RAND\"}" >/dev/null
SUBJ=$(pick_id "Sec14 $RAND")
req POST "/academic/subjects/$SUBJ/chapters" -H 'Content-Type: application/json' -d '{"name":"C14","slug":"c14"}' >/dev/null
CHID=$(pick_id C14)
req POST "/academic/chapters/$CHID/topics" -H 'Content-Type: application/json' -d '{"name":"T14","slug":"t14"}' >/dev/null
TOPIC=$(pick_id T14)

echo "== fixtures: assessment (published + active, window backdated) =="
req POST /questions -H 'Content-Type: application/json' \
  -d "{\"stem\":\"sec14 mcq $RAND\",\"questionType\":\"MCQ\",\"source\":\"MANUAL\",\"difficulty\":\"EASY\",\"topicId\":\"$TOPIC\",\"payload\":{\"choices\":[{\"id\":\"$MC_A\",\"text\":\"A\"},{\"id\":\"$MC_B\",\"text\":\"B\"}],\"correctChoiceId\":\"$MC_B\"}}" >/dev/null
Q1=$(jget id)
req POST "/questions/$Q1/approve" >/dev/null
ST=$(date -u -d '+2 days' +"%Y-%m-%dT%H:%M:%S.000Z")
EN=$(date -u -d '+3 days' +"%Y-%m-%dT%H:%M:%S.000Z")
req POST /assessments -H 'Content-Type: application/json' \
  -d "{\"title\":\"Sec14 Quiz $RAND\",\"description\":\"d\",\"durationMinutes\":60,\"maxMarks\":100,\"instructions\":{\"text\":\"x\"},\"startsAt\":\"$ST\",\"endsAt\":\"$EN\"}" >/dev/null
AID=$(jget id)
req POST "/assessments/$AID/questions" -H 'Content-Type: application/json' -d "{\"questionIds\":[\"$Q1\"]}" >/dev/null
req POST "/assessments/$AID/publish" >/dev/null
req POST "/assessments/$AID/activate" >/dev/null
sql "UPDATE assessments SET starts_at = now() - interval '1 minute', ends_at = now() + interval '1 day' WHERE id = '$AID'" >/dev/null
echo "assessment=$AID question=$Q1"

echo "== SC-01 question-bank reads closed to students =="
JAR="$CJS"
QLL=$(req GET /questions)
ok "$QLL" 403 "SC-01a student list questions -> 403"
QLG=$(req GET "/questions/$Q1")
ok "$QLG" 403 "SC-01b student get question -> 403"
JAR="$CJ"
ok "$(req GET "/questions/$Q1")" 200 "SC-01c teacher get question -> 200"
body_has "$Q1" "SC-01c teacher sees its own question"

echo "== SC-02 assessment reads closed to students =="
JAR="$CJS"
ok "$(req GET /assessments)" 403 "SC-02a student list assessments -> 403"
ok "$(req GET "/assessments/$AID")" 403 "SC-02b student get assessment -> 403"
ok "$(req GET "/assessments/$AID/questions")" 403 "SC-02c student get assessment questions -> 403"
JAR="$CJ"
ok "$(req GET "/assessments/$AID")" 200 "SC-02d teacher get assessment -> 200"

echo "== SC-03 attempt start concurrency (single winner) =="
for i in 1 2 3 4 5 6; do
  ( curl -s -b "$CJS" -X POST "$BASE/attempts" -H 'Content-Type: application/json' \
      -H "x-institute-id: $DI" -d "{\"assessmentId\":\"$AID\"}" \
      -o "$TMP/s14_st_$i.txt" -w "%{http_code}\n" > "$TMP/s14_cc_$i.txt" ) &
done
wait
CODES=$(cat "$TMP"/s14_cc_*.txt | tr '\n' ' ')
count_eq "$(echo "$CODES" | tr ' ' '\n' | grep -c '^201$')" 1 "SC-03a exactly one start 201"
count_eq "$(echo "$CODES" | tr ' ' '\n' | grep -c '^409$')" 5 "SC-03b five starts 409"
ATTID=$(sql "select id from attempts where assessment_id = '$AID' and status = 'IN_PROGRESS' limit 1")
count_eq "$(sql "select count(*) from attempts where assessment_id = '$AID' and status = 'IN_PROGRESS'")" 1 "SC-03c one IN_PROGRESS attempt in DB"
echo "attempt=$ATTID"

echo "== SC-04 attempt submit concurrency (atomic evaluation) =="
for i in 1 2 3 4; do
  ( curl -s -b "$CJS" -X POST "$BASE/attempts/$ATTID/submit" -H "x-institute-id: $DI" \
      -o "$TMP/s14_sb_$i.txt" -w "%{http_code}\n" > "$TMP/s14_sc_$i.txt" ) &
done
wait
CODES=$(cat "$TMP"/s14_sc_*.txt | tr '\n' ' ')
count_eq "$(echo "$CODES" | tr ' ' '\n' | grep -c '^200$')" 4 "SC-04a all parallel submits 200"
ok "$(sql "select status from attempts where id = '$ATTID'")" "SUBMITTED" "SC-04b attempt SUBMITTED"
ok "$(sql "select score from attempts where id = '$ATTID'")" "0" "SC-04c score evaluated (not null)"
ok "$(sql "select submitted_at is not null from attempts where id = '$ATTID'")" "true" "SC-04d submitted_at set"

echo "== SC-05 answer after submit rejected =="
AQID=$(sql "select id from attempt_questions where attempt_id = '$ATTID' limit 1")
ok "$(curl -s -b "$CJS" -X PUT "$BASE/attempts/$ATTID/questions/$AQID" -H 'Content-Type: application/json' \
  -H "x-institute-id: $DI" -d '{"answer":{"choiceId":"'$MC_A'"}}' -o "$TMP/s14_ans.txt" -w '%{http_code}')" 400 "SC-05 answer after submit -> 400"

echo "== SC-06 practice start concurrency (single winner) =="
for i in 1 2 3 4; do
  ( curl -s -b "$CJS" -X POST "$BASE/practice/sessions" -H 'Content-Type: application/json' \
      -H "x-institute-id: $DI" -d "{\"mode\":\"QUESTION\",\"topicId\":\"$TOPIC\"}" \
      -o "$TMP/s14_pc_$i.txt" -w "%{http_code}\n" > "$TMP/s14_pd_$i.txt" ) &
done
wait
CODES=$(cat "$TMP"/s14_pd_*.txt | tr '\n' ' ')
count_eq "$(echo "$CODES" | tr ' ' '\n' | grep -c '^201$')" 1 "SC-06a exactly one session 201"
count_eq "$(echo "$CODES" | tr ' ' '\n' | grep -c '^409$')" 3 "SC-06b three starts 409"
SID=$(sql "select id from practice_sessions where mode = 'QUESTION' and topic_id = '$TOPIC' and status = 'IN_PROGRESS' limit 1")
count_eq "$(sql "select count(*) from practice_sessions where topic_id = '$TOPIC' and status = 'IN_PROGRESS'")" 1 "SC-06c one IN_PROGRESS session for topic in DB"
count_eq "$(sql "select count(*) from practice_session_items where session_id = '$SID'")" 1 "SC-06d session has one item"

echo "== SC-07 practice answer after complete rejected =="
ITEM=$(sql "select id from practice_session_items where session_id = '$SID' limit 1")
ok "$(curl -s -b "$CJS" -X POST "$BASE/practice/sessions/$SID/complete" -H "x-institute-id: $DI" \
  -o "$TMP/s14_comp.txt" -w '%{http_code}')" 200 "SC-07a complete session -> 200"
ok "$(curl -s -b "$CJS" -X PUT "$BASE/practice/sessions/$SID/items/$ITEM" -H 'Content-Type: application/json' \
  -H "x-institute-id: $DI" -d '{"answer":{"choiceId":"'$MC_B'"}}' -o "$TMP/s14_pans.txt" -w '%{http_code}')" 409 "SC-07b answer after complete -> 409"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "SEC14 E2E: PASS=$PASS FAIL=0"
  echo "ALL PASS"
  exit 0
else
  echo "SEC14 E2E: PASS=$PASS FAIL=$FAIL"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi