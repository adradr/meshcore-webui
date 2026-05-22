# External references

Read-only snapshots of upstream MeshCore documentation and code, checked in
so future Claude / dev sessions can grep the protocol details without
re-cloning over the network.

## What's here

- `meshcore/` — official protocol documentation
  ([github.com/meshcore-dev/MeshCore/tree/main/docs](https://github.com/meshcore-dev/MeshCore/tree/main/docs)).
  Most useful: `companion_protocol.md`, `packet_format.md`, `payloads.md`,
  `cli_commands.md` (firmware-side CLI, NOT the host-side `meshcore-cli`).

- `meshcore-cli-reference/meshcore_cli.py` — the first-party host-side CLI's
  main file ([github.com/meshcore-dev/meshcore-cli](https://github.com/meshcore-dev/meshcore-cli)).
  This is the canonical reference for what each high-level RF op (`ping`,
  `trace`, `dtrace`, `telemetry`, …) actually does at the lib level. Read
  this before reverse-engineering protocol behaviour from `meshcore-py`
  source — its high-level helpers are sparse and the *intent* lives here.

## Refresh

Re-run periodically; upstream evolves.

```bash
cd /tmp
rm -rf mc-fresh cli-fresh
git clone --depth 1 https://github.com/meshcore-dev/MeshCore.git mc-fresh
git clone --depth 1 https://github.com/meshcore-dev/meshcore-cli.git cli-fresh
cp mc-fresh/docs/*.md /Users/adr/Dev/meshcore-webui/docs/external/meshcore/
cp cli-fresh/src/meshcore_cli/meshcore_cli.py \
   /Users/adr/Dev/meshcore-webui/docs/external/meshcore-cli-reference/
```

`_assets/` and `_stylesheets/` are excluded — they're mkdocs presentation
artefacts and not useful as a code reference.
