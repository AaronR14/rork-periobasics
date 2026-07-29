import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import {
  ArrowRight,
  Bookmark,
  Check,
  ChevronLeft,
  Loader2,
  LogIn,
  Sparkles,
  Trophy,
  TriangleAlert,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Easing } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle as SvgCircle } from "react-native-svg";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { usePostHog } from "posthog-react-native";

import Colors from "@/constants/colors";
import ScreenFade from "@/components/ScreenFade";
import { QuizQuestion, getQuizForModule } from "@/data/quizzes";
import { submitQuizAttempt } from "@/hooks/useProgress";
import { useAuth } from "@/hooks/useAuth";
import { AnalyticsEvent } from "@/lib/posthog";

type QuizStep = "intro" | "question" | "result" | "review";
type SubmissionState = "idle" | "saving" | "saved" | "failed" | "skipped";

const RING_RADIUS = 70;
const RING_STROKE = 10;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

export default function QuizScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ module?: string }>();
  const moduleName = typeof params.module === "string" ? decodeURIComponent(params.module) : "";
  const quiz = useMemo(() => getQuizForModule(moduleName), [moduleName]);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const posthog = usePostHog();

  const [step, setStep] = useState<QuizStep>("intro");
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [reviewIndex, setReviewIndex] = useState<number>(0);
  const [submissionState, setSubmissionState] = useState<SubmissionState>("idle");
  const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittedRef = useRef<boolean>(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 450,
      useNativeDriver: true,
    }).start();
  }, [step, fadeAnim]);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startQuiz = useCallback(() => {
    if (!quiz) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setSelectedAnswers(Array(quiz.questions.length).fill(-1));
    setCurrentIndex(0);
    setElapsedSeconds(0);
    setStep("question");
    startTimer();
  }, [quiz, startTimer]);

  const restartQuiz = useCallback(() => {
    if (!quiz) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    submittedRef.current = false;
    setSubmissionState("idle");
    setSelectedAnswers(Array(quiz.questions.length).fill(-1));
    setCurrentIndex(0);
    setElapsedSeconds(0);
    setStep("question");
    startTimer();
  }, [quiz, startTimer]);

  const finishQuiz = useCallback(() => {
    stopTimer();
    setStep("result");
    setShowSuccessModal(true);

    if (!quiz || submittedRef.current) return;

    // Not signed in — mark as skipped so the user sees a sign-in prompt
    if (!user) {
      setSubmissionState("skipped");
      return;
    }

    submittedRef.current = true;
    setSubmissionState("saving");

    // Compute per-subtopic results: each question carries a subtopicSlug.
    // Group correct/total by subtopic so we submit one row per subtopic.
    const bySubtopic = new Map<string, { correct: number; total: number }>();
    for (let i = 0; i < quiz.questions.length; i++) {
      const q = quiz.questions[i];
      const slug = q.subtopicSlug;
      const entry = bySubtopic.get(slug) ?? { correct: 0, total: 0 };
      entry.total++;
      if (selectedAnswers[i] === q.correctIndex) entry.correct++;
      bySubtopic.set(slug, entry);
    }
    const subtopicResults = Array.from(bySubtopic.entries()).map(([subtopicSlug, v]) => ({
      subtopicSlug,
      correctAnswers: v.correct,
      totalQuestions: v.total,
    }));

    // Usage event: module + score/duration only — never the answers themselves.
    const totalCorrect = subtopicResults.reduce((sum, r) => sum + r.correctAnswers, 0);
    const totalQuestions = subtopicResults.reduce((sum, r) => sum + r.totalQuestions, 0);
    posthog.capture(AnalyticsEvent.QuizCompleted, {
      module: moduleName,
      score_percent: totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0,
      duration_seconds: elapsedSeconds,
    });

    submitQuizAttempt({
      userId: user.id,
      moduleName,
      subtopicResults,
      durationSeconds: elapsedSeconds,
    })
      .then((result) => {
        if (result.success) {
          setSubmissionState("saved");
          // Invalidate cached progress so the library tab shows fresh data
          queryClient.invalidateQueries({ queryKey: ["student_progress"] });
        } else {
          setSubmissionState("failed");
          console.error("Quiz submission failed:", result.error);
        }
      })
      .catch((err) => {
        setSubmissionState("failed");
        console.error("Quiz submission failed:", err);
      });
  }, [stopTimer, user, quiz, moduleName, selectedAnswers, elapsedSeconds, queryClient, posthog]);

  const dismissSuccessModal = useCallback(() => {
    setShowSuccessModal(false);
  }, []);

  const handleSelect = useCallback(
    (optionIndex: number) => {
      if (!quiz) return;
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      setSelectedAnswers((prev) => {
        const next = [...prev];
        next[currentIndex] = optionIndex;
        return next;
      });
    },
    [currentIndex, quiz],
  );

  const handleNext = useCallback(() => {
    if (!quiz) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (currentIndex < quiz.questions.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      finishQuiz();
    }
  }, [currentIndex, finishQuiz, quiz]);

  const handleBack = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (step === "question") {
      if (currentIndex > 0) {
        setCurrentIndex((i) => i - 1);
      } else {
        setStep("intro");
        stopTimer();
      }
    } else if (step === "review") {
      setStep("result");
    } else {
      router.back();
    }
  }, [currentIndex, step, stopTimer]);

  const results = useMemo(() => {
    if (!quiz) return { correct: 0, incorrect: 0, percentage: 0 };
    let correct = 0;
    for (let i = 0; i < quiz.questions.length; i++) {
      if (selectedAnswers[i] === quiz.questions[i].correctIndex) correct++;
    }
    const incorrect = quiz.questions.length - correct;
    const percentage = quiz.questions.length > 0 ? correct / quiz.questions.length : 0;
    return { correct, incorrect, percentage };
  }, [quiz, selectedAnswers]);

  if (!quiz) {
    return (
      <ScreenFade style={[styles.root, { paddingTop: insets.top + 12 }]}>
        <StatusBar style="dark" />
        <View style={styles.errorHeader}>
          <Pressable onPress={() => router.back()} style={styles.headerIcon}>
            <ChevronLeft size={24} color={Colors.light.navy} strokeWidth={2.4} />
          </Pressable>
        </View>
        <View style={styles.errorCenter}>
          <Text style={styles.errorTitle}>Evaluación no disponible</Text>
          <Text style={styles.errorSubtitle}>
            Aún no hay preguntas para este módulo.
          </Text>
        </View>
      </ScreenFade>
    );
  }

  return (
    <ScreenFade style={styles.root}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={handleBack} style={styles.headerIcon} hitSlop={12}>
          <ChevronLeft size={24} color={Colors.light.navy} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.headerTitle}>
          {step === "intro" && "Evaluación"}
          {step === "question" && `Evaluación · ${quiz.title}`}
          {step === "result" && "Resultados"}
          {step === "review" && "Revisión"}
        </Text>
        {step === "question" ? (
          <Pressable style={styles.headerIcon} hitSlop={12}>
            <Bookmark size={22} color={Colors.light.navy} strokeWidth={2.2} />
          </Pressable>
        ) : step === "result" ? (
          <Pressable
            onPress={() => router.replace({ pathname: "/library", params: { tab: "progress" } })}
            style={styles.headerIcon}
            hitSlop={12}
          >
            <X size={22} color={Colors.light.navy} strokeWidth={2.2} />
          </Pressable>
        ) : (
          <View style={styles.headerIcon} />
        )}
      </View>

      <Animated.View style={[styles.scroll, { opacity: fadeAnim, flex: 1 }]}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: step === "review" ? insets.bottom + 100 : insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {step === "intro" && <IntroView quiz={quiz} />}
          {step === "question" && (
            <QuestionView
              quiz={quiz}
              currentIndex={currentIndex}
              selected={selectedAnswers[currentIndex] ?? -1}
              onSelect={handleSelect}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}
          {step === "result" && quiz && (
            <ResultView
              quiz={quiz}
              selectedAnswers={selectedAnswers}
              elapsedSeconds={elapsedSeconds}
              submissionState={submissionState}
              onRetry={restartQuiz}
              onFinish={() => router.replace({ pathname: "/library", params: { tab: "progress" } })}
              onReview={(index) => {
                setReviewIndex(index);
                setStep("review");
              }}
            />
          )}
          {step === "review" && (
            <ReviewView
              quiz={quiz}
              questionIndex={reviewIndex}
              selectedIndex={selectedAnswers[reviewIndex] ?? -1}
            />
          )}
        </ScrollView>
      </Animated.View>

      {step === "review" && (
        <View
          style={[styles.reviewCtaContainer, { paddingBottom: insets.bottom + 24 }]}
          pointerEvents="box-none"
        >
          <LinearGradient
            colors={["rgba(248,250,252,0)", "rgba(248,250,252,0.9)", "#F8FAFC"]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <Pressable onPress={() => setStep("result")} style={styles.reviewBackButton}>
            <Text style={styles.reviewBackButtonText}>VOLVER AL RESUMEN</Text>
          </Pressable>
        </View>
      )}

      {step === "intro" && (
        <View pointerEvents="box-none" style={[styles.slideOverlay, { bottom: insets.bottom + 16, left: 16, right: 16 }]}>
          <SlideToStart onStart={startQuiz} />
        </View>
      )}

      {showSuccessModal && step === "result" && quiz && (
        <SuccessModal
          quiz={quiz}
          correct={results.correct}
          total={quiz.questions.length}
          elapsedSeconds={elapsedSeconds}
          accuracy={results.percentage}
          onClose={dismissSuccessModal}
          onContinue={dismissSuccessModal}
        />
      )}
    </ScreenFade>
  );
}

function IntroView({
  quiz,
}: {
  quiz: { title: string; theme: string; questions: QuizQuestion[] };
}) {
  return (
    <View style={styles.introBody}>
      <Text style={styles.introTitle}>Evaluación</Text>

      <LinearGradient
        colors={[Colors.light.violetGlow, Colors.light.purple]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.introCard}
      >
        <Star top={18} left={22} />
        <Star top={36} right={28} />
        <Star bottom={34} left={40} />
        <Star bottom={24} right={48} />
        <View style={styles.trophyWrap}>
          <Trophy size={40} color="#FFFFFF" strokeWidth={2} />
        </View>
      </LinearGradient>

      <Text style={styles.introHeading}>Pon a prueba tu conocimiento</Text>
      <Text style={styles.introSubtitle}>
        Responde {quiz.questions.length} preguntas sobre {quiz.theme.toLowerCase()}.
      </Text>

      <View style={styles.tagRow}>
        <View style={styles.tagPurple}>
          <Text style={styles.tagPurpleText}>{quiz.questions.length} Preguntas</Text>
        </View>
        <View style={styles.tagOutline}>
          <Text style={styles.tagOutlineText}>{quiz.title}</Text>
        </View>
      </View>
    </View>
  );
}

const SCREEN_WIDTH = Dimensions.get("window").width;
const SLIDER_PADDING = 6;
const KNOB_SIZE = 52;

function SlideToStart({ onStart }: { onStart: () => void }) {
  const trackWidth = SCREEN_WIDTH - 32;
  const maxDrag = trackWidth - KNOB_SIZE - SLIDER_PADDING * 2;
  const translateX = useSharedValue(0);
  const hasFired = useSharedValue(false);

  const fireStart = () => {
    onStart();
  };

  const gesture = Gesture.Pan()
    .onChange((e) => {
      const next = Math.max(0, Math.min(maxDrag, e.translationX));
      translateX.value = next;
      if (next >= maxDrag - 4 && !hasFired.value) {
        hasFired.value = true;
        runOnJS(fireStart)();
      }
    })
    .onEnd(() => {
      if (translateX.value < maxDrag - 4) {
        translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
      } else {
        translateX.value = withTiming(maxDrag, { duration: 120 });
      }
      hasFired.value = false;
    });

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: translateX.value + KNOB_SIZE + SLIDER_PADDING * 2,
  }));

  const hintOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [0, maxDrag * 0.5],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <View style={[styles.slideTrack, { width: trackWidth }]}>
      <Reanimated.View style={[styles.slideFill, fillStyle]} />
      <Reanimated.View style={[styles.slideHintWrap, hintOpacity]}>
        <Text style={styles.slideHint}>Desliza para comenzar</Text>
        <ArrowRight size={16} color={Colors.light.purple} strokeWidth={2.6} />
      </Reanimated.View>
      <GestureDetector gesture={gesture}>
        <Reanimated.View style={[styles.slideKnob, knobStyle]}>
          <ArrowRight size={24} color="#FFFFFF" strokeWidth={2.6} />
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

function Star({ top, bottom, left, right }: { top?: number; bottom?: number; left?: number; right?: number }) {
  return (
    <View
      style={[
        styles.star,
        top !== undefined && { top },
        bottom !== undefined && { bottom },
        left !== undefined && { left },
        right !== undefined && { right },
      ]}
    >
      <Sparkles size={14} color="rgba(255,255,255,0.7)" strokeWidth={2.2} />
    </View>
  );
}

function QuestionView({
  quiz,
  currentIndex,
  selected,
  onSelect,
  onNext,
  onBack,
}: {
  quiz: { questions: QuizQuestion[] };
  currentIndex: number;
  selected: number;
  onSelect: (index: number) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const question = quiz.questions[currentIndex];
  const progress = (currentIndex + 1) / quiz.questions.length;
  const isLast = currentIndex === quiz.questions.length - 1;
  const hasAnswered = selected >= 0;
  return (
    <View style={styles.questionBody}>
      <Text style={styles.questionCounter}>
        Pregunta {currentIndex + 1} de {quiz.questions.length}
      </Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      <Text style={styles.questionText}>{question.question}</Text>

      <View style={styles.optionsList}>
        {question.options.map((option, index) => {
          const isSelected = selected === index;
          return (
            <Pressable
              key={option}
              onPress={() => onSelect(index)}
              style={[
                styles.option,
                isSelected && styles.optionSelected,
              ]}
            >
              <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.questionFooter}>
        <Pressable onPress={onBack} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Regresar</Text>
        </Pressable>
        <Pressable
          onPress={onNext}
          disabled={!hasAnswered}
          style={[
            styles.primaryButton,
            !hasAnswered && styles.primaryButtonDisabled,
          ]}
        >
          <Text
            style={[
              styles.primaryButtonText,
              !hasAnswered && styles.primaryButtonTextDisabled,
            ]}
          >
            {isLast ? "Finalizar" : "Siguiente"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function SubmissionBanner({ state }: { state: SubmissionState }) {
  if (state === "idle") return null;

  if (state === "saving") {
    return (
      <View style={[styles.submissionBanner, { backgroundColor: "rgba(139,92,246,0.08)", borderColor: "rgba(139,92,246,0.20)" }]}>
        <Loader2 size={16} color={Colors.light.purple} strokeWidth={2.6} />
        <Text style={[styles.submissionText, { color: Colors.light.purple }]}>Guardando tu progreso…</Text>
      </View>
    );
  }

  if (state === "saved") {
    return (
      <View style={[styles.submissionBanner, { backgroundColor: "rgba(34,197,94,0.08)", borderColor: "rgba(34,197,94,0.20)" }]}>
        <Check size={16} color="#22C55E" strokeWidth={2.6} />
        <Text style={[styles.submissionText, { color: "#15803D" }]}>Progreso guardado en tu perfil</Text>
      </View>
    );
  }

  if (state === "failed") {
    return (
      <View style={[styles.submissionBanner, { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.20)" }]}>
        <TriangleAlert size={16} color="#EF4444" strokeWidth={2.6} />
        <Text style={[styles.submissionText, { color: "#B91C1C" }]}>No se pudo guardar el progreso. Revisa tu conexión e inténtalo de nuevo.</Text>
      </View>
    );
  }

  // skipped — not signed in
  return (
    <View style={[styles.submissionBanner, { backgroundColor: "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.20)" }]}>
      <LogIn size={16} color="#F59E0B" strokeWidth={2.6} />
      <Text style={[styles.submissionText, { color: "#B45309" }]}>
        Inicia sesión para que tu progreso se guarde en tu perfil de competencias.
      </Text>
    </View>
  );
}

function ResultView({
  quiz,
  selectedAnswers,
  elapsedSeconds,
  submissionState,
  onRetry,
  onFinish,
  onReview,
}: {
  quiz: { title: string; theme: string; questions: QuizQuestion[] };
  selectedAnswers: number[];
  elapsedSeconds: number;
  submissionState: SubmissionState;
  onRetry: () => void;
  onFinish: () => void;
  onReview: (index: number) => void;
}) {
  let correct = 0;
  for (let i = 0; i < quiz.questions.length; i++) {
    if (selectedAnswers[i] === quiz.questions[i].correctIndex) correct++;
  }
  const incorrect = quiz.questions.length - correct;
  const percentage = quiz.questions.length > 0 ? correct / quiz.questions.length : 0;
  const offset = RING_CIRCUMFERENCE * (1 - percentage);

  return (
    <View style={styles.resultBody}>
      <View style={styles.ringContainer}>
        <View style={styles.ringWrapper}>
          <Svg
            width={RING_RADIUS * 2 + RING_STROKE}
            height={RING_RADIUS * 2 + RING_STROKE}
            style={styles.ringSvg}
          >
            <SvgCircle
              cx={(RING_RADIUS * 2 + RING_STROKE) / 2}
              cy={(RING_RADIUS * 2 + RING_STROKE) / 2}
              r={RING_RADIUS}
              stroke={Colors.light.hairline}
              strokeWidth={RING_STROKE}
              fill="transparent"
            />
            <SvgCircle
              cx={(RING_RADIUS * 2 + RING_STROKE) / 2}
              cy={(RING_RADIUS * 2 + RING_STROKE) / 2}
              r={RING_RADIUS}
              stroke={Colors.light.purple}
              strokeWidth={RING_STROKE}
              fill="transparent"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={offset}
              strokeLinecap="round"
            />
          </Svg>
          <View style={styles.ringScoreText} pointerEvents="none">
            <Text style={styles.ringScoreValue}>
              {correct}/{quiz.questions.length}
            </Text>
          </View>
          <View style={styles.ringLabel} pointerEvents="none">
            <Text style={styles.ringLabelText}>PUNTOS</Text>
          </View>
        </View>
      </View>

      <Text style={styles.resultHeading}>{correct <= 3 ? "Intentalo de nuevo" : correct <= 7 ? "Lo puedes hacer mejor" : "¡Excelente trabajo!"}</Text>
      <Text style={styles.resultSubheading}>{quiz.title} · Evaluación</Text>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={[styles.statLabel, { color: Colors.light.warmGreyDark }]}>CORRECTAS</Text>
          <Text style={[styles.statValue, { color: "#22C55E" }]}>{correct}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statLabel, { color: Colors.light.warmGreyDark }]}>INCORRECTAS</Text>
          <Text style={[styles.statValue, { color: "#EF4444" }]}>{incorrect}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statLabel, { color: Colors.light.warmGreyDark }]}>TIEMPO</Text>
          <Text style={[styles.statValue, { color: Colors.light.navy }]}>{formatTime(elapsedSeconds)}</Text>
        </View>
      </View>

      <SubmissionBanner state={submissionState} />

      <Text style={styles.summaryTitle}>Resumen de respuestas</Text>
      <View style={styles.summaryList}>
        {quiz.questions.map((q, index) => {
          const isCorrect = selectedAnswers[index] === q.correctIndex;
          return (
            <Pressable
              key={q.id}
              onPress={() => !isCorrect && onReview(index)}
              style={({ pressed }) => [
                styles.summaryItem,
                !isCorrect && styles.summaryItemTouchable,
                pressed && !isCorrect && styles.summaryItemPressed,
              ]}
            >
              <Text style={styles.summaryIndex}>{index + 1}</Text>
              <Text style={styles.summaryQuestion} numberOfLines={1}>
                {q.question}
              </Text>
              <View
                style={[
                  styles.summaryIcon,
                  { backgroundColor: isCorrect ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)" },
                ]}
              >
                {isCorrect ? (
                  <Check size={16} color="#22C55E" strokeWidth={2.6} />
                ) : (
                  <X size={16} color="#EF4444" strokeWidth={2.6} />
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.resultFooter}>
        <Pressable onPress={onRetry} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Reintentar</Text>
        </Pressable>
        <Pressable onPress={onFinish} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Finalizar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const SCREEN_HEIGHT = Dimensions.get("window").height;

function SuccessModal({
  quiz,
  correct,
  total,
  elapsedSeconds,
  accuracy,
  onClose,
  onContinue,
}: {
  quiz: { title: string };
  correct: number;
  total: number;
  elapsedSeconds: number;
  accuracy: number;
  onClose: () => void;
  onContinue: () => void;
}) {
  const insets = useSafeAreaInsets();
  const percentage = total > 0 ? correct / total : 0;
  const offset = RING_CIRCUMFERENCE * (1 - percentage);
  const slideAnim = useSharedValue(SCREEN_HEIGHT);
  const fadeAnim = useSharedValue(0);

  useEffect(() => {
    slideAnim.value = withTiming(0, { duration: 700, easing: Easing.out(Easing.cubic) });
    fadeAnim.value = withTiming(1, { duration: 300 });
  }, [slideAnim, fadeAnim]);

  const handleClose = useCallback(() => {
    slideAnim.value = withTiming(
      SCREEN_HEIGHT,
      { duration: 350, easing: Easing.in(Easing.cubic) },
      () => {
        runOnJS(onClose)();
      },
    );
  }, [onClose, slideAnim]);

  const handleContinue = useCallback(() => {
    slideAnim.value = withTiming(
      SCREEN_HEIGHT,
      { duration: 350, easing: Easing.in(Easing.cubic) },
      () => {
        runOnJS(onContinue)();
      },
    );
  }, [onContinue, slideAnim]);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideAnim.value }],
  }));

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.value,
  }));

  return (
    <Reanimated.View
      style={[StyleSheet.absoluteFillObject, styles.modalOverlay, overlayAnimatedStyle]}
      pointerEvents="box-none"
    >
      <Reanimated.View
        style={[
          styles.modalCard,
          { paddingBottom: insets.bottom + 24, paddingTop: insets.top + 24 },
          cardAnimatedStyle,
        ]}
      >
        <Pressable onPress={handleClose} style={styles.modalClose} hitSlop={10}>
          <X size={20} color={Colors.light.warmGrey} strokeWidth={2.4} />
        </Pressable>

        <View style={styles.modalCheckCircle}>
          <Check size={38} color="#FFFFFF" strokeWidth={3} />
        </View>

        <Text style={styles.modalTitle}>¡Todo listo!</Text>
        <Text style={styles.modalSubtitle}>Aquí tienes tus resultados</Text>

        <View style={styles.modalStatsCard}>
          <View style={styles.modalRingWrapper}>
            <Svg
              width={RING_RADIUS * 2 + RING_STROKE}
              height={RING_RADIUS * 2 + RING_STROKE}
              style={styles.modalRingSvg}
            >
              <SvgCircle
                cx={(RING_RADIUS * 2 + RING_STROKE) / 2}
                cy={(RING_RADIUS * 2 + RING_STROKE) / 2}
                r={RING_RADIUS}
                stroke="rgba(124, 58, 237, 0.14)"
                strokeWidth={RING_STROKE}
                fill="transparent"
              />
              <SvgCircle
                cx={(RING_RADIUS * 2 + RING_STROKE) / 2}
                cy={(RING_RADIUS * 2 + RING_STROKE) / 2}
                r={RING_RADIUS}
                stroke={Colors.light.purple}
                strokeWidth={RING_STROKE}
                fill="transparent"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={offset}
                strokeLinecap="round"
              />
            </Svg>
            <View style={styles.modalRingCenter} pointerEvents="none">
              <Text style={styles.modalRingCenterValue}>{correct}</Text>
              <Text style={styles.modalRingCenterLabel}>of {total}</Text>
            </View>
          </View>

          <View style={styles.modalStatsRow}>
            <View style={styles.modalStat}>
              <Text style={styles.modalStatLabel}>Tiempo total</Text>
              <Text style={styles.modalStatValue}>{formatTime(elapsedSeconds)}</Text>
            </View>
            <View style={styles.modalStatDivider} />
            <View style={styles.modalStat}>
              <Text style={styles.modalStatLabel}>Respuestas correctas</Text>
              <Text style={styles.modalStatValue}>{Math.round(accuracy * 100)}%</Text>
            </View>
          </View>
        </View>

        <Pressable onPress={handleContinue} style={styles.modalContinueButton}>
          <Text style={styles.modalContinueButtonText}>Ve tus respuestas</Text>
        </Pressable>
      </Reanimated.View>
    </Reanimated.View>
  );
}

function ReviewView({
  quiz,
  questionIndex,
  selectedIndex,
}: {
  quiz: { title: string; questions: QuizQuestion[] };
  questionIndex: number;
  selectedIndex: number;
}) {
  const question = quiz.questions[questionIndex];
  const isCorrect = selectedIndex === question.correctIndex;
  return (
    <View style={styles.reviewBody}>
      <Text style={styles.reviewCounter}>
        Pregunta {questionIndex + 1} de {quiz.questions.length}
      </Text>
      <Text style={styles.reviewQuestionText}>{question.question}</Text>

      <View style={styles.optionsList}>
        {question.options.map((option, index) => {
          const isSelected = selectedIndex === index;
          const isAnswerCorrect = index === question.correctIndex;
          const isWrongSelection = isSelected && !isAnswerCorrect;

          let bg = "#FFFFFF";
          let border = Colors.light.hairline;
          let textColor = Colors.light.navy;
          let badge = null;

          if (isAnswerCorrect) {
            bg = "rgba(34,197,94,0.10)";
            border = "#22C55E";
            textColor = "#15803D";
            badge = (
              <View style={[styles.reviewBadge, { backgroundColor: "#22C55E" }]}>
                <Check size={13} color="#FFFFFF" strokeWidth={3} />
              </View>
            );
          } else if (isWrongSelection) {
            bg = "rgba(239,68,68,0.10)";
            border = "#EF4444";
            textColor = "#B91C1C";
            badge = (
              <View style={[styles.reviewBadge, { backgroundColor: "#EF4444" }]}>
                <X size={13} color="#FFFFFF" strokeWidth={3} />
              </View>
            );
          }

          return (
            <View
              key={option}
              style={[styles.reviewOption, { backgroundColor: bg, borderColor: border }]}
            >
              <Text style={[styles.reviewOptionText, { color: textColor }]}>{option}</Text>
              {badge}
            </View>
          );
        })}
      </View>

      <View style={[styles.reviewExplanation, isCorrect ? styles.reviewExplanationCorrect : styles.reviewExplanationWrong]}>
        <Text style={styles.reviewExplanationTitle}>¿En qué fallaste?</Text>
        <Text style={styles.reviewExplanationText}>{question.explanation}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.light.chalk,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: Colors.light.chalk,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.light.navy,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.light.navy,
  },
  scroll: {
    flex: 1,
  },
  introBody: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
  },
  introTitle: {
    fontSize: 26,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    letterSpacing: -0.4,
  },
  introCard: {
    width: "100%",
    height: 260,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
    overflow: "hidden",
  },
  star: {
    position: "absolute",
  },
  trophyWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.5)",
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  introHeading: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    marginBottom: 8,
  },
  introSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
    marginBottom: 20,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 36,
  },
  tagPurple: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: `${Colors.light.purple}14`,
  },
  tagPurpleText: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: Colors.light.purple,
  },
  tagOutline: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    backgroundColor: "#FFFFFF",
  },
  tagOutlineText: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: Colors.light.navy,
  },
  slideOverlay: {
    position: "absolute",
  },
  slideTrack: {
    height: KNOB_SIZE + SLIDER_PADDING * 2,
    borderRadius: (KNOB_SIZE + SLIDER_PADDING * 2) / 2,
    backgroundColor: "#EDE9FE",
    justifyContent: "center",
    overflow: "hidden",
  },
  slideFill: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: Colors.light.purple,
    borderRadius: (KNOB_SIZE + SLIDER_PADDING * 2) / 2,
  },
  slideHintWrap: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  slideHint: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: Colors.light.purple,
    letterSpacing: 0.2,
  },
  slideKnob: {
    position: "absolute",
    left: SLIDER_PADDING,
    top: SLIDER_PADDING,
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: Colors.light.purple,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.light.purple,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  questionBody: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  questionCounter: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.light.warmGreyDark,
    marginBottom: 10,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.light.hairline,
    overflow: "hidden",
    marginBottom: 24,
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.light.purple,
  },
  questionText: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    marginBottom: 24,
  },
  optionsList: {
    gap: 12,
    marginBottom: 28,
  },
  option: {
    paddingVertical: 17,
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    backgroundColor: "#FFFFFF",
  },
  optionSelected: {
    backgroundColor: Colors.light.purple,
    borderColor: Colors.light.purple,
  },
  optionText: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: Colors.light.navy,
  },
  optionTextSelected: {
    color: "#FFFFFF",
  },
  questionFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  primaryButton: {
    flex: 1,
    height: 52,
    borderRadius: 999,
    backgroundColor: Colors.light.purple,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.light.purple,
    shadowOpacity: 0.32,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: "#FFFFFF",
  },
  primaryButtonDisabled: {
    backgroundColor: Colors.light.hairline,
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryButtonTextDisabled: {
    color: Colors.light.warmGrey,
  },
  secondaryButton: {
    flex: 1,
    height: 52,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600" as const,
    color: Colors.light.navy,
  },
  resultBody: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  ringContainer: {
    alignItems: "center",
    marginBottom: 20,
  },
  ringWrapper: {
    width: RING_RADIUS * 2 + RING_STROKE,
    height: RING_RADIUS * 2 + RING_STROKE,
    justifyContent: "center",
    alignItems: "center",
  },
  ringSvg: {
    transform: [{ rotate: "-90deg" }],
  },
  ringScoreText: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: RING_RADIUS * 2 + RING_STROKE,
    justifyContent: "center",
    alignItems: "center",
    transform: [{ translateY: -10 }],
  },
  ringScoreValue: {
    fontSize: 28,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    textAlign: "center",
  },
  ringLabel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: RING_RADIUS * 2 + RING_STROKE,
    justifyContent: "center",
    alignItems: "center",
    transform: [{ translateY: 20 }],
  },
  ringLabelText: {
    fontSize: 11,
    fontWeight: "600" as const,
    color: Colors.light.warmGreyDark,
    textAlign: "center",
    letterSpacing: 1,
  },
  resultHeading: {
    fontSize: 22,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    textAlign: "center",
    marginBottom: 4,
  },
  resultSubheading: {
    fontSize: 13,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
    textAlign: "center",
    marginBottom: 24,
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 28,
  },
  statCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: Colors.light.hairline,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "800" as const,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    marginBottom: 14,
  },
  summaryList: {
    gap: 10,
    marginBottom: 28,
  },
  summaryItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: Colors.light.hairline,
  },
  summaryItemTouchable: {
    borderColor: "rgba(239,68,68,0.25)",
  },
  summaryItemPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.99 }],
  },
  summaryIndex: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: Colors.light.warmGrey,
    width: 22,
  },
  summaryQuestion: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.light.navy,
  },
  summaryIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  resultFooter: {
    flexDirection: "row",
    gap: 12,
  },
  submissionBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 24,
  },
  submissionText: {
    fontSize: 12.5,
    fontWeight: "600" as const,
    flex: 1,
    lineHeight: 18,
  },
  errorHeader: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  errorCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    marginBottom: 8,
    textAlign: "center",
  },
  errorSubtitle: {
    fontSize: 14,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
    textAlign: "center",
  },
  reviewBody: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  reviewCounter: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.light.warmGreyDark,
    marginBottom: 10,
  },
  reviewQuestionText: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    marginBottom: 24,
  },
  reviewOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 17,
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  reviewOptionText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600" as const,
  },
  reviewBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  reviewExplanation: {
    marginTop: 28,
    marginBottom: 28,
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 16,
  },
  reviewExplanationCorrect: {
    backgroundColor: "rgba(139,92,246,0.10)",
  },
  reviewExplanationWrong: {
    backgroundColor: "rgba(139,92,246,0.10)",
  },
  reviewCtaContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  reviewBackButton: {
    height: 56,
    borderRadius: 999,
    backgroundColor: Colors.light.purple,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.light.purple,
    shadowOpacity: 0.32,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  reviewBackButtonText: {
    fontSize: 14,
    fontWeight: "700" as const,
    letterSpacing: 1.5,
    color: "#FFFFFF",
  },
  reviewExplanationTitle: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    marginBottom: 6,
  },
  reviewExplanationText: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    justifyContent: "flex-end",
    alignItems: "stretch",
    zIndex: 50,
  },
  modalCard: {
    width: "100%",
    height: Math.round(SCREEN_HEIGHT * 0.75),
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    shadowColor: Colors.light.navy,
    shadowOpacity: 0.25,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: -8 },
    elevation: 10,
  },
  modalClose: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCheckCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: Colors.light.purple,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    shadowColor: Colors.light.purple,
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    marginBottom: 8,
    textAlign: "center",
  },
  modalSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
    textAlign: "center",
    marginBottom: 24,
  },
  modalScoreHighlight: {
    color: Colors.light.purple,
    fontWeight: "700" as const,
  },
  modalStatsCard: {
    width: "100%",
    backgroundColor: "#F8FAFC",
    borderRadius: 24,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: "center",
    marginBottom: 24,
  },
  modalRingWrapper: {
    width: RING_RADIUS * 2 + RING_STROKE,
    height: RING_RADIUS * 2 + RING_STROKE,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  modalRingSvg: {
    transform: [{ rotate: "-90deg" }],
  },
  modalRingCenter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  modalRingCenterValue: {
    fontSize: 28,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    lineHeight: 32,
  },
  modalRingCenterLabel: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: Colors.light.warmGreyDark,
  },
  modalStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  modalStat: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modalStatLabel: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 0.8,
    color: Colors.light.warmGrey,
    marginBottom: 6,
  },
  modalStatValue: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: Colors.light.navy,
  },
  modalStatDivider: {
    width: 1,
    height: 36,
    backgroundColor: Colors.light.hairline,
    marginHorizontal: 16,
  },
  modalContinueButton: {
    width: "100%",
    height: 54,
    borderRadius: 999,
    backgroundColor: Colors.light.purple,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.light.purple,
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  modalContinueButtonText: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: "#FFFFFF",
  },
});
