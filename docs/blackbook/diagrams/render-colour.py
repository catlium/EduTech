#!/usr/bin/env rtk python3
# Blackbook colour renderer (docs-only, NOT application source).
#
# Takes every diagrams/source/*-bw.mmd and renders it in FULL COLOUR
# (mermaid default palette, coloured node/edge fills) but forces ALL TEXT
# black (#000000), producing figures/<name>-colour.svg and figures/<name>-colour.pdf
# in the repo (so it survives restarts). Also assembles figures/plate-*.pdf
# as 4-per-page colour screenshot plates via Pillow when app-*.png are present.
#
# Output land in docs/blackbook/figures (real repo paths, not /tmp), so this
# is restart-safe: run it once per session; it only re-writes colour pdfs that
# don't yet exist with -mtime thresholding, i.e. it does not churn unchanged
# outputs.
#
# Requires: mmdc (mermaid-cli) + the opencode-svgpdf go.mjs (SVG->PDF at native
# scale) from the mermaid-cli install. Paths below are discovered once.

import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(REPO, "docs", "blackbook", "diagrams", "source")
FIG = os.path.join(REPO, "docs", "blackbook", "figures")
os.makedirs(FIG, exist_ok=True)


def find_mmdc_and_go():
    nvm = os.path.expanduser("~/.nvm/versions/node")
    cands = []
    if os.path.isdir(nvm):
        for v in sorted(os.listdir(nvm)):
            cands.append(os.path.join(nvm, v, "bin", "mmdc"))
    cands += [
        shutil.which("mmdc") or "",
        "/usr/bin/mmdc",
    ]
    mmdc = next((c for c in cands if c and os.path.isfile(c)), None)
    base = os.path.dirname(os.path.dirname(mmdc or "/"))
    mmlib = os.path.join(base, "lib", "node_modules", "@mermaid-js", "mermaid-cli")
    go = os.path.join(mmlib, "opencode-svgpdf", "go.mjs")
    if not os.path.isfile(go):
        go = os.path.join(base, "lib", "node_modules", "@mermaid-js", "mermaid-cli", "go.mjs")
    return mmdc, go


COLOUR_CFG = {
    "theme": "base",
    "themeVariables": {
        "primaryTextColor": "#000000",
        "secondaryTextColor": "#000000",
        "tertiaryTextColor": "#000000",
        "lineColor": "#333333",
        "edgeLabelBackground": "#ffffff",
        "primaryColor": "#D6E8FF",
        "secondaryColor": "#FFF2CC",
        "tertiaryColor": "#E1F5E4",
        "primaryBorderColor": "#3B6FB0",
        "secondaryBorderColor": "#B07C3B",
        "tertiaryBorderColor": "#2E8B57",
        "actorBkg": "#D6E8FF",
        "actorBorder": "#3B6FB0",
        "actorTextColor": "#000000",
        "labelBoxBkgColor": "#FFF2CC",
        "labelBoxBorderColor": "#B07C3B",
        "noteBkgColor": "#FFF2CC",
        "noteBorderColor": "#B07C3B",
        "noteTextColor": "#000000",
        "loopTextColor": "#000000",
        "signalColor": "#333333",
        "signalTextColor": "#000000",
        "activationBkgColor": "#E1F5E4",
        "activationBorderColor": "#2E8B57",
        "sequenceNumberColor": "#000000",
        "sectionBkgColor": "#FFF2CC",
        "altSectionBkgColor": "#D6E8FF",
        "classText": "#000000",
        "fillType0": "#D6E8FF",
        "fillType1": "#FFF2CC",
        "fillType2": "#E1F5E4",
        "fillType3": "#F2D7EE",
        "fillType4": "#E8E8FF",
        "fontSize": "18px",
        "fontFamily": "ui-monospace, Menlo, monospace",
    },
}


def render_colour_diagrams(mmdc, go):
    mmd_files = sorted(glob.glob(os.path.join(SRC, "*-bw.mmd")))
    if not mmd_files:
        print("no *-bw.mmd sources in", SRC)
        return 0
    tmp = tempfile.mkdtemp(prefix="colour-")
    cfgpath = os.path.join(tmp, "mermaid-colour.json")
    with open(cfgpath, "w") as f:
        json.dump(COLOUR_CFG, f, indent=1)
    done = 0
    for i, mmd in enumerate(mmd_files, 1):
        base = os.path.basename(mmd)[: -len("-bw.mmd")]
        svg = os.path.join(FIG, base + "-colour.svg")
        pdf = os.path.join(FIG, base + "-colour.pdf")
        # skip output that already exists and is newer than the source
        if os.path.isfile(pdf) and os.path.getmtime(pdf) >= os.path.getmtime(mmd):
            print(f"  {i:2}/{len(mmd_files)} {base}: up to date")
            done += 1
            continue
        tmpsvg = os.path.join(tmp, base + ".svg")
        r = subprocess.run([mmdc, "-b", "transparent", "-c", cfgpath,
                            "-i", mmd, "-o", tmpsvg], capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  {i:2}/{len(mmd_files)} {base}: mmdc FAIL {r.stderr[:100]}")
            continue
        r = subprocess.run(["rtk", "node", go, tmpsvg, pdf],
                           capture_output=True, text=True)
        # direct node (no rtk wrapper) fallback
        if r.returncode != 0:
            r = subprocess.run(["node", go, tmpsvg, pdf],
                               capture_output=True, text=True)
        if r.returncode != 0 or not os.path.isfile(pdf):
            print(f"  {i:2}/{len(mmd_files)} {base}: pdf FAIL {r.stderr[:100]}")
            continue
        done += 1
        print(f"  {i:2}/{len(mmd_files)} {base}: COLOUR pdf written")
    shutil.rmtree(tmp, ignore_errors=True)
    return done


def build_plates():
    """4-per-page colour plates from app-*.png via Pillow."""
    try:
        from PIL import Image
    except ImportError:
        print("Pillow not available; plates skipped")
        return
    pngs = sorted(
        glob.glob(os.path.join(FIG, "app-*.png"))
        + sorted(glob.glob(os.path.join(FIG, "app-screens-*.png"))),
        key=lambda p: p,
    )
    # de-dup: if both app-dashboard.png and app-screens-dashboard.png exist, keep
    # the distinct ones (dashboard vs the 4-in-one). Prefer the 4-in-one plate.
    keep = []
    seen = set()
    for p in pngs:
        base = os.path.basename(p)
        k = base.replace("app-screens-", "").replace("app-", "").split(".")[0]
        if k in seen:
            continue
        seen.add(k)
        keep.append(p)
    if len(keep) < 4:
        print(f"only {len(keep)} app captures; need >=4 for a plate")
        return
    THUMB = 1100  # each tile's long edge (px) at plate render scale
    for n in range(0, len(keep), 4):
        batch = keep[n:n + 4]
        if len(batch) < 4:
            continue
        ims = []
        for p in batch:
            im = Image.open(p).convert("RGB")
            r = THUMB / max(im.size)
            ims.append(im.resize((int(im.width * r), int(im.height * r))))
        w = max(im.width for im in ims)
        rows = []
        for i in range(0, 4, 2):
            h = max(ims[i].height, ims[i + 1].height)
            row = Image.new("RGB", (w * 2, h), "white")
            row.paste(ims[i], (0, 0))
            row.paste(ims[i + 1], (w, 0))
            rows.append(row)
        ph = sum(r.height for r in rows)
        plate = Image.new("RGB", (w * 2, ph), "white")
        y = 0
        for row in rows:
            plate.paste(row, (0, y))
            y += row.height
        png = os.path.join(FIG, f"plate-{n // 4 + 1}.png")
        plate.save(png)
        print(f"plate: {png} {plate.size} from {[os.path.basename(x) for x in batch]}")


def main():
    mmdc, go = find_mmdc_and_go()
    print("mmdc:", mmdc)
    print("go:", go)
    if not mmdc or not os.path.isfile(go):
        print("ERROR: mmdc or go.mjs not found; colour render blocked")
        sys.exit(1)
    num = render_colour_diagrams(mmdc, go)
    print("colour diagrams rendered:", num)
    build_plates()


if __name__ == "__main__":
    main()
