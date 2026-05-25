from __future__ import annotations
from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class PushKeys(BaseModel):
    model_config = ConfigDict(extra="forbid")
    p256dh: str = Field(min_length=10, max_length=200)
    auth: str = Field(min_length=10, max_length=50)


class PushSubscriptionIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    endpoint: HttpUrl
    keys: PushKeys
    expirationTime: int | None = None


class PushUnsubscribeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    endpoint: HttpUrl


class PushResubscribeIn(BaseModel):
    """Wire shape for the SW-bridged resubscribe call.

    The browser fires ``pushsubscriptionchange`` when the user agent rotates
    the push endpoint (e.g. Firefox after a long offline period). The SW
    cannot carry the bearer token, so it forwards the new subscription to
    an open page via ``postMessage`` and the page POSTs here. The handler
    swaps the row: deletes ``old_endpoint`` (if present) and upserts ``new``.
    """
    model_config = ConfigDict(extra="forbid")
    old_endpoint: HttpUrl
    new: PushSubscriptionIn


class PushSubscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    endpoint: str
