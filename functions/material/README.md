# Material de referencia para el tutor

Drop your **Markdown** or **PDF** files here. They are the ONLY source the
AI tutor grounds answers on (per the Socratic system instruction in
`functions/index.ts`), and the ONLY source quiz questions are generated from.

## Supported formats

- `.md` / `.markdown` — read as plain text (fastest, recommended)
- `.pdf` — text layer extracted with `unpdf` (scanned/image-only PDFs need OCR first)

## How to add or update material

1. Add, replace, or remove `.md` or `.pdf` files in this folder.
2. Run the extraction script from the project root:

   ```sh
   bun run functions/scripts/extract-material.ts
   ```

   This regenerates `_extracted.json` (the bundled, plain-text version the
   worker ships).
3. Redeploy the worker (`runChecks` on the `functions` app) so the new material
   is reachable at the backend URL.

## How to regenerate quizzes from the material

After extracting material and deploying the worker, run the quiz generator:

```sh
bun run functions/scripts/generate-quiz.ts --module "Módulo 1" --theme "El periodonto sano" --count 10
```

This calls the `/generate-quiz` endpoint, which uses Gemini to create
multiple-choice questions based **only** on the reference material. The
results are written directly to `expo/data/quizzes.ts`.

Options:
- `--module`  Quiz module title (e.g. "Módulo 2")
- `--theme`   Topic description (e.g. "Enfermedad periodontal")
- `--count`   Number of questions (default 10, max 30)
- `--url`     Worker URL (defaults to `EXPO_PUBLIC_RORK_FUNCTIONS_URL`)

Run the script once per module you want to generate. Existing modules with
the same title are replaced; others are preserved.

## Notes

- Keep material concise (course notes, chapter excerpts, clinical case
  handouts). Gemini accepts ~1M input tokens, but smaller bundles keep every
  call fast and cheap.
- Markdown files can include YAML frontmatter (`---` blocks) — it is
  stripped automatically.
- Filenames become section titles in the injected context. Name them
  meaningfully (e.g. `periodonto-sano.md`, `colgajos-resectivos.pdf`).
- `_extracted.json` is generated — do not edit it by hand.
