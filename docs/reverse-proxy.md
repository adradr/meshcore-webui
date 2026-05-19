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

## 6. Authentication with Authelia + Nginx Proxy Manager

The WebUI itself supports `MESHCORE_WEBUI_API_KEY` for a single shared bearer token, but for anything beyond a homelab-of-one you want a real authenticator in front of NPM. **Authelia** is the natural fit: lightweight, single binary, cookie-based SSO, integrates cleanly with NPM via `auth_request`.

### Layered auth model

Think of authentication as two layers stacked in front of the WebUI:

1. **Layer 1 — proxy-level auth (recommended): Authelia in front of NPM.** Every request to `https://meshcore.example.com` is intercepted, validated against an Authelia session cookie, and only forwarded upstream if the cookie is valid. If not, the user is bounced to `https://auth.example.com` to sign in. Once they have the cookie, every app on your domain (Sonarr, Grafana, MeshCore, …) is single-sign-on.
2. **Layer 2 — defense-in-depth: `MESHCORE_WEBUI_API_KEY` bearer token.** Set this on the WebUI container even when Authelia is in front. It's a kill-switch in case the proxy is ever misconfigured, removed, or bypassed (someone hits the container's `:8080` directly on the LAN). The browser stores the key in localStorage and the React client sends it as `Authorization: Bearer …` on every API call — invisible to the user once entered.

### Why cookie auth (not HTTP Basic) matters for iOS PWA

- **HTTP Basic Auth re-prompts every cold start of the home-screen PWA.** iOS treats each new launch of a standalone PWA as a fresh process; the Basic credentials don't survive, and the user gets a native auth modal every time. Unusable.
- **Cookies survive Add-to-Home-Screen and re-launches.** Authelia issues a `Set-Cookie` on the parent domain; iOS preserves it across PWA cold starts as long as the session is still valid (default 12 h, refreshed transparently on each navigation).
- **Web Push works regardless.** Push notifications are delivered by Apple's APNs / Mozilla's autopush / FCM — never by your reverse proxy. Even if the user's session expires, queued push notifications still arrive; tapping the notification just sends them through Authelia first.

### docker-compose snippet

Put both behind your existing Docker networking (NPM and the WebUI must be reachable on the same network as Authelia):

```yaml
# docker-compose.auth.yml
services:
  authelia:
    image: authelia/authelia:latest
    restart: unless-stopped
    volumes:
      - ./authelia/config:/config
    ports:
      - "9091:9091"

  # NPM is configured in its UI; below is just a reminder of its required env
  npm:
    image: jc21/nginx-proxy-manager:latest
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "81:81"   # NPM admin UI
    volumes:
      - ./npm/data:/data
      - ./npm/letsencrypt:/etc/letsencrypt
```

### Authelia minimal `configuration.yml` (single user, no LDAP)

```yaml
# ./authelia/config/configuration.yml
server:
  host: 0.0.0.0
  port: 9091
theme: auto
jwt_secret: <generate with `openssl rand -hex 64`>
default_redirection_url: https://meshcore.example.com

authentication_backend:
  file:
    path: /config/users_database.yml

access_control:
  default_policy: deny
  rules:
    - domain: meshcore.example.com
      policy: one_factor   # require password

session:
  name: authelia_session
  secret: <generate with `openssl rand -hex 64`>
  expiration: 12h
  inactivity: 45m
  domain: example.com      # parent domain so cookie is sent to subdomains

storage:
  local:
    path: /config/db.sqlite3
  encryption_key: <generate with `openssl rand -hex 64`>

notifier:
  filesystem:
    filename: /config/notification.txt
```

> The `filesystem` notifier writes "password reset"-style emails to a local file instead of sending real SMTP. Fine for single-user homelab; swap for `smtp` in production.

### Users database

```yaml
# ./authelia/config/users_database.yml
users:
  adr:
    displayname: "MeshCore Admin"
    password: "$argon2id$v=19$m=65536,t=3,p=4$..."   # generated below
    email: adr@example.com
    groups:
      - admins
```

Generate the argon2id hash with Authelia itself:

```bash
docker run --rm authelia/authelia:latest \
  authelia hash-password 'your-strong-password-here'
```

Copy the `Digest:` value into the `password:` field.

### NPM proxy host configuration

**Proxy host for the WebUI:**

- Domain Names: `meshcore.example.com`
- Scheme: `http`
- Forward Hostname / IP: `meshcore-webui` (Docker service name) or your host IP
- Forward Port: `8080`
- **Cache Assets**: off
- **Block Common Exploits**: on
- **Websockets Support: ON** (mandatory)

**SSL tab:** request a Let's Encrypt cert, **Force SSL: ON**, **HTTP/2 Support: ON**.

**Advanced tab** — paste this nginx snippet (it tells NPM to call out to Authelia on every request and redirect to the login portal on a 401):

```nginx
location /authelia {
    internal;
    proxy_pass http://authelia:9091/api/verify;
    proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
    proxy_set_header X-Forwarded-Method $request_method;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $http_host;
    proxy_set_header X-Forwarded-Uri $request_uri;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
}

location / {
    auth_request /authelia;
    auth_request_set $target_url $scheme://$http_host$request_uri;
    auth_request_set $user $upstream_http_remote_user;
    auth_request_set $groups $upstream_http_remote_groups;
    proxy_set_header Remote-User $user;
    proxy_set_header Remote-Groups $groups;
    error_page 401 =302 https://auth.example.com/?rd=$target_url;
    proxy_pass http://meshcore-webui:8080;

    # WebSocket upgrade headers (NPM's "Websockets Support" toggle adds
    # these too, but it's safe to set them explicitly here as well).
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

**Second proxy host for the Authelia portal itself:**

- Domain Names: `auth.example.com`
- Forward to: `authelia:9091`
- **Websockets Support: ON** (Authelia uses WS for some UI flows)
- **Force SSL: ON**

That second host is what the WebUI redirects to on a 401; once the user signs in, Authelia drops them back to the original URL via the `rd=` query string.

### iOS PWA flow (end-to-end)

1. User opens `https://meshcore.example.com` in mobile Safari.
2. NPM's `auth_request` returns 401, browser is redirected to `https://auth.example.com`.
3. User signs in with the password from `users_database.yml`. Authelia sets `authelia_session=<cookie>` on `.example.com`.
4. Browser is bounced back to `https://meshcore.example.com` — request now carries the cookie, NPM forwards it upstream, WebUI loads.
5. User taps Share → **Add to Home Screen**. The cookie comes along.
6. Subsequent PWA launches: cookie is still valid → WebUI loads with no auth prompt. After 45 min of inactivity Authelia silently re-validates on the next navigation; after 12 h the user must re-enter the password once.
7. Push notifications delivered via APNs arrive even while the PWA is closed; tapping them opens the PWA, the cookie is still there, the user lands directly in the chat.

### References

- Authelia + NPM integration guide: <https://www.authelia.com/integration/proxies/nginx-proxy-manager/>
- Authelia full docs: <https://www.authelia.com/>
- Nginx Proxy Manager docs: <https://nginxproxymanager.com/>

---

## Troubleshooting

- **WebUI loads but contacts never appear / "Connecting..." forever:** WebSocket upgrades aren't reaching the container. NPM users: re-check the **Websockets Support** toggle. Custom nginx: ensure `proxy_set_header Upgrade $http_upgrade;` and `proxy_set_header Connection "upgrade";` are present.
- **Push notifications don't register on iOS:** the origin must be HTTPS with a publicly trusted cert (not self-signed, not `localhost`). Install the PWA from the *deployed* URL after TLS is working.
- **`/api/health` returns 401:** you set `MESHCORE_WEBUI_API_KEY` and your healthcheck isn't sending the bearer. The container's built-in healthcheck doesn't include the key, but `/api/health` is whitelisted server-side so it should always work — if you see 401, double-check you didn't whitelist it incorrectly in a custom middleware.
