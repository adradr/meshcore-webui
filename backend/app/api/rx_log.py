"""``GET /api/rx-log`` and ``GET /api/rx-log/export`` — RX buffer access.

The radio's recent RX events are kept in an in-memory rolling buffer
(``RxLogBuffer``, populated from ``RX_LOG_DATA`` events by the meshcore
client). These endpoints expose that buffer to the UI:

* ``GET /api/rx-log`` returns a JSON snapshot, optionally filtered by
  ``limit`` (most-recent N) and ``since`` (a ``recv_time`` cutoff).
* ``GET /api/rx-log/export`` streams the whole snapshot as a CSV or JSON
  download for offline inspection.

Important: ``recv_time`` in ``RX_LOG_DATA`` is the device's *uptime in
milliseconds* per the meshcore library, NOT a wall-clock Unix timestamp.
For v1 the ``since`` parameter is treated as a ``recv_time`` cutoff
directly — callers comparing across reboots should be aware that
``recv_time`` resets to zero on every firmware boot.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import time

from fastapi import APIRouter, Depends, Query, Response

from app.deps import get_meshcore_client
from app.schemas.rx_log import RxLogEntry, RxLogResponse
from app.services.meshcore_client import MeshCoreClient

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rx-log", tags=["rx-log"])

# Columns exposed in the CSV export. Order is part of the file format
# contract: the frontend / external tools depend on this header layout.
CSV_COLUMNS = [
    "recv_time",
    "snr",
    "rssi",
    "payload_length",
    "route_typename",
    "payload_typename",
    "pkt_hash",
    "path",
    "raw_hex",
]


# Leading characters that spreadsheet apps (Excel, Sheets, LibreOffice)
# interpret as a formula. RX-log fields are radio-derived — any nearby
# node can transmit them — so a cell like "=CMD(...)" must never reach
# an operator's spreadsheet unescaped.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(value: object) -> object:
    """Neutralize spreadsheet formula injection in string cells.

    Strings starting with a formula trigger are prefixed with a single
    quote (the conventional spreadsheet 'treat as text' escape). Numeric
    values pass through untouched so negative SNR/RSSI stay numbers.
    ``None`` becomes the empty string (matches the previous behaviour).
    """
    if value is None:
        return ""
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


@router.get("", response_model=RxLogResponse)
def get_rx_log(
    limit: int = Query(default=200, ge=1, le=1000),
    since: int | None = Query(default=None, ge=0),
    client: MeshCoreClient = Depends(get_meshcore_client),
) -> RxLogResponse:
    """Return a snapshot of the RX buffer, optionally filtered.

    Args:
        limit: Maximum number of entries to return; the *most recent*
            ``limit`` entries are kept (snapshot is oldest-first, so we
            slice from the tail). Capped at 1000 to bound response size.
        since: If provided, only entries with ``recv_time > since`` are
            included. NOTE: ``recv_time`` is device uptime in ms, NOT a
            wall-clock Unix timestamp — this filter is therefore only
            meaningful within a single firmware boot.

    Returns:
        ``RxLogResponse`` with ``items`` (oldest-first), the full
        ``total_buffered`` count (pre-filter), and the actually
        ``returned`` count after filtering and limit.
    """
    snap = client.rx_log_snapshot()
    total_buffered = len(snap)

    if since is not None:
        snap = [e for e in snap if (e.get("recv_time") or 0) > since]

    items_raw = snap[-limit:] if len(snap) > limit else snap
    items = [RxLogEntry(**e) for e in items_raw]
    return RxLogResponse(
        items=items,
        total_buffered=total_buffered,
        returned=len(items),
    )


@router.get("/export")
def export_rx_log(
    format: str = Query(default="csv", pattern="^(csv|json)$"),
    client: MeshCoreClient = Depends(get_meshcore_client),
) -> Response:
    """Stream the entire RX buffer as a downloadable CSV or JSON file.

    Unlike ``GET /api/rx-log``, this endpoint never applies a limit —
    it's intended for offline inspection / archival, so the caller gets
    the full buffer. The ``Content-Disposition: attachment`` header
    prompts the browser to download rather than render the response.
    """
    snap = client.rx_log_snapshot()
    ts = int(time.time() * 1000)

    if format == "json":
        body = json.dumps(snap, default=str)
        return Response(
            content=body,
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="rx-log-{ts}.json"',
            },
        )

    buf = io.StringIO()
    # ``lineterminator="\n"`` overrides csv's default ``\r\n`` so the
    # exported file has consistent line endings across platforms and the
    # contract is trivial to parse with a plain ``str.split("\n")``.
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for e in snap:
        writer.writerow(
            [_csv_safe(e.get(c)) for c in CSV_COLUMNS]
        )
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="rx-log-{ts}.csv"',
        },
    )
