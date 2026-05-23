from __future__ import annotations

VIEWER_TEMPLATE = """\
<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Shared image · meshcore-webui</title>
  <meta property="og:type" content="image">
  <meta property="og:image" content="{base_url}/i/{slug}">
  <meta property="og:image:width" content="{width}">
  <meta property="og:image:height" content="{height}">
  <meta name="twitter:card" content="summary_large_image">
  <style>html,body{{margin:0;background:#111;color:#ddd;font:14px system-ui}}
         main{{min-height:100vh;display:flex;align-items:center;justify-content:center}}
         img{{max-width:100vw;max-height:100vh;object-fit:contain;display:block}}
         footer{{position:fixed;bottom:8px;right:12px;opacity:.5;font-size:12px}}</style>
</head><body><main>
  <img src="/i/{slug}" alt="" width="{width}" height="{height}">
</main><footer>shared via meshcore-webui</footer></body></html>
"""

GONE_TEMPLATE = """\
<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Link no longer available</title>
  <style>html,body{margin:0;background:#111;color:#ddd;font:14px system-ui;
         display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}</style>
</head><body><div>
  <p style="font-size:18px;margin:0 0 8px">This link is no longer available.</p>
  <p style="opacity:.6;margin:0">shared via meshcore-webui</p>
</div></body></html>
"""
