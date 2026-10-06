import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { Button, Text, Checkbox, Chip } from "react-native-paper";
import type { CatalogHit } from "@ludex/domain";
import { timerMinutes } from "../features/log/timer";
import { useLudex } from "../state";
import { Art, Heading, styles } from "../ui";
import { colors } from "../theme";
export default function Title() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    catalog,
    library,
    client,
    queue,
    setNotice,
    session,
    pending,
    store,
  } = useLudex();
  const [title, setTitle] = useState<CatalogHit | undefined>(
    catalog.find((t) => t.id === id),
  );
  const [busy, setBusy] = useState(false);
  const [timer, setTimer] = useState<number | null>(null);
  useEffect(() => {
    if (!title)
      client
        .getTitle(id)
        .then(setTitle)
        .catch((e) => setNotice(String(e)));
  }, [id]);
  useEffect(() => {
    store?.draft<number>("timer:" + id).then(setTimer);
  }, [store, id]);
  const item = library.find((i) => i.titleId === id);
  const edit = async (
    patch: Parameters<typeof client.editLibrary>[0]["patch"],
  ) => {
    if (id === "hidden") {
      setNotice("This title is concealed.");
      return;
    }
    if (!session) {
      router.push("/auth");
      return;
    }
    setBusy(true);
    try {
      await queue("library", {
        commandId: randomUUID(),
        titleId: id,
        baseVersion: item?.version ?? 0,
        patch,
      });
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!title) return <Text style={{ padding: 24 }}>Loading title…</Text>;
  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: 16, paddingBottom: 40 },
      ]}
    >
      <Art title={title} wide />
      <View style={{ marginTop: 24 }}>
        <Heading
          context={`${title.media} · ${title.year ?? "Year unknown"}`}
          title={title.title}
        />
        {title.synopsis ? (
          <Text
            variant="bodyLarge"
            style={{ lineHeight: 27, marginBottom: 20 }}
          >
            {title.synopsis}
          </Text>
        ) : null}
        {title.platform ? (
          <Text style={styles.metadata}>
            Original platform / edition: {title.platform}
          </Text>
        ) : null}
        <Text style={[styles.metadata, { marginVertical: 12 }]}>
          {title.artworkAttribution ??
            "Local catalog preview. Provider catalog credentials remain a deployment prerequisite."}
        </Text>
        <Button
          mode="contained"
          icon="plus"
          disabled={id === "hidden"}
          onPress={() => router.push({ pathname: "/log", params: { id } })}
          contentStyle={{ minHeight: 52 }}
        >
          Log{" "}
          {title.media === "show"
            ? "episode"
            : title.media === "movie"
              ? "viewing"
              : "session"}
        </Button>
        <Button
          icon="pencil-outline"
          disabled={id === "hidden"}
          onPress={() => router.push({ pathname: "/review", params: { id } })}
          style={{ marginTop: 12 }}
        >
          Write a review
        </Button>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
            marginVertical: 24,
          }}
        >
          {[
            ["planned", "Plan / backlog"],
            ["active", "Active"],
            ["paused", "Pause"],
            ["dropped", "Drop"],
          ].map(([state, label]) => (
            <Chip
              key={state}
              disabled={busy}
              selected={item?.state === state}
              onPress={() => edit({ state: state as "planned" })}
            >
              {label}
            </Chip>
          ))}
        </View>
        <Checkbox.Item
          label="Owned / in my collection"
          status={item?.owned ? "checked" : "unchecked"}
          onPress={() => edit({ owned: !item?.owned })}
        />
        <Checkbox.Item
          label="Archive this library item"
          status={item?.archived ? "checked" : "unchecked"}
          onPress={() => edit({ archived: !item?.archived })}
        />
        {title.media === "game" ? (
          <>
            <Button
              icon={timer === null ? "timer-outline" : "timer-off-outline"}
              onPress={async () => {
                if (timer === null) {
                  const start = Date.now();
                  setTimer(start);
                  await store?.saveDraft("timer:" + id, start);
                  setNotice("Timer started by you. It estimates time only.");
                } else {
                  const minutes = timerMinutes(timer);
                  await store?.removeDraft("timer:" + id);
                  setTimer(null);
                  await store?.saveDraft("log:" + id, {
                    minutes: String(minutes),
                    kind: "game-session",
                  });
                  router.push({ pathname: "/log", params: { id } });
                }
              }}
            >
              {timer === null
                ? "Start a session timer"
                : "Stop timer and review estimate"}
            </Button>
            <Text style={styles.metadata}>
              The timer is an estimate. Review the minutes before saving; it
              never marks story completion.
            </Text>
          </>
        ) : null}
        <Text style={styles.metadata}>
          Library state records your intent. It never manufactures watched
          episodes, game achievements or completion.
        </Text>
        {pending
          .filter((p) => p.payload.titleId === id)
          .map((p) => (
            <View
              key={p.commandId}
              style={{
                backgroundColor: colors.surface,
                padding: 16,
                marginTop: 16,
              }}
            >
              <Text>
                {p.status === "pending"
                  ? "Waiting to sync"
                  : p.status === "conflict"
                    ? "Conflict — review before retry"
                    : "Rejected"}
              </Text>
              <Text style={styles.metadata}>
                {p.error ?? "Durable on this device"}
              </Text>
            </View>
          ))}
      </View>
    </ScrollView>
  );
}
