import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { PaperProvider } from "react-native-paper";
import { LogForm } from "../src/features/log/LogForm";
const title = {
  id: "film",
  title: "Film",
  media: "movie" as const,
  providerIds: {},
};
it("shows private sharing and submits an unrated quick movie log only once", async () => {
  const saves: unknown[] = [];
  const screen = render(
    <PaperProvider>
      <LogForm
        title={title}
        onSave={async (c) => {
          saves.push(c);
        }}
      />
    </PaperProvider>,
  );
  expect(screen.getByText("Private journal")).toBeTruthy();
  fireEvent.press(screen.getByText("Save log"));
  fireEvent.press(screen.getByText("Save log"));
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0]).toMatchObject({
    audience: { kind: "private" },
    change: { kind: "movie-viewed" },
  });
});
it("invalid rating remains in the form and reports a readable error", async () => {
  const screen = render(
    <PaperProvider>
      <LogForm
        title={title}
        onSave={async () => {
          throw new Error("must not send");
        }}
      />
    </PaperProvider>,
  );
  fireEvent.changeText(screen.getByLabelText("Rating (optional, 1–10)"), "11");
  fireEvent.press(screen.getByText("Save log"));
  await waitFor(() =>
    expect(
      screen.getByText("Rating must be a whole number from 1 to 10."),
    ).toBeTruthy(),
  );
});
