import React, { useEffect, useRef, useState } from "react";
import {
  ScrollView,
  View,
  StyleSheet,
  RefreshControl,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Appbar, Button, FAB, Text, Chip } from "react-native-paper";
import type { CatalogHit } from "@ludex/domain";
import { colors, display } from "./theme";
import { useLudex } from "./state";
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
  const [refreshing, setRefreshing] = useState(false);
  const { store } = useLudex();
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  useEffect(() => {
    store?.draft<number>("scroll:" + title).then((n) => {
      if (n) scroll.current?.scrollTo({ y: n, animated: false });
    });
    return () => {
      void store?.saveDraft("scroll:" + title, offset.current);
    };
  }, [title, store]);
  return (
    <View style={styles.page}>
      <Appbar.Header style={{ backgroundColor: colors.ink }}>
        <Appbar.Content title={title} titleStyle={{ fontFamily: "Fraunces" }} />
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
      <ScrollView
        ref={scroll}
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.y;
        }}
        onScrollEndDrag={() => {
          void store?.saveDraft("scroll:" + title, offset.current);
        }}
        onMomentumScrollEnd={() => {
          void store?.saveDraft("scroll:" + title, offset.current);
        }}
        scrollEventThrottle={100}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        refreshControl={
          refresh ? (
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.violet}
              onRefresh={() => {
                setRefreshing(true);
                refresh().finally(() => setRefreshing(false));
              }}
            />
          ) : undefined
        }
      >
        {subtitle ? <Text style={styles.metadata}>{subtitle}</Text> : null}
        {children}
        <View style={{ height: 84 }} />
      </ScrollView>
    </View>
  );
}
export function Art({
  title,
  wide = false,
  height,
}: {
  title: CatalogHit;
  wide?: boolean;
  height?: number;
}) {
  const { settings } = useLudex();
  const [failed, setFailed] = useState(false);
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
          borderRadius: 8,
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
          <Text style={[display, { fontSize: wide ? 28 : 19 }]}>
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${title.title}`}
      onPress={() =>
        router.push({ pathname: "/title", params: { id: title.id } })
      }
      style={{ width, marginRight: 12 }}
    >
      <Art title={title} />
      <Text variant="titleSmall" numberOfLines={2} style={{ marginTop: 8 }}>
        {title.title}
      </Text>
      <Text style={styles.metadata}>
        {title.year} · {title.media}
      </Text>
    </Pressable>
  );
}
export function Heading({ title }: { eyebrow?: string; title: string }) {
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={[display, { fontSize: 34, lineHeight: 42 }]}>{title}</Text>
    </View>
  );
}
export function CinematicHeader({
  name,
  title,
  accent = colors.violet,
}: {
  name: string;
  title?: CatalogHit;
  accent?: string;
}) {
  return (
    <View
      style={{
        marginHorizontal: -20,
        height: 340,
        marginBottom: 26,
        backgroundColor: colors.surface,
      }}
    >
      {title ? (
        <Art title={title} wide height={340} />
      ) : (
        <Image
          source={require("../assets/art/lounge.webp")}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          accessibilityLabel="Original Ludex cinema lounge artwork"
        />
      )}
      <LinearGradient
        colors={["transparent", "rgba(21,18,28,0.20)", "rgba(21,18,28,0.98)"]}
        locations={[0, 0.35, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={{ position: "absolute", bottom: 26, left: 24, right: 24 }}>
        <Text style={[display, { fontSize: 38, lineHeight: 45 }]}>{name}</Text>
        {title ? (
          <Text variant="titleMedium" style={{ color: accent, marginTop: 10 }}>
            Featured · {title.title}
          </Text>
        ) : (
          <Text
            variant="bodyLarge"
            style={{ color: colors.pearl, marginTop: 10 }}
          >
            Your stories have a home.
          </Text>
        )}
      </View>
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title.title}
      onPress={() =>
        router.push({ pathname: "/title", params: { id: title.id } })
      }
      style={{ width, marginRight: 14 }}
    >
      <Art title={title} wide />
      <Text variant="titleMedium" numberOfLines={2} style={{ marginTop: 10 }}>
        {title.title}
      </Text>
      <Text style={styles.metadata}>
        {title.year} · {title.media}
      </Text>
    </Pressable>
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
      <Text style={[display, { fontSize: 27, marginBottom: 8 }]}>{title}</Text>
      <Text variant="bodyLarge" style={{ color: colors.muted, lineHeight: 24 }}>
        {text}
      </Text>
      {action ? (
        <Button
          mode="outlined"
          style={{ alignSelf: "flex-start", marginTop: 20 }}
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
      style={{
        position: "absolute",
        bottom: 18,
        right: 20,
        backgroundColor: colors.violet,
      }}
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
      style={{ marginBottom: 22 }}
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
          style={{
            marginRight: 8,
            backgroundColor: v === value ? colors.surface : colors.ink,
          }}
        >
          {label}
        </Chip>
      ))}
    </ScrollView>
  );
}
export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  content: { paddingHorizontal: 20, paddingBottom: 20 },
  metadata: { fontSize: 13, color: colors.muted, lineHeight: 20 },
  eyebrow: {
    color: colors.copper,
    fontSize: 12,
    letterSpacing: 1.6,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  empty: {
    paddingVertical: 40,
    borderTopWidth: 1,
    borderColor: colors.outline,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  section: { marginVertical: 22 },
  divider: { height: 1, backgroundColor: colors.outline, marginVertical: 18 },
  input: { marginBottom: 12, backgroundColor: colors.surface },
});
