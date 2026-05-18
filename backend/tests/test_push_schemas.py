import pytest
from pydantic import ValidationError

from app.schemas.push import PushSubscriptionIn, PushUnsubscribeIn


def test_subscription_accepts_valid():
    p = PushSubscriptionIn(
        endpoint="https://updates.push.services.mozilla.com/wpush/v2/abc",
        keys={"p256dh": "p" * 20, "auth": "a" * 20},
    )
    assert str(p.endpoint).startswith("https://")


def test_subscription_rejects_extra_keys():
    with pytest.raises(ValidationError):
        PushSubscriptionIn(
            endpoint="https://push.example/x",
            keys={"p256dh": "p" * 20, "auth": "a" * 20, "extra": "bad"},
        )


def test_unsubscribe_requires_endpoint():
    with pytest.raises(ValidationError):
        PushUnsubscribeIn()  # type: ignore[call-arg]
