import pytest


@pytest.mark.asyncio
async def test_get_default_mode(client):
    r = await client.get("/api/push/mode")
    assert r.status_code == 200
    assert r.json() == {"mode": "all"}


@pytest.mark.asyncio
async def test_put_then_get(client):
    r = await client.put("/api/push/mode", json={"mode": "mentions"})
    assert r.status_code == 200
    assert r.json() == {"mode": "mentions"}

    r2 = await client.get("/api/push/mode")
    assert r2.status_code == 200
    assert r2.json() == {"mode": "mentions"}


@pytest.mark.asyncio
async def test_put_rejects_invalid_mode(client):
    r = await client.put("/api/push/mode", json={"mode": "loud"})
    assert r.status_code == 422  # pydantic Literal validation


@pytest.mark.asyncio
async def test_put_rejects_extra_fields(client):
    r = await client.put(
        "/api/push/mode", json={"mode": "all", "extra": "field"}
    )
    assert r.status_code == 422  # extra="forbid"


@pytest.mark.asyncio
async def test_mode_round_trip_all_three(client):
    for mode in ("all", "mentions", "mute", "all"):
        r = await client.put("/api/push/mode", json={"mode": mode})
        assert r.status_code == 200, r.text
        assert r.json() == {"mode": mode}
        r2 = await client.get("/api/push/mode")
        assert r2.json() == {"mode": mode}
