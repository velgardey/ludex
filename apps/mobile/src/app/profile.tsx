import React, { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Button, Text } from "react-native-paper";
import type { Showcase } from "@ludex/domain";
import { useLudex } from "../state";
import { ProfileView } from "../features/profile/ProfileView";
import { styles } from "../ui";
export default function Profile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client, catalog, session, preview, setNotice } = useLudex();
  const [profile, setProfile] = useState<Showcase | null>(null);
  const [name, setName] = useState("Showcase");
  const [following, setFollowing] = useState(false);
  useEffect(() => {
    if (preview) {
      setProfile(preview.showcase);
      setName(
        preview.users.find((u) => u.id === id)?.displayName ??
          "Sample showcase",
      );
      return;
    }
    client
      .socialStatus(id)
      .then((s) => setFollowing(s.following))
      .catch((e) => setNotice(String(e)));
    client
      .readShowcase(id)
      .then(setProfile)
      .catch((e) => setNotice(String(e)));
    client
      .discoverUsers()
      .then((users) =>
        setName(users.find((u) => u.id === id)?.displayName ?? "Showcase"),
      );
  }, [id]);
  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: 24 }]}>
      <ProfileView showcase={profile} catalog={catalog} name={name} />
      {session && !preview && id !== session.user.id ? (
        <>
          <Button
            mode="contained"
            style={{ marginVertical: 24 }}
            onPress={async () => {
              try {
                await client.follow(id, !following);
                setFollowing(!following);
              } catch (e) {
                setNotice(String(e));
              }
            }}
          >
            {following ? "Unfollow" : "Follow"}
          </Button>
          <Button
            onPress={() =>
              client
                .setFriendship(id, "request")
                .then(() => setNotice("Friend request sent"))
                .catch((e) => setNotice(String(e)))
            }
          >
            Request friendship
          </Button>
          <Button
            onPress={() =>
              client
                .setFriendship(id, "accept")
                .then(() => setNotice("Friendship accepted"))
                .catch((e) => setNotice(String(e)))
            }
          >
            Accept incoming friendship request
          </Button>
          <Button
            onPress={() =>
              client
                .setFriendship(id, "remove")
                .then(() => setNotice("Friendship removed"))
                .catch((e) => setNotice(String(e)))
            }
          >
            Remove friendship
          </Button>
          <Button
            onPress={() =>
              client
                .blockUser(id)
                .then(() =>
                  setNotice("Blocked. Access is removed in both directions."),
                )
                .catch((e) => setNotice(String(e)))
            }
          >
            Block user
          </Button>
          <Button
            onPress={() =>
              client
                .reportContent({ targetId: id, reason: "other" })
                .then(() => setNotice("Report sent for review"))
                .catch((e) => setNotice(String(e)))
            }
          >
            Report profile
          </Button>
        </>
      ) : (
        <Text style={styles.metadata}>
          Sample profiles show how a public showcase works.
        </Text>
      )}
    </ScrollView>
  );
}
