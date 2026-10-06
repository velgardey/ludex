import type { ExpoConfig } from "expo/config";
const config: ExpoConfig = {
  name: "Ludex",
  slug: "ludex",
  icon: "./assets/images/icon.png",
  version: "0.1.0",
  scheme: "ludex",
  userInterfaceStyle: "dark",
  backgroundColor: "#15121C",
  android: {
    package: "com.ludex.app",
    predictiveBackGestureEnabled: true,
    adaptiveIcon: {
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundColor: "#15121C",
    },
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: false,
        data: [{ scheme: "ludex" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  plugins: [
    "expo-router",
    "./plugins/local-http.cjs",
    "expo-secure-store",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#15121C",
        image: "./assets/images/android-icon-foreground.png",
        imageWidth: 96,
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    stage: "A",
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:4000/api",
  },
};
export default config;
