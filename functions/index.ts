// functions/index.ts — Cloudflare Worker that calls the Google Gemini API
// directly using GOOGLE_AI_STUDIO_KEY from env (paid tier).
// Prompts and reference material are fetched from Supabase (ai_prompts table
// and knowledge-base bucket) with caching + fallback to bundled constants.
// The tutor grounds answers ONLY on the reference material provided.

import materialBundle from "./material/_extracted.json";

// Supabase-backed prompt and knowledge-base loader.
// Hardcoded constants below remain as fallbacks if Supabase is unavailable.

const CACHE_TTL_MS = 5 * 60 * 1000;

type PromptCache = { value: string; fetchedAt: number };
const promptCache: Record<string, PromptCache> = {};

// ── RAG: chunk-based retrieval ──
// Papers are split into chunks (~2500 chars each) at paragraph
// boundaries. Only the chunks most relevant to the student's message
// are sent to Gemini, keeping full scientific content available
// while controlling token cost.

interface Chunk {
  id: string;
  fileName: string;
  moduleKey: string;
  heading: string;
  text: string;
  tokenSet: Set<string>;
}

type MaterialCache = {
  moduleChunks: Record<string, Chunk[]>;
  allChunks: Chunk[];
  idf: Map<string, number>;
  fetchedAt: number;
};
let materialCache: MaterialCache | null = null;

const SPANISH_STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del",
  "al", "a", "ante", "bajo", "con", "contra", "desde", "en", "entre",
  "hacia", "hasta", "para", "por", "segun", "sin", "so", "sobre",
  "tras", "y", "o", "u", "ni", "que", "se", "es", "son", "ser",
  "estar", "esta", "estan", "como", "mas", "menos", "muy", "su",
  "sus", "le", "les", "lo", "me", "te", "nos", "os",
  "mi", "mis", "tu", "tus", "nuestra", "nuestro", "nuestras", "nuestros",
  "ha", "han", "fue", "fueron", "era", "eran", "este", "esta", "estos",
  "estas", "ese", "esa", "esos", "esas", "aquel", "aquella",
  "the", "of", "and", "in", "to", "for", "with", "by", "from",
  "is", "are", "was", "were", "be", "been", "on", "at", "as",
  "an", "or", "this", "that", "these", "those", "it", "its",
  "por", "para", "como", "mas", "pero", "sin", "sobre", "despues",
]);

function tokenize(text: string): string[] {
  const lower = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return lower
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !SPANISH_STOPWORDS.has(t));
}

const TARGET_CHUNK_SIZE = 2500;
const MIN_CHUNK_SIZE = 500;

function chunkMarkdown(
  text: string,
  fileName: string,
  moduleKey: string,
  chunkIdPrefix: string,
): Chunk[] {
  let paragraphs: string[];
  if (text.includes("\n\n")) {
    paragraphs = text.split(/\n\n+/);
  } else {
    paragraphs = text.split(/\n/);
  }

  const chunks: Chunk[] = [];
  let currentParts: string[] = [];
  let currentLen = 0;
  let chunkIdx = 0;
  let currentHeading = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.length < 80 && currentParts.length === 0) {
      currentHeading = trimmed;
    }

    if (
      currentLen + trimmed.length > TARGET_CHUNK_SIZE &&
      currentLen >= MIN_CHUNK_SIZE
    ) {
      const chunkText = currentParts.join("\n\n");
      chunks.push({
        id: `${chunkIdPrefix}_${chunkIdx}`,
        fileName,
        moduleKey,
        heading: currentHeading,
        text: chunkText,
        tokenSet: new Set(tokenize(chunkText)),
      });
      chunkIdx++;
      currentParts = [trimmed];
      currentLen = trimmed.length;
      currentHeading = trimmed.length < 80 ? trimmed : "";
    } else {
      currentParts.push(trimmed);
      currentLen += trimmed.length + 2;
    }
  }

  if (currentParts.length > 0) {
    const chunkText = currentParts.join("\n\n");
    chunks.push({
      id: `${chunkIdPrefix}_${chunkIdx}`,
      fileName,
      moduleKey,
      heading: currentHeading,
      text: chunkText,
      tokenSet: new Set(tokenize(chunkText)),
    });
  }

  return chunks;
}

function computeIdf(chunks: Chunk[]): Map<string, number> {
  const docFreq = new Map<string, number>();
  for (const chunk of chunks) {
    for (const token of chunk.tokenSet) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }
  const N = chunks.length;
  const idf = new Map<string, number>();
  for (const [token, df] of docFreq) {
    idf.set(token, Math.log(1 + N / df));
  }
  return idf;
}

const MAX_RAG_CHUNKS = 6;
const MAX_RAG_CHUNKS_QUIZ = 8;

function retrieveChunks(
  query: string,
  chunks: Chunk[],
  idf: Map<string, number>,
  maxChunks: number,
): Chunk[] {
  if (chunks.length === 0) return [];
  if (!query.trim()) {
    const seen = new Set<string>();
    const result: Chunk[] = [];
    for (const c of chunks) {
      if (!seen.has(c.fileName)) {
        seen.add(c.fileName);
        result.push(c);
      }
      if (result.length >= maxChunks) break;
    }
    return result;
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return chunks.slice(0, maxChunks);

  const queryTf = new Map<string, number>();
  for (const t of queryTokens) {
    queryTf.set(t, (queryTf.get(t) ?? 0) + 1);
  }

  const scored = chunks.map((chunk) => {
    let dotProduct = 0;
    let queryNorm = 0;
    let chunkNorm = 0;

    for (const [token, tf] of queryTf) {
      const idfVal = idf.get(token);
      if (idfVal === undefined) continue;
      if (!chunk.tokenSet.has(token)) continue;
      const queryWeight = tf * idfVal;
      const chunkWeight = idfVal;
      dotProduct += queryWeight * chunkWeight;
      queryNorm += queryWeight * queryWeight;
    }

    for (const token of chunk.tokenSet) {
      const idfVal = idf.get(token);
      if (idfVal !== undefined) {
        chunkNorm += idfVal * idfVal;
      }
    }

    if (queryNorm === 0 || chunkNorm === 0) return { chunk, score: 0 };
    return {
      chunk,
      score: dotProduct / (Math.sqrt(queryNorm) * Math.sqrt(chunkNorm)),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxChunks).map((s) => s.chunk);
}

function formatChunks(chunks: Chunk[]): string {
  return chunks
    .map(
      (c, i) =>
        `=== MATERIAL ${i + 1}: ${c.fileName}${c.heading ? ` — ${c.heading}` : ""} ===\n${c.text}\n=== FIN MATERIAL ${i + 1} ===`,
    )
    .join("\n\n");
}

function getSupabaseCreds(
  env: Record<string, string>,
  request: Request,
): { url: string; key: string } {
  const url =
    env.SUPABASE_URL ??
    env.EXPO_PUBLIC_SUPABASE_URL ??
    request.headers.get("X-Supabase-URL") ??
    "";
  const key =
    env.SUPABASE_ANON_KEY ??
    env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    request.headers.get("X-Supabase-Anon-Key") ??
    "";
  return { url, key };
}

/* ------------------------------------------------------------------ */
/*  Auth: verify the caller's Supabase session                         */
/* ------------------------------------------------------------------ */

/**
 * Server-configured Supabase project URL/anon key, used ONLY to verify
 * session tokens. Deliberately reads exclusively from env vars — NEVER
 * from the X-Supabase-URL / X-Supabase-Anon-Key request headers that
 * getSupabaseCreds() falls back to for data reads.
 *
 * Those headers are client-controlled. If token verification trusted a
 * client-supplied URL, an attacker could point X-Supabase-URL at their own
 * server that blindly confirms any token as valid for any user id,
 * completely defeating the auth check.
 */
function getServerSupabaseAuthConfig(
  env: Record<string, string>,
): { url: string; key: string } | null {
  const url = env.SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL ?? "";
  const key = env.SUPABASE_ANON_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return url && key ? { url, key } : null;
}

type SupabaseAuthResult =
  | { ok: true; id: string }
  | { ok: false; reason: "unauthenticated" }
  | { ok: false; reason: "server_misconfigured" };

/**
 * Verify the "Authorization: Bearer <access_token>" header against
 * Supabase Auth. Calls Supabase's own /auth/v1/user endpoint to validate
 * the JWT — the worker never needs the JWT signing secret, only the
 * (public) anon key, since Supabase does the signature/expiry check on
 * its side.
 *
 * Returns reason "server_misconfigured" (distinct from "unauthenticated")
 * when SUPABASE_URL/SUPABASE_ANON_KEY aren't set on the server, so callers
 * can surface a 500 config error instead of silently rejecting everyone
 * with a misleading 401.
 */
async function verifySupabaseUser(
  env: Record<string, string>,
  request: Request,
): Promise<SupabaseAuthResult> {
  const config = getServerSupabaseAuthConfig(env);
  if (!config) {
    console.error("verifySupabaseUser: SUPABASE_URL/SUPABASE_ANON_KEY not configured on the server");
    return { ok: false, reason: "server_misconfigured" };
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { ok: false, reason: "unauthenticated" };

  try {
    const resp = await fetch(`${config.url}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: config.key,
      },
    });
    if (!resp.ok) return { ok: false, reason: "unauthenticated" };
    const data = (await resp.json()) as { id?: string };
    return typeof data.id === "string" && data.id
      ? { ok: true, id: data.id }
      : { ok: false, reason: "unauthenticated" };
  } catch {
    return { ok: false, reason: "unauthenticated" };
  }
}

/** Standard 401 response for a missing/invalid Supabase session. */
function unauthorized(message = "Missing or invalid session"): Response {
  return json({ error: message }, 401);
}

/** 500 response for missing server-side Supabase configuration. */
function authServerMisconfigured(): Response {
  return json({ error: "Server misconfiguration: SUPABASE_URL/SUPABASE_ANON_KEY not set" }, 500);
}

/* ------------------------------------------------------------------ */
/*  Auth: admin-only endpoints                                         */
/* ------------------------------------------------------------------ */

type AdminCheckResult =
  | { ok: true; id: string }
  | { ok: false; response: Response };

/**
 * Verify that the caller is both authenticated (via verifySupabaseUser)
 * AND present in the public.admins table. Used to gate one-off maintenance
 * endpoints (e.g. /classify-transcripts) that regular app users should
 * never be able to reach.
 *
 * Distinguishes "not logged in" (401) from "logged in but not an admin"
 * (403) — the caller's identity is verified before the permission check,
 * so a non-admin gets a clear "forbidden", not a misleading "unauthorized".
 *
 * The admins lookup runs with the caller's own access token (not a
 * service_role key, which this worker never holds), so it relies on a
 * Supabase RLS policy on public.admins that lets an authenticated user
 * read only their own row (auth.uid() = user_id). No INSERT/UPDATE policy
 * should exist for that table — admin status is granted manually via the
 * Supabase dashboard, never through the app.
 */
async function verifyIsAdmin(
  env: Record<string, string>,
  request: Request,
): Promise<AdminCheckResult> {
  const authResult = await verifySupabaseUser(env, request);
  if (!authResult.ok) {
    return {
      ok: false,
      response: authResult.reason === "server_misconfigured" ? authServerMisconfigured() : unauthorized(),
    };
  }

  const config = getServerSupabaseAuthConfig(env);
  if (!config) {
    return { ok: false, response: authServerMisconfigured() };
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  try {
    const resp = await fetch(
      `${config.url}/rest/v1/admins?user_id=eq.${encodeURIComponent(authResult.id)}&select=user_id`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: config.key,
        },
      },
    );
    if (resp.ok) {
      const rows = (await resp.json()) as Array<{ user_id: string }>;
      if (rows.length > 0) {
        return { ok: true, id: authResult.id };
      }
    }
  } catch (err) {
    console.error("verifyIsAdmin: admins table lookup failed:", err);
  }

  return { ok: false, response: json({ error: "Forbidden: admin access required" }, 403) };
}

/* ------------------------------------------------------------------ */
/*  Rate limiting: shared budget for the AI/paid-quota endpoints       */
/* ------------------------------------------------------------------ */

/**
 * Best-effort, in-process rate limiter keyed by verified user id — NOT a
 * globally exact limit. Cloudflare can run multiple isolates of this
 * Worker across colos / under load, and each isolate holds its own copy
 * of this Map (reset whenever an isolate is recycled), so a determined,
 * geographically distributed abuser could in theory exceed these numbers
 * by some multiple.
 *
 * This is a deliberate tradeoff: Cloudflare's exact alternatives (native
 * Rate Limiting Rules, a Workers `ratelimit` binding, or Durable Objects)
 * all require adding a binding/rule to the *deployed* wrangler.toml or
 * the Cloudflare dashboard — configuration this project's deploy pipeline
 * (managed by Rork) doesn't currently expose to us. This in-memory
 * version needs zero extra infra and stops the realistic threat (one
 * client hammering an endpoint, or a client-side retry storm).
 */
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CALLS_PER_MINUTE = 20;
const MAX_CALLS_PER_DAY = 300;

type RateLimitBucket = {
  minuteCount: number;
  minuteWindowStart: number;
  dayCount: number;
  dayWindowStart: number;
};
const rateLimitBuckets = new Map<string, RateLimitBucket>();

type RateLimitCheck =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number; reason: "minute" | "day" };

/**
 * BEST-EFFORT ONLY — not a guaranteed limit. `rateLimitBuckets` lives in
 * this isolate's memory, and Cloudflare recycles/replaces Worker isolates
 * routinely (idle eviction, deploys, load-based scaling). Every time that
 * happens, the Map is gone and every user's counters silently reset to
 * zero. A single client is very likely to get caught by the per-minute
 * check (short window, unlikely to straddle a recycle), but the per-day
 * check is meaningfully weaker: over 24 hours the odds of at least one
 * isolate recycle are high, so a user could plausibly get several fresh
 * 300-call budgets in a single day just by chance. Do not treat this as a
 * hard cost ceiling — it raises the bar against casual/accidental abuse,
 * it does not eliminate it. See the block comment above this section for
 * why a globally-accurate mechanism (Cloudflare Rate Limiting / KV /
 * Durable Objects) isn't available to this deployment right now.
 */
function checkRateLimit(userId: string): RateLimitCheck {
  const now = Date.now();

  // Opportunistic cleanup so the map doesn't grow unbounded over the
  // isolate's lifetime.
  if (rateLimitBuckets.size > 10_000) {
    for (const [id, b] of rateLimitBuckets) {
      if (now - b.dayWindowStart >= DAY_MS) rateLimitBuckets.delete(id);
    }
  }

  let bucket = rateLimitBuckets.get(userId);
  if (!bucket) {
    bucket = { minuteCount: 0, minuteWindowStart: now, dayCount: 0, dayWindowStart: now };
    rateLimitBuckets.set(userId, bucket);
  }

  if (now - bucket.minuteWindowStart >= MINUTE_MS) {
    bucket.minuteCount = 0;
    bucket.minuteWindowStart = now;
  }
  if (now - bucket.dayWindowStart >= DAY_MS) {
    bucket.dayCount = 0;
    bucket.dayWindowStart = now;
  }

  if (bucket.minuteCount >= MAX_CALLS_PER_MINUTE) {
    return {
      ok: false,
      reason: "minute",
      retryAfterSeconds: Math.ceil((bucket.minuteWindowStart + MINUTE_MS - now) / 1000),
    };
  }
  if (bucket.dayCount >= MAX_CALLS_PER_DAY) {
    return {
      ok: false,
      reason: "day",
      retryAfterSeconds: Math.ceil((bucket.dayWindowStart + DAY_MS - now) / 1000),
    };
  }

  bucket.minuteCount++;
  bucket.dayCount++;
  return { ok: true };
}

/** 429 response with a message the app can show directly to the student. */
function rateLimited(retryAfterSeconds: number, reason: "minute" | "day"): Response {
  const message =
    reason === "minute"
      ? "Estás enviando mensajes muy rápido. Espera unos segundos e inténtalo de nuevo."
      : "Alcanzaste el límite de uso del tutor por hoy. Vuelve a intentarlo mañana.";
  return new Response(
    JSON.stringify({ error: "rate_limited", message, retryAfterSeconds }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
        ...CORS_HEADERS,
      },
    },
  );
}

/**
 * Auth + rate-limit gate shared by the endpoints that only need "is this a
 * real logged-in user" (no specific role) plus abuse protection, since
 * each call costs money (Gemini) or shared third-party quota.
 */
async function verifyRateLimitedUser(
  env: Record<string, string>,
  request: Request,
): Promise<{ ok: true; id: string } | { ok: false; response: Response }> {
  const authResult = await verifySupabaseUser(env, request);
  if (!authResult.ok) {
    return {
      ok: false,
      response: authResult.reason === "server_misconfigured" ? authServerMisconfigured() : unauthorized(),
    };
  }

  const limit = checkRateLimit(authResult.id);
  if (!limit.ok) {
    return { ok: false, response: rateLimited(limit.retryAfterSeconds, limit.reason) };
  }

  return { ok: true, id: authResult.id };
}

async function fetchPrompt(
  env: Record<string, string>,
  request: Request,
  key: string,
  fallback: string,
): Promise<string> {
  const { url, key: supabaseKey } = getSupabaseCreds(env, request);
  if (!url || !supabaseKey) return fallback;

  const cached = promptCache[key];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const response = await fetch(
      `${url}/rest/v1/ai_prompts?key=eq.${encodeURIComponent(key)}&select=content,updated_at`,
      {
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          apikey: supabaseKey,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Supabase prompt fetch failed: ${response.status}`);
    }
    const rows = (await response.json()) as Array<{
      content?: string;
      updated_at?: string;
    }>;
    const content = rows[0]?.content;
    if (typeof content === "string" && content.length > 0) {
      promptCache[key] = { value: content, fetchedAt: Date.now() };
      return content;
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`Failed to fetch prompt "${key}" from Supabase:`, detail);
  }
  return fallback;
}

interface BucketFile {
  name: string;
}

async function listBucketFiles(
  url: string,
  key: string,
  bucketId: string,
  prefix = "",
): Promise<BucketFile[]> {
  const response = await fetch(`${url}/storage/v1/object/list/${bucketId}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefix, limit: 100 }),
  });
  if (!response.ok) {
    throw new Error(`Supabase bucket list failed: ${response.status}`);
  }
  const items = (await response.json()) as Array<{ name?: string }> | null;
  if (!Array.isArray(items)) return [];
  return items
    .filter(
      (item) =>
        typeof item.name === "string" &&
        item.name.length > 0 &&
        !item.name.endsWith(".emptyFolderPlaceholder"),
    )
    .map((item) => ({ name: item.name as string }));
}

async function downloadBucketFile(
  url: string,
  key: string,
  bucketId: string,
  path: string,
): Promise<string> {
  const response = await fetch(
    `${url}/storage/v1/object/authenticated/${bucketId}/${encodeURIComponent(path).replace(/%2F/g, "/")}`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Supabase download failed for ${path}: ${response.status}`);
  }
  return response.text();
}

/** Normalize a bucket folder name to the canonical module key.
 *  Handles accent/case variations: "modulo 1" → "Módulo 1", "MÓDULO 2" → "Módulo 2".
 *  Non-matching names are returned as-is (trimmed). */
function normalizeModuleKey(raw: string): string {
  const trimmed = raw.trim();
  const normalized = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const moduloMatch = normalized.match(/^modulo\s+(\d+)$/);
  if (moduloMatch) return `Módulo ${moduloMatch[1]}`;
  return trimmed;
}

function extractModuleFromPath(path: string): string {
  const firstSlash = path.indexOf("/");
  if (firstSlash === -1) return "General";
  return normalizeModuleKey(path.slice(0, firstSlash));
}

async function fetchKnowledgeBase(
  env: Record<string, string>,
  request: Request,
): Promise<MaterialCache | null> {
  const { url, key: supabaseKey } = getSupabaseCreds(env, request);
  if (!url || !supabaseKey) return null;

  if (materialCache && Date.now() - materialCache.fetchedAt < CACHE_TTL_MS) {
    return materialCache;
  }

  try {
    const rootEntries = await listBucketFiles(url, supabaseKey, "knowledge-base");

    const allFilePaths: string[] = [];
    const foldersToList: string[] = [];

    for (const entry of rootEntries) {
      if (entry.name.endsWith(".md")) {
        allFilePaths.push(entry.name);
      } else if (!entry.name.includes(".")) {
        foldersToList.push(entry.name + "/");
      }
    }

    for (const folderPrefix of foldersToList) {
      const subFiles = await listBucketFiles(
        url,
        supabaseKey,
        "knowledge-base",
        folderPrefix,
      );
      for (const sf of subFiles) {
        if (sf.name.endsWith(".md")) {
          allFilePaths.push(folderPrefix + sf.name);
        }
      }
    }

    const moduleChunks: Record<string, Chunk[]> = {};
    const allChunks: Chunk[] = [];

    for (const filePath of allFilePaths) {
      const text = await downloadBucketFile(
        url,
        supabaseKey,
        "knowledge-base",
        filePath,
      );
      const basename = filePath.includes("/")
        ? filePath.slice(filePath.lastIndexOf("/") + 1)
        : filePath;
      const moduleKey = extractModuleFromPath(filePath);
      const fileChunks = chunkMarkdown(text, basename, moduleKey, basename);
      if (!moduleChunks[moduleKey]) moduleChunks[moduleKey] = [];
      moduleChunks[moduleKey].push(...fileChunks);
      allChunks.push(...fileChunks);
    }

    const idf = computeIdf(allChunks);
    materialCache = { moduleChunks, allChunks, idf, fetchedAt: Date.now() };
    return materialCache;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("Failed to fetch knowledge base from Supabase:", detail);
    return null;
  }
}

const SYSTEM_INSTRUCTION = `Eres el Tutor de "Básicamente", academia online orientada a la excelencia académica universitaria. Tu modo de operación combina una bienvenida cálida con un método socrático de evaluación que se activa de forma natural a medida que avanza la conversación.

1. RESTRICCIÓN DE INFORMACIÓN (CERO ALUCINACIONES)
- Basa tus respuestas ÚNICAMENTE en el material de referencia explícito provisto en esta sesión (los textos inyectados tras la instrucción).
- Si el estudiante pregunta algo que no puede responderse con ese material, responde con honestidad, seriedad y de forma directa: "No tengo acceso a esa información específica en este momento para responder a tu pregunta."
- No inventes datos, no asumas ni extrapolas conocimiento externo no validado en el material provisto.
- TRAS INDICAR QUE NO TIENES LA INFORMACIÓN, NUNCA redirijas automáticamente al estudiante hacia un tema que sí cubre el material formulando una pregunta directa sobre ese tema. En su lugar, PREGUNTA AL ESTUDIANTE SI LE GUSTARÍA EXPLORAR ALGÚN TEMA QUE SÍ ESTÁ EN EL MATERIAL. Por ejemplo: "¿Te gustaría que conversemos sobre [tema cubierto en el material]?" Solo si el estudiante acepta explícitamente, continúa con el método socrático sobre ese tema. Respeta siempre la elección del estudiante; si prefiere no continuar, despídete con calidez.

2. FLUJO DE LA CONVERSACIÓN (BIENVENIDA → ELECCIÓN → SOCRÁTICO)
- La conversación tiene dos fases naturales:
  (a) FASE DE BIENVENIDA: El tutor saluda y pregunta al estudiante por dónde le gustaría comenzar. El estudiante responde libremente mencionando un tema, un módulo, o algo que le interese del material. En esta fase NO se hacen preguntas de evaluación — el tutor simplemente acoge la elección del estudiante, confirma brevemente el tema y transiciona de forma natural hacia la primera pregunta socrática sobre ese tema.
  (b) FASE SOCRÁTICA: Una vez que el estudiante ha elegido un tema, el tutor formula preguntas específicas con respuestas evaluables basadas en el material. Las preguntas fluyen en la conversación de forma natural, no se imponen bruscamente.
- La transición entre fases debe ser suave y orgánica: el tutor reconoce lo que el estudiante dijo, conecta con el tema elegido, y lanza la primera pregunta como parte natural de la conversación.

3. MODO EVALUADOR SOCRÁTICO (DURANTE LA FASE SOCRÁTICA)
- Tu objetivo es evaluar el conocimiento del estudiante mediante preguntas específicas que tienen una respuesta correcta clara y verificable basada en el material.
- NUNCA des la respuesta directa. Formula preguntas que requieran que el estudiante demuestre comprensión del concepto.
- Ejemplos de preguntas evaluables: "¿Cuáles son los cuatro componentes del periodonto?", "¿Qué diferencia existe entre gingivitis y periodontitis según la clasificación de 2017?", "¿Qué factores determinan el estadio de una periodontitis?"
- NO hagas preguntas vagas o de opinión. Cada pregunta debe tener una respuesta técnica precisa que puedas evaluar.
- Cuando el estudiante responde incorrectamente, NO digas "eso está mal". Ofrece una pista sutil o un contraejemplo que lo guíe hacia la respuesta correcta, y reformula la misma pregunta.
- Cuando el estudiante responde correctamente, reconoce brevemente su logro y formula la SIGUIENTE pregunta sobre un concepto diferente del material.
- Descompón conceptos complejos en pasos menores. Formula UNA SOLA pregunta por turno.
- Si el estudiante insiste en que le des la respuesta, reitera con calidez que tu rol es acompañarlo a descubrirla, y ofrece una nueva pista más concreta.

4. TONO Y ESTILO
- Tono cálido, cercano y amable, sin perder rigor académico: sé profesional pero humano, como un buen mentor que acompaña al estudiante.
- Usa un lenguaje natural y acogedor; puedes saludar, animar y reconocer el esfuerzo del estudiante cuando corresponda.
- Mantén las respuestas concisas y sin relleno, pero evita sonar frío o distante. Trata al estudiante como futuro profesional sanitario en formación.

5. FLUJO Y MANEJO DE ERRORES
- Analiza la entrada del estudiante y contrástala con el material de referencia.
- Si el estudiante comete un error conceptual, no digas "eso está mal". Cuestiona la premisa errónea usando los datos provistos para que él mismo advierta la contradicción.

6. INTERVENCIÓN TRAS TRES ERRORES CONSECUTIVOS
- Si el estudiante responde incorrectamente tres veces consecutivas a la misma pregunta y no muestra señales de comprender el concepto, CAMBIA tu modo de operación:
  (a) Deja de hacer preguntas socráticas sobre ese concepto.
  (b) Da una respuesta útil y directa: una definición clara, una explicación del concepto o la respuesta completa, basada en el material de referencia.
  (c) Sé cálido y alentador: reconoce el esfuerzo del estudiante antes de dar la explicación. Nunca sugieras que no es capaz.
  (d) Después de la explicación, recomienda al estudiante ver un video para reforzar el concepto. Di algo como: "Te recomiendo ver este video para reforzar lo que acabamos de hablar:" — la app mostrará automáticamente una tarjeta con el video correspondiente. No inventes títulos de videos.
  (e) Después de la sugerencia de video, formula una NUEVA pregunta sobre un concepto DIFERENTE del material para continuar la evaluación. No repitas el mismo tema que el estudiante no logró responder.`;

// Build the reference-material block injected with every request.
const materialEntries: Array<{ filename: string; title: string; text: string }> =
  (materialBundle as { entries?: Array<{ filename: string; title: string; text: string }> }).entries ?? [];

/** Maps each material file to a module key ("Módulo 1" or "Módulo 2"). */
const FILE_TO_MODULE: Record<string, string> = {
  "basically-tutor.pdf": "Módulo 1",
  "dental-knowledge-base.md": "Módulo 1",
  "periodontium-consensus-wg1.md": "Módulo 1",
  "dental-plaque-gingival-conditions.md": "Módulo 2",
  "plaque-induced-gingivitis-diagnosis.md": "Módulo 2",
  "classification-scheme-overview.md": "Módulo 2",
  "periodontitis-consensus-wg2.md": "Módulo 2",
  "periodontitis-progression-rate.md": "Módulo 2",
  "staging-grading-periodontitis.md": "Módulo 2",
};

/** Short instruction for the welcome phase (no module context yet). */
const TOPIC_SUMMARY = `\n\nEstás en la fase de bienvenida: el estudiante aún no ha elegido un tema. Saluda con calidez y pregúntale por dónde le gustaría comenzar. No describas ni listes los módulos ni los temas disponibles — deja que el estudiante elija libremente.`;

/** Build a reference block for a specific module, filtered by RAG
 *  retrieval against the student's query. When no query is provided,
 *  returns the first chunk of each file (table of contents / abstract). */
async function buildReferenceBlock(
  env: Record<string, string>,
  request: Request,
  moduleKey: string,
  query: string,
  maxChunks: number = MAX_RAG_CHUNKS,
): Promise<string> {
  const kb = await fetchKnowledgeBase(env, request);
  if (kb) {
    const chunks = kb.moduleChunks[moduleKey];
    if (!chunks || chunks.length === 0) return "";
    const retrieved = retrieveChunks(query, chunks, kb.idf, maxChunks);
    return formatChunks(retrieved);
  }

  // Fallback: chunk the bundled material on-demand.
  const moduleEntries = materialEntries.filter(
    (e) => FILE_TO_MODULE[e.filename] === moduleKey,
  );
  if (moduleEntries.length === 0) return "";
  const fallbackChunks: Chunk[] = [];
  for (const e of moduleEntries) {
    fallbackChunks.push(...chunkMarkdown(e.text, e.filename, moduleKey, e.filename));
  }
  const fallbackIdf = computeIdf(fallbackChunks);
  const retrieved = retrieveChunks(query, fallbackChunks, fallbackIdf, maxChunks);
  return formatChunks(retrieved);
}

/** Build the reference instruction for a specific module, using RAG
 *  retrieval against the student's message. */
async function buildReferenceInstruction(
  env: Record<string, string>,
  request: Request,
  moduleKey: string,
  query: string,
): Promise<string> {
  const block = await buildReferenceBlock(env, request, moduleKey, query);
  return block
    ? `\n\nMATERIAL DE REFERENCIA PROVISTO PARA ESTA SESIÓN (única fuente permitida para tus respuestas):\n\n${block}\n\nResponde siempre dentro del alcance de este material. Si la pregunta no se cubre aquí, indica que no tienes acceso a esa información. Utiliza el método socrático definido arriba.`
    : "\n\nNota: en esta sesión no se ha provisto material de referencia todavía. Si el estudiante pregunta, indícale que aún no hay material cargado para esa consulta.";
}

/** Build a full reference block across all modules, filtered by RAG
 *  retrieval against the student's query. */
async function getFullReferenceBlock(
  env: Record<string, string>,
  request: Request,
  query: string,
  maxChunks: number = MAX_RAG_CHUNKS,
): Promise<string> {
  const kb = await fetchKnowledgeBase(env, request);
  if (kb) {
    const retrieved = retrieveChunks(query, kb.allChunks, kb.idf, maxChunks);
    return formatChunks(retrieved);
  }

  // Fallback: chunk the bundled material on-demand.
  if (materialEntries.length === 0) return "";
  const fallbackChunks: Chunk[] = [];
  for (const e of materialEntries) {
    fallbackChunks.push(...chunkMarkdown(e.text, e.filename, FILE_TO_MODULE[e.filename] ?? "General", e.filename));
  }
  const fallbackIdf = computeIdf(fallbackChunks);
  const retrieved = retrieveChunks(query, fallbackChunks, fallbackIdf, maxChunks);
  return formatChunks(retrieved);
}

/** Inference: map keywords in the student's message to a module key. */
const MODULE_KEYWORDS: Array<{ module: string; keywords: string[] }> = [
  {
    module: "Módulo 1",
    keywords: [
      "periodonto", "encía", "encia", "gingival", "anatomía", "anatomia",
      "ligamento periodontal", "cemento", "hueso alveolar", "función",
      "funcion", "características clínicas", "caracteristicas clinicas",
      "mucosa", "tejido", "tejidos", "inserción", "insercion",
    ],
  },
  {
    module: "Módulo 2",
    keywords: [
      "clasificación", "clasificacion", "2017", "estadío", "estadio",
      "grado", "staging", "grading", "progresión", "progresion",
      "periodontitis", "diagnóstico", "diagnostico", "severidad",
      "extensión", "extension", "AAP", "EFP", "world workshop",
      "placa", "biofilm", "gingivitis", "placa inducida",
    ],
  },
];

/** Infer a module key from the student's message text. */
function inferModule(message: string): string | null {
  const lower = message.toLowerCase();
  let best: { module: string; score: number } | null = null;
  for (const entry of MODULE_KEYWORDS) {
    const score = entry.keywords.reduce(
      (count, kw) => (lower.includes(kw.toLowerCase()) ? count + 1 : count),
      0,
    );
    if (score > 0 && (!best || score > best.score)) {
      best = { module: entry.module, score };
    }
  }
  return best?.module ?? null;
}

/** Prompt loaders that prefer Supabase and fall back to the hardcoded constants. */
async function getSystemInstruction(
  env: Record<string, string>,
  request: Request,
): Promise<string> {
  return fetchPrompt(env, request, "tutor_system_prompt", SYSTEM_INSTRUCTION);
}

async function getEvaluateAnswerInstruction(
  env: Record<string, string>,
  request: Request,
): Promise<string> {
  return fetchPrompt(
    env,
    request,
    "evaluate_answer_prompt",
    EVALUATE_ANSWER_INSTRUCTION,
  );
}

async function getQuizGenInstruction(
  env: Record<string, string>,
  request: Request,
): Promise<string> {
  return fetchPrompt(env, request, "quiz_gen_prompt", QUIZ_GEN_INSTRUCTION);
}

async function getProgressAssessmentInstruction(
  env: Record<string, string>,
  request: Request,
): Promise<string> {
  return fetchPrompt(
    env,
    request,
    "progress_assessment_prompt",
    PROGRESS_ASSESSMENT_INSTRUCTION,
  );
}

/** Maps sub-topic slugs to their module name for video suggestions. */
const SUB_TOPIC_TO_MODULE: Record<string, string> = {
  anatomia_periodontal: "Módulo 1",
  funcion_periodontal: "Módulo 1",
  caracteristicas_clinicas: "Módulo 1",
  clasificacion_2017: "Módulo 2",
  staging_grading: "Módulo 2",
  progression_rate: "Módulo 2",
};

interface ChatRequestBody {
  history?: { role: "alumno" | "tutor"; text: string }[];
  message: string;
  /** "socratic" (default) = tutor asks questions. "intervention" = tutor
   *  gives a direct answer + video suggestion after 3 wrong attempts. */
  mode?: "socratic" | "intervention";
  /** Sub-topic slug used in intervention mode to find a relevant video. */
  sub_topic_slug?: string;
  /** Compact summary of the student's past tutoring sessions so the tutor
   *  can reference prior conversations without the full message history. */
  past_session_context?: string;
  /** The module the student is currently studying ("Módulo 1" or "Módulo 2").
   *  When provided, only that module's reference material is sent to the AI.
   *  When absent, the backend infers the module from the message keywords,
   *  falling back to a topic summary for the welcome phase. */
  module_name?: string;
  /** The tutor's current question that the student is answering.
   *  When present, the backend evaluates the answer and returns an
   *  `evaluation` object alongside the `reply`, batching two Gemini
   *  calls into one. */
  current_question?: string;
  /** Number of consecutive wrong answers before this one. Used by
   *  the model to decide whether to intervene (rule 6 after 3 wrong). */
  consecutive_wrong?: number;
}

interface SessionTitleRequestBody {
  /** The conversation messages to summarize. */
  messages: { role: "alumno" | "tutor"; text: string }[];
}

interface VideoListItem {
  guid: string;
  title: string;
  durationLabel: string;
  durationSeconds: number;
  thumbnailUrl?: string;
  dateUploaded?: string;
  views?: number;
  description?: string;
  instructor?: string;
  level?: string;
  module?: string;
  category?: string;
}

interface BunnyVideoMeta {
  title?: string;
  length?: number;
  description?: string;
  metaTags?: Array<{ property: string; value: string }>;
  thumbnailUrl?: string;
  dateUploaded?: string;
  views?: number;
}

interface BunnyCollection {
  guid: string;
  name: string;
}

/**
 * Normalises a Bunny collection name to the display label used in the UI.
 * "Modulo 1" → "Módulo 1", "modulo 2" → "Módulo 2", etc.
 * Names that already include the accent or don't match the pattern are returned as-is.
 */
function normaliseModuleName(raw: string): string {
  const match = raw.trim().match(/^(?:modulo|m[óo]dulo)\s*(\d+)$/i);
  if (match) {
    return `Módulo ${match[1]}`;
  }
  return raw.trim();
}

function fmtDuration(total: number | undefined): string {
  if (!total || total <= 0) return "—";
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m} min${s > 0 ? ` ${s}s` : ""}`;
}

// Default video to return metadata for when none is specified.
const DEFAULT_LIBRARY_ID = "697694";
const DEFAULT_VIDEO_ID = "5bce5273-abe3-48f3-8289-a5380442c68c";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  // Authorization is required: the client sends `Authorization: Bearer <token>`
  // for Supabase-authenticated endpoints (/videos, /chat, etc.). Without it
  // here, the browser's CORS preflight rejects the request → "Failed to fetch".
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Toolkit-URL, X-Toolkit-Key, X-Supabase-URL, X-Supabase-Anon-Key",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Call the Google Gemini API directly via generateContent.
 *  Uses GOOGLE_AI_STUDIO_KEY from env (free tier — generous limits for beta).
 *  Returns { ok, text, status }. On 429/503, retries with backoff. */
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function geminiChat(
  env: Record<string, string>,
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  config: { temperature: number; topP: number; maxTokens: number; responseSchema?: Record<string, unknown>; thinkingLevel?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH" },
  maxRetries = 2,
): Promise<{ ok: boolean; text: string; status: number }> {
  const apiKey = env.GOOGLE_AI_STUDIO_KEY;
  if (!apiKey) {
    return { ok: false, text: "Missing GOOGLE_AI_STUDIO_KEY", status: 500 };
  }

  // Convert OpenAI-style messages to Gemini's contents format.
  // Gemini uses roles "user" and "model" — system prompt goes into systemInstruction.
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const generationConfig: Record<string, unknown> = {
    temperature: config.temperature,
    topP: config.topP,
    maxOutputTokens: config.maxTokens,
  };
  if (config.responseSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = config.responseSchema;
  }
  // Gemini 3.x models generate "thinking" tokens billed at output rate
  // ($1.50/1M vs $0.25/1M for input). For instruction-following tasks
  // like chat, titles, and classification, thinking is unnecessary and
  // can cost $0.10+ per call. Set thinkingLevel to MINIMAL to keep it near zero.
  // Note: Gemini 3.x expects `thinkingLevel` inside `thinkingConfig` in the
  // generateContent REST API, not a top-level `thinking_level` field.
  if (config.thinkingLevel) {
    generationConfig.thinkingConfig = { thinkingLevel: config.thinkingLevel };
  }

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig,
  };

  const endpoint = `${GEMINI_ENDPOINT}?key=${apiKey}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (resp.ok) {
      const data = (await resp.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const content =
        data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      return { ok: true, text: content, status: 200 };
    }

    if ((resp.status !== 429 && resp.status !== 503) || attempt === maxRetries) {
      const errText = await resp.text().catch(() => "");
      console.error(`Gemini API error ${resp.status}:`, errText.slice(0, 500));
      return { ok: false, text: errText, status: resp.status };
    }

    // Backoff before retry (429 = rate limit, 503 = overloaded)
    let waitMs = (attempt + 1) * 2000;
    const retryAfter = resp.headers.get("Retry-After");
    if (retryAfter) {
      const secs = parseFloat(retryAfter);
      if (!isNaN(secs)) waitMs = Math.min(Math.ceil(secs * 1000), 15000);
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }

  return { ok: false, text: "Max retries exceeded", status: 429 };
}

async function handleVideoMeta(env: Record<string, string>, url: URL, request: Request): Promise<Response> {
  const authResult = await verifySupabaseUser(env, request);
  if (!authResult.ok) {
    return authResult.reason === "server_misconfigured" ? authServerMisconfigured() : unauthorized();
  }

  const accessKey = env.BUNNY_ACCESS_KEY;
  if (!accessKey) {
    return json({ error: "Server missing Bunny access key" }, 500);
  }

  // Parse: /video or /video/{libraryId}/{videoId}
  const parts = url.pathname.split("/").filter(Boolean);
  let libraryId = DEFAULT_LIBRARY_ID;
  let videoId = DEFAULT_VIDEO_ID;
  if (parts.length === 3) {
    libraryId = parts[1]!;
    videoId = parts[2]!;
  } else if (parts.length === 1) {
    // /video → use defaults (optional ?libraryId & ?videoId overrides)
    const ql = url.searchParams.get("libraryId");
    const qv = url.searchParams.get("videoId");
    if (ql) libraryId = ql;
    if (qv) videoId = qv;
  }

  const endpoint = `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`;
  try {
    const upstream = await fetch(endpoint, {
      headers: { Accept: "application/json", AccessKey: accessKey },
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      return json({ error: "Bunny metadata request failed", detail: errText }, upstream.status as 400 | 404 | 500 | 502);
    }
    const v = (await upstream.json()) as Record<string, unknown>;
    const lengthRaw = v.length ?? v.lengthSeconds ?? v.duration;
    const lengthNum = typeof lengthRaw === "number" ? lengthRaw : Number(lengthRaw) || 0;

    const metaTags = Array.isArray(v.metaTags)
      ? (v.metaTags as Array<{ property?: string; value?: string }>).filter(
          (t) => t && typeof t.property === "string" && typeof t.value === "string",
        ) as Array<{ property: string; value: string }>
      : [];

    // Pick instructor from metaTags (if any) — Bunny lets you attach custom
    // key/value pairs to a video; we surface a few common ones.
    const tagMap: Record<string, string> = {};
    for (const t of metaTags) {
      tagMap[t.property.toLowerCase()] = t.value;
    }
    const instructor = tagMap["instructor"] ?? tagMap["profesor"] ?? tagMap["author"];
    const level = tagMap["level"] ?? tagMap["nivel"];
    const module = tagMap["module"] ?? tagMap["modulo"];
    const category = tagMap["category"] ?? tagMap["categoria"];

    return json({
      title: typeof v.title === "string" ? v.title : undefined,
      description: typeof v.description === "string" ? v.description : undefined,
      durationLabel: fmtDuration(lengthNum),
      durationSeconds: lengthNum,
      thumbnailUrl: typeof v.thumbnailUrl === "string" ? v.thumbnailUrl : undefined,
      dateUploaded: typeof v.dateUploaded === "string" ? v.dateUploaded : undefined,
      views: typeof v.views === "number" ? v.views : undefined,
      instructor,
      level,
      module,
      category,
      metaTags,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ error: "Bunny fetch failed", detail }, 502);
  }
}

async function handleVideoList(env: Record<string, string>, url: URL, request: Request): Promise<Response> {
  const authResult = await verifySupabaseUser(env, request);
  if (!authResult.ok) {
    return authResult.reason === "server_misconfigured" ? authServerMisconfigured() : unauthorized();
  }

  const accessKey = env.BUNNY_ACCESS_KEY;
  if (!accessKey) {
    return json({ error: "Server missing Bunny access key" }, 500);
  }

  const parts = url.pathname.split("/").filter(Boolean);
  let libraryId = DEFAULT_LIBRARY_ID;
  if (parts.length >= 2) {
    libraryId = parts[1]!;
  } else {
    const ql = url.searchParams.get("libraryId");
    if (ql) libraryId = ql;
  }

  try {
    // 1. Fetch all collections so we can map each video's collectionId → module name.
    const collectionMap = new Map<string, string>();
    const collectionsEndpoint = `https://video.bunnycdn.com/library/${libraryId}/collections?page=1&itemsPerPage=100&includeThumbnails=false&orderBy=date`;
    const collectionsResp = await fetch(collectionsEndpoint, {
      headers: { Accept: "application/json", AccessKey: accessKey },
    });
    if (collectionsResp.ok) {
      const collData = (await collectionsResp.json()) as { items?: Array<Record<string, unknown>> };
      const collItems = Array.isArray(collData.items) ? collData.items : [];
      for (const c of collItems) {
        const guid = typeof c.guid === "string" ? c.guid : "";
        const name = typeof c.name === "string" ? c.name : "";
        if (guid && name) {
          collectionMap.set(guid, normaliseModuleName(name));
        }
      }
    }

    // 2. Fetch up to 200 videos (Bunny caps itemsPerPage at 1000).
    const page = url.searchParams.get("page") ?? "1";
    const endpoint = `https://video.bunnycdn.com/library/${libraryId}/videos?page=${encodeURIComponent(page)}&itemsPerPage=200&orderBy=date`;
    const upstream = await fetch(endpoint, {
      headers: { Accept: "application/json", AccessKey: accessKey },
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      return json({ error: "Bunny list request failed", detail: errText }, upstream.status as 400 | 404 | 500 | 502);
    }
    const data = (await upstream.json()) as { items?: Array<Record<string, unknown>> };
    const rawItems = Array.isArray(data.items) ? data.items : [];

    const items = rawItems
      .map((v): VideoListItem => {
        const lengthRaw = v.length ?? v.lengthSeconds ?? v.duration;
        const lengthNum = typeof lengthRaw === "number" ? lengthRaw : Number(lengthRaw) || 0;
        const metaTags = Array.isArray(v.metaTags)
          ? (v.metaTags as Array<{ property?: string; value?: string } | string>).reduce<Array<{ property: string; value: string }>>((acc, t) => {
              if (typeof t === "string") {
                const [property, value] = t.split(":", 2);
                if (property && value) acc.push({ property: property.trim(), value: value.trim() });
              } else if (t && typeof t.property === "string" && typeof t.value === "string") {
                acc.push({ property: t.property, value: t.value });
              }
              return acc;
            }, [])
          : [];
        const tagMap: Record<string, string> = {};
        for (const t of metaTags) {
          tagMap[t.property.toLowerCase()] = t.value;
        }
        const rawThumb = typeof v.thumbnailUrl === "string" ? v.thumbnailUrl : undefined;
        // Proxy thumbnails through the worker so mobile clients bypass CDN
        // geo/referrer restrictions. The worker caches the image on Cloudflare's edge.
        const thumbnailUrl = rawThumb
          ? `${url.origin}/thumb?url=${encodeURIComponent(rawThumb)}`
          : undefined;

        // Determine module: prefer the Bunny collection name, fall back to metaTag.
        const collectionId = typeof v.collectionId === "string" ? v.collectionId : "";
        const collectionModule = collectionId ? collectionMap.get(collectionId) : undefined;
        const metaModule = tagMap["module"] ?? tagMap["modulo"];

        return {
          guid: typeof v.guid === "string" ? v.guid : "",
          title: typeof v.title === "string" ? v.title : "",
          durationLabel: fmtDuration(lengthNum),
          durationSeconds: lengthNum,
          thumbnailUrl,
          dateUploaded: typeof v.dateUploaded === "string" ? v.dateUploaded : undefined,
          views: typeof v.views === "number" ? v.views : undefined,
          description: typeof v.description === "string" ? v.description : undefined,
          instructor: tagMap["instructor"] ?? tagMap["profesor"] ?? tagMap["author"],
          level: tagMap["level"] ?? tagMap["nivel"],
          module: collectionModule ?? metaModule ?? "Módulo 1",
          category: tagMap["category"] ?? tagMap["categoria"],
        };
      })
      .filter((v) => v.guid.length > 0)
      // Sort by title in ascending order (1 → 6), case-insensitive.
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }));

    return json({ items, libraryId });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ error: "Bunny list fetch failed", detail }, 502);
  }
}

/**
 * Bunny's CDN domain for this project's Pull Zone — real thumbnail URLs
 * are always a subdomain of this (e.g. vz-XXXXXXXX-XXX.b-cdn.net). No
 * custom CNAME is configured for this project (confirmed by the project
 * owner), so a suffix match against the bare Bunny domain is correct here.
 *
 * Without this check, /thumb was an open proxy: it would fetch and relay
 * ANY http(s) URL the caller supplied, letting someone use this Worker to
 * anonymize requests to arbitrary sites.
 */
const BUNNY_CDN_DOMAIN = "b-cdn.net";

function isAllowedThumbHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === BUNNY_CDN_DOMAIN || host.endsWith(`.${BUNNY_CDN_DOMAIN}`);
}

async function handleThumbProxy(url: URL): Promise<Response> {
  const target = url.searchParams.get("url");
  if (!target) {
    return json({ error: "Missing url param" }, 400);
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return json({ error: "Invalid url param" }, 400);
  }

  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    return json({ error: "Invalid url param" }, 400);
  }

  if (!isAllowedThumbHost(targetUrl.hostname)) {
    return json({ error: "URL host not allowed" }, 400);
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        Accept: "image/*",
        // Bunny CDN pull zone uses referrer-based security; without a
        // Referer header the request is rejected with 403.
        Referer: "https://player.mediadelivery.net/",
      },
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (!upstream.ok) {
      return json({ error: "Thumbnail fetch failed", status: upstream.status }, 502);
    }
    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, immutable",
        ...CORS_HEADERS,
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ error: "Thumbnail proxy failed", detail }, 502);
  }
}

interface GenerateQuizRequestBody {
  moduleTitle?: string;
  module_name?: string;
  sub_topic_slug?: string;
  theme?: string;
  questionCount?: number;
  num_questions?: number;
}

const QUIZ_GEN_INSTRUCTION = `Eres un generador de preguntas de evaluación para una academia universitaria de Periodoncia. Tu tarea es crear preguntas de opción múltiple basadas EXCLUSIVAMENTE en el material de referencia provisto.

Reglas:
1. Genera el número exacto de preguntas solicitado.
2. Cada pregunta debe tener exactamente 4 opciones (A, B, C, D).
3. Solo una opción debe ser correcta.
4. Las preguntas deben evaluar comprensión, no memorización literal.
5. Incluye una explicación breve para cada respuesta correcta.
6. Responde ÚNICAMENTE con JSON válido, sin texto adicional ni markdown.

Formato de respuesta requerido:
{
  "questions": [
    {
      "id": "q1",
      "question": "texto de la pregunta",
      "options": ["A. opción", "B. opción", "C. opción", "D. opción"],
      "correctIndex": 0,
      "explanation": "explicación breve"
    }
  ]
}`;

async function handleGenerateQuiz(
  request: Request,
  _env: Record<string, string>,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const gate = await verifyRateLimitedUser(_env, request);
  if (!gate.ok) return gate.response;

  let body: GenerateQuizRequestBody;
  try {
    body = (await request.json()) as GenerateQuizRequestBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Determine the module key from the request body, falling back to sub-topic mapping.
  let moduleKey = typeof body.module_name === "string" && body.module_name.trim()
    ? body.module_name.trim()
    : (body.sub_topic_slug ? (SUB_TOPIC_TO_MODULE[body.sub_topic_slug] ?? null) : null);

  const moduleTitle = typeof body.moduleTitle === "string" ? body.moduleTitle
    : (moduleKey ?? "Módulo general");
  const theme = typeof body.theme === "string" ? body.theme : "";
  const questionCount = typeof body.questionCount === "number" && body.questionCount > 0 && body.questionCount <= 30
    ? body.questionCount
    : (typeof body.num_questions === "number" && body.num_questions > 0 && body.num_questions <= 30 ? body.num_questions : 10);

  const [quizGenInstruction, referenceBlock] = await Promise.all([
    getQuizGenInstruction(_env, request),
    moduleKey ? buildReferenceBlock(_env, request, moduleKey, theme || moduleTitle, MAX_RAG_CHUNKS_QUIZ) : getFullReferenceBlock(_env, request, theme || moduleTitle, MAX_RAG_CHUNKS_QUIZ),
  ]);

  if (!referenceBlock) {
    return json({ error: "No reference material available for this module. Upload .md files to the knowledge-base Supabase bucket or add files to functions/material/ and run the extract script." }, 400);
  }

  const prompt = `Genera ${questionCount} preguntas de opción múltiple sobre "${moduleTitle}"${theme ? ` (tema: ${theme})` : ""} basadas en el siguiente material de referencia.

${referenceBlock}

Responde solo con el JSON en el formato especificado.`;

  try {
    const result = await geminiChat(
      _env,
      quizGenInstruction,
      [{ role: "user", content: prompt }],
      { temperature: 0.7, topP: 0.9, maxTokens: 8192, thinkingLevel: "MINIMAL" },
    );

    if (!result.ok) {
      return json({ error: "AI request failed", detail: result.text }, 502);
    }

    const rawText = result.text.trim();

    if (!rawText) {
      return json({ error: "Empty response from model" }, 502);
    }

    // Parse and validate the JSON quiz.
    let parsed: { questions?: unknown };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Try to extract JSON from a code block.
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        return json({ error: "Model did not return valid JSON", raw: rawText.slice(0, 2000) }, 502);
      }
    }

    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
    const validated = questions.filter(
      (q): q is {
        id: string;
        question: string;
        options: string[];
        correctIndex: number;
        explanation: string;
      } =>
        typeof q === "object" &&
        q !== null &&
        typeof (q as Record<string, unknown>).question === "string" &&
        Array.isArray((q as Record<string, unknown>).options) &&
        typeof (q as Record<string, unknown>).correctIndex === "number" &&
        typeof (q as Record<string, unknown>).explanation === "string",
    );

    if (validated.length === 0) {
      return json({ error: "No valid questions generated" }, 502);
    }

    return json({ questions: validated, moduleTitle, theme });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ error: "Upstream fetch failed", detail }, 502);
  }
}

const EVALUATE_ANSWER_INSTRUCTION = `Eres un evaluador académico para una academia de periodoncia. Recibes una pregunta formulada por el tutor y la respuesta del estudiante. Debes evaluar la respuesta con precisión y objetividad, basándote ÚNICAMENTE en el material de referencia provisto.

Evalúa la respuesta del estudiante en tres dimensiones:

1. PRECISIÓN (precision_score, 0-100): ¿Qué tan correcta y completa es la respuesta respecto a la pregunta formulada?
   - 90-100: Respuesta correcta y completa, sin errores conceptuales.
   - 60-89: Respuesta mayormente correcta pero con omisiones o imprecisiones menores.
   - 30-59: Respuesta parcialmente correcta, con errores conceptuales significativos.
   - 0-29: Respuesta incorrecta o no relacionada con la pregunta.

2. LENGUAJE TÉCNICO (technical_language_score, 0-100): ¿Utilizó el estudiante terminología clínica/odontológica apropiada?
   - 90-100: Usa terminología técnica precisa y relevante consistentemente.
   - 60-89: Usa algo de terminología técnica pero con imprecisiones u omisiones.
   - 30-59: Usa lenguaje coloquial, poca terminología técnica.
   - 0-29: No usa terminología técnica relevante.

3. CORRECTITUD (is_correct, boolean): ¿La respuesta es sustancialmente correcta? true solo si precision_score >= 60.

Devuelve ÚNICAMENTE JSON válido con este formato:
{
  "sub_topic_slug": "anatomia_periodontal",
  "is_correct": true,
  "precision_score": 85,
  "technical_language_score": 70,
  "feedback": "Breve explicación de qué fue correcto y qué faltó"
}

Sub-temas disponibles (usa exactamente estos slugs):
- anatomia_periodontal (Anatomía Periodontal, Módulo 1)
- funcion_periodontal (Función Periodontal, Módulo 1)
- caracteristicas_clinicas (Características Clínicas, Módulo 1)
- clasificacion_2017 (Clasificación 2017, Módulo 2)
- staging_grading (Estadios y Grados, Módulo 2)
- progression_rate (Tasa de Progresión, Módulo 2)

Reglas:
- Evalúa SOLO la respuesta del estudiante a la pregunta específica del tutor.
- Asigna el sub_topic_slug que mejor corresponda al tema de la pregunta.
- Si la respuesta no tiene relación con la pregunta, precision_score = 0 y is_correct = false.
- Sé estricto pero justo: un estudiante en formación no necesita una respuesta de libro de texto, pero debe demostrar comprensión del concepto.`;

/** Condensed evaluation directive appended to the system prompt when
 *  the client requests a batched evaluate + reply in one Gemini call. */
const EVALUATION_SUFFIX = `

EVALUACIÓN DE RESPUESTAS (MODO COMBINADO):
Además de tu respuesta conversacional como tutor, debes evaluar la respuesta del estudiante a tu pregunta actual. Devuelve tu respuesta en formato JSON con dos campos:
- "reply": tu respuesta conversacional como tutor (sigue todas las reglas anteriores de tono, método socrático, intervención, etc.)
- "evaluation": un objeto con la evaluación objetiva de la respuesta del estudiante

Criterios de evaluación:
1. PRECISIÓN (precision_score, 0-100): ¿Qué tan correcta y completa es la respuesta respecto a la pregunta formulada?
   - 90-100: Correcta y completa, sin errores conceptuales.
   - 60-89: Mayormente correcta, con omisiones o imprecisiones menores.
   - 30-59: Parcialmente correcta, con errores conceptuales significativos.
   - 0-29: Incorrecta o no relacionada.
2. LENGUAJE TÉCNICO (technical_language_score, 0-100): ¿Utilizó terminología odontológica apropiada?
   - 90-100: Terminología precisa y consistente. 60-89: Algo de terminología con imprecisiones. 30-59: Lenguaje coloquial. 0-29: Sin terminología relevante.
3. CORRECTITUD (is_correct, boolean): true solo si precision_score >= 60.
4. SUB-TEMA (sub_topic_slug): uno de: anatomia_periodontal, funcion_periodontal, caracteristicas_clinicas, clasificacion_2017, staging_grading, progression_rate
5. FEEDBACK (string): breve explicación de qué fue correcto y qué faltó.

Reglas: evalúa SOLO la respuesta a la pregunta específica del tutor. Sé estricto pero justo. Si no hay pregunta evaluable, is_correct = false, precision_score = 0.`;

/** JSON schema for the batched chat + evaluation response. */
const CHAT_EVALUATION_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    evaluation: {
      type: "object",
      properties: {
        sub_topic_slug: { type: "string" },
        is_correct: { type: "boolean" },
        precision_score: { type: "integer" },
        technical_language_score: { type: "integer" },
        feedback: { type: "string" },
      },
      required: ["sub_topic_slug", "is_correct", "precision_score", "technical_language_score", "feedback"],
    },
  },
  required: ["reply", "evaluation"],
};

interface EvaluateAnswerRequestBody {
  question: string;
  answer: string;
  /** Module key to filter reference material. */
  module_name?: string | null;
  /** Sub-topic slug from the tutor's current question. */
  sub_topic_slug?: string | null;
}

interface EvaluateAnswerResponse {
  sub_topic_slug: string;
  is_correct: boolean;
  precision_score: number;
  technical_language_score: number;
  feedback: string;
}

async function handleEvaluateAnswer(
  request: Request,
  _env: Record<string, string>,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const gate = await verifyRateLimitedUser(_env, request);
  if (!gate.ok) return gate.response;

  let body: EvaluateAnswerRequestBody;
  try {
    body = (await request.json()) as EvaluateAnswerRequestBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";

  if (question.length === 0 || answer.length === 0) {
    return json({ error: "question and answer are required" }, 400);
  }

  // Determine which module's reference material to send.
  // Priority: explicit module_name > sub_topic_slug mapping > keyword inference.
  let moduleKey = typeof body.module_name === "string" && body.module_name.trim()
    ? body.module_name.trim()
    : (body.sub_topic_slug ? (SUB_TOPIC_TO_MODULE[body.sub_topic_slug] ?? null) : null);
  if (!moduleKey) {
    moduleKey = inferModule(question + " " + answer);
  }
  const [evaluateAnswerInstruction, filteredBlock] = await Promise.all([
    getEvaluateAnswerInstruction(_env, request),
    moduleKey
      ? buildReferenceBlock(_env, request, moduleKey, question + " " + answer)
      : getFullReferenceBlock(_env, request, question + " " + answer),
  ]);

  const prompt = `Pregunta del tutor: ${question}

Respuesta del estudiante: ${answer}

${filteredBlock ? `\nMaterial de referencia:\n${filteredBlock}\n` : ""}
Evalúa la respuesta del estudiante y devuelve solo el JSON.`;

  try {
    const evalResult = await geminiChat(
      _env,
      evaluateAnswerInstruction,
      [{ role: "user", content: prompt }],
      { temperature: 0.2, topP: 0.8, maxTokens: 2048, thinkingLevel: "MINIMAL" },
    );

    if (!evalResult.ok) {
      return json({ error: "AI request failed", detail: evalResult.text }, 502);
    }

    const rawText = evalResult.text.trim();

    if (!rawText) {
      return json({ error: "Empty response from model" }, 502);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        return json({ error: "Model did not return valid JSON" }, 502);
      }
    }

    const result: EvaluateAnswerResponse = {
      sub_topic_slug: typeof parsed.sub_topic_slug === "string" ? parsed.sub_topic_slug : "anatomia_periodontal",
      is_correct: typeof parsed.is_correct === "boolean" ? parsed.is_correct : false,
      precision_score: typeof parsed.precision_score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.precision_score))) : 0,
      technical_language_score: typeof parsed.technical_language_score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.technical_language_score))) : 0,
      feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
    };

    return json(result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ error: "Upstream fetch failed", detail }, 502);
  }
}

/**
 * GET /suggest-video?sub_topic_slug=anatomia_periodontal
 *
 * Returns the first video from the Bunny library whose module matches the
 * sub-topic's module. Used by the chat intervention flow to suggest a
 * relevant video after 3 consecutive wrong answers.
 */
async function handleSuggestVideo(
  env: Record<string, string>,
  url: URL,
  request: Request,
): Promise<Response> {
  const authResult = await verifySupabaseUser(env, request);
  if (!authResult.ok) {
    return authResult.reason === "server_misconfigured" ? authServerMisconfigured() : unauthorized();
  }

  const accessKey = env.BUNNY_ACCESS_KEY;
  if (!accessKey) {
    return json({ error: "Server missing Bunny access key" }, 500);
  }

  const subTopicSlug = url.searchParams.get("sub_topic_slug") ?? "";
  const moduleName = SUB_TOPIC_TO_MODULE[subTopicSlug] ?? "Módulo 1";
  const libraryId = DEFAULT_LIBRARY_ID;

  try {
    // Fetch videos from Bunny, find one matching the module.
    const endpoint = `https://video.bunnycdn.com/library/${libraryId}/videos?page=1&itemsPerPage=200&orderBy=date`;
    const upstream = await fetch(endpoint, {
      headers: { Accept: "application/json", AccessKey: accessKey },
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      return json({ error: "Bunny list request failed", detail: errText }, 502);
    }

    // Fetch collections to map collectionId → module name.
    const collectionMap = new Map<string, string>();
    const collectionsResp = await fetch(
      `https://video.bunnycdn.com/library/${libraryId}/collections?page=1&itemsPerPage=100&includeThumbnails=false&orderBy=date`,
      { headers: { Accept: "application/json", AccessKey: accessKey } },
    );
    if (collectionsResp.ok) {
      const collData = (await collectionsResp.json()) as { items?: Array<Record<string, unknown>> };
      const collItems = Array.isArray(collData.items) ? collData.items : [];
      for (const c of collItems) {
        const guid = typeof c.guid === "string" ? c.guid : "";
        const name = typeof c.name === "string" ? c.name : "";
        if (guid && name) {
          collectionMap.set(guid, normaliseModuleName(name));
        }
      }
    }

    const data = (await upstream.json()) as { items?: Array<Record<string, unknown>> };
    const rawItems = Array.isArray(data.items) ? data.items : [];

    const allVideos = rawItems
      .map((v): VideoListItem => {
        const lengthRaw = v.length ?? v.lengthSeconds ?? v.duration;
        const lengthNum = typeof lengthRaw === "number" ? lengthRaw : Number(lengthRaw) || 0;
        const collectionId = typeof v.collectionId === "string" ? v.collectionId : "";
        const collectionModule = collectionId ? collectionMap.get(collectionId) : undefined;
        const metaTags = Array.isArray(v.metaTags)
          ? (v.metaTags as Array<{ property?: string; value?: string }>).filter(
              (t) => t && typeof t.property === "string" && typeof t.value === "string",
            ) as Array<{ property: string; value: string }>
          : [];
        const tagMap: Record<string, string> = {};
        for (const t of metaTags) {
          tagMap[t.property.toLowerCase()] = t.value;
        }
        const metaModule = tagMap["module"] ?? tagMap["modulo"];
        return {
          guid: typeof v.guid === "string" ? v.guid : "",
          title: typeof v.title === "string" ? v.title : "",
          durationLabel: fmtDuration(lengthNum),
          durationSeconds: lengthNum,
          thumbnailUrl: typeof v.thumbnailUrl === "string" ? v.thumbnailUrl : undefined,
          module: collectionModule ?? metaModule ?? "Módulo 1",
        };
      })
      .filter((v) => v.guid.length > 0)
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }));

    // Find the first video matching the sub-topic's module.
    const matching = allVideos.find((v) => v.module === moduleName);
    const video = matching ?? allVideos[0];

    if (!video) {
      return json({ error: "No videos available" }, 404);
    }

    return json({
      guid: video.guid,
      title: video.title,
      durationLabel: video.durationLabel,
      module: video.module,
      thumbnailUrl: video.thumbnailUrl,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ error: "Video suggestion fetch failed", detail }, 502);
  }
}

interface ProgressAssessmentRequestBody {
  /** @deprecated ignored — the user id now comes from the verified session token. */
  user_id?: string;
  /** Force regeneration even if a cached report exists. */
  force?: boolean;
}

// Deduplicate concurrent progress-assessment requests per user.
// If a generation is already in flight for a user, subsequent requests
// wait for the same promise instead of calling Gemini again.
const progressAssessmentInFlight = new Map<string, Promise<ProgressAssessmentReport>>();

class ProgressAssessmentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProgressAssessmentError";
  }
}

interface ProgressAssessmentReport {
  strengths: string[];
  priority_gaps: string[];
  next_action: {
    module_name: string;
    sub_topic_slug: string;
    sub_topic_label: string;
    video_guid?: string;
    message: string;
  };
  overall_status: string;
  generated_at: string;
}

const PROGRESS_ASSESSMENT_INSTRUCTION = `Eres el tutor académico de "Básicamente". Recibes un resumen de datos de progreso de un estudiante. Tu tarea es interpretar esos datos y producir un informe breve, útil y motivador.

RESTRICCIONES CRÍTICAS:
- NO recalcules ninguna puntuación. Usa ÚNICAMENTO los números que se te proporcionan.
- NO inventes datos que no aparezcan en el resumen.
- NO repitas la tabla de datos completa. Ofrece una interpretación narrativa y accionable.
- Sé honesto, cálido y directo, como un buen mentor académico.
- TODO el texto que generes debe estar en español, con correcta ortografía y mayúsculas.
- Cada frase debe comenzar con mayúscula. Palabras como “¡Ánimo!” deben llevar mayúscula inicial y signos de exclamación.

Tu informe debe incluir:
1. strengths: 2-3 fortalezas observadas en el estudiante (máximo 12 palabras cada una, en español).
2. priority_gaps: 2-3 brechas prioritarias donde debería enfocarse (máximo 12 palabras cada una, en español).
3. next_action: una acción concreta de estudio para las próximas 24-48 horas, con module_name, sub_topic_slug, sub_topic_label y un message de máximo 20 palabras. El video_guid es opcional. El message debe estar en español.
4. overall_status: una frase corta (máximo 8 palabras) que resuma el estado general del estudiante, en español.

Responde ÚNICAMENTE con JSON válido, sin texto adicional ni markdown.`;

const PROGRESS_ASSESSMENT_SCHEMA = {
  type: "object",
  properties: {
    strengths: {
      type: "array",
      items: { type: "string" },
    },
    priority_gaps: {
      type: "array",
      items: { type: "string" },
    },
    next_action: {
      type: "object",
      properties: {
        module_name: { type: "string" },
        sub_topic_slug: { type: "string" },
        sub_topic_label: { type: "string" },
        video_guid: { type: "string" },
        message: { type: "string" },
      },
      required: ["module_name", "sub_topic_slug", "sub_topic_label", "message"],
    },
    overall_status: { type: "string" },
  },
  required: ["strengths", "priority_gaps", "next_action", "overall_status"],
};

async function fetchStudentProgressData(
  env: Record<string, string>,
  request: Request,
  userId: string,
): Promise<{
  progress: Array<Record<string, unknown>>;
  quizzes: Array<Record<string, unknown>>;
  chatEvents: Array<Record<string, unknown>>;
  videoViews: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
} | null> {
  const { url, key: supabaseKey } = getSupabaseCreds(env, request);
  if (!url || !supabaseKey) return null;

  const headers = {
    Authorization: `Bearer ${supabaseKey}`,
    apikey: supabaseKey,
  };

  try {
    const [progressResp, quizzesResp, chatEventsResp, videoViewsResp, messagesResp] = await Promise.all([
      fetch(
        `${url}/rest/v1/student_progress?user_id=eq.${encodeURIComponent(userId)}&select=*`,
        { headers },
      ),
      fetch(
        `${url}/rest/v1/quiz_attempts?user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc`,
        { headers },
      ),
      fetch(
        `${url}/rest/v1/ai_chat_events?user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc&limit=50`,
        { headers },
      ),
      fetch(
        `${url}/rest/v1/video_views?user_id=eq.${encodeURIComponent(userId)}&select=*&order=watched_at.desc&limit=50`,
        { headers },
      ),
      fetch(
        `${url}/rest/v1/chat_messages?user_id=eq.${encodeURIComponent(userId)}&select=role,text,created_at&order=created_at.desc&limit=30`,
        { headers },
      ),
    ]);

    const toJson = async (resp: Response) => {
      if (!resp.ok) return [];
      return (await resp.json()) as Array<Record<string, unknown>>;
    };

    return {
      progress: await toJson(progressResp),
      quizzes: await toJson(quizzesResp),
      chatEvents: await toJson(chatEventsResp),
      videoViews: await toJson(videoViewsResp),
      messages: (await toJson(messagesResp)).reverse(),
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("Failed to fetch student progress data from Supabase:", detail);
    return null;
  }
}

async function loadCachedReport(
  env: Record<string, string>,
  request: Request,
  userId: string,
): Promise<ProgressAssessmentReport | null> {
  const { url, key: supabaseKey } = getSupabaseCreds(env, request);
  if (!url || !supabaseKey) return null;

  try {
    const resp = await fetch(
      `${url}/rest/v1/reportes_progreso?user_id=eq.${encodeURIComponent(userId)}&select=reporte_json,updated_at&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          apikey: supabaseKey,
        },
      },
    );
    if (!resp.ok) return null;
    const rows = (await resp.json()) as Array<{ reporte_json?: unknown; updated_at?: string }>;
    const row = rows[0];
    if (!row || typeof row.reporte_json !== "object" || row.reporte_json === null) return null;
    return row.reporte_json as ProgressAssessmentReport;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("Failed to load cached progress report:", detail);
    return null;
  }
}

async function saveCachedReport(
  env: Record<string, string>,
  request: Request,
  userId: string,
  report: ProgressAssessmentReport,
): Promise<void> {
  const { url, key: supabaseKey } = getSupabaseCreds(env, request);
  if (!url || !supabaseKey) return;

  try {
    await fetch(`${url}/rest/v1/reportes_progreso?on_conflict=user_id`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        user_id: userId,
        reporte_json: report,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("Failed to save cached progress report:", detail);
  }
}

function buildProgressAssessmentPrompt(data: {
  progress: Array<Record<string, unknown>>;
  quizzes: Array<Record<string, unknown>>;
  chatEvents: Array<Record<string, unknown>>;
  videoViews: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
}): string {
  const progressSummary = data.progress.map((p) => ({
    module_name: p.module_name,
    sub_topic_slug: p.sub_topic_slug,
    sub_topic_label: p.sub_topic_label,
    quiz_score: p.quiz_score,
    chat_component: p.chat_component,
    video_component: p.video_component,
    final_score: p.final_score,
    quiz_attempts_count: p.quiz_attempts_count,
    chat_events_count: p.chat_events_count,
  }));

  const quizSummary = data.quizzes.slice(0, 10).map((q) => ({
    module_name: q.module_name,
    sub_topic_slug: q.sub_topic_slug,
    score: q.score,
    correct_answers: q.correct_answers,
    total_questions: q.total_questions,
  }));

  const chatSummary = data.chatEvents.slice(0, 10).map((e) => ({
    sub_topic_slug: e.sub_topic_slug,
    is_correct: e.is_correct,
    precision_score: e.precision_score,
    technical_language_score: e.technical_language_score,
    attempts: e.attempts,
  }));

  const videoSummary = data.videoViews.map((v) => ({
    video_guid: v.video_guid,
    video_title: v.video_title,
    module_name: v.module_name,
    watched_at: v.watched_at,
  }));

  const recentMessages = data.messages.slice(-10).map((m) => ({
    role: m.role,
    text: typeof m.text === "string" ? m.text.slice(0, 160) : "",
  }));

  return `A continuación se presentan los datos de progreso de un estudiante. NO recalcules puntuaciones. Usa solo estos números para interpretar el estado del estudiante.

RESUMEN POR SUBTEMA:
${JSON.stringify(progressSummary, null, 2)}

ÚLTIMOS QUIZZES:
${JSON.stringify(quizSummary, null, 2)}

ÚLTIMOS EVENTOS DE TUTORÍA:
${JSON.stringify(chatSummary, null, 2)}

VIDEOS VISTOS:
${JSON.stringify(videoSummary, null, 2)}

MENSAJES RECIENTES CON EL TUTOR:
${JSON.stringify(recentMessages, null, 2)}

Genera el informe JSON siguiendo el esquema requerido.`;
}

async function handleProgressAssessment(
  request: Request,
  env: Record<string, string>,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // The user id must come from a verified session, never from the request
  // body — otherwise any caller could read/regenerate another student's
  // progress report by simply passing a different user_id.
  const authResult = await verifySupabaseUser(env, request);
  if (!authResult.ok) {
    return authResult.reason === "server_misconfigured" ? authServerMisconfigured() : unauthorized();
  }
  const userId = authResult.id;

  let body: ProgressAssessmentRequestBody;
  try {
    body = (await request.json()) as ProgressAssessmentRequestBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Return cached report if it exists and the client did not ask for a refresh.
  // Only force=true (user tapped "Actualizar") triggers a Gemini call.
  // Without force, if there is no cache, return null — NO automatic AI generation.
  if (!body.force) {
    const cached = await loadCachedReport(env, request, userId);
    if (cached) {
      return json({ report: cached, cached: true });
    }
    // No cache and no force → return empty. Prevents idle AI spending.
    return json({ report: null, cached: false });
  }

  // Deduplicate concurrent requests for the same user. If a generation is
  // already in flight, wait for it instead of calling Gemini again. This
  // prevents cost explosions when the client fires multiple simultaneous
  // requests (e.g. React Query refetch storms).
  const existing = progressAssessmentInFlight.get(userId);
  if (existing) {
    const report = await existing;
    return json({ report, cached: true, deduplicated: true });
  }

  const generationPromise = (async (): Promise<ProgressAssessmentReport> => {
    const data = await fetchStudentProgressData(env, request, userId);
    if (!data) {
      throw new ProgressAssessmentError("Failed to fetch progress data", 502);
    }

    const [instruction] = await Promise.all([
      getProgressAssessmentInstruction(env, request),
    ]);

    const prompt = buildProgressAssessmentPrompt(data);
    const result = await geminiChat(
      env,
      instruction,
      [{ role: "user", content: prompt }],
      {
        temperature: 0.3,
        topP: 0.85,
        maxTokens: 2048,
        responseSchema: PROGRESS_ASSESSMENT_SCHEMA,
        thinkingLevel: "MINIMAL",
      },
    );

    if (!result.ok) {
      throw new ProgressAssessmentError(`AI request failed: ${result.text}`, 502);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(result.text.trim());
    } catch {
      const match = result.text.trim().match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new ProgressAssessmentError("Model did not return valid JSON", 502);
      }
    }

    const report: ProgressAssessmentReport = {
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.filter((s): s is string => typeof s === "string") : [],
      priority_gaps: Array.isArray(parsed.priority_gaps) ? parsed.priority_gaps.filter((s): s is string => typeof s === "string") : [],
      next_action: {
        module_name: typeof parsed.next_action === "object" && parsed.next_action !== null && typeof (parsed.next_action as Record<string, unknown>).module_name === "string" ? (parsed.next_action as Record<string, unknown>).module_name as string : "Módulo 1",
        sub_topic_slug: typeof parsed.next_action === "object" && parsed.next_action !== null && typeof (parsed.next_action as Record<string, unknown>).sub_topic_slug === "string" ? (parsed.next_action as Record<string, unknown>).sub_topic_slug as string : "anatomia_periodontal",
        sub_topic_label: typeof parsed.next_action === "object" && parsed.next_action !== null && typeof (parsed.next_action as Record<string, unknown>).sub_topic_label === "string" ? (parsed.next_action as Record<string, unknown>).sub_topic_label as string : "Anatomía Periodontal",
        message: typeof parsed.next_action === "object" && parsed.next_action !== null && typeof (parsed.next_action as Record<string, unknown>).message === "string" ? (parsed.next_action as Record<string, unknown>).message as string : "Revisa el material de este subtema",
        video_guid: typeof parsed.next_action === "object" && parsed.next_action !== null && typeof (parsed.next_action as Record<string, unknown>).video_guid === "string" ? (parsed.next_action as Record<string, unknown>).video_guid as string : undefined,
      },
      overall_status: typeof parsed.overall_status === "string" ? parsed.overall_status : "Progreso en curso",
      generated_at: new Date().toISOString(),
    };

    await saveCachedReport(env, request, userId, report);
    return report;
  })();

  progressAssessmentInFlight.set(userId, generationPromise);
  try {
    const report = await generationPromise;
    return json({ report, cached: false });
  } catch (err) {
    if (err instanceof ProgressAssessmentError) {
      return json({ error: err.message }, err.status);
    }
    return json({ error: "Unexpected error during progress assessment" }, 500);
  } finally {
    progressAssessmentInFlight.delete(userId);
  }
}

/** Generate a short one-line topic summary from a conversation's messages. */
async function handleSessionTitle(
  request: Request,
  _env: Record<string, string>,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const gate = await verifyRateLimitedUser(_env, request);
  if (!gate.ok) return gate.response;

  let body: SessionTitleRequestBody;
  try {
    body = (await request.json()) as SessionTitleRequestBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const messages = Array.isArray(body.messages)
    ? body.messages.filter(
        (m) => m && typeof m.text === "string" && m.text.trim().length > 0,
      )
    : [];
  if (messages.length === 0) {
    return json({ title: "Nueva tutoría" });
  }

  // Build a compact transcript for the model.
  const transcript = messages
    .slice(0, 20)
    .map((m) => `${m.role === "alumno" ? "Estudiante" : "Tutor"}: ${m.text}`)
    .join("\n");

  const titleInstruction = `Eres un asistente que resume conversaciones de tutoría académica de Periodoncia en un título muy corto.

Dada la siguiente conversación, genera un TÍTULO de una sola línea (máximo 6 palabras) que describa el tema principal discutido.

Reglas:
- Solo el título, sin comillas, sin prefijos como "Título:" o "Resumen:".
- En español.
- Conciso y descriptivo del tema académico, no del saludo.
- Si la conversación es solo un saludo sin tema claro, responde "Nueva tutoría".

CONVERSACIÓN:
${transcript}`;

  try {
    // Pass the title instruction as a user message — Gemini's
    // generateContent requires at least one entry in `contents`.
    // An empty contents array with only systemInstruction is rejected.
    const result = await geminiChat(
      _env,
      "Responde únicamente con el título, sin texto adicional.",
      [{ role: "user", content: titleInstruction }],
      { temperature: 0.2, topP: 0.8, maxTokens: 256, thinkingLevel: "MINIMAL" },
      1,
    );

    if (!result.ok) {
      return json({ title: "Nueva tutoría" });
    }

    const raw = result.text.trim() || "Nueva tutoría";

    // Clean up: remove quotes, newlines, limit to 60 chars.
    let title = raw.replace(/["'«»]/g, "").replace(/^[Tt]ítulo:\s*/i, "").trim();
    if (title.length > 60) {
      title = `${title.slice(0, 57).trimEnd()}…`;
    }
    if (title.length === 0) title = "Nueva tutoría";

    return json({ title });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ error: "Upstream fetch failed", detail }, 502);
  }
}

/* ================================================================ */
/*  /classify-transcripts — one-time AI classification of video      */
/*  transcripts into subtopic mappings. Reads .md transcript files   */
/*  from the knowledge-base bucket, matches them to Bunny videos by  */
/*  title, asks Gemini which subtopics each covers, and inserts      */
/*  results into the video_subtopics table.                          */
/* ================================================================ */

const TRANSCRIPT_CLASSIFICATION_INSTRUCTION = `Eres un asistente que clasifica transcripciones de videos educativos de periodoncia.

Recibirás la transcripción de un video. Tu tarea es identificar qué sub-temas cubre el video y, si la transcripción tiene marcas de tiempo, en qué rango se cubre cada sub-tema.

Sub-temas disponibles (usa exactamente estos slugs):
- anatomia_periodontal (Anatomía Periodontal, Módulo 1)
- funcion_periodontal (Función Periodontal, Módulo 1)
- caracteristicas_clinicas (Características Clínicas, Módulo 1)
- clasificacion_2017 (Clasificación 2017, Módulo 2)
- staging_grading (Estadios y Grados, Módulo 2)
- progression_rate (Tasa de Progresión, Módulo 2)

Reglas:
- Identifica TODOS los sub-temas que se cubren en el video, aunque sea brevemente.
- Si la transcripción tiene marcas de tiempo en formato (MM:SS - MM:SS) o (H:MM:SS - H:MM:SS), incluye start_time y end_time para cada sub-tema. Si no hay marcas de tiempo, deja start_time y end_time como null.
- Un sub-tema puede aparecer en múltiples segmentos del video. Si es así, incluye una entrada por cada segmento.
- Responde ÚNICAMENTE con JSON válido.`;

const TRANSCRIPT_CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sub_topic_slug: { type: "string" },
          sub_topic_label: { type: "string" },
          start_time: { type: "string" },
          end_time: { type: "string" },
        },
        required: ["sub_topic_slug", "sub_topic_label"],
      },
    },
  },
  required: ["segments"],
};

/** Normalize a string for fuzzy matching: lowercase, strip accents, trim. */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Extract the video title from a transcript filename.
 *  "modulo 1 - tejido conectivo.md" → "tejido conectivo" */
function extractTitleFromFilename(filename: string): string {
  const base = filename.replace(/\.md$/i, "");
  const dashIdx = base.indexOf(" - ");
  if (dashIdx >= 0) return base.slice(dashIdx + 3).trim();
  return base.trim();
}

/** Extract the module name from a transcript filename.
 *  "modulo 1 - tejido conectivo.md" → "Módulo 1" */
function extractModuleFromFilename(filename: string): string | null {
  const match = filename.toLowerCase().match(/^modulo\s+(\d+)/);
  if (match) return `Módulo ${match[1]}`;
  return null;
}

async function handleClassifyTranscripts(
  request: Request,
  env: Record<string, string>,
): Promise<Response> {
  // One-off maintenance endpoint — never meant for regular app users.
  // Requires a verified session belonging to a user in public.admins.
  const adminCheck = await verifyIsAdmin(env, request);
  if (!adminCheck.ok) {
    return adminCheck.response;
  }

  const { url: supabaseUrl, key: supabaseKey } = getSupabaseCreds(env, request);
  if (!supabaseUrl || !supabaseKey) {
    return json({ error: "Missing Supabase credentials" }, 500);
  }

  const accessKey = env.BUNNY_ACCESS_KEY;
  if (!accessKey) {
    return json({ error: "Missing Bunny access key" }, 500);
  }

  // 1. List all files in the knowledge-base bucket (flat + nested).
  const rootEntries = await listBucketFiles(supabaseUrl, supabaseKey, "knowledge-base");
  const allPaths: string[] = [];
  const foldersToList: string[] = [];

  for (const entry of rootEntries) {
    if (entry.name.endsWith(".md")) {
      allPaths.push(entry.name);
    } else if (!entry.name.includes(".")) {
      foldersToList.push(entry.name + "/");
    }
  }
  for (const folder of foldersToList) {
    const subFiles = await listBucketFiles(supabaseUrl, supabaseKey, "knowledge-base", folder);
    for (const sf of subFiles) {
      if (sf.name.endsWith(".md")) allPaths.push(folder + sf.name);
    }
  }

  // 2. Filter for transcript files (pattern: "modulo N - title.md")
  const transcriptPattern = /^modulo\s+\d+\s*-\s*.+\.md$/i;
  const transcriptPaths = allPaths.filter((p) => {
    const basename = p.includes("/") ? p.split("/").pop()! : p;
    return transcriptPattern.test(basename);
  });

  if (transcriptPaths.length === 0) {
    return json({
      error: "No transcript files found in knowledge-base bucket.",
      hint: 'Upload .md files named "modulo N - video title.md" (e.g. "modulo 1 - tejido conectivo.md").',
      totalFilesFound: allPaths.length,
    }, 404);
  }

  // 3. Fetch Bunny video list for title matching.
  const bunnyEndpoint = `https://video.bunnycdn.com/library/${DEFAULT_LIBRARY_ID}/videos?page=1&itemsPerPage=200&orderBy=date`;
  const bunnyResp = await fetch(bunnyEndpoint, {
    headers: { Accept: "application/json", AccessKey: accessKey },
  });
  const bunnyVideos: Array<{ guid: string; title: string }> = [];
  if (bunnyResp.ok) {
    const data = (await bunnyResp.json()) as { items?: Array<Record<string, unknown>> };
    for (const v of data.items ?? []) {
      bunnyVideos.push({
        guid: typeof v.guid === "string" ? v.guid : "",
        title: typeof v.title === "string" ? v.title : "",
      });
    }
  }

  // Build normalized title → guid map for fuzzy matching.
  const bunnyTitleMap = new Map<string, { guid: string; title: string }>();
  for (const v of bunnyVideos) {
    bunnyTitleMap.set(normalizeForMatch(v.title), v);
  }

  // 4. Process each transcript.
  const results: Array<{
    filename: string;
    videoTitle: string;
    videoGuid: string | null;
    module: string | null;
    segments: Array<{ sub_topic_slug: string; sub_topic_label: string; start_time: string | null; end_time: string | null }>;
    status: "ok" | "error" | "no_match";
    error?: string;
  }> = [];

  for (const transcriptPath of transcriptPaths) {
    const basename = transcriptPath.includes("/") ? transcriptPath.split("/").pop()! : transcriptPath;
    const extractedTitle = extractTitleFromFilename(basename);
    const moduleName = extractModuleFromFilename(basename);
    const normalizedTitle = normalizeForMatch(extractedTitle);

    // Match to Bunny video by title.
    const bunnyMatch = bunnyTitleMap.get(normalizedTitle)
      ?? [...bunnyTitleMap.values()].find((v) => {
        const normV = normalizeForMatch(v.title);
        return normV === normalizedTitle
          || normV.includes(normalizedTitle)
          || normalizedTitle.includes(normV);
      });

    let transcriptText: string;
    try {
      transcriptText = await downloadBucketFile(supabaseUrl, supabaseKey, "knowledge-base", transcriptPath);
    } catch (err) {
      results.push({
        filename: basename,
        videoTitle: extractedTitle,
        videoGuid: null,
        module: moduleName,
        segments: [],
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // Truncate very long transcripts to stay within token limits.
    const maxChars = 30000;
    const truncated = transcriptText.length > maxChars
      ? transcriptText.slice(0, maxChars) + "\n[...transcripción truncada...]"
      : transcriptText;

    // 5. Classify with Gemini.
    const classifyResp = await geminiChat(
      env,
      TRANSCRIPT_CLASSIFICATION_INSTRUCTION,
      [{ role: "user", content: `Transcripción del video "${extractedTitle}":\n\n${truncated}` }],
      { temperature: 0.1, topP: 0.8, maxTokens: 2048, responseSchema: TRANSCRIPT_CLASSIFICATION_SCHEMA, thinkingLevel: "MINIMAL" },
    );

    if (!classifyResp.ok) {
      results.push({
        filename: basename,
        videoTitle: extractedTitle,
        videoGuid: bunnyMatch?.guid ?? null,
        module: moduleName,
        segments: [],
        status: "error",
        error: `Gemini error ${classifyResp.status}: ${classifyResp.text.slice(0, 200)}`,
      });
      continue;
    }

    let parsed: { segments?: Array<Record<string, unknown>> };
    try {
      parsed = JSON.parse(classifyResp.text);
    } catch {
      results.push({
        filename: basename,
        videoTitle: extractedTitle,
        videoGuid: bunnyMatch?.guid ?? null,
        module: moduleName,
        segments: [],
        status: "error",
        error: "Gemini returned invalid JSON",
      });
      continue;
    }

    const segments = Array.isArray(parsed.segments)
      ? parsed.segments
          .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
          .map((s) => ({
            sub_topic_slug: typeof s.sub_topic_slug === "string" ? s.sub_topic_slug : "",
            sub_topic_label: typeof s.sub_topic_label === "string" ? s.sub_topic_label : "",
            start_time: typeof s.start_time === "string" ? s.start_time : null,
            end_time: typeof s.end_time === "string" ? s.end_time : null,
          }))
          .filter((s) => s.sub_topic_slug.length > 0)
      : [];

    // 6. Insert into video_subtopics table.
    if (segments.length > 0) {
      const rows = segments.map((seg) => ({
        video_guid: bunnyMatch?.guid ?? null,
        video_title: bunnyMatch?.title ?? extractedTitle,
        transcript_filename: basename,
        sub_topic_slug: seg.sub_topic_slug,
        sub_topic_label: seg.sub_topic_label,
        module_name: moduleName,
        start_time: seg.start_time,
        end_time: seg.end_time,
      }));

      try {
        const insertResp = await fetch(
          `${supabaseUrl}/rest/v1/video_subtopics`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${supabaseKey}`,
              apikey: supabaseKey,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify(rows),
          },
        );
        if (!insertResp.ok) {
          const errText = await insertResp.text().catch(() => "");
          console.error(`Failed to insert video_subtopics for ${basename}:`, errText.slice(0, 300));
        }
      } catch (err) {
        console.error(`Insert error for ${basename}:`, err);
      }
    }

    results.push({
      filename: basename,
      videoTitle: extractedTitle,
      videoGuid: bunnyMatch?.guid ?? null,
      module: moduleName,
      segments,
      status: bunnyMatch ? "ok" : "no_match",
    });
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const noMatch = results.filter((r) => r.status === "no_match").length;
  const errors = results.filter((r) => r.status === "error").length;

  return json({
    total: transcriptPaths.length,
    classified: ok,
    noVideoMatch: noMatch,
    errors,
    results,
  });
}

export default {
  async fetch(request: Request, env: Record<string, string>): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/ping") {
      return json({ ok: true, now: new Date().toISOString() });
    }

    if (url.pathname === "/video" || url.pathname.startsWith("/video/")) {
      return handleVideoMeta(env, url, request);
    }

    if (url.pathname === "/videos" || url.pathname.startsWith("/videos/")) {
      return handleVideoList(env, url, request);
    }

    if (url.pathname === "/thumb") {
      return handleThumbProxy(url);
    }

    if (url.pathname === "/generate-quiz") {
      return handleGenerateQuiz(request, env);
    }

    if (url.pathname === "/evaluate-answer") {
      return handleEvaluateAnswer(request, env);
    }

    if (url.pathname === "/suggest-video") {
      return handleSuggestVideo(env, url, request);
    }

    if (url.pathname === "/session-title") {
      return handleSessionTitle(request, env);
    }

    if (url.pathname === "/progress-assessment") {
      return handleProgressAssessment(request, env);
    }

    if (url.pathname === "/classify-transcripts") {
      return handleClassifyTranscripts(request, env);
    }

    if (url.pathname !== "/chat") {
      return json({ error: "Not found" }, 404);
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const gate = await verifyRateLimitedUser(env, request);
    if (!gate.ok) return gate.response;

    let body: ChatRequestBody;
    try {
      body = (await request.json()) as ChatRequestBody;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message.length === 0) {
      return json({ error: "message is required" }, 400);
    }

    const mode = body.mode === "intervention" ? "intervention" : "socratic";
    const subTopicSlug = typeof body.sub_topic_slug === "string" ? body.sub_topic_slug.trim() : "";
    const subTopicLabel: Record<string, string> = {
      anatomia_periodontal: "Anatomía Periodontal",
      funcion_periodontal: "Función Periodontal",
      caracteristicas_clinicas: "Características Clínicas",
      clasificacion_2017: "Clasificación 2017",
      staging_grading: "Estadios y Grados",
      progression_rate: "Tasa de Progresión",
    };

    // When current_question is present, the model handles intervention
    // naturally via rule 6 + the consecutive_wrong count. The old
    // interventionContext is only used for backward-compat calls without
    // current_question (e.g. mode: "intervention" from older clients).
    const currentQuestion = typeof body.current_question === "string" ? body.current_question.trim() : "";
    const consecutiveWrong = typeof body.consecutive_wrong === "number" ? body.consecutive_wrong : 0;
    const interventionContext = !currentQuestion && mode === "intervention" && subTopicSlug
      ? `\n\nCONTEXTO DE INTERVENCIÓN: El estudiante ha respondido incorrectamente tres veces consecutivas sobre el sub-tema "${subTopicLabel[subTopicSlug] ?? subTopicSlug}". Aplica la regla 6 de tu instrucción: da una explicación directa y útil, sugiere un video, y luego formula una nueva pregunta sobre un concepto diferente.`
      : "";

    const pastSessionContext =
      typeof body.past_session_context === "string" && body.past_session_context.trim().length > 0
        ? body.past_session_context.trim()
        : "";

    // Convert Gemini-style history to OpenAI-compatible messages.
    const history: Array<{ role: "user" | "assistant"; content: string }> =
      (Array.isArray(body.history) ? body.history : [])
        .filter((m) => m && typeof m.text === "string")
        .map((m) => ({
          role: m.role === "alumno" ? "user" as const : "assistant" as const,
          content: m.text,
        }));

    // Determine which module's reference material to send.
    // Priority: explicit module_name > sub_topic_slug mapping > keyword inference.
    let moduleKey = typeof body.module_name === "string" && body.module_name.trim()
      ? body.module_name.trim()
      : (subTopicSlug ? (SUB_TOPIC_TO_MODULE[subTopicSlug] ?? null) : null);
    if (!moduleKey) {
      moduleKey = inferModule(message);
    }

    // Welcome phase (no module identified): send topic summary, not full material.
    const [systemInstruction, referenceInstruction] = await Promise.all([
      getSystemInstruction(env, request),
      moduleKey
        ? buildReferenceInstruction(env, request, moduleKey, message)
        : Promise.resolve(TOPIC_SUMMARY),
    ]);

    const baseSystemPrompt = systemInstruction + pastSessionContext + interventionContext + referenceInstruction;
    const maxTokens = 8192;

    try {
      if (currentQuestion) {
        // ── Batched path: evaluate + reply in a single Gemini call ──
        const combinedSystem = baseSystemPrompt + EVALUATION_SUFFIX;
        const userContent = `${message}\n\n--- CONTEXTO DE EVALUACIÓN ---\nPregunta actual del tutor: ${currentQuestion}\nRespuestas incorrectas consecutivas anteriores: ${consecutiveWrong}\n\nEvalúa esta respuesta y genera tu reply como tutor. Si la respuesta es incorrecta y ya tiene ${consecutiveWrong} errores consecutivos (llegando a 3), aplica la regla 6 (intervención).`;

        const result = await geminiChat(
          env,
          combinedSystem,
          [...history, { role: "user", content: userContent }],
          { temperature: 0.3, topP: 0.85, maxTokens, responseSchema: CHAT_EVALUATION_SCHEMA, thinkingLevel: "MINIMAL" },
        );

        if (!result.ok) {
          return json({ error: "AI request failed", detail: result.text }, 502);
        }

        const rawText = result.text.trim();
        if (!rawText) {
          return json({ reply: "No tengo una respuesta en este momento. ¿Podrías reformular la consulta?" });
        }

        try {
          const parsed = JSON.parse(rawText) as {
            reply?: string;
            evaluation?: Record<string, unknown>;
          };
          const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
          const evalRaw = parsed.evaluation;
          const evaluation = evalRaw && typeof evalRaw === "object" ? {
            sub_topic_slug: typeof evalRaw.sub_topic_slug === "string" ? evalRaw.sub_topic_slug : "anatomia_periodontal",
            is_correct: typeof evalRaw.is_correct === "boolean" ? evalRaw.is_correct : false,
            precision_score: typeof evalRaw.precision_score === "number" ? Math.max(0, Math.min(100, Math.round(evalRaw.precision_score))) : 0,
            technical_language_score: typeof evalRaw.technical_language_score === "number" ? Math.max(0, Math.min(100, Math.round(evalRaw.technical_language_score))) : 0,
            feedback: typeof evalRaw.feedback === "string" ? evalRaw.feedback : "",
          } : null;

          if (!reply) {
            return json({ reply: "No tengo una respuesta en este momento. ¿Podrías reformular la consulta?" });
          }
          return json({ reply, evaluation });
        } catch {
          // JSON parse failed — treat the raw text as the reply
          return json({ reply: rawText });
        }
      }

      // ── Plain-text path (greeting phase or backward-compat) ──
      const result = await geminiChat(
        env,
        baseSystemPrompt,
        [...history, { role: "user", content: message }],
        { temperature: 0.3, topP: 0.85, maxTokens, thinkingLevel: "MINIMAL" },
      );

      if (!result.ok) {
        return json({ error: "AI request failed", detail: result.text }, 502);
      }

      const reply = result.text.trim();
      if (!reply) {
        return json({ reply: "No tengo una respuesta en este momento. ¿Podrías reformular la consulta?" });
      }
      return json({ reply });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return json({ error: "Upstream fetch failed", detail }, 502);
    }
  },
};
