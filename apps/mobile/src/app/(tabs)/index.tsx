import React, { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Text, Banner } from "react-native-paper";
import { useLudex } from "../../state";
import {
  Page,
  Empty,
  LogButton,
  MediaFilters,
  CinematicHeader,
} from "../../ui";
import { SessionSpread } from "../../features/feed/SessionSpread";
import { colors } from "../../theme";
export default function Feed() {
  const { session, preview, feed, error, newFeed, acceptFeed, refresh } =
    useLudex();
  const [media, setMedia] = useState("all");
  return (
    <View style={{ flex: 1 }}>
      <Page title="Ludex" refresh={() => refresh()}>
        <CinematicHeader name="The stories stay." />
        {preview ? (
          <Text
            style={{
              textAlign: "center",
              marginBottom: 16,
              color: colors.muted,
            }}
          >
            Preview journal · sample activity
          </Text>
        ) : null}
        {!session && !preview ? (
          <Empty
            title="Keep your own record"
            text="Bring films, series and games into one journal. Follow your people, trade notes, and keep the sessions that matter."
            action={() => router.push("/auth")}
            label="Sign in / join"
          />
        ) : null}
        <MediaFilters value={media} onChange={setMedia} />
        {newFeed ? (
          <Banner
            visible
            actions={[{ label: "Show new activity", onPress: acceptFeed }]}
          >
            New activity is ready. Your place in the feed stays put.
          </Banner>
        ) : null}
        {error ? (
          <Text style={{ marginBottom: 20 }}>
            Connection unavailable · pull to retry. {error}
          </Text>
        ) : null}
        {feed.items
          .filter((a) => media === "all" || a.title.media === media)
          .map((a) => (
            <SessionSpread key={a.id} activity={a} />
          ))}
        {session && !feed.items.length ? (
          <Empty
            title="No new sessions yet"
            text="Follow someone in Discover or share a log when you want the people who follow you to see it."
            action={() => router.push("/discover")}
            label="Find your people"
          />
        ) : null}
      </Page>
      <LogButton />
    </View>
  );
}
