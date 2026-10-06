import { MD3DarkTheme, configureFonts } from "react-native-paper";
export const colors = {
  ink: "#15121C",
  surface: "#272334",
  pearl: "#E8E4DF",
  violet: "#B6A3CF",
  copper: "#C89571",
  muted: "#AAA3B3",
  outline: "#514A5D",
  error: "#FFB4AB",
};
export const theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: colors.violet,
    onPrimary: colors.ink,
    secondary: colors.copper,
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
