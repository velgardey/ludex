import React, { useState } from "react";
import { ScrollView, View, Alert } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { Button, Text, TextInput, Switch, Divider } from "react-native-paper";
import { useLudex } from "../state";
import { styles } from "../ui";
export default function Settings() {
  const {
    session,
    settings,
    saveSettings,
    pending,
    store,
    updatePending,
    sync,
    logout,
    client,
    setNotice,
  } = useLudex();
  const [region, setRegion] = useState(String(settings.region ?? "US"));
  const [zone, setZone] = useState(
    String(
      settings.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
  );
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not complete action");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: 24, paddingBottom: 44 },
      ]}
    >
      <Text
        variant="headlineMedium"
        style={{ fontFamily: "Fraunces", marginBottom: 20 }}
      >
        Your journal. Your choices.
      </Text>
      {!session ? (
        <Button mode="contained" onPress={() => router.push("/auth")}>
          Sign in
        </Button>
      ) : (
        <>
          <Text variant="titleMedium">{session.user.displayName}</Text>
          {session.user.roles.includes("moderator") ? (
            <Button onPress={() => router.push("/moderation")}>
              Open moderation reports
            </Button>
          ) : null}
          <Text style={styles.metadata}>
            Local beta session · expires{" "}
            {new Date(session.expiresAt).toLocaleDateString()}
          </Text>
          <Divider style={{ marginVertical: 24 }} />
          <TextInput
            label="Region (ISO country code)"
            value={region}
            onChangeText={setRegion}
            maxLength={2}
            style={styles.input}
          />
          <TextInput
            label="Time zone"
            value={zone}
            onChangeText={setZone}
            style={styles.input}
          />
          <Button
            mode="outlined"
            disabled={busy}
            onPress={() =>
              act(() => saveSettings({ ...settings, region, timeZone: zone }))
            }
          >
            Save region & time zone
          </Button>
          {[
            ["lowData", "Low-data images"],
            ["reducedMotion", "Reduce motion"],
            ["haptics", "Haptic feedback"],
          ].map(([key, label]) => (
            <View key={key} style={[styles.row, { marginVertical: 16 }]}>
              <Text style={{ flex: 1 }}>{label}</Text>
              <Switch
                value={Boolean(settings[key])}
                onValueChange={(v) =>
                  act(() => saveSettings({ ...settings, [key]: v }))
                }
              />
            </View>
          ))}
          <Divider style={{ marginVertical: 24 }} />
          <Text variant="titleLarge">Pending sync</Text>
          <Text style={styles.metadata}>
            Only your own journal actions and drafts are stored offline.
            Restricted feed detail stays in memory.
          </Text>
          {pending.map((p) => (
            <View key={p.commandId} style={{ marginTop: 20 }}>
              <Text>
                {p.payload.titleId} ·{" "}
                {p.status === "pending" ? "Waiting to sync" : p.status}
              </Text>
              <Text style={styles.metadata}>
                {p.error ?? "Durable on this device"}
              </Text>
              {p.status !== "pending" ? (
                <Button
                  onPress={() =>
                    router.push({
                      pathname: "/log",
                      params: { id: p.payload.titleId },
                    })
                  }
                >
                  Review retained draft
                </Button>
              ) : null}
              <Button
                onPress={() =>
                  Alert.alert(
                    "Discard pending action?",
                    "This removes this unsent action from this device.",
                    [
                      { text: "Keep action", style: "cancel" },
                      {
                        text: "Discard",
                        style: "destructive",
                        onPress: () =>
                          act(async () => {
                            await store?.discard(p.commandId);
                            await updatePending();
                          }),
                      },
                    ],
                  )
                }
              >
                Discard this pending action
              </Button>
            </View>
          ))}
          <Button
            mode="outlined"
            disabled={busy}
            onPress={() => act(sync)}
            style={{ marginTop: 16 }}
          >
            Try sync now
          </Button>
          <Button
            onPress={() =>
              act(async () => {
                const receipt = await store?.draft<{
                  eventId: string;
                  version: number;
                  titleId: string;
                }>("last-progress");
                if (!receipt)
                  throw new Error(
                    "No saved progress action is available to undo on this device.",
                  );
                const result = await client.correctProgress({
                  commandId: randomUUID(),
                  eventId: receipt.eventId,
                  baseVersion: receipt.version,
                  retract: true,
                });
                if (result.status !== "accepted")
                  throw new Error(
                    result.status === "conflict"
                      ? "Progress has changed. Review the current run before correcting it."
                      : result.code,
                  );
                await store?.removeDraft("last-progress");
                setNotice("Last progress log retracted");
              })
            }
          >
            Undo last synced progress log
          </Button>
          <Divider style={{ marginVertical: 24 }} />
          <Text variant="titleLarge">Data ownership</Text>
          <Button
            disabled={busy}
            icon="download"
            onPress={() =>
              act(async () => {
                const result = await client.exportAccount();
                const payload = await client.request(
                  "/account/download?id=" +
                    encodeURIComponent(result.downloadId),
                );
                const file = new File(
                  Paths.cache,
                  "ludex-export-" + result.downloadId + ".json",
                );
                file.create({ overwrite: true });
                file.write(JSON.stringify(payload, null, 2));
                try {
                  if (!(await Sharing.isAvailableAsync()))
                    throw new Error(
                      "System file sharing is unavailable on this device.",
                    );
                  await Sharing.shareAsync(file.uri, {
                    mimeType: "application/json",
                    dialogTitle: "Save your Ludex export",
                  });
                } finally {
                  if (file.exists) file.delete();
                }
                setNotice(
                  `Export link expires ${new Date(result.expiresAt).toLocaleTimeString()}`,
                );
              })
            }
          >
            Export my data
          </Button>
          <Text style={styles.metadata}>
            The API returns a time-limited download containing your account
            data.
          </Text>
          <Button
            disabled={busy}
            textColor="#FFB4AB"
            onPress={() =>
              Alert.alert(
                "Delete your account?",
                "Your API access and public visibility end immediately. This action removes your journal and cannot be undone.",
                [
                  { text: "Keep account", style: "cancel" },
                  {
                    text: "Delete account",
                    style: "destructive",
                    onPress: () =>
                      act(async () => {
                        await client.requestDeletion();
                        await logout();
                        router.replace("/");
                      }),
                  },
                ],
              )
            }
          >
            Delete account
          </Button>
          <Divider style={{ marginVertical: 24 }} />
          <Button
            onPress={() =>
              Alert.alert(
                "Sign out?",
                pending.length
                  ? `${pending.length} pending action(s) will be discarded along with local drafts and cache. Sync first to keep them.`
                  : "Local drafts and cache will be cleared.",
                [
                  { text: "Stay signed in", style: "cancel" },
                  {
                    text: "Sign out & clear this device",
                    onPress: () =>
                      act(async () => {
                        await logout();
                        router.replace("/");
                      }),
                  },
                ],
              )
            }
          >
            Sign out
          </Button>
        </>
      )}
      <Text style={[styles.metadata, { marginTop: 30 }]}>
        Ludex Stage A uses manual logs. Steam, imports, desktop Netflix capture
        and companion cloud replies arrive through later integration gates. No
        background presence is enabled.
      </Text>
    </ScrollView>
  );
}
