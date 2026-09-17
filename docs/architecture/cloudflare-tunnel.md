# Cloudflare Tunnel — Public Ingress for the CatLium Stack

The platform's public boundary is the **Cloudflare Tunnel** (`cloudflared`),
which is part of the single `docker-compose.yml`. All public traffic flows:
`Cloudflare edge -> cloudflared -> http://nginx:80 -> {web:3001 | api:3000}`.
Everything else — Postgres, Redis, RabbitMQ, OmniRoute, OCR, nginx, the API,
the web app and the workers — is **internal** on the private Docker network,
publishes no host port, and must NEVER be routable by a public hostname.

```bash
docker compose up -d --build   # production — nothing else, no override needed
```

## What the stack does

- A `tunnel` service runs the official `cloudflare/cloudflared` image in
  **remote-managed mode**: `tunnel --no-autoupdate run --token $TUNNEL_TOKEN`.
  The token carries the tunnel credentials and secret, so **no credential file
  is committed** — the token only ever lives in the operator's `.env`/secrets.
- An **nginx** service (`infrastructure/nginx/nginx.conf`) is the ONLY
  application-facing reverse proxy. `cloudflared` targets it at
  `http://nginx:80`; nginx splits traffic: `/api/*` → `api:3000`
  (full `/api/v1/...` path preserved) and `/` → `web:3001`. nginx forwards
  `X-Real-IP`/`X-Forwarded-For`/`X-Forwarded-Proto`, supports WebSocket/SSE
  upgrades, and answers `/health` directly. It binds only on the private
  network — it is never a host port and never public.
- **Nothing publishes a host port.** `api`, `web`, nginx, Postgres, Redis,
  RabbitMQ, OmniRoute, OCR and the workers are all internal. The `tunnel`
  service depends on nginx being healthy; nginx depends on `api`+`web` healthy,
  and resolves their (possibly recreated) addresses via Docker's embedded DNS.

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
   in the deployment's `.env` as `TUNNEL_TOKEN`. You do NOT need to install
   `cloudflared` locally — the compose service runs it.

2. **Add ONE public hostname → nginx** (single origin so cookies stay
   same-origin):

   Route `app.example.com/*` → `http://nginx:80`. That is the only route.
   nginx splits it internally: `/api/*` → `api:3000`, everything else →
   `web:3001`. The container name `nginx` resolves inside the compose network.

   Same-origin keeps every cookie (`access_token`, `refresh_token`,
   `csrf_token`) host-scoped or path-scoped to `/` and `/api/v1/auth` on that
   origin, same-site `lax` works, and the CSRF guard never sees a cross-origin
   request. **Do NOT** add any route that points at Postgres/Redis/RabbitMQ/
   OmniRoute/OCR/workers/nginx/api/web directly.

3. **Build the web bundle for the public origin.** `NEXT_PUBLIC_API_URL` is
   baked into the web image at build time (docker-compose.yml build arg). For a
   tunneled deployment build with:

   ```bash
   NEXT_PUBLIC_API_URL=https://app.example.com/api/v1 docker compose up -d --build
   ```

4. **Cookie/HTTPS posture** in the production `.env`:

   ```bash
   TUNNEL_TOKEN=eyJ...

   COOKIE_SECURE=true        # tunnel is HTTPS; Secure cookies
   COOKIE_SAMESITE=lax       # same-origin fetch via the tunnel
   COOKIE_DOMAIN=            # empty = host-only cookies for app.example.com
   CORS_ORIGIN=https://app.example.com
   ```

## Hostname / cookie details

- **Same-origin** is what makes cookie auth work end-to-end: the browser calls
  `https://app.example.com/api/v1/...`, and the API answers `Set-Cookie` for
  that host. The refresh cookie is path-scoped to `/api/v1/auth`, which nginx
  preserves because its `proxy_pass $api_upstream` forwards the full URI path.
- **WebSockets / streaming**: cloudflared and nginx both pass WebSocket
  upgrades and SSE-style long connections through natively; no config is
  needed. The current app uses HTTP polling, so nothing in the stack depends
  on WS today.
- **Forwarded headers**: nginx sets `X-Real-IP`, `X-Forwarded-For` and
  `X-Forwarded-Proto` on every proxied request. The app does not currently
  gate on them; the Secure cookie decision is already configured explicitly via
  `COOKIE_SECURE`, so behavior is deterministic without proxy trust.
- **Do not bypass auth**: the tunnel is a pure L4/L7 forwarder and nginx is a
  pure router. All existing guards (access-token JWT, CSRF, tenancy scope,
  internal `x-internal-api-key`) run unchanged inside the API/web containers.
  Cloudflare Access (Zero Trust policy) can additionally gate the public
  hostname if desired, but it is not required.

## Verify

```bash
docker compose config -q                     # valid single-file merge
docker compose ps                            # all healthy, incl. nginx + tunnel
docker compose config | grep -c published:   # 0 — no host ports anywhere

# Through nginx (proxy paths preserved):
docker compose exec nginx wget -qO- http://localhost/health         # 200 ok
docker compose exec nginx wget -qO- http://localhost/login          # 200 (web)
docker compose exec nginx wget -qO- -S http://localhost/api/v1/health  # 200 (API)
# Public smoke checks (through the tunnel):
curl -s https://app.example.com/login -o /dev/null -w '%{http_code}\n'          # 200 / 3xx
curl -s https://app.example.com/api/v1/health -o /dev/null -w '%{http_code}\n'  # 200
```

The `tunnel` container log should show the tunnel running and
`Registered tunnel connection` entries. Internal services stay reachable only
over the private network; a `docker compose port`/nmap check on the host
should show no published ports at all — `published:` appears zero times in the
resolved config.