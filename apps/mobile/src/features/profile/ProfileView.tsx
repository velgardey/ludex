import React from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Button, Text } from "react-native-paper";
import type { CatalogHit, Showcase } from "@ludex/domain";
import { Cover, CinematicHeader, Landscape, styles } from "../../ui";
import { colors } from "../../theme";
import { publicShelves } from "../feed/model";
export function ProfileView({
  showcase,
  catalog,
  name,
  owner = false,
  viewer = false,
}: {
  showcase: Showcase | null;
  catalog: CatalogHit[];
  name: string;
  owner?: boolean;
  viewer?: boolean;
}) {
  const featured = catalog.find((t) => t.id === showcase?.featuredTitleId);
  const shelves = viewer
    ? publicShelves(showcase?.shelves ?? [])
    : (showcase?.shelves ?? []);
  const accent =
    showcase?.theme === "matinee"
      ? colors.copper
      : showcase?.theme === "midnight"
        ? "#B1B7DC"
        : colors.violet;
  return (
    <>
      <CinematicHeader name={name} title={featured} accent={accent} />
      {viewer ? (
        <Text style={[styles.metadata, { marginBottom: 16 }]}>
          Public viewer preview · current visible shelves
        </Text>
      ) : null}
      {owner ? (
        <Button
          mode="outlined"
          icon="pencil-outline"
          onPress={() => router.push("/showcase-edit")}
          style={{ marginBottom: 20 }}
        >
          Edit your showcase
        </Button>
      ) : null}
      {shelves.map((s) => (
        <View key={s.id} style={{ marginBottom: 30 }}>
          <View style={[styles.row, { marginBottom: 14 }]}>
            <Text
              variant="titleLarge"
              style={{ flex: 1, fontFamily: "Fraunces" }}
            >
              {s.title}
            </Text>
            <Text style={[styles.metadata, { color: accent }]}>
              {s.audience.kind}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {s.itemIds
              .map((id) => catalog.find((t) => t.id === id))
              .filter((t): t is CatalogHit => !!t)
              .map((t) =>
                s.layout === "spread" ? (
                  <Landscape key={t.id} title={t} />
                ) : (
                  <Cover key={t.id} title={t} width={112} />
                ),
              )}
          </ScrollView>
        </View>
      ))}
      {!shelves.length ? (
        <Text style={styles.metadata}>
          {viewer
            ? "No public shelves are visible."
            : "Build a shelf of films, TV, games, or an ordered journey across them."}
        </Text>
      ) : null}
    </>
  );
}
