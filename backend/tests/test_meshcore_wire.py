import json

from app.services.meshcore_client import WireEvent


def test_wire_event_to_dict_is_json_serializable():
    e = WireEvent(
        type="contact_message", payload={"text": "hi"}, attributes={"pubkey_prefix": "abc"}
    )
    d = e.to_dict()
    json.dumps(d)
    assert d == {
        "type": "contact_message",
        "payload": {"text": "hi"},
        "attributes": {"pubkey_prefix": "abc"},
        "topic": "system",
    }


def test_wire_event_topic_defaults_to_system():
    from app.services.meshcore_client import WireEvent
    ev = WireEvent(type="acknowledgement", payload={})
    assert ev.topic == "system"


def test_wire_event_topic_defaults_to_messages_for_existing_types():
    from app.services.meshcore_client import topic_for_event_type
    assert topic_for_event_type("contact_message") == "messages"
    assert topic_for_event_type("channel_message") == "messages"
    assert topic_for_event_type("acknowledgement") == "messages"
    assert topic_for_event_type("connected") == "system"
    assert topic_for_event_type("rx_log_data") == "rx_log"
    assert topic_for_event_type("stats_radio") == "noise"
    assert topic_for_event_type("trace_data") == "trace"


def test_topic_for_event_type_unknown_falls_back_to_system():
    from app.services.meshcore_client import topic_for_event_type
    assert topic_for_event_type("completely_unknown_type_zzz") == "system"


def test_topic_map_keys_match_real_event_type_values():
    """Catches drift between hardcoded wire-type strings and meshcore.events.EventType.value."""
    from meshcore.events import EventType

    from app.services.meshcore_client import TOPIC_MAP
    valid_values = {e.value for e in EventType}
    for key in TOPIC_MAP:
        assert key in valid_values, f"TOPIC_MAP key '{key}' is not a valid EventType.value"


def test_topic_map_covers_all_forwarded_events():
    """Ensure every forwarded event type has an explicit TOPIC_MAP entry.

    Mirrors the wire-type derivation used in MeshCoreClient._on_event
    (wire_type = event.type.value) so additions to _FORWARDED_EVENTS
    can't silently fall back to "system".
    """
    from app.services.meshcore_client import TOPIC_MAP, MeshCoreClient
    for ev_type in MeshCoreClient._FORWARDED_EVENTS:
        wire_type = ev_type.value
        assert wire_type in TOPIC_MAP, (
            f"Missing TOPIC_MAP entry for forwarded event type '{wire_type}'"
        )
