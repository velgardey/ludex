import React from "react";
import { render } from "@testing-library/react-native";
import { PaperProvider } from "react-native-paper";
import { useLudex } from "../src/state";
import Feed from "../src/app/(tabs)/index";

jest.mock("../src/state", () => ({ useLudex: jest.fn() }));
jest.mock("../src/ui", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    Page: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Empty: () => null,
    LogButton: () => null,
    MediaFilters: () => null,
    CinematicHeader: () => null,
  };
});

test("sample feed does not keep its onboarding action after preview loads", () => {
  jest.mocked(useLudex).mockReturnValue({
    session: null,
    preview: { feed: { items: [] }, users: [] },
    feed: { items: [] },
    error: null,
    newFeed: false,
    acceptFeed: jest.fn(),
    refresh: jest.fn(),
    loadPreview: jest.fn(),
    setNotice: jest.fn(),
  } as unknown as ReturnType<typeof useLudex>);

  const screen = render(
    <PaperProvider>
      <Feed />
    </PaperProvider>,
  );

  expect(screen.queryByText("Explore the sample feed")).toBeNull();
});
