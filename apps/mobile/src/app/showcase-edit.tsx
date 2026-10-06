import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import {
  Button,
  Text,
  TextInput,
  SegmentedButtons,
  Checkbox,
  IconButton,
} from "react-native-paper";
import type { Showcase } from "@ludex/domain";
import { useLudex } from "../state";
import { styles } from "../ui";
import { ProfileView } from "../features/profile/ProfileView";
import { moveShelf } from "../features/feed/model";
export default function ShowcaseEdit() {
  const { showcase, catalog, session, client, setShowcase, setNotice } =
    useLudex();
  const [form, setForm] = useState<Showcase>(() =>
    structuredClone(
      showcase ?? {
        userId: session?.user.id ?? "",
        version: 0,
        theme: "lounge",
        shelves: [],
      },
    ),
  );
  const [before] = useState(showcase);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const update = (patch: Partial<Showcase>) =>
    setForm((s) => ({ ...s, ...patch }));
  const shelf = (index: number, patch: Partial<Showcase["shelves"][number]>) =>
    setForm((s) => ({
      ...s,
      shelves: s.shelves.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    }));
  const reorder = (index: number, d: number) =>
    update({ shelves: moveShelf(form.shelves, index, d) });
  const save = async (value = form) => {
    setBusy(true);
    try {
      const result = await client.saveShowcase({
        commandId: randomUUID(),
        baseVersion: showcase?.version ?? 0,
        showcase: value,
      });
      if (result.status !== "accepted")
        throw new Error(
          result.status === "conflict"
            ? "Showcase changed elsewhere. Your edits remain here."
            : result.code,
        );
      setShowcase({ ...value, version: result.version });
      setNotice("Showcase saved");
      router.back();
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: 20, paddingBottom: 44 },
      ]}
    >
      <Text
        variant="headlineMedium"
        style={{ fontFamily: "Fraunces", marginBottom: 18 }}
      >
        Make the room yours.
      </Text>
      <SegmentedButtons
        value={form.theme}
        onValueChange={(theme) => update({ theme: theme as Showcase["theme"] })}
        buttons={[
          { value: "lounge", label: "Lounge" },
          { value: "matinee", label: "Matinee" },
          { value: "midnight", label: "Midnight" },
        ]}
      />
      <Text variant="titleMedium" style={{ marginTop: 24 }}>
        Featured work
      </Text>
      <ScrollView horizontal style={{ marginVertical: 12 }}>
        {catalog.map((t) => (
          <Button
            key={t.id}
            mode={form.featuredTitleId === t.id ? "contained-tonal" : "text"}
            onPress={() => update({ featuredTitleId: t.id })}
          >
            {t.title}
          </Button>
        ))}
      </ScrollView>
      {form.shelves.map((s, index) => (
        <View key={s.id} style={{ marginVertical: 18 }}>
          <TextInput
            label="Shelf title"
            value={s.title}
            onChangeText={(title) => shelf(index, { title })}
          />
          <View style={styles.row}>
            <IconButton
              icon="arrow-up"
              accessibilityLabel={`Move ${s.title} up`}
              onPress={() => reorder(index, -1)}
              disabled={index === 0}
            />
            <IconButton
              icon="arrow-down"
              accessibilityLabel={`Move ${s.title} down`}
              onPress={() => reorder(index, 1)}
              disabled={index === form.shelves.length - 1}
            />
            <Button
              onPress={() =>
                update({ shelves: form.shelves.filter((v) => v.id !== s.id) })
              }
            >
              Remove shelf
            </Button>
          </View>
          <SegmentedButtons
            value={s.audience.kind}
            onValueChange={(kind) =>
              shelf(index, { audience: { kind: kind as "private" | "public" } })
            }
            buttons={[
              { value: "private", label: "Private" },
              { value: "public", label: "Public" },
              { value: "friends", label: "Friends" },
            ]}
          />
          <Text style={[styles.metadata, { marginVertical: 10 }]}>
            A public shelf exposes its selected titles. Private journal notes
            stay private.
          </Text>
          {catalog.map((t) => (
            <Checkbox.Item
              key={t.id}
              label={t.title}
              status={s.itemIds.includes(t.id) ? "checked" : "unchecked"}
              onPress={() =>
                shelf(index, {
                  itemIds: s.itemIds.includes(t.id)
                    ? s.itemIds.filter((id) => id !== t.id)
                    : [...s.itemIds, t.id].slice(0, 24),
                })
              }
            />
          ))}
        </View>
      ))}
      <Button
        mode="outlined"
        disabled={form.shelves.length >= 8}
        onPress={() =>
          update({
            shelves: [
              ...form.shelves,
              {
                id: randomUUID(),
                title: "New shelf",
                layout: "covers",
                itemIds: [],
                audience: { kind: "private" },
              },
            ],
          })
        }
      >
        Add shelf
      </Button>
      <Button onPress={() => setPreview(!preview)} style={{ marginTop: 16 }}>
        {" "}
        {preview ? "Hide" : "Show"} live preview
      </Button>
      {preview ? (
        <ProfileView
          showcase={form}
          catalog={catalog}
          name={session?.user.displayName ?? "Your showcase"}
        />
      ) : null}
      <Button
        mode="contained"
        loading={busy}
        disabled={busy}
        onPress={() => save()}
        style={{ marginTop: 24 }}
      >
        Save showcase
      </Button>
      <Button onPress={() => router.back()}>Cancel edits</Button>
      {before ? (
        <Button
          onPress={() => {
            setForm(structuredClone(before));
            setNotice("Editor restored to the last saved version");
          }}
        >
          Undo editor changes
        </Button>
      ) : null}
    </ScrollView>
  );
}
