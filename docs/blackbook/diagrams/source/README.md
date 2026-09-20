# Black Book diagrams

Monochrome variants of the repository diagrams used in the black book. They
are derived from `docs/diagrams/source/*.mmd`:

- `theme: neutral` in the Mermaid init directive instead of the developer
  theme;
- class definition fills/strokes forced to white/black;
- emoji glyphs stripped from labels (they render in color);
- rendered PNGs are additionally flattened to strict grayscale in
  `docs/blackbook/figures/` so no colored pixels can ship.

Regenerate sources with `python3 /tmp/opencode/mk_bw_diagrams.py`, then
render with the Mermaid CLI (see `docs/diagrams/README.md` for the puppeteer
config) and force grayscale, e.g.:

```bash
mmdc -b white -p /tmp/opencode/puppeteer-config.json -i <src> -o <png>
python3 - 'per pipeline above'   # ImageOps.grayscale each PNG
```

Verify with a saturation scan (see the session script) that `maxsat == 0`.