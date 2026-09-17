# Standalone OCR Worker — Run on Another Device

The distributed OCR worker is a **computationally standalone workload**: it
polls the NestJS API, claims OCR chunk tasks, OCRs the bytes, and submits the
result. It never touches PostgreSQL, Redis, RabbitMQ, or OmniRoute, and it
needs **no inbound ports**. Any machine with just Docker (and outbound HTTPS
to the main deployment) can run it — a classroom PC, a beefier lab box, etc.

Design details live in [ocr-distributed-workers.md](ocr-distributed-workers.md)
(§6 identity/credentials, §7 API boundary, §10 packaging). This page is the
ops manual: build → export → run → verify.

---

## 1. What the image contains

`infrastructure/compose/Dockerfile.ocr-worker` builds the worker from:

- `apps/ocr` → the OCR engine library (`ocr_engine.*`: PyMuPDF page
  extraction, PaddleOCR, image preprocessing, normalizer).
- `apps/workers/ocr-worker` → the pull client (`ocr_worker.app:run` heartbeat
  → claim → source → process → submit loop).

All third-party deps (paddlepaddle ~200 MB, OpenCV, paddleocr) come pinned from
`infrastructure/compose/requirements.lock`, so builds are reproducible and the
heavy layer is cached. The entrypoint is the `ocr-worker` console script.
PaddleOCR downloads its models on first use into `/root/.paddlex` — keep that
path on a volume so model downloads survive restarts.

## 2. Build the image

Pick a release tag and build once (only the first build downloads Paddle):

```bash
docker build \
  -f infrastructure/compose/Dockerfile.ocr-worker \
  -t catlium-ocr-worker:1.0.0 .
# or via compose (same tags the stack uses):
docker compose -f docker-compose.yml -f docker-compose.prod.yml build ocr-worker
```

## 3. Get the image onto the other device

### Option A — local registry (recommended for fleets)

```bash
# host of the private registry (or any registry the device can pull from)
docker tag catlium-ocr-worker:1.0.0 registry.example.com/catlium/ocr-worker:1.0.0
docker push registry.example.com/catlium/ocr-worker:1.0.0
# on the device
docker pull registry.example.com/catlium/ocr-worker:1.0.0
```

### Option B — registry-integrated into the main stack

`docker-compose.prod.yml` tags every image `${IMAGE_PREFIX:-catlium}/…`; build
the whole stack once and `docker compose push`, then `docker compose pull` on
the device just for the worker:

```bash
# main repo host:
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml push

# device: pull only the worker
docker pull catlium/ocr-worker:${VERSION:-latest}
```

### Option C — air-gapped / single device transfer (docker save)

```bash
docker save catlium-ocr-worker:1.0.0 | gzip > ocr-worker-1.0.0.tar.gz
# copy the tarball to the device (USB/scp), then
gunzip -c ocr-worker-1.0.0.tar.gz | docker load
```

> PaddleOCR model files are NOT inside the image. On first run the worker
> downloads them (once) into `/root/.paddlex`. On an offline device, pre-seed
> that directory: run the worker once on an online machine, `docker cp` the
> populated volume out, and mount it on the device — or copy the directory to
> the device and run with
> `-v /path/to/paddlex:/root/.paddlex`.

## 4. Register the worker (one-time)

The device worker authenticates with a per-worker `workerId` + `apiKey`
issued by the API. Create it once (admin UI on Worker/OCR devices, or):

```bash
curl -X POST https://<host>/api/v1/ocr/workers \
  -H 'authorization: Bearer <teacher access token>' \
  -H 'content-type: application/json' \
  -H 'x-institute-id: <institute>' \
  -d '{"name":"lab-pc-01","version":"ocr-worker:1.0.0"}'
# → { workerId, apiKey }  — apiKey is shown ONLY this once. Store it in
#   a secret manager; pasting it into docker run/.env is acceptable for a
#   single-device pilot.
```

## 5. Run on the device

Required env (the only three a device needs):

| Var | Meaning |
| --- | --- |
| `WORKER_OCR_SERVER_URL` | API base incl. the `/api/v1` prefix, e.g. `https://mainstack.example.com/api/v1` |
| `WORKER_OCR_WORKER_ID` | uuid from step 4 |
| `WORKER_OCR_API_KEY` | `owr_…` key from step 4 (issued once) |

Optional tuning (see `apps/workers/ocr-worker/ocr_worker/config.py`):

| Var | Default | Meaning |
| --- | --- | --- |
| `WORKER_OCR_IDLE_POLL_SECONDS` | `2.0` | poll cadence when no work |
| `WORKER_OCR_HEARTBEAT_INTERVAL_SECONDS` | `10.0` | lease-renew ping (coordinator lease default 300 s) |
| `WORKER_OCR_CONNECT_TIMEOUT_SECONDS` | `10.0` | HTTP connect bound |
| `WORKER_OCR_READ_TIMEOUT_SECONDS` | `600.0` | generous read bound (source download / submit ride the same call) |
| `WORKER_OCR_CLAIM_RETRY_BACKOFF_SECONDS` | `2.0` | backoff on transient claim errors |

```bash
docker run -d --name ocr-worker-lab \
  --restart unless-stopped \
  -e WORKER_OCR_SERVER_URL=https://mainstack.example.com/api/v1 \
  -e WORKER_OCR_WORKER_ID=<uuid> \
  -e WORKER_OCR_API_KEY=<owr_...> \
  -v ocr_paddle_models:/root/.paddlex \
  catlium-ocr-worker:1.0.0
```

No `-p` port flag is needed — the worker only makes **outbound** HTTPS calls.

Or as a one-off on an online host keep it simple:

```bash
docker run --rm \
  -e WORKER_OCR_SERVER_URL=https://mainstack.example.com/api/v1 \
  -e WORKER_OCR_WORKER_ID=<uuid> \
  -e WORKER_OCR_API_KEY=<owr_...> \
  catlium-ocr-worker:1.0.0
```

## 6. Verify it works

1. **Process up**: `docker logs -f ocr-worker-lab` — the worker starts with a
   heartbeat line naming its id; poll attempts follow.
2. **Registered/heartbeating**: check the API
   `GET /api/v1/ocr/workers` (or the devices admin UI) shows the worker with a
   fresh `last_heartbeat`.
3. **Processes a real chunk**: upload a PDF through a material that gets OCR'd;
   the worker goes `claim → source → process → submit`, the chunk transitions
   to `processing → completed`, and the merged OCR text surfaces in the
   material.

## 7. Network requirements (useful for firewalled labs)

- **Outbound** HTTPS/TLS to the API host:port only (`WORKER_OCR_SERVER_URL`).
- No inbound ports, no LAN-neighbor access to any other component needed.
- If the device must run fully offline against an on-prem stack, point
  `WORKER_OCR_SERVER_URL` at the internal API and give the device the tarball
  + paddle models from §3-C.

## 8. Scaling / multiple devices

Spin up one `docker run` per machine — no coordination needed; the API's
coordinator assigns chunks and lease-expiry reclaims work from dead workers.
Each worker needs its **own** `workerId`/`apiKey` from step 4.

## 9. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Exits at boot, "worker_id/api_key" | missing/empty `WORKER_OCR_WORKER_ID` or `WORKER_OCR_API_KEY` (compose `:-` passes `''`) |
| 401 in logs | API key revoked or belongs to another worker/institute — re-register |
| `Model not found` on first chunk | paddle models missing (offline) — pre-seed `/root/.paddlex` per §3-C |
| Chunks stuck `processing` | worker died mid-chunk; the API coordinator reclaims after the lease window (`WORKER_OCR_LEASE_SECONDS`, default 300 s — a server-side env, not a worker env) |
| SSL errors | `WORKER_OCR_SERVER_URL` must be https with a valid cert, or the device trusts the corporate CA |