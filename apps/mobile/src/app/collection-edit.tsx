import React, { useState } from "react";
import { ScrollView } from "react-native";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import {
  Button,
  TextInput,
  Checkbox,
  SegmentedButtons,
  HelperText,
} from "react-native-paper";
import { useLudex } from "../state";
import { Heading, styles } from "../ui";
export default function CollectionEdit() {
  const { client, catalog, session, setNotice } = useLudex();
  const [title, setTitle] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [audience, setAudience] = useState("private");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: 24, paddingBottom: 40 },
      ]}
    >
      <Heading eyebrow="Mixed-media journey" title="Give it a thread." />
      <TextInput
        label="Collection name"
        value={title}
        onChangeText={setTitle}
        style={styles.input}
      />
      <SegmentedButtons
        value={audience}
        onValueChange={setAudience}
        buttons={[
          { value: "private", label: "Private" },
          { value: "public", label: "Public" },
          { value: "friends", label: "Friends" },
        ]}
      />
      {catalog.map((t) => (
        <Checkbox.Item
          key={t.id}
          label={t.title}
          status={ids.includes(t.id) ? "checked" : "unchecked"}
          onPress={() =>
            setIds((v) =>
              v.includes(t.id) ? v.filter((id) => id !== t.id) : [...v, t.id],
            )
          }
        />
      ))}
      <HelperText type="error" visible={!!error}>
        {error}
      </HelperText>
      <Button
        disabled={!session || busy}
        loading={busy}
        mode="contained"
        onPress={async () => {
          setBusy(true);
          try {
            if (!title.trim()) throw new Error("Name your collection first.");
            const id = randomUUID();
            const result = await client.saveCollection({
              commandId: randomUUID(),
              id,
              version: 0,
              title,
              titleIds: ids,
              audience: { kind: audience as "private" },
            });
            if (result.status !== "accepted")
              throw new Error(
                result.status === "conflict"
                  ? "Collection changed."
                  : result.code,
              );
            setNotice("Collection saved");
            router.replace({ pathname: "/collection", params: { id } });
          } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to save");
          } finally {
            setBusy(false);
          }
        }}
      >
        Save collection
      </Button>
    </ScrollView>
  );
}
