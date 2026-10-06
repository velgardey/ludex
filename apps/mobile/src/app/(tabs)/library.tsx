import React, { useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { router } from "expo-router";
import {
  Searchbar,
  Text,
  Chip,
  Button,
  SegmentedButtons,
} from "react-native-paper";
import { useLudex } from "../../state";
import {
  Page,
  Heading,
  Empty,
  LogButton,
  Art,
  styles,
  MediaFilters,
} from "../../ui";
import { colors } from "../../theme";
export default function Library() {
  const { session, library, catalog, pending, store, refresh } = useLudex();
  const [query, setQuery] = useState("");
  const [media, setMedia] = useState("all");
  const [filter, setFilter] = useState("all");
  const [density, setDensity] = useState("list");
  useEffect(() => {
    store
      ?.draft<{ filter: string; density: string }>("library-view")
      .then((d) => {
        if (d) {
          setFilter(d.filter);
          setDensity(d.density);
        }
      });
  }, [store]);
  const items = library.filter((i) => {
    const t = catalog.find((t) => t.id === i.titleId);
    return (
      t &&
      (media === "all" || t.media === media) &&
      t.title.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "all"
        ? !i.archived
        : filter === "owned"
          ? i.owned
          : filter === "archive"
            ? i.archived
            : i.state === "planned")
    );
  });
  return (
    <View style={{ flex: 1 }}>
      <Page title="Library" refresh={() => refresh()}>
        <Heading
          eyebrow="Your archive, at your pace"
          title="What you return to."
        />
        <Searchbar
          placeholder="Search your journal"
          value={query}
          onChangeText={setQuery}
          style={{ marginBottom: 18 }}
        />
        <MediaFilters value={media} onChange={setMedia} />
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 18,
          }}
        >
          {[
            ["all", "Journal"],
            ["planned", "Wishlist / backlog"],
            ["owned", "Owned"],
            ["archive", "Archive"],
          ].map(([v, label]) => (
            <Chip
              key={v}
              selected={filter === v}
              onPress={() => {
                setFilter(v);
                void store?.saveDraft("library-view", { filter: v, density });
              }}
            >
              {label}
            </Chip>
          ))}
        </View>
        <SegmentedButtons
          value={density}
          onValueChange={(v) => {
            setDensity(v);
            void store?.saveDraft("library-view", { filter, density: v });
          }}
          buttons={[
            { value: "list", label: "List", icon: "format-list-bulleted" },
            { value: "grid", label: "Covers", icon: "view-grid-outline" },
          ]}
          style={{ marginBottom: 24 }}
        />
        {pending.length ? (
          <View
            style={{
              padding: 16,
              backgroundColor: colors.surface,
              borderRadius: 12,
              marginBottom: 24,
            }}
          >
            <Text variant="titleMedium">
              {pending.length} pending journal action
              {pending.length === 1 ? "" : "s"}
            </Text>
            <Text style={styles.metadata}>
              Saved on this device. Reconnect to sync; conflicts need your
              review.
            </Text>
            <Button onPress={() => router.push("/settings")}>
              Review pending actions
            </Button>
          </View>
        ) : null}
        <View
          style={
            density === "grid"
              ? { flexDirection: "row", flexWrap: "wrap", gap: 16 }
              : undefined
          }
        >
          {items.map((i) => {
            const t = catalog.find((t) => t.id === i.titleId)!;
            const run = i.runs.at(-1);
            return (
              <Pressable
                key={i.titleId}
                accessibilityRole="button"
                onPress={() =>
                  router.push({ pathname: "/title", params: { id: t.id } })
                }
                style={
                  density === "grid"
                    ? { width: "46%", marginBottom: 24 }
                    : {
                        flexDirection: "row",
                        gap: 16,
                        paddingBottom: 20,
                        marginBottom: 20,
                        borderBottomWidth: 1,
                        borderColor: colors.outline,
                      }
                }
              >
                <View style={density === "grid" ? undefined : { width: 76 }}>
                  <Art title={t} />
                </View>
                <View style={{ flex: 1, paddingTop: 8 }}>
                  <Text variant="titleLarge">{t.title}</Text>
                  <Text style={styles.metadata}>
                    {t.year} · {t.media}
                  </Text>
                  <Text style={{ color: colors.copper, marginTop: 8 }}>
                    {i.state}
                    {i.owned ? " · owned" : ""}
                    {i.rating ? ` · ${i.rating}/10` : ""}
                  </Text>
                  {run ? (
                    <Text style={styles.metadata}>
                      {t.media === "show"
                        ? `${run.watchedEpisodeIds.length} watched · ${run.skippedEpisodeIds.length} skipped`
                        : t.media === "game"
                          ? `${run.minutes} recorded minutes${run.storyCompleted ? " · story completed" : ""}`
                          : `${i.runs.filter((r) => r.movieViewed).length} viewings`}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        {!session ? (
          <Empty
            title="A journal of your own"
            text="Sign in to keep your library and offline drafts."
            action={() => router.push("/auth")}
            label="Sign in"
          />
        ) : !items.length ? (
          <Empty
            title="Begin with one experience"
            text="Save a title to your backlog, or make a private quick log without a score or note."
            action={() => router.push("/log")}
            label="Log something"
          />
        ) : null}
      </Page>
      <LogButton />
    </View>
  );
}
