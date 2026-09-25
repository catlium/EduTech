#!/usr/bin/env rtk python3
# Blackbook figure-suffix swap (docs-only; NOT application source).
#
# The blackbook was originally compiled with monochrome figures referenced as
# figures/<name>-bw.pdf. The colour renderer (render-colour.py) now produces
# figures/<name>-colour.pdf for every source diagram and mcRendered the
# 4-per-page screenshot plates as plate-1.png / plate-2.png. This script
# rewrites every \includegraphics{figures/NAME-bw.pdf} reference in the
# sections + appendices to {figures/NAME-colour.pdf} — but ONLY for the
# diagrams that actually HAVE a -colour.pdf on disk, so a mid-batch render
# can never break a compile.
#
# Idempotent + restart-safe: figures/NAME-colour.pdf existence on disk gates
# each rewrite. Run once per session; re-run after the colour renderer
# completes to pick up any stragglers.

import glob
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
BLACKBOOK = os.path.join(REPO, "docs", "blackbook")
FIGURES = os.path.join(BLACKBOOK, "figures")

TEX_DIRS = [
    os.path.join(BLACKBOOK, "sections"),
    os.path.join(BLACKBOOK, "appendices"),
]

RE_BW = re.compile(r'\{\s*figures/(?P<name>[A-Za-z0-9_-]+)-bw\.pdf\s*\}')


def main() -> int:
    tex_files = []
    for d in TEX_DIRS:
        tex_files += glob.glob(os.path.join(d, "*.tex"))
    swapped = 0
    for tex in sorted(tex_files):
        with open(tex, "r", encoding="utf-8") as f:
            src = f.read()

        def repl(m: re.Match) -> str:
            nonlocal swapped
            name = m.group("name")
            colour = os.path.join(FIGURES, name + "-colour.pdf")
            if os.path.isfile(colour):
                swapped += 1
                return "{" + "figures/" + name + "-colour.pdf" + "}"
            return m.group(0)

        new = RE_BW.sub(repl, src)
        if new != src:
            with open(tex, "w", encoding="utf-8") as f:
                f.write(new)
            print(f"  updated {os.path.basename(tex)}")
    print(f"diagram figure refs now pointing at -colour.pdf: {swapped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
