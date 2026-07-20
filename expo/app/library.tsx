import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lightbulb,
  RefreshCw,
  Trophy,
  User,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Platform,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Svg, { Circle as SvgCircle } from "react-native-svg";

import Colors from "@/constants/colors";
import ScreenFade from "@/components/ScreenFade";
import { supabase, getValidAccessToken, isUnauthorized, SESSION_EXPIRED_MESSAGE } from "@/lib/supabase";
import { functionsUrl, heroImageUri } from "@/lib/config";
import { getModuleDescription } from "@/data/module-descriptions";
import { getQuizForModule } from "@/data/quizzes";
import { useAuth } from "@/hooks/useAuth";
import {
  useProgress,
  computeModuleSummaries,
  computeCourseCompletion,
  upsertModuleMeta,
  type ModuleProgressSummary,
  type CourseCompletion,
  type ProgressReport,
} from "@/hooks/useProgress";

const BUNNY_LIBRARY_ID = "697694";

type TabKey = "modules" | "evaluations" | "progress";

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

interface ModuleGroup {
  name: string;
  videos: VideoListItem[];
}

function formatTotalDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) {
    return `${h}h ${m.toString().padStart(2, "0")} min`;
  }
  return `${m} min`;
}

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const [videos, setVideos] = useState<VideoListItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useLocalSearchParams<{ tab?: string }>();
  const initialTab: TabKey = searchParams.tab === "progress" || searchParams.tab === "evaluations" ? searchParams.tab : "modules";
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [selectedModule, setSelectedModule] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const { user, isLoading: authLoading, signIn, signOut, isSigningIn } = useAuth();
  const {
    progressRows,
    videoViews,
    quizBestScores,
    progressReport,
    isGeneratingReport,
    progressReportError,
    refreshProgressReport,
    isLoading: progressLoading,
    refetch,
  } = useProgress();
  // Compute module-level and course-level completion from all data sources
  const moduleSummaries = useMemo(
    () =>
      computeModuleSummaries({
        progressRows,
        videoViews,
        quizBestScores,
        videos: videos.map((v) => ({ guid: v.guid, module: v.module, category: v.category })),
      }),
    [progressRows, videoViews, quizBestScores, videos],
  );
  const watchedCount = useMemo(
    () => new Set(videoViews.map((v) => v.video_guid)).size,
    [videoViews],
  );
  const courseCompletion = useMemo(
    () => computeCourseCompletion(moduleSummaries, videos.length, watchedCount),
    [moduleSummaries, videos.length, watchedCount],
  );

  // Push module video counts to the DB so the competency RPC can compute
  // video_component (videos watched / total videos per module). Also triggers
  // a recalculation if the user is logged in, so competency bars reflect the
  // correct video_component as soon as video counts are known.
  useEffect(() => {
    if (videos.length === 0) return;
    const counts = new Map<string, number>();
    for (const v of videos) {
      const mod = v.module || "Módulo 1";
      counts.set(mod, (counts.get(mod) ?? 0) + 1);
    }
    const moduleCounts = Array.from(counts.entries()).map(([moduleName, videoCount]) => ({
      moduleName,
      videoCount,
    }));
    void (async () => {
      await upsertModuleMeta({ moduleCounts });
      // Recalculate competency now that module_meta has video counts.
      if (user) {
        for (const mc of moduleCounts) {
          try {
            const { error } = await supabase.rpc("recalculate_module_progress", {
              p_user_id: user.id,
              p_module_name: mc.moduleName,
            });
            if (error) console.warn("Failed to recalc after module_meta:", error.message);
          } catch (err) {
            console.warn("Failed to recalc after module_meta:", err instanceof Error ? err.message : String(err));
          }
        }
        refetch();
      }
    })();
  }, [videos, user]);

  // Refetch progress whenever the library regains focus (e.g. returning from a quiz)
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch is stable via useCallback

  useEffect(() => {
    const url = `${functionsUrl}/videos?libraryId=${BUNNY_LIBRARY_ID}`;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getValidAccessToken()
      .then((token) => fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }))
      .then((r) => {
        if (r.ok) return r.json();
        return Promise.reject(new Error(isUnauthorized(r) ? SESSION_EXPIRED_MESSAGE : `status ${r.status}`));
      })
      .then((data: { items?: VideoListItem[] }) => {
        if (cancelled) return;
        const items = Array.isArray(data.items) ? data.items : [];
        setVideos(items);
        setLoading(false);
        // Default to the first module (Módulo 1) so its videos show immediately.
        const firstModuleName = items.find((v) => v.module)?.module ?? "Módulo 1";
        setSelectedModule(firstModuleName);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const detail = e instanceof Error ? e.message : String(e);
        setError(detail);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleDropdown = useCallback(() => setDropdownOpen((o) => !o), []);

  const selectModule = useCallback((name: string) => {
    setSelectedModule(name);
    setDropdownOpen(false);
  }, []);

  const handleOpenVideo = useCallback((v: VideoListItem) => {
    router.push({
      pathname: "/",
      params: {
        videoId: v.guid,
        title: v.title,
        description: v.description ?? "",
        durationLabel: v.durationLabel,
        instructor: v.instructor ?? "",
        level: v.level ?? "",
        module: v.module ?? v.category ?? "",
      },
    });
  }, []);

  const { totalDuration, moduleGroups, activeGroup } = useMemo(() => {
    const totalDuration = videos.reduce((sum, v) => sum + (v.durationSeconds || 0), 0);
    const grouped = new Map<string, VideoListItem[]>();
    for (const v of videos) {
      const key = v.module || "Módulo 1";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(v);
    }
    const moduleGroups: ModuleGroup[] = Array.from(grouped.entries()).map(([name, items]) => ({
      name,
      videos: items.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })),
    }));
    // Videos for the currently selected module.
    const activeGroup = moduleGroups.find((g) => g.name === selectedModule) ?? moduleGroups[0];
    return { totalDuration, moduleGroups, activeGroup };
  }, [videos, selectedModule]);

  return (
    <ScreenFade style={styles.root}>
      <StatusBar style="light" />

      {/* Fixed header: hero card + tabs */}
      <View style={{ backgroundColor: Colors.light.background }}>
        <View style={[styles.hero, { paddingTop: 20, marginTop: insets.top + 22 }]}>
          <Image
            source={{ uri: heroImageUri }}
            style={styles.heroImage}
            resizeMode="cover"
          />
          <View style={styles.heroContent} pointerEvents="box-none">
            <Text style={styles.heroTitle}>PerioBasics</Text>
            <View style={styles.heroRow}>
              <User size={14} color="#FFFFFF" strokeWidth={2.5} />
              <Text style={styles.heroSubtitle}>Dr. Aaron Romero</Text>
            </View>
            <Text style={styles.heroMeta} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {loading ? "Cargando contenido…" : `${formatTotalDuration(totalDuration)} · ${moduleGroups.length} Módulos · ${videos.length} Videos`}
            </Text>
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabRow}>
          <TabButton
            label="Módulos"
            active={activeTab === "modules"}
            onPress={() => setActiveTab("modules")}
          />
          <TabButton
            label="Evaluaciones"
            active={activeTab === "evaluations"}
            onPress={() => setActiveTab("evaluations")}
          />
          <TabButton
            label="Progreso"
            active={activeTab === "progress"}
            onPress={() => setActiveTab("progress")}
          />
        </View>
      </View>

      {/* Scrollable body */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
          {loading && activeTab !== "progress" ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color={Colors.light.purple} />
            </View>
          ) : error && activeTab === "modules" ? (
            <View style={styles.centerState}>
              <Text style={styles.errorTitle}>No se pudieron cargar los videos</Text>
              <Text style={styles.errorDetail}>{error}</Text>
            </View>
          ) : activeTab === "modules" ? (
            <View style={styles.modulesList}>
              {moduleGroups.length === 0 ? (
                <Text style={styles.emptyTitle}>Aún no hay videos</Text>
              ) : (
                <>
                  {/* Module dropdown selector */}
                  <ModuleDropdown
                    groups={moduleGroups}
                    selected={selectedModule}
                    open={dropdownOpen}
                    onToggle={toggleDropdown}
                    onSelect={selectModule}
                  />

                  {/* Module description */}
                  {selectedModule ? (
                    <ModuleDescriptionCard moduleName={selectedModule} />
                  ) : null}

                  {/* Lecciones header + videos of the selected module */}
                  {activeGroup && activeGroup.videos.length > 0 ? (
                    <View style={styles.moduleVideos}>
                      <View style={styles.lessonsHeader}>
                        <Text style={styles.lessonsTitle}>Lecciones</Text>
                        <Text style={styles.lessonsCount}>
                          {activeGroup.videos.length} {activeGroup.videos.length === 1 ? "lección" : "lecciones"}
                        </Text>
                      </View>
                      {activeGroup.videos.map((v, i) => (
                        <VideoRow
                          key={v.guid}
                          video={v}
                          index={i}
                          onPress={() => handleOpenVideo(v)}
                        />
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.emptyTitle}>No hay videos en este módulo</Text>
                  )}
                </>
              )}
            </View>
          ) : activeTab === "evaluations" ? (
            <View style={styles.evaluationsList}>
              {moduleGroups.length === 0 ? (
                <Text style={styles.emptyTitle}>No hay módulos disponibles</Text>
              ) : (
                moduleGroups.map((g) => <QuizCard key={g.name} group={g} />)
              )}
            </View>
          ) : (
            <ProgressTab
              user={user}
              authLoading={authLoading}
              signIn={signIn}
              signOut={signOut}
              isSigningIn={isSigningIn}
              progressLoading={progressLoading}
              moduleSummaries={moduleSummaries}
              courseCompletion={courseCompletion}
              progressReport={progressReport}
              isGeneratingReport={isGeneratingReport}
              progressReportError={progressReportError}
              onRefreshReport={refreshProgressReport}
              videos={videos}
            />
          )}
      </ScrollView>

      {/* Floating tutor FAB — starts as full CTA, collapses to circular book icon */}
      <TutorFab bottomInset={insets.bottom} />

    </ScreenFade>
  );
}

/**
 * Floating tutor button. Starts as the full-width purple CTA pill (matching
 * the video player's CTA), then collapses after ~2.8s to a circular FAB with
 * a teacher icon in the bottom-right corner. Tapping either state opens the chat.
 */
function TutorFab({ bottomInset }: { bottomInset: number }) {
  const screenWidth = Dimensions.get("window").width;
  const FAB_FULL = screenWidth - 40;
  const FAB_CIRCLE = 56;
  const fabExpand = useRef(new Animated.Value(1)).current;
  const fabScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(fabExpand, {
        toValue: 0,
        duration: 700,
        easing: Easing.bezier(0.4, 0.0, 0.2, 1),
        useNativeDriver: false,
      }).start();
    }, 2800);
    return () => clearTimeout(timer);
  }, [fabExpand]);

  const handlePress = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    router.push("/chat");
  }, []);

  const pressIn = useCallback(() => {
    Animated.timing(fabScale, {
      toValue: 0.96,
      duration: 90,
      useNativeDriver: true,
    }).start();
  }, []);

  const pressOut = useCallback(() => {
    Animated.timing(fabScale, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <View
      style={[styles.fabContainer, { paddingBottom: bottomInset + 24 }]}
      pointerEvents="box-none"
    >
      <Animated.View
        style={{
          width: fabExpand.interpolate({
            inputRange: [0, 1],
            outputRange: [FAB_CIRCLE, FAB_FULL],
          }),
          marginLeft: fabExpand.interpolate({
            inputRange: [0, 1],
            outputRange: [FAB_FULL - FAB_CIRCLE, 0],
          }),
        }}
      >
        <Animated.View
          style={{ transform: [{ scale: fabScale }] }}
        >
          <Pressable
            onPress={handlePress}
            onPressIn={pressIn}
            onPressOut={pressOut}
            style={styles.fabButton}
          >
            <Animated.View
              style={{
                opacity: fabExpand.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [0, 0, 1],
                }),
              }}
            >
              <Text style={styles.fabText}>CONSULTA A TU TUTOR</Text>
            </Animated.View>
            <Animated.View
              style={[
                styles.fabIconWrap,
                {
                  opacity: fabExpand.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: [1, 0, 0],
                  }),
                },
              ]}
            >
              <Image
                source={require("@/assets/images/tutor-chat-icon-v2.png")}
                style={{ width: 26, height: 26, tintColor: "#FFFFFF" }}
                resizeMode="contain"
              />
            </Animated.View>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={active ? styles.tabActive : styles.tabInactive}>
      <Text style={active ? styles.tabActiveText : styles.tabInactiveText}>{label}</Text>
    </Pressable>
  );
}

function ModuleDropdown({
  groups,
  selected,
  open,
  onToggle,
  onSelect,
}: {
  groups: ModuleGroup[];
  selected: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (name: string) => void;
}) {
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(rotate, {
      toValue: open ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [rotate, open]);

  const spin = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  return (
    <View>
      <Pressable onPress={onToggle} style={styles.moduleHeader}>
        <View style={styles.moduleHeaderLeft}>
          <Text style={styles.moduleTitle} numberOfLines={1}>
            {selected || "Selecciona un módulo"}
          </Text>
        </View>
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <ChevronDown size={20} color={Colors.light.navy} strokeWidth={2.2} />
        </Animated.View>
      </Pressable>

      {open && (
        <View style={styles.dropdownList}>
          {groups.map((g) => {
            const isActive = g.name === selected;
            return (
              <Pressable
                key={g.name}
                onPress={() => onSelect(g.name)}
                style={isActive ? styles.dropdownItemActive : styles.dropdownItem}
              >
                <Text
                  style={isActive ? styles.dropdownItemTextActive : styles.dropdownItemText}
                  numberOfLines={1}
                >
                  {g.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function ModuleDescriptionCard({ moduleName }: { moduleName: string }) {
  const info = getModuleDescription(moduleName);
  const [expanded, setExpanded] = useState<boolean>(false);
  return (
    <View style={styles.moduleDescriptionContainer}>
      <Text style={styles.moduleDescriptionTitle}>{info.title}</Text>
      <Text
        style={styles.moduleDescriptionText}
        numberOfLines={expanded ? undefined : 3}
      >
        {info.description}
      </Text>
      <TouchableOpacity
        style={styles.moduleDescriptionToggle}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.6}
      >
        <Text style={styles.moduleDescriptionToggleText}>
          {expanded ? "Cerrar" : "Ver más"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function VideoRow({
  video,
  index,
  onPress,
}: {
  video: VideoListItem;
  index: number;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(0.96)).current;
  const [loaded, setLoaded] = useState<boolean>(false);

  useEffect(() => {
    Animated.timing(scale, {
      toValue: 1,
      duration: 340,
      delay: Math.min(index * 45, 300),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [scale, index]);

  const pressIn = useCallback(() => {
    Animated.timing(scale, {
      toValue: 0.98,
      duration: 90,
      useNativeDriver: true,
    }).start();
  }, [scale]);

  const pressOut = useCallback(() => {
    Animated.timing(scale, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, [scale]);

  const rawThumb = video.thumbnailUrl ?? "";
  const thumb = rawThumb.startsWith("http") ? rawThumb : rawThumb.length > 0 ? `https://${rawThumb}` : undefined;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        style={styles.videoRow}
      >
        <View style={styles.rowThumb}>
          {thumb ? (
            <Image
              source={{ uri: thumb }}
              style={StyleSheet.absoluteFill as object}
              resizeMode="cover"
              onLoad={() => setLoaded(true)}
            />
          ) : null}
          {!loaded && <View style={styles.rowThumbPlaceholder} />}
        </View>

        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {video.title}
          </Text>
          <View style={styles.rowMeta}>
            <Clock size={12} color={Colors.light.warmGreyDark} strokeWidth={2.2} />
            <Text style={styles.rowDuration}>{video.durationLabel}</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function QuizCard({ group }: { group: { name: string; videos: VideoListItem[] } }) {
  const scale = useRef(new Animated.Value(1)).current;
  const quiz = getQuizForModule(group.name);
  const pressIn = useCallback(() => {
    Animated.timing(scale, {
      toValue: 0.98,
      duration: 90,
      useNativeDriver: true,
    }).start();
  }, [scale]);
  const pressOut = useCallback(() => {
    Animated.timing(scale, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, [scale]);
  const handleTakeQuiz = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    router.push({
      pathname: "/quiz",
      params: { module: encodeURIComponent(group.name) },
    });
  }, [group.name]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={handleTakeQuiz}
        onPressIn={pressIn}
        onPressOut={pressOut}
        style={styles.quizCard}
      >
        <View style={styles.quizCardIcon}>
          <Trophy size={22} color="#FFFFFF" strokeWidth={2.2} />
        </View>
        <View style={styles.quizCardBody}>
          <Text style={styles.quizCardTitle} numberOfLines={1}>
            {quiz?.title ?? group.name}
          </Text>
          <Text style={styles.quizCardSubtitle}>
            {quiz ? `${quiz.questions.length} preguntas` : "Evaluación próximamente"}
          </Text>
        </View>
        <View style={styles.quizCardButton}>
          <Text style={styles.quizCardButtonText}>TOMAR QUIZ</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function ProgressBar({ pct, height = 8 }: { pct: number; height?: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color =
    clamped >= 70 ? "#22C55E" : clamped >= 40 ? Colors.light.purple : "#F59E0B";
  return (
    <View style={[styles.barTrack, { height, borderRadius: height / 2 }]}>
      <Animated.View
        style={{
          width: `${clamped}%`,
          height,
          borderRadius: height / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

function ProgressRing({ score, size, stroke }: { score: number; size: number; stroke: number }) {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - Math.max(0, Math.min(100, score)) / 100);
  const color = score >= 70 ? "#22C55E" : score >= 40 ? Colors.light.purple : "#F59E0B";

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
        <SvgCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={Colors.light.hairline}
          strokeWidth={stroke}
          fill="transparent"
        />
        <SvgCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="transparent"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </Svg>
      <View style={{ position: "absolute", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: size * 0.24, fontWeight: "800", color: Colors.light.navy }}>
          {`${Math.round(Math.max(0, Math.min(100, score)))}%`}
        </Text>
      </View>
    </View>
  );
}

function StatBlock({
  icon,
  label,
  value,
  pct,
}: {
  icon: "video" | "quiz" | "tutor";
  label: string;
  value: string;
  pct: number;
}) {
  const color = pct >= 70 ? "#22C55E" : pct >= 40 ? Colors.light.purple : "#F59E0B";
  return (
    <View style={styles.statBlock}>
      <View style={[styles.statBlockIcon, { backgroundColor: `${color}18` }]}>
        {icon === "video" && <Clock size={16} color={color} strokeWidth={2.4} />}
        {icon === "quiz" && <Trophy size={16} color={color} strokeWidth={2.4} />}
        {icon === "tutor" && <User size={16} color={color} strokeWidth={2.4} />}
      </View>
      <Text style={styles.statBlockValue}>{value}</Text>
      <Text style={styles.statBlockLabel}>{label}</Text>
    </View>
  );
}

function ProgressModuleDropdown({
  modules,
  selected,
  open,
  onToggle,
  onSelect,
}: {
  modules: { name: string; pct: number }[];
  selected: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (name: string) => void;
}) {
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(rotate, {
      toValue: open ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [rotate, open]);

  const spin = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  return (
    <View>
      <Pressable onPress={onToggle} style={styles.progressDropdownHeader}>
        <View style={styles.progressDropdownLeft}>
          <Text style={styles.progressDropdownTitle} numberOfLines={1}>
            {selected || "Selecciona un módulo"}
          </Text>
        </View>
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <ChevronDown size={20} color={Colors.light.navy} strokeWidth={2.2} />
        </Animated.View>
      </Pressable>

      {open && (
        <View style={styles.dropdownList}>
          {modules.map((m) => {
            const isActive = m.name === selected;
            return (
              <Pressable
                key={m.name}
                onPress={() => onSelect(m.name)}
                style={isActive ? styles.dropdownItemActive : styles.dropdownItem}
              >
                <Text
                  style={isActive ? styles.dropdownItemTextActive : styles.dropdownItemText}
                  numberOfLines={1}
                >
                  {m.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function TutorInsightCard({
  report,
  videos,
}: {
  report: ProgressReport;
  videos: VideoListItem[];
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = useCallback(() => {
    Animated.timing(scale, {
      toValue: 0.98,
      duration: 90,
      useNativeDriver: true,
    }).start();
  }, [scale]);
  const pressOut = useCallback(() => {
    Animated.timing(scale, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, [scale]);

  const handlePress = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    // Find the first video in the recommended module and open it.
    const moduleVideo = videos.find((v) => v.module === report.next_action.module_name);
    if (moduleVideo) {
      router.push({
        pathname: "/",
        params: {
          videoId: moduleVideo.guid,
          title: moduleVideo.title,
          description: moduleVideo.description ?? "",
          durationLabel: moduleVideo.durationLabel,
          instructor: moduleVideo.instructor ?? "",
          level: moduleVideo.level ?? "",
          module: moduleVideo.module ?? moduleVideo.category ?? "",
        },
      });
    } else {
      // Fallback to the library modules tab filtered to the recommended module.
      router.push({ pathname: "/library", params: { tab: "modules" } });
    }
  }, [report, videos]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={handlePress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        style={styles.insightCard}
      >
        <View style={styles.insightHeader}>
          <View style={styles.insightIcon}>
            <Lightbulb size={22} color="#FFFFFF" strokeWidth={2.2} />
          </View>
          <View style={styles.insightTitleWrap}>
            <Text style={styles.insightTitle}>Recomendación de tu tutor</Text>
            <Text style={styles.insightStatus}>{report.overall_status}</Text>
          </View>
          <ChevronRight size={20} color={Colors.light.purple} strokeWidth={2.2} />
        </View>

        <View style={styles.insightAction}>
          <Text style={styles.insightActionText} numberOfLines={2}>
            {report.next_action.message}
          </Text>
          <Text style={styles.insightActionMeta}>
            {report.next_action.sub_topic_label} · {report.next_action.module_name}
          </Text>
        </View>

        {report.priority_gaps.length > 0 && (
          <View style={styles.insightGaps}>
            <Text style={styles.insightSectionLabel}>Prioridades</Text>
            {report.priority_gaps.slice(0, 2).map((gap: string, i: number) => (
              <Text key={i} style={styles.insightBullet}>
                • {gap}
              </Text>
            ))}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

function ProgressTab({
  user,
  authLoading,
  signIn,
  signOut,
  isSigningIn,
  progressLoading,
  moduleSummaries,
  courseCompletion,
  progressReport,
  isGeneratingReport,
  progressReportError,
  onRefreshReport,
  videos,
}: {
  user: { id: string; email: string; name?: string; picture?: string } | null;
  authLoading: boolean;
  signIn: (provider: "google" | "apple") => Promise<void>;
  signOut: () => Promise<void>;
  isSigningIn: boolean;
  progressLoading: boolean;
  moduleSummaries: ModuleProgressSummary[];
  courseCompletion: CourseCompletion;
  progressReport: ProgressReport | null;
  isGeneratingReport: boolean;
  progressReportError: string | null;
  onRefreshReport: () => void;
  videos: VideoListItem[];
}) {
  const [selectedModule, setSelectedModule] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);

  useEffect(() => {
    if (moduleSummaries.length > 0 && !selectedModule) {
      setSelectedModule(moduleSummaries[0].moduleName);
    }
  }, [moduleSummaries, selectedModule]);

  const activeModule = useMemo(
    () => moduleSummaries.find((m) => m.moduleName === selectedModule) ?? moduleSummaries[0],
    [moduleSummaries, selectedModule],
  );

  if (authLoading) {
    return (
      <View style={styles.progressLoading}>
        <ActivityIndicator size="large" color={Colors.light.purple} />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.progressAuthGate}>
        <View style={styles.progressAuthIcon}>
          <User size={32} color={Colors.light.purple} strokeWidth={2} />
        </View>
        <Text style={styles.progressAuthTitle}>Inicia sesión para ver tu progreso</Text>
        <Text style={styles.progressAuthSubtitle}>
          Tu avance del curso se trackea automáticamente al ver videos, completar evaluaciones y conversar con el tutor.
        </Text>
        <Pressable
          onPress={() => signIn("google")}
          disabled={isSigningIn}
          style={[styles.progressAuthButton, isSigningIn && styles.progressAuthButtonDisabled]}
        >
          {isSigningIn ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.progressAuthButtonText}>Continuar con Google</Text>
          )}
        </Pressable>
      </View>
    );
  }

  if (progressLoading && moduleSummaries.length === 0) {
    return (
      <View style={styles.progressLoading}>
        <ActivityIndicator size="large" color={Colors.light.purple} />
      </View>
    );
  }

  return (
    <View style={styles.progressContainer}>
      {/* ── Course competency card ── */}
      <View style={styles.overallCard}>
        <View style={styles.overallRingWrap}>
          <ProgressRing score={courseCompletion.overallPct} size={72} stroke={8} />
        </View>
        <View style={styles.overallBody}>
          <Text style={styles.overallValue}>
            {courseCompletion.overallPct >= 100
              ? "¡Misión cumplida!"
              : courseCompletion.overallPct >= 76
                ? "¡Ya casi!"
                : courseCompletion.overallPct >= 51
                  ? "Imparable ahora"
                  : courseCompletion.overallPct >= 26
                    ? "Estás mejorando"
                    : "Calentando motores"}
          </Text>
        </View>
        <Pressable
          onPress={onRefreshReport}
          disabled={isGeneratingReport}
          style={({ pressed }) => [
            styles.refreshBtn,
            pressed && styles.refreshBtnPressed,
          ]}
          hitSlop={8}
        >
          {isGeneratingReport ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <RefreshCw size={18} color="#FFFFFF" strokeWidth={2.4} />
          )}
        </Pressable>
      </View>

      {/* ── Tutor insight card ── */}
      {progressReport && (
        <TutorInsightCard report={progressReport} videos={videos} />
      )}
      {progressReportError && (
        <Text style={styles.sessionExpiredText}>{progressReportError}</Text>
      )}

      {/* ── Module selector dropdown ── */}
      {moduleSummaries.length > 0 && (
        <>
          <ProgressModuleDropdown
            modules={moduleSummaries.map((m) => ({ name: m.moduleName, pct: m.competencyScore }))}
            selected={selectedModule}
            open={dropdownOpen}
            onToggle={() => setDropdownOpen((o) => !o)}
            onSelect={(name) => {
              setSelectedModule(name);
              setDropdownOpen(false);
            }}
          />

          {/* ── Selected module detail ── */}
          {activeModule && (
            <View style={styles.moduleDetailCard}>
              <Text style={styles.moduleDetailTitle}>{activeModule.moduleName}</Text>

              <View style={styles.moduleDetailStatRow}>
                <StatBlock
                  icon="video"
                  label="Videos"
                  value={`${activeModule.videosWatched}/${activeModule.totalVideos}`}
                  pct={activeModule.videoPct}
                />
                <StatBlock
                  icon="quiz"
                  label="Quiz"
                  value={activeModule.quizAttempts > 0 ? `${Math.round(activeModule.quizBestScore)}%` : "—"}
                  pct={activeModule.quizBestScore}
                />
                <StatBlock
                  icon="tutor"
                  label="Tutor"
                  value={activeModule.tutorScore > 0 ? `${Math.round(activeModule.tutorScore)}%` : "—"}
                  pct={activeModule.tutorScore}
                />
              </View>

              <View style={styles.moduleCompletionRow}>
                <Text style={styles.moduleCompletionLabel}>Cómo vas en este módulo</Text>
              </View>
              <ProgressBar pct={activeModule.competencyScore} height={10} />

              {activeModule.subTopics.length > 0 && (
                <View style={styles.subTopicsSection}>
                  <Text style={styles.subTopicsSectionTitle}>Manejo del tema</Text>
                  <Text style={styles.subTopicsHint}>
                    Esta barra refleja tu dominio de cada subtema según lo que demuestras en las conversaciones con el tutor. Sube a medida que respondes correctamente y con precisión.
                  </Text>
                  {activeModule.subTopics.map((sub) => (
                    <View key={sub.sub_topic_slug} style={styles.subTopicRow}>
                      <Text style={styles.subTopicLabel} numberOfLines={1}>
                        {sub.sub_topic_label}
                      </Text>
                      <ProgressBar pct={sub.computedFinalScore ?? sub.final_score} height={6} />
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </>
      )}

      {/* ── Sign out ── */}
      <Pressable
        onPress={signOut}
        style={({ pressed }) => [
          styles.signOutButton,
          pressed && styles.signOutButtonPressed,
        ]}
      >
        <Text style={styles.signOutButtonText}>Cerrar sesión</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  scroll: {
    flex: 1,
  },
  hero: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 24,
    height: 170,
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-between",
    backgroundColor: Colors.light.purple,
    shadowColor: Colors.light.purple,
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
    overflow: "hidden",
  },
  heroContent: {
    flex: 1,
    paddingTop: 56,
    paddingLeft: 22,
    paddingRight: 170,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: "800" as const,
    color: "#FFFFFF",
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  heroSubtitle: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: "rgba(255,255,255,0.92)",
  },
  heroMeta: {
    fontSize: 12,
    fontWeight: "500" as const,
    color: "rgba(255,255,255,0.78)",
  },
  heroImage: {
    width: 180,
    height: 224,
    position: "absolute" as const,
    top: 0,
    right: -30,
    transform: [{ translateY: -20 }],
  },
  tabRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  tabActive: {
    backgroundColor: Colors.light.purple,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  tabInactive: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
  },
  tabActiveText: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: "#FFFFFF",
  },
  tabInactiveText: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.light.navy,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  modulesList: {
    gap: 12,
  },
  moduleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
  },
  moduleHeaderLeft: {
    flex: 1,
    marginRight: 12,
  },
  moduleTitle: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: Colors.light.navy,
  },
  moduleVideos: {
    paddingTop: 2,
    gap: 12,
  },
  lessonsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 10,
    paddingBottom: 2,
  },
  lessonsTitle: {
    fontSize: 18,
    fontWeight: "800" as const,
    color: Colors.light.navy,
    letterSpacing: -0.2,
  },
  lessonsCount: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.light.warmGreyDark,
  },
  moduleDescriptionContainer: {
    paddingHorizontal: 4,
    marginTop: 2,
  },
  moduleDescriptionTitle: {
    fontSize: 16,
    fontWeight: "800" as const,
    color: Colors.light.navy,
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  moduleDescriptionText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
  },
  moduleDescriptionToggle: {
    marginTop: 4,
    alignSelf: "flex-start",
  },
  moduleDescriptionToggleText: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: Colors.light.navy,
  },
  dropdownList: {
    marginTop: 6,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    overflow: "hidden",
    shadowColor: Colors.light.cardShadow,
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.hairline,
  },
  dropdownItemActive: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: `${Colors.light.purple}14`,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.hairline,
  },
  dropdownItemText: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: Colors.light.navy,
    flexShrink: 1,
  },
  dropdownItemTextActive: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: Colors.light.purple,
    flexShrink: 1,
  },
  videoRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    shadowColor: Colors.light.cardShadow,
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  rowThumb: {
    width: 88,
    height: 66,
    borderRadius: 12,
    backgroundColor: "#E2E8F0",
    overflow: "hidden",
    position: "relative",
  },
  rowThumbPlaceholder: {
    ...StyleSheet.absoluteFill as object,
    backgroundColor: "#E2E8F0",
  },
  rowBody: {
    flex: 1,
    marginLeft: 14,
    justifyContent: "center",
  },
  rowTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    marginBottom: 8,
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 10,
  },
  rowDuration: {
    fontSize: 12,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
  },
  emptyTab: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 30,
  },
  emptyTabTitle: {
    fontSize: 17,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    marginBottom: 8,
  },
  emptyTabSubtitle: {
    fontSize: 13,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
    textAlign: "center",
  },
  centerState: {
    paddingVertical: 80,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  loadingText: {
    marginTop: 14,
    fontSize: 13.5,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    marginBottom: 8,
    textAlign: "center",
  },
  errorDetail: {
    fontSize: 12.5,
    color: Colors.light.warmGrey,
    textAlign: "center",
  },
  sessionExpiredText: {
    fontSize: 12.5,
    color: Colors.light.warmGreyDark,
    textAlign: "center",
    marginTop: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "600" as const,
    color: Colors.light.warmGreyDark,
    textAlign: "center",
    paddingVertical: 40,
  },
evaluationsList: {
    gap: 12,
  },
  quizCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    shadowColor: Colors.light.cardShadow,
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  quizCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.light.purple,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  quizCardBody: {
    flex: 1,
  },
  quizCardTitle: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    marginBottom: 4,
  },
  quizCardSubtitle: {
    fontSize: 12,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
  },
  quizCardButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: Colors.light.purple,
  },
  quizCardButtonText: {
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 0.6,
    color: "#FFFFFF",
  },
  // ── Progress tab styles ──
  progressLoading: {
    paddingVertical: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  progressAuthGate: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 30,
  },
  progressAuthIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${Colors.light.purple}14`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  progressAuthTitle: {
    fontSize: 18,
    fontWeight: "800" as const,
    color: Colors.light.navy,
    marginBottom: 8,
    textAlign: "center",
  },
  progressAuthSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
    textAlign: "center",
    marginBottom: 24,
  },
  progressAuthButton: {
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
  progressAuthButtonDisabled: {
    opacity: 0.6,
  },
  progressAuthButtonText: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: "#FFFFFF",
  },
  progressEmpty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 30,
  },
  progressEmptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: `${Colors.light.warmGrey}1A`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  progressEmptyTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    marginBottom: 6,
    textAlign: "center",
  },
  progressEmptySubtitle: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
    textAlign: "center",
  },
  progressContainer: {
    gap: 16,
  },
  signOutButton: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
  },
  signOutButtonPressed: {
    backgroundColor: Colors.light.chalk,
  },
  signOutButtonText: {
    fontSize: 15,
    fontWeight: "600" as const,
    color: Colors.light.warmGreyDark,
  },
  overallCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    shadowColor: Colors.light.cardShadow,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  overallRingWrap: {
    marginRight: 18,
  },
  overallBody: {
    flex: 1,
  },
  overallValue: {
    fontSize: 24,
    fontWeight: "800" as const,
    color: Colors.light.navy,
  },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.purple,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  refreshBtnPressed: {
    backgroundColor: Colors.light.purpleDark,
    transform: [{ scale: 0.92 }],
  },
  macroSection: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
  },
  macroHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  macroTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800" as const,
    color: Colors.light.navy,
    letterSpacing: -0.2,
  },
  macroScoreBadge: {
    minWidth: 36,
    height: 28,
    borderRadius: 14,
    backgroundColor: `${Colors.light.purple}14`,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  macroScoreText: {
    fontSize: 13,
    fontWeight: "800" as const,
    color: Colors.light.purple,
  },
  subTopicRow: {
    paddingVertical: 10,
  },
  subTopicLabel: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: Colors.light.navy,
  },
  subTopicBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.light.hairline,
    overflow: "hidden",
    marginBottom: 4,
  },
  subTopicBarFill: {
    height: 6,
    borderRadius: 3,
  },
  // ── New progress tab styles ──
  barTrack: {
    backgroundColor: Colors.light.hairline,
    overflow: "hidden",
  },
  progressDropdownHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
  },
  progressDropdownLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginRight: 12,
    gap: 10,
  },
  progressDropdownTitle: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    flexShrink: 1,
  },
  moduleDetailCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    shadowColor: Colors.light.cardShadow,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  moduleDetailTitle: {
    fontSize: 17,
    fontWeight: "800" as const,
    color: Colors.light.navy,
    letterSpacing: -0.3,
    marginBottom: 16,
  },
  moduleDetailStatRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
    gap: 8,
  },
  statBlock: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  statBlockIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  statBlockValue: {
    fontSize: 15,
    fontWeight: "800" as const,
    color: Colors.light.navy,
  },
  statBlockLabel: {
    fontSize: 11,
    fontWeight: "600" as const,
    color: Colors.light.warmGreyDark,
  },
  moduleCompletionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  moduleCompletionLabel: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: Colors.light.navy,
  },
  subTopicsSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.light.hairline,
  },
  subTopicsSectionTitle: {
    fontSize: 14,
    fontWeight: "800" as const,
    color: Colors.light.navy,
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  subTopicsHint: {
    fontSize: 12,
    lineHeight: 17,
    color: "#8E8E93",
    marginBottom: 12,
    marginLeft: 2,
  },
  // ── Floating tutor FAB ──
  fabContainer: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 0,
    paddingTop: 40,
  },
  fabButton: {
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
  fabText: {
    fontSize: 14,
    fontWeight: "700" as const,
    letterSpacing: 1.5,
    color: "#FFFFFF",
  },
  fabIconWrap: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  // ── Tutor insight card styles ──
  insightCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    shadowColor: Colors.light.cardShadow,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  insightHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  insightIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F59E0B",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  insightTitleWrap: {
    flex: 1,
  },
  insightTitle: {
    fontSize: 14,
    fontWeight: "800" as const,
    color: Colors.light.navy,
    letterSpacing: -0.2,
  },
  insightStatus: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: Colors.light.warmGreyDark,
    marginTop: 2,
  },
  insightAction: {
    backgroundColor: `${Colors.light.purple}0D`,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  insightActionText: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    lineHeight: 20,
  },
  insightActionMeta: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: Colors.light.purple,
    marginTop: 6,
  },
  insightGaps: {
    paddingTop: 4,
  },
  insightSectionLabel: {
    fontSize: 12,
    fontWeight: "800" as const,
    color: Colors.light.navy,
    marginBottom: 6,
    letterSpacing: 0.2,
    textTransform: "uppercase" as const,
  },
  insightBullet: {
    fontSize: 13,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
    lineHeight: 18,
    marginBottom: 2,
  },
});
