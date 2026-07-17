import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useCallback } from "react";
import createContextHook from "@nkzw/create-context-hook";

import { supabase, syncProfile, getValidAccessToken, isUnauthorized, SESSION_EXPIRED_MESSAGE } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { functionsUrl, supabaseHeaders } from "@/lib/config";

/** A single sub-topic progress row from the student_progress table. */
export interface SubTopicProgress {
  id: string;
  user_id: string;
  sub_topic_slug: string;
  macro_competency_slug: string;
  macro_competency_label: string;
  sub_topic_label: string;
  module_name: string;
  quiz_score: number;
  chat_bonus: number;
  chat_component: number;
  video_component: number;
  final_score: number;
  quiz_attempts_count: number;
  chat_events_count: number;
  last_quiz_at: string | null;
  last_chat_at: string | null;
  updated_at: string;
  /** Client-computed subtopic competency (tutor conversations only).
   *  Set by computeModuleSummaries so the UI works even if the DB
   *  recalculate RPC never ran (e.g. network failure). */
  computedFinalScore?: number;
}

/** A macro-competency with its sub-topics aggregated. */
export interface MacroCompetencyProgress {
  slug: string;
  label: string;
  subTopics: SubTopicProgress[];
  averageScore: number;
}

/** Result of submitting a quiz attempt. */
export interface QuizSubmissionResult {
  success: boolean;
  error?: string;
}

/** Shape of a single Q&A assessment event from the evaluate-answer endpoint. */
export interface ChatCompetencyEvent {
  sub_topic_slug: string;
  is_correct: boolean;
  precision_score: number;
  technical_language_score: number;
  attempts: number;
}

/** A video view row from the video_views table. */
export interface VideoView {
  id: string;
  user_id: string;
  video_guid: string;
  video_title: string | null;
  module_name: string | null;
  watched_at: string | null;
}

/** AI-generated narrative progress report. */
export interface ProgressReport {
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

/** Best quiz score per subtopic. */
export interface QuizBestScore {
  module_name: string;
  subtopic_slug: string | null;
  best_score: number;
  attempts: number;
}

/** Per-module progress summary used by the progress UI. */
export interface ModuleProgressSummary {
  moduleName: string;
  videosWatched: number;
  totalVideos: number;
  videoPct: number;
  quizBestScore: number;
  quizAttempts: number;
  tutorScore: number;
  /** Module progression: quiz 10% + video 45% + tutor 45%.
   *  Unattempted components contribute 0 (no inflation). */
  competencyScore: number;
  subTopics: SubTopicProgress[];
}

/** Overall course competency summary. */
export interface CourseCompletion {
  videosWatched: number;
  totalVideos: number;
  videoPct: number;
  avgQuizScore: number;
  avgTutorScore: number;
  /** Overall progression: average of module progression scores. */
  overallPct: number;
  moduleCount: number;
}

async function fetchProgress(userId: string): Promise<SubTopicProgress[]> {
  const { data, error } = await supabase
    .from("student_progress")
    .select("*")
    .eq("user_id", userId)
    .order("macro_competency_slug", { ascending: true })
    .order("sub_topic_slug", { ascending: true });

  if (error) {
    console.warn("Failed to fetch progress:", error.message);
    throw error;
  }
  return (data ?? []) as SubTopicProgress[];
}

async function fetchVideoViews(userId: string): Promise<VideoView[]> {
  const { data, error } = await supabase
    .from("video_views")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    console.warn("Failed to fetch video views:", error.message);
    throw error;
  }
  return (data ?? []) as VideoView[];
}

async function fetchProgressReport(
  userId: string,
): Promise<{ report: ProgressReport | null; unauthorized: boolean }> {
  if (!functionsUrl) return { report: null, unauthorized: false };
  try {
    const token = await getValidAccessToken();
    const res = await fetch(`${functionsUrl}/progress-assessment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
        ...supabaseHeaders,
      },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!res.ok) {
      if (isUnauthorized(res)) return { report: null, unauthorized: true };
      console.warn("Failed to fetch progress report:", res.status);
      return { report: null, unauthorized: false };
    }
    const data = (await res.json()) as { report?: ProgressReport; error?: string };
    if (data.error || !data.report) return { report: null, unauthorized: false };
    return { report: data.report, unauthorized: false };
  } catch (err) {
    console.warn("Progress report fetch failed:", err);
    return { report: null, unauthorized: false };
  }
}

/** Force-regenerate the AI progress report after a quiz or chat session. */
export async function generateProgressReport(
  userId: string,
): Promise<{ report: ProgressReport | null; unauthorized: boolean }> {
  if (!functionsUrl) return { report: null, unauthorized: false };
  try {
    const token = await getValidAccessToken();
    const res = await fetch(`${functionsUrl}/progress-assessment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
        ...supabaseHeaders,
      },
      body: JSON.stringify({ user_id: userId, force: true }),
    });
    if (!res.ok) {
      if (isUnauthorized(res)) return { report: null, unauthorized: true };
      console.warn("Failed to generate progress report:", res.status);
      return { report: null, unauthorized: false };
    }
    const data = (await res.json()) as { report?: ProgressReport; error?: string };
    if (data.error || !data.report) return { report: null, unauthorized: false };
    return { report: data.report, unauthorized: false };
  } catch (err) {
    console.warn("Progress report generation failed:", err);
    return { report: null, unauthorized: false };
  }
}

async function fetchQuizBestScores(userId: string): Promise<QuizBestScore[]> {
  const { data, error } = await supabase
    .from("quiz_attempts")
    .select("module_name, sub_topic_slug, score")
    .eq("user_id", userId);

  if (error) {
    console.warn("Failed to fetch quiz attempts:", error.message);
    throw error;
  }

  const rows = (data ?? []) as { module_name: string; sub_topic_slug: string | null; score: number }[];
  // Key by subtopic_slug (fall back to module_name for legacy rows without one)
  const map = new Map<string, { module_name: string; subtopic_slug: string | null; best: number; count: number }>();
  for (const r of rows) {
    const key = r.sub_topic_slug ?? r.module_name;
    const existing = map.get(key);
    if (existing) {
      existing.best = Math.max(existing.best, r.score);
      existing.count += 1;
    } else {
      map.set(key, { module_name: r.module_name, subtopic_slug: r.sub_topic_slug, best: r.score, count: 1 });
    }
  }

  return Array.from(map.entries()).map(([, v]) => ({
    module_name: v.module_name,
    subtopic_slug: v.subtopic_slug,
    best_score: v.best,
    attempts: v.count,
  }));
}

/** Record that the user finished watching a video (fired on the video's
 *  'ended' event or at 95% playback). Uses upsert so re-watching doesn't
 *  create duplicates. Also recalculates competency for the module so
 *  video_component updates in real time. */
export async function trackVideoView(params: {
  userId: string;
  videoGuid: string;
  videoTitle?: string;
  moduleName?: string;
}): Promise<void> {
  const { userId, videoGuid, videoTitle, moduleName } = params;
  const { error } = await supabase.from("video_views").upsert(
    {
      user_id: userId,
      video_guid: videoGuid,
      video_title: videoTitle ?? null,
      module_name: moduleName ?? null,
      watched_at: new Date().toISOString(),
    },
    { onConflict: "user_id,video_guid" },
  );
  if (error) {
    console.warn("Failed to track video view:", error.message);
    return;
  }
  // Recalculate competency for this module so the video_component updates.
  if (moduleName) {
    const { error: rpcError } = await supabase.rpc("recalculate_module_progress", {
      p_user_id: userId,
      p_module_name: moduleName,
    });
    if (rpcError) {
      console.warn("Failed to recalculate after video view:", rpcError.message);
    }
  }
}

/** Upsert module video counts so the DB can compute video_component. */
export async function upsertModuleMeta(params: {
  moduleCounts: { moduleName: string; videoCount: number }[];
}): Promise<void> {
  const { moduleCounts } = params;
  if (moduleCounts.length === 0) return;
  const rows = moduleCounts.map((m) => ({
    module_name: m.moduleName,
    video_count: m.videoCount,
    updated_at: new Date().toISOString(),
  }));
  try {
    const { error } = await supabase.from("module_meta").upsert(rows, {
      onConflict: "module_name",
    });
    if (error) {
      console.warn("Failed to upsert module_meta:", error.message);
    }
  } catch (err) {
    console.warn("Failed to upsert module_meta:", err instanceof Error ? err.message : String(err));
  }
}

/** Seed all competency rows for a user so bars exist from day one. */
export async function seedProgressForUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc("seed_progress_for_user", {
    p_user_id: userId,
  });
  if (error) {
    console.warn("Failed to seed progress:", error.message);
  }
}

/** Submit a quiz attempt and recalculate progress.
 *  Each quiz now mixes questions from multiple subtopics, so we submit one
 *  quiz_attempts row per subtopic with the per-subtopic score, then
 *  recalculate the entire module. This ensures every subtopic gets scored
 *  on every attempt — no subtopic stays at zero because it wasn't selected. */
export async function submitQuizAttempt(params: {
  userId: string;
  moduleName: string;
  /** Per-subtopic results: slug -> { correct, total }. */
  subtopicResults: Array<{ subtopicSlug: string; correctAnswers: number; totalQuestions: number }>;
  durationSeconds: number;
}): Promise<QuizSubmissionResult> {
  const { userId, moduleName, subtopicResults, durationSeconds } = params;

  const rows = subtopicResults.map((r) => ({
    user_id: userId,
    module_name: moduleName,
    sub_topic_slug: r.subtopicSlug,
    score: r.totalQuestions > 0 ? Math.round((r.correctAnswers / r.totalQuestions) * 100) : 0,
    total_questions: r.totalQuestions,
    correct_answers: r.correctAnswers,
    duration_seconds: durationSeconds,
  }));

  const { error: insertError } = await supabase.from("quiz_attempts").insert(rows);

  if (insertError) {
    console.warn("Failed to submit quiz attempt:", insertError.message);
    return { success: false, error: insertError.message };
  }

  // Recalculate all sub-topics for this module
  const { error: rpcError } = await supabase.rpc("recalculate_module_progress", {
    p_user_id: userId,
    p_module_name: moduleName,
  });

  if (rpcError) {
    console.warn("Failed to recalculate progress:", rpcError.message);
    return { success: false, error: rpcError.message };
  }

  // Progress report generation is now manual — the user taps "Actualizar"
  // in the library. No automatic AI calls after quizzes.

  return { success: true };
}

/** Submit a single evaluated chat answer as a competency event.
 *  Reuses the provided session ID (or creates a new session if none given),
 *  inserts the event with precision/technical/attempts/is_correct columns,
 *  and recalculates progress. */
export async function submitChatAnswer(params: {
  userId: string;
  moduleName: string | null;
  event: ChatCompetencyEvent;
  sessionId?: string;
}): Promise<QuizSubmissionResult> {
  const { userId, moduleName, event, sessionId } = params;

  let activeSessionId = sessionId;

  if (!activeSessionId) {
    const { data: sessionData, error: sessionError } = await supabase
      .from("ai_chat_sessions")
      .insert({
        user_id: userId,
        module_name: moduleName,
      })
      .select("id")
      .single();

    if (sessionError || !sessionData) {
      console.warn("Failed to create chat session:", sessionError?.message);
      return { success: false, error: sessionError?.message };
    }
    activeSessionId = sessionData.id;
  }

  // Insert the evaluated answer event with new metrics
  const { error: eventsError } = await supabase.from("ai_chat_events").insert({
    session_id: activeSessionId,
    user_id: userId,
    sub_topic_slug: event.sub_topic_slug,
    event_type: event.is_correct ? "validated_concept" : "knowledge_gap",
    delta: event.is_correct ? 10 : -10,
    precision_score: event.precision_score,
    technical_language_score: event.technical_language_score,
    attempts: event.attempts,
    is_correct: event.is_correct,
  });

  if (eventsError) {
    console.warn("Failed to insert chat event:", eventsError.message);
    return { success: false, error: eventsError.message };
  }

  // Recalculate the specific sub-topic, then all progress for the module
  const { error: rpcError } = await supabase.rpc("recalculate_progress", {
    p_sub_topic_slug: event.sub_topic_slug,
    p_user_id: userId,
  });

  if (rpcError) {
    console.warn("Failed to recalculate progress:", rpcError.message);
    return { success: false, error: rpcError.message };
  }

  return { success: true };
}

/** Group flat progress rows into macro-competency clusters. */
export function groupByMacroCompetency(rows: SubTopicProgress[]): MacroCompetencyProgress[] {
  const map = new Map<string, MacroCompetencyProgress>();
  for (const row of rows) {
    const existing = map.get(row.macro_competency_slug);
    if (existing) {
      existing.subTopics.push(row);
    } else {
      map.set(row.macro_competency_slug, {
        slug: row.macro_competency_slug,
        label: row.macro_competency_label,
        subTopics: [row],
        averageScore: 0,
      });
    }
  }
  const groups = Array.from(map.values());
  for (const g of groups) {
    g.averageScore =
      g.subTopics.length > 0
        ? Math.round(g.subTopics.reduce((sum, s) => sum + s.final_score, 0) / g.subTopics.length)
        : 0;
  }
  return groups.sort((a, b) => a.label.localeCompare(b.label));
}

/** Video list item shape (matches the library page interface). */
interface VideoInfo {
  guid: string;
  module?: string;
  category?: string;
}

/**
 * Compute per-module progress summaries from the raw data.
 * Quiz scores are now per-subtopic (keyed by sub_topic_slug in quiz_attempts),
 * so the module quiz score is the average of per-subtopic best scores —
 * no more spreading a single module-level score across all sub-topics.
 *
 * Module progression = quiz 10% + video 45% + tutor 45%.
 * Subtopic competency (computedFinalScore) = tutor conversations only.
 * Unattempted components contribute 0 — no inflation.
 */
export function computeModuleSummaries(params: {
  progressRows: SubTopicProgress[];
  videoViews: VideoView[];
  quizBestScores: QuizBestScore[];
  videos: VideoInfo[];
}): ModuleProgressSummary[] {
  const { progressRows, videoViews, quizBestScores, videos } = params;

  // Build module -> video guids map
  const moduleVideos = new Map<string, string[]>();
  for (const v of videos) {
    const mod = v.module || "Módulo 1";
    if (!moduleVideos.has(mod)) moduleVideos.set(mod, []);
    moduleVideos.get(mod)!.push(v.guid);
  }

  // Build module -> watched guids set
  const watchedGuids = new Set(videoViews.map((v) => v.video_guid));

  // Build subtopic_slug -> quiz best score (per-subtopic, not module-level)
  const quizBySubtopic = new Map<string, QuizBestScore>();
  // Also keep module -> quiz scores for legacy rows without sub_topic_slug
  const quizByModule = new Map<string, QuizBestScore>();
  for (const q of quizBestScores) {
    if (q.subtopic_slug) {
      quizBySubtopic.set(q.subtopic_slug, q);
    } else {
      quizByModule.set(q.module_name, q);
    }
  }

  // Build module -> sub-topic progress rows
  const moduleSubTopics = new Map<string, SubTopicProgress[]>();
  for (const row of progressRows) {
    const existing = moduleSubTopics.get(row.module_name);
    if (existing) {
      existing.push(row);
    } else {
      moduleSubTopics.set(row.module_name, [row]);
    }
  }

  const allModuleNames = new Set<string>([
    ...moduleVideos.keys(),
    ...moduleSubTopics.keys(),
    ...quizByModule.keys(),
  ]);

  const summaries: ModuleProgressSummary[] = [];
  for (const moduleName of allModuleNames) {
    const guids = moduleVideos.get(moduleName) ?? [];
    const totalVideos = guids.length;
    const videosWatched = guids.filter((g) => watchedGuids.has(g)).length;
    const videoPct = totalVideos > 0 ? Math.round((videosWatched / totalVideos) * 100) : 0;

    const subs = moduleSubTopics.get(moduleName) ?? [];

    // Per-subtopic quiz scores: look up each subtopic's quiz best score by slug.
    // Only subtopics that have quiz attempts contribute to the module average.
    const subsWithQuiz: number[] = [];
    let totalQuizAttempts = 0;
    for (const sub of subs) {
      const quiz = quizBySubtopic.get(sub.sub_topic_slug);
      if (quiz && quiz.attempts > 0) {
        subsWithQuiz.push(quiz.best_score);
        totalQuizAttempts += quiz.attempts;
      }
    }
    // Fall back to legacy module-level quiz score if no per-subtopic scores exist
    let quizBestScore: number;
    let quizAttempts: number;
    if (subsWithQuiz.length > 0) {
      quizBestScore = Math.round(
        subsWithQuiz.reduce((sum, s) => sum + s, 0) / subsWithQuiz.length,
      );
      quizAttempts = totalQuizAttempts;
    } else {
      const legacyQuiz = quizByModule.get(moduleName);
      quizBestScore = legacyQuiz?.best_score ?? 0;
      quizAttempts = legacyQuiz?.attempts ?? 0;
    }

    // Tutor score: average chat_component across sub-topics that have chat events.
    // chat_component is already 0-100 (clamped bonus mapped to scale).
    const subsWithChat = subs.filter((s) => s.chat_events_count > 0);
    const tutorScore =
      subsWithChat.length > 0
        ? Math.round(
            subsWithChat.reduce((sum, s) => sum + s.chat_component, 0) /
              subsWithChat.length,
          )
        : 0;

    // Subtopic competency ("Manejo del tema") = tutor conversations only.
    // Quiz scores and video completion do NOT affect subtopic competency.
    // chat_component is 0-100, set by the recalculate RPC from tutor chat events.
    for (const sub of subs) {
      sub.computedFinalScore = Math.min(100, Math.max(0, sub.chat_component ?? 0));
    }

    // Module progression = quiz 10% + video 45% + tutor 45%.
    // - quizBestScore: average of per-subtopic best quiz scores (0-100)
    // - videoPct: videos watched / total videos in module (0-100)
    // - tutorScore: average chat_component across subtopics with chat events (0-100)
    // Unattempted components contribute 0 — no inflation.
    const competencyScore = Math.round(
      quizBestScore * 0.10 + videoPct * 0.45 + tutorScore * 0.45,
    );

    summaries.push({
      moduleName,
      videosWatched,
      totalVideos,
      videoPct,
      quizBestScore,
      quizAttempts,
      tutorScore,
      competencyScore: Math.min(100, Math.max(0, competencyScore)),
      subTopics: subs,
    });
  }

  return summaries.sort((a, b) => {
    // Sort by module number if possible, otherwise alphabetically
    const aNum = parseInt(a.moduleName.replace(/\D/g, ""), 10);
    const bNum = parseInt(b.moduleName.replace(/\D/g, ""), 10);
    if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
    return a.moduleName.localeCompare(b.moduleName);
  });
}

/**
 * Compute overall course progression from module summaries.
 * Overall progression = average of module progression scores.
 */
export function computeCourseCompletion(
  summaries: ModuleProgressSummary[],
  totalVideos: number,
  videosWatched: number,
): CourseCompletion {
  const videoPct = totalVideos > 0 ? Math.round((videosWatched / totalVideos) * 100) : 0;

  const modulesWithQuiz = summaries.filter((s) => s.quizAttempts > 0);
  const avgQuizScore =
    modulesWithQuiz.length > 0
      ? Math.round(
          modulesWithQuiz.reduce((sum, s) => sum + s.quizBestScore, 0) /
            modulesWithQuiz.length,
        )
      : 0;

  const modulesWithTutor = summaries.filter((s) => s.tutorScore > 0);
  const avgTutorScore =
    modulesWithTutor.length > 0
      ? Math.round(
          modulesWithTutor.reduce((sum, s) => sum + s.tutorScore, 0) /
            modulesWithTutor.length,
        )
      : 0;

  // Overall competency = average of module competency scores
  const overallPct =
    summaries.length > 0
      ? Math.round(
          summaries.reduce((sum, s) => sum + s.competencyScore, 0) /
            summaries.length,
        )
      : 0;

  return {
    videosWatched,
    totalVideos,
    videoPct,
    avgQuizScore,
    avgTutorScore,
    overallPct: Math.min(100, Math.max(0, overallPct)),
    moduleCount: summaries.length,
  };
}

export const [ProgressProvider, useProgress] = createContextHook(() => {
  const { user } = useAuth();

  // Sync profile and seed competency rows whenever user changes.
  // Seeding ensures progress bars exist from day one — the RPC creates
  // student_progress rows for every competency_tag with zeros, so the
  // UI has something to render even before any quiz/chat/video activity.
  useEffect(() => {
    if (user) {
      syncProfile(user);
      seedProgressForUser(user.id);
    }
  }, [user]);

  const progressQuery = useQuery({
    queryKey: ["student_progress", user?.id],
    queryFn: () => fetchProgress(user!.id),
    enabled: !!user,
    staleTime: 1000 * 30,
  });

  const videoViewsQuery = useQuery({
    queryKey: ["video_views", user?.id],
    queryFn: () => fetchVideoViews(user!.id),
    enabled: !!user,
    staleTime: 1000 * 30,
  });

  const quizScoresQuery = useQuery({
    queryKey: ["quiz_best_scores", user?.id],
    queryFn: () => fetchQuizBestScores(user!.id),
    enabled: !!user,
    staleTime: 1000 * 30,
  });

  // Progress report is NOT auto-fetched. The user must tap "Actualizar"
  // to generate it. This prevents idle AI spending.
  const [progressReport, setProgressReport] = useState<ProgressReport | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState<boolean>(false);
  const [progressReportError, setProgressReportError] = useState<string | null>(null);

  // Load a cached report on mount (no AI call — just reads from Supabase cache).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { report, unauthorized } = await fetchProgressReport(user.id);
      if (cancelled) return;
      setProgressReport(report);
      setProgressReportError(unauthorized ? SESSION_EXPIRED_MESSAGE : null);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const refreshProgressReport = useCallback(async () => {
    if (!user) return;
    setIsGeneratingReport(true);
    try {
      const { report, unauthorized } = await generateProgressReport(user.id);
      if (report) setProgressReport(report);
      setProgressReportError(unauthorized ? SESSION_EXPIRED_MESSAGE : null);
    } catch (err) {
      console.warn("Failed to refresh progress report:", err);
    } finally {
      setIsGeneratingReport(false);
    }
  }, [user]);

  // Memoize refetch so it doesn't create a new reference on every render.
  // Without useCallback, any useEffect depending on `refetch` would fire on
  // every render, creating an infinite refetch loop (Supabase calls every
  // ~45-60s). React Query's `.refetch` methods are stable references.
  const refetch = useCallback(() => {
    void progressQuery.refetch();
    void videoViewsQuery.refetch();
    void quizScoresQuery.refetch();
  }, []);

  return {
    user,
    progressRows: progressQuery.data ?? [],
    videoViews: videoViewsQuery.data ?? [],
    quizBestScores: quizScoresQuery.data ?? [],
    progressReport,
    isGeneratingReport,
    progressReportError,
    refreshProgressReport,
    isLoading: progressQuery.isLoading || videoViewsQuery.isLoading || quizScoresQuery.isLoading,
    isError: progressQuery.isError || videoViewsQuery.isError || quizScoresQuery.isError,
    refetch,
  };
});
