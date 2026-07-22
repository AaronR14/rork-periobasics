import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import {
  ChevronLeft,
  Clock,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { usePostHog } from "posthog-react-native";

import ScreenFade from "@/components/ScreenFade";
import Colors from "@/constants/colors";
import { useAuth } from "@/hooks/useAuth";
import { trackVideoView } from "@/hooks/useProgress";
import { functionsUrl } from "@/lib/config";
import { AnalyticsEvent } from "@/lib/posthog";
import { getValidAccessToken, isUnauthorized, SESSION_EXPIRED_MESSAGE } from "@/lib/supabase";

// react-native-webview is native-only (iOS/Android). On web — which is what
// the Rork preview uses — it throws "does not support this platform".
// So we render a plain <iframe> on web, and the real WebView on native.
const NativeWebView: typeof import("react-native-webview").WebView | undefined =
  Platform.OS !== "web"
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("react-native-webview").WebView
    : undefined;

/**
 * Renders the Bunny embed player. Native uses WebView, web uses an iframe.
 *
 * Known react-native-webview issue: when a video exits fullscreen on iOS,
 * the native WKWebView doesn't always re-fit its frame to the container.
 * We detect the fullscreen-exit event from inside the page and post a
 * message back to RN, which then forces a re-layout by briefly toggling
 * the WebView's dimensions (a 0-height flash forces CoreAnimation to
 * re-measure). This restores the player container to its original shape.
 */
function BunnyPlayer({
  embedUrl,
  remountKey,
  onFullscreenExit,
  onVideoComplete,
}: {
  embedUrl: string;
  remountKey: number;
  onFullscreenExit: () => void;
  onVideoComplete: () => void;
}) {
  const [loading, setLoading] = useState<boolean>(true);

  // When the WebView is remounted (key change), show the loading spinner
  // immediately — onLoadStart fires slightly after the new instance mounts.
  useEffect(() => {
    setLoading(true);
  }, [remountKey]);

  // JS injected into the page that watches for video fullscreen enter/exit
  // AND device orientation changes, then notifies RN via postMessage.
  // iOS uses `webkitpresentationmodechange` on the <video> element; the
  // standard `fullscreenchange` covers web/Android. `orientationchange` /
  // `resize` catch the Bunny player's own rotation handling, which can swap
  // the player to landscape fullscreen without firing the fullscreen events.
  const fullscreenWatcher = `
    (function () {
      function notify(type, state) {
        try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, state: state })); } catch (e) {}
      }
      function fsState() {
        return (document.fullscreenElement || document.webkitFullscreenElement) ? 'enter' : 'exit';
      }
      function presState() {
        var videos = document.getElementsByTagName('video');
        for (var i = 0; i < videos.length; i++) {
          var v = videos[i];
          if (v.webkitSupportsPresentationMode && v.webkitPresentationMode === 'fullscreen') return 'enter';
        }
        return 'exit';
      }
      // Auto-resume the video after exiting fullscreen — iOS Safari pauses
      // the <video> element when it leaves fullscreen presentation mode.
      function resumeVideo() {
        var vs = document.getElementsByTagName('video');
        if (vs.length > 0 && vs[0].paused) {
          vs[0].play().catch(function () {});
        }
      }
      document.addEventListener('fullscreenchange', function () {
        var state = fsState();
        notify('fullscreen', state);
        if (state === 'exit') setTimeout(resumeVideo, 200);
      });
      document.addEventListener('webkitfullscreenchange', function () {
        var state = fsState();
        notify('fullscreen', state);
        if (state === 'exit') setTimeout(resumeVideo, 200);
      });
      document.addEventListener('webkitpresentationmodechange', function (e) {
        var v = e && e.target;
        var mode = v && v.webkitSupportsPresentationMode && v.webkitPresentationMode;
        var state = mode === 'fullscreen' ? 'enter' : 'exit';
        notify('fullscreen', state);
        if (state === 'exit') setTimeout(resumeVideo, 200);
      }, true);
      // Orientation/resize: report the new orientation so RN can re-fit the
      // container. The Bunny player rotates internally and doesn't always emit
      // a fullscreen event, so this is the reliable signal on rotation.
      function reportOrientation() {
        var orient = (window.orientation === 90 || window.orientation === -90 || (window.matchMedia && window.matchMedia('(orientation: landscape)').matches)) ? 'landscape' : 'portrait';
        notify('orientation', orient);
      }
      window.addEventListener('orientationchange', reportOrientation);
      window.addEventListener('resize', reportOrientation);
      reportOrientation();

      // --- Video completion watcher ---
      // The Bunny player creates the <video> element after page load, so we
      // poll with a MutationObserver until it appears, then listen for 'ended'
      // and 'timeupdate'. We fire 'video_complete' once when the video reaches
      // its natural end OR when playback reaches 95% (covers scrubbing near
      // the end where 'ended' may not fire reliably).
      function findVideo() {
        var vs = document.getElementsByTagName('video');
        return vs.length > 0 ? vs[0] : null;
      }
      function attachVid(v) {
        if (v.__rnCompleteAttached) return;
        v.__rnCompleteAttached = true;
        var fired = false;
        function completeNotify() {
          if (fired) return;
          fired = true;
          try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'video_complete' })); } catch (e) {}
        }
        v.addEventListener('ended', completeNotify);
        v.addEventListener('timeupdate', function () {
          var d = v.duration || 0;
          var c = v.currentTime || 0;
          if (d > 0 && (c / d) >= 0.95) completeNotify();
        });
      }
      var vid = findVideo();
      if (vid) { attachVid(vid); }
      else {
        var vidObs = new MutationObserver(function () {
          var found = findVideo();
          if (found) { attachVid(found); vidObs.disconnect(); }
        });
        vidObs.observe(document.body, { childList: true, subtree: true });
        setTimeout(function () {
          var f = findVideo();
          if (f) attachVid(f);
          vidObs.disconnect();
        }, 8000);
      }
    })();
  `;

  const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (!msg) return;
      // Fullscreen exit: resume the video and let the parent decide whether
      // a remount is needed (only if still in landscape). No collapse-flash —
      // shrinking the WebView to 1x1 pauses the <video> element.
      if (msg.type === 'fullscreen' && msg.state === 'exit') {
        onFullscreenExit();
        return;
      }
      // Orientation returned to portrait: the container is always portrait-
      // sized (portraitWidth-based), so the WebView fills it correctly.
      // No action needed — no collapse-flash that would pause the video.
      // Video reached its end — notify the parent so it can record the view.
      if (msg.type === 'video_complete') {
        onVideoComplete();
      }
    } catch {
      // Ignore malformed messages.
    }
  }, []);

  if (Platform.OS === "web") {
    return (
      <iframe
        src={embedUrl}
        title="Bunny player"
        allow="fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope"
        allowFullScreen
        scrolling="no"
        style={{
          width: "100%",
          height: "100%",
          border: 0,
          display: "block",
        }}
      />
    );
  }
  const WebView = NativeWebView!;
  return (
    <>
      <WebView
        key={remountKey}
        source={{ uri: embedUrl }}
        style={StyleSheet.absoluteFill}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction
        allowsFullscreenVideo
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        bounces={false}
        originWhitelist={["*"]}
        injectedJavaScript={fullscreenWatcher}
        onMessage={handleMessage}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
      />
      {loading && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={Colors.light.purple} />
        </View>
      )}
    </>
  );
}

// Bunny Stream library. Individual videos are addressed by their GUID,
// passed in via the `videoId` route param from the library page.
const BUNNY_LIBRARY_ID = "697694";
const DEFAULT_VIDEO_ID = "5bce5273-abe3-48f3-8289-a5380442c68c";

function buildEmbedUrl(videoId: string, autoplay = false): string {
  // autoplay=false → the video stays paused until the user taps play.
  // preload=false → the player does not pre-buffer segments until playback starts.
  return `https://player.mediadelivery.net/embed/${BUNNY_LIBRARY_ID}/${videoId}?autoplay=${autoplay}&preload=false`;
}

interface VideoMeta {
  title?: string;
  description?: string;
  durationLabel?: string;
  instructor?: string;
  level?: string;
  module?: string;
  category?: string;
  thumbnailUrl?: string;
}

interface VideoListItem {
  guid: string;
  title: string;
  durationLabel: string;
  durationSeconds: number;
  thumbnailUrl?: string;
  module?: string;
  category?: string;
  description?: string;
  instructor?: string;
  level?: string;
}

const FALLBACK_META: VideoMeta = {
  title: "Técnicas de Cirugía Periodontal",
  description:
    "Domina los procedimientos quirúrgicos avanzados para el tratamiento del tejido periodontal, con demostraciones paso a paso guiadas por especialistas certificados.",
  durationLabel: "48 min",
  instructor: "Dr. Aaron Romero",
  level: "Avanzado",
  module: "MÓDULO 1 · EL PERIODONTO SANO",
  thumbnailUrl: undefined,
};

export default function LessonScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const { user } = useAuth();
  const posthog = usePostHog();
  // Route params: videoId (Bunny GUID) and optional pre-fetched metadata
  // passed from the library page so the player shows info instantly.
  const params = useLocalSearchParams<{
    videoId?: string;
    title?: string;
    description?: string;
    durationLabel?: string;
    instructor?: string;
    level?: string;
    module?: string;
  }>();
  const videoId = params.videoId || DEFAULT_VIDEO_ID;
  // Bunny player is shown by default — no play-button overlay.
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [metaSessionExpired, setMetaSessionExpired] = useState<boolean>(false);
  const embedUrl = buildEmbedUrl(videoId, isPlaying);

  // When the app is opened without a selected video (i.e. cold launch),
  // redirect to the library so it acts as the home/landing page. Using the
  // declarative <Redirect> avoids the "navigate before mounting Root Layout"
  // runtime error that imperative router.replace can trigger on web during the
  // first render pass.
  if (!params.videoId) {
    return <Redirect href="/library" />;
  }
  // 16:9 aspect ratio for the embedded player, full card width.
  // Always base the player height on the portrait (short) edge so the
  // inline container doesn't overflow when the device is in landscape.
  const portraitWidth = Math.min(width, height);
  const playerHeight = Math.round(((portraitWidth - 40) * 9) / 16);

  // Seed with route-param metadata (if any) so the info appears instantly;
  // the worker fetch refreshes/overrides afterwards.
  const [activeTab, setActiveTab] = useState<"description" | "annexes">("description");
  const [moduleVideos, setModuleVideos] = useState<VideoListItem[]>([]);
  const [meta, setMeta] = useState<VideoMeta>({
    title: params.title || FALLBACK_META.title,
    description: params.description || FALLBACK_META.description,
    durationLabel: params.durationLabel || FALLBACK_META.durationLabel,
    instructor: params.instructor || FALLBACK_META.instructor,
    level: params.level || FALLBACK_META.level,
    module: params.module || FALLBACK_META.module,
    thumbnailUrl: undefined,
  });
  // Bumped only when a fullscreen exit happens while still in landscape —
  // the one case where the collapse-flash alone can't re-fit the WKWebView.
  // In portrait, the collapse-flash handles it without destroying the player.
  const [orientationKey, setOrientationKey] = useState<number>(0);

  // Called from the BunnyPlayer when the WebView reports a fullscreen *exit*.
  // Only remounts if the device is still in landscape; in portrait the
  // collapse-flash is sufficient and a remount would needlessly reload the
  // video from the beginning.
  const handleFullscreenExit = useCallback(() => {
    if (isLandscape) {
      setOrientationKey((k) => k + 1);
    }
  }, [isLandscape]);

  const buttonScale = useRef(new Animated.Value(1)).current;
  // CTA starts collapsed (circular FAB, bottom-right) and expands to the pill.
  const ctaExpand = useRef(new Animated.Value(0)).current;
  const backScale = useRef(new Animated.Value(1)).current;
  const closeScale = useRef(new Animated.Value(1)).current;

  // Expand the CTA from the collapsed circular FAB to the full pill shortly
  // after the video page mounts (mirrors the library FAB, in reverse).
  React.useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(ctaExpand, {
        toValue: 1,
        duration: 700,
        easing: Easing.bezier(0.4, 0.0, 0.2, 1),
        useNativeDriver: false,
      }).start();
    }, 600);
    return () => clearTimeout(timer);
  }, [ctaExpand]);

  const pressIn = useCallback((v: Animated.Value) => {
    Animated.timing(v, {
      toValue: 0.96,
      duration: 90,
      useNativeDriver: true,
    }).start();
  }, []);

  const pressOut = useCallback((v: Animated.Value) => {
    Animated.timing(v, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, []);

  const handleConsult = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    router.push("/chat");
  }, []);

  const handleBackToLibrary = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.replace("/library");
  }, []);

  const handleClose = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.replace("/library");
  }, []);

  // Track video view in Supabase ONLY when the user actually finishes watching
  // (the video fires its 'ended' event or playback reaches 95%). This prevents
  // simply opening a video from counting as "watched".
  const completedRef = useRef<boolean>(false);
  useEffect(() => {
    // Reset completion flag when switching to a different video.
    completedRef.current = false;
  }, [videoId]);
  const handleVideoComplete = useCallback(() => {
    if (completedRef.current || !user || !params.videoId) return;
    completedRef.current = true;
    trackVideoView({
      userId: user.id,
      videoGuid: params.videoId,
      videoTitle: params.title,
      moduleName: params.module,
    });
    // Usage event: which video, which module — not tied to any answer content.
    posthog.capture(AnalyticsEvent.VideoCompleted, {
      video_guid: params.videoId,
      module: params.module ?? null,
    });
  }, [user, params.videoId, params.title, params.module, posthog]);

  // Fetch real metadata from Bunny Stream via the worker (keeps the access
  // key private). Falls back to hardcoded values if the request fails.
  useEffect(() => {
    const url = `${functionsUrl}/video?libraryId=${BUNNY_LIBRARY_ID}&videoId=${encodeURIComponent(videoId)}`;
    let cancelled = false;
    setMetaSessionExpired(false);
    getValidAccessToken()
      .then((token) => fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }))
      .then((r) => {
        if (r.ok) return r.json();
        if (isUnauthorized(r) && !cancelled) setMetaSessionExpired(true);
        return Promise.reject(new Error(`status ${r.status}`));
      })
      .then((data: VideoMeta) => {
        if (cancelled) return;
        const proxiedThumb = data.thumbnailUrl
          ? `${functionsUrl}/thumb?url=${encodeURIComponent(data.thumbnailUrl)}`
          : undefined;
        setMeta({
          title: data.title || FALLBACK_META.title,
          description: data.description || FALLBACK_META.description,
          durationLabel: data.durationLabel || FALLBACK_META.durationLabel,
          instructor: data.instructor || FALLBACK_META.instructor,
          level: data.level || FALLBACK_META.level,
          module: data.module || data.category || FALLBACK_META.module,
          thumbnailUrl: proxiedThumb || FALLBACK_META.thumbnailUrl,
        });
      })
      .catch(() => {
        // Silent — keep fallback values.
      });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  // Next three videos in the same module as the current one, sorted by title
  // (matching the library ordering). Falls back to the first three if the
  // current video isn't found in the module list.
  const nextInModule = useMemo<VideoListItem[]>(() => {
    const sorted = [...moduleVideos].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }),
    );
    const currentIdx = sorted.findIndex((v) => v.guid === videoId);
    const start = currentIdx >= 0 ? currentIdx + 1 : 0;
    return sorted.slice(start, start + 3);
  }, [moduleVideos, videoId]);

  const handleOpenModuleVideo = useCallback((v: VideoListItem) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.replace({
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

  // Fetch the full video list so we can show the next three videos in the
  // same module as the current one. We only keep the ones matching the
  // current video's module (falling back to all videos if no module tag).
  useEffect(() => {
    const url = `${functionsUrl}/videos?libraryId=${BUNNY_LIBRARY_ID}`;
    let cancelled = false;
    getValidAccessToken()
      .then((token) => fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((data: { items?: VideoListItem[] }) => {
        if (cancelled) return;
        const items = Array.isArray(data.items) ? data.items : [];
        const moduleName = meta.module ?? "";
        // Match videos belonging to the same module. Bunny videos often lack a
        // module tag, so — like the library page — we treat untagged videos as
        // a single group. If the module name matches no video's tag, fall back
        // to all videos so the "En este módulo" section still has content.
        const tagged = items.filter(
          (v) => (v.module ?? v.category ?? "") === moduleName,
        );
        const untagged = items.filter(
          (v) => !v.module && !v.category,
        );
        let filtered: VideoListItem[];
        if (tagged.length > 0) {
          filtered = tagged;
        } else if (untagged.length > 0) {
          // No tagged videos match; use the untagged pool (library's "Módulo 1" group).
          filtered = untagged;
        } else {
          filtered = items;
        }
        setModuleVideos(filtered);
      })
      .catch(() => {
        // Silent — the next-videos section just won't render.
      });
    return () => {
      cancelled = true;
    };
  }, [meta.module]);

  const currentVideoHeight = playerHeight;

  return (
    <ScreenFade style={styles.root} trigger={videoId}>
      <StatusBar style="dark" />

      {/* App header — back arrow (left) + close (right). */}
      {(
        <View
          style={[
            styles.header,
            { paddingTop: insets.top + 8 },
          ]}
        >
          <Animated.View style={{ transform: [{ scale: backScale }] }}>
            <Pressable
              onPress={handleBackToLibrary}
              onPressIn={() => pressIn(backScale)}
              onPressOut={() => pressOut(backScale)}
              style={styles.headerButton}
              hitSlop={12}
              testID="back-to-library-button"
            >
              <ChevronLeft size={24} color={Colors.light.navy} strokeWidth={2.4} />
            </Pressable>
          </Animated.View>
          <Animated.View style={{ transform: [{ scale: closeScale }] }}>
            <Pressable
              onPress={handleClose}
              onPressIn={() => pressIn(closeScale)}
              onPressOut={() => pressOut(closeScale)}
              style={styles.headerButton}
              hitSlop={12}
              testID="close-video-button"
            >
              <X size={22} color={Colors.light.navy} strokeWidth={2.4} />
            </Pressable>
          </Animated.View>
        </View>
      )}

      {/* Video stage — always mounted so the WebView (and Bunny player)
          keeps running across modes. Only its container size changes. */}
      <View style={styles.videoStage}>
        <View style={[styles.playerShadow, { height: currentVideoHeight }]}>
          <View style={styles.player} testID="video-player">
            <BunnyPlayer
              embedUrl={embedUrl}
              remountKey={orientationKey}
              onFullscreenExit={handleFullscreenExit}
              onVideoComplete={handleVideoComplete}
            />

            <LinearGradient
              colors={["rgba(15,23,42,0.06)", "rgba(15,23,42,0.00)", "rgba(15,23,42,0.28)"]}
              locations={[0, 0.55, 1]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          </View>
        </View>
      </View>

      {/* --- Below the video: lesson info --- */}
      {(
        <>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingTop: 24,
              paddingBottom: insets.bottom + 120,
            }}
            showsVerticalScrollIndicator={false}
          >
            {/* Lesson info */}
            <View style={styles.info}>
              <Text style={styles.eyebrow}>{meta.module}</Text>
              <Text style={styles.title}>{meta.title}</Text>
              {metaSessionExpired && (
                <Text style={styles.sessionExpiredText}>{SESSION_EXPIRED_MESSAGE}</Text>
              )}

              <View style={styles.metaRow}>
                <Clock size={16} color={Colors.light.warmGreyDark} strokeWidth={2} />
                <Text style={styles.metaText}>{meta.durationLabel}</Text>
                <View style={styles.metaDot} />
                <Text style={styles.metaText}>{meta.instructor}</Text>
              </View>

              <View style={styles.tabRow}>
                <Pressable
                  onPress={() => setActiveTab("description")}
                  style={styles.tab}
                >
                  <Text
                    style={[
                      styles.tabText,
                      activeTab === "description" && styles.tabTextActive,
                    ]}
                  >
                    Descripción
                  </Text>
                  {activeTab === "description" && <View style={styles.tabUnderline} />}
                </Pressable>
                <Pressable
                  onPress={() => setActiveTab("annexes")}
                  style={styles.tab}
                >
                  <Text
                    style={[
                      styles.tabText,
                      activeTab === "annexes" && styles.tabTextActive,
                    ]}
                  >
                    Anexos
                  </Text>
                  {activeTab === "annexes" && <View style={styles.tabUnderline} />}
                </Pressable>
              </View>

              {activeTab === "description" && (
                <>
                  <Text style={styles.description}>{meta.description}</Text>

                  {nextInModule.length > 0 && (
                    <View style={styles.upNextSection}>
                      <Text style={styles.upNextTitle}>En este módulo</Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.upNextScroll}
                      >
                        {nextInModule.map((v: VideoListItem) => (
                          <Pressable
                            key={v.guid}
                            onPress={() => handleOpenModuleVideo(v)}
                            style={styles.upNextCard}
                          >
                            <View style={styles.upNextThumb}>
                              {v.thumbnailUrl ? (
                                <Image
                                  source={{ uri: v.thumbnailUrl }}
                                  style={StyleSheet.absoluteFill as object}
                                  resizeMode="cover"
                                />
                              ) : (
                                <View style={styles.upNextThumbPlaceholder} />
                              )}
                            </View>
                            <Text style={styles.upNextCardTitle} numberOfLines={2}>
                              {v.title}
                            </Text>
                            <View style={styles.upNextCardMeta}>
                              <Clock size={11} color={Colors.light.warmGreyDark} strokeWidth={2.2} />
                              <Text style={styles.upNextCardDuration}>{v.durationLabel}</Text>
                            </View>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </>
              )}
              {activeTab === "annexes" && (
                <Text style={styles.description}>
                  No hay anexos disponibles para este video.
                </Text>
              )}
            </View>
          </ScrollView>

          {/* Floating CTA */}
          <View
            style={[styles.ctaContainer, { paddingBottom: insets.bottom + 24 }]}
            pointerEvents="box-none"
          >
            <LinearGradient
              colors={["rgba(248,250,252,0)", "rgba(248,250,252,0.9)", "#F8FAFC"]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <Animated.View
              style={{
                width: ctaExpand.interpolate({
                  inputRange: [0, 1],
                  outputRange: [56, portraitWidth - 40],
                }),
                marginLeft: ctaExpand.interpolate({
                  inputRange: [0, 1],
                  outputRange: [portraitWidth - 40 - 56, 0],
                }),
              }}
            >
              <Animated.View
                style={{ transform: [{ scale: buttonScale }] }}
              >
                <Pressable
                  onPress={handleConsult}
                  onPressIn={() => pressIn(buttonScale)}
                  onPressOut={() => pressOut(buttonScale)}
                  style={styles.ctaButton}
                  testID="consult-tutor-button"
                >
                  <Animated.View
                    style={{
                      opacity: ctaExpand.interpolate({
                        inputRange: [0, 0.5, 1],
                        outputRange: [0, 0, 1],
                      }),
                    }}
                  >
                    <Text style={styles.ctaText}>CONSULTA A TU TUTOR</Text>
                  </Animated.View>
                  <Animated.View
                    style={[
                      styles.ctaIconWrap,
                      {
                        opacity: ctaExpand.interpolate({
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
        </>
      )}
    </ScreenFade>
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
  headerButton: {
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
  videoStage: {
    paddingHorizontal: 20,
  },
  scroll: {
    flex: 1,
  },
  playerShadow: {
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    shadowColor: Colors.light.navy,
    shadowOpacity: 0.14,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 8,
  },
  player: {
    flex: 1,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#0B1220",
  },
  info: {
    paddingHorizontal: 4,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 1.5,
    color: Colors.light.purple,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  title: {
    fontSize: 26,
    lineHeight: 34,
    fontWeight: "700" as const,
    letterSpacing: -0.4,
    color: Colors.light.navy,
    marginBottom: 16,
  },
  sessionExpiredText: {
    fontSize: 13,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 24,
  },
  metaText: {
    fontSize: 13,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
    letterSpacing: 0.2,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: "#D6D3D1",
  },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
    marginBottom: 16,
  },
  tab: {
    paddingVertical: 8,
  },
  tabText: {
    fontSize: 15,
    fontWeight: "600" as const,
    color: Colors.light.warmGrey,
  },
  tabTextActive: {
    color: Colors.light.purple,
  },
  tabUnderline: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: Colors.light.purple,
  },
  description: {
    fontSize: 15,
    lineHeight: 26,
    fontWeight: "400" as const,
    color: Colors.light.warmGreyDark,
  },
  upNextSection: {
    marginTop: 28,
  },
  upNextTitle: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    marginBottom: 14,
    letterSpacing: 0.2,
  },
  upNextScroll: {
    paddingRight: 20,
    gap: 12,
  },
  upNextCard: {
    width: 160,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    shadowColor: Colors.light.cardShadow,
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  upNextThumb: {
    width: "100%",
    height: 88,
    borderRadius: 12,
    backgroundColor: "#E2E8F0",
    overflow: "hidden",
    marginBottom: 10,
  },
  upNextThumbPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#E2E8F0",
  },
  upNextCardTitle: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: "700" as const,
    color: Colors.light.navy,
    marginBottom: 6,
  },
  upNextCardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  upNextCardDuration: {
    fontSize: 11,
    fontWeight: "500" as const,
    color: Colors.light.warmGreyDark,
  },
  ctaContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  ctaButton: {
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
  ctaText: {
    fontSize: 14,
    fontWeight: "700" as const,
    letterSpacing: 1.5,
    color: "#FFFFFF",
  },
  ctaIconWrap: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0B1220",
    alignItems: "center",
    justifyContent: "center",
  },
});
