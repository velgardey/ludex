import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Searchbar, Text } from "react-native-paper";
import type { CatalogHit } from "@ludex/domain";
import { useLudex } from "../state";
import { Cover, Empty, styles } from "../ui";
import { LogForm, type Draft } from "../features/log/LogForm";
export default function Log() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { catalog, library, session, queue, store, client } = useLudex();
  const [selected, setSelected] = useState<CatalogHit | undefined>(() =>
    catalog.find((t) => t.id === id),
  );
  const [draft, setDraft] = useState<Partial<Draft>>();
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (id && !selected)
      client
        .getTitle(id)
        .then(setSelected)
        .catch(() => {});
  }, [id]);
  useEffect(() => {
    if (!selected) {
      setLoaded(false);
      return;
    }
    setLoaded(false);
    if (store) {
      store.draft<Draft>("log:" + selected.id).then((d) => {
        setDraft(d ?? {});
        setLoaded(true);
      });
    } else {
      setLoaded(true);
    }
  }, [selected?.id, store]);
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingTop: 24, paddingBottom: 40 },
      ]}
    >
      {!session ? (
        <Empty
          title="Keep your own journal"
          text="Sign in to save a durable draft and log films, episodes or games. Sample activity is a preview."
          label="Sign in"
          action={() => router.push("/auth")}
        />
      ) : selected && loaded ? (
        <>
          <LogForm
            key={selected.id}
            title={selected}
            item={library.find((i) => i.titleId === selected.id)}
            draft={draft}
            onDraft={(d) => {
              void store?.saveDraft("log:" + selected.id, d);
            }}
            onSave={async (command) => {
              await queue("progress", command);
              router.back();
            }}
          />
          <Button
            onPress={() => setSelected(undefined)}
            style={{ marginTop: 20 }}
          >
            Choose another title
          </Button>
        </>
      ) : (
        <>
          <Text
            variant="headlineMedium"
            style={{ fontFamily: "Fraunces", marginBottom: 20 }}
          >
            What stayed with you?
          </Text>
          <Searchbar
            placeholder="Find a film, show or game"
            value={query}
            onChangeText={setQuery}
          />
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 16,
              marginTop: 24,
            }}
          >
            {catalog
              .filter((t) =>
                t.title.toLowerCase().includes(query.toLowerCase()),
              )
              .map((t) => (
                <View key={t.id} style={{ width: 135 }}>
                  <Cover title={t} width={135} />
                  <Button
                    onPress={() => setSelected(t)}
                    mode="outlined"
                    style={{ marginTop: 10 }}
                  >
                    Log {t.media === "show" ? "episode" : t.media}
                  </Button>
                </View>
              ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}
