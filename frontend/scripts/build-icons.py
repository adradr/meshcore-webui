"""Rasterize SVG masters to all PWA + favicon PNG sizes.

Run: cd frontend && python scripts/build-icons.py
Or:  cd frontend && uv run --with cairosvg --with pillow python scripts/build-icons.py

The script tries renderers in order: cairosvg, then svglib+reportlab,
then a Pillow-only fallback that programmatically draws the mesh icon.
"""

from io import BytesIO
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"
ICONS = PUBLIC / "icons"


def _try_cairosvg():
    try:
        import cairosvg  # type: ignore[import-not-found]
        from PIL import Image  # type: ignore[import-not-found]
    except Exception:
        return None

    def render(svg_path: Path, out_path: Path, size: int) -> None:
        png_bytes = cairosvg.svg2png(
            url=str(svg_path), output_width=size, output_height=size
        )
        Image.open(BytesIO(png_bytes)).save(out_path)

    return render


def _try_svglib():
    try:
        from PIL import Image  # type: ignore[import-not-found]
        from reportlab.graphics import renderPM  # type: ignore[import-not-found]
        from svglib.svglib import svg2rlg  # type: ignore[import-not-found]
    except Exception:
        return None

    def render(svg_path: Path, out_path: Path, size: int) -> None:
        drawing = svg2rlg(str(svg_path))
        scale = size / max(drawing.width, drawing.height)
        drawing.width *= scale
        drawing.height *= scale
        drawing.scale(scale, scale)
        # Render at requested resolution, then save via Pillow for parity.
        raw = renderPM.drawToString(drawing, fmt="PNG")
        Image.open(BytesIO(raw)).save(out_path)

    return render


def _pillow_fallback():
    """Pure-Pillow renderer that programmatically draws the mesh icon.

    Only used when no SVG library is available. The icon design is hand-coded
    to match the SVG masters.
    """
    try:
        from PIL import Image, ImageDraw  # type: ignore[import-not-found]
    except Exception as exc:  # pragma: no cover - guarded by callers
        raise RuntimeError("Pillow is required for the fallback renderer") from exc

    BG = (10, 10, 10, 255)
    FG = (8, 145, 178, 255)  # cyan-600
    FG_FADED = (8, 145, 178, 115)
    WHITE = (255, 255, 255, 255)

    def _draw_mesh(
        size: int, inset: float = 0.0, masked: bool = False
    ) -> "Image.Image":
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        s = size / 512
        if masked:
            d.rectangle([0, 0, size, size], fill=BG)
        else:
            rad = int(size * 0.225)
            d.rounded_rectangle([0, 0, size, size], radius=rad, fill=BG)

        cx, cy = 256, 256
        offset = 116 * (1.0 - inset)
        nodes = [
            (cx - offset, cy - offset),
            (cx + offset, cy - offset),
            (cx - offset, cy + offset),
            (cx + offset, cy + offset),
        ]

        stroke = max(2, int(14 * s))

        # edges from center
        for nx, ny in nodes:
            d.line(
                [(nx * s, ny * s), (cx * s, cy * s)],
                fill=FG,
                width=stroke,
            )

        # perimeter edges (faded)
        perim = [
            (nodes[0], nodes[1]),
            (nodes[0], nodes[2]),
            (nodes[1], nodes[3]),
            (nodes[2], nodes[3]),
        ]
        for a, b in perim:
            d.line(
                [(a[0] * s, a[1] * s), (b[0] * s, b[1] * s)],
                fill=FG_FADED,
                width=stroke,
            )

        # outer nodes
        r = 32 * s
        outline_w = max(1, int(6 * s))
        for nx, ny in nodes:
            d.ellipse(
                [nx * s - r, ny * s - r, nx * s + r, ny * s + r],
                fill=FG,
                outline=WHITE,
                width=outline_w,
            )

        # center node (white halo + cyan core)
        r = 46 * s
        d.ellipse([cx * s - r, cy * s - r, cx * s + r, cy * s + r], fill=WHITE)
        r = 34 * s
        d.ellipse([cx * s - r, cy * s - r, cx * s + r, cy * s + r], fill=FG)
        return img

    def _draw_badge(size: int) -> "Image.Image":
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        s = size / 96
        stroke = max(1, int(3 * s))

        nodes = [(30, 30), (66, 30), (30, 66), (66, 66)]
        for nx, ny in nodes:
            d.line(
                [(nx * s, ny * s), (48 * s, 48 * s)],
                fill=WHITE,
                width=stroke,
            )
        for nx, ny in nodes:
            r = 8 * s
            d.ellipse(
                [nx * s - r, ny * s - r, nx * s + r, ny * s + r], fill=WHITE
            )
        r = 11 * s
        d.ellipse([48 * s - r, 48 * s - r, 48 * s + r, 48 * s + r], fill=WHITE)
        return img

    def render(svg_path: Path, out_path: Path, size: int) -> None:
        name = svg_path.name
        if name == "source.svg":
            img = _draw_mesh(size, inset=0.0, masked=False)
        elif name == "source-maskable.svg":
            img = _draw_mesh(size, inset=0.15, masked=True)
        elif name == "source-badge.svg":
            img = _draw_badge(size)
        else:
            raise ValueError(f"unknown svg source: {name}")
        img.save(out_path)

    return render


def _pick_renderer():
    for factory, name in (
        (_try_cairosvg, "cairosvg"),
        (_try_svglib, "svglib"),
        (_pillow_fallback, "pillow"),
    ):
        renderer = factory()
        if renderer is not None:
            print(f"renderer: {name}")
            return renderer
    raise RuntimeError("no SVG renderer available")


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    src = ICONS / "source.svg"
    maskable = ICONS / "source-maskable.svg"
    badge = ICONS / "source-badge.svg"
    for path in (src, maskable, badge):
        if not path.exists():
            raise SystemExit(f"missing SVG source: {path}")

    render = _pick_renderer()

    targets = [
        (src, ICONS / "pwa-192x192.png", 192),
        (src, ICONS / "pwa-512x512.png", 512),
        (maskable, ICONS / "pwa-maskable-192x192.png", 192),
        (maskable, ICONS / "pwa-maskable-512x512.png", 512),
        (src, ICONS / "apple-touch-icon-180x180.png", 180),
        (src, ICONS / "favicon-16x16.png", 16),
        (src, ICONS / "favicon-32x32.png", 32),
        (src, ICONS / "favicon-64x64.png", 64),
        (badge, ICONS / "badge-72x72.png", 72),
    ]
    for svg_path, out_path, size in targets:
        render(svg_path, out_path, size)
        print(f"  -> {out_path.relative_to(PUBLIC.parent)}")

    (PUBLIC / "favicon.svg").write_bytes(src.read_bytes())
    print("  -> public/favicon.svg")


if __name__ == "__main__":
    main()
