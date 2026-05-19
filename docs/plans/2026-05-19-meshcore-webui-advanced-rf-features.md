# Advanced RF Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add four advanced RF tools to meshcore-webui — Line-of-Sight calculator (Fresnel-aware terrain analysis between any two nodes on the map), Trace Path visualisation (multi-hop path discovery to a selected repeater, drawn as a polyline on the map with per-hop SNR), realtime RX Log (every received packet streamed live with filter/export), and a realtime Noise Floor chart (sliding 5-minute time-series on Device + standalone page).

**Architecture:**
- Backend: extend `MeshCoreClient` to subscribe to three new `meshcore` events (`RX_LOG_DATA`, `STATS_RADIO`, `TRACE_DATA`); add four routers (`/api/los`, `/api/trace`, `/api/rx-log`, `/api/noise`); add an in-memory ring buffer + optional SQLite persistence for the RX log; add a thin `ElevationProvider` abstraction with HTTP client to OpenTopoData (configurable base URL).
- Frontend: add four pages/widgets using existing infra (`WebSocketProvider`, `useWebSocket`, TanStack Query v5, shadcn UI primitives); pick **shadcn `Chart` (Recharts)** for the static elevation profile and **uPlot via `uplot-react`** for the realtime noise/RX-rate sliders. Wire two new map popup actions ("LoS to here" and "Trace path") via existing `MarkersLayer.tsx`.
- Shared infra: a generic backend "event topic" multiplexer so RX log, noise floor, and trace events do not pollute the existing single broadcast channel.

**Tech Stack:**
- Backend: FastAPI, SQLAlchemy 2.x async + aiosqlite, Alembic, `meshcore` 2.3.7, `httpx` for elevation API, existing pytest + httpx + pytest-asyncio
- Frontend: React 18 + TypeScript + Vite 6, Tailwind 4, shadcn/ui, **shadcn `Chart` (Recharts)** + **uPlot/uplot-react** + react-leaflet 5 + react-leaflet-cluster + TanStack Query v5
- Tests: pytest + httpx for backend, vitest + @testing-library/react + msw for frontend

---

## Pre-flight Research Summary (authoritative)

These findings are baked into the tasks below. They were verified against the installed `meshcore==2.3.7` package and public docs.

### `meshcore` Python lib API (verified at `backend/.venv/lib/python3.12/site-packages/meshcore/`)

| Need | Method | Returns / Event | Key fields |
|---|---|---|---|
| Trace path to repeater | `mc.commands.send_trace(auth_code=0, tag=None, flags=None, path=None)` (`commands/messaging.py:222`) | `Event(MSG_SENT)` ack, then `EventType.TRACE_DATA` event from device (`reader.py:651-701`) | `tag` (int), `auth` (int), `flags` (byte), `path_len`, `path` (array of `{hash, snr}`, +1 final entry with snr only) |
| Path discovery (used today by `disc_path`) | `mc.commands.send_path_discovery_sync(dst, timeout=0, min_timeout=0)` (`commands/messaging.py:208`) | `Event(EventType.PATH_RESPONSE)` (`reader.py:853-875`) | `pubkey_pre` (6-byte hex), `out_path` (hex), `in_path` (hex) |
| Every RX packet | dispatcher event `EventType.RX_LOG_DATA` (`reader.py:607-648`) | streamed | `raw_hex`, `recv_time` (ms uptime), `snr` (signed/4.0), `rssi` (signed byte), `payload` (hex), `payload_length`, `route_type` + `route_typename`, `payload_type` + `payload_typename`, `path_len`, `path_hash_size`, `path` (hex), `pkt_hash` |
| Radio stats incl. noise floor | `mc.commands.get_stats_radio()` (`device.py:367-371`) | `Event(EventType.STATS_RADIO)` (`reader.py:402-487`, type=1) | `noise_floor` (int16 dBm), `last_rssi` (int8), `last_snr` (int8/4.0), `tx_air_secs`, `rx_air_secs` |

**Event subscription pattern** (events.py:170-194):
```python
sub = mc.dispatcher.subscribe(EventType.RX_LOG_DATA, callback=async_or_sync_handler)
# unsub later with sub.unsubscribe()
```

**Already wired in `backend/app/services/meshcore_client.py`** (do NOT re-subscribe to these): `CONTACT_MSG_RECV, CHANNEL_MSG_RECV, ACK, ADVERTISEMENT, PATH_UPDATE, NEW_CONTACT, BATTERY, CONNECTED, DISCONNECTED`. **`disc_path()` already exists at line 317** — reuse if needed.

### Elevation API — picks

- **Default (public, no key):** `https://api.opentopodata.org/v1/srtm30m` — 1 req/s, 1000 req/day, **100 locations per POST**, MIT code, SRTM30 data is public domain. `POST` body: `{"locations":"lat,lng|lat,lng|..."}` (pipe-separated string).
- **Self-host alternative:** OpenTopoData in Docker — same shape, unlimited, mount `srtm30m` (~90 GB) or `aster30m`. Configure via env `ELEVATION_BASE_URL=http://opentopodata:5000`.

### Math (Line of Sight)

- Wavelength λ = c/f; 868 MHz EU LoRa → **λ = 0.34538 m**, 915 MHz US → **λ = 0.32764 m**.
- First Fresnel radius at sample point: `r = sqrt(λ · d1 · d2 / D)` (all metres).
- Earth-curvature bulge (4/3 effective earth): `h_bulge = d1 · d2 / (2 · 8_494_667)` (metres).
- 60% Fresnel clearance = effectively LoS; verdict algorithm:
  - For every interior sample i: `los_h = h_tx + (h_rx − h_tx)·d1/D`; `clearance = los_h − (ground + bulge)`; `ratio = clearance / fresnel`.
  - `BLOCKED` if any clearance ≤ 0; `PARTIAL` if `min(ratio) < 0.6`; else `CLEAR`.
- Sample density: `N = clamp(ceil(distance_m / 30), 64, 512)` (DEM-resolution-aware).
- Bearing (initial): `θ = atan2(sinΔλ·cosφ2, cosφ1·sinφ2 − sinφ1·cosφ2·cosΔλ)` (`deg = (degrees(θ) + 360) mod 360`).
- **Test vector** (flat sea, D=10 km, both antennas 10 m, 868 MHz): F1_mid = **29.39 m**, bulge_mid = **1.47 m**, los_h_mid = **10 m**, clearance_mid = **8.53 m**, ratio = **0.29** → **PARTIAL**. Raise both to 30 m → clearance 28.53, ratio 0.97 → **CLEAR**. Add 12 m terrain spike at midpoint → clearance −3.47 → **BLOCKED**. (Hard-code into pytest.)

### Charting

- **Elevation profile (static):** `shadcn Chart` (Recharts AreaChart + ReferenceArea overlay for Fresnel zone). Already-installed primitive after one `pnpm dlx shadcn@latest add chart`.
- **Noise floor + RX rate (realtime sliding):** **uPlot** via `uplot-react` (~14 KB gz, canvas, designed for streaming). Wrap in a shadcn `Card` for visual parity.
- **Live dataset state:** TanStack Query v5 `useQuery` (REST primes initial state) + `queryClient.setQueryData` from WS `onmessage` with ring-buffer trimming. Documented in TkDodo "Using WebSockets with React Query".

### Codebase facts (from exploration agent)

- WS hub: `backend/app/api/ws.py` — single broadcast channel. Subscribers get `asyncio.Queue[WireEvent]` via `MeshCoreClient.subscribe()`.
- Forwarded event types live in `MeshCoreClient._FORWARDED_EVENTS` (line 24-34).
- DB: `backend/app/db/models.py` — `Message, Contact, Channel, PushSubscription, Setting`.
- Migrations: `backend/alembic/versions/`. Last two: `d22e0f4f34be_init.py`, `93d0e18f86f7_add_message_pubkey_prefix.py`.
- Routers registered in `backend/app/main.py` (`app.include_router(...)`).
- Frontend router: `frontend/src/router.tsx`. Add a route object to the children array.
- WS provider: `frontend/src/realtime/WebSocketProvider.tsx` (single dispatch). Zod schema for messages: `frontend/src/realtime/wsSchema.ts`.
- REST client: `frontend/src/lib/api.ts` — `api.get/post/patch/delete<T>()` with Zod validation + `Authorization: Bearer` if `localStorage.apiKey`.
- shadcn primitives already installed: alert, alert-dialog, avatar, badge, button, card, command, context-menu, dialog, dropdown-menu, input, input-group, label, popover, scroll-area, separator, sheet, skeleton, sonner, switch, tabs, textarea, tooltip. **Missing (install on demand):** `chart`, `table`, `select`.
- Commit style: conventional commits with scope, e.g. `feat(map): ...`.

---

## Epic 0 — Shared Infrastructure

These tasks unblock all four features. Do them first.

### Task 0.1: Add `httpx` to backend dependencies (verify present)

**Files:**
- Modify: `backend/pyproject.toml` if `httpx` not already a direct dep

**Step 1:** Inspect `backend/pyproject.toml` and `backend/.venv/lib/python3.12/site-packages/httpx/` — `httpx` is already a pytest dependency but confirm it is also a direct runtime dep.

```bash
cd backend && grep -E '^\s*"?httpx' pyproject.toml
```

**Step 2:** If only in `[tool.uv.dev-dependencies]` or `[project.optional-dependencies]`, add to `dependencies = [...]` in `pyproject.toml`. Otherwise skip.

**Step 3:** `cd backend && uv sync` (expect: "Resolved N packages" no errors).

**Step 4 (commit if changed):**
```bash
git add backend/pyproject.toml backend/uv.lock
git commit -m "build(backend): make httpx a runtime dependency for elevation client"
```

---

### Task 0.2: Backend — extend `WireEvent` schema with topic discriminator

**Files:**
- Modify: `backend/app/services/meshcore_client.py` (the dataclass `WireEvent` or wherever it's defined)
- Modify: `frontend/src/realtime/wsSchema.ts`
- Test: `backend/tests/test_meshcore_wire.py`

**Why:** The WS broadcast today flattens every event into a single message channel. RX_LOG_DATA will be high-frequency; clients that don't care about RX events shouldn't have to parse them. Add a `topic` field to every WireEvent so the frontend can subscribe selectively without changing the WS hub.

**Step 1: Write the failing test**

```python
# backend/tests/test_meshcore_wire.py — add to existing file
def test_wire_event_has_topic_field():
    from app.services.meshcore_client import WireEvent
    ev = WireEvent(type="ack", payload={}, topic="messages")
    assert ev.topic == "messages"

def test_wire_event_topic_defaults_to_messages_for_existing_types():
    from app.services.meshcore_client import topic_for_event_type
    assert topic_for_event_type("contact_message") == "messages"
    assert topic_for_event_type("channel_message") == "messages"
    assert topic_for_event_type("ack") == "messages"
    assert topic_for_event_type("connected") == "system"
    assert topic_for_event_type("rx_log") == "rx_log"
    assert topic_for_event_type("stats_radio") == "noise"
    assert topic_for_event_type("trace_data") == "trace"
```

**Step 2: Run — expect AttributeError**

```bash
cd backend && uv run pytest tests/test_meshcore_wire.py -k test_wire_event -v
# Expected: 2 FAIL — AttributeError or ImportError
```

**Step 3: Add `topic` field + helper in `backend/app/services/meshcore_client.py`**

```python
TOPIC_MAP = {
    "contact_message": "messages",
    "channel_message": "messages",
    "ack": "messages",
    "advertisement": "messages",
    "path_update": "messages",
    "new_contact": "messages",
    "battery": "system",
    "connected": "system",
    "disconnected": "system",
    "rx_log": "rx_log",
    "stats_radio": "noise",
    "stats_core": "system",
    "stats_packets": "system",
    "trace_data": "trace",
}

def topic_for_event_type(t: str) -> str:
    return TOPIC_MAP.get(t, "system")

@dataclass
class WireEvent:
    type: str
    payload: Any
    topic: str = "messages"
```

In `_on_event`, set `topic=topic_for_event_type(wire_type)` when constructing the WireEvent.

**Step 4: Run — expect PASS**

```bash
cd backend && uv run pytest tests/test_meshcore_wire.py -k test_wire_event -v
# Expected: 2 PASS
```

**Step 5: Commit**

```bash
git add backend/app/services/meshcore_client.py backend/tests/test_meshcore_wire.py
git commit -m "feat(ws): add topic discriminator to WireEvent for selective subscribe"
```

---

### Task 0.3: Frontend — extend WS message Zod schema with `topic`

**Files:**
- Modify: `frontend/src/realtime/wsSchema.ts`
- Test: `frontend/src/realtime/__tests__/wsSchema.test.ts` (create if missing)

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"
import { parseWireEvent } from "../wsSchema"

describe("parseWireEvent", () => {
  it("defaults topic to 'messages' when missing (back-compat)", () => {
    const parsed = parseWireEvent({ type: "ack", payload: {} })
    expect(parsed.topic).toBe("messages")
  })
  it("propagates topic when present", () => {
    const parsed = parseWireEvent({ type: "rx_log", payload: {}, topic: "rx_log" })
    expect(parsed.topic).toBe("rx_log")
  })
})
```

**Step 2:** `pnpm vitest run src/realtime/__tests__/wsSchema.test.ts` → expect 2 fail.

**Step 3:** Add `topic: z.string().default("messages").optional()` (or appropriate Zod shape) to the WireEvent schema. Re-export `parseWireEvent` if not already.

**Step 4:** `pnpm vitest run src/realtime/__tests__/wsSchema.test.ts` → expect 2 pass.

**Step 5:** Commit.

```bash
git add frontend/src/realtime/wsSchema.ts frontend/src/realtime/__tests__/wsSchema.test.ts
git commit -m "feat(ws): add topic field to WireEvent schema (default 'messages')"
```

---

### Task 0.4: Frontend — `useWsTopic(topic)` hook (topic-filtered subscriber)

**Files:**
- Create: `frontend/src/realtime/useWsTopic.ts`
- Test: `frontend/src/realtime/__tests__/useWsTopic.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useWsTopic } from "../useWsTopic"

it("only fires callback for matching topic", () => {
  const cb = vi.fn()
  renderHook(() => useWsTopic("rx_log", cb))
  // dispatch a fake WireEvent on window — replace with the actual bus pattern
  window.dispatchEvent(new CustomEvent("ws:wire", { detail: { type: "x", payload: {}, topic: "messages" } }))
  expect(cb).not.toHaveBeenCalled()
  window.dispatchEvent(new CustomEvent("ws:wire", { detail: { type: "x", payload: {}, topic: "rx_log" } }))
  expect(cb).toHaveBeenCalledTimes(1)
})
```

**Step 2:** Run — expect fail.

**Step 3:** Implement `useWsTopic` in `frontend/src/realtime/useWsTopic.ts`. Approach: refactor `WebSocketProvider` to re-emit every WireEvent on a `window` CustomEvent bus OR (preferred) expose a `subscribe(topic, handler)` method via the existing React context. Use whichever fits the current provider — the hook signature is what matters.

```ts
export function useWsTopic<T = unknown>(topic: string, handler: (payload: T) => void) {
  // implementation detail — must call handler only when wireEvent.topic === topic
}
```

**Step 4:** Run — expect pass.

**Step 5:** Commit.

```bash
git add frontend/src/realtime/useWsTopic.ts frontend/src/realtime/__tests__/useWsTopic.test.ts frontend/src/realtime/WebSocketProvider.tsx
git commit -m "feat(ws): add useWsTopic hook for topic-filtered subscriptions"
```

---

### Task 0.5: Settings — three new env-driven config fields

**Files:**
- Modify: `backend/app/config.py` (or wherever Settings lives)
- Test: `backend/tests/test_config.py`

**Add fields:**
- `elevation_base_url: str = "https://api.opentopodata.org/v1"`
- `elevation_dataset: str = "srtm30m"`
- `rx_log_persist: bool = False` (toggles SQLite persistence)
- `rx_log_buffer_size: int = 1000` (in-memory ring buffer cap)

**Step 1: Write failing tests** asserting defaults and env-var overrides (`MESHCORE_WEBUI_ELEVATION_BASE_URL` etc.).

**Step 2-4: Standard TDD red-green.**

**Step 5: Commit.**

```bash
git add backend/app/config.py backend/tests/test_config.py
git commit -m "feat(config): add elevation + rx-log settings"
```

---

## Epic 1 — Line of Sight Calculator

Goal: on the map, user clicks "LoS to here" in a contact popup → modal opens showing total distance, bearing, antenna heights inputs, an elevation profile chart with Fresnel zone overlay, and a verdict pill (CLEAR / PARTIAL / BLOCKED).

### Task 1.1: Backend — `app/services/geo.py` (great-circle + samples)

**Files:**
- Create: `backend/app/services/geo.py`
- Test: `backend/tests/test_geo.py`

**Step 1: Write failing tests**

```python
from app.services.geo import haversine_m, initial_bearing_deg, sample_great_circle

def test_haversine_zero():
    assert haversine_m(0, 0, 0, 0) == 0.0

def test_haversine_known_distance_paris_london():
    d = haversine_m(48.8566, 2.3522, 51.5074, -0.1278)
    # ~344 km
    assert 343_000 < d < 345_000

def test_initial_bearing_due_north():
    b = initial_bearing_deg(0, 0, 1, 0)
    assert abs(b - 0.0) < 0.01

def test_initial_bearing_due_east():
    b = initial_bearing_deg(0, 0, 0, 1)
    assert abs(b - 90.0) < 0.01

def test_sample_great_circle_endpoints_match():
    pts = sample_great_circle(48.8566, 2.3522, 51.5074, -0.1278, n=10)
    assert len(pts) == 10
    assert abs(pts[0][0] - 48.8566) < 1e-9
    assert abs(pts[-1][0] - 51.5074) < 1e-9
```

**Step 2:** Run — fail (ImportError).

**Step 3:** Implement using the formulas in pre-flight.

**Step 4:** Run — pass.

**Step 5:** Commit.

```bash
git add backend/app/services/geo.py backend/tests/test_geo.py
git commit -m "feat(geo): great-circle distance, bearing, sample helpers"
```

---

### Task 1.2: Backend — Fresnel/clearance math

**Files:**
- Create: `backend/app/services/fresnel.py`
- Test: `backend/tests/test_fresnel.py`

**Step 1: Write failing tests using the pre-flight test vector**

```python
import math
from app.services.fresnel import (
    wavelength_m, fresnel_radius_m, earth_bulge_m, verdict_from_profile,
)

def test_wavelength_868mhz():
    assert abs(wavelength_m(868e6) - 0.34538) < 1e-4

def test_fresnel_midpoint_10km_868():
    r = fresnel_radius_m(5000, 5000, freq_hz=868e6)
    assert abs(r - 29.39) < 0.1

def test_earth_bulge_midpoint_10km():
    h = earth_bulge_m(5000, 5000)
    assert abs(h - 1.471) < 0.05

def test_verdict_clear():
    # flat sea, antennas 30 m, no obstacles → CLEAR
    profile = build_flat(d_total=10_000, h_tx=30, h_rx=30, n=64)
    assert verdict_from_profile(profile, freq_hz=868e6) == "CLEAR"

def test_verdict_partial():
    profile = build_flat(d_total=10_000, h_tx=10, h_rx=10, n=64)
    assert verdict_from_profile(profile, freq_hz=868e6) == "PARTIAL"

def test_verdict_blocked():
    profile = build_flat_with_spike(d_total=10_000, h_tx=10, h_rx=10, spike_m=12, at_frac=0.5, n=64)
    assert verdict_from_profile(profile, freq_hz=868e6) == "BLOCKED"
```

(Helpers `build_flat` / `build_flat_with_spike` in test file.)

**Step 2-4:** Standard TDD.

**Step 5:** Commit.

```bash
git add backend/app/services/fresnel.py backend/tests/test_fresnel.py
git commit -m "feat(fresnel): wavelength, fresnel radius, earth bulge, verdict"
```

---

### Task 1.3: Backend — `ElevationProvider` (OpenTopoData HTTP client + cache)

**Files:**
- Create: `backend/app/services/elevation.py`
- Test: `backend/tests/test_elevation.py`

**Spec:**
- `class ElevationProvider:`
  - `__init__(base_url: str, dataset: str, client: httpx.AsyncClient)`
  - `async def lookup(coords: list[tuple[float, float]]) -> list[float]` — returns elevation in metres, same length as input.
  - Batches into 100-point chunks (OpenTopoData limit).
  - 1 req/s rate limit (use `asyncio.Semaphore(1)` + `asyncio.sleep(1.0)` between calls).
  - LRU cache on integer-quantised (5-decimal) coords: `functools.lru_cache(maxsize=10_000)` wrapper.

**Step 1: Write failing tests using `httpx.MockTransport`**

```python
import httpx, pytest
from app.services.elevation import ElevationProvider

@pytest.mark.asyncio
async def test_elevation_batches_into_100():
    seen_bodies = []
    async def handler(req: httpx.Request) -> httpx.Response:
        seen_bodies.append(req.read().decode())
        # respond with elevation = 100 for each location requested
        n = req.read().decode().count("|") + 1
        return httpx.Response(200, json={"results": [{"elevation": 100.0} for _ in range(n)]})
    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = ElevationProvider("http://x", "srtm30m", client, rate_limit_s=0)
        coords = [(0.0, 0.0 + i*0.001) for i in range(250)]
        result = await provider.lookup(coords)
        assert len(result) == 250
        assert all(v == 100.0 for v in result)
        assert len(seen_bodies) == 3  # 100 + 100 + 50

@pytest.mark.asyncio
async def test_elevation_cache_dedupes_identical_lookups():
    calls = 0
    async def handler(req):
        nonlocal calls; calls += 1
        return httpx.Response(200, json={"results": [{"elevation": 50.0}]})
    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = ElevationProvider("http://x", "srtm30m", client, rate_limit_s=0)
        await provider.lookup([(1.0, 1.0)])
        await provider.lookup([(1.0, 1.0)])
        assert calls == 1
```

**Step 2-4:** TDD.

**Step 5:** Commit.

```bash
git add backend/app/services/elevation.py backend/tests/test_elevation.py
git commit -m "feat(elevation): OpenTopoData client with batching + LRU cache"
```

---

### Task 1.4: Backend — `POST /api/los/compute`

**Files:**
- Create: `backend/app/api/los.py`
- Create: `backend/app/schemas/los.py`
- Modify: `backend/app/main.py` (register router)
- Test: `backend/tests/test_los_api.py`

**Schemas:**
```python
class LosIn(BaseModel):
    a: Point        # {lat, lon, height_m}
    b: Point
    freq_hz: float = 868e6
    samples: int | None = None   # None → auto (clamp 64..512)

class LosOut(BaseModel):
    distance_m: float
    bearing_deg: float
    samples: list[Sample]   # {distance_m, lat, lon, ground_m, bulge_m, fresnel_m, clearance_m}
    verdict: Literal["CLEAR", "PARTIAL", "BLOCKED"]
    min_clearance_ratio: float
```

**Step 1:** Failing test in `test_los_api.py`:
- Mock the elevation provider via a fixture override → flat sea (returns 0 for every point).
- POST `/api/los/compute` with two points 10 km apart, antennas 30 m → expect `verdict == "CLEAR"`, `distance_m ≈ 10000`, `min_clearance_ratio > 0.6`.
- POST with antennas 10 m → expect `"PARTIAL"`.

**Step 2-4:** TDD.

**Step 5:** Commit.

```bash
git add backend/app/api/los.py backend/app/schemas/los.py backend/app/main.py backend/tests/test_los_api.py
git commit -m "feat(api): POST /api/los/compute (terrain + Fresnel verdict)"
```

---

### Task 1.5: Frontend — install shadcn `chart` component

**Files:**
- Create: `frontend/src/components/ui/chart.tsx` (via shadcn CLI)
- Modify: `frontend/package.json` (recharts added)

**Step 1:**
```bash
cd frontend && pnpm dlx shadcn@latest add chart
# Expected: writes src/components/ui/chart.tsx, installs recharts
```

**Step 2:** `pnpm tsc --noEmit` → exit 0.

**Step 3:** Commit.

```bash
git add frontend/src/components/ui/chart.tsx frontend/package.json frontend/pnpm-lock.yaml
git commit -m "chore(ui): add shadcn chart primitive (Recharts)"
```

---

### Task 1.6: Frontend — `useLosCompute` mutation hook + types

**Files:**
- Create: `frontend/src/features/los/api.ts`
- Test: `frontend/src/features/los/__tests__/api.test.ts`

**Step 1: Failing test** — uses msw to mock `POST /api/los/compute` and asserts the hook posts the body, parses the Zod-typed response, and returns it.

**Step 2-4:** TDD.

**Step 5:** Commit.

---

### Task 1.7: Frontend — `LineOfSightModal` component

**Files:**
- Create: `frontend/src/features/los/LineOfSightModal.tsx`
- Test: `frontend/src/features/los/__tests__/LineOfSightModal.test.tsx`

**Spec:**
- shadcn `Dialog`
- Header: "Line of sight: {a.name} → {b.name}"
- Two `Input` fields with `Label`s for antenna heights (m), default 2 m
- Trigger "Compute" Button → calls `useLosCompute`
- Result panel: verdict pill (shadcn `Badge` with variant by verdict), distance + bearing strip, **`Chart` AreaChart** with X = distance km, Y = elevation m, layered:
  - `Area` ground (filled)
  - `Line` LoS straight line
  - `Area` Fresnel zone (translucent)
- Skeleton loader while pending, sonner toast on error.

**Step 1: Failing component test** — renders with stub data, asserts headings + verdict pill rendered.

**Step 2-4:** TDD.

**Step 5:** Commit.

---

### Task 1.8: Frontend — wire "LoS to here" Button into `MarkersLayer.tsx` popup

**Files:**
- Modify: `frontend/src/components/map/MarkersLayer.tsx`
- Modify: `frontend/src/pages/map.tsx` (host the modal + state)
- Test: existing map tests + extend

**Step 1:** Update `Props` to receive `onLosRequest(c: ContactMarker) => void`.

**Step 2:** Add a third button in the non-self popup (next to Profile / Message) — shadcn `Button size="sm" variant="outline"` with `Radio` icon (lucide), `aria-label="Compute line of sight"`.

**Step 3:** In `map.tsx`, hold `selectedLosTarget` state, mount `<LineOfSightModal a={self} b={selectedLosTarget} onClose={...} />`.

**Step 4:** Manual QA via browser: refresh `/map`, click a marker → click LoS button → modal opens → click Compute → see profile chart + verdict.

**Step 5:** Commit.

```bash
git add frontend/src/components/map/MarkersLayer.tsx frontend/src/pages/map.tsx frontend/src/features/los
git commit -m "feat(map): add 'Line of sight' action to marker popups"
```

---

## Epic 2 — Trace Path

Goal: on map popup of a repeater, "Trace path" button triggers `mc.commands.send_trace` to that destination; result renders as a polyline with per-hop markers + SNR labels.

### Task 2.1: Backend — `MeshCoreClient.send_trace` wrapper

**Files:**
- Modify: `backend/app/services/meshcore_client.py`
- Test: `backend/tests/test_meshcore_client.py` (extend)

**Step 1:** Failing async test — mock `mc.commands.send_trace` to return a fake Event with `MSG_SENT`, then dispatch `TRACE_DATA` via the dispatcher; assert `await client.send_trace(dst_pubkey)` returns a structured `TracePathResult` with `hops=[{hash, snr, contact_name|None}, ...]`.

**Step 2-4:** TDD.

**Step 5:** Commit.

---

### Task 2.2: Backend — subscribe to `TRACE_DATA` event → broadcast on `topic="trace"`

**Files:**
- Modify: `backend/app/services/meshcore_client.py`
- Test: `backend/tests/test_meshcore_bridge.py` (extend)

**Step 1:** Failing test — when dispatcher emits `TRACE_DATA`, the WS queue receives `WireEvent(type="trace_data", topic="trace", payload={...})`.

**Step 2-4:** TDD. Add `EventType.TRACE_DATA` to forwarded events; in `_on_event`, normalise the `path` field (array of `{hash, snr}`) for the wire.

**Step 5:** Commit.

---

### Task 2.3: Backend — `POST /api/trace/{pubkey}` endpoint

**Files:**
- Create: `backend/app/api/trace.py`
- Create: `backend/app/schemas/trace.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_trace_api.py`

**Step 1:** Failing test — POST to endpoint, mock `client.send_trace` to return canned hops, assert 200 + body matches `TracePathResult`. Also test: unknown pubkey → 404.

**Step 2-4:** TDD.

**Step 5:** Commit.

---

### Task 2.4: Backend — resolve hop `hash` → known contact (best-effort)

**Files:**
- Modify: `backend/app/api/trace.py` (or a new `trace_resolver.py`)
- Test: `backend/tests/test_trace_resolver.py`

**Spec:** for each `path[i].hash` (1 byte of pubkey prefix), look up `Contact` table for any contact whose `pub_key` starts with the same byte; if exactly one match, attach `{name, pub_key, lat, lon}`; if ambiguous, attach `{candidates: [...]}`.

**Step 1-5:** TDD + commit.

---

### Task 2.5: Frontend — `useTracePath(pubkey)` mutation + WS event handler

**Files:**
- Create: `frontend/src/features/trace/api.ts`
- Test: `frontend/src/features/trace/__tests__/api.test.ts`

Use `useWsTopic("trace", handler)` to receive async TRACE_DATA events if the device sends an async response (some firmware doesn't return via the sync method).

---

### Task 2.6: Frontend — `TracePathLayer` (renders polyline + per-hop markers on the map)

**Files:**
- Create: `frontend/src/components/map/TracePathLayer.tsx`
- Test: `frontend/src/components/map/__tests__/TracePathLayer.test.tsx`

**Spec:**
- Receives `path: ResolvedHop[]` where each hop may or may not have GPS.
- Connects only hops that have GPS coords; orphan hops shown as a separate "unknown waypoint" card outside the map.
- Polyline color = themed `var(--chart-1)`; weight 4; opacity 0.85.
- Each waypoint marker: small circle `divIcon` with the hop index + SNR tooltip.

**Step 1-5:** TDD + commit.

---

### Task 2.7: Frontend — "Trace path" Button in `MarkersLayer.tsx` popup (repeaters only)

**Files:**
- Modify: `frontend/src/components/map/MarkersLayer.tsx`
- Modify: `frontend/src/pages/map.tsx`

**Spec:** show the button only when `c.nodeType === "REP"` or `"ROOM"`. State held in `map.tsx`: `activeTrace: TracePathResult | null`. Render `<TracePathLayer />` when set; show a dismiss "✕" floating button.

**Step 1-5:** TDD + commit.

---

### Task 2.8: Frontend — Hop detail Drawer (per-hop SNR/RSSI list, dismiss)

**Files:**
- Create: `frontend/src/features/trace/TraceHopsDrawer.tsx`
- Test: `frontend/src/features/trace/__tests__/TraceHopsDrawer.test.tsx`

**Spec:** shadcn `Sheet` (already installed) opening from the right; ordered list of hops with: index, name (or pubkey-prefix hex), SNR in dB, RSSI if available, "ping this" button (no-op v1).

**Step 1-5:** TDD + commit.

---

## Epic 3 — RX Log

Goal: a new `/rx-log` page that streams every packet received by the device in realtime — filterable, searchable, exportable.

### Task 3.1: Backend — subscribe to `RX_LOG_DATA`, broadcast on `topic="rx_log"`

**Files:**
- Modify: `backend/app/services/meshcore_client.py`
- Test: `backend/tests/test_meshcore_bridge.py` (extend)

**Step 1:** Failing test — dispatcher emits `RX_LOG_DATA` → WireEvent with `type="rx_log"`, `topic="rx_log"`, payload preserving `recv_time, snr, rssi, payload_length, route_typename, payload_typename, pkt_hash, path, raw_hex`.

**Step 2-4:** TDD. Add to `_FORWARDED_EVENTS`. Translate field names to snake_case for the wire.

**Step 5:** Commit.

---

### Task 3.2: Backend — in-memory `RxLogBuffer` ring buffer

**Files:**
- Create: `backend/app/services/rx_log_buffer.py`
- Test: `backend/tests/test_rx_log_buffer.py`

**Step 1: Failing tests**

```python
def test_buffer_evicts_oldest():
    buf = RxLogBuffer(capacity=3)
    for i in range(5):
        buf.append({"i": i})
    items = buf.snapshot()
    assert [it["i"] for it in items] == [2, 3, 4]

def test_buffer_thread_safe_under_concurrent_appends():
    buf = RxLogBuffer(capacity=1000)
    # 4 threads x 250 appends each; expect snapshot length 1000, all items present
```

**Step 2-5:** TDD + commit.

---

### Task 3.3: Backend — wire `RxLogBuffer` into `MeshCoreClient`

**Files:**
- Modify: `backend/app/services/meshcore_client.py`
- Test: extend `test_meshcore_client.py`

**Spec:** in `_on_event` for `RX_LOG_DATA`, append to a singleton `RxLogBuffer` instance (size from `settings.rx_log_buffer_size`). Expose via `client.rx_log_snapshot() -> list[dict]`.

**Step 1-5:** TDD + commit.

---

### Task 3.4: Backend — `GET /api/rx-log?limit=&since=` endpoint

**Files:**
- Create: `backend/app/api/rx_log.py`
- Create: `backend/app/schemas/rx_log.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_rx_log_api.py`

**Spec:**
- `GET /api/rx-log` returns the current snapshot, newest-last, with optional `limit` (default 200, max 1000) and `since=<unix_ms>` filter.
- `GET /api/rx-log/export?format=csv|json` streams the full snapshot for download.

**Step 1-5:** TDD + commit.

---

### Task 3.5: Backend (optional persistence) — `RxLogEntry` SQLAlchemy model + Alembic migration

**Files:**
- Create: `backend/alembic/versions/<rev>_add_rx_log.py`
- Modify: `backend/app/db/models.py`
- Test: `backend/tests/test_models.py` (extend) + `test_rx_log_persist.py`

**Spec:** Only persist when `settings.rx_log_persist == True`. Columns: id, recv_time_ms, snr, rssi, payload_len, route_type, payload_type, pkt_hash, path_hex, raw_hex (TEXT), created_at. Index on `recv_time_ms DESC`.

**Step 1: Generate migration:**
```bash
cd backend && uv run alembic revision -m "add rx log table"
```

**Step 2-5:** TDD + commit.

---

### Task 3.6: Frontend — `useRxLog()` hook (REST seed + WS append via TanStack Query)

**Files:**
- Create: `frontend/src/features/rx_log/api.ts`
- Test: `frontend/src/features/rx_log/__tests__/api.test.ts`

**Hook shape (from research):**

```ts
const KEY = ['rx-log'] as const
const MAX = 1000

export function useRxLog() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: KEY, queryFn: fetchInitial, staleTime: Infinity, gcTime: Infinity })
  useWsTopic<RxEntry>("rx_log", (entry) => {
    qc.setQueryData<RxEntry[]>(KEY, (prev = []) => {
      const next = [...prev, entry]
      return next.length > MAX ? next.slice(-MAX) : next
    })
  })
  return q
}
```

**Step 1-5:** TDD with msw + a stubbed `useWsTopic`.

---

### Task 3.7: Frontend — install shadcn `table` + `select`

```bash
cd frontend && pnpm dlx shadcn@latest add table select
```

Commit.

---

### Task 3.8: Frontend — `/rx-log` page (table + filters + pause toggle)

**Files:**
- Create: `frontend/src/pages/rx-log.tsx`
- Modify: `frontend/src/router.tsx` (add route)
- Modify: `frontend/src/components/layout.tsx` (add nav link with `Radio` icon)
- Test: `frontend/src/pages/__tests__/rx-log.test.tsx`

**Spec:**
- Sticky toolbar: search `Input` (matches raw_hex / pkt_hash), `Select` for `route_type`, `Select` for `payload_type`, `Switch` "Pause stream", `Button` "Export CSV", `Button` "Export JSON", `Badge` showing count.
- shadcn `Table`: cols time (relative), RSSI, SNR, len, type, hash (truncated, copy button), path (hex truncated).
- Row click → `Sheet` with full raw_hex pretty-printed (`<pre className="font-mono text-xs">` chunked into 16-byte rows with offsets).
- Auto-scroll to bottom when new rows arrive (unless Pause is on or user has scrolled up).
- Virtualised via `@tanstack/react-virtual` (already installed).

**Step 1-5:** TDD + commit.

---

### Task 3.9: Frontend — export CSV/JSON download (client-side blob)

**Files:**
- Modify: `frontend/src/pages/rx-log.tsx`
- Modify: `frontend/src/features/rx_log/api.ts` (add `serialiseCsv`, `serialiseJson`)
- Test: `frontend/src/features/rx_log/__tests__/serialise.test.ts`

**Step 1: Failing tests**

```ts
it("serialises CSV with header + escaped raw_hex", () => {
  const rows = [{ recv_time: 12345, snr: 7.5, rssi: -90, payload_len: 21, route_typename: "F", payload_typename: "TXT_PLAIN", pkt_hash: "abcd", path: "", raw_hex: "00 01" }]
  const csv = serialiseCsv(rows)
  expect(csv.split("\n")[0]).toBe("recv_time,snr,rssi,payload_len,route,payload_type,pkt_hash,path,raw_hex")
})
```

**Step 2-5:** TDD + commit.

---

## Epic 4 — Noise Floor Realtime Chart

Goal: a sliding 5-minute time-series of `stats_radio.noise_floor` (sampled every 2s). Two surfaces: (a) widget on `/device`, (b) standalone `/noise` full-screen page.

### Task 4.1: Backend — `NoisePoller` background task

**Files:**
- Create: `backend/app/services/noise_poller.py`
- Test: `backend/tests/test_noise_poller.py`

**Spec:** background asyncio task started in `lifespan`. Every `settings.noise_poll_interval_s` (default 2.0), call `mc.commands.get_stats_radio()`, then broadcast `WireEvent(type="stats_radio", topic="noise", payload={noise_floor, last_rssi, last_snr, tx_air_secs, rx_air_secs, t_ms})`. Stop on shutdown.

**Step 1: Failing test using `freezegun` / `asyncio.sleep` mocking** — assert that two poll cycles produce two broadcasts with monotonically increasing `t_ms`.

**Step 2-4:** TDD.

**Step 5:** Commit.

---

### Task 4.2: Backend — `GET /api/noise/recent?n=300` (snapshot of in-memory ring)

**Files:**
- Create: `backend/app/api/noise.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_noise_api.py`

**Spec:** `NoisePoller` also pushes points into an in-memory ring buffer (capacity 1024). REST endpoint returns the last N points so a freshly-loaded page has immediate data before the first WS push arrives.

**Step 1-5:** TDD + commit.

---

### Task 4.3: Frontend — install `uplot` + `uplot-react`

```bash
cd frontend && pnpm add uplot uplot-react
```

Confirm bundle: `pnpm build` then grep `dist/assets/*.js` for "uPlot". Commit.

---

### Task 4.4: Frontend — `<NoiseChart>` uPlot wrapper

**Files:**
- Create: `frontend/src/features/noise/NoiseChart.tsx`
- Test: `frontend/src/features/noise/__tests__/NoiseChart.test.tsx`

**Spec:**
- Themed: line color `var(--chart-2)`, grid color `var(--border)`, axis labels `var(--muted-foreground)`. uPlot reads CSS vars via `getComputedStyle(container).getPropertyValue('--chart-2')` in the options builder; recompute on theme change (use a `useEffect` on the `theme` from `next-themes`).
- Props: `data: { t: number[]; y: number[] }`, `height = 200`, `yLabel = "Noise floor (dBm)"`.
- Renders inside a shadcn `Card`.

**Step 1: Failing render test** — renders without crashing given a 10-point series.

**Step 2-5:** TDD + commit.

---

### Task 4.5: Frontend — `useNoiseSamples()` hook (same WS pattern as RX log)

**Files:**
- Create: `frontend/src/features/noise/api.ts`
- Test: `frontend/src/features/noise/__tests__/api.test.ts`

**Spec:** REST seed `/api/noise/recent?n=150` (5 min @ 2s), append every `stats_radio` WS event via `useWsTopic("noise", ...)` with ring-buffer trim at 300 points (10 min headroom).

---

### Task 4.6: Frontend — add `<NoiseChart>` widget to `/device`

**Files:**
- Modify: `frontend/src/pages/device.tsx`
- Test: `frontend/src/pages/__tests__/device.test.tsx` (extend)

**Spec:** add a new shadcn `Card` titled "Noise floor (last 5 min)" near the bottom of the page. Show current value + min/max overlay.

**Step 1-5:** TDD + commit.

---

### Task 4.7: Frontend — standalone `/noise` page (full-screen chart + stats strip)

**Files:**
- Create: `frontend/src/pages/noise.tsx`
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/components/layout.tsx` (add nav link with `Activity` icon)

**Spec:**
- Full-bleed chart, height = `min(600, 100vh - header)`.
- Top stats strip: current noise floor, 5-min min, 5-min max, 5-min mean, sample count.
- Top-right Switch "Pause" (stops appending to local cache; WS still delivers but `setQueryData` is no-op while paused).

**Step 1-5:** TDD + commit.

---

## Epic 5 — Polish, Docs, Verification

### Task 5.1: Update README with new features list + screenshots

**Files:**
- Modify: `README.md`

Add a short "RF tools" section to the feature list with 1 line each + link to the page. Add `MESHCORE_WEBUI_ELEVATION_BASE_URL` and `MESHCORE_WEBUI_RX_LOG_PERSIST` to the env-var table.

Commit.

---

### Task 5.2: Mermaid diagram update

**Files:**
- Modify: `README.md`

Add the two new event topics (`rx_log`, `noise`, `trace`) to the architecture diagram.

Commit.

---

### Task 5.3: Final code-review pass via subagent (use superpowers:code-reviewer)

Dispatch the code-reviewer subagent against the whole branch, fix any blocking findings, commit fixes.

---

### Task 5.4: Manual QA against the live device (192.168.88.223)

- [ ] `/rx-log`: see at least one packet appear within 60 s; filter by route_type works; CSV export downloads a non-empty file.
- [ ] `/noise`: chart updates every ~2 s; line is smooth; Pause toggle stops updates.
- [ ] Device page noise widget: shows same data as `/noise`.
- [ ] Map popup → "LoS to here" on a known repeater: chart renders, verdict pill matches expectation for a flat-ish neighbourhood.
- [ ] Map popup → "Trace path" on a repeater: polyline draws, hops list opens, SNR per hop readable.
- [ ] All four features work on iPhone Safari + macOS Chrome + Android Chrome.
- [ ] Dark mode + light mode visual sanity for all four features.
- [ ] No console errors in browser; backend logs clean.

### Task 5.5: Container rebuild + healthcheck

```bash
cd /Users/adr/Dev/meshcore-webui
docker build -t meshcore-webui:dev .
docker compose up -d --force-recreate
sleep 8
curl -fsS http://localhost:8090/api/health
docker ps --format '{{.Names}}\t{{.Status}}' | grep meshcore-webui
# Expected: healthy
```

Commit any final tweaks.

---

## Verification Pass (cross-checks)

1. **`meshcore` lib calls used in plan exist in installed version** — verified at `backend/.venv/lib/python3.12/site-packages/meshcore/`:
   - `send_trace` ✓ `commands/messaging.py:222`
   - `get_stats_radio` ✓ `device.py:367-371`
   - `EventType.RX_LOG_DATA` ✓ `reader.py:607`
   - `EventType.STATS_RADIO` ✓ `reader.py:402`
   - `EventType.TRACE_DATA` ✓ `reader.py:651`
   - `dispatcher.subscribe(...)` ✓ `events.py:170`

2. **Existing wiring preserved** — `_FORWARDED_EVENTS` extension is additive; `disc_path()` (already at line 317) is not duplicated.

3. **Frontend libs land cleanly** — `recharts` arrives only via `shadcn add chart` (one path); `uplot + uplot-react` is two small adds (~14 KB gz combined).

4. **OpenTopoData public limits respected** — default config implies ≤1 req/s, ≤1000 req/day, ≤100 points/batch. The `ElevationProvider` enforces all three.

5. **Cascade Layers / CSS specificity** — uPlot is canvas; no anchor styling conflicts with Leaflet. Recharts is SVG; renders inside the modal (no map context), no Leaflet popup interaction.

6. **PWA precaching** — chart and elevation pages are React components; nothing precache-list-breaking.

7. **API key auth** — all new routes go behind the existing `Depends(verify_api_key)` if `MESHCORE_WEBUI_API_KEY` is set (same pattern as the existing routers).

---

**End of plan.** Estimated task count: 38 (Epic 0: 5; Epic 1: 8; Epic 2: 8; Epic 3: 9; Epic 4: 7; Epic 5: 5). Estimated effort: 1–2 days of focused work with the subagent-driven runner.
