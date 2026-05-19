import threading

import pytest

from app.services.rx_log_buffer import RxLogBuffer


def test_buffer_starts_empty():
    buf = RxLogBuffer(capacity=10)
    assert len(buf) == 0
    assert buf.snapshot() == []


def test_buffer_appends_in_order():
    buf = RxLogBuffer(capacity=5)
    for i in range(3):
        buf.append({"i": i})
    assert [it["i"] for it in buf.snapshot()] == [0, 1, 2]
    assert len(buf) == 3


def test_buffer_evicts_oldest_when_full():
    buf = RxLogBuffer(capacity=3)
    for i in range(5):
        buf.append({"i": i})
    assert [it["i"] for it in buf.snapshot()] == [2, 3, 4]
    assert len(buf) == 3


def test_buffer_clear_resets_state():
    buf = RxLogBuffer(capacity=3)
    buf.append({"i": 1})
    buf.append({"i": 2})
    buf.clear()
    assert len(buf) == 0
    assert buf.snapshot() == []


def test_buffer_snapshot_returns_copy_not_reference():
    buf = RxLogBuffer(capacity=3)
    buf.append({"i": 1})
    snap = buf.snapshot()
    buf.append({"i": 2})
    # Snapshot from before the second append should still be length 1
    assert len(snap) == 1


def test_buffer_thread_safe_under_concurrent_appends():
    buf = RxLogBuffer(capacity=1000)
    N_THREADS = 4
    PER_THREAD = 250

    def worker(thread_id: int):
        for i in range(PER_THREAD):
            buf.append({"t": thread_id, "i": i})

    threads = [threading.Thread(target=worker, args=(t,)) for t in range(N_THREADS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    snap = buf.snapshot()
    assert len(snap) == 1000
    # All N_THREADS x PER_THREAD items should be present (just unordered across threads)
    expected = {(t, i) for t in range(N_THREADS) for i in range(PER_THREAD)}
    actual = {(it["t"], it["i"]) for it in snap}
    assert actual == expected


def test_buffer_invalid_capacity_raises():
    with pytest.raises(ValueError):
        RxLogBuffer(capacity=0)
    with pytest.raises(ValueError):
        RxLogBuffer(capacity=-5)
