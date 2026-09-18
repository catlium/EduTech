# CatLium EduTech — Technical Diagrams

Mermaid source diagrams documenting the implemented system. Sources live in
`source/`; rendered output, when generated, goes in `svg/` and `png/`.

## Diagram index

| File | Type | Covers |
| ---- | ---- | ------ |
| `source/system-architecture.mmd` | Flowchart | Deployment topology: Cloudflare Tunnel as the only public ingress → nginx → web/api; internal Postgres/Redis/RabbitMQ, material & AI workers, OmniRoute AI gateway, OCR service, optional standalone ocr-worker |
| `source/database-erd.mmd` | ER diagram | Full Drizzle/PostgreSQL schema with foreign-key relationships (identity, academic, content, questions, examinations, attempts, practice, OCR coordination) |
| `source/authentication-sequence.mmd` | Sequence | Cookie auth (login/refresh rotation), CSRF, and the per-request guard stack: AccessToken → Tenant (x-institute-id + membership) → Roles |
| `source/ai-generation-sequence.mmd` | Sequence | Async AI generation: API publishes job → RabbitMQ `ai_generation` → worker-ai → OmniRoute → validate/persist → job terminal; client polling |
| `source/ocr-processing-sequence.mmd` | Sequence | Distributed OCR: coordinator sweep materializes chunks, ocr-worker heartbeat/claim/fetch/extract/submit loop, READY settlement |
| `source/ocr-chunk-state.mmd` | State | Job (`queued→processing→completed/failed/cancelled`) and OCR chunk (`pending→claimed→submitted/failed/cancelled`) lifecycles |

## Rendered output

Rendered `.svg` (vector) and `.png` (2x) copies live in `svg/` and `png/` and are
kept in sync with `source/`. All outputs use a **solid white background** so they
stay legible in GitHub, dark themes, and image viewers. GitHub and VS Code also
render `.mmd` source directly.

> **Portable-SVG requirement.** Each source carries an `%%{init: ...}%%` directive
> with `htmlLabels: false` and `<type>.useMaxWidth: false`. This makes Mermaid emit
> native `<text>` labels (no `<foreignObject>`) and fixed `width`/`height`
> attributes — without it, many SVG viewers (Inkscape, image previewers, some
> browsers) render the diagram blank because they cannot draw `foreignObject`
> HTML labels. Keep those settings when editing diagrams.

Regenerate with the Mermaid CLI (requires a Chromium/Chrome install — this repo's
Puppeteer cache works via a puppeteer config pointing `executablePath` at it):

```bash
for f in docs/diagrams/source/*.mmd; do
  n=$(basename "$f" .mmd)
  mmdc -b white -p /tmp/opencode/puppeteer-config.json -i "$f" -o "docs/diagrams/svg/$n.svg"
  mmdc -b white -s 2 -p /tmp/opencode/puppeteer-config.json -i "$f" -o "docs/diagrams/png/$n.png"
done
```

Mermaid's `-b white` only sets a CSS `background-color` on the `<svg>` root, which
many viewers ignore. Inject a real background rect (covers the whole viewBox) so
the SVG is solid white everywhere:

```bash
python3 - <<'PY'
import re, glob
for p in glob.glob('docs/diagrams/svg/*.svg'):
    s = open(p, encoding='utf-8').read()
    if 'data-bg="solid"' in s:
        continue
    m = re.search(r'<svg\b[^>]*>', s)
    x, y, w, h = re.search(r'viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"', m.group(0)).groups()
    rect = f'<rect data-bg="solid" x="{x}" y="{y}" width="{w}" height="{h}" fill="#ffffff"/>'
    open(p, 'w', encoding='utf-8').write(s[:m.end()] + rect + s[m.end():])
PY
```

## Maintenance

Diagrams are derived from implementation evidence only (compose file, Drizzle
schema, controllers/services, worker code). When the system changes, update
the affected `.mmd` source and re-render; check the change vs `apps/api`,
`apps/workers`, `apps/ocr`, `infrastructure/`, and `packages/database`.