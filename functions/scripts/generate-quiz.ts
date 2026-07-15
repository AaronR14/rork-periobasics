// functions/scripts/generate-quiz.ts
// Calls the /generate-quiz endpoint on the deployed worker to auto-generate
// quiz questions from the reference material, then writes them into
// expo/data/quizzes.ts as TypeScript code.
//
// Run:  bun run functions/scripts/generate-quiz.ts [--module "Módulo 1" --theme "El periodonto sano" --count 10]
//
// Prerequisites:
//   1. Reference material (.md or .pdf) must be in functions/material/
//   2. Run `bun run functions/scripts/extract-material.ts` first
//   3. Deploy the worker with `runChecks` on the functions app
//   4. Then run this script

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface GenerateQuizResponse {
  questions: QuizQuestion[];
  moduleTitle: string;
  theme: string;
  error?: string;
  detail?: string;
}

interface QuizModule {
  moduleId: string;
  title: string;
  theme: string;
  questions: QuizQuestion[];
}

// Parse simple CLI args.
function parseArgs(): { module: string; theme: string; count: number; functionsUrl: string } {
  const args = process.argv.slice(2);
  let module = "Módulo 1";
  let theme = "El periodonto sano";
  let count = 10;
  let functionsUrl = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL ?? "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--module" && args[i + 1]) {
      module = args[++i];
    } else if (args[i] === "--theme" && args[i + 1]) {
      theme = args[++i];
    } else if (args[i] === "--count" && args[i + 1]) {
      count = parseInt(args[++i], 10) || 10;
    } else if (args[i] === "--url" && args[i + 1]) {
      functionsUrl = args[++i];
    }
  }

  if (!functionsUrl) {
    console.error("✗ No functions URL provided. Set EXPO_PUBLIC_RORK_FUNCTIONS_URL or use --url.");
    process.exit(1);
  }

  return { module, theme, count, functionsUrl };
}

function toModuleId(title: string): string {
  const match = title.match(/M[oó]dulo\s*(\d+)/i);
  return match ? `mod-${match[1]}` : `mod-${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatQuestion(q: QuizQuestion, indent: string): string {
  const options = q.options.map((o) => `"${escapeStr(o)}"`).join(", ");
  return `${indent}{
${indent}  id: "${escapeStr(q.id)}",
${indent}  question: "${escapeStr(q.question)}",
${indent}  options: [${options}],
${indent}  correctIndex: ${q.correctIndex},
${indent}  explanation: "${escapeStr(q.explanation)}",
${indent}},`;
}

async function main(): Promise<void> {
  const { module, theme, count, functionsUrl } = parseArgs();

  console.log(`Generating ${count} questions for "${module}" (theme: ${theme})...`);
  console.log(`Endpoint: ${functionsUrl}/generate-quiz\n`);

  let response: Response;
  try {
    response = await fetch(`${functionsUrl}/generate-quiz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleTitle: module, theme, questionCount: count }),
    });
  } catch (err) {
    console.error("✗ Failed to reach the worker:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error(`✗ Worker returned ${response.status}:`, errText);
    process.exit(1);
  }

  const data = (await response.json()) as GenerateQuizResponse;

  if (!data.questions || data.questions.length === 0) {
    console.error("✗ No questions were generated.");
    if (data.error) console.error("  Error:", data.error);
    process.exit(1);
  }

  console.log(`✓ Generated ${data.questions.length} questions\n`);

  const moduleId = toModuleId(module);
  const newModule: QuizModule = {
    moduleId,
    title: module,
    theme: data.theme || theme,
    questions: data.questions.map((q, i) => ({
      ...q,
      id: q.id || `q${i + 1}`,
    })),
  };

  // Read the existing quizzes file to merge.
  const quizzesPath = join(import.meta.dir, "..", "..", "expo", "data", "quizzes.ts");
  let existingContent = "";
  try {
    existingContent = await readFile(quizzesPath, "utf-8");
  } catch {
    console.warn("⚠️  Could not read existing quizzes.ts, creating new file.");
  }

  // Build the new file content.
  const header = `export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface QuizModule {
  moduleId: string;
  title: string;
  theme: string;
  questions: QuizQuestion[];
}

export const QUIZZES: Record<string, QuizModule> = {
`;

  // Format the new module entry.
  const moduleEntry = `  "${module}": {
    moduleId: "${moduleId}",
    title: "${escapeStr(module)}",
    theme: "${escapeStr(newModule.theme)}",
    questions: [
${newModule.questions.map((q) => formatQuestion(q, "      ")).join("\n")}
    ],
  },
`;

  // Try to merge with existing modules (replace if same key, otherwise add).
  let otherModules = "";
  if (existingContent) {
    const moduleRegex = /"([^"]+)":\s*\{[^}]*moduleId[^}]*questions[\s\S]*?\],\s*\},/g;
    let match: RegExpExecArray | null;
    while ((match = moduleRegex.exec(existingContent)) !== null) {
      const key = match[1];
      if (key !== module) {
        otherModules += match[0] + "\n";
      }
    }
  }

  const footer = `};

export function getQuizForModule(moduleName: string): QuizModule | undefined {
  const normalized = moduleName.trim();
  // Exact match first.
  if (QUIZZES[normalized]) return QUIZZES[normalized];
  // Match by module number (e.g. "MÓDULO 1 · ..." -> "Módulo 1").
  const match = normalized.match(/M[oó]dulo\\s*(\\d+)/i);
  if (match) {
    const key = \`Módulo \${match[1]}\`;
    if (QUIZZES[key]) return QUIZZES[key];
  }
  // Fallback to the first available quiz.
  return Object.values(QUIZZES)[0];
}
`;

  const newContent = header + moduleEntry + otherModules + footer;

  await writeFile(quizzesPath, newContent);
  console.log(`✓ Wrote ${quizzesPath}`);
  console.log(`  Module: "${module}" with ${newModule.questions.length} questions`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
