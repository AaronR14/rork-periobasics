/**
 * Client for the /generate-quiz backend endpoint.
 *
 * Calls the Cloudflare Worker which uses Gemini + RAG to produce fresh
 * multiple-choice questions from the knowledge-base material — every
 * call yields different questions, always scoped to the requested module.
 */

import { functionsUrl, supabaseHeaders } from "@/lib/config";
import { getValidAccessToken } from "@/lib/supabase";
import type { QuizQuestion, TaggedQuizQuestion, QuizModule } from "@/data/quizzes";

interface GenerateQuizResponse {
  questions: Array<QuizQuestion & { topic?: string }>;
  moduleTitle: string;
  theme: string;
}

interface ModuleMeta {
  title: string;
  theme: string;
}

/** Module display metadata — used for the intro screen before questions arrive. */
const MODULE_META: Record<string, ModuleMeta> = {
  "Módulo 1": {
    title: "Módulo 1",
    theme: "Anatomía, estructura y función del periodonto",
  },
  "Módulo 2": {
    title: "Módulo 2",
    theme: "Clasificación de la enfermedad periodontal",
  },
  "Módulo 3": {
    title: "Módulo 3",
    theme: "Diagnóstico periodontal",
  },
  "Módulo 4": {
    title: "Módulo 4",
    theme: "Pronóstico y plan de tratamiento",
  },
};

const DEFAULT_META: ModuleMeta = {
  title: "Módulo general",
  theme: "Evaluación de periodoncia",
};

/**
 * Fetch dynamically-generated quiz questions from the backend.
 * Returns a QuizModule with tagged questions ready for the quiz screen.
 */
export async function generateQuiz(
  moduleName: string,
  questionCount = 10,
): Promise<QuizModule> {
  const meta = MODULE_META[moduleName] ?? DEFAULT_META;

  if (!functionsUrl) {
    throw new Error("Backend URL no configurado");
  }

  const token = await getValidAccessToken();

  const res = await fetch(`${functionsUrl}/generate-quiz`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
      ...supabaseHeaders,
    },
    body: JSON.stringify({
      module_name: moduleName,
      moduleTitle: meta.title,
      theme: meta.theme,
      questionCount,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`generate-quiz failed: ${res.status} ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as GenerateQuizResponse;

  const questions: TaggedQuizQuestion[] = data.questions.map((q, i) => ({
    id: q.id || `dq${i + 1}`,
    question: q.question,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    subtopicSlug: q.topic || "general",
  }));

  return {
    moduleId: moduleName.toLowerCase().replace(/\s+/g, "-"),
    title: data.moduleTitle || meta.title,
    theme: data.theme || meta.theme,
    questions,
  };
}
