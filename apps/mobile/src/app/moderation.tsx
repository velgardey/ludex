import React, { useEffect, useState } from "react";
import { ScrollView, View, Alert } from "react-native";
import { Button, Text } from "react-native-paper";
import { useLudex } from "../state";
import { Heading, styles } from "../ui";
export default function Moderation() {
  const { session, client, setNotice } = useLudex();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const load = () =>
    client
      .moderation()
      .then(setRows)
      .catch((e) => setNotice(String(e)));
  useEffect(() => {
    if (session?.user.roles.includes("moderator")) void load();
  }, [session]);
  if (!session?.user.roles.includes("moderator"))
    return (
      <Text style={{ padding: 24 }}>Moderator permission is required.</Text>
    );
  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: 24 }]}>
      <Heading title="Reports for review" />
      {rows.map((row, index) => (
        <View key={String(row.id ?? index)} style={{ marginBottom: 24 }}>
          <Text variant="titleMedium">{String(row.reason ?? "Report")}</Text>
          <Text>{String(row.note ?? "")}</Text>
          <Text style={styles.metadata}>
            Target {String(row.targetId ?? "unknown")}
          </Text>
          <Button
            onPress={() =>
              Alert.alert(
                "Remove reported content?",
                "This moderator action is recorded in the audit trail.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Remove content",
                    style: "destructive",
                    onPress: () =>
                      client
                        .moderationAction({
                          targetId: String(row.targetId),
                          action: "remove",
                          reason: "Reviewed Android report",
                        })
                        .then(load)
                        .catch((e) => setNotice(String(e))),
                  },
                ],
              )
            }
          >
            Remove reported content
          </Button>
        </View>
      ))}
      {!rows.length ? <Text>No open reports.</Text> : null}
    </ScrollView>
  );
}
