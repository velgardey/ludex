import { theme } from "../src/theme";

test("every Paper text role uses a registered Sora face without synthetic weight", () => {
  const registeredFaces = new Set([
    "LudexSoraRegular",
    "LudexSoraMedium",
    "LudexSoraSemiBold",
    "LudexSoraBold",
    "LudexSoraExtraBold",
  ]);

  for (const [role, style] of Object.entries(theme.fonts)) {
    expect(registeredFaces.has(style.fontFamily)).toBe(true);
    expect(style.fontWeight).toBe("normal");
    expect(role).toBeTruthy();
  }
});
