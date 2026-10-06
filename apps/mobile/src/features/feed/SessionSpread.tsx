import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Avatar, Button, Text } from "react-native-paper";
import type { Activity } from "@ludex/domain";
import { Art, styles } from "../../ui";
import { colors, display } from "../../theme";
import { useLudex } from "../../state";
export function SessionSpread({ activity }: { activity: Activity }) {
  const { client, session, preview, setNotice, refresh } = useLudex();
  const a = activity;
  return (
    <View style={{ marginBottom: 34 }}>
      <Pressable
        style={[styles.row, { marginBottom: 14, minHeight: 48 }]}
        accessibilityRole="button"
        onPress={() =>
          router.push({ pathname: "/profile", params: { id: a.authorId } })
        }
      >
        <Avatar.Text
          size={36}
          label={a.author.displayName.slice(0, 1)}
          style={{ backgroundColor: colors.surface }}
        />
        <View style={{ flex: 1 }}>
          <Text variant="titleMedium">{a.author.displayName}</Text>
          <Text style={styles.metadata}>
            {new Date(a.publishedAt).toLocaleDateString("en", {
              month: "short",
              day: "numeric",
            })}{" "}
            · {a.audience.kind}
          </Text>
        </View>
        {a.rating ? (
          <Text style={{ color: colors.copper, fontSize: 20 }}>
            {a.rating}
            <Text style={styles.metadata}> /10</Text>
          </Text>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${a.title.title}`}
        disabled={a.titleId === "hidden"}
        onPress={() =>
          router.push({ pathname: "/title", params: { id: a.titleId } })
        }
      >
        <View style={{ height: 240, overflow: "hidden", borderRadius: 12 }}>
          <Art title={a.title} wide height={240} />
          <LinearGradient
            colors={["transparent", "rgba(21,18,28,0.96)"]}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={{ position: "absolute", left: 18, right: 18, bottom: 18 }}
          >
            <Text style={[display, { fontSize: 28, lineHeight: 34 }]}>
              {a.title.title}
            </Text>
          </View>
        </View>
        <Text
          style={[styles.metadata, { color: colors.copper, marginTop: 12 }]}
        >
          {a.caption}
        </Text>
      </Pressable>
      {a.detailHidden ? (
        <Text style={[styles.metadata, { paddingTop: 14 }]}>
          Spoiler detail is concealed until your progress qualifies.
        </Text>
      ) : a.note ? (
        <Text
          variant="bodyLarge"
          style={{ paddingTop: 14, fontSize: 18, lineHeight: 27 }}
        >
          {a.note}
        </Text>
      ) : null}
      <View
        style={[
          styles.row,
          {
            marginTop: 12,
            borderBottomWidth: 1,
            borderColor: colors.outline,
            paddingBottom: 12,
          },
        ]}
      >
        <Button
          icon={a.likedByViewer ? "heart" : "heart-outline"}
          compact
          contentStyle={{ minHeight: 48 }}
          onPress={async () => {
            if (!session || preview) {
              setNotice("Sign in to react to real activity");
              return;
            }
            try {
              await client.react(a.id, !a.likedByViewer);
              await refresh(true);
            } catch (e) {
              setNotice(String(e));
            }
          }}
        >
          {a.reactionCount} likes
        </Button>
        <Button
          icon="comment-outline"
          compact
          contentStyle={{ minHeight: 48 }}
          onPress={() =>
            router.push({ pathname: "/activity", params: { id: a.id } })
          }
        >
          {a.replyCount} replies
        </Button>
      </View>
    </View>
  );
}
