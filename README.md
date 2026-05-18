# MeshCore WebUI

Self-hostable web client for [MeshCore](https://meshcore.dev) LoRa mesh radio devices over WiFi/TCP. Companion to your MeshCore-compatible companion radio (T3-S3, Heltec V3, RAK, etc.) with first-class iOS PWA push notifications.

- Self-hostable single Docker container — backend + built frontend in one image
- iOS / Android / desktop Web Push notifications via VAPID (works when the app is closed)
- Designed to live behind your existing reverse proxy (NPM, Traefik, Caddy, Cloudflare Tunnel, Tailscale Funnel)
- Persistent TCP bridge to a single MeshCore companion radio with exponential-backoff reconnect
- Contacts, channels, direct messages, channel messages, live event WebSocket, contact map view

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  USER'S HOMELAB                                                        │
│                                                                        │
│  ┌──────────────────────┐    HTTPS (TLS terminated)                    │
│  │  Reverse Proxy        │◄──────── public domain ───── Internet       │
│  │  (NPM / Traefik /     │                                             │
│  │   Caddy / Tailscale)  │                                             │
│  └──────────┬───────────┘                                              │
│             │ HTTP + WS                                                │
│             ▼                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  meshcore-webui Docker container (port 8080)                   │    │
│  │  ─────────────────────────────────────                          │    │
│  │  uvicorn FastAPI app                                           │    │
│  │    ├ GET  /            → static React PWA (dist/)              │    │
│  │    ├ GET  /assets/*    → static assets                         │    │
│  │    ├ GET  /api/...     → REST                                  │    │
│  │    ├ WS   /ws          → live event stream                     │    │
│  │    └ POST /api/push/*  → Web Push subscription mgmt            │    │
│  │                                                                │    │
│  │  In-process tasks:                                             │    │
│  │    • MeshCoreClient (persistent TCP, exponential backoff)      │    │
│  │    • PushSender (pywebpush async, retry, 410 cleanup)          │    │
│  │    • TaskPool (tracked asyncio.create_task refs)               │    │
│  │                                                                │    │
│  │  SQLite (via aiosqlite, WAL mode):                             │    │
│  │    /data/meshcore.db                                           │    │
│  │      ├ messages, contacts, channels                            │    │
│  │      ├ push_subscriptions                                      │    │
│  │      └ settings                                                │    │
│  │                                                                │    │
│  │  Secrets (mounted):                                            │    │
│  │    /run/secrets/vapid_private.pem                              │    │
│  └────────────────────────────────────────────────────────────────┘    │
│             │ TCP :5000                                                │
│             ▼                                                          │
│      ┌──────────────┐                                                  │
│      │  MeshCore    │  LoRa @ 433/868/915 MHz                          │
│      │  device      │  (T3-S3, Heltec V3, RAK, etc.)                   │
│      └──────────────┘                                                  │
└────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │ Web Push notifications
                                  │ (fcm.googleapis.com,
                                  │  push.services.mozilla.com,
                                  │  web.push.apple.com)
                                  │
              ┌───────────────────┴─────────────────┐
              │                                     │
       iPhone Safari PWA                  Mac/Android browser
       (Add to Home Screen)               (any modern browser)
       — gets push when closed —
```

---

## Quickstart (Docker)

You need: a MeshCore companion-radio firmware device with a WiFi TCP companion server enabled, Docker + Docker Compose, and a domain pointing at your host (for iOS push — push notifications require HTTPS, see [reverse proxy docs](docs/reverse-proxy.md)).

**1. Clone and prepare directories:**

```bash
git clone https://github.com/<you>/meshcore-webui.git
cd meshcore-webui
mkdir -p data secrets
```

**2. Generate a VAPID keypair** (one-time; keep `vapid_private.pem` secret):

```bash
docker run --rm -v "$(pwd)/secrets:/out" \
  python:3.12-slim sh -c \
  "pip install -q cryptography && python -c '
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from base64 import urlsafe_b64encode
k = ec.generate_private_key(ec.SECP256R1())
open(\"/out/vapid_private.pem\",\"wb\").write(k.private_bytes(
  serialization.Encoding.PEM,
  serialization.PrivateFormat.PKCS8,
  serialization.NoEncryption()))
pub = k.public_key().public_bytes(
  serialization.Encoding.X962,
  serialization.PublicFormat.UncompressedPoint)
open(\"/out/vapid_public.txt\",\"w\").write(
  urlsafe_b64encode(pub).rstrip(b\"=\").decode())
print(\"OK\")'"
```

Or, if you have the backend checked out and `uv` installed locally:

```bash
cd backend && uv run python scripts/gen_vapid.py ../secrets
```

**3. Copy the compose example and edit it for your device:**

```bash
cp docker-compose.example.yml docker-compose.yml
# edit MESHCORE_HOST, MESHCORE_PORT, VAPID_SUBJECT
```

**4. Build the image locally** (until prebuilt images are published to GHCR):

```bash
VITE_VAPID_PUBLIC_KEY=$(cat secrets/vapid_public.txt) \
  docker build -t meshcore-webui:dev \
  --build-arg VITE_VAPID_PUBLIC_KEY="$VITE_VAPID_PUBLIC_KEY" .
```

**5. Run:**

```bash
docker compose up -d
docker compose logs -f
```

---

## Verify

Open `http://<host>:8080` in any modern browser. You should see:

- The contact list populated from your radio
- The map view showing nodes with GPS positions
- Channel list with default `#meshchat` (or whatever your device has)
- Settings page with theme switcher, push toggle, PWA install button, API key field

Sanity check via curl:

```bash
curl -s http://<host>:8080/api/health
# {"status":"ok"}

curl -s http://<host>:8080/api/device/info | jq .
curl -s http://<host>:8080/api/contacts | jq 'length'
```

---

## Reverse proxy

The container speaks plain HTTP on port 8080. Terminate TLS at your reverse proxy and forward WebSocket upgrades through.

See **[docs/reverse-proxy.md](docs/reverse-proxy.md)** for working examples for:

- Nginx Proxy Manager
- Traefik
- Caddy
- Cloudflare Tunnel
- Tailscale Funnel

Quick NPM checklist: set Forward Hostname/IP, Forward Port `8080`, **enable Websockets Support**, SSL → Let's Encrypt.

---

## iOS push notifications

iOS supports Web Push **only for PWAs installed to the Home Screen** (iOS 16.4+).

1. Open `https://your-meshcore-domain` in Safari on iOS
2. Tap the Share button → **Add to Home Screen**
3. Launch the app from the Home Screen icon (not from Safari)
4. Go to Settings inside the app → toggle **Push notifications** on
5. Accept the iOS permission prompt

Notifications will now arrive even when the app is closed.

> **HTTPS is mandatory.** iOS will silently fail to register a push subscription on `http://` or self-signed origins. Use a real reverse proxy with a valid Let's Encrypt cert (Cloudflare Tunnel and Tailscale Funnel both terminate TLS for you).

Screenshots of the install flow are TBD.

---

## API key auth (optional)

By default the container is open on whatever address you bind it to. If you expose it on a hostile network, set a bearer token:

```yaml
environment:
  MESHCORE_WEBUI_API_KEY: "long-random-string-here"
```

Then send `Authorization: Bearer <key>` on every request. The frontend Settings page has a field to store the key in `localStorage`; it's attached to all REST/WS calls automatically.

`/api/health` is always open (so reverse proxies can health-check it without the key).

---

## Development

### Backend

```bash
cd backend
uv venv --python 3.12
uv pip install -e ".[dev]"
uv run pytest -q                                    # 53 tests
uv run uvicorn app.main:app --reload --port 8765
```

Requires: Python 3.12, [uv](https://github.com/astral-sh/uv) ≥ 0.5.

Set env vars (`.env` in `backend/` is auto-loaded):

```
MESHCORE_HOST=192.168.88.223
MESHCORE_PORT=5000
VAPID_PRIVATE_KEY_PATH=./secrets/vapid_private.pem
VAPID_SUBJECT=mailto:you@example.com
DATABASE_URL=sqlite+aiosqlite:///./data/meshcore.db
```

### Frontend

```bash
cd frontend
pnpm install
pnpm test --run                                     # vitest
pnpm dev                                            # vite at http://localhost:5173
pnpm build
```

Requires: Node 22, pnpm ≥ 9. The dev server proxies `/api` and `/ws` to `http://localhost:8765` (see `vite.config.ts`).

`VITE_VAPID_PUBLIC_KEY` must be set at build time so the SW can subscribe.

### Tests

- Backend: `cd backend && uv run pytest -q` (53 tests; pytest + httpx + respx)
- Frontend: `cd frontend && pnpm test --run` (vitest + testing-library)
- Both run in CI on every push / PR to `main` or `dev`.

---

## Project layout

```
.
├── backend/
│   ├── app/                # FastAPI app
│   │   ├── api/            # REST routers + /ws
│   │   ├── core/           # config, VAPID loader
│   │   ├── db/             # SQLAlchemy session + models
│   │   ├── middleware/     # API key bearer auth
│   │   └── services/       # MeshCore client, push sender, bridge, task pool
│   ├── scripts/            # gen_vapid.py
│   ├── tests/              # pytest suite
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── api/            # REST + WS client
│   │   ├── components/     # shadcn/ui + custom
│   │   ├── pages/          # contacts, channels, messages, settings
│   │   ├── sw/             # service worker (push handler)
│   │   └── App.tsx
│   ├── public/             # static PWA assets, icons, manifest
│   └── package.json
├── docs/                   # plans + reverse-proxy guide
├── Dockerfile              # multi-stage: node-builder → python-runtime
├── docker-compose.example.yml
└── .github/workflows/      # CI (tests + GHCR image push)
```

---

## License

MIT — see [LICENSE](LICENSE).
