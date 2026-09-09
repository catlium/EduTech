#!/usr/bin/env bash
# docker_readiness_e2e.sh — Phase 16 deployment-readiness verification for the
# dockerized stack (docker compose up from repo root).
# Verifies, in order:
#   1. All services are up (compose ps) and internal infra responds
#      (postgres pg_isready, redis PING, rabbitmq ping, ocr /health).
#   2. Public boundary: only api (3000) and web (3001) published host ports.
#   3. API /api/v1/health ok, web serves /login, CORS lets the web origin
#      call the API.
#   4. Auth works. If the demo seed is present it logs in as the seeded
#      teacher; otherwise it registers a fresh user and verifies the correct
#      tenant-state (subject create without a membership -> 403), deferring
#      the full content flow to the demo profile.
#   5. Seeded mode only: full representative flow — subject/chapter/topic,
#      text material READY, then a text/plain upload processed by the
#      dockerized worker-material (shared storage volume + OCR service) with
#      the content marker round-tripping end to end.
# Exits non-zero on any FAIL. Must be run from the repo root.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1
BASE="http://localhost:3000/api/v1"
WEB="http://localhost:3001"
BODY_FILE="/tmp/opencode/rd_body.tmp"
HDR_FILE="/tmp/opencode/rd_hdr.tmp"
JAR="/tmp/opencode/rd_jar.txt"
TMP="/tmp/opencode"
PASS=0
FAIL=0
FAILURES=()
SEEDED=0

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
  curl -s -b "$JAR" -c "$JAR" -X "$method" "$BASE$path" -o "$BODY_FILE" -w '%{http_code}' "$@"
}
req_i() { local method="$1" path="$2"; shift 2
  curl -s -b "$JAR" -c "$JAR" -X "$method" "$BASE$path" -o "$BODY_FILE" -w '%{http_code}' \
    -H "x-institute-id: 99999999-9999-9999-9999-999999999999" "$@"
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

echo "== RD-01 all services up =="
for svc in postgres redis rabbitmq api web ocr omniroute worker-ai worker-material; do
  if docker compose ps -q "$svc" 2>/dev/null | grep -q .; then
    PASS=$((PASS+1)); echo "  ok RD-01 $svc up"
  else
    FAIL=$((FAIL+1)); FAILURES+=("RD-01 $svc up"); echo "  FAIL RD-01 $svc not up"
  fi
done

echo "== RD-02 internal infra responsive =="
code=$(docker compose exec -T postgres pg_isready -U catlium -d catlium_dev >/dev/null 2>&1; echo $?)
ok "$code" 0 "RD-02a postgres accepts connections"
code=$(docker compose exec -T redis redis-cli ping 2>/dev/null | tr -d '\r')
ok "$code" "PONG" "RD-02b redis PING"
docker compose exec -T rabbitmq rabbitmq-diagnostics -q ping >/dev/null 2>&1
code=$?
ok "$code" 0 "RD-02c rabbitmq ping"
code=$(curl -s http://localhost:8000/health -o /dev/null -w '%{http_code}')
ok "$code" 200 "RD-02d ocr /health"

echo "== RD-03 public boundary: only api:3000 + web:3001 published =="
api_port=$(docker port catlium-api 3000 2>/dev/null || docker compose port api 3000 2>/dev/null)
web_port=$(docker port catlium-web 3001 2>/dev/null || docker compose port web 3001 2>/dev/null)
ok "$(printf '%s' "$api_port" | grep -c '0.0.0.0')" 1 "RD-03a api 3000 published on all interfaces"
ok "$(printf '%s' "$web_port" | grep -c '0.0.0.0')" 1 "RD-03b web 3001 published on all interfaces"
# Internal services may be published ONLY on loopback (dev override). Any
# non-loopback mapping of an internal port is a public-boundary violation.
viol=0
for pair in ocr:8000 omniroute:20128 postgres:5432 redis:6379 rabbitmq:5672; do
  svc="${pair%%:*}"; p="${pair##*:}"
  out=$(docker compose port "$svc" "$p" 2>/dev/null)
  if [ -n "$out" ] && ! printf '%s' "$out" | grep -q '127.0.0.1'; then viol=$((viol+1)); fi
done
ok "$viol" 0 "RD-03c internal ports only on loopback (or unpublished)"

echo "== RD-04 API + web + CORS =="
code=$(curl -s "$BASE/health" -o "$BODY_FILE" -w '%{http_code}')
ok "$code" 200 "RD-04a /api/v1/health -> 200"
body_has '"status":"ok"' "RD-04b health status ok"
code=$(curl -s -L "$WEB/login" -o /dev/null -w '%{http_code}')
ok "$code" 200 "RD-04c web /login -> 200"
curl -s -X OPTIONS "$BASE/auth/login" -H "Origin: $WEB" -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" -o /dev/null -D "$HDR_FILE" -w ''
acao=$(grep -i '^access-control-allow-origin:' "$HDR_FILE" | tr -d '\r' | sed 's/[Aa]ccess-[Cc]ontrol-[Aa]llow-[O]rigin: //')
ok "$acao" "$WEB" "RD-04d CORS allow-origin matches web origin"

echo "== RD-05 auth =="
rm -f "$JAR"
code=$(curl -s -c "$JAR" -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"teacher@catlium.dev","password":"Password123!"}' -o /dev/null -w '%{http_code}')
if [ "$code" = "200" ]; then
  SEEDED=1; PASS=$((PASS+1)); echo "  ok RD-05 seeded login works"
else
  echo "    seeded login rc=$code (unseeded base stack) — deferring full flow to demo profile"
  RAND="$(date +%s)"
  code=$(req POST /auth/register -H 'Content-Type: application/json' \
    -d "{\"name\":\"Readiness $RAND\",\"email\":\"rd_${RAND}@test.dev\",\"password\":\"Password123!\"}")
  ok "$code" 201 "RD-05a unseeded: register -> 201"
  ok "$(req GET /auth/me)" 200 "RD-05b unseeded: me -> 200"
  ok "$(req_i POST /academic/subjects -H 'Content-Type: application/json' \
    -d "{\"name\":\"RD $RAND\",\"slug\":\"rd-$RAND\"}")" 403 "RD-05c unseeded: no-membership subject create -> 403"
fi

if [ "$SEEDED" = "1" ]; then
  echo "== RD-06 representative flow (seeded) =="
  ok "$(req GET /auth/me)" 200 "RD-06a me -> 200"
  ok "$(req GET /memberships)" 200 "RD-06b memberships -> 200"
  body_has 'CatLium Demo Institute' "RD-06c demo institute listed"
  RAND="$(date +%s)"
  req_i POST /academic/subjects -H 'Content-Type: application/json' \
    -d "{\"name\":\"Readiness $RAND\",\"slug\":\"rd-$RAND\"}" >/dev/null
  SUBJ=$(pick_name "Readiness $RAND")
  req_i POST "/academic/subjects/$SUBJ/chapters" -H 'Content-Type: application/json' \
    -d '{"name":"RC1","slug":"rc1"}' >/dev/null
  CHID=$(pick_name RC1)
  req_i POST "/academic/chapters/$CHID/topics" -H 'Content-Type: application/json' \
    -d '{"name":"RT1","slug":"rt1"}' >/dev/null
  TOPIC=$(pick_name RT1)
  req_i POST /materials/text -H 'Content-Type: application/json' \
    -d "{\"title\":\"RD text $RAND\",\"text\":\"Interphase, prophase, metaphase.\",\"topicId\":\"$TOPIC\"}" >/dev/null
  MAT=$(jget id)
  ok "$(req_i GET "/materials/$MAT")" 200 "RD-06d text material -> 200"
  body_has 'READY' "RD-06e text material READY"

  echo "== RD-07 worker boundary (upload -> worker-material -> READY) =="
  MARKER="RD${RAND}-docker-marker"
  printf '%s\n' "$MARKER  Dockerized worker boundary notes." > "$TMP/rd_fixture.txt"
  code=$(curl -s -b "$JAR" -c "$JAR" -X POST "$BASE/materials/upload" \
    -H "x-institute-id: 99999999-9999-9999-9999-999999999999" \
    -F "file=@$TMP/rd_fixture.txt;type=text/plain" -F "title=RD upload $RAND" -F "topicId=$TOPIC" \
    -o "$BODY_FILE" -w '%{http_code}')
  ok "$code" 201 "RD-07a upload -> 201"
  UPL=$(jget id)
  ok "$(req_i POST "/materials/$UPL/process")" 202 "RD-07b process -> 202"
  JID=$(jget jobId)
  echo "    jobId=$JID waiting for dockerized worker-material..."
  DONE=""
  for _ in $(seq 1 120); do
    curl -s -b "$JAR" -X GET "$BASE/jobs/$JID" \
      -H "x-institute-id: 99999999-9999-9999-9999-999999999999" -o "$BODY_FILE" -w '' 2>/dev/null || true
    [ "$(jget status)" = "completed" ] && { DONE=1; break; }
    [ "$(jget status)" = "failed" ] && break
    sleep 2
  done
  ok "${DONE:-0}" 1 "RD-07c job completed"
  ok "$(req_i GET "/materials/$UPL")" 200 "RD-07d material after process -> 200"
  body_has 'READY' "RD-07e material READY"
  body_has "$MARKER" "RD-07f marker round-tripped through worker + storage"
  rm -f "$TMP/rd_fixture.txt"
else
  echo "== RD-06 deferred (run with docker-compose.demo.yml for seed + full flow) =="
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "DOCKER READINESS E2E: PASS=$PASS FAIL=0 (seeded=$SEEDED)"
  echo "ALL PASS"
  exit 0
else
  echo "DOCKER READINESS E2E: PASS=$PASS FAIL=$FAIL"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi