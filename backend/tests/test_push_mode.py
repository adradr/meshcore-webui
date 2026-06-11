import pytest

from app.services.push_mode import get_mode, is_mention, set_mode


@pytest.mark.asyncio
async def test_default_mode_is_all(db, engine):
    from app.db.models import Base
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    assert (await get_mode(db)) == "all"


@pytest.mark.asyncio
async def test_set_mode_persists(db, engine):
    from app.db.models import Base
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)

    await set_mode(db, "mentions")
    assert (await get_mode(db)) == "mentions"
    await set_mode(db, "mute")
    assert (await get_mode(db)) == "mute"
    await set_mode(db, "all")
    assert (await get_mode(db)) == "all"


@pytest.mark.asyncio
async def test_set_mode_rejects_invalid(db, engine):
    from app.db.models import Base
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    with pytest.raises(ValueError):
        await set_mode(db, "loud")  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_get_mode_falls_back_for_invalid_stored_value(db, engine):
    """Defence against manual DB tampering or a future-mode the bridge
    can't reason about — get_mode must never blow up the hot push path."""
    from app.db.models import Base, Setting
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    db.add(Setting(key="push:mode", value="garbage"))
    await db.commit()
    assert (await get_mode(db)) == "all"


def test_is_mention_matches_brackets():
    assert is_mention("hey @[Mail03] ack", "Mail03") is True


def test_is_mention_matches_bare():
    assert is_mention("ping @Mail03 are you there", "Mail03") is True


def test_is_mention_case_insensitive():
    assert is_mention("@MAIL03 hi", "Mail03") is True
    assert is_mention("@mail03 hi", "Mail03") is True


def test_is_mention_word_boundary():
    # Should NOT match @Mail03X — different name with shared prefix
    assert is_mention("@Mail03X greetings", "Mail03") is False


def test_is_mention_no_self_name():
    assert is_mention("@Mail03 hi", None) is False
    assert is_mention("@Mail03 hi", "") is False


def test_is_mention_empty_text():
    assert is_mention("", "Mail03") is False


def test_is_mention_handles_emoji_in_self_name():
    assert is_mention("@[Mail03🇱🇻] yo", "Mail03🇱🇻") is True


def test_is_mention_no_mention_returns_false():
    assert is_mention("just a regular channel chatter", "Mail03") is False


def test_is_mention_at_end_of_string():
    # Bare form at end-of-string — no trailing char, word-boundary should hold.
    assert is_mention("ping @Mail03", "Mail03") is True


def test_is_mention_left_boundary_rejects_email_like_tokens():
    # `bob@Alice.net` is an email, not a mention of Alice.
    assert is_mention("contact me at bob@Alice.net", "Alice") is False
    assert is_mention("foo@Alice ok", "Alice") is False
    assert is_mention("v1.2@Alice", "Alice") is False


def test_is_mention_left_boundary_allows_punctuation_prefixes():
    assert is_mention("(@Alice) hi", "Alice") is True
    assert is_mention("hey,@Alice", "Alice") is True
    assert is_mention("@Alice leading", "Alice") is True
