import React, { useState } from "react";
import { ScrollView } from "react-native";
import { router } from "expo-router";
import {
  Button,
  HelperText,
  Text,
  TextInput,
  SegmentedButtons,
} from "react-native-paper";
import { useLudex } from "../state";
import { Heading, styles } from "../ui";
export default function Auth() {
  const { login, signup } = useLudex();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("LUDEX-LOCAL-BETA");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (mode === "login") await login(email, password);
      else await signup(email, password, name, invite);
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, { paddingTop: 32 }]}
    >
      <Heading
        eyebrow="Your own corner of the lounge"
        title="Remember what moves you."
      />
      <Text variant="bodyLarge" style={{ marginBottom: 24 }}>
        A private journal first. Share an experience when you choose.
      </Text>
      <SegmentedButtons
        value={mode}
        onValueChange={setMode}
        buttons={[
          { value: "login", label: "Sign in" },
          { value: "signup", label: "Join invited beta" },
        ]}
        style={{ marginBottom: 24 }}
      />
      {mode === "signup" ? (
        <>
          <TextInput
            label="Display name"
            value={name}
            onChangeText={setName}
            style={styles.input}
          />
          <TextInput
            label="Invitation code"
            value={invite}
            onChangeText={setInvite}
            autoCapitalize="none"
            style={styles.input}
          />
        </>
      ) : null}
      <TextInput
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        style={styles.input}
      />
      <TextInput
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        style={styles.input}
      />
      <HelperText type="error" visible={!!error}>
        {error}
      </HelperText>
      <Button mode="contained" loading={busy} disabled={busy} onPress={submit}>
        {mode === "login" ? "Sign in" : "Create journal"}
      </Button>
      <Text style={[styles.metadata, { marginTop: 24 }]}>
        Local beta identity runs on the configured API. Production
        system-browser OIDC remains a deployment gate.
      </Text>
    </ScrollView>
  );
}
