import logging

from app.core.logging_filters import AccessLogQueryFilter, SensitiveQueryFilter


def _record(msg, args=None):
    return logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname="",
        lineno=0,
        msg=msg,
        args=args,
        exc_info=None,
    )


def test_redacts_token_query_param():
    f = SensitiveQueryFilter()
    rec = _record('127.0.0.1:1234 - "GET /ws?token=supersecret HTTP/1.1" 101')
    assert f.filter(rec) is True
    assert "supersecret" not in rec.getMessage()
    assert "token=REDACTED" in rec.getMessage()


def test_redacts_ticket_query_param():
    f = SensitiveQueryFilter()
    rec = _record("GET /ws?ticket=abc123")
    f.filter(rec)
    assert "abc123" not in rec.getMessage()
    assert "ticket=REDACTED" in rec.getMessage()


def test_redacts_api_key_and_key_query_params():
    f = SensitiveQueryFilter()
    rec = _record("GET /api/something?api_key=foo&key=bar&unrelated=keep")
    f.filter(rec)
    msg = rec.getMessage()
    assert "foo" not in msg
    assert "bar" not in msg
    assert "unrelated=keep" in msg


def test_leaves_other_query_params_intact():
    f = SensitiveQueryFilter()
    rec = _record('GET /api/messages?contact_pub_key=ff00&limit=50')
    f.filter(rec)
    msg = rec.getMessage()
    assert "contact_pub_key=ff00" in msg
    assert "limit=50" in msg


def test_redacts_within_positional_args():
    f = SensitiveQueryFilter()
    rec = _record(
        '%s "GET /ws?token=%s HTTP/1.1" %s',
        args=("127.0.0.1", "leaky", "101"),
    )
    f.filter(rec)
    msg = rec.getMessage()
    assert "leaky" not in msg
    assert "token=REDACTED" in msg


def test_case_insensitive_param_names():
    f = SensitiveQueryFilter()
    rec = _record("GET /ws?Token=Mixed&TICKET=upper")
    f.filter(rec)
    msg = rec.getMessage()
    assert "Mixed" not in msg
    assert "upper" not in msg


def test_returns_true_so_record_is_emitted():
    """Filter must not drop the record — only rewrite the message."""
    f = SensitiveQueryFilter()
    rec = _record("nothing sensitive here")
    assert f.filter(rec) is True

# ---------------------------------------------------------------------------
# AccessLogQueryFilter — uvicorn.access-safe redaction (preserves args tuple)
# ---------------------------------------------------------------------------


def _access_record(full_path):
    """Shape of a real uvicorn.access record: 5-tuple positional args."""
    return _record(
        '%s - "%s %s HTTP/%s" %d',
        args=("127.0.0.1:1234", "GET", full_path, "1.1", 200),
    )


def test_access_filter_scrubs_path_arg():
    f = AccessLogQueryFilter()
    rec = _access_record("/api/messages?token=supersecret&limit=5")
    assert f.filter(rec) is True
    assert "supersecret" not in rec.getMessage()
    assert "token=REDACTED" in rec.getMessage()
    assert "limit=5" in rec.getMessage()


def test_access_filter_preserves_args_tuple_shape():
    """uvicorn's AccessFormatter destructures record.args as a 5-tuple —
    the filter must keep it a 5-tuple with non-strings untouched."""
    f = AccessLogQueryFilter()
    rec = _access_record("/api/x?api_key=leaky")
    f.filter(rec)
    assert isinstance(rec.args, tuple)
    assert len(rec.args) == 5
    client_addr, method, full_path, _http_version, status = rec.args
    assert client_addr == "127.0.0.1:1234"
    assert method == "GET"
    assert "leaky" not in full_path
    assert "api_key=REDACTED" in full_path
    assert status == 200  # int untouched


def test_access_formatter_still_formats_after_filter():
    """End-to-end: uvicorn's AccessFormatter must not crash on a filtered
    record (regression for the original 'clears args' breakage)."""
    from uvicorn.logging import AccessFormatter

    f = AccessLogQueryFilter()
    rec = _access_record("/ws?token=hunter2")
    f.filter(rec)
    out = AccessFormatter(
        fmt='%(client_addr)s - "%(request_line)s" %(status_code)s',
        use_colors=False,
    ).format(rec)
    assert "hunter2" not in out
    assert "token=REDACTED" in out


def test_access_filter_noop_without_sensitive_params():
    f = AccessLogQueryFilter()
    rec = _access_record("/api/health")
    assert f.filter(rec) is True
    assert "/api/health" in rec.getMessage()
