import React, { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { Button, Text, TextInput } from "react-native-paper";
import type { Activity, Reply } from "@ludex/domain";
import { useLudex } from "../state";
import { SessionSpread } from "../features/feed/SessionSpread";
import { styles } from "../ui";
export default function ActivityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client, preview, session, setNotice } = useLudex();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () =>
    Promise.all([
      client.readActivity(id).then(setActivity),
      client.readReplies(id).then(setReplies),
    ]);
  useEffect(() => {
    if (preview) {
      setActivity(preview.feed.items.find((a) => a.id === id) ?? null);
      return;
    }
    load().catch((e) => setNotice(String(e)));
  }, [id]);
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingTop: 20, paddingBottom: 40 },
      ]}
    >
      {activity ? (
        <SessionSpread activity={activity} />
      ) : (
        <Text>Activity is unavailable to this viewer.</Text>
      )}
      {replies.map((r) => (
        <Text key={r.id} style={{ marginVertical: 14 }}>
          {r.author.displayName}:{" "}
          {r.detailHidden ? "Spoiler reply concealed" : r.text}
        </Text>
      ))}
      {session && !preview ? (
        <>
          <TextInput
            multiline
            label="Reply (up to 2,000 characters)"
            value={text}
            onChangeText={setText}
            maxLength={2000}
            style={styles.input}
          />
          <Button
            mode="contained"
            loading={busy}
            disabled={busy || !text.trim()}
            onPress={async () => {
              setBusy(true);
              try {
                await client.addReply({
                  commandId: randomUUID(),
                  activityId: id,
                  text,
                  spoiler: { kind: "none" },
                });
                setText("");
                await load();
              } catch (e) {
                setNotice(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Send reply
          </Button>
          <Button
            onPress={() =>
              client
                .reportContent({ targetId: id, reason: "spoiler" })
                .then(() => setNotice("Reported for moderator review"))
                .catch((e) => setNotice(String(e)))
            }
          >
            Report activity
          </Button>
        </>
      ) : null}
    </ScrollView>
  );
}
