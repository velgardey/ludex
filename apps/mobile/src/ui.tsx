import React, { createContext, useContext, useEffect, useRef } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import type {
  GestureResponderEvent,
  PressableProps,
  StyleProp,
  ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Appbar, Button, FAB, Text, Chip } from "react-native-paper";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  FadeInDown,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import type { CatalogHit } from "@ludex/domain";
import { colors, display, mediaAccent } from "./theme";
import { useLudex } from "./state";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const HERO_ENTRANCE = FadeInDown.duration(270).easing(EASE_OUT);
const PRESS_IN_SCALE = 0.975;
const PRESS_DURATION = 120;

type PageMotion = {
  scrollY: SharedValue<number>;
  enabled: boolean;
};

const PageMotionContext = createContext<PageMotion | null>(null);
type MotionPressableProps = Omit<PressableProps, "style" | "children"> & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function MotionPressable({
  children,
  disabled,
  onPressIn,
  onPressOut,
  style,
  ...props
}: MotionPressableProps) {
  const { reducedMotion } = useLudex();
  const scale = useSharedValue(1);
  const motionEnabled = !reducedMotion;
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(scale);
      scale.set(1);
    }
  }, [reducedMotion, scale]);

  const handlePressIn = (event: GestureResponderEvent) => {
    if (motionEnabled && !disabled) {
      scale.set(withTiming(PRESS_IN_SCALE, { duration: PRESS_DURATION, easing: EASE_OUT }));
    }
    onPressIn?.(event);
  };
  const handlePressOut = (event: GestureResponderEvent) => {
    if (motionEnabled) {
      scale.set(withTiming(1, { duration: PRESS_DURATION, easing: EASE_OUT }));
    } else {
      scale.set(1);
    }
    onPressOut?.(event);
  };

  return (
    <Pressable
      {...props}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      hitSlop={props.hitSlop ?? 6}
      pressRetentionOffset={props.pressRetentionOffset ?? 12}
    >
      <Animated.View style={[style, pressStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

export function Page({
  title,
  children,
  refresh,
  subtitle,
}: {
  title: string;
  children: React.ReactNode;
  refresh?: () => Promise<void>;
  subtitle?: string;
}) {
  const { store, reducedMotion } = useLudex();
  const motionEnabled = !reducedMotion;
  const [refreshing, setRefreshing] = React.useState(false);
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });

  useEffect(() => {
    store?.draft<number>("scroll:" + title).then((n) => {
      if (n) {
        offset.current = n;
        scrollY.set(n);
        scroll.current?.scrollTo({ y: n, animated: false });
      }
    });
    return () => {
      void store?.saveDraft("scroll:" + title, offset.current);
    };
  }, [title, store, scrollY]);

  const rememberOffset = (y: number) => {
    offset.current = y;
    void store?.saveDraft("scroll:" + title, y);
  };

  return (
    <View style={styles.page}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.Content
          title={title}
          titleStyle={{ fontFamily: "Fraunces", fontWeight: "800" }}
        />
        <Appbar.Action
          icon="creation-outline"
          accessibilityLabel="Open companion"
          onPress={() => router.push("/companion")}
        />
        <Appbar.Action
          icon="cog-outline"
          accessibilityLabel="Settings"
          onPress={() => router.push("/settings")}
        />
      </Appbar.Header>
      <Animated.ScrollView
        ref={scroll}
        onScroll={onScroll}
        onScrollEndDrag={(event) =>
          rememberOffset(event.nativeEvent.contentOffset.y)
        }
        onMomentumScrollEnd={(event) =>
          rememberOffset(event.nativeEvent.contentOffset.y)
        }
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        refreshControl={
          refresh ? (
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.coral}
              onRefresh={() => {
                setRefreshing(true);
                refresh().finally(() => setRefreshing(false));
              }}
            />
          ) : undefined
        }
      >
        <PageMotionContext.Provider value={{ scrollY, enabled: motionEnabled }}>
          {subtitle ? <Text style={styles.metadata}>{subtitle}</Text> : null}
          {children}
          <View style={{ height: 92 }} />
        </PageMotionContext.Provider>
      </Animated.ScrollView>
    </View>
  );
}

export function Art({
  title,
  wide = false,
  height,
  borderRadius = 18,
}: {
  title: CatalogHit;
  wide?: boolean;
  height?: number;
  borderRadius?: number;
}) {
  const { settings } = useLudex();
  const [failed, setFailed] = React.useState(false);
  const uri = wide ? (title.backdrop ?? title.artwork) : title.artwork;
  const size = height
    ? { height }
    : wide
      ? { aspectRatio: 16 / 9 }
      : { aspectRatio: 2 / 3 };
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          overflow: "hidden",
          borderRadius,
          borderWidth: 1,
          borderColor: colors.outline,
        },
        size,
      ]}
    >
      {uri && !failed && !settings.lowData ? (
        <Image
          source={{ uri }}
          contentFit="cover"
          style={StyleSheet.absoluteFill}
          onError={() => setFailed(true)}
          accessibilityLabel={`${title.title} artwork`}
        />
      ) : (
        <View style={{ flex: 1, justifyContent: "center", padding: 18 }}>
          <Text style={[display, { fontSize: wide ? 28 : 19, fontWeight: "800" }]}>
            {title.title}
          </Text>
          <Text style={styles.metadata}>
            {title.media.toUpperCase()} · {title.year ?? "Edition unknown"}
          </Text>
        </View>
      )}
    </View>
  );
}

export function Cover({
  title,
  width = 112,
}: {
  title: CatalogHit;
  width?: number;
}) {
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${title.title}`}
      onPress={() =>
        router.push({ pathname: "/title", params: { id: title.id } })
      }
      style={{ width, marginRight: 14 }}
    >
      <Art title={title} />
      <Text variant="titleSmall" numberOfLines={2} style={styles.coverTitle}>
        {title.title}
      </Text>
      <Text style={styles.metadata}>
        {title.year} · {title.media}
      </Text>
    </MotionPressable>
  );
}

export function Heading({
  eyebrow,
  title,
}: {
  eyebrow?: string;
  title: string;
}) {
  return (
    <View style={styles.heading}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={[display, styles.headingTitle]}>{title}</Text>
    </View>
  );
}

export function CinematicHeader({
  name,
  title,
  accent = colors.coral,
}: {
  name: string;
  title?: CatalogHit;
  accent?: string;
}) {
  const { settings } = useLudex();
  const motion = useContext(PageMotionContext);
  const animate = motion?.enabled ?? false;
  const sceneStyle = useAnimatedStyle(() => {
    if (!motion?.enabled) return {};
    const scrollY = motion.scrollY.get();
    return {
      opacity: interpolate(scrollY, [0, 200, 360], [1, 0.96, 0.82], Extrapolation.CLAMP),
      transform: [
        {
          translateY: interpolate(scrollY, [0, 240], [0, -16], Extrapolation.CLAMP),
        },
      ],
    };
  });

  return (
    <View style={styles.heroFrame}>
      <Animated.View
        entering={animate ? HERO_ENTRANCE : undefined}
        style={StyleSheet.absoluteFill}
      >
        <Animated.View style={[StyleSheet.absoluteFill, sceneStyle]}>
          {title ? (
            <Art title={title} wide height={382} borderRadius={0} />
          ) : settings.lowData ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.surface },
              ]}
            />
          ) : (
            <Image
              source={require("../assets/art/premiere.webp")}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              accessibilityLabel="Original Ludex premiere stage artwork"
            />
          )}
          <LinearGradient
            colors={[
              "rgba(22,13,32,0.04)",
              "rgba(22,13,32,0.18)",
              "rgba(22,13,32,0.96)",
            ]}
            locations={[0, 0.46, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroTopline}>
            <View style={styles.heroMark} />
            <Text style={styles.heroOverline}>A LIFE IN STORIES</Text>
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>
              {title ? "YOUR FEATURED PREMIERE" : "YOUR STORIES, IN THEIR ELEMENT"}
            </Text>
            <Text style={styles.heroTitle} adjustsFontSizeToFit minimumFontScale={0.74}>
              {name}
            </Text>
            {title ? (
              <Text variant="titleMedium" style={{ color: accent, marginTop: 10 }}>
                Featured · {title.title}
              </Text>
            ) : (
              <Text variant="bodyLarge" style={styles.heroSubhead}>
                Your stories have a home.
              </Text>
            )}
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

export function Landscape({
  title,
  width = 252,
}: {
  title: CatalogHit;
  width?: number;
}) {
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={title.title}
      onPress={() =>
        router.push({ pathname: "/title", params: { id: title.id } })
      }
      style={{ width, marginRight: 14 }}
    >
      <Art title={title} wide />
      <Text variant="titleMedium" numberOfLines={2} style={styles.landscapeTitle}>
        {title.title}
      </Text>
      <Text style={styles.metadata}>
        {title.year} · {title.media}
      </Text>
    </MotionPressable>
  );
}

export function MediaBadge({ media }: { media: string }) {
  const label = media === "movie" ? "FILM" : media === "show" ? "SERIES" : media.toUpperCase();
  const accent = mediaAccent(media);
  return (
    <View style={[styles.mediaBadge, { backgroundColor: accent }]}>
      <Text style={styles.mediaBadgeLabel}>{label}</Text>
    </View>
  );
}

export function AudienceBadge({ audience }: { audience: string }) {
  const label = audience === "followers" ? "FOLLOWERS" : audience.toUpperCase();
  const accent = audience === "public" ? colors.coral : colors.lime;
  return (
    <View style={[styles.audienceBadge, { borderColor: accent }]}>
      <View style={[styles.audienceDot, { backgroundColor: accent }]} />
      <Text style={[styles.audienceLabel, { color: accent }]}>{label}</Text>
    </View>
  );
}

export function Empty({
  title,
  text,
  action,
  label = "Find a title",
}: {
  title: string;
  text: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <View style={styles.empty}>
      <Text style={[display, styles.emptyTitle]}>{title}</Text>
      <Text variant="bodyLarge" style={styles.emptyText}>
        {text}
      </Text>
      {action ? (
        <Button
          mode="contained"
          style={styles.emptyButton}
          textColor={colors.ink}
          onPress={action}
        >
          {label}
        </Button>
      ) : null}
    </View>
  );
}

export function LogButton() {
  return (
    <FAB
      icon="plus"
      label="Log"
      accessibilityLabel="Log a film, show or game"
      style={styles.logButton}
      color={colors.ink}
      onPress={() => router.push("/log")}
    />
  );
}

export function MediaFilters({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginBottom: 24 }}
      contentContainerStyle={{ paddingRight: 20 }}
    >
      {[
        ["all", "All media"],
        ["movie", "Films"],
        ["show", "TV"],
        ["game", "Games"],
      ].map(([v, label]) => (
        <Chip
          key={v}
          selected={v === value}
          onPress={() => onChange(v)}
          style={[
            styles.filterChip,
            v === value ? styles.selectedFilterChip : styles.idleFilterChip,
          ]}
          textStyle={[
            styles.filterLabel,
            v === value ? { color: colors.ink } : { color: colors.pearl },
          ]}
          showSelectedCheck={false}
        >
          {label}
        </Chip>
      ))}
    </ScrollView>
  );
}

export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  appbar: { backgroundColor: colors.ink },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 20 },
  metadata: { fontSize: 13, color: colors.muted, lineHeight: 20 },
  eyebrow: {
    color: colors.lime,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2.1,
    marginBottom: 9,
  },
  heading: { marginBottom: 20 },
  headingTitle: { fontSize: 39, lineHeight: 43, fontWeight: "900", letterSpacing: -0.6 },
  heroFrame: {
    height: 372,
    marginHorizontal: -20,
    marginTop: -6,
    marginBottom: 28,
    overflow: "hidden",
    borderRadius: 24,
    backgroundColor: colors.surface,
  },
  heroTopline: {
    position: "absolute",
    top: 19,
    left: 21,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  heroMark: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.coral,
  },
  heroOverline: {
    color: colors.pearl,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2.4,
  },
  heroCopy: { position: "absolute", left: 21, right: 21, bottom: 21 },
  heroEyebrow: {
    color: colors.coral,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 8,
  },
  heroTitle: {
    ...display,
    fontSize: 49,
    fontWeight: "900",
    letterSpacing: -1.4,
    lineHeight: 53,
  },
  heroSubhead: { color: colors.pearl, marginTop: 8 },
  coverTitle: { marginTop: 10, marginBottom: 2, fontWeight: "700" },
  landscapeTitle: { marginTop: 11, fontWeight: "800" },
  mediaBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  mediaBadgeLabel: {
    color: colors.ink,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  audienceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  audienceDot: { width: 5, height: 5, borderRadius: 3 },
  audienceLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  empty: {
    padding: 22,
    marginTop: 2,
    marginBottom: 20,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.outline,
    backgroundColor: colors.surface,
  },
  emptyTitle: { fontSize: 28, lineHeight: 33, fontWeight: "900", marginBottom: 10 },
  emptyText: { color: colors.muted, lineHeight: 24 },
  emptyButton: {
    alignSelf: "flex-start",
    marginTop: 20,
    backgroundColor: colors.coral,
  },
  logButton: {
    position: "absolute",
    bottom: 18,
    right: 20,
    backgroundColor: colors.coral,
    borderRadius: 18,
    elevation: 8,
  },
  filterChip: {
    marginRight: 8,
    minHeight: 40,
    borderRadius: 13,
    borderColor: colors.outline,
  },
  selectedFilterChip: { backgroundColor: colors.coral, borderColor: colors.coral },
  idleFilterChip: { backgroundColor: colors.surface },
  filterLabel: { fontWeight: "700", letterSpacing: 0.15 },
  input: { marginBottom: 12, backgroundColor: colors.surface },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  section: { marginVertical: 22 },
  divider: { height: 1, backgroundColor: colors.outline, marginVertical: 18 },
});
