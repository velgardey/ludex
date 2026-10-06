import { NativeTabs } from "expo-router/unstable-native-tabs";
import { colors, fontFaces } from "../../theme";
export default function Tabs() {
  return (
    <NativeTabs
      backgroundColor={colors.ink}
      tintColor={colors.coral}
      indicatorColor={colors.surface}
      labelStyle={{
        fontFamily: fontFaces.medium,
        fontWeight: "normal",
        color: colors.muted,
        selected: { color: colors.pearl },
      }}
    >
      {[
        ["index", "Feed", "dynamic_feed"],
        ["library", "Library", "video_library"],
        ["discover", "Discover", "explore"],
        ["profile", "Profile", "person"],
      ].map(([name, label, icon]) => (
        <NativeTabs.Trigger key={name} name={name} disablePopToTop>
          <NativeTabs.Trigger.Label>{label}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon md={icon as "home"} />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
