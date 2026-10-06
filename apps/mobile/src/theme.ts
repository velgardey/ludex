import {
  MD3DarkTheme,
  configureFonts,
  type MD3TypescaleKey,
} from "react-native-paper";

export const colors = {
  ink: "#160D20",
  surface: "#29182F",
  raised: "#35233B",
  pearl: "#F3DFFF",
  coral: "#FF735F",
  lime: "#D8FF76",
  orchid: "#CDB5DF",
  muted: "#C7B5D0",
  outline: "#604B68",
  error: "#FF9B91",
  violet: "#FF735F",
  copper: "#D8FF76",
};

export const fontFaces = {
  regular: "LudexSoraRegular",
  medium: "LudexSoraMedium",
  semibold: "LudexSoraSemiBold",
  bold: "LudexSoraBold",
  extraBold: "LudexSoraExtraBold",
} as const;

export type FontWeight = keyof typeof fontFaces;

export const font = Object.fromEntries(
  Object.entries(fontFaces).map(([weight, fontFamily]) => [
    weight,
    { fontFamily, fontWeight: "normal" as const },
  ]),
) as Record<FontWeight, { fontFamily: string; fontWeight: "normal" }>;

const paperWeight: Record<MD3TypescaleKey, FontWeight> = {
  displayLarge: "extraBold",
  displayMedium: "extraBold",
  displaySmall: "bold",
  headlineLarge: "bold",
  headlineMedium: "bold",
  headlineSmall: "semibold",
  titleLarge: "semibold",
  titleMedium: "semibold",
  titleSmall: "medium",
  labelLarge: "semibold",
  labelMedium: "medium",
  labelSmall: "medium",
  bodyLarge: "regular",
  bodyMedium: "regular",
  bodySmall: "regular",
};

const paperFontConfig = Object.fromEntries(
  Object.entries(paperWeight).map(([role, weight]) => [role, font[weight]]),
) as Partial<
  Record<MD3TypescaleKey, { fontFamily: string; fontWeight: "normal" }>
>;

const paperFonts = configureFonts({ config: paperFontConfig });
paperFonts.default = { ...paperFonts.default, ...font.regular };

export const type = {
  display: { ...font.extraBold, color: colors.pearl },
  heading: { ...font.bold },
  title: { ...font.semibold },
  control: { ...font.medium },
  body: { ...font.regular },
  metadata: { ...font.medium },
};

export const theme = {
  ...MD3DarkTheme,
  roundness: 6,
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
  fonts: paperFonts,
};

export const display = type.display;

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
