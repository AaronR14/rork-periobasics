import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import createContextHook from "@nkzw/create-context-hook";

import { supabase } from "@/lib/supabase";
import { functionsUrl, supabaseHeaders } from "@/lib/config";
import { useAuth } from "@/hooks/useAuth";
import type { ChatMessage, VideoSuggestion } from "@/components/ChatPanel";

/** A chat session row from the ai_chat_sessions table. */
export interface ChatSession {
  id: string;
  user_id: string;
  module_name: string | null;
  title: string | null;
  message_count: number;
  created_at: string | null;
  last_message_at: string | null;
  ended_at: string | null;
}

/** A chat_messages row from the DB. */
interface ChatMessageRow {
  id: string;
  session_id: string;
  user_id: string;
  role: string;
  text: string;
  video_suggestion: unknown;
  created_at: string;
}

export const GREETING_TEXT =
  "¡Hola! Soy tu tutor de Periodoncia. Estoy aquí para acompañarte en tu aprendizaje del material del curso. ¿Por dónde te gustaría comenzar? Puedes mencionar un tema, un módulo, o algo que te llame la atención del material.";

/** Fetch all chat sessions for a user, newest first.
 *  Filters out sessions with only a greeting (message_count <= 1) so
 *  empty sessions (user opened chat but never sent a message) don't appear. */
async function fetchSessions(userId: string): Promise<ChatSession[]> {
  const { data, error } = await supabase
    .from("ai_chat_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  const all = (data ?? []) as ChatSession[];
  // Only show sessions where the user actually sent at least one message.
  return all.filter((s) => s.message_count > 1);
}

/** Fetch all messages for a given session, oldest first. */
async function fetchMessages(sessionId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: ChatMessageRow) => ({
    id: row.id,
    role: row.role as "alumno" | "tutor",
    text: row.text,
    videoSuggestion: parseVideoSuggestion(row.video_suggestion),
  }));
}

function parseVideoSuggestion(raw: unknown): VideoSuggestion | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.guid === "string" && typeof obj.title === "string") {
    return {
      guid: obj.guid,
      title: obj.title,
      durationLabel: typeof obj.durationLabel === "string" ? obj.durationLabel : "",
      module: typeof obj.module === "string" ? obj.module : "",
      thumbnailUrl: typeof obj.thumbnailUrl === "string" ? obj.thumbnailUrl : undefined,
    };
  }
  return undefined;
}

/** Create a new chat session and persist the greeting + first user message.
 *  This is only called when the user sends their first message, so no
 *  empty sessions are ever created in the DB. */
async function createSessionWithFirstMessage(
  userId: string,
  firstUserMessage: string,
): Promise<{
  session: ChatSession;
  messages: ChatMessage[];
}> {
  const now = new Date().toISOString();
  const { data: sessionRow, error: sessionErr } = await supabase
    .from("ai_chat_sessions")
    .insert({
      user_id: userId,
      created_at: now,
      last_message_at: now,
      message_count: 2, // greeting + first user message
    })
    .select("*")
    .single();
  if (sessionErr || !sessionRow) throw sessionErr ?? new Error("Failed to create session");
  const session = sessionRow as ChatSession;

  // Persist greeting
  await supabase.from("chat_messages").insert({
    session_id: session.id,
    user_id: userId,
    role: "tutor",
    text: GREETING_TEXT,
  });

  // Persist first user message
  const { data: userMsgRow, error: userMsgErr } = await supabase
    .from("chat_messages")
    .insert({
      session_id: session.id,
      user_id: userId,
      role: "alumno",
      text: firstUserMessage,
    })
    .select("*")
    .single();
  if (userMsgErr || !userMsgRow) throw userMsgErr ?? new Error("Failed to persist user message");

  const greetingMsg: ChatMessage = {
    id: "greeting",
    role: "tutor",
    text: GREETING_TEXT,
  };
  const userMsg: ChatMessage = {
    id: userMsgRow.id as string,
    role: "alumno",
    text: firstUserMessage,
  };

  return { session, messages: [greetingMsg, userMsg] };
}

/** Persist a single message to the DB and return the saved row. */
async function persistMessage(
  sessionId: string,
  userId: string,
  msg: ChatMessage,
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      session_id: sessionId,
      user_id: userId,
      role: msg.role,
      text: msg.text,
      video_suggestion: msg.videoSuggestion ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  const row = data as ChatMessageRow;
  return {
    id: row.id,
    role: row.role as "alumno" | "tutor",
    text: row.text,
    videoSuggestion: parseVideoSuggestion(row.video_suggestion),
  };
}

/** Update session metadata: title, message_count, last_message_at. */
async function updateSessionMeta(
  sessionId: string,
  userId: string,
  patch: { title?: string | null; incrementCount?: number },
): Promise<void> {
  const updates: Record<string, unknown> = {
    last_message_at: new Date().toISOString(),
  };
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.incrementCount && patch.incrementCount > 0) {
    const { data } = await supabase
      .from("ai_chat_sessions")
      .select("message_count")
      .eq("id", sessionId)
      .single();
    const current = (data as { message_count?: number } | null)?.message_count ?? 0;
    updates.message_count = current + patch.incrementCount;
  }
  const { error } = await supabase
    .from("ai_chat_sessions")
    .update(updates)
    .eq("id", sessionId)
    .eq("user_id", userId);
  if (error) console.warn("Failed to update session meta:", error.message);
}

/** Call the backend to generate a short topic summary from conversation messages. */
async function generateTitleFromBackend(
  messages: ChatMessage[],
): Promise<string | null> {
  if (!functionsUrl) return null;
  try {
    const payload = messages
      .filter((m) => m.text.trim().length > 0)
      .slice(0, 20)
      .map((m) => ({ role: m.role, text: m.text }));
    if (payload.length === 0) return null;
    const res = await fetch(`${functionsUrl}/session-title`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Toolkit-URL": process.env.EXPO_PUBLIC_TOOLKIT_URL ?? "",
        "X-Toolkit-Key": process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY ?? "",
        ...supabaseHeaders,
      },
      body: JSON.stringify({ messages: payload }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string; error?: string };
    if (data.error || !data.title) return null;
    return data.title.trim();
  } catch (err) {
    console.warn("Failed to generate session title:", err);
    return null;
  }
}

/** Build a compact summary of past sessions for the tutor's memory. */
function buildPastSessionsContext(sessions: ChatSession[], excludeId?: string): string {
  const past = sessions.filter(
    (s) => s.id !== excludeId && s.message_count > 2,
  );
  if (past.length === 0) return "";
  const summaries = past.slice(0, 10).map((s, i) => {
    const date = s.created_at
      ? new Date(s.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "short" })
      : "fecha desconocida";
    const title = s.title ?? "Sesión sin título";
    return `Sesión ${i + 1} (${date}): "${title}" — ${s.message_count} mensajes`;
  });
  return `\n\nHISTORIAL DE TUTORÍAS PASADAS CON ESTE ESTUDIANTE:\n${summaries.join("\n")}\nUsa este contexto para recordar lo que ya han conversado. No repitas preguntas de sesiones anteriores a menos que sea necesario para reforzar un concepto.`;
}

export const [ChatSessionsProvider, useChatSessions] = createContextHook(() => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const sessionsQuery = useQuery({
    queryKey: ["chat_sessions", user?.id],
    queryFn: () => fetchSessions(user!.id),
    enabled: !!user,
    staleTime: 1000 * 30,
  });

  const invalidateSessions = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["chat_sessions", user?.id] });
  }, [queryClient, user?.id]);

  /** Create a new chat session when the user sends their first message.
   *  Persists the greeting + first user message together. */
  const createSessionOnFirstMessage = useCallback(
    async (firstUserMessage: string): Promise<{
      session: ChatSession;
      messages: ChatMessage[];
    } | null> => {
      if (!user) return null;
      try {
        const result = await createSessionWithFirstMessage(user.id, firstUserMessage);
        invalidateSessions();
        return result;
      } catch (err) {
        console.warn("Failed to create chat session:", err);
        return null;
      }
    },
    [user, invalidateSessions],
  );

  /** Load messages for a specific session. */
  const loadSessionMessages = useCallback(
    async (sessionId: string): Promise<ChatMessage[]> => {
      try {
        return await fetchMessages(sessionId);
      } catch (err) {
        console.warn("Failed to load session messages:", err);
        return [];
      }
    },
    [],
  );

  /** Persist a message and update session metadata. */
  const saveMessage = useCallback(
    async (
      sessionId: string,
      msg: ChatMessage,
    ): Promise<ChatMessage | null> => {
      if (!user) return null;
      try {
        const saved = await persistMessage(sessionId, user.id, msg);
        await updateSessionMeta(sessionId, user.id, {
          incrementCount: 1,
        });
        invalidateSessions();
        return saved;
      } catch (err) {
        console.warn("Failed to save message:", err);
        return null;
      }
    },
    [user, invalidateSessions],
  );

  /** Generate an AI title for a session and persist it. */
  const generateAndSaveTitle = useCallback(
    async (sessionId: string, messages: ChatMessage[]): Promise<void> => {
      if (!user) return;
      try {
        const title = await generateTitleFromBackend(messages);
        if (!title) return;
        await updateSessionMeta(sessionId, user.id, { title });
        invalidateSessions();
      } catch (err) {
        console.warn("Failed to generate/save session title:", err);
      }
    },
    [user, invalidateSessions],
  );

  /** Build the tutor memory string from all past sessions. */
  const getTutorMemory = useCallback(
    (excludeSessionId?: string): string => {
      const sessions = sessionsQuery.data ?? [];
      return buildPastSessionsContext(sessions, excludeSessionId);
    },
    [sessionsQuery.data],
  );

  return {
    sessions: sessionsQuery.data ?? [],
    isLoadingSessions: sessionsQuery.isLoading,
    createSessionOnFirstMessage,
    loadSessionMessages,
    saveMessage,
    generateAndSaveTitle,
    getTutorMemory,
    invalidateSessions,
  };
});
