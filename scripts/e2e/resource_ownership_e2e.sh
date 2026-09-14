#!/usr/bin/env bash
# resource_ownership_e2e.sh — Phase 31: Topic-owned resources, parallel AI,
# job monitor, note quality. Runs against the DEPLOYED stack (api + worker-ai
# + OmniRoute real AI). Complements syllabus_e2e.sh (SYL-01..11 + E1-E3).
#
# Covers (H1 ownership) no topic-less resources, no duplicates per topic,
# material-shortcut equals topic generation; (H2 parallel) 5-type batch on one
# topic, concurrent processing seen, shared batchId, immediate-dedup, retry
# after cancel; (H3 job monitor) list filters status/type/batchId, pagination,
# label resolution, retry endpoint; (H4 note quality) generated note is
# pedagogical (multiple blocks/types), summary stays concise, schema valid.

set -u
BASE="http://localhost:3000/api/v1"
CJ="/tmp/opencode/p31_cj.txt"
BODY_FILE="/tmp/opencode/p31_body.tmp"
PASS=0
FAIL=0
FAILURES=()

DEMO="99999999-9999-9999-9999-999999999999"
RAND="$(date +%s)"

ok() { # ok <value> <expected> <label>
  if [ "$1" = "$2" ]; then PASS=$((PASS+1)); echo "  ok $3";
  else FAIL=$((FAIL+1)); FAILURES+=("$3: expected '$2' got '$1'"); echo "  FAIL $3 (got '$1', want '$2')"; fi
}
body_has() { # body_has <substring> <label>
  if grep -qF "$1" "$BODY_FILE"; then PASS=$((PASS+1));
  else FAIL=$((FAIL+1)); FAILURES+=("$2: missing '$1' in body"); echo "  FAIL $2 (missing '$1')"; fi
}
req() { # req <method> <path> [curl args...]
  local method="$1" path="$2"; shift 2
  curl -s -b "$CJ" -X "$method" "$BASE$path" "$@" -o "$BODY_FILE" -w '%{http_code}'
}
jval() { # jval <json|-> <field> — field from last req body or stdin
  local src="$1" field="$2"
  if [ "$src" = "-" ]; then python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('$field',''))" 2>/dev/null
  else echo "$src" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('$field',''))" 2>/dev/null; fi
}
login_user() { # login_user <email>
  local email="$1" code
  code=$(curl -s -c "$CJ" -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"Password123!\"}" -o "$BODY_FILE" -w '%{http_code}')
  ok "$code" 200 "login $email"
}
# poll_batch <batchId> <timeout-s> — echoes "completed failed active"
poll_batch() {
  local bid="$1" timeout_s="$2" started now out
  started=$(date +%s)
  while true; do
    req GET "/content/generation-batches/$bid" -H "x-institute-id: $DEMO" >/dev/null
    out=$(python3 -c "import json;b=json.load(open('$BODY_FILE'))['batch'];print(b['completed'],b['failed'],b['active'])")
    if [ "$(echo "$out" | cut -d' ' -f3)" = "0" ]; then echo "$out"; return 0; fi
    now=$(date +%s)
    if [ $((now - started)) -gt "$timeout_s" ]; then echo "timeout"; return 1; fi
    sleep 3
  done
}

echo "== P31 fixtures: login + test subject/topics/materials =="
login_user "teacher@catlium.dev"

CS=$(req POST /academic/subjects -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"name\":\"P31 Math $RAND\",\"slug\":\"p31-$RAND\"}")
ok "$CS" 201 "P31 create subject 201"
SUBJ=$(python3 -c "import json;print(json.load(open('$BODY_FILE'))['subject']['id'])" 2>/dev/null)
echo "  subject=$SUBJ"

CH1=$(req POST "/academic/subjects/$SUBJ/chapters" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"name\":\"Chapter One $RAND\",\"slug\":\"p31-ch1-$RAND\"}")
ok "$CH1" 201 "P31 create chapter 201"
C1=$(python3 -c "import json;print(json.load(open('$BODY_FILE'))['chapter']['id'])" 2>/dev/null)

CH2=$(req POST "/academic/subjects/$SUBJ/chapters" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"name\":\"Chapter Two $RAND\",\"slug\":\"p31-ch2-$RAND\"}")
C2=$(python3 -c "import json;print(json.load(open('$BODY_FILE'))['chapter']['id'])" 2>/dev/null)

T1=$(req POST "/academic/chapters/$C1/topics" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"name\":\"P31 Topic A $RAND\",\"slug\":\"p31-ta-$RAND\"}")
ok "$T1" 201 "P31 create topic A 201"
T1ID=$(python3 -c "import json;print(json.load(open('$BODY_FILE'))['topic']['id'])" 2>/dev/null)
T2=$(req POST "/academic/chapters/$C2/topics" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"name\":\"P31 Topic B $RAND\",\"slug\":\"p31-tb-$RAND\"}")
ok "$T2" 201 "P31 create topic B 201"
T2ID=$(python3 -c "import json;print(json.load(open('$BODY_FILE'))['topic']['id'])" 2>/dev/null)

TEXT_A="Number theory studies the integers and their properties. Divisibility, prime numbers, and modular arithmetic are its foundations. The Fundamental Theorem of Arithmetic states that every integer greater than one can be written uniquely as a product of primes. Euclidean division formalizes division with remainder. Prime numbers are the multiplicative building blocks of the natural numbers, and their distribution is studied through theorems and conjectures such as the Prime Number Theorem."
TEXT_B="Set theory is the mathematical theory of well-defined collections of objects. A set can be defined by listing its elements or by a property that its members satisfy. Operations on sets include union, intersection, and difference. The empty set contains no elements and is a subset of every set. Subsets, power sets, and cardinality let us compare the sizes of infinite collections."

M1=$(req POST /materials/text -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"title\":\"P31 Number Theory $RAND\",\"topicId\":\"$T1ID\",\"text\":\"$TEXT_A\"}")
ok "$M1" 201 "P31 TEXT material A 201"
M1ID=$(python3 -c "import json;print(json.load(open('$BODY_FILE'))['material']['id'])" 2>/dev/null)

M2=$(req POST /materials/text -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"title\":\"P31 Set Theory $RAND\",\"topicId\":\"$T2ID\",\"text\":\"$TEXT_B\"}")
ok "$M2" 201 "P31 TEXT material B 201"

echo "== P31-OWN-01 topic-less MATERIAL generation rejected (B3) =="
M0=$(req POST /materials/text -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"title\":\"P31 Unscoped $RAND\",\"subjectId\":\"$SUBJ\",\"text\":\"unscoped legacy text lane\"}")
ok "$M0" 201 "P31 topic-less material 201"
M0ID=$(python3 -c "import json;print(json.load(open('$BODY_FILE'))['material']['id'])" 2>/dev/null)
GU=$(req POST /content/generate-batch -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"sourceType\":\"MATERIAL\",\"sourceId\":\"$M0ID\",\"types\":[\"NOTE\"]}")
ok "$GU" 409 "OWN-01 topic-less material batch -> 409"
GU2=$(req POST /content/generate -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"operation\":\"AI_GENERATE_NOTE\",\"sourceType\":\"MATERIAL\",\"sourceId\":\"$M0ID\"}")
ok "$GU2" 409 "OWN-01 topic-less single generate -> 409"

echo "== P31-OWN-02 TOPIC batch -> all content Topic-owned, no duplicates =="
B1=$(req POST /content/generate-batch -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"sourceType\":\"TOPIC\",\"sourceId\":\"$T1ID\",\"types\":[\"NOTE\",\"SUMMARY\",\"FLASHCARD_SET\",\"IMPORTANT_CONCEPTS\",\"CORNELL_NOTE\"]}")
ok "$B1" 202 "OWN-02 topic batch 202"
B1ID=$(python3 -c "import json;print(json.load(open('$BODY_FILE'))['batch']['batchId'])")
N5=$(python3 -c "import json;print(len(json.load(open('$BODY_FILE'))['batch']['jobIds']))")
ok "$N5" "5" "OWN-02 batch created 5 jobs"
ST=$(poll_batch "$B1ID" 300)
ok "$(echo "$ST" | cut -d' ' -f1)" "5" "OWN-02 all 5 completed"
ok "$(echo "$ST" | cut -d' ' -f2)" "0" "OWN-02 0 failed"

req GET "/content?topicId=$T1ID" -H "x-institute-id: $DEMO" >/dev/null
RL=$(python3 -c "
import json
items=json.load(open('$BODY_FILE'))['contents']
print(len(items), all(i['topicId']==items[0]['topicId'] for i in items), sorted(set(i['type'] for i in items)))
")
ok "$(echo "$RL" | cut -d' ' -f1)" "5" "OWN-02 exactly 5 contents under topic"
ok "$(echo "$RL" | cut -d' ' -f2)" "True" "OWN-02 every item topic-scoped"
NOTE_ID=$(python3 -c "
import json
items=json.load(open('$BODY_FILE'))['contents']
print(next((i['id'] for i in items if i['type']=='NOTE'),''))
")

echo "== P31-OWN-03 material shortcut == topic generation (10) + no dup (9) =="
B2=$(req POST /content/generate-batch -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"sourceType\":\"MATERIAL\",\"sourceId\":\"$M1ID\",\"types\":[\"NOTE\"]}")
ok "$B2" 202 "OWN-03 material shortcut batch 202"
B2ID=$(python3 -c "import json;print(json.load(open('$BODY_FILE'))['batch']['batchId'])")
ST=$(poll_batch "$B2ID" 120)
ok "$(echo "$ST" | cut -d' ' -f1)" "1" "OWN-03 shortcut job completed"

req GET "/content?topicId=$T1ID" -H "x-institute-id: $DEMO" >/dev/null
NOTE_VER=$(python3 -c "
import json
items=json.load(open('$BODY_FILE'))['contents']
notes=[i for i in items if i['type']=='NOTE']
print(len(notes), notes[0]['id'] if notes else '', notes[0]['currentVersion'] if notes else '')
")
ok "$(echo "$NOTE_VER" | cut -d' ' -f1)" "1" "OWN-03 still exactly one NOTE per topic"
ok "$(echo "$NOTE_VER" | cut -d' ' -f2)" "$NOTE_ID" "OWN-03 material shortcut bumped SAME item (id preserved)"
V3=$(echo "$NOTE_VER" | cut -d' ' -f3)
if [ "${V3:-0}" -ge 2 ]; then NU=1; else NU=0; fi
ok "$NU" "1" "OWN-03 NOTE regenerated in place (version >= 2)"

echo "== P31-NOTE-23/25 note quality: pedagogical depth + schema =="
NID=$(python3 -c "
import json
items=json.load(open('$BODY_FILE'))['contents']
print(next((i['id'] for i in items if i['type']=='NOTE'),''))
")
req GET "/content/$NID" -H "x-institute-id: $DEMO" >/dev/null
NQ=$(python3 -c "
import json
cur=json.load(open('$BODY_FILE'))['content']['current']
payload=cur['payload']
blocks=payload.get('blocks',[])
types=sorted({b.get('type') for b in blocks})
print(len(blocks), len(types), all(b.get('id') and b.get('type') for b in blocks))
")
ok "$(python3 -c "x='''$NQ'''.split();print(1 if int(x[0])>=3 else 0)")" "1" "NOTE-23 generated note >= 3 blocks (depth)"
ok "$(python3 -c "x='''$NQ'''.split();print(1 if int(x[1])>=3 else 0)")" "1" "NOTE-23 >= 3 distinct block types"
ok "$(python3 -c "x='''$NQ'''.split();print(x[2])")" "True" "NOTE-25 every block has id + type (schema)"
NXT=$(python3 -c "
import json
cur=json.load(open('$BODY_FILE'))['content']['current']
blocks=cur['payload'].get('blocks',[])
print(sum(len(str(b.get('content',''))) + sum(len(str(i)) for i in b.get('items',[])) + sum(len(str(r)) for r in b.get('rows',[])) for b in blocks))
" 2>/dev/null)
echo "  note text length ~ ${NXT:-0} chars"

echo "== P31-NOTE-24 summary stays concise =="
req GET "/content?topicId=$T1ID" -H "x-institute-id: $DEMO" >/dev/null
SID=$(python3 -c "
import json
items=json.load(open('$BODY_FILE'))['contents']
print(next((i['id'] for i in items if i['type']=='SUMMARY'),''))
")
req GET "/content/$SID" -H "x-institute-id: $DEMO" >/dev/null
SC=$(python3 -c "
import json
payload=json.load(open('$BODY_FILE'))['content']['current']['payload']
keys=payload.get('keyConcepts',[])
summ=payload.get('summary','')
print(len(keys), len(summ))
")
ok "$(python3 -c "x='''$SC'''.split();print(1 if int(x[0])>=1 else 0)")" "1" "NOTE-24 summary has keyConcepts"
export P31_NXT="${NXT:-0}"
ok "$(python3 -c "
import os
sc='''$SC'''.split(); nxt=int(os.environ.get('P31_NXT','0'))
print(1 if nxt>0 and int(sc[1]) < nxt else 0)
")" "1" "NOTE-24 summary shorter than the study note (concise)"

echo "== P31-PAR-11/15 parallel batch + immediate dedup on same batch =="
B3=$(req POST /content/generate-batch -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"sourceType\":\"TOPIC\",\"sourceId\":\"$T2ID\",\"types\":[\"NOTE\",\"SUMMARY\",\"FLASHCARD_SET\",\"IMPORTANT_CONCEPTS\",\"CORNELL_NOTE\"]}")
ok "$B3" 202 "PAR-11 batch B 202"
B3ID=$(python3 -c "import json;print(json.load(open('$BODY_FILE'))['batch']['batchId'])")
B3IDS=$(python3 -c "import json;print(json.dumps(json.load(open('$BODY_FILE'))['batch']['jobIds']))")

B4=$(req POST /content/generate-batch -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"sourceType\":\"TOPIC\",\"sourceId\":\"$T2ID\",\"types\":[\"NOTE\",\"SUMMARY\",\"FLASHCARD_SET\",\"IMPORTANT_CONCEPTS\",\"CORNELL_NOTE\"]}")
ok "$B4" 202 "PAR-15 immediate re-batch 202"
DJ=$(python3 -c "import json;d=json.load(open('$BODY_FILE'))['batch'];print(len(d['jobIds']), len(d['alreadyActive']))")
ok "$(echo "$DJ" | cut -d' ' -f1)" "0" "PAR-15 dedup: no new jobs for active batch"
ok "$(echo "$DJ" | cut -d' ' -f2)" "5" "PAR-15 dedup: all 5 already active"

echo "== P31-PAR-14/13 concurrent processing + shared batchId =="
MAXCONC=0
started=$(date +%s)
while true; do
  req GET "/jobs?batchId=$B3ID" -H "x-institute-id: $DEMO" >/dev/null
  CUR=$(python3 -c "
import json
d=json.load(open('$BODY_FILE'))
jobs=[j for j in d['jobs'] if j.get('batchId')=='$B3ID']
print(sum(1 for j in jobs if j['status']=='processing'))
" 2>/dev/null)
  if [ "${CUR:-0}" -gt "$MAXCONC" ]; then MAXCONC=$CUR; fi
  ACT=$(python3 -c "
import json
d=json.load(open('$BODY_FILE'))
jobs=[j for j in d['jobs'] if j.get('batchId')=='$B3ID']
print(sum(1 for j in jobs if j['status'] in ('queued','processing','cancelling')))
" 2>/dev/null)
  if [ "${ACT:-1}" = "0" ]; then break; fi
  now=$(date +%s)
  if [ $((now - started)) -gt 300 ]; then echo "  PAR-14 monitor timeout"; break; fi
  sleep 2
done
ok "$MAXCONC" "2" "PAR-14 >= 2 jobs processing concurrently (concurrency honoured)"
req GET "/jobs?batchId=$B3ID" -H "x-institute-id: $DEMO" >/dev/null
SHARED=$(python3 -c "
import json
jobs=json.load(open('$BODY_FILE'))['jobs']
print(len(jobs), len(set(j.get('batchId') for j in jobs)) if jobs else 0, all(j['status']=='completed' for j in jobs))
")
ok "$(echo "$SHARED" | cut -d' ' -f1)" "5" "PAR-12 all 5 jobs under batch"
ok "$(echo "$SHARED" | cut -d' ' -f2)" "1" "PAR-13 single shared batchId"
ok "$(echo "$SHARED" | cut -d' ' -f3)" "True" "PAR-12 all completed successfully"
ST=$(poll_batch "$B3ID" 60)
ok "$(echo "$ST" | cut -d' ' -f1)" "5" "PAR-12 batch reports 5 completed"
ok "$(echo "$ST" | cut -d' ' -f2)" "0" "PAR-12 batch 0 failed"

echo "== P31-PAR-16 cancel -> retry re-enqueues (H3-22 retry semantics) =="
B5=$(req POST /content/generate-batch -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" \
  -d "{\"sourceType\":\"TOPIC\",\"sourceId\":\"$T2ID\",\"types\":[\"IMPORTANT_CONCEPTS\"]}")
ok "$B5" 202 "PAR-16 concepts batch 202"
JOB=$(python3 -c "import json;print(json.load(open('$BODY_FILE'))['batch']['jobIds'][0])")
CC=$(req POST "/jobs/$JOB/cancel" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{}')
ok "$CC" 200 "PAR-16 cancel queued job 200"
sleep 2
req GET "/jobs/$JOB" -H "x-institute-id: $DEMO" >/dev/null
ok "$(python3 -c "import json;print(json.load(open('$BODY_FILE'))['job']['status'])")" "cancelled" "PAR-16 job reaches cancelled"
RC=$(req POST "/jobs/$JOB/retry" -H 'Content-Type: application/json' -H "x-institute-id: $DEMO" -d '{}')
ok "$RC" 200 "PAR-16 retry cancelled job 200"
req GET "/jobs/$JOB" -H "x-institute-id: $DEMO" >/dev/null
ok "$(python3 -c "import json;print(json.load(open('$BODY_FILE'))['job']['status'])")" "queued" "PAR-16 retry re-enqueued to queued"
started=$(date +%s)
while true; do
  req GET "/jobs/$JOB" -H "x-institute-id: $DEMO" >/dev/null
  S=$(python3 -c "import json;print(json.load(open('$BODY_FILE'))['job']['status'])")
  if [ "$S" = "completed" ] || [ "$S" = "failed" ]; then break; fi
  now=$(date +%s)
  if [ $((now - started)) -gt 120 ]; then break; fi
  sleep 3
done
ok "$S" "completed" "PAR-16 retried job completes"

echo "== P31-MON-17/18/20 status + type filters, pagination =="
req GET "/jobs?status=completed&batchId=$B3ID" -H "x-institute-id: $DEMO" >/dev/null
FOK=$(python3 -c "
import json
jobs=json.load(open('$BODY_FILE'))['jobs']
print(len(jobs), all(j['status']=='completed' for j in jobs))
")
ok "$(echo "$FOK" | cut -d' ' -f1)" "5" "MON-17 status filter returns the 5 completed"
ok "$(echo "$FOK" | cut -d' ' -f2)" "True" "MON-17 all rows are completed"
req GET "/jobs?type=AI_GENERATE_NOTE&batchId=$B3ID" -H "x-institute-id: $DEMO" >/dev/null
ok "$(python3 -c "
import json
jobs=json.load(open('$BODY_FILE'))['jobs']
print(len(jobs), all(j['type']=='AI_GENERATE_NOTE' for j in jobs))
")" "1 True" "MON-18 type filter -> only NOTE jobs"

req GET "/jobs?batchId=$B3ID&limit=2&offset=0" -H "x-institute-id: $DEMO" >/dev/null
PG1=$(python3 -c "import json;print(' '.join(j['id'] for j in json.load(open('$BODY_FILE'))['jobs']), json.load(open('$BODY_FILE'))['total'])")
req GET "/jobs?batchId=$B3ID&limit=2&offset=2" -H "x-institute-id: $DEMO" >/dev/null
PG2=$(python3 -c "import json;print(' '.join(j['id'] for j in json.load(open('$BODY_FILE'))['jobs']))")
ok "$(echo "$PG1" | wc -w)" "3" "MON-20 page 1: 2 ids + total"
PG1IDS=$(echo "$PG1" | awk '{for(i=1;i<NF;i++)printf "%s ",$i}')
PG2IDS=$PG2
DISJOINT=$(python3 -c "
import sys
p1='''$PG1IDS'''.split(); p2='''$PG2IDS'''.split()
print('yes' if len(p1)==2 and len(p2)==2 and not (set(p1) & set(p2)) else 'no')
")
ok "$DISJOINT" "yes" "MON-20 offset pages are disjoint"
ok "$(echo "$PG1" | awk '{print $NF}')" "5" "MON-20 total reported 5"

echo "== P31-MON-21 label resolution =="
req GET "/jobs?batchId=$B3ID" -H "x-institute-id: $DEMO" >/dev/null
LAB=$(python3 -c "
import json
d=json.load(open('$BODY_FILE'))
print(d['labels'].get('TOPIC',{}).get('$T2ID','missing'))
" 2>/dev/null)
ok "$LAB" "P31 Topic B $RAND" "MON-21 topic label resolved"
req GET "/jobs?status=queued&limit=5" -H "x-institute-id: $DEMO" >/dev/null
QOK=$(python3 -c "
import json
jobs=json.load(open('$BODY_FILE'))['jobs']
print('yes' if all(j['status']=='queued' for j in jobs) else 'no')
")
ok "$QOK" "yes" "MON-19 (status=queued) filter consistent"

echo ""
echo "=========================================="
echo "RESULT: PASS=$PASS FAIL=$FAIL"
echo "=========================================="
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
exit 0