import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from app.services.meshcore_client import MeshCoreClient, TraceHop, TracePathResult


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
