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
