import React from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Button, Text } from "react-native-paper";
import type { CatalogHit, Showcase } from "@ludex/domain";
import {
  AudienceBadge,
  Cover,
  CinematicHeader,
  Landscape,
  styles,
} from "../../ui";
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
      ? colors.lime
      : showcase?.theme === "midnight"
        ? colors.orchid
        : colors.coral;
  return (
    <>
      <CinematicHeader name={name} title={featured} accent={accent} />
      {viewer ? (
        <View style={profileStyles.viewerNote}>
          <Text style={styles.metadata}>
            Public viewer preview · current visible shelves
          </Text>
        </View>
      ) : null}
      {owner ? (
        <Button
          mode="outlined"
          icon="pencil-outline"
          onPress={() => router.push("/showcase-edit")}
          style={profileStyles.editButton}
          textColor={colors.coral}
        >
          Edit your showcase
        </Button>
      ) : null}
      {shelves.map((s) => (
        <View key={s.id} style={profileStyles.shelf}>
          <View style={[styles.row, profileStyles.shelfHeading]}>
            <View style={{ flex: 1 }}>
              <Text style={profileStyles.shelfEyebrow}>
                {s.layout === "spread" ? "A JOURNEY THROUGH" : "IN THE ROTATION"}
              </Text>
              <Text variant="titleLarge" style={profileStyles.shelfTitle}>
                {s.title}
              </Text>
            </View>
            <AudienceBadge audience={s.audience.kind} />
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 2 }}
          >
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

const profileStyles = {
  viewerNote: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 16,
    borderRadius: 15,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  editButton: {
    alignSelf: "flex-start" as const,
    marginBottom: 22,
    borderRadius: 15,
    borderColor: colors.coral,
  },
  shelf: {
    marginBottom: 18,
    padding: 15,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: colors.outline,
    backgroundColor: colors.surface,
  },
  shelfHeading: { marginBottom: 14, alignItems: "flex-end" as const },
  shelfEyebrow: {
    color: colors.lime,
    fontSize: 9,
    fontWeight: "900" as const,
    letterSpacing: 1.6,
    marginBottom: 3,
  },
  shelfTitle: { flex: 1, fontFamily: "Fraunces", fontWeight: "800" as const, color: colors.pearl },
};
