import React from "react";
import { View } from "react-native";
import { ActivityIndicator } from "react-native-paper";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PaperProvider, Snackbar } from "react-native-paper";
import { LudexProvider, useLudex } from "../state";
import { colors, fontFaces, theme } from "../theme";
function Routes() {
  const { notice, setNotice, reducedMotion } = useLudex();
  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.ink },
          headerTintColor: colors.pearl,
          headerTitleStyle: {
            fontFamily: fontFaces.semibold,
            fontWeight: "normal",
          },
          contentStyle: { backgroundColor: colors.ink },
          animation: reducedMotion ? "none" : "default",
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="log"
          options={{
            title: "Log an experience",
            presentation: "formSheet",
            sheetAllowedDetents: [0.9, 1],
            sheetCornerRadius: 24,
          }}
        />
        <Stack.Screen name="title" options={{ title: "Title" }} />
        <Stack.Screen name="review" options={{ title: "Write a review" }} />
        <Stack.Screen name="activity" options={{ title: "Conversation" }} />
        <Stack.Screen name="profile" options={{ title: "Showcase" }} />
        <Stack.Screen
          name="showcase-edit"
          options={{ title: "Edit showcase" }}
        />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="connections" options={{ title: "Connections & imports" }} />
        <Stack.Screen name="plans" options={{ title: "Shared plans" }} />
        <Stack.Screen name="moderation" options={{ title: "Moderation" }} />
        <Stack.Screen name="auth" options={{ title: "Your Ludex journal" }} />
        <Stack.Screen
          name="companion"
          options={{ title: "Companion", presentation: "formSheet" }}
        />
        <Stack.Screen
          name="collection-edit"
          options={{ title: "New collection" }}
        />
        <Stack.Screen name="collection" options={{ title: "Collection" }} />
      </Stack>
      <Snackbar
        visible={!!notice}
        onDismiss={() => setNotice(null)}
        duration={5000}
        style={{ bottom: 76 }}
        action={{ label: "Dismiss", onPress: () => setNotice(null) }}
      >
        {notice}
      </Snackbar>
    </>
  );
}
function MotionTheme({ children }: { children: React.ReactNode }) {
  const { reducedMotion } = useLudex();
  return (
    <PaperProvider
      theme={{
        ...theme,
        animation: {
          scale: reducedMotion ? 0 : 1,
        },
      }}
    >
      {children}
    </PaperProvider>
  );
}
export default function RootLayout() {
  const [fontsReady, fontError] = useFonts({
    LudexSoraRegular: require("../../assets/fonts/Sora-Regular.ttf"),
    LudexSoraMedium: require("../../assets/fonts/Sora-Medium.ttf"),
    LudexSoraSemiBold: require("../../assets/fonts/Sora-SemiBold.ttf"),
    LudexSoraBold: require("../../assets/fonts/Sora-Bold.ttf"),
    LudexSoraExtraBold: require("../../assets/fonts/Sora-ExtraBold.ttf"),
  });
  if (!fontsReady && !fontError)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.ink,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator color={colors.violet} />
      </View>
    );
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LudexProvider>
          <MotionTheme>
            <StatusBar style="light" />
            <Routes />
          </MotionTheme>
        </LudexProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
