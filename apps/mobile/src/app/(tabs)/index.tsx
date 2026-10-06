import React, { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Button, Text, Banner } from "react-native-paper";
import { useLudex } from "../../state";
import {
  Page,
  Empty,
  LogButton,
  MediaFilters,
  CinematicHeader,
} from "../../ui";
import { SessionSpread } from "../../features/feed/SessionSpread";
export default function Feed() {
  const {
    session,
    preview,
    feed,
    error,
    newFeed,
    acceptFeed,
    refresh,
    loadPreview,
    setNotice,
  } = useLudex();
  const [media, setMedia] = useState("all");
  return (
    <View style={{ flex: 1 }}>
      <Page title="Ludex" refresh={() => refresh()}>
        <CinematicHeader name="The stories stay." />
        {preview ? (
          <Text style={{ marginBottom: 20 }}>
            Sample lounge · curated preview activity
          </Text>
        ) : null}
        {!session && !preview ? (
          <Empty
            title="Make the lounge yours"
            text="Keep films, TV and games together. Follow your people, trade notes, and remember the sessions that matter."
            action={() => router.push("/auth")}
            label="Sign in / join"
          />
        ) : null}
        {!session ? (
          <Button
            mode="outlined"
            onPress={() => loadPreview().catch((e) => setNotice(String(e)))}
            style={{ marginBottom: 22 }}
          >
            Explore sample lounge
          </Button>
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
            title="Your following feed is quiet"
            text="Follow someone in Discover, or publish a log when you want to share an experience."
            action={() => router.push("/discover")}
            label="Find your people"
          />
        ) : null}
      </Page>
      <LogButton />
    </View>
  );
}
