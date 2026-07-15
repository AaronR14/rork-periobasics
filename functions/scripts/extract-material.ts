// functions/scripts/extract-material.ts
// Extracts text from every PDF and Markdown file in functions/material/
// and writes functions/material/_extracted.json — a single JSON bundle the
// Cloudflare Worker imports at deploy time so the tutor only grounds
// answers on the texts you provide.
//
// Run:  bun run functions/scripts/extract-material.ts
//
// Add or replace .pdf or .md files in functions/material/ and re-run. The
// generated _extracted.json is committed (or committed-by-Rork) so the worker
// bundle ships with the material baked in.
//
// Markdown files are read as-is (they're already text). PDFs are parsed
// with unpdf to extract the embedded text layer.

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { getDocumentProxy } from "unpdf";

interface MaterialEntry {
  filename: string;
  title: string;
  text: string;
}

const MATERIAL_DIR = join(import.meta.dir, "..", "material");
const OUTPUT_FILE = join(MATERIAL_DIR, "_extracted.json");

async function extractPdf(filepath: string): Promise<string> {
  const bytes = await readFile(filepath);
  const pdf = await getDocumentProxy(new Uint8Array(bytes));

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) pages.push(text);
  }
  return pages.join("\n\n").trim();
}

async function extractMarkdown(filepath: string): Promise<string> {
  const raw = await readFile(filepath, "utf-8");
  // Strip YAML frontmatter (--- ... ---) if present, then trim.
  return raw.replace(/^---[\s\S]*?---\n*/, "").trim();
}

async function main(): Promise<void> {
  await mkdir(MATERIAL_DIR, { recursive: true });
  const files = await readdir(MATERIAL_DIR);
  const supported = files
    .filter((f) => {
      const ext = extname(f).toLowerCase();
      if (ext !== ".pdf" && ext !== ".md" && ext !== ".markdown") return false;
      // Skip README files — they are instructions, not course material.
      if (/^readme/i.test(basename(f, ext))) return false;
      return true;
    })
    .sort();

  if (supported.length === 0) {
    console.warn("⚠️  No .pdf or .md files found in functions/material/. Writing empty bundle.");
    await writeFile(OUTPUT_FILE, JSON.stringify({ version: 1, entries: [] }, null, 2));
    return;
  }

  const entries: MaterialEntry[] = [];
  for (const file of supported) {
    const filepath = join(MATERIAL_DIR, file);
    const ext = extname(file).toLowerCase();
    try {
      const text = ext === ".pdf" ? await extractPdf(filepath) : await extractMarkdown(filepath);
      entries.push({
        filename: file,
        title: basename(file, extname(file)).replace(/[_-]+/g, " "),
        text,
      });
      console.log(`✓ ${file}  (${text.length.toLocaleString()} chars)`);
    } catch (err) {
      console.error(`✗ ${file}:`, err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  }

  const bundle = { version: 1, generatedAt: new Date().toISOString(), entries };
  await writeFile(OUTPUT_FILE, JSON.stringify(bundle, null, 2));
  const totalChars = entries.reduce((n, e) => n + e.text.length, 0);
  console.log(`\nWrote ${OUTPUT_FILE}`);
  console.log(`${entries.length} file(s), ${totalChars.toLocaleString()} chars total.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
