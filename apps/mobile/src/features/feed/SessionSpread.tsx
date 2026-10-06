import React from "react";
import { View, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Avatar, Button, Text } from "react-native-paper";
import type { Activity } from "@ludex/domain";
import {
  Art,
  AudienceBadge,
  MediaBadge,
  MotionPressable,
  styles,
} from "../../ui";
import { colors, display } from "../../theme";
import { useLudex } from "../../state";

export function SessionSpread({ activity }: { activity: Activity }) {
  const { client, session, preview, setNotice, refresh } = useLudex();
  const a = activity;

  return (
    <View style={cardStyles.card}>
      <MotionPressable
        style={[styles.row, cardStyles.author]}
        accessibilityRole="button"
        accessibilityLabel={"Open " + a.author.displayName + "'s profile"}
        onPress={() =>
          router.push({ pathname: "/profile", params: { id: a.authorId } })
        }
      >
        <Avatar.Text
          size={42}
          label={a.author.displayName.slice(0, 1)}
          color={colors.ink}
          style={{ backgroundColor: colors.lime }}
        />
        <View style={{ flex: 1 }}>
          <Text variant="titleMedium" style={cardStyles.authorName}>
            {a.author.displayName}
          </Text>
          <Text style={styles.metadata}>
            {new Date(a.publishedAt).toLocaleDateString("en", {
              month: "short",
              day: "numeric",
            })}
          </Text>
        </View>
        {a.rating ? (
          <View style={cardStyles.rating}>
            <Text style={cardStyles.ratingValue}>
              {a.rating}
              <Text style={cardStyles.ratingOutOf}> /10</Text>
            </Text>
          </View>
        ) : null}
      </MotionPressable>

      <MotionPressable
        style={cardStyles.posterPress}
        accessibilityRole="button"
        accessibilityLabel={"Open " + a.title.title}
        disabled={a.titleId === "hidden"}
        onPress={() =>
          router.push({ pathname: "/title", params: { id: a.titleId } })
        }
      >
        <View style={cardStyles.poster}>
          <Art title={a.title} wide height={252} borderRadius={20} />
          <LinearGradient
            colors={["rgba(22,13,32,0.03)", "rgba(22,13,32,0.25)", "rgba(22,13,32,0.96)"]}
            locations={[0, 0.4, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={cardStyles.posterTopline}>
            <MediaBadge media={a.title.media} />
            <AudienceBadge audience={a.audience.kind} />
          </View>
          <View style={cardStyles.posterTitleWrap}>
            <Text style={cardStyles.posterOverline}>THE SESSION</Text>
            <Text style={[display, cardStyles.posterTitle]} numberOfLines={2}>
              {a.title.title}
            </Text>
          </View>
        </View>
        <Text style={cardStyles.caption}>{a.caption}</Text>
      </MotionPressable>

      {a.detailHidden ? (
        <Text style={[styles.metadata, cardStyles.hiddenDetail]}>
          Spoiler detail is concealed until your progress qualifies.
        </Text>
      ) : a.note ? (
        <Text variant="bodyLarge" style={cardStyles.note}>
          {a.note}
        </Text>
      ) : null}

      <View style={cardStyles.actions}>
        <Button
          icon={a.likedByViewer ? "heart" : "heart-outline"}
          compact
          contentStyle={{ minHeight: 46 }}
          textColor={colors.pearl}
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
          contentStyle={{ minHeight: 46 }}
          textColor={colors.pearl}
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

const cardStyles = StyleSheet.create({
  card: {
    marginBottom: 24,
    padding: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.outline,
    backgroundColor: colors.surface,
  },
  author: { minHeight: 50, marginBottom: 12, paddingHorizontal: 2 },
  authorName: { fontWeight: "800" },
  rating: {
    minWidth: 54,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: colors.coral,
  },
  ratingValue: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  ratingOutOf: { color: colors.ink, fontSize: 11, fontWeight: "700" },
  posterPress: { borderRadius: 20, overflow: "hidden" },
  poster: { height: 252, overflow: "hidden", borderRadius: 20 },
  posterTopline: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  posterTitleWrap: { position: "absolute", left: 17, right: 17, bottom: 16 },
  posterOverline: {
    color: colors.coral,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 6,
  },
  posterTitle: { fontSize: 29, lineHeight: 33, fontWeight: "900" },
  caption: {
    color: colors.lime,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    paddingTop: 12,
  },
  hiddenDetail: { paddingTop: 14 },
  note: { paddingTop: 14, fontSize: 17, lineHeight: 26 },
  actions: {
    flexDirection: "row",
    marginTop: 10,
    paddingTop: 5,
    borderTopWidth: 1,
    borderColor: colors.outline,
  },
});
