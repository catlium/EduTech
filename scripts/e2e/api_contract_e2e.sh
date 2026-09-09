#!/usr/bin/env bash
# api_contract_e2e.sh — Phase 15 API Contract Verification end-to-end harness.
# Exercises the documented surface that the earlier per-phase suites do not
# touch: health, auth refresh/logout CSRF, memberships, academic PATCH/slug
# conflicts, the full materials lifecycle (including upload 400/413 paths),
# content versioning, generic jobs, questions list validation + DELETE 204.
# Behavior-only assertions cross-check the docs/api/*.md contracts (CT-01..):
#   each endpoint asserts method, path, auth/roles, and status codes only, so
#   the suite is stable against the mock-provider-dependent suites.
# Exits non-zero on any FAIL. Requires live dockerized stack (api + postgres)
# with the idempotent demo seed applied (pnpm db:seed).
# NOTE: run with compose workers stopped (docker stop catlium-worker-ai
# catlium-worker-material) so the single POST /jobs fixture job is not consumed.

set -u
BASE="http://localhost:3000/api/v1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_URL="postgresql://catlium:catlium_dev_secret@localhost:5432/catlium_dev"
CJ="/tmp/opencode/ct_teacher.txt"
CJS="/tmp/opencode/ct_student.txt"
BODY_FILE="/tmp/opencode/ct_body.tmp"
TMP="/tmp/opencode"
PASS=0
FAIL=0
FAILURES=()

DI="99999999-9999-9999-9999-999999999999"
RAND="$(date +%s)"
JAR="$CJ"
INST="$DI"
MC_A="ba000000-0000-4000-8000-0000000000a1"
MC_B="ba000000-0000-4000-8000-0000000000b2"

# ── helpers (same contract as the other suites) ────────────────────────────
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
req_anon() { local method="$1" path="$2"; shift 2
  curl -s -X "$method" "$BASE$path" "$@" -o "$BODY_FILE" -w '%{http_code}'
}
jget() { grep -oP "\"$1\"\s*:\s*\"?[^\",}]*" "$BODY_FILE" | head -1 | sed -E "s/\"$1\"\s*:\s*\"?//"; }
login_user() { local email="$1" jar="$2"
  if [ -f "$jar" ] && grep -q "access_token" "$jar"; then return 0; fi
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

echo "== fixtures: login =="
login_user "teacher@catlium.dev" "$CJ"
login_user "student@catlium.dev" "$CJS"

echo "== CT-01 health (public; /api/v1/health under the global prefix) =="
ok "$(req_anon GET /health)" 200 "CT-01a /health -> 200"
body_has '"status":"ok"' "CT-01b health status ok"

echo "== CT-02 auth: refresh (CSRF) + logout (CSRF) on scratch sessions =="
RF="$TMP/ct_rf.txt"; rm -f "$RF"
login_user "student@catlium.dev" "$RF"
CRF=$(grep -P "\tcsrf_token\t" "$RF" | head -1 | awk '{print $NF}')
ok "$(curl -s -b "$RF" -X POST "$BASE/auth/refresh" -H 'x-csrf-token: wrong' -o "$BODY_FILE" -w '%{http_code}')" 403 "CT-02a refresh wrong CSRF -> 403"
ok "$(curl -s -b "$RF" -c "$RF" -X POST "$BASE/auth/refresh" -H "x-csrf-token: $CRF" -o "$BODY_FILE" -w '%{http_code}')" 200 "CT-02b refresh right CSRF -> 200"
ok "$(curl -s -b "$RF" -X GET "$BASE/auth/me" -o "$BODY_FILE" -w '%{http_code}')" 200 "CT-02c me after refresh -> 200"
LF="$TMP/ct_lf.txt"; rm -f "$LF"
login_user "student@catlium.dev" "$LF"
CRF=$(grep -P "\tcsrf_token\t" "$LF" | head -1 | awk '{print $NF}')
ok "$(curl -s -b "$LF" -c "$LF" -X POST "$BASE/auth/logout" -H "x-csrf-token: $CRF" -o "$BODY_FILE" -w '%{http_code}')" 200 "CT-02d logout with CSRF -> 200"
ok "$(curl -s -b "$LF" -X GET "$BASE/auth/me" -o "$BODY_FILE" -w '%{http_code}')" 401 "CT-02e me after logout -> 401"
JAR="$CJ"
ok "$(req GET /auth/me)" 200 "CT-02f /auth/me teacher -> 200"

echo "== CT-03 memberships (no tenant header) =="
ok "$(curl -s -b "$CJ" -X GET "$BASE/memberships" -o "$BODY_FILE" -w '%{http_code}')" 200 "CT-03a memberships teacher -> 200"
body_has 'CatLium Demo Institute' "CT-03b memberships lists demo institute"
ok "$(req_anon GET /memberships)" 401 "CT-03c memberships anonymous -> 401"

echo "== CT-04 academic: create / patch / slug conflict =="
JAR="$CJ"; INST="$DI"
SUBJN="Contract $RAND"
req POST /academic/subjects -H 'Content-Type: application/json' -d "{\"name\":\"$SUBJN\",\"slug\":\"contract-$RAND\"}" >/dev/null
SUBJ=$(pick_name "$SUBJN")
ok "$(req POST /academic/subjects -H 'Content-Type: application/json' -d "{\"name\":\"$SUBJN 2\",\"slug\":\"contract-$RAND\"}")" 409 "CT-04a duplicate slug -> 409"
req PATCH "/academic/subjects/$SUBJ" -H 'Content-Type: application/json' -d '{"name":"Renamed Subject"}' >/dev/null
ok "$(req GET "/academic/subjects/$SUBJ")" 200 "CT-04b get subject -> 200"
body_has 'Renamed Subject' "CT-04c patch applied name"
ok "$(req GET "/academic/subjects/$SUBJ/chapters")" 200 "CT-04d subjects/:id/chapters -> 200"
req POST "/academic/subjects/$SUBJ/chapters" -H 'Content-Type: application/json' -d '{"name":"C15","slug":"c15"}' >/dev/null
CHID=$(pick_name C15)
req POST "/academic/chapters/$CHID/topics" -H 'Content-Type: application/json' -d '{"name":"T15","slug":"t15"}' >/dev/null
TOPIC=$(pick_name T15)
ok "$(req GET "/academic/chapters/$CHID/topics")" 200 "CT-04e chapters/:id/topics -> 200"

echo "== CT-05 materials: text lifecycle =="
req POST /materials/text -H 'Content-Type: application/json' \
  -d "{\"title\":\"CT text $RAND\",\"text\":\"Interphase, prophase, metaphase.\",\"topicId\":\"$TOPIC\"}" >/dev/null
MAT=$(jget id)
ok "$(req GET "/materials/$MAT")" 200 "CT-05a get material -> 200"
body_has 'READY' "CT-05b text material READY"
ok "$(req GET /materials)" 200 "CT-05c list materials -> 200"
req PATCH "/materials/$MAT" -H 'Content-Type: application/json' -d '{"description":"updated desc"}' >/dev/null
ok "$(req POST "/materials/$MAT/process")" 409 "CT-05d process TEXT material -> 409"
ok "$(req POST "/materials/$MAT/retry")" 409 "CT-05e retry TEXT material -> 409"
ok "$(req POST "/materials/$MAT/archive")" 201 "CT-05f archive material -> 201"
ok "$(req POST "/materials/$MAT/activate")" 201 "CT-05g activate material -> 201"
body_has '"description":"updated desc"' "CT-05h patch description applied"

echo "== CT-06 materials: upload validation =="
printf 'contract upload fixture\n' > "$TMP/ct_small.txt"
ok "$(req POST /materials/upload -F "file=@$TMP/ct_small.txt;type=text/plain" -F "title=CT upload $RAND" -F "topicId=$TOPIC")" 201 "CT-06a upload text/plain -> 201"
ok "$(req POST /materials/upload -F "file=@$TMP/ct_small.txt;type=application/octet-stream" -F "title=CT bad $RAND" -F "topicId=$TOPIC")" 400 "CT-06b unsupported MIME -> 400"
cp "$TMP/ct_small.txt" "$TMP/ct_mismatch.png"
ok "$(req POST /materials/upload -F "file=@$TMP/ct_mismatch.png;type=application/pdf" -F "title=CT mm $RAND" -F "topicId=$TOPIC")" 400 "CT-06c extension/MIME mismatch -> 400"
head -c 22000000 /dev/zero > "$TMP/ct_big.txt"
ok "$(req POST /materials/upload -F "file=@$TMP/ct_big.txt;type=text/plain" -F "title=CT big $RAND" -F "topicId=$TOPIC")" 413 "CT-06d >20MB upload -> 413"
ok "$(req 'GET' '/materials?processingStatus=BOGUS')" 400 "CT-06e invalid enum filter -> 400"
rm -f "$TMP/ct_big.txt" "$TMP/ct_mismatch.png" "$TMP/ct_small.txt"

echo "== CT-07 content: versioning =="
req POST /content -H 'Content-Type: application/json' \
  -d "{\"title\":\"CT note $RAND\",\"type\":\"NOTE\",\"source\":\"MANUAL\",\"topicId\":\"$TOPIC\",\"payload\":{\"blocks\":[{\"id\":\"b1\",\"type\":\"paragraph\",\"content\":\"v1\"}]}}" >/dev/null
CID=$(jget id)
ok "$(req GET "/content/$CID")" 200 "CT-07a get content -> 200"
body_has '"version":1' "CT-07b current version 1"
ok "$(req PATCH "/content/$CID" -H 'Content-Type: application/json' -d "{\"payload\":{\"blocks\":[{\"id\":\"b1\",\"type\":\"paragraph\",\"content\":\"v2\"}]},\"changeReason\":\"edit\"}")" 200 "CT-07c update content -> 200"
body_has '"version":2' "CT-07d version bumped to 2"
ok "$(req GET "/content/$CID/versions")" 200 "CT-07e versions list -> 200"
ok "$(req GET "/content/$CID/versions/2")" 200 "CT-07f get version 2 -> 200"
ok "$(req GET "/content/$CID/versions/3")" 404 "CT-07g missing version -> 404"
ok "$(req POST /content -H 'Content-Type: application/json' -d "{\"title\":\"CT bad $RAND\",\"type\":\"NOTE\",\"source\":\"MANUAL\",\"topicId\":\"$TOPIC\",\"payload\":{\"cards\":[]}}")" 400 "CT-07h flashcard payload for NOTE -> 400"
ok "$(req POST "/content/$CID/archive")" 201 "CT-07i archive content -> 201"
ok "$(req POST "/content/$CID/activate")" 201 "CT-07j activate content -> 201"
ok "$(req 'GET' '/content?type=BOGUS')" 400 "CT-07k invalid type filter -> 400"

echo "== CT-08 questions: list validation + hard delete =="
req POST /questions -H 'Content-Type: application/json' \
  -d "{\"stem\":\"ct q $RAND\",\"questionType\":\"MCQ\",\"source\":\"MANUAL\",\"difficulty\":\"EASY\",\"topicId\":\"$TOPIC\",\"payload\":{\"choices\":[{\"id\":\"$MC_A\",\"text\":\"A\"},{\"id\":\"$MC_B\",\"text\":\"B\"}],\"correctChoiceId\":\"$MC_B\"}}" >/dev/null
Q1=$(jget id)
ok "$(req GET /questions)" 200 "CT-08a list questions -> 200"
ok "$(req 'GET' '/questions?questionType=BOGUS')" 400 "CT-08b invalid enum filter -> 400"
ok "$(req DELETE "/questions/$Q1")" 204 "CT-08c delete question -> 204"
ok "$(req GET "/questions/$Q1")" 404 "CT-08d deleted question -> 404"

echo "== CT-09 jobs: create + poll + roles + 404 =="
JAR="$CJ"
ok "$(req POST /jobs -H 'Content-Type: application/json' -d "{\"type\":\"MATERIAL_PROCESS\",\"payload\":{\"materialId\":\"$MAT\"}}")" 201 "CT-09a create job -> 201"
JID=$(jget id)
ok "$(req GET "/jobs/$JID")" 200 "CT-09b get job -> 200"
body_has 'MATERIAL_PROCESS' "CT-09c job type echoed"
ok "$(req GET "/jobs/00000000-0000-4000-8000-000000000000")" 404 "CT-09d unknown job -> 404"
JAR="$CJS"
ok "$(req GET "/jobs/$JID")" 403 "CT-09e student get job -> 403"

echo "== CT-10 logout exercise lives in CT-02 (scratch sessions); nothing here =="

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "API CONTRACT E2E: PASS=$PASS FAIL=0"
  echo "ALL PASS"
  exit 0
else
  echo "API CONTRACT E2E: PASS=$PASS FAIL=$FAIL"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi