import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from meshcore import EventType
from app.services.meshcore_client import (
    MeshCoreClient,
    StatsUnavailable,
    TraceHop,
    TracePathResult,
)


@pytest.mark.asyncio
async def test_client_start_and_stop_does_not_raise(monkeypatch):
    # Stub the connection establishment so we don't hit a real device
    client = MeshCoreClient(host="127.0.0.1", port=9999)
    monkeypatch.setattr(client, "_connect_once",
                        lambda: __import__("asyncio").sleep(0))
    monkeypatch.setattr(client, "_wait_disconnect",
                        lambda: __import__("asyncio").sleep(0))
    monkeypatch.setattr(client, "_shutdown_mc",
                        lambda: __import__("asyncio").sleep(0))
    await client.start()
    await client.stop()


class TestWithSenderPrefix:
    """`_with_sender_prefix` mirrors the channel-msg "<name>: body" convention
    that the MeshCore lib does NOT add automatically — see send_chan_msg."""

    def test_prepends_when_self_info_has_name(self):
        mc = SimpleNamespace(self_info={"name": "adr"})
        assert MeshCoreClient._with_sender_prefix(mc, "hello") == "adr: hello"

    def test_noop_when_already_prefixed(self):
        mc = SimpleNamespace(self_info={"name": "adr"})
        assert MeshCoreClient._with_sender_prefix(mc, "adr: hi") == "adr: hi"

    def test_noop_when_no_self_info(self):
        mc = SimpleNamespace(self_info=None)
        assert MeshCoreClient._with_sender_prefix(mc, "hello") == "hello"

    def test_noop_when_self_info_missing_name(self):
        mc = SimpleNamespace(self_info={"public_key": "abc"})
        assert MeshCoreClient._with_sender_prefix(mc, "hello") == "hello"

    def test_different_name_is_not_treated_as_prefix(self):
        # Someone else's "Alex: x" should still get our name prepended.
        mc = SimpleNamespace(self_info={"name": "adr"})
        assert (
            MeshCoreClient._with_sender_prefix(mc, "Alex: hi")
            == "adr: Alex: hi"
        )


class TestSendTrace:
    """`send_trace` wraps mc.commands.send_trace + waits for TRACE_DATA,
    returning a structured TracePathResult with parsed hops."""

    @pytest.mark.asyncio
    async def test_send_trace_returns_parsed_trace_path_result(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands = MagicMock()
        fake_ack = MagicMock()
        fake_ack.type = MagicMock()
        fake_ack.type.name = "MSG_SENT"
        fake_mc.commands.send_trace = AsyncMock(return_value=fake_ack)

        fake_trace_event = MagicMock()
        fake_trace_event.payload = {
            "tag": 12345,
            "flags": 0,
            "path_len": 2,
            "path": [
                {"hash": "ab", "snr": 3.5},
                {"hash": "cd", "snr": 4.0},
                {"hash": "", "snr": 5.5},
            ],
        }
        fake_mc.dispatcher.wait_for_event = AsyncMock(return_value=fake_trace_event)

        client._mc = fake_mc

        result = await client.send_trace(timeout=5.0)
        assert isinstance(result, TracePathResult)
        assert result.tag == 12345
        assert result.flags == 0
        assert result.path_len == 2
        assert len(result.hops) == 3
        assert result.hops[0] == TraceHop(hash="ab", snr=3.5)
        assert result.hops[1] == TraceHop(hash="cd", snr=4.0)
        assert result.hops[2] == TraceHop(hash="", snr=5.5)

    @pytest.mark.asyncio
    async def test_send_trace_raises_runtime_error_when_not_connected(self):
        client = MeshCoreClient(host="x", port=5000)
        client._mc = None
        with pytest.raises(RuntimeError, match="not connected"):
            await client.send_trace()

    @pytest.mark.asyncio
    async def test_send_trace_raises_timeout_error_when_no_trace_data(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_ack = MagicMock()
        fake_ack.type = MagicMock()
        fake_ack.type.name = "MSG_SENT"
        fake_mc.commands.send_trace = AsyncMock(return_value=fake_ack)
        fake_mc.dispatcher.wait_for_event = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(TimeoutError):
            await client.send_trace(timeout=0.1)

    @pytest.mark.asyncio
    async def test_send_trace_raises_runtime_error_when_ack_missing(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands.send_trace = AsyncMock(return_value=None)
        # Also stub wait_for_event so the test doesn't hang if logic skips the
        # ack check; it must raise BEFORE awaiting the waiter.
        fake_mc.dispatcher.wait_for_event = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(RuntimeError, match="did not ack"):
            await client.send_trace()


class TestRequestTimeouts:
    """Confirm req_* methods use the new 15s default and produce actionable errors.

    Bugfix 2: opaque "X failed or timed out" RuntimeErrors translated to 502
    after 30s waits made every RF-unreachable contact look like a backend bug.
    New defaults: 15s timeout, error messages include pubkey prefix + hint.
    """

    @pytest.mark.asyncio
    async def test_req_telemetry_timeout_default_is_15s(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands.req_telemetry_sync = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(RuntimeError, match="within 15s"):
            await client.req_telemetry("ab" * 32)
        fake_mc.commands.req_telemetry_sync.assert_called_once()
        call = fake_mc.commands.req_telemetry_sync.call_args
        # Accept either kwarg or positional timeout.
        timeout = call.kwargs.get("timeout")
        if timeout is None and call.args:
            timeout = call.args[-1]
        assert timeout == 15.0

    @pytest.mark.asyncio
    async def test_req_telemetry_error_mentions_pubkey_prefix(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands.req_telemetry_sync = AsyncMock(return_value=None)
        client._mc = fake_mc
        pk = "deadbeef" + "0" * 56
        with pytest.raises(RuntimeError, match="deadbeef"):
            await client.req_telemetry(pk)

    @pytest.mark.asyncio
    async def test_req_status_timeout_default_is_15s(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands.req_status_sync = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(RuntimeError, match="within 15s"):
            await client.req_status("ab" * 32)
        call = fake_mc.commands.req_status_sync.call_args
        timeout = call.kwargs.get("timeout")
        if timeout is None and call.args:
            timeout = call.args[-1]
        assert timeout == 15.0

    @pytest.mark.asyncio
    async def test_req_acl_timeout_default_is_15s(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands.req_acl_sync = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(RuntimeError, match="within 15s"):
            await client.req_acl("ab" * 32)
        call = fake_mc.commands.req_acl_sync.call_args
        timeout = call.kwargs.get("timeout")
        if timeout is None and call.args:
            timeout = call.args[-1]
        assert timeout == 15.0

    @pytest.mark.asyncio
    async def test_disc_path_uses_15s_timeout(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands.send_path_discovery_sync = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(RuntimeError, match="within 15s"):
            await client.disc_path("aa" * 32)
        call = fake_mc.commands.send_path_discovery_sync.call_args
        timeout = call.kwargs.get("timeout")
        if timeout is None and call.args:
            # disc_path may pass timeout positionally.
            for a in call.args[1:]:
                if isinstance(a, float):
                    timeout = a
                    break
        assert timeout == 15.0

    @pytest.mark.asyncio
    async def test_send_trace_default_is_15s(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        ack = MagicMock()
        ack.type = MagicMock()
        ack.type.name = "MSG_SENT"
        fake_mc.commands.send_trace = AsyncMock(return_value=ack)
        fake_mc.dispatcher.wait_for_event = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(TimeoutError, match="within 15s"):
            await client.send_trace()

    @pytest.mark.asyncio
    async def test_send_trace_error_mentions_unreachable_hint(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        ack = MagicMock()
        ack.type = MagicMock()
        ack.type.name = "MSG_SENT"
        fake_mc.commands.send_trace = AsyncMock(return_value=ack)
        fake_mc.dispatcher.wait_for_event = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(TimeoutError, match="repeaters"):
            await client.send_trace(timeout=0.1)


class TestReqNeighbours:
    """`req_neighbours` wraps the meshcore lib and normalizes the response
    into our envelope (renaming `pubkey` -> `pubkey_prefix`)."""

    @pytest.mark.asyncio
    async def test_req_neighbours_returns_normalized_list(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands.req_neighbours_sync = AsyncMock(return_value={
            "neighbours_count": 12,
            "results_count": 2,
            "neighbours": [
                {"pubkey": "ab12cd34", "secs_ago": 42, "snr": 6.0},
                {"pubkey": "11223344", "secs_ago": 360, "snr": -2.5},
            ],
        })
        client._mc = fake_mc
        out = await client.req_neighbours("ab" * 32)
        assert out["neighbours_count"] == 12
        assert out["results_count"] == 2
        assert out["neighbours"][0]["pubkey_prefix"] == "ab12cd34"
        assert out["neighbours"][0]["snr"] == 6.0
        assert out["neighbours"][0]["secs_ago"] == 42
        assert out["neighbours"][1]["pubkey_prefix"] == "11223344"

    @pytest.mark.asyncio
    async def test_req_neighbours_raises_on_timeout(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands.req_neighbours_sync = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(RuntimeError, match="no reply"):
            await client.req_neighbours("ab" * 32)


class TestTraceDataForwarding:
    """TRACE_DATA must be forwarded to WS subscribers on topic='trace' so
    the live-trace UI can display path hops as they arrive."""

    def test_trace_data_in_forwarded_events_set(self):
        from meshcore.events import EventType
        assert EventType.TRACE_DATA in MeshCoreClient._FORWARDED_EVENTS

    @pytest.mark.asyncio
    async def test_trace_data_event_is_forwarded_to_subscribers(self):
        from meshcore.events import Event, EventType

        client = MeshCoreClient(host="x", port=5000)
        queue = client.subscribe()
        fake_event = Event(
            type=EventType.TRACE_DATA,
            payload={
                "tag": 7777,
                "auth": 0,
                "flags": 0,
                "path_len": 1,
                "path": [
                    {"hash": "ab", "snr": 3.5},
                    {"hash": "cd", "snr": 4.0},
                ],
            },
            attributes={},
        )
        await client._on_event(fake_event)
        wire_event = await asyncio.wait_for(queue.get(), timeout=1.0)
        assert wire_event.type == "trace_data"
        assert wire_event.topic == "trace"
        assert wire_event.payload["tag"] == 7777
        assert wire_event.payload["path"] == [
            {"hash": "ab", "snr": 3.5},
            {"hash": "cd", "snr": 4.0},
        ]


class TestRxLogDataForwarding:
    """RX_LOG_DATA must be forwarded to WS subscribers on topic='rx_log' so
    the live RX-log UI can display per-packet radio metadata as it arrives."""

    def test_rx_log_data_in_forwarded_events_set(self):
        from meshcore.events import EventType
        assert EventType.RX_LOG_DATA in MeshCoreClient._FORWARDED_EVENTS

    @pytest.mark.asyncio
    async def test_rx_log_data_event_is_forwarded_to_subscribers(self):
        from meshcore.events import Event, EventType

        client = MeshCoreClient(host="x", port=5000)
        queue = client.subscribe()
        fake_payload = {
            "recv_time": 1234567,
            "snr": 3.5,
            "rssi": -90,
            "payload": "deadbeef",
            "payload_length": 4,
            "route_type": 1,
            "route_typename": "DIRECT",
            "payload_type": 2,
            "payload_typename": "TXT_PLAIN",
            "path_len": 0,
            "path_hash_size": 1,
            "path": "",
            "pkt_hash": "abcd1234",
            "raw_hex": "01 02 03 04",
        }
        fake_event = Event(
            type=EventType.RX_LOG_DATA,
            payload=fake_payload,
            attributes={},
        )
        await client._on_event(fake_event)
        wire_event = await asyncio.wait_for(queue.get(), timeout=1.0)
        assert wire_event.type == "rx_log_data"
        assert wire_event.topic == "rx_log"
        assert wire_event.payload["snr"] == 3.5
        assert wire_event.payload["rssi"] == -90
        assert wire_event.payload["pkt_hash"] == "abcd1234"


class TestRxLogBufferIntegration:
    """When an RxLogBuffer is injected, RX_LOG_DATA events should be appended
    to it (in addition to being broadcast to WS subscribers). Non-RX_LOG_DATA
    events must not pollute the buffer, and the client must work without a
    buffer at all."""

    @pytest.mark.asyncio
    async def test_rx_log_buffer_receives_rx_log_data_events(self):
        from app.services.rx_log_buffer import RxLogBuffer
        from meshcore.events import Event, EventType

        buf = RxLogBuffer(capacity=10)
        client = MeshCoreClient(host="x", port=5000, rx_log_buffer=buf)
        payload = {"snr": 3.5, "rssi": -90, "pkt_hash": "abcd"}
        await client._on_event(
            Event(type=EventType.RX_LOG_DATA, payload=payload, attributes={})
        )
        assert buf.snapshot() == [payload]
        assert client.rx_log_snapshot() == [payload]

    @pytest.mark.asyncio
    async def test_rx_log_buffer_is_optional(self):
        """Client without a buffer doesn't crash on RX_LOG_DATA events."""
        from meshcore.events import Event, EventType

        client = MeshCoreClient(host="x", port=5000)
        await client._on_event(
            Event(type=EventType.RX_LOG_DATA, payload={"snr": 1.0}, attributes={})
        )
        assert client.rx_log_snapshot() == []

    @pytest.mark.asyncio
    async def test_rx_log_buffer_only_receives_rx_log_data_events(self):
        """Non-RX_LOG_DATA events do NOT go into the buffer."""
        from app.services.rx_log_buffer import RxLogBuffer
        from meshcore.events import Event, EventType

        buf = RxLogBuffer(capacity=10)
        client = MeshCoreClient(host="x", port=5000, rx_log_buffer=buf)
        await client._on_event(
            Event(
                type=EventType.CONTACT_MSG_RECV,
                payload={"text": "hi"},
                attributes={},
            )
        )
        await client._on_event(
            Event(type=EventType.ADVERTISEMENT, payload={}, attributes={})
        )
        assert buf.snapshot() == []


class TestRxLogSanitization:
    """RX_LOG_DATA payloads from the real meshcore lib contain `bytes` values
    (`pkt_payload`) and an `int` `pkt_hash`. Both must be normalized at the
    SOURCE in `_on_event` so:

    - Bug #8: `websocket.send_json` doesn't raise on bytes (WS reconnect storm)
    - Bug #7: pydantic `RxLogEntry` schema (pkt_hash: str | None) doesn't 500
    """

    @pytest.mark.asyncio
    async def test_rx_log_data_event_strips_pkt_payload_bytes(self):
        """Bug #8: pkt_payload (bytes) must be removed before WS broadcast."""
        from app.services.rx_log_buffer import RxLogBuffer
        from meshcore.events import Event, EventType

        buf = RxLogBuffer(capacity=10)
        client = MeshCoreClient(host="x", port=5000, rx_log_buffer=buf)
        await client._on_event(Event(
            type=EventType.RX_LOG_DATA,
            payload={
                "snr": 1.5, "rssi": -90,
                "pkt_hash": 337065226,
                "pkt_payload": b"\x00\x01\x02",
                "payload": "000102",
            },
            attributes={},
        ))
        snap = buf.snapshot()
        assert len(snap) == 1
        assert "pkt_payload" not in snap[0], (
            "pkt_payload must be dropped (json-unsafe bytes)"
        )

    @pytest.mark.asyncio
    async def test_rx_log_data_event_converts_pkt_hash_int_to_hex(self):
        """Bug #7: pkt_hash int must be coerced to 8-char hex string."""
        from app.services.rx_log_buffer import RxLogBuffer
        from meshcore.events import Event, EventType

        buf = RxLogBuffer(capacity=10)
        client = MeshCoreClient(host="x", port=5000, rx_log_buffer=buf)
        await client._on_event(Event(
            type=EventType.RX_LOG_DATA,
            payload={"snr": 0.0, "rssi": -100, "pkt_hash": 337065226},
            attributes={},
        ))
        snap = buf.snapshot()
        assert snap[0]["pkt_hash"] == f"{337065226:08x}"  # zero-padded 8-char hex

    @pytest.mark.asyncio
    async def test_rx_log_data_broadcast_is_json_serializable(self):
        """Bug #8 end-to-end: WireEvent for RX_LOG_DATA must round-trip through json.dumps."""
        import json
        from meshcore.events import Event, EventType

        client = MeshCoreClient(host="x", port=5000)
        queue = client.subscribe()
        await client._on_event(Event(
            type=EventType.RX_LOG_DATA,
            payload={
                "snr": 2.5, "rssi": -85,
                "pkt_hash": 619298442,
                "pkt_payload": b"some bytes",
                "raw_hex": "abcd",
            },
            attributes={},
        ))
        wire = await asyncio.wait_for(queue.get(), timeout=1.0)
        # This used to raise TypeError: Object of type bytes is not JSON serializable
        body = json.dumps(wire.to_dict())
        assert "pkt_payload" not in body
        expected_hex = f"{619298442:08x}"  # 24e9be8a
        assert (
            f'"pkt_hash": "{expected_hex}"' in body
            or f'"pkt_hash":"{expected_hex}"' in body
        )

    @pytest.mark.asyncio
    async def test_rx_log_data_other_bytes_fields_become_hex(self):
        """Defense in depth: any other bytes-typed field should also be hexed."""
        from app.services.rx_log_buffer import RxLogBuffer
        from meshcore.events import Event, EventType

        buf = RxLogBuffer(capacity=10)
        client = MeshCoreClient(host="x", port=5000, rx_log_buffer=buf)
        await client._on_event(Event(
            type=EventType.RX_LOG_DATA,
            payload={"some_future_blob": b"\xde\xad\xbe\xef"},
            attributes={},
        ))
        assert buf.snapshot()[0]["some_future_blob"] == "deadbeef"

    @pytest.mark.asyncio
    async def test_non_rx_log_events_are_not_sanitized(self):
        """Sanitization only applies to RX_LOG_DATA — other events pass through unchanged."""
        from meshcore.events import Event, EventType

        client = MeshCoreClient(host="x", port=5000)
        queue = client.subscribe()
        await client._on_event(Event(
            type=EventType.CONTACT_MSG_RECV,
            payload={"text": "hello"},
            attributes={},
        ))
        wire = await asyncio.wait_for(queue.get(), timeout=1.0)
        # No magic — payload reaches subscribers as-is for non-rx-log events
        assert wire.payload == {"text": "hello"}


class TestGetStatsRadio:
    """Unified `get_stats_radio` — lock + raise + dict payload.

    Replaces the old Event-returning shape. Used by both the NoisePoller
    (which catches and skips) and the diagnostic orchestrator (which
    surfaces failures as NO_RESPONSE steps).
    """

    @pytest.mark.asyncio
    async def test_returns_payload_dict_on_success(self):
        from meshcore import EventType

        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_ev = MagicMock()
        fake_ev.type = EventType.STATS_RADIO
        fake_ev.payload = {
            "noise_floor": -118,
            "last_rssi": -85,
            "last_snr": 7.5,
            "tx_air_secs": 1.25,
            "rx_air_secs": 2.5,
        }
        fake_mc.commands.get_stats_radio = AsyncMock(return_value=fake_ev)
        client._mc = fake_mc

        result = await client.get_stats_radio()
        assert result == {
            "noise_floor": -118,
            "last_rssi": -85,
            "last_snr": 7.5,
            "tx_air_secs": 1.25,
            "rx_air_secs": 2.5,
        }
        fake_mc.commands.get_stats_radio.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_raises_runtime_error_on_error_event(self):
        from meshcore import EventType

        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_ev = MagicMock()
        fake_ev.type = EventType.ERROR
        fake_ev.payload = {"error": "device busy"}
        fake_mc.commands.get_stats_radio = AsyncMock(return_value=fake_ev)
        client._mc = fake_mc

        with pytest.raises(StatsUnavailable, match="stats_radio unavailable"):
            await client.get_stats_radio()

    @pytest.mark.asyncio
    async def test_raises_runtime_error_on_none_event(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands.get_stats_radio = AsyncMock(return_value=None)
        client._mc = fake_mc

        with pytest.raises(StatsUnavailable, match="stats_radio unavailable"):
            await client.get_stats_radio()

    @pytest.mark.asyncio
    async def test_raises_connection_error_when_not_connected(self):
        client = MeshCoreClient(host="x", port=5000)
        assert client._mc is None  # sanity
        with pytest.raises(ConnectionError, match="not connected"):
            await client.get_stats_radio()


class TestGetStatsCore:
    """Unified `get_stats_core` — battery, uptime, errors, queue_len."""

    @pytest.mark.asyncio
    async def test_returns_payload_dict_on_success(self):
        from meshcore import EventType

        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_ev = MagicMock()
        fake_ev.type = EventType.STATS_CORE
        fake_ev.payload = {
            "battery_mv": 3850,
            "uptime_secs": 12345,
            "errors": 0,
            "queue_len": 3,
        }
        fake_mc.commands.get_stats_core = AsyncMock(return_value=fake_ev)
        client._mc = fake_mc

        result = await client.get_stats_core()
        assert result == {
            "battery_mv": 3850,
            "uptime_secs": 12345,
            "errors": 0,
            "queue_len": 3,
        }
        fake_mc.commands.get_stats_core.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_raises_runtime_error_on_error_event(self):
        from meshcore import EventType

        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_ev = MagicMock()
        fake_ev.type = EventType.ERROR
        fake_ev.payload = {"error": "device busy"}
        fake_mc.commands.get_stats_core = AsyncMock(return_value=fake_ev)
        client._mc = fake_mc

        with pytest.raises(StatsUnavailable, match="stats_core unavailable"):
            await client.get_stats_core()

    @pytest.mark.asyncio
    async def test_raises_runtime_error_on_none_event(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands.get_stats_core = AsyncMock(return_value=None)
        client._mc = fake_mc

        with pytest.raises(StatsUnavailable, match="stats_core unavailable"):
            await client.get_stats_core()

    @pytest.mark.asyncio
    async def test_raises_connection_error_when_not_connected(self):
        client = MeshCoreClient(host="x", port=5000)
        with pytest.raises(ConnectionError, match="not connected"):
            await client.get_stats_core()


class TestGetStatsPackets:
    """Unified `get_stats_packets` — per-boot packet counters."""

    @pytest.mark.asyncio
    async def test_returns_payload_dict_on_success(self):
        from meshcore import EventType

        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_ev = MagicMock()
        fake_ev.type = EventType.STATS_PACKETS
        fake_ev.payload = {
            "recv": 1024,
            "sent": 512,
            "flood_tx": 100,
            "flood_rx": 200,
            "direct_tx": 50,
            "direct_rx": 75,
            "recv_errors": 2,
        }
        fake_mc.commands.get_stats_packets = AsyncMock(return_value=fake_ev)
        client._mc = fake_mc

        result = await client.get_stats_packets()
        assert result == {
            "recv": 1024,
            "sent": 512,
            "flood_tx": 100,
            "flood_rx": 200,
            "direct_tx": 50,
            "direct_rx": 75,
            "recv_errors": 2,
        }
        fake_mc.commands.get_stats_packets.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_raises_runtime_error_on_error_event(self):
        from meshcore import EventType

        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_ev = MagicMock()
        fake_ev.type = EventType.ERROR
        fake_ev.payload = {"error": "device busy"}
        fake_mc.commands.get_stats_packets = AsyncMock(return_value=fake_ev)
        client._mc = fake_mc

        with pytest.raises(StatsUnavailable, match="stats_packets unavailable"):
            await client.get_stats_packets()

    @pytest.mark.asyncio
    async def test_raises_runtime_error_on_none_event(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands.get_stats_packets = AsyncMock(return_value=None)
        client._mc = fake_mc

        with pytest.raises(StatsUnavailable, match="stats_packets unavailable"):
            await client.get_stats_packets()

    @pytest.mark.asyncio
    async def test_raises_connection_error_when_not_connected(self):
        client = MeshCoreClient(host="x", port=5000)
        with pytest.raises(ConnectionError, match="not connected"):
            await client.get_stats_packets()


class TestDevicePartialReset:
    """`device_partial_reset` is the granular replacement for `soft_reset`.

    Each flag (clear_channels, reset_coords, clear_contacts, reboot_device)
    is independent; callers pick the combination they want. Identity +
    radio params always preserved — use `factory_reset` for an identity
    wipe. `reboot_device` is always last in the sequence so it flushes
    the RX queue after any other selected ops.
    """

    @pytest.mark.asyncio
    async def test_clear_channels_only(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.self_info = {"max_channels": 4}

        # idx 0 = Public (skipped entirely by the loop's range(1, max_ch))
        # idx 1 = configured -> cleared
        # idx 2 = empty slot -> skipped
        # idx 3 = configured -> cleared
        def fake_get_channel(i):
            ev = MagicMock(type=EventType.CHANNEL_INFO)
            ev.payload = {
                "channel_idx": i,
                "channel_name": (
                    "Friends" if i == 1
                    else ("" if i == 2 else "Family")
                ),
            }

            async def _ret():
                return ev
            return _ret()
        fake_mc.commands.get_channel = MagicMock(side_effect=fake_get_channel)
        fake_mc.commands.set_channel = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.set_coords = AsyncMock()
        fake_mc.commands.remove_contact = AsyncMock()
        fake_mc.commands.send_appstart = AsyncMock()
        client._mc = fake_mc

        result = await client.device_partial_reset(
            clear_channels=True, reset_coords=False, clear_contacts=False,
        )

        assert result == {
            "cleared_channels": 2,
            "coords_reset": False,
            "removed_contacts": None,
            "rebooted": False,
            "reconnected": False,
        }
        cleared = sorted(
            call.args[0] for call in fake_mc.commands.set_channel.await_args_list
        )
        assert cleared == [1, 3]
        fake_mc.commands.set_coords.assert_not_awaited()
        fake_mc.commands.remove_contact.assert_not_awaited()
        # appstart should fire because channels were touched.
        fake_mc.commands.send_appstart.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_reset_coords_only(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.self_info = {"max_channels": 4}
        fake_mc.commands.set_channel = AsyncMock()
        fake_mc.commands.set_coords = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.remove_contact = AsyncMock()
        fake_mc.commands.send_appstart = AsyncMock()
        client._mc = fake_mc

        result = await client.device_partial_reset(
            clear_channels=False, reset_coords=True, clear_contacts=False,
        )

        assert result == {
            "cleared_channels": None,
            "coords_reset": True,
            "removed_contacts": None,
            "rebooted": False,
            "reconnected": False,
        }
        fake_mc.commands.set_coords.assert_awaited_once_with(0, 0)
        fake_mc.commands.set_channel.assert_not_awaited()
        fake_mc.commands.remove_contact.assert_not_awaited()
        # appstart should fire because coords were touched.
        fake_mc.commands.send_appstart.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_clear_contacts_only(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.contacts = {"k1": {}, "k2": {}, "k3": {}}
        fake_mc.commands.remove_contact = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.set_channel = AsyncMock()
        fake_mc.commands.set_coords = AsyncMock()
        fake_mc.commands.send_appstart = AsyncMock()
        # Simulate the lib's CONTACT_DELETED handler — after the sweep,
        # ensure_contacts re-syncs and the dict is empty.
        async def _resync(**_kw) -> None:
            fake_mc.contacts = {}
        fake_mc.ensure_contacts = AsyncMock(side_effect=_resync)
        client._mc = fake_mc

        result = await client.device_partial_reset(
            clear_channels=False, reset_coords=False, clear_contacts=True,
        )

        # removed is computed from before/after delta — 3 starting, 0 after
        # the post-sweep ensure_contacts re-sync.
        assert result == {
            "cleared_channels": None,
            "coords_reset": False,
            "removed_contacts": 3,
            "rebooted": False,
            "reconnected": False,
        }
        called_keys = sorted(
            c.args[0] for c in fake_mc.commands.remove_contact.await_args_list
        )
        assert called_keys == ["k1", "k2", "k3"]
        fake_mc.commands.set_channel.assert_not_awaited()
        fake_mc.commands.set_coords.assert_not_awaited()
        # appstart should NOT fire — contacts-only doesn't change self_info.
        fake_mc.commands.send_appstart.assert_not_awaited()
        fake_mc.ensure_contacts.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_all_three_flags(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.self_info = {"max_channels": 2}
        fake_mc.contacts = {"k1": {}, "k2": {}}

        async def _ch_with_name():
            ev = MagicMock(type=EventType.CHANNEL_INFO)
            ev.payload = {"channel_name": "Friends"}
            return ev
        fake_mc.commands.get_channel = MagicMock(return_value=_ch_with_name())
        fake_mc.commands.set_channel = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.set_coords = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.remove_contact = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.send_appstart = AsyncMock()
        async def _resync(**_kw) -> None:
            fake_mc.contacts = {}
        fake_mc.ensure_contacts = AsyncMock(side_effect=_resync)
        client._mc = fake_mc

        result = await client.device_partial_reset(
            clear_channels=True, reset_coords=True, clear_contacts=True,
        )

        assert result == {
            "cleared_channels": 1,
            "coords_reset": True,
            "removed_contacts": 2,
            "rebooted": False,
            "reconnected": False,
        }
        fake_mc.commands.set_coords.assert_awaited_once_with(0, 0)
        assert fake_mc.commands.remove_contact.await_count == 2
        fake_mc.commands.send_appstart.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_no_flags_set_returns_empty_result(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_channel = AsyncMock()
        fake_mc.commands.set_coords = AsyncMock()
        fake_mc.commands.remove_contact = AsyncMock()
        fake_mc.commands.send_appstart = AsyncMock()
        client._mc = fake_mc

        result = await client.device_partial_reset(
            clear_channels=False, reset_coords=False, clear_contacts=False,
        )

        assert result == {
            "cleared_channels": None,
            "coords_reset": False,
            "removed_contacts": None,
            "rebooted": False,
            "reconnected": False,
        }
        fake_mc.commands.set_channel.assert_not_awaited()
        fake_mc.commands.set_coords.assert_not_awaited()
        fake_mc.commands.remove_contact.assert_not_awaited()
        fake_mc.commands.send_appstart.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_clear_channels_raises_when_set_channel_rejected(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.self_info = {"max_channels": 2}

        async def _ch_with_name():
            ev = MagicMock(type=EventType.CHANNEL_INFO)
            ev.payload = {"channel_name": "Friends"}
            return ev
        fake_mc.commands.get_channel = MagicMock(return_value=_ch_with_name())
        fake_mc.commands.set_channel = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="rejected clear_channel"):
            await client.device_partial_reset(
                clear_channels=True, reset_coords=False, clear_contacts=False,
            )

    @pytest.mark.asyncio
    async def test_reset_coords_raises_when_rejected(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_coords = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="rejected set_coords"):
            await client.device_partial_reset(
                clear_channels=False, reset_coords=True, clear_contacts=False,
            )

    @pytest.mark.asyncio
    async def test_clear_contacts_tolerates_partial_failure(self):
        """A single remove_contact failure must not abort the whole sweep —
        we log + continue, and the size diff still reflects what the
        device actually removed."""
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.contacts = {"k1": {}, "k2": {}, "k3": {}}
        fake_mc.commands.remove_contact = AsyncMock(side_effect=[
            MagicMock(type=EventType.OK),
            MagicMock(type=EventType.ERROR),
            MagicMock(type=EventType.OK),
        ])
        # Simulate: 2 of 3 were actually removed (the failure leaves k2).
        async def _resync(**_kw) -> None:
            fake_mc.contacts = {"k2": {}}
        fake_mc.ensure_contacts = AsyncMock(side_effect=_resync)
        client._mc = fake_mc

        result = await client.device_partial_reset(
            clear_channels=False, reset_coords=False, clear_contacts=True,
        )

        assert result["removed_contacts"] == 2
        assert fake_mc.commands.remove_contact.await_count == 3

    @pytest.mark.asyncio
    async def test_clear_contacts_empty_when_no_contacts(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.contacts = {}
        fake_mc.commands.remove_contact = AsyncMock()
        fake_mc.ensure_contacts = AsyncMock()
        client._mc = fake_mc

        result = await client.device_partial_reset(
            clear_channels=False, reset_coords=False, clear_contacts=True,
        )

        assert result["removed_contacts"] == 0
        fake_mc.commands.remove_contact.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_clear_channels_falls_back_to_device_query_for_max_channels(self):
        """Real-world: self_info on a live LilyGo doesn't always carry
        `max_channels` — fall back to send_device_query so the loop iterates."""
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.self_info = {"tx_power": 22, "radio_freq": 869.618}

        device_query_event = MagicMock()
        device_query_event.payload = {"max_channels": 2}
        fake_mc.commands.send_device_query = AsyncMock(
            return_value=device_query_event,
        )

        async def _channel_with_name():
            ev = MagicMock(type=EventType.CHANNEL_INFO)
            ev.payload = {"channel_name": "hungary"}
            return ev
        fake_mc.commands.get_channel = MagicMock(
            return_value=_channel_with_name(),
        )
        fake_mc.commands.set_channel = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.send_appstart = AsyncMock()
        client._mc = fake_mc

        result = await client.device_partial_reset(
            clear_channels=True, reset_coords=False, clear_contacts=False,
        )

        fake_mc.commands.send_device_query.assert_awaited_once()
        assert result["cleared_channels"] == 1
        fake_mc.commands.set_channel.assert_awaited_once_with(1, "", b"\x00" * 16)

    @pytest.mark.asyncio
    async def test_reboot_only(self, monkeypatch):
        """`reboot_device=True` alone calls `commands.reboot()` and does
        NOT touch channels/coords/contacts. `send_appstart` is skipped
        because the supervisor reconnect path will re-appstart anyway."""
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_channel = AsyncMock()
        fake_mc.commands.set_coords = AsyncMock()
        fake_mc.commands.remove_contact = AsyncMock()
        fake_mc.commands.send_appstart = AsyncMock()
        fake_mc.commands.reboot = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        client._mc = fake_mc
        # The reconnect wait is exercised in its own focused tests;
        # here we just want to verify the reboot command path.
        async def _instant_reconnect(**_kw): return True
        monkeypatch.setattr(client, "_wait_for_reconnect", _instant_reconnect)

        result = await client.device_partial_reset(
            clear_channels=False, reset_coords=False,
            clear_contacts=False, reboot_device=True,
        )

        assert result == {
            "cleared_channels": None,
            "coords_reset": False,
            "removed_contacts": None,
            "rebooted": True,
            "reconnected": True,
        }
        fake_mc.commands.reboot.assert_awaited_once()
        fake_mc.commands.send_appstart.assert_not_awaited()
        fake_mc.commands.set_channel.assert_not_awaited()
        fake_mc.commands.set_coords.assert_not_awaited()
        fake_mc.commands.remove_contact.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_reboot_runs_last_and_replaces_appstart(self, monkeypatch):
        """When reboot is combined with another op (e.g. contacts), the
        reboot fires AFTER and we skip the post-clear send_appstart —
        the reboot itself drops the link and the supervisor reconnect
        will re-appstart."""
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.self_info = {"max_channels": 2}
        fake_mc.contacts = {"k1": {}}
        fake_mc.commands.remove_contact = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.set_coords = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.set_channel = AsyncMock()
        fake_mc.commands.send_appstart = AsyncMock()
        fake_mc.commands.reboot = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        async def _resync(**_kw) -> None:
            fake_mc.contacts = {}
        fake_mc.ensure_contacts = AsyncMock(side_effect=_resync)
        client._mc = fake_mc
        async def _instant_reconnect(**_kw): return True
        monkeypatch.setattr(client, "_wait_for_reconnect", _instant_reconnect)

        result = await client.device_partial_reset(
            clear_channels=False, reset_coords=True,
            clear_contacts=True, reboot_device=True,
        )

        assert result["rebooted"] is True
        assert result["coords_reset"] is True
        assert result["removed_contacts"] == 1
        # Skipped because reboot is happening — reconnect will re-appstart.
        fake_mc.commands.send_appstart.assert_not_awaited()
        fake_mc.commands.reboot.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_reboot_raises_when_rejected(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.reboot = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="rejected reboot"):
            await client.device_partial_reset(
                clear_channels=False, reset_coords=False,
                clear_contacts=False, reboot_device=True,
            )

    @pytest.mark.asyncio
    async def test_reboot_waits_for_supervisor_to_reconnect(self, monkeypatch):
        """The reset MUST block until the supervisor re-establishes the
        TCP link, otherwise the SPA's `/api/contacts` refetch on success
        races the reconnect window and returns 503 / stale data."""
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.reboot = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        client._mc = fake_mc
        # Speed up the polling loop so the test takes <1s.
        monkeypatch.setattr(client, "_RECONNECT_POLL_S", 0.01)
        monkeypatch.setattr(client, "_RECONNECT_GRACE_S", 0.0)

        # Simulate the supervisor: after a brief delay, flip
        # is_radio_connected from True → False → True. We do this by
        # patching the underlying property the helper checks.
        states = iter([True, False, False, True, True, True])
        monkeypatch.setattr(
            client, "is_radio_connected", lambda: next(states),
        )

        result = await client.device_partial_reset(
            clear_channels=False, reset_coords=False,
            clear_contacts=False, reboot_device=True,
        )

        assert result["rebooted"] is True
        assert result["reconnected"] is True

    @pytest.mark.asyncio
    async def test_reboot_reports_reconnected_false_on_timeout(self, monkeypatch):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.reboot = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        client._mc = fake_mc
        monkeypatch.setattr(client, "_RECONNECT_POLL_S", 0.01)
        monkeypatch.setattr(client, "_RECONNECT_WAIT_S", 0.05)
        # Connection drops and never comes back during the wait window.
        monkeypatch.setattr(client, "is_radio_connected", lambda: False)

        result = await client.device_partial_reset(
            clear_channels=False, reset_coords=False,
            clear_contacts=False, reboot_device=True,
        )

        assert result["rebooted"] is True
        assert result["reconnected"] is False

    @pytest.mark.asyncio
    async def test_no_reboot_skips_wait_for_reconnect(self, monkeypatch):
        """Resets without reboot must not pay the reconnect-wait cost;
        the lock is released immediately and `reconnected` stays False."""
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.contacts = {}
        fake_mc.commands.remove_contact = AsyncMock()
        fake_mc.ensure_contacts = AsyncMock()
        client._mc = fake_mc
        # If the helper got called for a non-reboot reset, this would
        # explode loudly — proving the helper is gated on `reboot_device`.
        called = {"v": False}
        async def _explode(**_kw):
            called["v"] = True
            return False
        monkeypatch.setattr(client, "_wait_for_reconnect", _explode)

        result = await client.device_partial_reset(
            clear_channels=False, reset_coords=False,
            clear_contacts=True, reboot_device=False,
        )

        assert called["v"] is False
        assert result["reconnected"] is False


class TestTuning:
    """`get_tuning` / `set_tuning` are simple read/write wrappers with
    the standard error-translation convention: `None` or `EventType.ERROR`
    → `RuntimeError("Device rejected …")`.
    """

    @pytest.mark.asyncio
    async def test_get_tuning_returns_dict(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        ev = MagicMock(type=EventType.OK)
        ev.payload = {"rx_delay": 100, "airtime_factor": 200}
        fake_mc.commands.get_tuning = AsyncMock(return_value=ev)
        client._mc = fake_mc

        out = await client.get_tuning()

        assert out == {"rx_delay": 100, "airtime_factor": 200}
        fake_mc.commands.get_tuning.assert_awaited_once_with()

    @pytest.mark.asyncio
    async def test_get_tuning_raises_on_error(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.get_tuning = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected get_tuning"):
            await client.get_tuning()

    @pytest.mark.asyncio
    async def test_get_tuning_raises_on_none(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.get_tuning = AsyncMock(return_value=None)
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected get_tuning"):
            await client.get_tuning()

    @pytest.mark.asyncio
    async def test_set_tuning_happy_path(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_tuning = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        client._mc = fake_mc

        await client.set_tuning(rx_delay=150, airtime_factor=250)

        fake_mc.commands.set_tuning.assert_awaited_once_with(150, 250)

    @pytest.mark.asyncio
    async def test_set_tuning_raises_on_error(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_tuning = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected set_tuning"):
            await client.set_tuning(rx_delay=10, airtime_factor=20)

    @pytest.mark.asyncio
    async def test_set_tuning_raises_on_none(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_tuning = AsyncMock(return_value=None)
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected set_tuning"):
            await client.set_tuning(rx_delay=10, airtime_factor=20)


class TestSetRadio:
    """`set_radio` reconfigures the LoRa PHY; like the reboot path,
    the modem warm-up can drop the TCP socket, so the wrapper releases
    the lock then blocks on `_wait_for_reconnect`. Tests mock that
    helper so they finish in milliseconds.

    `set_tx_power` and `set_device_name` are simple write wrappers
    bundled here so they share the standard error-translation suite.
    """

    @pytest.mark.asyncio
    async def test_happy_path_returns_reconnected(self, monkeypatch):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_radio = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        client._mc = fake_mc
        async def _instant_reconnect(**_kw): return True
        monkeypatch.setattr(client, "_wait_for_reconnect", _instant_reconnect)

        result = await client.set_radio(869.525, 250.0, 11, 5)

        assert result == {"reconnected": True}
        fake_mc.commands.set_radio.assert_awaited_once_with(
            869.525, 250.0, 11, 5,
        )

    @pytest.mark.asyncio
    async def test_skip_wait_when_flag_false(self, monkeypatch):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_radio = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        client._mc = fake_mc
        called = {"v": False}
        async def _explode(**_kw):
            called["v"] = True
            return True
        monkeypatch.setattr(client, "_wait_for_reconnect", _explode)

        result = await client.set_radio(
            869.525, 250.0, 11, 5, wait_for_reconnect=False,
        )

        assert result == {"reconnected": False}
        assert called["v"] is False

    @pytest.mark.asyncio
    async def test_raises_on_device_error(self, monkeypatch):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_radio = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc
        async def _explode(**_kw):
            raise AssertionError("must not wait when command fails")
        monkeypatch.setattr(client, "_wait_for_reconnect", _explode)

        with pytest.raises(RuntimeError, match="Device rejected set_radio"):
            await client.set_radio(869.525, 250.0, 11, 5)

    @pytest.mark.asyncio
    async def test_raises_on_none(self, monkeypatch):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_radio = AsyncMock(return_value=None)
        client._mc = fake_mc
        async def _explode(**_kw):
            raise AssertionError("must not wait when command times out")
        monkeypatch.setattr(client, "_wait_for_reconnect", _explode)

        with pytest.raises(RuntimeError, match="Device rejected set_radio"):
            await client.set_radio(869.525, 250.0, 11, 5)

    @pytest.mark.asyncio
    async def test_set_tx_power_happy(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_tx_power = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        client._mc = fake_mc

        await client.set_tx_power(20)

        fake_mc.commands.set_tx_power.assert_awaited_once_with(20)

    @pytest.mark.asyncio
    async def test_set_tx_power_raises_on_error(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_tx_power = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected set_tx_power"):
            await client.set_tx_power(20)

    @pytest.mark.asyncio
    async def test_set_device_name_happy(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_name = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        client._mc = fake_mc

        await client.set_device_name("Alpha-7")

        fake_mc.commands.set_name.assert_awaited_once_with("Alpha-7")

    @pytest.mark.asyncio
    async def test_set_device_name_raises_on_error(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_name = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected set_device_name"):
            await client.set_device_name("Alpha-7")


class TestFactoryReset:
    """`factory_reset` wraps the meshcore lib's two-step request+confirm
    pattern. Wipes ALL device state including the Ed25519 identity keypair.
    """

    @pytest.mark.asyncio
    async def test_factory_reset_calls_request_then_confirm(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.request_factory_reset = AsyncMock(return_value="TOKEN123")
        fake_mc.commands.confirm_factory_reset = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        client._mc = fake_mc

        await client.factory_reset()

        fake_mc.commands.request_factory_reset.assert_awaited_once()
        fake_mc.commands.confirm_factory_reset.assert_awaited_once_with("TOKEN123")

    @pytest.mark.asyncio
    async def test_factory_reset_raises_when_device_rejects(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.request_factory_reset = AsyncMock(return_value="T")
        fake_mc.commands.confirm_factory_reset = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="rejected factory_reset"):
            await client.factory_reset()
