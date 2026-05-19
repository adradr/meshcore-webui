import json
from app.services.meshcore_client import WireEvent


def test_wire_event_to_dict_is_json_serializable():
    e = WireEvent(type="contact_message", payload={"text": "hi"}, attributes={"pubkey_prefix": "abc"})
    d = e.to_dict()
    json.dumps(d)
    assert d == {
        "type": "contact_message",
        "payload": {"text": "hi"},
        "attributes": {"pubkey_prefix": "abc"},
        "topic": "messages",
    }


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
