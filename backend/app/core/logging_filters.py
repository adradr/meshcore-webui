"""Logging filters that scrub sensitive query parameters before records leave the process."""
from __future__ import annotations

import logging
import re

_SENSITIVE_RE = re.compile(
    r"(?P<sep>[?&])(?P<name>token|ticket|api_key|key)=(?P<value>[^&\s\"']+)",
    re.IGNORECASE,
)


def _scrub(text: str) -> str:
    return _SENSITIVE_RE.sub(
        lambda m: f"{m.group('sep')}{m.group('name')}=REDACTED",
        text,
    )


class SensitiveQueryFilter(logging.Filter):
    """Rewrite log records so bearer-like query params never appear in plaintext.

    We render the final message via ``record.getMessage()`` and scrub the result,
    then store it back as ``record.msg`` with ``record.args`` cleared. This is
    the only way to safely handle uvicorn's args-mode access log lines, where
    ``token=%s`` in the format string is matched by the regex and would leave
    the args tuple out of sync with the placeholders if we scrubbed each piece
    independently.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            rendered = record.getMessage()
        except Exception:
            # Formatting failed (mismatched args, etc.) — fall back to scrubbing
            # the raw msg/args so we never raise from inside a logging filter.
            if isinstance(record.msg, str):
                record.msg = _scrub(record.msg)
            return True
        scrubbed = _scrub(rendered)
        if scrubbed != rendered:
            record.msg = scrubbed
            record.args = None
        return True
