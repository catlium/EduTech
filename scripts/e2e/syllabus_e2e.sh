#!/usr/bin/env bash
# syllabus_e2e.sh — Phase 30 (syllabus-first) end-to-end harness.
#
# The syllabus is the authoritative source: paste text or upload the official
# document (text extracted by the processing pipeline), AI deep-analyzes it into
# context + chapter structure, the teacher confirms → reconciled into the real
# Subject→Chapter→Topic hierarchy. Runs entirely against the DEPLOYED stack
# (API + worker-material + worker-ai + OmniRoute real AI). No mock provider.
#
# Requirements:
#   - the docker stack with the new images up (api/web/worker-material/worker-ai)
#   - demo seed applied (teacher@catlium.dev / student@catlium.dev in the
#     CatLium Demo institute 99999999-...)
#   - OmniRoute configured (empty API key works for local use)
# Exits non-zero on any FAIL.

set -u
BASE="http://localhost:3000/api/v1"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CJ="/tmp/opencode/syl_ck.txt"
CJS="/tmp/opencode/syl_ck_s.txt"
BODY_FILE="/tmp/opencode/syl_body.tmp"
TXT_FILE="/tmp/opencode/syl_fixture.txt"
PASS=0
FAIL=0
FAILURES=()

DEMO="99999999-9999-9999-9999-999999999999"
RAND="$(date +%s)"
SUBJ=""
SUBJ2=""
SYL=""
SYL2=""
ANALYSIS_TIMEOUT=180

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
poll_syllabus_field() { # poll_syllabus_field <syllabusId> <field> <terminal-value> <timeout-s>
  # Polls GET /syllabus/:id until the field equals the terminal value, FAILED, or
  # timeout. Echoes final value (or "timeout").
  local id="$1" field="$2" want="$3" timeout_s="$4" started now val
  started=$(date +%s)
  while true; do
    req GET "/syllabus/$id" -H "x-institute-id: $DEMO" >/dev/null 2>&1 || true
    val=$(jget "$field")
    if [ "$val" = "$want" ] || [ "$val" = "FAILED" ]; then echo "$val"; return 0; fi
    now=$(date +%s)
    if [ $((now - started)) -gt "$timeout_s" ]; then echo "timeout"; return 1; fi
    sleep 3
  done
}

echo "== fixtures: demo seed text fixture for upload =="
cat > "$TXT_FILE" <<'EOF'
B.Sc. Computer Science - Semester I
Unit 1: Computer Fundamentals - components of a computer system, hardware and software.
Unit 2: Programming with C - variables, loops, functions, arrays.
Unit 3: Discrete Mathematics - sets, relations, functions, logic.
Unit 4: Digital Logic - number systems, boolean algebra, logic gates.
EOF

echo "== fixtures: login =="
login_user "teacher@catlium.dev" "$CJ"
login_user "student@catlium.dev" "$CJS"

echo "== SYL-01 create subject + text syllabus =="
CS=$(req POST /academic/subjects -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"name\":\"Computer Science $RAND\",\"slug\":\"cs-$RAND\"}")
ok "$CS" 201 "SYL-01 create subject 201"
SUBJ=$(jget id)
echo "  subject=$SUBJ"

CT=$(req POST /syllabus/text -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"subjectId\":\"$SUBJ\",\"title\":\"B.Sc. CS Syllabus $RAND\",\"program\":\"B.Sc. Computer Science\",\"academicYear\":\"2026-27\",\"text\":\"B.Sc. Computer Science - Semester I. Unit 1: Computer Fundamentals - components of a computer system, hardware and software. Unit 2: Programming with C - variables, loops, functions, arrays. Unit 3: Discrete Mathematics - sets, relations, functions, logic. Unit 4: Digital Logic - number systems, boolean algebra, logic gates.\"}")
ok "$CT" 201 "SYL-01 create text syllabus 201"
body_has '"version":1' "SYL-01 version 1"
body_has '"processingStatus":"READY"' "SYL-01 text syllabus READY"
body_has '"analysisStatus":"PENDING"' "SYL-01 analysis pending"
body_has '"status":"PROPOSED"' "SYL-01 proposed"
body_has "$SUBJ" "SYL-01 belongs to subject"
SYL=$(jget id)
echo "  syllabus=$SYL"

echo "== SYL-02 list pages + get =="
LT=$(req GET /syllabus -H "x-institute-id: $DEMO")
ok "$LT" 200 "SYL-02 list 200"
body_has '"subjectName"' "SYL-02 list carries subjectName"
body_has "$SYL" "SYL-02 list has new syllabus"
GT=$(req GET "/syllabus/$SYL" -H "x-institute-id: $DEMO")
ok "$GT" 200 "SYL-02 get 200"
body_has '"textContent"' "SYL-02 get exposes text"
GV=$(req GET "/syllabus/$SYL/versions" -H "x-institute-id: $DEMO")
ok "$GV" 200 "SYL-02 versions 200"
body_has '"isCurrent":true' "SYL-02 version 1 is current"

echo "== SYL-03 analyze -> job completes -> READY context+structure =="
an_code=$(req POST "/syllabus/$SYL/analyze" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{}')
ok "$an_code" 202 "SYL-03 analyze 202"
body_has '"jobId"' "SYL-03 analyze returns jobId"
job=$(jget jobId)
echo "  analysis job=$job"
status=$(poll_syllabus_field "$SYL" analysisStatus "READY" "$ANALYSIS_TIMEOUT")
ok "$status" "READY" "SYL-03 analysis READY"
req GET "/syllabus/$SYL" -H "x-institute-id: $DEMO" >/dev/null
if [ "$status" = "FAILED" ]; then
  echo "  ANALYSIS FAILED: $(jget analysisError)"
fi
body_has '"analysisStatus":"READY"' "SYL-03 analysis status ready"
body_has '"chapters"' "SYL-03 structure has chapters"
body_has '"objectives"' "SYL-03 context extracted"

echo "== SYL-04 edit proposal stays analyzable/idempotent =="
PU=$(req PATCH "/syllabus/$SYL" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"title\":\"B.Sc. CS (edited) $RAND\",\"program\":\"B.Sc. Computer Science\",\"academicYear\":\"2026-27\"}")
ok "$PU" 200 "SYL-04 patch title 200"
body_has "B.Sc. CS (edited) $RAND" "SYL-04 edited title stored"

echo "== SYL-05 analyze again after READY -> 409; empty structure patch -> 400 =="
AG=$(req POST "/syllabus/$SYL/analyze" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{}')
ok "$AG" 409 "SYL-05 re-analyze READY -> 409"
PI=$(req PATCH "/syllabus/$SYL" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d '{"structure":{"chapters":[]}}')
ok "$PI" 400 "SYL-05 empty structure -> 400"

echo "== SYL-06 confirm -> reconciliation report + chapters created =="
CF=$(req POST "/syllabus/$SYL/confirm" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO")
ok "$CF" 201 "SYL-06 confirm 201"
body_has '"report"' "SYL-06 confirm returns report"
body_has '"status":"CONFIRMED"' "SYL-06 syllabus CONFIRMED"
body_has '"confirmedAt":' "SYL-06 confirmedAt set"
CH=$(req GET "/academic/subjects/$SUBJ/chapters" -H "x-institute-id: $DEMO")
ok "$CH" 200 "SYL-06 chapters list 200"
body_has '"status":"active"' "SYL-06 chapters created active"
req GET "/syllabus/$SYL" -H "x-institute-id: $DEMO" >/dev/null
body_has '"units"' "SYL-06 units present in detail"

echo "== SYL-07 terminal-state guards (CONFIRMED) =="
RP=$(req PATCH "/syllabus/$SYL" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d '{"title":"nope"}')
ok "$RP" 409 "SYL-07 patch after confirm -> 409"
RC=$(req POST "/syllabus/$SYL/confirm" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO")
ok "$RC" 409 "SYL-07 confirm again -> 409"
AR=$(req POST "/syllabus/$SYL/archive" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO")
ok "$AR" 409 "SYL-07 archive after confirm -> 409"
DL=$(req DELETE "/syllabus/$SYL" -H "x-institute-id: $DEMO")
ok "$DL" 409 "SYL-07 delete after confirm -> 409"

echo "== SYL-08 upload file -> process -> text extracted =="
SCOUNT=$(curl -s -b "$CJ" -X GET "$BASE/academic/subjects" -H "x-institute-id: $DEMO" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['subjects']))")
CS2=$(req POST /academic/subjects -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"name\":\"Physics $RAND\",\"slug\":\"phy-$RAND\"}")
ok "$CS2" 201 "SYL-08 create subject 201"
SUBJ2=$(jget id)
CU=$(curl -s -b "$CJ" -X POST "$BASE/syllabus/upload" -H "x-institute-id: $DEMO" \
  -F "subjectId=$SUBJ2" -F "title=Physics syllabus $RAND" -F "file=@$TXT_FILE;type=text/plain" \
  -o "$BODY_FILE" -w '%{http_code}')
ok "$CU" 201 "SYL-08 upload 201"
body_has '"processingStatus":"UPLOADED"' "SYL-08 uploaded state"
SYL2=$(jget id)
echo "  uploaded syllabus=$SYL2"
# SYL-E1: uploading for an existing subject never duplicates the subject
SCOUNT_AFTER=$(curl -s -b "$CJ" -X GET "$BASE/academic/subjects" -H "x-institute-id: $DEMO" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['subjects']))")
if [ "$SCOUNT_AFTER" = "$((SCOUNT + 1))" ]; then PASS=$((PASS+1)); echo "  ok SYL-E1 no duplicate subject on upload (subjects $(($SCOUNT + 1)) = create 1, upload 0)";
else FAIL=$((FAIL+1)); FAILURES+=("SYL-E1 subject count grew beyond the one explicit create ($SCOUNT -> $SCOUNT_AFTER)"); echo "  FAIL SYL-E1 subject count grew beyond the one explicit create"; fi
PU2=$(req POST "/syllabus/$SYL2/process" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO")
ok "$PU2" 202 "SYL-08 process 202"
body_has '"jobId"' "SYL-08 process enqueues job"
status=$(poll_syllabus_field "$SYL2" processingStatus "READY" 120)
ok "$status" "READY" "SYL-08 processing READY"
if [ "$status" = "FAILED" ]; then echo "  PROCESS FAILED: $(jget processingError)"; fi
req GET "/syllabus/$SYL2" -H "x-institute-id: $DEMO" >/dev/null
body_has '"processingStatus":"READY"' "SYL-08 processing state ready"
body_has "Discrete Mathematics" "SYL-08 text extracted from file"

echo "== SYL-09 state guards =="
PJ=$(req POST "/syllabus/$SYL2/process" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO")
ok "$PJ" 409 "SYL-09 process on READY -> 409"
AN=$(req POST "/syllabus/$SYL2/analyze" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{}')
ok "$AN" 202 "SYL-09 analyze uploaded file 202"
status=$(poll_syllabus_field "$SYL2" analysisStatus "READY" "$ANALYSIS_TIMEOUT")
ok "$status" "READY" "SYL-09 file syllabus analysis READY"

echo "== SYL-10 security: student cannot write, can read =="
SG=$(req_as "$CJS" POST /syllabus/text -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"subjectId\":\"$SUBJ2\",\"title\":\"x\",\"text\":\"y\"}")
ok "$SG" 403 "SYL-10 student create -> 403"
SP=$(req_as "$CJS" PATCH "/syllabus/$SYL2" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{"title":"x"}')
ok "$SP" 403 "SYL-10 student patch -> 403"
SA=$(req_as "$CJS" POST "/syllabus/$SYL2/analyze" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{}')
ok "$SA" 403 "SYL-10 student analyze -> 403"
SC=$(req_as "$CJS" POST "/syllabus/$SYL2/confirm" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO")
ok "$SC" 403 "SYL-10 student confirm -> 403"
SR=$(req_as "$CJS" GET "/syllabus/$SYL2" -H "x-institute-id: $DEMO")
ok "$SR" 200 "SYL-10 student read -> 200"

echo "== SYL-11 cross-tenant isolation =="
XN=$(req GET "/syllabus/$SYL2" -H "x-institute-id: 11111111-1111-1111-1111-111111111111")
ok "$XN" 403 "SYL-11 foreign tenant read -> 403"
NC=$(curl -s -X GET "$BASE/syllabus/$SYL2" -H "x-institute-id: $DEMO" -o /dev/null -w "%{http_code}")
ok "$NC" 401 "SYL-11 no cookie -> 401"

echo "== SYL-E2 confirm -> reconciliation invents no subjects =="
SCP=$(curl -s -b "$CJ" -X GET "$BASE/academic/subjects" -H "x-institute-id: $DEMO" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['subjects']))")
CN2=$(req POST "/syllabus/$SYL2/confirm" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{}')
ok "$CN2" 201 "SYL-E2 confirm 201"
SCA=$(curl -s -b "$CJ" -X GET "$BASE/academic/subjects" -H "x-institute-id: $DEMO" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['subjects']))")
if [ "$SCA" = "$SCP" ]; then PASS=$((PASS+1)); echo "  ok SYL-E2 no new subjects invented by confirm ($SCP)";
else FAIL=$((FAIL+1)); FAILURES+=("SYL-E2 confirm added subjects ($SCP -> $SCA)"); echo "  FAIL SYL-E2 confirm added subjects ($SCP -> $SCA)"; fi
ST2=$(poll_syllabus_field "$SYL2" status "CONFIRMED" 30)
ok "$ST2" "CONFIRMED" "SYL-E2 syllabus reaches CONFIRMED"

echo "== SYL-E3 subject-specific syllabus isolation =="
ST1=$(poll_syllabus_field "$SYL" status "CONFIRMED" 30)
ok "$ST1" "CONFIRMED" "SYL-E3 subject 1 syllabus still CONFIRMED (unaffected)"
SLIST=$(curl -s -b "$CJ" -X GET "$BASE/syllabus?subjectId=$SUBJ2" -H "x-institute-id: $DEMO" | python3 -c "import sys,json;s=json.load(sys.stdin)['syllabi'];print(len(s), s[0]['id'] if s else '', s[0]['subjectId'] if s else '')")
SLN=$(echo "$SLIST" | cut -d' ' -f1)
SLID=$(echo "$SLIST" | cut -d' ' -f2)
SLSUBJ=$(echo "$SLIST" | cut -d' ' -f3)
ok "$SLN" "1" "SYL-E3 subject 2 has exactly its own syllabus"
ok "$SLSUBJ" "$SUBJ2" "SYL-E3 syllabus owned by subject 2"
ok "$SLID" "$SYL2" "SYL-E3 version chain belongs to subject 2"

echo ""
echo "=========================================="
echo "RESULT: PASS=$PASS FAIL=$FAIL"
echo "=========================================="
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi