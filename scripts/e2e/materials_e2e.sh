#!/usr/bin/env bash
# materials_e2e.sh — Phase 16 materials suite: upload, OCR/worker boundary,
# and the full processing lifecycle against the dockerized worker-material.
# Ladder: text/plain upload exercises the real chain (API write -> RabbitMQ
# job -> worker-material -> storage volume -> OCR extraction -> API READY)
# without needing PaddleOCR; content marker proves end-to-end locality.
# Also asserts role gates (student 403, anon 401) on process.
# Exits non-zero on any FAIL.
# Requires: dockerized stack with worker-material RUNNING (needed so the
# MATERIAL_PROCESS job is consumed and the storage volume is shared) and the
# demo seed applied (teacher@catlium.dev).

set -u
BASE="http://localhost:3000/api/v1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
JAR="/tmp/opencode/mat_teacher.txt"
CJS="/tmp/opencode/mat_student.txt"
BODY_FILE="/tmp/opencode/mat_body.tmp"
TMP="/tmp/opencode"
PASS=0
FAIL=0
FAILURES=()

DI="99999999-9999-9999-9999-999999999999"
RAND="$(date +%s)"
JAR="$JAR"
INST="$DI"

ok() { local code="$1" exp="$2" label="$3"
  if [ "$code" = "$exp" ]; then PASS=$((PASS+1)); echo "  ok $label";
  else FAIL=$((FAIL+1)); FAILURES+=("$label: expected $exp got $code"); echo "  FAIL $label (got $code, want $exp)"; fi
}
body_has() { local sub="$1" label="$2"
  if grep -qF "$sub" "$BODY_FILE"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$label: missing '$sub' in body"); echo "  FAIL $label (missing '$sub')"; fi
}
jget() { grep -oP "\"$1\"\s*:\s*\"?[^\",}]*" "$BODY_FILE" | head -1 | sed -E "s/\"$1\"\s*:\s*\"?//"; }
req() { local method="$1" path="$2"; shift 2
  curl -s -b "$JAR" -X "$method" "$BASE$path" -o "$BODY_FILE" -w '%{http_code}' \
    -H "x-institute-id: $INST" "$@" 2>/dev/null || true
}
req2() { local method="$1" path="$2" jar="$3"; shift 3
  curl -s -b "$jar" -X "$method" "$BASE$path" -o "$BODY_FILE" -w '%{http_code}' \
    -H "x-institute-id: $INST" "$@"
}
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
pick_name() { python3 - "$BODY_FILE" "$1" <<'PYEOF' | head -1
import json, sys
d = json.load(open(sys.argv[1]))
def walk(o, k):
    if isinstance(o, dict):
        for v in o.values():
            r = walk(v, k)
            if r: return r
        if o.get('name') == k or o.get('title') == k:
            return o.get('id')
    elif isinstance(o, list):
        for v in o:
            r = walk(v, k)
            if r: return r
    return None
out = walk(d, sys.argv[2])
if out: print(out)
PYEOF
}
poll_job() { local jid="$1" secs="$2"
  local i st
  for i in $(seq 1 "$((secs / 2))"); do
    curl -s -b "$JAR" -X GET "$BASE/jobs/$jid" -H "x-institute-id: $INST" -o "$BODY_FILE" -w '' 2>/dev/null || true
    st=$(jget status)
    [ "$st" = "completed" ] && return 0
    [ "$st" = "failed" ] && { echo "    job $jid FAILED"; cat "$BODY_FILE"; return 1; }
    sleep 2
  done
  echo "    job $jid not completed in ${secs}s (status=$st)"
  return 1
}

echo "== fixtures: login =="
login_user "teacher@catlium.dev" "$JAR"
login_user "student@catlium.dev" "$CJS"

echo "== MAT-01 academic scaffold =="
SUBJN="Materials $RAND"
curl -s -b "$JAR" -X POST "$BASE/academic/subjects" -H 'Content-Type: application/json' \
  -H "x-institute-id: $INST" -d "{\"name\":\"$SUBJN\",\"slug\":\"mat-$RAND\"}" -o "$BODY_FILE" -w '' 2>/dev/null
SUBJ=$(pick_name "$SUBJN")
curl -s -b "$JAR" -X POST "$BASE/academic/subjects/$SUBJ/chapters" -H 'Content-Type: application/json' \
  -H "x-institute-id: $INST" -d '{"name":"MC1","slug":"mc1"}' -o "$BODY_FILE" -w '' 2>/dev/null
CHID=$(pick_name MC1)
curl -s -b "$JAR" -X POST "$BASE/academic/chapters/$CHID/topics" -H 'Content-Type: application/json' \
  -H "x-institute-id: $INST" -d '{"name":"MT1","slug":"mt1"}' -o "$BODY_FILE" -w '' 2>/dev/null
TOPIC=$(pick_name MT1)
[ -n "$SUBJ" ] && [ -n "$CHID" ] && [ -n "$TOPIC" ] \
  && { PASS=$((PASS+1)); echo "  ok MAT-01 scaffold created"; } \
  || { FAIL=$((FAIL+1)); FAILURES+=("MAT-01 scaffold"); echo "  FAIL MAT-01 scaffold"; }

echo "== MAT-02 text material -> READY with embedded text =="
METHOD=POST curl -s -b "$JAR" -X POST "$BASE/materials/text" -H 'Content-Type: application/json' \
  -H "x-institute-id: $INST" \
  -d "{\"title\":\"MAT text $RAND\",\"text\":\"Interphase, prophase, metaphase.\",\"topicId\":\"$TOPIC\"}" \
  -o "$BODY_FILE" -w '' 2>/dev/null
MAT=$(jget id)
ok "$(req GET "/materials/$MAT")" 200 "MAT-02a get material -> 200"
body_has 'READY' "MAT-02b text material READY"
body_has 'Interphase' "MAT-02c embedded text present"
ok "$(req POST "/materials/$MAT/process")" 409 "MAT-02d process TEXT -> 409"

echo "== MAT-03 upload + worker process boundary =="
MARKER="MAT${RAND}-boundary-marker"
printf '%s\n' "$MARKER  Prophase to metaphase notes." > "$TMP/mat_fixture.txt"
code=$(curl -s -b "$JAR" -X POST "$BASE/materials/upload" -H "x-institute-id: $INST" \
  -F "file=@$TMP/mat_fixture.txt;type=text/plain" -F "title=MAT upload $RAND" -F "topicId=$TOPIC" \
  -o "$BODY_FILE" -w '%{http_code}')
ok "$code" 201 "MAT-03a upload text/plain -> 201"
UPL=$(jget id)
ok "$(req GET "/materials/$UPL")" 200 "MAT-03b get uploaded material -> 200"
body_has 'UPLOADED' "MAT-03c upload starts UPLOADED"
ok "$(req POST "/materials/$UPL/process")" 202 "MAT-03d process -> 202"
JID=$(jget jobId)
echo "    jobId=$JID waiting for worker-material..."
if poll_job "$JID" 240; then PASS=$((PASS+1)); echo "    ok MAT-03e job completed";
else FAIL=$((FAIL+1)); FAILURES+=("MAT-03e job completed"); echo "    FAIL MAT-03e job completed"; fi
ok "$(req GET "/materials/$UPL")" 200 "MAT-03f material after process -> 200"
body_has 'READY' "MAT-03g material READY after worker"
body_has "$MARKER" "MAT-03h extracted text_content has marker"

echo "== MAT-04 lifecycle gates =="
ok "$(req POST "/materials/$UPL/process")" 409 "MAT-04a process READY -> 409"
ok "$(req POST "/materials/$UPL/retry")" 409 "MAT-04b retry READY -> 409"
ok "$(req POST "/materials/$UPL/archive")" 201 "MAT-04c archive -> 201"
ok "$(req POST "/materials/$UPL/process")" 409 "MAT-04d process ARCHIVED -> 409"
ok "$(req POST "/materials/$UPL/activate")" 201 "MAT-04e activate -> 201"
ok "$(req POST "/materials/$UPL/archive")" 201 "MAT-04f archive again -> 201"

echo "== MAT-05 role gates =="
ok "$(req2 POST "/materials/$UPL/process" "$CJS")" 403 "MAT-05a student process -> 403"
ok "$(curl -s -X POST "$BASE/materials/$UPL/process" -H "x-institute-id: $INST" -o "$BODY_FILE" -w '%{http_code}')" 401 "MAT-05b anon process -> 401"
rm -f "$TMP/mat_fixture.txt"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "MATERIALS E2E: PASS=$PASS FAIL=0"
  echo "ALL PASS"
  exit 0
else
  echo "MATERIALS E2E: PASS=$PASS FAIL=$FAIL"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi