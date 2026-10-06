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
import { colors, display, font, type } from "../../theme";
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
          size={36}
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
          <Art title={a.title} wide height={186} borderRadius={5} />
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
            <Text style={cardStyles.posterOverline}>RECORDED IN THE JOURNAL</Text>
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
    marginBottom: 20,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderColor: colors.outline,
    backgroundColor: "transparent",
  },
  author: { minHeight: 42, marginBottom: 9, paddingHorizontal: 0 },
  authorName: { ...type.title },
  rating: {
    minWidth: 48,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    backgroundColor: colors.coral,
  },
  ratingValue: { ...font.bold, color: colors.ink, fontSize: 15 },
  ratingOutOf: { ...font.medium, color: colors.ink, fontSize: 10 },
  posterPress: { borderRadius: 5, overflow: "hidden" },
  poster: { height: 186, overflow: "hidden", borderRadius: 5 },
  posterTopline: {
    position: "absolute",
    left: 10,
    right: 10,
    top: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  posterTitleWrap: { position: "absolute", left: 14, right: 14, bottom: 13 },
  posterOverline: {
    color: colors.coral,
    ...font.bold,
    fontSize: 10,
    letterSpacing: 1.3,
    marginBottom: 4,
  },
  posterTitle: { fontSize: 27, lineHeight: 32 },
  caption: {
    color: colors.lime,
    ...font.semibold,
    fontSize: 14,
    lineHeight: 20,
    paddingTop: 9,
  },
  hiddenDetail: { paddingTop: 10 },
  note: { ...type.body, paddingTop: 10, fontSize: 15, lineHeight: 23 },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 10,
    paddingTop: 3,
    borderTopWidth: 1,
    borderColor: colors.outline,
    gap: 20,
  },
});
