"""Global push-notification mode (master switch).

Three-state filter applied to every push fan-out by the bridge BEFORE the
per-conversation mute check. Modes:

- ``all`` (default) — push for every inbound message (per-conversation mutes
  still apply downstream).
- ``mentions`` — push only when the device's ``adv_name`` is mentioned in a
  channel message. DMs always push because they are inherently targeted to
  the recipient.
- ``mute`` — global silence. Overrides every per-conversation preference.

Persisted as a single row in the existing ``settings`` key/value table under
the key ``push:mode``. Absence resolves to ``"all"`` so a fresh install has
the most-permissive behaviour.
"""
from __future__ import annotations

import re
from typing import Literal

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Setting

PushMode = Literal["all", "mentions", "mute"]
VALID_MODES: frozenset[PushMode] = frozenset({"all", "mentions", "mute"})
KEY = "push:mode"


async def get_mode(db: AsyncSession) -> PushMode:
    """Return the current global push mode (default ``"all"``).

    Defensive against a stale/invalid value in the table — anything outside
    ``VALID_MODES`` falls back to ``"all"`` so a manual DB edit can never
    crash the hot push path.
    """
    row = (
        await db.execute(select(Setting).where(Setting.key == KEY))
    ).scalar_one_or_none()
    val = row.value if row else "all"
    return val if val in VALID_MODES else "all"  # type: ignore[return-value]


async def set_mode(db: AsyncSession, mode: PushMode) -> None:
    """Persist the global push mode. Raises ``ValueError`` for invalid input."""
    if mode not in VALID_MODES:
        raise ValueError(f"invalid mode: {mode}")
    stmt = (
        sqlite_insert(Setting)
        .values(key=KEY, value=mode)
        .on_conflict_do_update(
            index_elements=["key"], set_={"value": mode},
        )
    )
    await db.execute(stmt)
    await db.commit()


def is_mention(text: str, self_name: str | None) -> bool:
    """Return ``True`` iff ``text`` contains an @-mention of ``self_name``.

    Matches two surface forms (case-insensitive):
      - ``"@[Name]"`` — explicit bracket form used by some clients
      - ``"@Name"``   — bare form, with a word-boundary on the right so
        ``"@Mail03"`` does NOT match against ``self_name="Mail0"``.

    Defensive nulls: empty/missing ``self_name`` or ``text`` → ``False``.
    """
    if not self_name or not text:
        return False
    # Escape regex metachars in self_name — it can contain emoji + unicode
    # that would otherwise be interpreted as regex syntax.
    escaped = re.escape(self_name)
    # Left guard keeps email-like tokens (``bob@Alice.net``) from counting
    # as a mention; right guard keeps ``@Mail03`` from matching ``Mail0``.
    pattern = rf"(?<![\w.-])@\[?{escaped}\]?(?![\w-])"
    return bool(re.search(pattern, text, re.IGNORECASE))
