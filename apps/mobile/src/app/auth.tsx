import React, { useEffect, useState } from "react";
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
  const { login, signup, googleLogin, client } = useLudex();
  const [config, setConfig] = useState<{
    googleEnabled: boolean;
    localEnabled: boolean;
  } | null>(null);
  useEffect(() => {
    let active = true;
    client
      .request<{ googleEnabled: boolean; localEnabled: boolean }>(
        "/auth/config",
      )
      .then((v) => {
        if (active) setConfig(v);
      })
      .catch(() => {
        if (active) setError("Sign-in settings could not load. Try again.");
      });
    return () => {
      active = false;
    };
  }, [client]);
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
        context="For every story you want to keep."
        title="Remember what moves you."
      />
      <Text variant="bodyLarge" style={{ marginBottom: 24 }}>
        A private journal first. Share an experience when you choose.
      </Text>
      <TextInput
        label="Invitation code (new accounts)"
        value={invite}
        onChangeText={setInvite}
        autoCapitalize="none"
        style={styles.input}
      />
      <Button
        icon="google"
        mode="contained"
        disabled={busy || !config?.googleEnabled}
        loading={busy}
        onPress={async () => {
          setBusy(true);
          setError("");
          try {
            await googleLogin(invite);
            router.replace("/");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Google sign-in failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        Continue with Google
      </Button>
      {config?.localEnabled ? (
        <>
          <Text style={[styles.metadata, { marginVertical: 20 }]}>
            Development account access
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
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            style={styles.input}
          />
        </>
      ) : null}
      <HelperText type="error" visible={!!error}>
        {error}
      </HelperText>
      {config?.localEnabled ? (
        <Button mode="outlined" loading={busy} disabled={busy} onPress={submit}>
          {mode === "login" ? "Sign in locally" : "Create local journal"}
        </Button>
      ) : null}
      <Text style={[styles.metadata, { marginTop: 24 }]}>
        Google opens in your system browser. Your Ludex session is stored
        securely on this device. New accounts require an invitation.
      </Text>
    </ScrollView>
  );
}
