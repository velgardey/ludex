import React, { useEffect, useState } from "react";
import { router } from "expo-router";
import { Button, Switch, Text } from "react-native-paper";
import { View } from "react-native";
import { useLudex } from "../../state";
import { Page, Empty, styles } from "../../ui";
import { colors } from "../../theme";
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
          <View style={[styles.row, profileStyles.previewToggle]}>
            <View style={{ flex: 1 }}>
              <Text variant="titleSmall">
                Preview as a public viewer
              </Text>
              <Text style={[styles.metadata, { textAlign: "center" }]}>Check what others can see</Text>
            </View>
            <Switch
              value={viewer}
              onValueChange={setViewer}
              color={colors.coral}
            />
          </View>
          <ProfileView
            showcase={showcase}
            catalog={catalog}
            name={session?.user.displayName ?? "Sample archive"}
            owner={!!session && !viewer}
            viewer={viewer}
          />
          {collections
            .filter((c) => !viewer || c.audience.kind === "public")
            .map((c) => (
              <Button
                key={c.id}
                icon="playlist-play"
                mode="outlined"
                textColor={colors.pearl}
                contentStyle={{ minHeight: 52 }}
                style={profileStyles.collectionButton}
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
            buttonColor={colors.lime}
            textColor={colors.ink}
            style={profileStyles.createButton}
          >
            Create mixed-media collection
          </Button>
          <Button
            icon="cog-outline"
            onPress={() => router.push("/settings")}
            textColor={colors.coral}
            style={profileStyles.settingsButton}
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

const profileStyles = {
  previewToggle: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.outline,
    backgroundColor: colors.surface,
  },
  collectionButton: {
    marginBottom: 9,
    alignSelf: "stretch" as const,
    borderRadius: 6,
    borderColor: colors.outline,
  },
  createButton: { alignSelf: "stretch" as const, marginTop: 12, borderRadius: 6 },
  settingsButton: { alignSelf: "center" as const, marginTop: 13 },
};
