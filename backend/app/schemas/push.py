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


class PushSubscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    endpoint: str
