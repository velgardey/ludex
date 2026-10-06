import { MD3DarkTheme, configureFonts } from "react-native-paper";
export const colors = {
  ink: "#160D20",
  surface: "#29182F",
  pearl: "#F3DFFF",
  coral: "#FF735F",
  lime: "#D8FF76",
  orchid: "#CDB5DF",
  muted: "#BFAFCB",
  outline: "#604B68",
  error: "#FF9B91",
  // Keep the existing semantic names available to the app while the palette changes.
  violet: "#FF735F",
  copper: "#D8FF76",
};
export const theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: colors.coral,
    onPrimary: colors.ink,
    secondary: colors.lime,
    onSecondary: colors.ink,
    background: colors.ink,
    surface: colors.ink,
    surfaceVariant: colors.surface,
    onSurface: colors.pearl,
    onSurfaceVariant: colors.muted,
    outline: colors.outline,
    error: colors.error,
  },
  fonts: configureFonts({ config: { fontFamily: "SourceSans3" } }),
};
export const display = { fontFamily: "Fraunces", color: colors.pearl };

export function mediaAccent(media: string) {
  switch (media) {
    case "movie":
      return colors.coral;
    case "show":
      return colors.lime;
    case "game":
      return colors.orchid;
    default:
      return colors.muted;
  }
}
