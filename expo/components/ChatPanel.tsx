import * as Haptics from "expo-haptics";
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  History,
  MessageCircle,
  Mic,
  Plus,
  PlayCircle,
  Send,
  User,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import Colors from "@/constants/colors";
import { useAuth } from "@/hooks/useAuth";
import { submitChatAnswer, type ChatCompetencyEvent } from "@/hooks/useProgress";
import { useChatSessions, type ChatSession, GREETING_TEXT } from "@/hooks/useChatSessions";
import { functionsUrl, supabaseHeaders } from "@/lib/config";

export type ChatRole = "alumno" | "tutor";

/** A video suggestion shown after the tutor intervenes (3 wrong answers). */
export interface VideoSuggestion {
  guid: string;
  title: string;
  durationLabel: string;
  module: string;
  thumbnailUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  /** When present, a tappable video card is rendered below the text. */
  videoSuggestion?: VideoSuggestion;
}

interface TutorEvaluation {
  sub_topic_slug: string;
  is_correct: boolean;
  precision_score: number;
  technical_language_score: number;
  feedback: string;
}

interface TutorReply {
  reply: string;
  evaluation?: TutorEvaluation | null;
  error?: string;
}

interface SuggestVideoResponse {
  guid: string;
  title: string;
  durationLabel: string;
  module: string;
  thumbnailUrl?: string;
  error?: string;
}

/** Fetch the tutor's next message (which will be a question or a guiding hint). */
async function fetchTutorReply(
  history: ChatMessage[],
  message: string,
  options?: {
    mode?: "socratic" | "intervention";
    sub_topic_slug?: string;
    past_session_context?: string;
    current_question?: string;
    consecutive_wrong?: number;
  },
): Promise<TutorReply> {
  if (!functionsUrl) {
    return { reply: "El servicio de tutoría no está disponible en este momento." };
  }
  try {
    const res = await fetch(`${functionsUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Toolkit-URL": process.env.EXPO_PUBLIC_TOOLKIT_URL ?? "",
        "X-Toolkit-Key": process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY ?? "",
        ...supabaseHeaders,
      },
      body: JSON.stringify({
        history,
        message,
        mode: options?.mode ?? "socratic",
        sub_topic_slug: options?.sub_topic_slug,
        past_session_context: options?.past_session_context,
        current_question: options?.current_question,
        consecutive_wrong: options?.consecutive_wrong,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("fetchTutorReply non-ok:", res.status, errText.slice(0, 300));
      return { reply: "El tutor está procesando muchas solicitudes. Espera unos segundos e inténtalo de nuevo." };
    }
    const data = (await res.json()) as TutorReply;
    return data;
  } catch {
    return { reply: "No pude conectar con el tutor. Revisa tu conexión e inténtalo de nuevo." };
  }
}



/** Fetch a video suggestion for a sub-topic after 3 consecutive wrong answers. */
async function fetchVideoSuggestion(
  subTopicSlug: string,
): Promise<VideoSuggestion | null> {
  if (!functionsUrl) return null;
  try {
    const res = await fetch(
      `${functionsUrl}/suggest-video?sub_topic_slug=${encodeURIComponent(subTopicSlug)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as SuggestVideoResponse;
    if (data.error || !data.guid) return null;
    return {
      guid: data.guid,
      title: data.title,
      durationLabel: data.durationLabel,
      module: data.module,
      thumbnailUrl: data.thumbnailUrl,
    };
  } catch (err) {
    console.warn("Video suggestion fetch failed:", err);
    return null;
  }
}

function TypingDots() {
  const d1 = useRef(new Animated.Value(0.3)).current;
  const d2 = useRef(new Animated.Value(0.3)).current;
  const d3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 320,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0.3,
            duration: 320,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );

    const a1 = animate(d1, 0);
    const a2 = animate(d2, 200);
    const a3 = animate(d3, 400);
    a1.start();
    a2.start();
    a3.start();
    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [d1, d2, d3]);

  return (
    <View style={styles.dotsRow}>
      {[d1, d2, d3].map((d, i) => (
        <Animated.View key={i} style={[styles.dot, { opacity: d }]} />
      ))}
    </View>
  );
}

/** Format a session's timestamp into a short relative label. */
function formatSessionDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 1) return "Ahora";
  if (diffMin < 60) return `Hace ${diffMin} min`;
  if (diffHr < 24) return `Hace ${diffHr}h`;
  if (diffDay === 1) return "Ayer";
  if (diffDay < 7) return `Hace ${diffDay} días`;
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

interface ChatPanelProps {
  /** Optional title shown in the top bar. */
  title?: string;
  /** When provided, a soft sky-blue back button is rendered. */
  onBack?: () => void;
  /** When provided, a close (X) button is rendered. Used on the standalone
     chat screen (top bar) and on the inline embedded chat (floating). */
  onClose?: () => void;
  /** Hide the top bar entirely (used for inline embedded contexts). */
  hideTopBar?: boolean;
  /** Top inset override (used when embedded under a minimized video). */
  topInset?: number;
  /** Test id prefix for the back button. */
  backTestID?: string;
  /** Test id prefix for the close button. */
  closeTestID?: string;
}

export default function ChatPanel({
  title = "Consulta Académica",
  onBack,
  onClose,
  hideTopBar = false,
  topInset,
  backTestID = "back-to-video",
  closeTestID = "close-chat",
}: ChatPanelProps) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<string>("");
  const [isThinking, setIsThinking] = useState<boolean>(true);
  const [isLoadingSession, setIsLoadingSession] = useState<boolean>(true);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const { user, isLoading: authLoading, signIn, isSigningIn } = useAuth();
  const {
    sessions,
    createSessionOnFirstMessage,
    loadSessionMessages,
    saveMessage,
    generateAndSaveTitle,
    getTutorMemory,
  } = useChatSessions();

  // Track the active session ID — null until the user sends their first
  // message, at which point the session is created in the DB.
  const sessionIdRef = useRef<string | null>(null);

  // Conversation phases: "greeting" = tutor has greeted and asked where to
  // begin; user messages are NOT evaluated. "socratic" = tutor is asking
  // evaluable questions; user answers are evaluated and tracked.
  const phaseRef = useRef<"greeting" | "socratic">("greeting");
  const currentQuestionRef = useRef<string | null>(null);
  const attemptsRef = useRef<number>(0);
  const consecutiveWrongRef = useRef<number>(0);
  const currentSubTopicRef = useRef<string>("");
  const evaluatingRef = useRef<boolean>(false);
  const isFirstUserMessageRef = useRef<boolean>(true);
  const userMessageCountRef = useRef<number>(0);

  // Keep a ref in sync with messages so the unmount effect can read the latest
  // state without depending on the messages array itself.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // On mount: show the greeting locally without creating a DB session.
  // The session is only created when the user sends their first message.
  // Runs once on mount only — NOT dependent on user?.id, because auth
  // resolution changes user?.id from undefined to a real ID, which would
  // cancel the first timeout and restart it, causing the greeting to
  // never appear.
  useEffect(() => {
    sessionIdRef.current = null;
    // Simulate the tutor "typing" the greeting.
    const timer = setTimeout(() => {
      setMessages([
        { id: "greeting", role: "tutor", text: GREETING_TEXT },
      ]);
      setIsThinking(false);
      setIsLoadingSession(false);
    }, 1400);
    return () => clearTimeout(timer);
  }, []);

  // Progress report generation is now manual — the user taps "Actualizar"
  // in the library. No automatic AI calls on chat unmount.

  // Switch to a different session from the history drawer.
  const switchToSession = useCallback(
    async (session: ChatSession) => {
      if (evaluatingRef.current) return;
      setShowHistory(false);
      setIsThinking(true);
      setIsLoadingSession(true);
      sessionIdRef.current = session.id;
      const msgs = await loadSessionMessages(session.id);
      setMessages(msgs);
      // Determine phase: if there's at least one user message, we're in socratic.
      const hasUserMsg = msgs.some((m) => m.role === "alumno");
      phaseRef.current = hasUserMsg ? "socratic" : "greeting";
      isFirstUserMessageRef.current = !hasUserMsg;
      currentQuestionRef.current = hasUserMsg
        ? msgs.filter((m) => m.role === "tutor").pop()?.text ?? null
        : null;
      consecutiveWrongRef.current = 0;
      attemptsRef.current = 0;
      // Existing sessions already have titles — prevent regeneration.
      userMessageCountRef.current = msgs.filter((m) => m.role === "alumno").length >= 3 ? -1 : 0;
      setIsThinking(false);
      setIsLoadingSession(false);
    },
    [loadSessionMessages],
  );

  // Start a brand new session from the history drawer.
  // Resets to greeting state locally — no DB session until first message.
  const startNewSession = useCallback(async () => {
    if (evaluatingRef.current) return;
    setShowHistory(false);
    setIsThinking(true);
    setIsLoadingSession(true);
    sessionIdRef.current = null;
    setMessages([{ id: "greeting", role: "tutor", text: GREETING_TEXT }]);
    phaseRef.current = "greeting";
    isFirstUserMessageRef.current = true;
    currentQuestionRef.current = null;
    consecutiveWrongRef.current = 0;
    attemptsRef.current = 0;
    userMessageCountRef.current = 0;
    setIsThinking(false);
    setIsLoadingSession(false);
  }, []);

  const sendScale = useRef(new Animated.Value(1)).current;
  const backScale = useRef(new Animated.Value(1)).current;
  const closeScale = useRef(new Animated.Value(1)).current;
  const historyScale = useRef(new Animated.Value(1)).current;

  const pressIn = useCallback((v: Animated.Value) => {
    Animated.spring(v, {
      toValue: 0.92,
      useNativeDriver: true,
      speed: 50,
      bounciness: 6,
    }).start();
  }, []);

  const pressOut = useCallback((v: Animated.Value) => {
    Animated.spring(v, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 8,
    }).start();
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || evaluatingRef.current) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "alumno",
      text: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setDraft("");
    setIsThinking(true);
    Keyboard.dismiss();

    const historyForApi = [...messages];
    const DELAY_MS = 2000;
    const phase = phaseRef.current;
    const question = currentQuestionRef.current;
    const isFirst = isFirstUserMessageRef.current;

    evaluatingRef.current = true;

    // If this is the first user message, create the DB session now
    // (greeting + user message persisted together). No session exists
    // in the DB until the user actually sends a message.
    const ensureSession = async (): Promise<string | null> => {
      if (sessionIdRef.current) return sessionIdRef.current;
      if (!isFirst) return null;
      const result = await createSessionOnFirstMessage(trimmed);
      if (!result) return null;
      sessionIdRef.current = result.session.id;
      isFirstUserMessageRef.current = false;
      return result.session.id;
    };

    userMessageCountRef.current += 1;

    if (phase === "greeting") {
      // Always fetch the tutor reply — DB persistence is best-effort.
      // If session creation fails (not logged in, DB error, RLS), we still
      // show the reply; we just skip persisting it.
      const pastContext = getTutorMemory(sessionIdRef.current ?? undefined);
      fetchTutorReply(historyForApi, trimmed, {
        past_session_context: pastContext,
      })
        .then((tutorReply) =>
          new Promise<TutorReply>((resolve) =>
            setTimeout(() => resolve(tutorReply), DELAY_MS),
          ),
        )
        .then(async (tutorReply) => {
          const reply = tutorReply.reply;
          setIsThinking(false);
          const tutorMsg: ChatMessage = {
            id: `t-${Date.now()}`,
            role: "tutor",
            text: reply,
          };
          setMessages((prev) => [...prev, tutorMsg]);
          currentQuestionRef.current = reply;
          phaseRef.current = "socratic";
          evaluatingRef.current = false;

          // Best-effort persistence: create session + save messages.
          // If it fails, the conversation still works locally.
          try {
            const sid = await ensureSession();
            if (sid) {
              await saveMessage(sid, tutorMsg);
              // Title generation deferred until ≥3 user messages
            }
          } catch (err) {
            console.warn("Session persistence failed (reply still shown):", err);
          }
        })
        .catch(async () => {
          setIsThinking(false);
          await new Promise<void>((resolve) => setTimeout(resolve, DELAY_MS));
          const tutorMsg: ChatMessage = {
            id: `t-${Date.now()}`,
            role: "tutor",
            text: "Ocurrió un error al contactar al tutor. Inténtalo de nuevo.",
          };
          setMessages((prev) => [...prev, tutorMsg]);
          evaluatingRef.current = false;
        });
      return;
    }

    // Socratic phase: single batched call for evaluate + reply.
    // The backend evaluates the answer and generates the tutor response
    // in one Gemini call, cutting API usage in half.
    const sid = sessionIdRef.current;
    if (sid) {
      saveMessage(sid, userMsg).catch((err) =>
        console.warn("Failed to persist user message:", err),
      );
    }
    const pastContext = getTutorMemory(sid ?? undefined);

    attemptsRef.current += 1;
    const attempts = attemptsRef.current;
    const consecutiveWrongBefore = consecutiveWrongRef.current;

    fetchTutorReply(historyForApi, trimmed, {
      past_session_context: pastContext,
      current_question: question ?? undefined,
      consecutive_wrong: consecutiveWrongBefore,
    })
      .then((tutorReply) => {
        const evaluation = tutorReply.evaluation ?? null;

        // Update competency tracking from the batched evaluation
        if (evaluation && user && evaluation.sub_topic_slug) {
          currentSubTopicRef.current = evaluation.sub_topic_slug;
          const event: ChatCompetencyEvent = {
            sub_topic_slug: evaluation.sub_topic_slug,
            is_correct: evaluation.is_correct,
            precision_score: evaluation.precision_score,
            technical_language_score: evaluation.technical_language_score,
            attempts,
          };
          submitChatAnswer({
            userId: user.id,
            moduleName: null,
            event,
            sessionId: sid ?? "",
          }).catch((err) =>
            console.warn("Failed to submit chat answer:", err),
          );
        }

        // Update consecutive wrong counter
        if (evaluation && !evaluation.is_correct) {
          consecutiveWrongRef.current += 1;
        } else if (evaluation?.is_correct) {
          consecutiveWrongRef.current = 0;
        }

        // If this answer pushed consecutive wrong to ≥3, the model
        // should have already intervened in its reply text. We just
        // need to fetch the video card to show alongside it.
        const shouldShowVideo =
          consecutiveWrongRef.current >= 3 &&
          !!currentSubTopicRef.current;

        return { tutorReply, evaluation, shouldShowVideo };
      })
      .then(({ tutorReply, evaluation, shouldShowVideo }) => {
        if (shouldShowVideo) {
          const subTopic = currentSubTopicRef.current;
          return fetchVideoSuggestion(subTopic).then((video) => ({
            tutorReply,
            evaluation,
            video: video as VideoSuggestion | null,
            shouldShowVideo: true as boolean,
          }));
        }
        return {
          tutorReply,
          evaluation,
          video: null as VideoSuggestion | null,
          shouldShowVideo: false as boolean,
        };
      })
      .then((result) =>
        new Promise<typeof result>((resolve) =>
          setTimeout(() => resolve(result), DELAY_MS),
        ),
      )
      .then(async ({ tutorReply, evaluation, video, shouldShowVideo }: {
        tutorReply: TutorReply;
        evaluation: TutorEvaluation | null;
        video: VideoSuggestion | null;
        shouldShowVideo: boolean;
      }) => {
        setIsThinking(false);
        const reply = tutorReply.reply;
        const tutorMsg: ChatMessage = {
          id: `t-${Date.now()}`,
          role: "tutor",
          text: reply,
          videoSuggestion: shouldShowVideo ? video ?? undefined : undefined,
        };
        setMessages((prev) => [...prev, tutorMsg]);

        // Best-effort persistence
        if (sid) {
          await saveMessage(sid, tutorMsg).catch((err) =>
            console.warn("Failed to persist tutor message:", err),
          );
        }

        if (shouldShowVideo) {
          consecutiveWrongRef.current = 0;
          attemptsRef.current = 0;
        } else if (evaluation?.is_correct) {
          attemptsRef.current = 0;
        }
        currentQuestionRef.current = reply;
        evaluatingRef.current = false;

        // Generate session title after ≥3 user messages
        if (sid && userMessageCountRef.current >= 3) {
          const allMsgs = [...messagesRef.current, tutorMsg];
          generateAndSaveTitle(sid, allMsgs).catch(() => {});
          // Mark as titled so we don't regenerate every turn
          userMessageCountRef.current = -1;
        }
      })
      .catch(async () => {
        setIsThinking(false);
        await new Promise<void>((resolve) => setTimeout(resolve, DELAY_MS));
        const tutorMsg: ChatMessage = {
          id: `t-${Date.now()}`,
          role: "tutor",
          text: "Ocurrió un error al contactar al tutor. Inténtalo de nuevo.",
        };
        setMessages((prev) => [...prev, tutorMsg]);
        if (sid) {
          await saveMessage(sid, tutorMsg).catch(() => {});
        }
        evaluatingRef.current = false;
      });
  }, [draft, messages, user, saveMessage, getTutorMemory, createSessionOnFirstMessage, generateAndSaveTitle, submitChatAnswer]);

  const handleOpenVideo = useCallback((video: VideoSuggestion) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.replace({
      pathname: "/",
      params: {
        videoId: video.guid,
        title: video.title,
        description: "",
        durationLabel: video.durationLabel,
        instructor: "",
        level: "",
        module: video.module,
      },
    });
  }, []);

  const renderItem = useCallback(({ item }: { item: ChatMessage }) => {
    if (item.role === "alumno") {
      return (
        <View style={styles.alumnoRow}>
          <View style={styles.alumnoBubble}>
            <Text style={styles.alumnoText}>{item.text}</Text>
          </View>
        </View>
      );
    }
    return (
      <View style={styles.tutorRow}>
        <View style={styles.tutorAvatar}>
          <User size={18} color="#FFFFFF" strokeWidth={2} />
        </View>
        <View style={styles.tutorBubbleWrap}>
          <View style={styles.tutorBubble}>
            <Text style={styles.tutorText}>{item.text}</Text>
          </View>
          {item.videoSuggestion && (
            <Pressable
              onPress={() => handleOpenVideo(item.videoSuggestion!)}
              style={({ pressed }) => [
                styles.videoCard,
                pressed && styles.videoCardPressed,
              ]}
            >
              {item.videoSuggestion.thumbnailUrl ? (
                <Image
                  source={{ uri: item.videoSuggestion.thumbnailUrl }}
                  style={styles.videoThumb}
                />
              ) : (
                <View style={styles.videoThumbPlaceholder}>
                  <PlayCircle size={32} color={Colors.light.purple} strokeWidth={1.8} />
                </View>
              )}
              <View style={styles.videoCardInfo}>
                <Text style={styles.videoCardTitle} numberOfLines={2}>
                  {item.videoSuggestion.title}
                </Text>
                <Text style={styles.videoCardMeta}>
                  {item.videoSuggestion.module} · {item.videoSuggestion.durationLabel}
                </Text>
                <View style={styles.videoCardAction}>
                  <PlayCircle size={14} color={Colors.light.purple} strokeWidth={2} />
                  <Text style={styles.videoCardActionText}>Ver video</Text>
                </View>
              </View>
            </Pressable>
          )}
        </View>
      </View>
    );
  }, [handleOpenVideo]);

  const topPad = topInset ?? insets.top;

  // Session date label
  const activeSession = sessions.find((s) => s.id === sessionIdRef.current);
  const dateLabel = activeSession?.created_at
    ? new Date(activeSession.created_at).toLocaleDateString("es-ES", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).toUpperCase()
    : "HOY";

  // ── Auth gate ──
  // While auth is resolving, show a spinner so the user sees something
  // is happening. Once resolved, if there's no user, show a sign-in
  // prompt instead of the chat. The chat requires a user to persist
  // sessions and track competency.
  if (authLoading) {
    return (
      <View style={styles.root}>
        {(onBack || onClose) && (
          <View style={[styles.topBar, { paddingTop: topPad + 12 }]}>
            <Animated.View style={{ transform: [{ scale: backScale }] }}>
              <Pressable
                onPress={onBack ?? onClose ?? (() => {})}
                onPressIn={() => pressIn(backScale)}
                onPressOut={() => pressOut(backScale)}
                style={styles.iconButton}
                hitSlop={10}
              >
                <ArrowLeft size={18} color={Colors.light.navy} strokeWidth={2.2} />
              </Pressable>
            </Animated.View>
            <View style={styles.topCenter}>
              <Text style={styles.topTitle}>{title}</Text>
            </View>
            <View style={styles.topRightGroup}>
              <View style={styles.topSpacer} />
            </View>
          </View>
        )}
        <View style={styles.authGateLoading}>
          <ActivityIndicator size="large" color={Colors.light.purple} />
        </View>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.root}>
        {(onBack || onClose) && (
          <View style={[styles.topBar, { paddingTop: topPad + 12 }]}>
            <Animated.View style={{ transform: [{ scale: backScale }] }}>
              <Pressable
                onPress={onBack ?? onClose ?? (() => {})}
                onPressIn={() => pressIn(backScale)}
                onPressOut={() => pressOut(backScale)}
                style={styles.iconButton}
                hitSlop={10}
              >
                <ArrowLeft size={18} color={Colors.light.navy} strokeWidth={2.2} />
              </Pressable>
            </Animated.View>
            <View style={styles.topCenter}>
              <Text style={styles.topTitle}>{title}</Text>
            </View>
            <View style={styles.topRightGroup}>
              <View style={styles.topSpacer} />
            </View>
          </View>
        )}
        <View style={styles.authGate}>
          <View style={styles.authGateIcon}>
            <MessageCircle size={32} color={Colors.light.purple} strokeWidth={1.8} />
          </View>
          <Text style={styles.authGateTitle}>Inicia sesión para empezar</Text>
          <Text style={styles.authGateSubtitle}>
            Tu tutor necesita saber quién eres antes de poder empezar a ayudarte.
          </Text>
          <Pressable
            onPress={() => signIn("google")}
            disabled={isSigningIn}
            style={[styles.authGateButton, isSigningIn && styles.authGateButtonDisabled]}
          >
            {isSigningIn ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.authGateButtonText}>Continuar con Google</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        {!hideTopBar && (
          <View style={[styles.topBar, { paddingTop: topPad + 12 }]}>
            <Animated.View style={{ transform: [{ scale: backScale }] }}>
              <Pressable
                onPress={onBack ?? (() => {})}
                onPressIn={() => pressIn(backScale)}
                onPressOut={() => pressOut(backScale)}
                style={styles.iconButton}
                hitSlop={10}
                testID={backTestID}
              >
                <ArrowLeft size={18} color={Colors.light.navy} strokeWidth={2.2} />
              </Pressable>
            </Animated.View>
            <View style={styles.topCenter}>
              <Text style={styles.topTitle}>{title}</Text>
            </View>
            <View style={styles.topRightGroup}>
              <Animated.View style={{ transform: [{ scale: historyScale }] }}>
                <Pressable
                  onPress={() => setShowHistory(true)}
                  onPressIn={() => pressIn(historyScale)}
                  onPressOut={() => pressOut(historyScale)}
                  style={styles.iconButton}
                  hitSlop={8}
                  testID="open-history"
                >
                  <History size={18} color={Colors.light.navy} strokeWidth={2.2} />
                </Pressable>
              </Animated.View>
              {onClose ? (
                <Animated.View style={{ transform: [{ scale: closeScale }] }}>
                  <Pressable
                    onPress={onClose}
                    onPressIn={() => pressIn(closeScale)}
                    onPressOut={() => pressOut(closeScale)}
                    style={styles.iconButton}
                    hitSlop={10}
                    testID={closeTestID}
                  >
                    <X size={18} color={Colors.light.navy} strokeWidth={2.2} />
                  </Pressable>
                </Animated.View>
              ) : (
                <View style={styles.topSpacer} />
              )}
            </View>
          </View>
        )}

        {hideTopBar && (onClose || onBack) && (
          <View style={styles.inlineControlsWrap} pointerEvents="box-none">
            {onBack && (
              <Animated.View style={{ transform: [{ scale: backScale }] }}>
                <Pressable
                  onPress={onBack}
                  onPressIn={() => pressIn(backScale)}
                  onPressOut={() => pressOut(backScale)}
                  style={styles.inlineBackButton}
                  hitSlop={12}
                  testID={backTestID}
                >
                  <ArrowLeft size={18} color={Colors.light.navy} strokeWidth={2.4} />
                </Pressable>
              </Animated.View>
            )}
            <Animated.View style={{ transform: [{ scale: historyScale }] }}>
              <Pressable
                onPress={() => setShowHistory(true)}
                onPressIn={() => pressIn(historyScale)}
                onPressOut={() => pressOut(historyScale)}
                style={styles.inlineCloseButton}
                hitSlop={12}
                testID="open-history"
              >
                <History size={18} color={Colors.light.navy} strokeWidth={2.4} />
              </Pressable>
            </Animated.View>
            {onClose && (
              <Animated.View style={{ transform: [{ scale: closeScale }] }}>
                <Pressable
                  onPress={onClose}
                  onPressIn={() => pressIn(closeScale)}
                  onPressOut={() => pressOut(closeScale)}
                  style={styles.inlineCloseButton}
                  hitSlop={12}
                  testID={closeTestID}
                >
                  <X size={18} color={Colors.light.navy} strokeWidth={2.4} />
                </Pressable>
              </Animated.View>
            )}
          </View>
        )}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.listContent,
            hideTopBar && { paddingTop: 20 },
          ]}
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: true })
          }
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
          ListHeaderComponent={
            <View style={styles.dateWrap}>
              <Text style={styles.dateLabel}>{dateLabel}</Text>
            </View>
          }
          ListFooterComponent={
            isThinking ? (
              <View style={styles.tutorRow}>
                <View style={styles.tutorAvatar}>
                  <User size={18} color="#FFFFFF" strokeWidth={2} />
                </View>
                <View style={styles.tutorBubble}>
                  <TypingDots />
                </View>
              </View>
            ) : null
          }
        />

        <View style={[styles.inputWrap, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.inputRow}>
            <View style={styles.inputBar}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Escribe un mensaje..."
                placeholderTextColor={Colors.light.warmGrey}
                style={styles.input}
                maxLength={600}
                testID="chat-input"
                editable={!isLoadingSession}
              />
            </View>
            <Pressable
              onPress={() => {}}
              style={styles.micButton}
              hitSlop={8}
              testID="mic-button"
            >
              <Mic size={22} color={Colors.light.purple} strokeWidth={2} />
            </Pressable>
            <Animated.View style={{ transform: [{ scale: sendScale }] }}>
              <Pressable
                onPress={handleSend}
                onPressIn={() => pressIn(sendScale)}
                onPressOut={() => pressOut(sendScale)}
                style={styles.sendButton}
                hitSlop={8}
                testID="send-button"
              >
                <Send size={18} color="#FFFFFF" strokeWidth={2.2} />
              </Pressable>
            </Animated.View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Tutorías pasadas — history modal */}
      <Modal
        visible={showHistory}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowHistory(false)}
      >
        <View style={styles.historyRoot}>
          <View style={[styles.historyHeader, { paddingTop: insets.top + 12 }]}>
            <Pressable
              onPress={() => setShowHistory(false)}
              style={styles.iconButton}
              hitSlop={10}
            >
              <ArrowLeft size={18} color={Colors.light.navy} strokeWidth={2.2} />
            </Pressable>
            <Text style={styles.historyTitle}>Tutorías pasadas</Text>
            <View style={styles.topSpacer} />
          </View>

          <Pressable
            onPress={startNewSession}
            style={({ pressed }) => [
              styles.newSessionButton,
              pressed && styles.videoCardPressed,
            ]}
          >
            <View style={styles.newSessionIcon}>
              <Plus size={20} color="#FFFFFF" strokeWidth={2.4} />
            </View>
            <View style={styles.newSessionInfo}>
              <Text style={styles.newSessionTitle}>Iniciar nueva tutoría</Text>
              <Text style={styles.newSessionSubtitle}>
                Empezar una conversación desde cero
              </Text>
            </View>
            <ChevronRight size={20} color={Colors.light.warmGrey} strokeWidth={2} />
          </Pressable>

          <ScrollView
            style={styles.historyList}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            showsVerticalScrollIndicator={false}
          >
            {sessions.length === 0 && (
              <View style={styles.emptyWrap}>
                <MessageCircle size={40} color={Colors.light.warmGrey} strokeWidth={1.5} />
                <Text style={styles.emptyTitle}>No hay tutorías pasadas</Text>
                <Text style={styles.emptyText}>
                  Tus conversaciones con el tutor aparecerán aquí.
                </Text>
              </View>
            )}
            {sessions.map((s) => {
              const isActive = s.id === sessionIdRef.current;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => switchToSession(s)}
                  style={({ pressed }) => [
                    styles.sessionCard,
                    isActive && styles.sessionCardActive,
                    pressed && styles.videoCardPressed,
                  ]}
                >
                  <View style={styles.sessionIcon}>
                    <MessageCircle size={18} color={Colors.light.purple} strokeWidth={2.2} />
                  </View>
                  <View style={styles.sessionInfo}>
                    <Text style={styles.sessionTitle} numberOfLines={1}>
                      {s.title ?? "Tutoría sin título"}
                    </Text>
                    <View style={styles.sessionMetaRow}>
                      <Clock size={11} color={Colors.light.warmGrey} strokeWidth={2} />
                      <Text style={styles.sessionMeta}>
                        {formatSessionDate(s.last_message_at ?? s.created_at)}
                      </Text>
                      <View style={styles.metaDot} />
                      <Text style={styles.sessionMeta}>
                        {s.message_count} mensajes
                      </Text>
                    </View>
                  </View>
                  <ChevronRight size={18} color={Colors.light.warmGrey} strokeWidth={2} />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "transparent",
  },
  flex: { flex: 1 },
  authGateLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  authGate: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
  },
  authGateIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${Colors.light.purple}14`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  authGateTitle: {
    fontSize: 18,
    fontWeight: "800" as const,
    color: Colors.light.navy,
    marginBottom: 8,
    textAlign: "center",
  },
  authGateSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
    textAlign: "center",
    marginBottom: 24,
  },
  authGateButton: {
    backgroundColor: Colors.light.purple,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
    shadowColor: Colors.light.purple,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  authGateButtonDisabled: {
    opacity: 0.6,
  },
  authGateButtonText: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: "#FFFFFF",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: "#FFFFFF",
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  topCenter: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  topTitle: {
    fontSize: 17,
    fontWeight: "700" as const,
    letterSpacing: 0.2,
    color: Colors.light.navy,
  },
  topRightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  topSpacer: { width: 40 },
  dateWrap: {
    alignItems: "center",
    marginBottom: 24,
  },
  dateLabel: {
    fontSize: 12,
    fontWeight: "600" as const,
    letterSpacing: 0.8,
    color: Colors.light.warmGrey,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 12,
  },
  alumnoRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  alumnoBubble: {
    backgroundColor: Colors.light.purple,
    borderRadius: 20,
    borderBottomRightRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
    maxWidth: "78%",
  },
  alumnoText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "400" as const,
    color: "#FFFFFF",
  },
  tutorRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  tutorAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.light.purple,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  tutorBubbleWrap: {
    maxWidth: "78%",
    gap: 10,
  },
  tutorBubble: {
    backgroundColor: "#EDE9FE",
    borderRadius: 20,
    borderTopLeftRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  tutorText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "400" as const,
    color: Colors.light.navy,
  },
  inputWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 0,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inputBar: {
    flex: 1,
    backgroundColor: "#EDE9FE",
    borderRadius: 24,
    paddingHorizontal: 18,
    height: 48,
    alignItems: "center",
    flexDirection: "row",
  },
  input: {
    flex: 1,
    color: Colors.light.navy,
    fontSize: 15,
    fontWeight: "500" as const,
    paddingHorizontal: 0,
    paddingVertical: 0,
    marginVertical: 0,
    includeFontPadding: false,
    backgroundColor: "transparent",
    textAlign: "left" as const,
  },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#EDE9FE",
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.light.purple,
    alignItems: "center",
    justifyContent: "center",
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  inlineControlsWrap: {
    position: "absolute",
    top: 12,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    zIndex: 10,
  },
  inlineBackButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  inlineCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 18,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.light.purple,
  },
  videoCard: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  videoCardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  videoThumb: {
    width: 80,
    height: 80,
    backgroundColor: "#F1F5F9",
  },
  videoThumbPlaceholder: {
    width: 80,
    height: 80,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  videoCardInfo: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    justifyContent: "center",
    gap: 4,
  },
  videoCardTitle: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.light.navy,
    lineHeight: 18,
  },
  videoCardMeta: {
    fontSize: 11,
    fontWeight: "400" as const,
    color: Colors.light.warmGrey,
  },
  videoCardAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  videoCardActionText: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: Colors.light.purple,
  },
  // History modal styles
  historyRoot: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  historyTitle: {
    fontSize: 17,
    fontWeight: "700" as const,
    color: Colors.light.navy,
  },
  newSessionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F8F6FF",
  },
  newSessionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.purple,
    alignItems: "center",
    justifyContent: "center",
  },
  newSessionInfo: {
    flex: 1,
  },
  newSessionTitle: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: Colors.light.navy,
  },
  newSessionSubtitle: {
    fontSize: 13,
    fontWeight: "400" as const,
    color: Colors.light.warmGrey,
    marginTop: 2,
  },
  historyList: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  sessionCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 12,
    borderRadius: 14,
    marginBottom: 6,
    backgroundColor: "#FAFAFE",
  },
  sessionCardActive: {
    backgroundColor: "#F3EEFF",
    borderWidth: 1,
    borderColor: "#DDD6FE",
  },
  sessionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F3EEFF",
    alignItems: "center",
    justifyContent: "center",
  },
  sessionInfo: {
    flex: 1,
  },
  sessionTitle: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: Colors.light.navy,
  },
  sessionMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 4,
  },
  sessionMeta: {
    fontSize: 12,
    fontWeight: "400" as const,
    color: Colors.light.warmGrey,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.light.warmGrey,
  },
  emptyWrap: {
    alignItems: "center",
    paddingTop: 80,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600" as const,
    color: Colors.light.warmGrey,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: "400" as const,
    color: Colors.light.warmGrey,
    textAlign: "center",
  },
});
