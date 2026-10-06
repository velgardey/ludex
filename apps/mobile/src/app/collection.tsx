import React, { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Text } from "react-native-paper";
import type { Collection } from "@ludex/domain";
import { useLudex } from "../state";
import { Cover, Heading, styles } from "../ui";
export default function CollectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client, catalog, setNotice } = useLudex();
  const [value, setValue] = useState<Collection | null>(null);
  useEffect(() => {
    client
      .readCollection(id)
      .then(setValue)
      .catch((e) => setNotice(String(e)));
  }, [id]);
  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: 24 }]}>
      {value ? (
        <>
          <Heading
            context={`Collection · ${value.audience.kind}`}
            title={value.title}
          />
          {value.description ? <Text>{value.description}</Text> : null}
          {value.titleIds
            .map((id) => catalog.find((t) => t.id === id))
            .map((t, i) =>
              t ? (
                <Cover key={t.id} title={t} width={160} />
              ) : (
                <Text key={i}>Title unavailable</Text>
              ),
            )}
        </>
      ) : (
        <Text>Collection unavailable to this viewer.</Text>
      )}
    </ScrollView>
  );
}
