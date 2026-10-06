import React from "react";
import { ScrollView } from "react-native";
import { router } from "expo-router";
import { Button, Text } from "react-native-paper";
import { Heading, styles } from "../ui";
export default function Companion() {
  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: 28 }]}>
      <Heading
        eyebrow="Companion · coming in Stage C"
        title="A little help choosing."
      />
      <Text variant="bodyLarge" style={{ lineHeight: 27, marginBottom: 24 }}>
        Contextual conversations will connect your permitted journal and shared
        plans after the cloud allowance and privacy gates are verified. Cloud
        replies are unavailable in this build.
      </Text>
      <Text style={styles.metadata}>
        No message or memory is sent from this screen.
      </Text>
      <Button
        mode="contained"
        onPress={() => router.replace("/discover")}
        style={{ marginTop: 24 }}
      >
        Search titles now
      </Button>
      <Button onPress={() => router.replace("/log")}>Make a manual log</Button>
    </ScrollView>
  );
}
