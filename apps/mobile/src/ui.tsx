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
import { colors, display, font, type, mediaAccent } from "./theme";
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
      <Appbar.Header style={styles.appbar} mode="center-aligned">
        <Appbar.Content
          title={title}
          titleStyle={[type.title, styles.appbarTitle]}
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
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 18 }}>
          <Text style={[display, { fontSize: wide ? 28 : 19, textAlign: "center" }]}>
            {title.title}
          </Text>
          <Text style={[styles.metadata, { textAlign: "center" }]}>
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
  context,
  title,
}: {
  context?: string;
  title: string;
}) {
  return (
    <View style={styles.heading}>
      <Text style={[display, styles.headingTitle]}>{title}</Text>
      {context ? <Text style={styles.headingContext}>{context}</Text> : null}
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
  const aperture = useSharedValue(animate ? 1.055 : 1);
  useEffect(() => {
    cancelAnimation(aperture);
    aperture.set(animate ? 1.055 : 1);
    if (animate) {
      aperture.set(
        withTiming(1, { duration: 720, easing: EASE_OUT }),
      );
    }
    return () => cancelAnimation(aperture);
  }, [animate, aperture]);
  const apertureStyle = useAnimatedStyle(() => ({
    transform: [{ scale: aperture.get() }],
  }));
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
          <Animated.View style={[StyleSheet.absoluteFill, apertureStyle]}>
            {title ? (
              <Art title={title} wide height={210} borderRadius={0} />
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
          </Animated.View>
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
            <Text style={styles.heroOverline}>LUDEX · PERSONAL ARCHIVE</Text>
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle} adjustsFontSizeToFit minimumFontScale={0.74}>
              {name}
            </Text>
            {title ? (
              <Text variant="titleMedium" style={{ color: accent, marginTop: 10 }}>
                Featured · {title.title}
              </Text>
            ) : (
              <Text variant="bodyLarge" style={styles.heroSubhead}>
                A record of what moved you.
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
      style={{ marginBottom: 18 }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 4 }}
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
  appbarTitle: { textAlign: "center", letterSpacing: 0.2 },
  content: { paddingHorizontal: 18, paddingTop: 2, paddingBottom: 20 },
  metadata: { ...type.metadata, fontSize: 12, color: colors.muted, lineHeight: 19 },
  heading: { alignItems: "center", marginBottom: 20 },
  headingTitle: { textAlign: "center", fontSize: 31, lineHeight: 37, letterSpacing: -0.8 },
  headingContext: { ...type.metadata, textAlign: "center", color: colors.muted, marginTop: 7, fontSize: 13 },
  heroFrame: {
    height: 204,
    marginHorizontal: -18,
    marginTop: -2,
    marginBottom: 20,
    overflow: "hidden",
    borderTopLeftRadius: 58,
    borderTopRightRadius: 58,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderColor: colors.outline,
  },
  heroTopline: {
    position: "absolute",
    top: 16,
    left: 18,
    right: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  heroMark: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.coral,
  },
  heroOverline: {
    color: colors.pearl,
    ...font.semibold,
    fontSize: 9,
    letterSpacing: 1.6,
  },
  heroCopy: { position: "absolute", left: 16, right: 16, bottom: 14, alignItems: "center" },
  heroTitle: {
    ...display,
    textAlign: "center",
    fontSize: 31,
    letterSpacing: -0.8,
    lineHeight: 36,
  },
  heroSubhead: { ...type.body, color: colors.pearl, marginTop: 5, fontSize: 13 },
  coverTitle: { ...type.title, marginTop: 9, marginBottom: 2 },
  landscapeTitle: { ...type.title, marginTop: 9 },
  mediaBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  mediaBadgeLabel: {
    color: colors.ink,
    ...font.bold,
    fontSize: 9,
    letterSpacing: 1.1,
  },
  audienceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
  },
  audienceDot: { width: 5, height: 5, borderRadius: 3 },
  audienceLabel: { ...font.semibold, fontSize: 9, letterSpacing: 0.5 },
  empty: {
    alignItems: "center",
    padding: 20,
    marginTop: 2,
    marginBottom: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.outline,
    backgroundColor: colors.surface,
  },
  emptyTitle: { fontSize: 25, lineHeight: 31, marginBottom: 10, textAlign: "center" },
  emptyText: { ...type.body, color: colors.muted, lineHeight: 22, textAlign: "center" },
  emptyButton: {
    alignSelf: "center",
    marginTop: 20,
    backgroundColor: colors.coral,
  },
  logButton: {
    position: "absolute",
    bottom: 18,
    right: 20,
    backgroundColor: colors.coral,
    borderRadius: 10,
    elevation: 8,
  },
  filterChip: {
    marginRight: 8,
    minHeight: 40,
    borderRadius: 7,
    borderColor: colors.outline,
  },
  selectedFilterChip: { backgroundColor: colors.coral, borderColor: colors.coral },
  idleFilterChip: { backgroundColor: colors.surface },
  filterLabel: { ...font.semibold, letterSpacing: 0 },
  input: { marginBottom: 12, backgroundColor: colors.surface },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  section: { marginVertical: 22 },
  divider: { height: 1, backgroundColor: colors.outline, marginVertical: 18 },
});
