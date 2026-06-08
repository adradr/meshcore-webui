import pytest


@pytest.mark.asyncio
async def test_get_default_disabled(client):
    r = await client.get("/api/push/new-contact")
    assert r.status_code == 200
    assert r.json() == {"enabled": False}


@pytest.mark.asyncio
async def test_put_then_get(client):
    r = await client.put("/api/push/new-contact", json={"enabled": True})
    assert r.status_code == 200
    assert r.json() == {"enabled": True}

    r2 = await client.get("/api/push/new-contact")
    assert r2.status_code == 200
    assert r2.json() == {"enabled": True}


@pytest.mark.asyncio
async def test_put_false_persists(client):
    await client.put("/api/push/new-contact", json={"enabled": True})
    r = await client.put("/api/push/new-contact", json={"enabled": False})
    assert r.status_code == 200
    assert r.json() == {"enabled": False}
    r2 = await client.get("/api/push/new-contact")
    assert r2.json() == {"enabled": False}


@pytest.mark.asyncio
async def test_put_rejects_extra_fields(client):
    r = await client.put(
        "/api/push/new-contact", json={"enabled": True, "extra": "field"}
    )
    assert r.status_code == 422  # extra="forbid"
