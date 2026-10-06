import React, { useEffect, useRef, useState } from "react";
import { View, ScrollView } from "react-native";
import {
  Button,
  Chip,
  Checkbox,
  HelperText,
  SegmentedButtons,
  Text,
  TextInput,
} from "react-native-paper";
import { randomUUID } from "expo-crypto";
import type {
  CatalogHit,
  LibraryItem,
  ProgressCommand,
  ProgressChange,
  Audience,
} from "@ludex/domain";
import { buildLog, nextEpisodeId } from "./model";
import { styles } from "../../ui";
import { colors } from "../../theme";
export type Draft = {
  kind: ProgressChange["kind"];
  day: string;
  rating: string;
  note: string;
  liked: boolean;
  audience: "private" | "public" | "friends";
  episodeId: string;
  minutes: string;
  playedOn: string;
  emulator: string;
  milestone: string;
  hideSpoilers: boolean;
  newRun: boolean;
};
export function LogForm({
  title,
  item,
  onSave,
  draft,
  onDraft,
}: {
  title: CatalogHit;
  item?: LibraryItem;
  onSave: (c: ProgressCommand) => Promise<void>;
  draft?: Partial<Draft>;
  onDraft?: (d: Draft) => void;
}) {
  const [form, setForm] = useState<Draft>({
    kind:
      title.media === "movie"
        ? "movie-viewed"
        : title.media === "show"
          ? "episode-watched"
          : "game-session",
    day: new Date().toISOString().slice(0, 10),
    rating: "",
    note: "",
    liked: false,
    audience: "private",
    episodeId: nextEpisodeId(title, item) ?? "",
    minutes: "",
    playedOn: item?.playedOn ?? "",
    emulator: item?.emulator ?? "",
    milestone: "",
    hideSpoilers: false,
    newRun: false,
    ...draft,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  const commandId = useRef(randomUUID());
  const runId = useRef(randomUUID());
  useEffect(() => {
    onDraft?.(form);
  }, [form]);
  const update = (patch: Partial<Draft>) => {
    setForm((v) => ({ ...v, ...patch }));
    setError("");
  };
  const save = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const command = buildLog({
        ...form,
        title,
        item,
        commandId: commandId.current,
        runId: form.newRun
          ? runId.current
          : (item?.runs.at(-1)?.id ?? runId.current),
        audience: { kind: form.audience } as Audience,
      });
      await onSave(command);
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Your draft is retained.",
      );
      submitting.current = false;
    } finally {
      setBusy(false);
    }
  };
  const choices: titleChoice[] =
    title.media === "movie"
      ? [{ value: "movie-viewed", label: "Viewed" }]
      : title.media === "show"
        ? [
            { value: "episode-watched", label: "Watched" },
            { value: "episode-skipped", label: "Skipped" },
          ]
        : [
            { value: "game-session", label: "Session" },
            { value: "story-completed", label: "Story complete" },
            { value: "milestone", label: "Milestone" },
          ];
  return (
    <View>
      <Text
        variant="headlineSmall"
        style={{ fontFamily: "Fraunces", marginBottom: 8 }}
      >
        {title.title}
      </Text>
      <Text
        variant="bodyMedium"
        style={{ color: colors.muted, marginBottom: 20 }}
      >
        {title.year} · {title.media}
        {title.platform ? ` · Original: ${title.platform}` : ""}
      </Text>
      <SegmentedButtons
        value={form.kind}
        onValueChange={(kind) => update({ kind: kind as Draft["kind"] })}
        buttons={choices}
        style={{ marginBottom: 12 }}
      />
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <Chip
          selected={form.kind === "session-started"}
          onPress={() => update({ kind: "session-started" })}
        >
          Start now
        </Chip>
        <Chip
          selected={form.kind === "session-ended"}
          onPress={() => update({ kind: "session-ended" })}
        >
          End session
        </Chip>
      </View>
      <Text
        variant="bodySmall"
        style={{ color: colors.muted, marginBottom: 16 }}
      >
        Starting or ending a session does not mark it complete.
      </Text>
      {form.kind === "episode-watched" || form.kind === "episode-skipped" ? (
        <View>
          <Text variant="labelLarge">Choose episode</Text>
          <ScrollView horizontal style={{ marginVertical: 12 }}>
            {title.episodes?.map((e) => (
              <Chip
                key={e.id}
                selected={e.id === form.episodeId}
                style={{ marginRight: 8 }}
                onPress={() => update({ episodeId: e.id })}
              >
                {e.season !== undefined
                  ? `S${e.season} E${e.number ?? e.order}`
                  : `Episode ${e.order}`}
              </Chip>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {form.kind === "game-session" ? (
        <>
          <TextInput
            mode="outlined"
            label="Minutes (optional)"
            value={form.minutes}
            onChangeText={(minutes) => update({ minutes })}
            keyboardType="number-pad"
            style={styles.input}
          />
          <TextInput
            mode="outlined"
            label="Played on device"
            value={form.playedOn}
            onChangeText={(playedOn) => update({ playedOn })}
            style={styles.input}
          />
          <TextInput
            mode="outlined"
            label="Emulator (optional)"
            value={form.emulator}
            onChangeText={(emulator) => update({ emulator })}
            style={styles.input}
          />
        </>
      ) : null}
      {form.kind === "milestone" ? (
        <TextInput
          mode="outlined"
          label="Milestone label"
          value={form.milestone}
          onChangeText={(milestone) => update({ milestone })}
          style={styles.input}
        />
      ) : null}
      <Checkbox.Item
        label={
          title.media === "show"
            ? "Start a new viewing run"
            : "Start a new run / rewatch"
        }
        status={form.newRun ? "checked" : "unchecked"}
        onPress={() => update({ newRun: !form.newRun })}
      />
      <TextInput
        mode="outlined"
        label="Date (YYYY-MM-DD)"
        value={form.day}
        onChangeText={(day) => update({ day })}
        style={styles.input}
      />
      <TextInput
        mode="outlined"
        accessibilityLabel="Rating (optional, 1–10)"
        label="Rating (optional, 1–10)"
        value={form.rating}
        onChangeText={(rating) => update({ rating })}
        keyboardType="number-pad"
        style={styles.input}
      />
      <Checkbox.Item
        label="Liked it"
        status={form.liked ? "checked" : "unchecked"}
        onPress={() => update({ liked: !form.liked })}
      />
      <TextInput
        mode="outlined"
        label="A note for your journal (optional)"
        multiline
        value={form.note}
        onChangeText={(note) => update({ note })}
        maxLength={4000}
        style={styles.input}
      />
      <Text variant="titleMedium" style={{ marginVertical: 12 }}>
        Share this log
      </Text>
      <SegmentedButtons
        value={form.audience}
        onValueChange={(audience) =>
          update({ audience: audience as Draft["audience"] })
        }
        buttons={[
          { value: "private", label: "Private" },
          { value: "public", label: "Public" },
          { value: "friends", label: "Friends" },
        ]}
      />
      <Text variant="bodyMedium" style={{ color: colors.muted, marginTop: 10 }}>
        {form.audience === "private"
          ? "Private journal"
          : form.audience === "public"
            ? "This log and note will be visible publicly."
            : "Only accepted friends can see this log."}
      </Text>
      <Checkbox.Item
        label="Hide note as a spoiler"
        status={form.hideSpoilers ? "checked" : "unchecked"}
        onPress={() => update({ hideSpoilers: !form.hideSpoilers })}
      />
      <HelperText type="error" visible={!!error}>
        {error}
      </HelperText>
      <Button
        mode="contained"
        loading={busy}
        disabled={busy || saved}
        onPress={save}
        contentStyle={{ minHeight: 52 }}
      >
        {saved ? "Saved on this device" : "Save log"}
      </Button>
    </View>
  );
}
type titleChoice = { value: string; label: string };
