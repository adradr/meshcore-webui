import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from meshcore import EventType
from app.services.meshcore_client import (
    MeshCoreClient,
    PingResult,
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
        fake_ack.payload = {
            "expected_ack": (12345).to_bytes(4, "little"),
            "suggested_timeout": 1000,
        }
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
        fake_ack.payload = {
            "expected_ack": (1).to_bytes(4, "little"),
            "suggested_timeout": 100,
        }
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


class TestSendTraceAckTagging:
    """`send_trace` must read the tag from the ack's `expected_ack` field
    (matching meshcore-cli) so that wait_for_event filters on the same
    value the firmware will stamp on the returning TRACE_DATA event. The
    wait-timeout must also come from the ack's `suggested_timeout` (in
    ms, scaled × 1.2 for safety margin) — not a hardcoded constant.

    Reference: docs/external/meshcore-cli-reference/meshcore_cli.py:2724-2745"""

    @pytest.mark.asyncio
    async def test_uses_tag_from_expected_ack(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        ack = MagicMock()
        ack.type = MagicMock()
        ack.type.name = "MSG_SENT"
        ack.payload = {
            "expected_ack": (0x12345678).to_bytes(4, "little"),
            "suggested_timeout": 1000,  # 1 s → wait 1.2 s
        }
        fake_mc.commands.send_trace = AsyncMock(return_value=ack)

        captured: dict[str, object] = {}

        async def fake_wait(event_type, attribute_filters=None, timeout=0):
            captured["event_type"] = event_type
            captured["attribute_filters"] = attribute_filters
            captured["timeout"] = timeout
            return None  # simulate timeout

        fake_mc.dispatcher.wait_for_event = fake_wait
        client._mc = fake_mc

        with pytest.raises(TimeoutError):
            await client.send_trace(target_path="ee")

        assert captured["attribute_filters"] == {"tag": 0x12345678}
        assert abs(captured["timeout"] - 1.2) < 0.01

    @pytest.mark.asyncio
    async def test_falls_back_to_caller_timeout_when_suggestion_missing(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        ack = MagicMock()
        ack.type = MagicMock()
        ack.type.name = "MSG_SENT"
        ack.payload = {
            "expected_ack": (1).to_bytes(4, "little"),
            # suggested_timeout absent
        }
        fake_mc.commands.send_trace = AsyncMock(return_value=ack)
        captured = {}

        async def fake_wait(event_type, attribute_filters=None, timeout=0):
            captured["timeout"] = timeout
            return None

        fake_mc.dispatcher.wait_for_event = fake_wait
        client._mc = fake_mc
        with pytest.raises(TimeoutError):
            await client.send_trace(timeout=5.0)
        assert captured["timeout"] == 5.0

    @pytest.mark.asyncio
    async def test_raises_when_expected_ack_missing(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        ack = MagicMock()
        ack.type = MagicMock()
        ack.type.name = "MSG_SENT"
        ack.payload = {}  # no expected_ack
        fake_mc.commands.send_trace = AsyncMock(return_value=ack)
        fake_mc.dispatcher.wait_for_event = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(RuntimeError, match="expected_ack"):
            await client.send_trace()


class TestBuildTracePath:
    """`_build_trace_path` mirrors meshcore-cli's print_trace_to logic.
    Reference: docs/external/meshcore-cli-reference/meshcore_cli.py:1781-1810
    `_build_trace_path_from_discovery` mirrors print_disc_trace_to.
    Reference: docs/external/meshcore-cli-reference/meshcore_cli.py:1821-1856"""

    @staticmethod
    def _contact(*, pubkey: str, type_: int, out_path: str, out_path_len: int) -> dict:
        return {
            "public_key": pubkey,
            "type": type_,
            "out_path": out_path,
            "out_path_len": out_path_len,
        }

    # --- _build_trace_path ---

    def test_zero_hop_repeater_just_destination_prefix(self):
        c = self._contact(
            pubkey="ee10f91c" + "00" * 28, type_=2, out_path="", out_path_len=0,
        )
        assert MeshCoreClient._build_trace_path(c, path_hash_len=1) == "ee"

    def test_one_hop_repeater_symmetric(self):
        c = self._contact(
            pubkey="ee10f91c" + "00" * 28, type_=2, out_path="3c", out_path_len=1,
        )
        # i=0: elem = "3c", trace starts "ee" -> wraps to "3cee3c"
        assert MeshCoreClient._build_trace_path(c, path_hash_len=1) == "3cee3c"

    def test_two_hop_repeater_symmetric(self):
        c = self._contact(
            pubkey="ee10f91c" + "00" * 28, type_=2, out_path="3cb9", out_path_len=2,
        )
        # i=0: elem = path[2:4] = "b9", trace was "ee" -> "b9eeb9"
        # i=1: elem = path[0:2] = "3c", trace was "b9eeb9" -> "3cb9eeb93c"
        assert MeshCoreClient._build_trace_path(c, path_hash_len=1) == "3cb9eeb93c"

    def test_non_repeater_contact_no_destination_prefix(self):
        c = self._contact(
            pubkey="ee10f91c" + "00" * 28, type_=1, out_path="3c", out_path_len=1,
        )
        # trace=="" before loop; i=0: elem="3c", trace becomes "3c"
        assert MeshCoreClient._build_trace_path(c, path_hash_len=1) == "3c"

    def test_two_byte_hash_mode_uses_wider_slices(self):
        c = self._contact(
            pubkey="ee10f91c" + "00" * 28, type_=2,
            out_path="3cb91234", out_path_len=2,
        )
        # dest_prefix = "ee10" (2 bytes = 4 hex chars)
        # i=0: elem = path[4:8] = "1234"; trace "ee10" -> "1234ee101234"
        # i=1: elem = path[0:4] = "3cb9"; trace "1234ee101234" -> "3cb91234ee1012343cb9"
        assert (
            MeshCoreClient._build_trace_path(c, path_hash_len=2)
            == "3cb91234ee1012343cb9"
        )

    def test_returns_none_when_path_len_negative(self):
        c = self._contact(
            pubkey="ee" + "00" * 31, type_=2, out_path="", out_path_len=-1,
        )
        assert MeshCoreClient._build_trace_path(c, path_hash_len=1) is None

    def test_three_byte_hash_mode_rewrites_to_two_byte(self):
        # CLI quirk: hash_mode=2 → path_hash_len=3 → rewrite to 2-byte
        # by extracting the LEADING 4 hex chars (2 bytes) of each 6-char
        # (3-byte) slot.
        c = self._contact(
            pubkey="ee10f91c" + "00" * 28, type_=2,
            out_path="3c11b9b922cc",  # two 3-byte hops: 3c11b9, b922cc
            out_path_len=2,
        )
        # After rewrite, path becomes the leading 4 hex chars of each
        # slot taken in REVERSE order (i=0 picks slot path_len-1 first):
        #   i=0: path[6*(2-0-1):6*(2-0-1)+4] = path[6:10] = "b922"
        #   i=1: path[6*(2-1-1):6*(2-1-1)+4] = path[0:4] = "3c11"
        # new_path = "b9223c11", and path_hash_len becomes 2.
        # dest_prefix at 2*2=4 hex chars: "ee10"
        # Walking new_path with path_hash_len=2:
        #   i=0: elem = path[4:8] = "3c11"
        #        trace was "ee10" -> "3c11ee103c11"
        #   i=1: elem = path[0:4] = "b922"
        #        trace -> "b9223c11ee103c11b922"
        assert (
            MeshCoreClient._build_trace_path(c, path_hash_len=3)
            == "b9223c11ee103c11b922"
        )

    # --- _build_trace_path_from_discovery ---

    def test_from_discovery_out_then_dest_then_in(self):
        contact = {"public_key": "ee10f91c" + "00" * 28, "type": 2}
        disc_payload = {"in_path": "3c", "out_path": "b9"}
        result = MeshCoreClient._build_trace_path_from_discovery(
            contact, disc_payload, path_hash_len=1,
        )
        assert result == "b9,ee,3c"

    def test_from_discovery_dedups_trailing_repeated_hop(self):
        contact = {"public_key": "ee" + "00" * 31, "type": 2}
        disc_payload = {"in_path": "ee", "out_path": ""}
        result = MeshCoreClient._build_trace_path_from_discovery(
            contact, disc_payload, path_hash_len=1,
        )
        # dest_prefix "ee" added, in_path's "ee" suppressed by dedup.
        assert result == "ee"

    def test_from_discovery_user_type_no_dest_prefix(self):
        contact = {"public_key": "aa" + "00" * 31, "type": 1}
        disc_payload = {"in_path": "", "out_path": ""}
        result = MeshCoreClient._build_trace_path_from_discovery(
            contact, disc_payload, path_hash_len=1,
        )
        assert result == ""

    def test_from_discovery_two_byte_hash_mode(self):
        contact = {"public_key": "ee10" + "00" * 30, "type": 2}
        disc_payload = {"in_path": "3c11", "out_path": "b922"}
        result = MeshCoreClient._build_trace_path_from_discovery(
            contact, disc_payload, path_hash_len=2,
        )
        # 2-byte hops: out="b922", dest="ee10", in="3c11" → "b922,ee10,3c11"
        assert result == "b922,ee10,3c11"


class TestPingViaTrace:
    """ping_via_trace orchestrator: contact lookup → path build (or
    discovery-then-build) → send_trace → PingResult. Mirrors CLI's
    trace/dtrace dispatch."""

    @staticmethod
    def _fake_mc_with_stored_path():
        mc = MagicMock()
        mc.is_connected = True
        mc.commands.get_path_hash_mode = AsyncMock(return_value=0)  # 1B hashes
        mc.contacts = {
            "ee10f91c" + "00" * 28: {
                "public_key": "ee10f91c" + "00" * 28,
                "type": 2,
                "out_path": "3c",
                "out_path_len": 1,
            },
        }
        ack = MagicMock()
        ack.type.name = "MSG_SENT"
        ack.payload = {
            "expected_ack": (0xCAFEBABE).to_bytes(4, "little"),
            "suggested_timeout": 500,
        }
        mc.commands.send_trace = AsyncMock(return_value=ack)
        trace_ev = MagicMock()
        trace_ev.payload = {
            "tag": 0xCAFEBABE, "flags": 0, "path_len": 2,
            "path": [
                {"hash": "3c", "snr": 11.5},
                {"hash": "ee", "snr": 12.0},
            ],
        }
        mc.dispatcher.wait_for_event = AsyncMock(return_value=trace_ev)
        return mc

    @pytest.mark.asyncio
    async def test_uses_stored_out_path_no_discovery(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = self._fake_mc_with_stored_path()
        client._mc = fake_mc

        result = await client.ping_via_trace("ee10f91c" + "00" * 28)

        # No discovery — stored path was used directly.
        fake_mc.commands.send_path_discovery_sync.assert_not_called()
        # send_trace called with the symmetric path string.
        call = fake_mc.commands.send_trace.call_args
        assert call.kwargs["path"] == "3cee3c"
        assert isinstance(result, PingResult)
        assert result.snr_there == 11.5
        assert result.snr_back == 12.0
        assert result.path_len == 2

    @pytest.mark.asyncio
    async def test_runs_discovery_when_out_path_unknown(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = self._fake_mc_with_stored_path()
        pk = "ee10f91c" + "00" * 28
        fake_mc.contacts[pk]["out_path"] = ""
        fake_mc.contacts[pk]["out_path_len"] = -1
        # Stub disc_path via send_path_discovery_sync since that's what
        # disc_path wraps. The lib returns an Event with the payload.
        disc_ev = MagicMock()
        disc_ev.is_error = MagicMock(return_value=False)
        disc_ev.payload = {"in_path": "3c", "out_path": "b9"}
        fake_mc.commands.send_path_discovery_sync = AsyncMock(return_value=disc_ev)
        client._mc = fake_mc

        result = await client.ping_via_trace(pk)

        fake_mc.commands.send_path_discovery_sync.assert_awaited_once()
        call = fake_mc.commands.send_trace.call_args
        # Discovery format is comma-separated: out + dest + in.
        assert call.kwargs["path"] == "b9,ee,3c"
        assert result.snr_there == 11.5

    @pytest.mark.asyncio
    async def test_raises_when_discovery_fails(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = self._fake_mc_with_stored_path()
        pk = "ee10f91c" + "00" * 28
        fake_mc.contacts[pk]["out_path"] = ""
        fake_mc.contacts[pk]["out_path_len"] = -1
        fake_mc.commands.send_path_discovery_sync = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(RuntimeError, match="path discovery"):
            await client.ping_via_trace(pk)

    @pytest.mark.asyncio
    async def test_raises_when_contact_not_in_dict(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = self._fake_mc_with_stored_path()
        client._mc = fake_mc
        with pytest.raises(RuntimeError, match="unknown contact"):
            await client.ping_via_trace("ff" * 32)

    @pytest.mark.asyncio
    async def test_snr_back_none_when_only_one_hop(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = self._fake_mc_with_stored_path()
        # Re-stub trace event to have only 1 hop.
        single_hop = MagicMock()
        single_hop.payload = {
            "tag": 0xCAFEBABE, "flags": 0, "path_len": 1,
            "path": [{"hash": "ee", "snr": 9.0}],
        }
        fake_mc.dispatcher.wait_for_event = AsyncMock(return_value=single_hop)
        client._mc = fake_mc
        result = await client.ping_via_trace("ee10f91c" + "00" * 28)
        assert result.snr_there == 9.0
        assert result.snr_back is None


class TestRequestTimeouts:
    """req_* methods pass `timeout=0` to the meshcore lib so the firmware's
    `suggested_timeout` (which scales with flood / multi-hop complexity)
    is honoured, AND wrap the call in `asyncio.wait_for(max_wait)` as an
    outer cap so a stuck firmware cannot hang the request indefinitely.

    Bugfix history:
      - Bugfix 2 introduced a hardcoded 15s timeout to fail fast for
        unreachable peers. That over-cut floods that would have replied
        at 18-30s and made our ping/trace/discover fail for peers the
        official MeshCore app could reach on the same radio.
      - Bugfix 3 (this layer): pass `timeout=0` to the lib, enforce a
        60s outer ceiling via `asyncio.wait_for`. Same fail-fast story
        for unreachable peers, but legitimate slow floods now succeed.
    """

    @staticmethod
    def _lib_timeout(call):
        """Extract the `timeout=...` arg passed to the mocked lib call —
        accepting either kwarg or positional form so the tests stay
        agnostic to the lib's internal call shape."""
        t = call.kwargs.get("timeout")
        if t is None:
            for a in call.args:
                if isinstance(a, (int, float)) and not isinstance(a, bool):
                    t = a
                    break
        return t

    @pytest.mark.asyncio
    async def test_req_telemetry_passes_timeout_zero_to_lib(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands.req_telemetry_sync = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(RuntimeError, match="within 60s"):
            await client.req_telemetry("ab" * 32)
        fake_mc.commands.req_telemetry_sync.assert_called_once()
        assert self._lib_timeout(
            fake_mc.commands.req_telemetry_sync.call_args,
        ) == 0

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
    async def test_req_status_passes_timeout_zero_to_lib(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands.req_status_sync = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(RuntimeError, match="within 60s"):
            await client.req_status("ab" * 32)
        assert self._lib_timeout(
            fake_mc.commands.req_status_sync.call_args,
        ) == 0

    @pytest.mark.asyncio
    async def test_req_acl_passes_timeout_zero_to_lib(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands.req_acl_sync = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(RuntimeError, match="within 60s"):
            await client.req_acl("ab" * 32)
        assert self._lib_timeout(
            fake_mc.commands.req_acl_sync.call_args,
        ) == 0

    @pytest.mark.asyncio
    async def test_disc_path_passes_timeout_zero_to_lib(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        fake_mc.commands.send_path_discovery_sync = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(RuntimeError, match="within 60s"):
            await client.disc_path("aa" * 32)
        assert self._lib_timeout(
            fake_mc.commands.send_path_discovery_sync.call_args,
        ) == 0

    @pytest.mark.asyncio
    async def test_outer_max_wait_cap_fires_when_lib_hangs(self):
        """If the firmware suggests a runaway timeout (or the lib
        otherwise stalls), the wrapper's outer `asyncio.wait_for` cap
        MUST fire — this is the safety net that the bugfix-2 hardcoded
        15s used to provide. Use a tiny `max_wait` so the test stays
        fast, and have the lib block on an Event that never gets set."""
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        blocker = asyncio.Event()  # never set

        async def _hang(*_a, **_kw):
            await blocker.wait()
            return {"status": "should never arrive"}

        fake_mc.commands.req_status_sync = _hang
        client._mc = fake_mc
        with pytest.raises(RuntimeError, match="within 0.1s"):
            await client.req_status("ab" * 32, max_wait=0.1)

    @pytest.mark.asyncio
    async def test_send_trace_default_is_60s(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        ack = MagicMock()
        ack.type = MagicMock()
        ack.type.name = "MSG_SENT"
        # No suggested_timeout → falls back to caller's default 60s.
        ack.payload = {"expected_ack": (1).to_bytes(4, "little")}
        fake_mc.commands.send_trace = AsyncMock(return_value=ack)
        fake_mc.dispatcher.wait_for_event = AsyncMock(return_value=None)
        client._mc = fake_mc
        with pytest.raises(TimeoutError, match="within 60.0s"):
            await client.send_trace()

    @pytest.mark.asyncio
    async def test_send_trace_error_mentions_unreachable_hint(self):
        client = MeshCoreClient(host="x", port=5000)
        fake_mc = MagicMock()
        ack = MagicMock()
        ack.type = MagicMock()
        ack.type.name = "MSG_SENT"
        ack.payload = {
            "expected_ack": (1).to_bytes(4, "little"),
            "suggested_timeout": 100,
        }
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
        # set_tuning fires send_appstart so the lib's self_info cache
        # picks up the new values for the next /api/device/self-info read.
        fake_mc.commands.send_appstart = AsyncMock(return_value=None)
        client._mc = fake_mc

        await client.set_tuning(rx_delay=150, airtime_factor=250)

        fake_mc.commands.set_tuning.assert_awaited_once_with(150, 250)
        fake_mc.commands.send_appstart.assert_awaited_once()

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
        # set_tx_power fires send_appstart so the lib's self_info.tx_power
        # cache picks up the new value.
        fake_mc.commands.send_appstart = AsyncMock(return_value=None)
        client._mc = fake_mc

        await client.set_tx_power(20)

        fake_mc.commands.set_tx_power.assert_awaited_once_with(20)
        fake_mc.commands.send_appstart.assert_awaited_once()

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
        # set_device_name fires send_appstart so the lib's self_info.name
        # cache picks up the new value.
        fake_mc.commands.send_appstart = AsyncMock(return_value=None)
        client._mc = fake_mc

        await client.set_device_name("Alpha-7")

        fake_mc.commands.set_name.assert_awaited_once_with("Alpha-7")
        fake_mc.commands.send_appstart.assert_awaited_once()

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


class TestBehaviour:
    """Behaviour / policy setters: telemetry sub-modes, manual-add-contacts,
    advert location policy, multi-acks. Each setter is a simple write
    wrapper that fires send_appstart after a successful write so the lib's
    cached self_info reflects the new value.
    """

    @pytest.mark.asyncio
    async def test_set_telemetry_mode_calls_only_specified_modes(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_telemetry_mode_base = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.set_telemetry_mode_loc = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.set_telemetry_mode_env = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.send_appstart = AsyncMock(return_value=None)
        client._mc = fake_mc

        await client.set_telemetry_mode(base=1, env=2)

        fake_mc.commands.set_telemetry_mode_base.assert_awaited_once_with(1)
        fake_mc.commands.set_telemetry_mode_env.assert_awaited_once_with(2)
        fake_mc.commands.set_telemetry_mode_loc.assert_not_awaited()
        fake_mc.commands.send_appstart.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_set_telemetry_mode_raises_on_error(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_telemetry_mode_base = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.set_telemetry_mode_loc = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        fake_mc.commands.set_telemetry_mode_env = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.send_appstart = AsyncMock(return_value=None)
        client._mc = fake_mc

        with pytest.raises(
            RuntimeError, match="Device rejected set_telemetry_mode_loc",
        ):
            await client.set_telemetry_mode(base=1, loc=2, env=3)

    @pytest.mark.asyncio
    async def test_set_manual_add_contacts_happy(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_manual_add_contacts = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.send_appstart = AsyncMock(return_value=None)
        client._mc = fake_mc

        await client.set_manual_add_contacts(True)

        fake_mc.commands.set_manual_add_contacts.assert_awaited_once_with(True)
        fake_mc.commands.send_appstart.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_set_manual_add_contacts_raises_on_error(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_manual_add_contacts = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(
            RuntimeError, match="Device rejected set_manual_add_contacts",
        ):
            await client.set_manual_add_contacts(True)

    @pytest.mark.asyncio
    async def test_set_advert_loc_policy_happy(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_advert_loc_policy = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.send_appstart = AsyncMock(return_value=None)
        client._mc = fake_mc

        await client.set_advert_loc_policy(1)

        fake_mc.commands.set_advert_loc_policy.assert_awaited_once_with(1)
        fake_mc.commands.send_appstart.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_set_advert_loc_policy_raises_on_error(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_advert_loc_policy = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(
            RuntimeError, match="Device rejected set_advert_loc_policy",
        ):
            await client.set_advert_loc_policy(1)

    @pytest.mark.asyncio
    async def test_set_multi_acks_happy(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_multi_acks = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        fake_mc.commands.send_appstart = AsyncMock(return_value=None)
        client._mc = fake_mc

        await client.set_multi_acks(2)

        fake_mc.commands.set_multi_acks.assert_awaited_once_with(2)
        fake_mc.commands.send_appstart.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_set_multi_acks_raises_on_error(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_multi_acks = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(
            RuntimeError, match="Device rejected set_multi_acks",
        ):
            await client.set_multi_acks(2)


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


class TestGetSelfInfo:
    """`get_self_info` must never return an empty dict — callers depend on
    a populated payload or a RuntimeError that `_call()` can map to a 502."""

    @pytest.mark.asyncio
    async def test_get_self_info_raises_when_payload_empty(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.self_info = {}  # empty dict — falsy
        fake_mc.commands.send_appstart = AsyncMock()  # called but doesn't populate
        client._mc = fake_mc
        with pytest.raises(RuntimeError, match="self_info unavailable"):
            await client.get_self_info()


class TestCustomVars:
    """`get_custom_vars` / `set_custom_var` round-trip firmware-defined
    key/value pairs. Payload from the lib is already a dict; the wrapper
    just defensively copies it and applies the standard error contract.
    """

    @pytest.mark.asyncio
    async def test_get_custom_vars_returns_dict(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        ev = MagicMock(type=EventType.OK)
        ev.payload = {"foo": "1", "bar": "baz"}
        fake_mc.commands.get_custom_vars = AsyncMock(return_value=ev)
        client._mc = fake_mc

        out = await client.get_custom_vars()

        assert out == {"foo": "1", "bar": "baz"}
        fake_mc.commands.get_custom_vars.assert_awaited_once_with()

    @pytest.mark.asyncio
    async def test_get_custom_vars_empty_payload_returns_empty_dict(self):
        """Firmware with no vars defined replies with ``{}`` — the wrapper
        must not mistake that for an error."""
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        ev = MagicMock(type=EventType.OK)
        ev.payload = {}
        fake_mc.commands.get_custom_vars = AsyncMock(return_value=ev)
        client._mc = fake_mc

        assert await client.get_custom_vars() == {}

    @pytest.mark.asyncio
    async def test_get_custom_vars_raises_on_error(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.get_custom_vars = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected get_custom_vars"):
            await client.get_custom_vars()

    @pytest.mark.asyncio
    async def test_get_custom_vars_raises_on_none(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.get_custom_vars = AsyncMock(return_value=None)
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected get_custom_vars"):
            await client.get_custom_vars()

    @pytest.mark.asyncio
    async def test_set_custom_var_happy_path(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_custom_var = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        client._mc = fake_mc

        await client.set_custom_var("foo", "bar")

        fake_mc.commands.set_custom_var.assert_awaited_once_with("foo", "bar")

    @pytest.mark.asyncio
    async def test_set_custom_var_raises_on_error(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_custom_var = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected set_custom_var"):
            await client.set_custom_var("foo", "bar")

    @pytest.mark.asyncio
    async def test_set_custom_var_raises_on_none(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_custom_var = AsyncMock(return_value=None)
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected set_custom_var"):
            await client.set_custom_var("foo", "bar")


class TestTime:
    """`get_device_time` / `set_device_time` are the radio clock sync.
    The wrapper tolerates three lib payload shapes: bare int, ``{"time": int}``,
    and ``{"epoch": int}`` — observed across firmware builds.
    """

    @pytest.mark.asyncio
    async def test_get_device_time_dict_time_key(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        ev = MagicMock(type=EventType.OK)
        ev.payload = {"time": 1_700_000_000}
        fake_mc.commands.get_time = AsyncMock(return_value=ev)
        client._mc = fake_mc

        assert await client.get_device_time() == 1_700_000_000

    @pytest.mark.asyncio
    async def test_get_device_time_dict_epoch_key(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        ev = MagicMock(type=EventType.OK)
        ev.payload = {"epoch": 1_700_000_001}
        fake_mc.commands.get_time = AsyncMock(return_value=ev)
        client._mc = fake_mc

        assert await client.get_device_time() == 1_700_000_001

    @pytest.mark.asyncio
    async def test_get_device_time_bare_int(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        ev = MagicMock(type=EventType.OK)
        ev.payload = 1_700_000_002
        fake_mc.commands.get_time = AsyncMock(return_value=ev)
        client._mc = fake_mc

        assert await client.get_device_time() == 1_700_000_002

    @pytest.mark.asyncio
    async def test_get_device_time_raises_on_error(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.get_time = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected get_time"):
            await client.get_device_time()

    @pytest.mark.asyncio
    async def test_get_device_time_raises_on_none(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.get_time = AsyncMock(return_value=None)
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected get_time"):
            await client.get_device_time()

    @pytest.mark.asyncio
    async def test_set_device_time_happy_path(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_time = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        client._mc = fake_mc

        await client.set_device_time(1_700_000_000)

        fake_mc.commands.set_time.assert_awaited_once_with(1_700_000_000)

    @pytest.mark.asyncio
    async def test_set_device_time_raises_on_error(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_time = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected set_time"):
            await client.set_device_time(1)

    @pytest.mark.asyncio
    async def test_set_device_time_raises_on_none(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_time = AsyncMock(return_value=None)
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected set_time"):
            await client.set_device_time(1)


class TestBlePin:
    """`set_ble_pin` is write-only and security-sensitive — the wrapper
    MUST NOT log the pin value, only the action. We assert that
    explicitly via caplog so a future refactor doesn't leak it.
    """

    @pytest.mark.asyncio
    async def test_set_ble_pin_happy_path(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_devicepin = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        client._mc = fake_mc

        await client.set_ble_pin(123456)

        fake_mc.commands.set_devicepin.assert_awaited_once_with(123456)

    @pytest.mark.asyncio
    async def test_set_ble_pin_raises_on_error(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_devicepin = AsyncMock(
            return_value=MagicMock(type=EventType.ERROR),
        )
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected set_ble_pin"):
            await client.set_ble_pin(123456)

    @pytest.mark.asyncio
    async def test_set_ble_pin_raises_on_none(self):
        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_devicepin = AsyncMock(return_value=None)
        client._mc = fake_mc

        with pytest.raises(RuntimeError, match="Device rejected set_ble_pin"):
            await client.set_ble_pin(123456)

    @pytest.mark.asyncio
    async def test_set_ble_pin_does_not_log_value(self, caplog):
        """Guards against accidental logging of the pin in the audit
        stream. The wrapper logs ``RADIO ACTION=set_ble_pin`` only."""
        import logging

        client = MeshCoreClient(host="x", port=0)
        fake_mc = MagicMock(is_connected=True)
        fake_mc.commands.set_devicepin = AsyncMock(
            return_value=MagicMock(type=EventType.OK),
        )
        client._mc = fake_mc

        # The wrapper logs via `app.services.meshcore_client` (module-
        # level `log`); capture WARNING and above on the "app" tree.
        with caplog.at_level(logging.WARNING, logger="app.services.meshcore_client"):
            await client.set_ble_pin(987654)

        # At least one record was emitted for the action…
        action_records = [r for r in caplog.records if "set_ble_pin" in r.getMessage()]
        assert action_records, "expected a RADIO ACTION=set_ble_pin record"
        # …and none of them contain the pin digits.
        for record in caplog.records:
            assert "987654" not in record.getMessage()
