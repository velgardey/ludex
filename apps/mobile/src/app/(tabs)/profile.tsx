import React, { useEffect, useState } from "react";
import { router } from "expo-router";
import { Button, Switch, Text } from "react-native-paper";
import { View } from "react-native";
import { useLudex } from "../../state";
import { Page, Empty, styles } from "../../ui";
import { ProfileView } from "../../features/profile/ProfileView";
export default function Profile() {
  const { session, preview, showcase, catalog, refresh, client, setNotice } =
    useLudex();
  const [viewer, setViewer] = useState(false);
  const [collections, setCollections] = useState<
    import("@ludex/domain").Collection[]
  >([]);
  useEffect(() => {
    if (session)
      client
        .readCollections()
        .then(setCollections)
        .catch((e) => setNotice(String(e)));
  }, [session]);
  return (
    <Page title="Profile" refresh={() => refresh()}>
      {session || preview ? (
        <>
          <View style={[styles.row, { marginBottom: 24 }]}>
            <Text style={{ flex: 1 }}>Preview as a public viewer</Text>
            <Switch value={viewer} onValueChange={setViewer} />
          </View>
          <ProfileView
            showcase={showcase}
            catalog={catalog}
            name={session?.user.displayName ?? "The sample lounge"}
            owner={!!session && !viewer}
            viewer={viewer}
          />
          {collections
            .filter((c) => !viewer || c.audience.kind === "public")
            .map((c) => (
              <Button
                key={c.id}
                icon="playlist-play"
                onPress={() =>
                  router.push({ pathname: "/collection", params: { id: c.id } })
                }
              >
                {c.title} · {c.audience.kind}
              </Button>
            ))}
          <Button
            icon="playlist-plus"
            onPress={() => router.push("/collection-edit")}
            style={{ marginTop: 20 }}
          >
            Create mixed-media collection
          </Button>
          <Button
            icon="cog-outline"
            onPress={() => router.push("/settings")}
            style={{ marginTop: 24 }}
          >
            Settings & data ownership
          </Button>
        </>
      ) : (
        <Empty
          title="An archive with your signature"
          text="Choose a featured work and mixed shelves, then decide what others can see."
          action={() => router.push("/auth")}
          label="Create your journal"
        />
      )}
    </Page>
  );
}
