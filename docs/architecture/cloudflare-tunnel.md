# Cloudflare Tunnel — Public Ingress for the CatLium Stack

The platform's public boundary is `apps/web` (Next.js, `:3001`) and the NestJS
API (`apps/api`, `/api/v1`). Everything else — Postgres, Redis, RabbitMQ,
OmniRoute, OCR, and the workers — is internal on the private Docker network
and must NEVER be routable by a public hostname.

`docker-compose.tunnel.yml` makes a **Cloudflare Tunnel** the only public
entry point:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
               -f docker-compose.tunnel.yml up -d --build
```

## What the override does

- Adds a `tunnel` service running the official `cloudflare/cloudflared` image
  in **remote-managed mode**: `tunnel --no-autoupdate run --token $TUNNEL_TOKEN`.
  The token carries the tunnel credentials and secret, so **no credential file
  is committed** — the token only ever lives in the operator's `.env`/secrets.
- Sets `ports: []` on `api` and `web`, so their host port publishes disappear
  and the tunnel is the *only* public route. Base+prod already publish no ports
  for the internal services; the tunnel override does not add any.
- Runs only after `api` and `web` report healthy, and uses the prod restart /
  log-rotation posture.

Trade-off (accepted): remote-managed ingress rules are configured in the
Cloudflare dashboard, not in this repo. If you need the ingress rules in
version control instead, keep the same `tunnel` service but run cloudflared
with `--config /etc/cloudflared/config.yml` (locally-managed tunnel: sets
`TUNNEL_ID`, mounts the tunnel credentials JSON as a secret file, and defines
the same two `ingress:` routes below). The token mode is the default because
it keeps secrets out of the repo entirely.

## One-time Cloudflare setup

1. **Create the tunnel** (tunnel token):

   Cloudflare Dashboard → Zero Trust → Networks → Tunnels → **Create a tunnel**.
   Choose a tunnel name (e.g. `edutech`), copy the generated token, and put it
   in the deployment's secrets as `TUNNEL_TOKEN`. You do NOT need to install
   `cloudflared` locally — the compose service runs it.

2. **Add the public hostname routes** (must be on ONE domain so cookies stay
   same-origin):

   | Route (source)          | Service        | Purpose            |
   | ----------------------- | -------------- | ------------------ |
   | `app.example.com/*`     | `http://web:3001`   | Next.js app (HTML/JS, `/login`, workspaces) |
   | `app.example.com/api/*` | `http://api:3000`   | NestJS API (`/api/v1/...`)            |

   Same-host path routing keeps the browser on one origin: every cookie
   (`access_token`, `refresh_token`, `csrf_token`) is host-scoped or path-scoped
   to `/` and `/api/v1/auth` on that origin, same-site `lax` works, and the
   CSRF guard never sees a cross-origin request. **Do NOT** add any route that
   points at Postgres/Redis/RabbitMQ/OmniRoute/OCR/workers.

   > If your Cloudflare plan/dashboard does not offer path routing on one
   > hostname, the deterministic fallback is a locally-managed tunnel with an
   > `ingress:` block mirroring the table above (see the locally-managed note).

3. **Build the web bundle for the public origin.** `NEXT_PUBLIC_API_URL` is
   baked into the web image at build time (docker-compose.yml build arg). For a
   tunneled deployment build with:

   ```bash
   NEXT_PUBLIC_API_URL=https://app.example.com/api/v1 \
   docker compose -f docker-compose.yml -f docker-compose.prod.yml \
                  -f docker-compose.tunnel.yml up -d --build
   ```

4. **Cookie/HTTPS posture** in the production `.env`:

   ```bash
   COOKIE_SECURE=true        # tunnel is HTTPS; Secure cookies
   COOKIE_SAMESITE=lax       # same-origin fetch via the tunnel
   COOKIE_DOMAIN=            # empty = host-only cookies for app.example.com
   CORS_ORIGIN=https://app.example.com
   ```

## Hostname / cookie details

- **Same-origin** is what makes cookie auth work end-to-end: the browser calls
  `https://app.example.com/api/v1/...`, and the API answers `Set-Cookie` for
  that host. The refresh cookie is path-scoped to `/api/v1/auth`, which the
  tunnel preserves because the `/api/*` route forwards the full URI path.
- **WebSockets / streaming**: cloudflared passes WebSocket upgrades and
  SSE-style long connections through natively; no config is needed. The
  current app uses HTTP polling, so nothing in the stack depends on WS today.
- **Forwarded headers**: `cloudflared` sends `X-Forwarded-For` /
  `X-Forwarded-Proto` to the origin. The app does not currently gate on them;
  if you ever need origin-restore (NestJS `trust proxy` / `secure` cookie
  issuance based on the forwarded scheme), set the proxy trust accordingly —
  the Secure cookie decision is already configured explicitly via
  `COOKIE_SECURE`, so behavior is deterministic without it.
- **Do not bypass auth**: the tunnel is a pure L4/L7 forwarder. All existing
  guards (access-token JWT, CSRF, tenancy scope, internal `x-internal-api-key`)
  run unchanged inside the API/web containers. The tunnel adds no auth of its
  own; Cloudflare Access (Zero Trust policy) can additionally gate the public
  hostname if desired, but it is not required.

## Verify

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
               -f docker-compose.tunnel.yml config -q   # valid merge
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
               -f docker-compose.tunnel.yml ps           # all healthy, incl. tunnel

# Public smoke checks (through the tunnel):
curl -s https://app.example.com/login -o /dev/null -w '%{http_code}\n'          # 200 / 3xx
curl -s https://app.example.com/api/v1/health -o /dev/null -w '%{http_code}\n'  # 200
```

The `tunnel` container log should show the tunnel running and
`Registered tunnel connection` entries. Internal services stay reachable only
over the private network; a `docker compose port`/nmap check on the host
should show no published ports for postgres/rabbitmq/redis/ocr/omniroute and
none for api/web either (the override removed them).