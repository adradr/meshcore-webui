# Reverse proxy

The MeshCore WebUI container speaks plain HTTP on port `8080`. Put a reverse proxy in front of it to terminate TLS, route a real hostname, and (most importantly for iOS push) serve over HTTPS with a trusted certificate.

> **TLS is your responsibility.**
> The container ships HTTP only — no self-signed cert, no auto-TLS. Do not expose `:8080` directly to the internet.

> **PWA push notifications require HTTPS.**
> iOS Safari, Chrome on Android, and every browser that supports the Web Push API will refuse to register a service worker push subscription on `http://` (except `localhost`). To get notifications on your phone you **must** serve the WebUI behind a reverse proxy with a valid certificate — Let's Encrypt via NPM/Traefik/Caddy, or a tunnel that terminates TLS for you (Cloudflare Tunnel, Tailscale Funnel).

The container also exposes a WebSocket endpoint at `/ws` for live event streaming. Your reverse proxy **must** forward WebSocket upgrade headers; instructions for each option below cover this.

---

## 1. Nginx Proxy Manager (GUI)

Easiest if you already have NPM running:

1. **Hosts → Proxy Hosts → Add Proxy Host**
2. **Details tab:**
   - Domain Names: `meshcore.example.com`
   - Scheme: `http`
   - Forward Hostname / IP: `<docker-host-ip-or-container-name>`
   - Forward Port: `8080`
   - **Cache Assets**: off
   - **Block Common Exploits**: on
   - **Websockets Support: ON** ← mandatory, the `/ws` endpoint will not work without this
3. **SSL tab:**
   - SSL Certificate: **Request a new SSL Certificate** (Let's Encrypt)
   - **Force SSL: ON**
   - **HTTP/2 Support: ON**
   - Email Address: your email
   - Accept LE TOS
4. **Save** and wait ~30s for the cert.

Verify by opening `https://meshcore.example.com` — you should see the WebUI and the contacts list populates within a second or two (the WS connection is needed for live updates).

---

## 2. Traefik (Docker labels)

Add labels directly on the `meshcore-webui` service in your compose file:

```yaml
services:
  meshcore-webui:
    image: meshcore-webui:dev
    restart: unless-stopped
    # do NOT publish 8080 to the host; let Traefik reach it via the docker network
    environment:
      MESHCORE_HOST: 192.168.88.223
      MESHCORE_PORT: "5000"
      VAPID_SUBJECT: mailto:you@example.com
    volumes:
      - ./data:/data
      - ./secrets/vapid_private.pem:/run/secrets/vapid_private.pem:ro
    networks: [traefik]
    labels:
      - traefik.enable=true
      - traefik.http.routers.meshcore.rule=Host(`meshcore.example.com`)
      - traefik.http.routers.meshcore.entrypoints=websecure
      - traefik.http.routers.meshcore.tls.certresolver=letsencrypt
      - traefik.http.services.meshcore.loadbalancer.server.port=8080

networks:
  traefik:
    external: true
```

Traefik forwards WebSocket upgrades automatically — no extra middleware needed.

---

## 3. Caddy (Caddyfile)

```caddyfile
meshcore.example.com {
    reverse_proxy localhost:8080
}
```

That's it. Caddy:

- Auto-provisions a Let's Encrypt cert on first request
- Upgrades WebSocket connections transparently (no `Upgrade`/`Connection` header config needed)
- Forces HSTS by default once HTTPS is up

Reload with `caddy reload` or restart the service.

---

## 4. Cloudflare Tunnel (`cloudflared`)

If you don't want to open ports on your router at all:

```yaml
# ~/.cloudflared/config.yml
tunnel: <your-tunnel-uuid>
credentials-file: /home/you/.cloudflared/<uuid>.json

ingress:
  - hostname: meshcore.example.com
    service: http://localhost:8080
    originRequest:
      noTLSVerify: true
  - service: http_status:404
```

Then `cloudflared tunnel run` (or run it as a systemd service / Docker container).

Cloudflare terminates TLS at their edge with a free cert tied to your domain, forwards WebSocket upgrades, and the origin connection stays inside your network. Add the matching DNS record in the Cloudflare dashboard (`meshcore.example.com → CNAME → <uuid>.cfargotunnel.com`).

> Cloudflare's free plan adds a 100 s WebSocket idle timeout. The WebUI client reconnects automatically, but you may see a brief flicker every few minutes.

---

## 5. Tailscale Funnel

If you run Tailscale on the same host as the container, one command exposes it on `https://<machine>.<tailnet>.ts.net`:

```bash
tailscale funnel 8080
```

Tailscale handles cert provisioning (LetsEncrypt-via-Tailscale, automatic), DNS, and WebSocket upgrades. Stop with `tailscale funnel --https=443 off`.

This is the lowest-effort option if you're already a Tailscale user and don't need a custom domain.

---

## Troubleshooting

- **WebUI loads but contacts never appear / "Connecting..." forever:** WebSocket upgrades aren't reaching the container. NPM users: re-check the **Websockets Support** toggle. Custom nginx: ensure `proxy_set_header Upgrade $http_upgrade;` and `proxy_set_header Connection "upgrade";` are present.
- **Push notifications don't register on iOS:** the origin must be HTTPS with a publicly trusted cert (not self-signed, not `localhost`). Install the PWA from the *deployed* URL after TLS is working.
- **`/api/health` returns 401:** you set `MESHCORE_WEBUI_API_KEY` and your healthcheck isn't sending the bearer. The container's built-in healthcheck doesn't include the key, but `/api/health` is whitelisted server-side so it should always work — if you see 401, double-check you didn't whitelist it incorrectly in a custom middleware.
