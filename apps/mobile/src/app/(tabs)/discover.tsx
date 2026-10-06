import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Searchbar, Text, Button, Avatar } from "react-native-paper";
import type { User } from "@ludex/domain";
import { useLudex } from "../../state";
import {
  Page,
  Heading,
  Cover,
  MediaFilters,
  styles,
  LogButton,
} from "../../ui";
export default function Discover() {
  const { catalog, session, preview, client, setNotice } = useLudex();
  const [query, setQuery] = useState("");
  const [media, setMedia] = useState("all");
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => {
    if (preview) {
      setUsers(preview.users);
      return;
    }
    if (!session) return;
    const t = setTimeout(
      () =>
        client
          .discoverUsers(query)
          .then(setUsers)
          .catch((e) => setNotice(String(e))),
      250,
    );
    return () => clearTimeout(t);
  }, [query, session, preview]);
  return (
    <View style={{ flex: 1 }}>
      <Page title="Discover">
        <Heading eyebrow="Follow a curiosity" title="A world worth keeping." />
        <Searchbar
          value={query}
          onChangeText={setQuery}
          placeholder="Titles and people"
          style={{ marginBottom: 22 }}
        />
        <MediaFilters value={media} onChange={setMedia} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          {catalog
            .filter(
              (t) =>
                (media === "all" || t.media === media) &&
                t.title.toLowerCase().includes(query.toLowerCase()),
            )
            .map((t) => (
              <Cover key={t.id} title={t} width={140} />
            ))}
        </View>
        <View style={{ marginTop: 30 }}>
          <Text
            variant="headlineSmall"
            style={{ fontFamily: "Fraunces", marginBottom: 16 }}
          >
            People in the lounge
          </Text>
          {users
            .filter((u) => u.id !== session?.user.id)
            .map((u) => (
              <View key={u.id} style={[styles.row, { paddingVertical: 12 }]}>
                <Avatar.Text size={40} label={u.displayName.slice(0, 1)} />
                <Button
                  style={{ flex: 1 }}
                  onPress={() =>
                    router.push({ pathname: "/profile", params: { id: u.id } })
                  }
                >
                  {u.displayName}
                </Button>
                <Button
                  mode="outlined"
                  onPress={async () => {
                    if (!session || preview) {
                      setNotice("Sign in to follow real people");
                      return;
                    }
                    try {
                      await client.follow(u.id);
                      setNotice(`Following ${u.displayName}`);
                    } catch (e) {
                      setNotice(String(e));
                    }
                  }}
                >
                  Follow
                </Button>
              </View>
            ))}
        </View>
      </Page>
      <LogButton />
    </View>
  );
}
