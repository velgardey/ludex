import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Searchbar, Text, Button, Avatar } from "react-native-paper";
import type { User } from "@ludex/domain";
import { colors } from "../../theme";
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
          style={discoverStyles.search}
          inputStyle={{ fontFamily: "SourceSans3", minHeight: 42 }}
        />
        <MediaFilters value={media} onChange={setMedia} />
        <Text style={styles.eyebrow}>THE CATALOG</Text>
        <View style={discoverStyles.catalog}>
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
        <View style={discoverStyles.peopleSection}>
          <Text
            variant="headlineSmall"
            style={discoverStyles.peopleTitle}
          >
            People in the lounge
          </Text>
          <Text style={[styles.metadata, { marginBottom: 12 }]}>
            Find a point of view worth following.
          </Text>
          {users
            .filter((u) => u.id !== session?.user.id)
            .map((u) => (
              <View key={u.id} style={[styles.row, discoverStyles.personRow]}>
                <Avatar.Text
                  size={44}
                  label={u.displayName.slice(0, 1)}
                  color={colors.ink}
                  style={{ backgroundColor: colors.orchid }}
                />
                <Button
                  style={{ flex: 1 }}
                  textColor={colors.pearl}
                  contentStyle={{ justifyContent: "flex-start", minHeight: 48 }}
                  onPress={() =>
                    router.push({ pathname: "/profile", params: { id: u.id } })
                  }
                >
                  {u.displayName}
                </Button>
                <Button
                  mode="contained"
                  buttonColor={colors.lime}
                  textColor={colors.ink}
                  style={{ borderRadius: 14 }}
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

const discoverStyles = {
  search: {
    marginBottom: 20,
    borderRadius: 17,
    backgroundColor: colors.surface,
  },
  catalog: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 14,
    paddingBottom: 8,
  },
  peopleSection: { marginTop: 28, paddingTop: 22, borderTopWidth: 1, borderColor: colors.outline },
  peopleTitle: { fontFamily: "Fraunces", fontWeight: "800" as const, marginBottom: 5, color: colors.pearl },
  personRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.outline,
    backgroundColor: colors.surface,
  },
};
