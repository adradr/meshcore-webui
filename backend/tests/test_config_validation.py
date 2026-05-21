from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_empty_api_key_string_is_rejected():
    """A common operational mistake: `MESHCORE_WEBUI_API_KEY=` (or an empty
    Docker Compose env entry) sets the value to an empty string, not None.
    Without min_length=1, `f"Bearer {api_key}"` becomes the literal string
    `"Bearer "` and any client sending that header is authenticated. Refuse
    the empty value at startup."""
    with pytest.raises(ValidationError) as exc:
        Settings(MESHCORE_WEBUI_API_KEY="")  # type: ignore[call-arg]
    assert "at least 1 character" in str(exc.value).lower() or "min_length" in str(exc.value).lower()


def test_unset_api_key_is_allowed_as_open_mode():
    """Leaving the variable unset is an explicit opt-in to open-access mode
    (logged at startup as `api key : DISABLED (open access)`). Only the
    empty-string case is rejected."""
    s = Settings()  # type: ignore[call-arg]
    assert s.api_key is None


def test_real_api_key_is_accepted():
    s = Settings(MESHCORE_WEBUI_API_KEY="x" * 32)  # type: ignore[call-arg]
    assert s.api_key == "x" * 32
