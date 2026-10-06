import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Searchbar, Text, Button, Avatar } from "react-native-paper";
import type { User, CatalogHit } from "@ludex/domain";
import { colors, font } from "../../theme";
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
  const [hits, setHits] = useState<CatalogHit[]>([]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () =>
        client
          .searchCatalog({
            text: query,
            media: media === "all" ? undefined : media,
          })
          .then((v) => {
            if (active) setHits(v);
          })
          .catch((e) => {
            if (active) setNotice(e.message);
          }),
      300,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, media, client, setNotice]);
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
        <Heading
          context="Films, series, games and the people who love them."
          title="Find your next favorite."
        />
        <Searchbar
          value={query}
          onChangeText={setQuery}
          placeholder="Titles and people"
          style={discoverStyles.search}
          inputStyle={{ minHeight: 42 }}
        />
        <MediaFilters value={media} onChange={setMedia} />
        <Text variant="titleMedium" style={discoverStyles.catalogTitle}>
          Catalog
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={discoverStyles.catalog}
        >
          {(hits.length ? hits : catalog)
            .filter(
              (t) =>
                (media === "all" || t.media === media) &&
                t.title.toLowerCase().includes(query.toLowerCase()),
            )
            .map((t) => (
              <Cover key={t.id} title={t} width={108} />
            ))}
        </ScrollView>
        <View style={discoverStyles.peopleSection}>
          <Text variant="headlineSmall" style={discoverStyles.peopleTitle}>
            People to follow
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
    marginBottom: 16,
    borderRadius: 7,
    backgroundColor: colors.surface,
  },
  catalogTitle: {
    ...font.semibold,
    textAlign: "center" as const,
    color: colors.pearl,
    marginBottom: 10,
  },
  catalog: {
    gap: 12,
    paddingBottom: 8,
    paddingHorizontal: 2,
  },
  peopleSection: {
    marginTop: 22,
    paddingTop: 18,
    borderTopWidth: 1,
    borderColor: colors.outline,
  },
  peopleTitle: {
    ...font.semibold,
    textAlign: "center" as const,
    marginBottom: 5,
    color: colors.pearl,
  },
  personRow: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.outline,
    backgroundColor: colors.surface,
  },
};
