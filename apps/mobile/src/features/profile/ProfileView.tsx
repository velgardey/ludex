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
import { colors, font, type } from "../../theme";
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
          <Text style={[styles.metadata, { textAlign: "center" }]}>
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
          <View style={profileStyles.shelfHeading}>
            <View style={profileStyles.shelfTitleBlock}>
              <Text variant="titleLarge" style={profileStyles.shelfTitle}>
                {s.title}
              </Text>
              <Text style={profileStyles.shelfType}>
                {s.layout === "spread" ? "An ordered journey" : "In the rotation"}
              </Text>
            </View>
            <View style={profileStyles.audienceMeta}>
              <AudienceBadge audience={s.audience.kind} />
            </View>
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
                <Cover key={t.id} title={t} width={108} />
                ),
              )}
          </ScrollView>
        </View>
      ))}
      {!shelves.length ? (
        <Text style={[styles.metadata, { textAlign: "center", marginTop: 18 }]}>
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
    borderRadius: 5,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  editButton: {
    alignSelf: "center" as const,
    marginBottom: 22,
    borderRadius: 6,
    borderColor: colors.coral,
  },
  shelf: {
    marginBottom: 4,
    paddingTop: 18,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderColor: colors.outline,
    backgroundColor: "transparent",
  },
  shelfHeading: { marginBottom: 12, alignItems: "center" as const },
  shelfTitleBlock: { width: "100%" as const, alignItems: "center" as const },
  audienceMeta: { alignSelf: "center" as const, marginTop: 7 },
  shelfType: { ...type.metadata, color: colors.lime, fontSize: 10, marginTop: 4 },
  shelfTitle: {
    ...font.semibold,
    color: colors.pearl,
    textAlign: "center" as const,
    fontSize: 20,
  },
};
