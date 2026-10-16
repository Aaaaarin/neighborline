"""Merge Fontsource's Be Vietnam Pro subsets (latin, latin-ext, vietnamese; .woff = zlib, no brotli needed)
into one TTF per weight, so libass has every glyph (stacked Vietnamese diacritics included) in a single face.

usage: python3 fonts.py <fontsource files dir> <out dir>
"""
import os
import sys

from fontTools.merge import Merger
from fontTools.ttLib import TTFont

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
for weight, style in (("400", "Regular"), ("600", "SemiBold")):
    parts = []
    for subset in ("latin", "latin-ext", "vietnamese"):
        f = TTFont(os.path.join(src, f"be-vietnam-pro-{subset}-{weight}-normal.woff"))
        f.flavor = None
        p = os.path.join(out, f"_{subset}-{weight}.ttf")
        f.save(p)
        parts.append(p)
    merged = Merger().merge(parts)
    # One family, two styles: libass picks by family name + weight.
    for rec in merged["name"].names:
        if rec.nameID in (1, 16):
            rec.string = "Be Vietnam Pro"
        elif rec.nameID in (2, 17):
            rec.string = style
        elif rec.nameID == 4:
            rec.string = f"Be Vietnam Pro {style}"
        elif rec.nameID == 6:
            rec.string = f"BeVietnamPro-{style}"
    merged["OS/2"].usWeightClass = int(weight)
    merged.save(os.path.join(out, f"BeVietnamPro-{style}.ttf"))
    for p in parts:
        os.remove(p)
    cmap = TTFont(os.path.join(out, f"BeVietnamPro-{style}.ttf")).getBestCmap()
    missing = [c for c in "Đúng rồiTiền đã đếnNghe lạiữặố→·…“”’" if ord(c) not in cmap]
    print(f"BeVietnamPro-{style}.ttf glyphs={len(cmap)} missing={''.join(missing)!r}")
