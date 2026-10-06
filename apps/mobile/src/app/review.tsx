import React, { useEffect, useState, useRef } from "react";
import { ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import {
  Button,
  Text,
  TextInput,
  Checkbox,
  HelperText,
} from "react-native-paper";
import { useLudex } from "../state";
import { Heading, styles } from "../ui";
export default function Review() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { catalog, session, client, store, setNotice } = useLudex();
  const title = catalog.find((t) => t.id === id);
  const [text, setText] = useState("");
  const [rating, setRating] = useState("");
  const [spoiler, setSpoiler] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const draftId = useRef(randomUUID());
  const version = useRef(0);
  useEffect(() => {
    store
      ?.draft<{ text: string; rating: string; spoiler: boolean }>(
        "review:" + id,
      )
      .then((d) => {
        if (d) {
          setText(d.text);
          setRating(d.rating);
          setSpoiler(d.spoiler);
        }
        setLoaded(true);
      });
  }, [id, store]);
  useEffect(() => {
    if (loaded)
      void store?.saveDraft("review:" + id, { text, rating, spoiler });
  }, [text, rating, spoiler, loaded]);
  const save = async (publish: boolean) => {
    setBusy(true);
    setError("");
    try {
      const n = rating.trim() ? Number(rating) : undefined;
      if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > 10))
        throw new Error("Rating must be a whole number from 1 to 10.");
      if (!text.trim()) throw new Error("Write a review first.");
      const saved = await client.saveReviewDraft({
        id: draftId.current,
        titleId: id,
        text,
        version: version.current,
        rating: n,
      });
      version.current = saved.version;
      if (publish) {
        await client.publishReview({
          commandId: randomUUID(),
          draftId: draftId.current,
          baseVersion: version.current,
          audience: { kind: "public" },
          spoiler: spoiler ? { kind: "hidden", titleId: id } : { kind: "none" },
        });
        await store?.removeDraft("review:" + id);
        setNotice("Review published publicly");
        router.back();
      } else setNotice("Private review draft saved");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Review retained on this device",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, { paddingTop: 24 }]}
    >
      <Heading eyebrow="Review" title={title?.title ?? "Your thoughts"} />
      <Text style={[styles.metadata, { marginBottom: 20 }]}>
        Drafts stay private. Publish is a separate, explicit public action.
      </Text>
      <TextInput
        label="Review text"
        multiline
        value={text}
        onChangeText={setText}
        maxLength={10000}
        style={styles.input}
      />
      <TextInput
        label="Rating (optional, 1–10)"
        value={rating}
        onChangeText={setRating}
        keyboardType="number-pad"
        style={styles.input}
      />
      <Checkbox.Item
        label="Hide review text as a spoiler"
        status={spoiler ? "checked" : "unchecked"}
        onPress={() => setSpoiler(!spoiler)}
      />
      <HelperText type="error" visible={!!error}>
        {error}
      </HelperText>
      <Button
        mode="outlined"
        disabled={busy || !session}
        loading={busy}
        onPress={() => save(false)}
      >
        Save private draft
      </Button>
      <Button
        mode="contained"
        disabled={busy || !session}
        onPress={() => save(true)}
        style={{ marginTop: 16 }}
      >
        Publish publicly
      </Button>
    </ScrollView>
  );
}
