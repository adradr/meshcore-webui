import json
from app.services.meshcore_client import WireEvent


def test_wire_event_to_dict_is_json_serializable():
    e = WireEvent(type="contact_message", payload={"text": "hi"}, attributes={"pubkey_prefix": "abc"})
    d = e.to_dict()
    json.dumps(d)
    assert d == {"type": "contact_message", "payload": {"text": "hi"}, "attributes": {"pubkey_prefix": "abc"}}
