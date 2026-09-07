#!/usr/bin/env bash
# p8_e2e.sh — Phase 8 (Quiz & Examination Management) end-to-end harness.
# Reconstructed 2026-09-07 from docs/user-validation.md Phase 8 block.
# Covers EXAM-01..08 + security/negative block + ARCHIVED gate (WR-03).
# Exits non-zero on any FAIL. Requires live dockerized stack (api + postgres).

set -u
BASE="http://localhost:3000/api/v1"
CJ="/tmp/opencode/p8_ck.txt"
BODY_FILE="/tmp/opencode/p8_body.tmp"
PASS=0
FAIL=0
FAILURES=()

IA="11111111-1111-1111-1111-111111111111"
IB="55555555-5555-5555-5555-555555555555"
TOPIC="10df37f8-acd5-4406-9a36-eb631c4c54f3"
RAND="$(date +%s)"

# --- helpers ---------------------------------------------------------------
ok() { # ok <http_code> <expected> <label>
  local code="$1" exp="$2" label="$3"
  if [ "$code" = "$exp" ]; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$label: expected $exp got $code"); echo "  FAIL $label (got $code, want $exp)"; fi
}
body_has() { # body_has <substring> <label>  (reads $BODY_FILE)
  local sub="$1" label="$2"
  if grep -qF "$sub" "$BODY_FILE"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$label: missing '$sub' in body"); echo "  FAIL $label (missing '$sub')"; fi
}
# req <method> <path> [curl args...] — writes body to $BODY_FILE, echoes http code
req() {
  local method="$1" path="$2"; shift 2
  local code
  code=$(curl -s -b "$CJ" -X "$method" "$BASE$path" "$@" -o "$BODY_FILE" -w '%{http_code}')
  echo "$code"
}
jget() { # jget <key> — reads $BODY_FILE, prints first value for key
  grep -oP "\"$1\"\s*:\s*\"?[^\",}]*" "$BODY_FILE" | head -1 | sed -E "s/\"$1\"\s*:\s*\"?//"
}

login_user() { # login_user <email> <jar> — reuse valid cookies, re-login only if needed
  local email="$1" jar="$2"
  if [ -f "$jar" ] && grep -q "access_token" "$jar"; then
    # cookie jar exists — assume valid (access JWT long-lived)
    return 0
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

echo "== fixtures: login =="
login_user "p8.teacher@catlium.dev" "$CJ"
CJB="/tmp/opencode/p8_ck_b.txt"; login_user "p8.other@catlium.dev" "$CJB"
CJS="/tmp/opencode/p8_ck_s.txt"; login_user "p8student1788584106@test.com" "$CJS"

mk_mcq() {
  # deterministic valid choice ids (version 4, variant 8 — satisfies z.string().uuid())
  local tag
  case "$1" in
    1) tag="000000000001" ;;
    2) tag="000000000002" ;;
    arc) tag="0000000000A1" ;;
    arc2) tag="0000000000A2" ;;
    *) tag="0000000000FF" ;;
  esac
  curl -s -b "$CJ" -X POST "$BASE/questions" -H 'Content-Type: application/json' -H "x-institute-id: $IA" \
    -d "{\"stem\":\"$RAND q$1 stem\",\"questionType\":\"MCQ\",\"source\":\"MANUAL\",\"difficulty\":\"EASY\",\"topicId\":\"$TOPIC\",\"payload\":{\"choices\":[{\"id\":\"ba111111-1111-4111-8111-${tag}\",\"text\":\"a\"},{\"id\":\"ba222222-2222-4222-8222-${tag}\",\"text\":\"b\"}],\"correctChoiceId\":\"ba222222-2222-4222-8222-${tag}\"}}" -o "$BODY_FILE"
}
mk_tf() {
  curl -s -b "$CJ" -X POST "$BASE/questions" -H 'Content-Type: application/json' -H "x-institute-id: $IA" \
    -d "{\"stem\":\"$RAND tf stem\",\"questionType\":\"TRUE_FALSE\",\"source\":\"AI_GENERATED\",\"difficulty\":\"MEDIUM\",\"topicId\":\"$TOPIC\",\"payload\":{\"correctAnswer\":true}}" -o "$BODY_FILE"
}
create_ass() { # create_ass <title> [extra_json]
  local title="$1" extra="${2:-}"
  req POST /assessments -H 'Content-Type: application/json' -H "x-institute-id: $IA" \
    -d "{\"title\":\"$title\",\"description\":\"d\",\"durationMinutes\":60,\"maxMarks\":100,\"instructions\":{\"text\":\"Read carefully\"},\"startsAt\":\"2030-01-01T09:00:00.000Z\",\"endsAt\":\"2030-01-01T11:00:00.000Z\"$extra}"
}
mk_pub() { # mk_pub <title>
  local title="$1"
  req POST /assessments -H 'Content-Type: application/json' -H "x-institute-id: $IA" \
    -d "{\"title\":\"$title\",\"durationMinutes\":60,\"maxMarks\":100,\"startsAt\":\"2030-01-01T09:00:00.000Z\",\"endsAt\":\"2030-01-01T11:00:00.000Z\"}"
}

# --- fixture: fresh questions -------------------------------------------------
mk_mcq "1"; Q1ID=$(jget id)
mk_mcq "2"; Q2ID=$(jget id)
mk_tf;    QTFID=$(jget id)
req POST "/questions/$Q1ID/approve" -H "x-institute-id: $IA" >/dev/null
req POST "/questions/$Q2ID/approve" -H "x-institute-id: $IA" >/dev/null
echo "Q1=$Q1ID Q2=$Q2ID QTF=$QTFID"

echo "== EXAM-01 =="
CR=$(create_ass "EXAM-01 $RAND"); AID=$(jget id)
ok "$CR" 201 "EXAM-01 create 201"
body_has '"status":"DRAFT"' "EXAM-01 create DRAFT"
LR=$(req GET "/assessments" -H "x-institute-id: $IA")
ok "$LR" 200 "EXAM-01 list 200"
body_has '"questionCount"' "EXAM-01 list questionCount"
GR=$(req GET "/assessments/$AID" -H "x-institute-id: $IA")
ok "$GR" 200 "EXAM-01 get 200"
PR=$(req PATCH "/assessments/$AID" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d '{"title":"EXAM-01 updated"}')
ok "$PR" 200 "EXAM-01 patch 200"
DR=$(req DELETE "/assessments/$AID" -H "x-institute-id: $IA")
ok "$DR" 204 "EXAM-01 delete 204"
GN=$(req GET "/assessments/$AID" -H "x-institute-id: $IA")
ok "$GN" 404 "EXAM-01 get-after-delete 404"

echo "== EXAM-02 =="
CR2=$(create_ass "EXAM-02 $RAND"); A2=$(jget id)
AD=$(req POST "/assessments/$A2/questions" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"questionIds\":[\"$Q1ID\",\"$Q2ID\"]}")
ok "$AD" 201 "EXAM-02 add-questions 201"
body_has '"sortOrder":1' "EXAM-02 sortOrder 1"
body_has '"marks":1' "EXAM-02 marks 1"
QL=$(req GET "/assessments/$A2/questions" -H "x-institute-id: $IA")
ok "$QL" 200 "EXAM-02 list-questions 200"
body_has "\"$Q1ID\"" "EXAM-02 nested q1"
QD=$(req POST "/assessments/$A2/questions" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"questionIds\":[\"$Q1ID\"]}")
ok "$QD" 409 "EXAM-02 duplicate link 409"
QDEL=$(req DELETE "/assessments/$A2/questions/$Q1ID" -H "x-institute-id: $IA")
ok "$QDEL" 204 "EXAM-02 remove-question 204"
QL2=$(req GET "/assessments/$A2/questions" -H "x-institute-id: $IA")
body_has "\"$Q2ID\"" "EXAM-02 remaining q2"

echo "== EXAM-03 =="
CR3=$(req POST /assessments -H 'Content-Type: application/json' -H "x-institute-id: $IA" \
  -d "{\"title\":\"EXAM-03 $RAND\",\"durationMinutes\":60,\"maxMarks\":100,\"instructions\":{\"text\":\"Read carefully\"}}")
A3=$(jget id)
ok "$CR3" 201 "EXAM-03 create 201"
body_has '"durationMinutes":60' "EXAM-03 dur 60"
body_has '"maxMarks":100' "EXAM-03 marks 100"
P3=$(req PATCH "/assessments/$A3" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d '{"durationMinutes":90,"maxMarks":150,"instructions":{"text":"Updated"}}')
ok "$P3" 200 "EXAM-03 patch 200"
body_has '"durationMinutes":90' "EXAM-03 dur 90"
body_has '"maxMarks":150' "EXAM-03 marks 150"
body_has '"text":"Updated"' "EXAM-03 instructions updated"

echo "== EXAM-04 =="
V=$(req POST /assessments -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"title\":\"EXAM-04 valid $RAND\",\"startsAt\":\"2030-01-01T09:00:00.000Z\",\"endsAt\":\"2030-01-01T11:00:00.000Z\"}")
ok "$V" 201 "EXAM-04 valid window 201"
IR=$(req POST /assessments -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"title\":\"inv $RAND\",\"startsAt\":\"2030-01-01T11:00:00.000Z\",\"endsAt\":\"2030-01-01T09:00:00.000Z\"}")
ok "$IR" 400 "EXAM-04 inverted 400"
PST=$(req POST /assessments -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"title\":\"past $RAND\",\"startsAt\":\"2020-01-01T09:00:00.000Z\",\"endsAt\":\"2030-01-01T11:00:00.000Z\"}")
ok "$PST" 400 "EXAM-04 past start 400"

echo "== EXAM-05 lifecycle =="
A5=$(mk_pub "EXAM-05 $RAND"); A5=$(jget id)
req POST "/assessments/$A5/questions" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"questionIds\":[\"$Q1ID\"]}" >/dev/null
R5a=$(req POST "/assessments/$A5/publish" -H "x-institute-id: $IA")
ok "$R5a" 201 "EXAM-05 publish 201"
body_has '"status":"PUBLISHED"' "EXAM-05 published"
R5b=$(req POST "/assessments/$A5/activate" -H "x-institute-id: $IA")
ok "$R5b" 201 "EXAM-05 activate 201"
body_has '"status":"ACTIVE"' "EXAM-05 active"
R5c=$(req POST "/assessments/$A5/complete" -H "x-institute-id: $IA")
ok "$R5c" 201 "EXAM-05 complete 201"
body_has '"status":"COMPLETED"' "EXAM-05 completed"

echo "== EXAM-06 full lifecycle =="
A6=$(mk_pub "EXAM-06 $RAND"); A6=$(jget id)
req POST "/assessments/$A6/questions" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"questionIds\":[\"$Q1ID\"]}" >/dev/null
s1=$(req POST "/assessments/$A6/publish" -H "x-institute-id: $IA"); ok "$s1" 201 "EXAM-06 step1 publish 201"
body_has '"status":"PUBLISHED"' "EXAM-06 step1 PUBLISHED"
s2=$(req POST "/assessments/$A6/activate" -H "x-institute-id: $IA"); ok "$s2" 201 "EXAM-06 step2 activate"
body_has '"status":"ACTIVE"' "EXAM-06 step2 ACTIVE"
s3=$(req POST "/assessments/$A6/complete" -H "x-institute-id: $IA"); ok "$s3" 201 "EXAM-06 step3 complete"
body_has '"status":"COMPLETED"' "EXAM-06 step3 COMPLETED"

echo "== EXAM-07 illegal transitions =="
A7d=$(mk_pub "EXAM-07 draft $RAND"); A7d=$(jget id)
req POST "/assessments/$A7d/questions" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"questionIds\":[\"$Q1ID\"]}" >/dev/null
A7a=$(mk_pub "EXAM-07 act $RAND"); A7a=$(jget id)
req POST "/assessments/$A7a/questions" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"questionIds\":[\"$Q1ID\"]}" >/dev/null
req POST "/assessments/$A7a/publish" -H "x-institute-id: $IA" >/dev/null
req POST "/assessments/$A7a/activate" -H "x-institute-id: $IA" >/dev/null
A7c=$(mk_pub "EXAM-07 comp $RAND"); A7c=$(jget id)
req POST "/assessments/$A7c/questions" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"questionIds\":[\"$Q1ID\"]}" >/dev/null
req POST "/assessments/$A7c/publish" -H "x-institute-id: $IA" >/dev/null
req POST "/assessments/$A7c/activate" -H "x-institute-id: $IA" >/dev/null
req POST "/assessments/$A7c/complete" -H "x-institute-id: $IA" >/dev/null

i1=$(req POST "/assessments/$A7d/activate" -H "x-institute-id: $IA"); ok "$i1" 400 "EXAM-07 draft->activate 400"
body_has "Cannot transition assessment from" "EXAM-07 msg draft->activate"
i2=$(req POST "/assessments/$A7d/complete" -H "x-institute-id: $IA"); ok "$i2" 400 "EXAM-07 draft->complete 400"
i3=$(req POST "/assessments/$A7a/unpublish" -H "x-institute-id: $IA"); ok "$i3" 400 "EXAM-07 active->unpublish 400"
i4=$(req POST "/assessments/$A7c/publish" -H "x-institute-id: $IA"); ok "$i4" 400 "EXAM-07 completed->publish 400"
i5=$(req POST "/assessments/$A7c/activate" -H "x-institute-id: $IA"); ok "$i5" 400 "EXAM-07 completed->activate 400"
i6=$(req POST "/assessments/$A7c/complete" -H "x-institute-id: $IA"); ok "$i6" 400 "EXAM-07 completed->complete 400"

echo "== EXAM-08 publish gate + ARCHIVED gate (WR-03) =="
A8p=$(mk_pub "EXAM-08 pending $RAND"); A8p=$(jget id)
req POST "/assessments/$A8p/questions" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"questionIds\":[\"$QTFID\"]}" >/dev/null
neg=$(req POST "/assessments/$A8p/publish" -H "x-institute-id: $IA"); ok "$neg" 400 "EXAM-08 pending publish 400"
body_has "not APPROVED" "EXAM-08 not APPROVED msg"

A8a=$(mk_pub "EXAM-08 ok $RAND"); A8a=$(jget id)
req POST "/assessments/$A8a/questions" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"questionIds\":[\"$Q1ID\"]}" >/dev/null
pos=$(req POST "/assessments/$A8a/publish" -H "x-institute-id: $IA"); ok "$pos" 201 "EXAM-08 approved publish 201"
body_has '"status":"PUBLISHED"' "EXAM-08 published"

echo "== ARCHIVED gate sub-cases (08-05) =="
mk_mcq "arc"; QARCID=$(jget id)
req POST "/questions/$QARCID/approve" -H "x-institute-id: $IA" >/dev/null
req POST "/questions/$QARCID/archive" -H "x-institute-id: $IA" >/dev/null
Aarc1=$(mk_pub "ARC link $RAND"); Aarc1=$(jget id)
ar1=$(req POST "/assessments/$Aarc1/questions" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"questionIds\":[\"$QARCID\"]}")
ok "$ar1" 400 "ARCHIVED link 400"
body_has "is not ACTIVE" "ARCHIVED link msg"

mk_mcq "arc2"; QARC2ID=$(jget id)
req POST "/questions/$QARC2ID/approve" -H "x-institute-id: $IA" >/dev/null
Aarc2=$(mk_pub "ARC pub $RAND"); Aarc2=$(jget id)
req POST "/assessments/$Aarc2/questions" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"questionIds\":[\"$QARC2ID\"]}" >/dev/null
req POST "/questions/$QARC2ID/archive" -H "x-institute-id: $IA" >/dev/null
ar2=$(req POST "/assessments/$Aarc2/publish" -H "x-institute-id: $IA")
ok "$ar2" 400 "ARCHIVED publish 400"
body_has "not APPROVED or not ACTIVE" "ARCHIVED publish msg"
req POST "/questions/$QARC2ID/activate" -H "x-institute-id: $IA" >/dev/null
ar3=$(req POST "/assessments/$Aarc2/publish" -H "x-institute-id: $IA")
ok "$ar3" 201 "ARCHIVED reactivated publish 201"

echo "== Security / negative block =="
ma1=$(req POST /assessments -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"title\":\"ma $RAND\",\"status\":\"PUBLISHED\"}")
ok "$ma1" 400 "SEC mass-assign status 400"
ma2=$(req POST /assessments -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"title\":\"ma2 $RAND\",\"instituteId\":\"$IB\"}")
ok "$ma2" 400 "SEC mass-assign instituteId 400"
badq=$(req POST /questions -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"stem\":\"bad $RAND\",\"questionType\":\"MCQ\",\"source\":\"MANUAL\",\"payload\":{\"choices\":[{\"id\":\"11111111-1111-1111-1111-1111111111aa\",\"text\":\"only\"}],\"correctChoiceId\":\"11111111-1111-1111-1111-1111111111aa\"}}")
ok "$badq" 400 "SEC malformed MCQ 400"

AB=$(mk_pub "SEC cross $RAND"); AB=$(jget id)
cget=$(curl -s -b "$CJB" -X GET "$BASE/assessments/$AB" -H "x-institute-id: $IB" -o /tmp/opencode/cg.txt -w "%{http_code}"); ok "$cget" 404 "SEC B get 404"
cpatch=$(curl -s -b "$CJB" -X PATCH "$BASE/assessments/$AB" -H 'Content-Type: application/json' -H "x-institute-id: $IB" -d '{"title":"x"}' -o /tmp/opencode/cp.txt -w "%{http_code}"); ok "$cpatch" 404 "SEC B patch 404"
cdel=$(curl -s -b "$CJB" -X DELETE "$BASE/assessments/$AB" -H "x-institute-id: $IB" -o /tmp/opencode/cd.txt -w "%{http_code}"); ok "$cdel" 404 "SEC B delete 404"
cpub=$(curl -s -b "$CJB" -X POST "$BASE/assessments/$AB/publish" -H "x-institute-id: $IB" -o /tmp/opencode/cpu.txt -w "%{http_code}"); ok "$cpub" 404 "SEC B publish 404"
ccomp=$(curl -s -b "$CJB" -X POST "$BASE/assessments/$AB/complete" -H "x-institute-id: $IB" -o /tmp/opencode/cc.txt -w "%{http_code}"); ok "$ccomp" 404 "SEC B complete 404"
cqadd=$(curl -s -b "$CJB" -X POST "$BASE/assessments/$AB/questions" -H 'Content-Type: application/json' -H "x-institute-id: $IB" -d "{\"questionIds\":[\"$Q1ID\"]}" -o /tmp/opencode/cqa.txt -w "%{http_code}"); ok "$cqadd" 404 "SEC B add-questions 404"

screate=$(curl -s -b "$CJS" -X POST "$BASE/assessments" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"title\":\"s $RAND\"}" -o /tmp/opencode/sc.txt -w "%{http_code}"); ok "$screate" 403 "SEC student create 403"
sadd=$(curl -s -b "$CJS" -X POST "$BASE/assessments/$AB/questions" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d "{\"questionIds\":[\"$Q1ID\"]}" -o /tmp/opencode/sa.txt -w "%{http_code}"); ok "$sadd" 403 "SEC student add 403"
sdel=$(curl -s -b "$CJS" -X DELETE "$BASE/assessments/$AB" -H "x-institute-id: $IA" -o /tmp/opencode/sd.txt -w "%{http_code}"); ok "$sdel" 403 "SEC student delete 403"
spub=$(curl -s -b "$CJS" -X POST "$BASE/assessments/$AB/publish" -H "x-institute-id: $IA" -o /tmp/opencode/sp.txt -w "%{http_code}"); ok "$spub" 403 "SEC student publish 403"
scomp=$(curl -s -b "$CJS" -X POST "$BASE/assessments/$AB/complete" -H "x-institute-id: $IA" -o /tmp/opencode/scp.txt -w "%{http_code}"); ok "$scomp" 403 "SEC student complete 403"
slist=$(curl -s -b "$CJS" -X GET "$BASE/assessments" -H "x-institute-id: $IA" -o /tmp/opencode/sl.txt -w "%{http_code}"); ok "$slist" 200 "SEC student list 200"
sget=$(curl -s -b "$CJS" -X GET "$BASE/assessments/$AB" -H "x-institute-id: $IA" -o /tmp/opencode/sg.txt -w "%{http_code}"); ok "$sget" 200 "SEC student get 200"
sqlist=$(curl -s -b "$CJS" -X GET "$BASE/assessments/$AB/questions" -H "x-institute-id: $IA" -o /tmp/opencode/sql.txt -w "%{http_code}"); ok "$sqlist" 200 "SEC student list-questions 200"

RANDUUID="00000000-0000-0000-0000-000000000000"
rndg=$(req GET "/assessments/$RANDUUID" -H "x-institute-id: $IA"); ok "$rndg" 404 "SEC random uuid get 404"
rndp=$(req PATCH "/assessments/$RANDUUID" -H 'Content-Type: application/json' -H "x-institute-id: $IA" -d '{"title":"x"}'); ok "$rndp" 404 "SEC random uuid patch 404"
rndpu=$(req POST "/assessments/$RANDUUID/publish" -H "x-institute-id: $IA"); ok "$rndpu" 404 "SEC random uuid publish 404"
nocookie=$(curl -s -X GET "$BASE/assessments" -H "x-institute-id: $IA" -o /tmp/opencode/nc.txt -w "%{http_code}"); ok "$nocookie" 401 "SEC no cookie 401"
nonmember=$(curl -s -b "$CJ" -X GET "$BASE/assessments" -H "x-institute-id: 99999999-9999-9999-9999-999999999999" -o /tmp/opencode/nm.txt -w "%{http_code}"); ok "$nonmember" 403 "SEC non-member tenant 403"

echo ""
echo "=========================================="
echo "RESULT: PASS=$PASS FAIL=$FAIL"
echo "=========================================="
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi