from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class LocalResetScope(str, Enum):
    """What slice of local server state to wipe.

    - ``messages``: chat history only (``messages`` table).
    - ``all``: every per-user table EXCEPT ``push_subscriptions`` — see
      :func:`app.services.reset.reset_local_all` for the exact list.
    - ``push``: web-push subscribers only; every browser must re-enroll.
    """

    MESSAGES = "messages"
    ALL = "all"
    PUSH = "push"


class LocalResetRequest(BaseModel):
    """POST body for ``/api/admin/reset/local``.

    ``confirm`` is a free-form non-empty string supplied by the UI to
    prove the click was deliberate (the API doesn't validate its content
    — it's just an anti-fat-finger gate).
    """

    scope: LocalResetScope
    confirm: str = Field(..., min_length=1)


DeviceResetMode = Literal["soft", "factory"]


class DeviceResetRequest(BaseModel):
    """POST body for the device-side reset endpoint.

    Two modes mirror the radio firmware commands:

    - ``soft``: reboot the node, keep persisted state.
    - ``factory``: full firmware factory reset (clears keys + identity).
    """

    mode: DeviceResetMode
    confirm: str = Field(..., min_length=1)
