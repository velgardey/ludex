import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { PaperProvider } from "react-native-paper";
import type { CatalogHit, Session } from "@ludex/domain";
import type { ImportPreview } from "../../../packages/client/src/connections.ts";
import { useLudex } from "../src/state";
import ConnectionsScreen from "../src/app/connections";

jest.mock("../src/state", () => ({ useLudex: jest.fn() }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("../src/ui", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    Page: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Heading: () => null,
  };
});

const session: Session = {
  token: "test-session-token",
  expiresAt: "2030-01-01T00:00:00.000Z",
  user: { id: "viewer-1", displayName: "Viewer", roles: ["user"] },
};

const inception: CatalogHit = {
  id: "tmdb:movie:27205",
  title: "Inception",
  media: "movie",
  year: 2010,
  providerIds: { tmdb: "27205" },
};

function configureState(request: jest.Mock, catalog: CatalogHit[] = []) {
  jest.mocked(useLudex).mockReturnValue({
    client: { request },
    ready: true,
    session,
    setNotice: jest.fn(),
    catalog,
  } as unknown as ReturnType<typeof useLudex>);
}

function renderScreen() {
  return render(<PaperProvider><ConnectionsScreen /></PaperProvider>);
}

it("pages and filters a large preview, then maps a row beyond the first page", async () => {
  const rows: ImportPreview["rows"] = Array.from({ length: 101 }, (_, index) => ({
    id: `row-${index + 1}`,
    title: index === 100 ? "Unmapped Inception" : "Inception",
    media: "movie",
    year: 2010,
    status: index < 50 ? "matched" : "needs-match",
    ...(index < 50 ? { matchedTitleId: inception.id } : {}),
  }));
  const preview: ImportPreview = { id: "batch-101", source: "csv", status: "preview", rows };
  const request = jest.fn(async (path: string) => {
    if (path === "/connections") return { connections: [], capabilities: { csv: true } };
    if (path === "/connections/observations" || path === "/imports") return [];
    if (path === "/imports/preview") return preview;
    if (path.startsWith("/catalog/search?")) return [inception];
    if (path === `/imports/${preview.id}/rows/row-101/match`) {
      return { id: "row-101", status: "matched", matchedTitleId: inception.id };
    }
    throw new Error(`Unexpected request ${path}`);
  });
  configureState(request);
  const screen = renderScreen();
  await waitFor(() => expect(screen.getByText("Captures to review")).toBeTruthy());

  fireEvent.changeText(screen.getByPlaceholderText(/Moonrise Kingdom/), "title,media\nInception,movie");
  fireEvent.press(screen.getByText("Preview matches"));

  await waitFor(() => expect(screen.getByText("Showing 1–100 of 101 · 1 more on later pages")).toBeTruthy());
  expect(screen.getAllByLabelText("Find a real Ludex catalog title")).toHaveLength(100);
  fireEvent.press(screen.getByRole("button", { name: /Needs review/ }));
  await waitFor(() => expect(screen.getByText("Showing 1–51 of 51")).toBeTruthy());
  expect(screen.getAllByLabelText("Find a real Ludex catalog title")).toHaveLength(51);

  fireEvent.press(screen.getByRole("button", { name: /All/ }));
  await waitFor(() => expect(screen.getAllByLabelText("Find a real Ludex catalog title")).toHaveLength(100));
  fireEvent.press(screen.getByText("Next 100"));
  await waitFor(() => expect(screen.getByText("Showing 101–101 of 101")).toBeTruthy());
  expect(screen.getAllByLabelText("Find a real Ludex catalog title")).toHaveLength(1);

  fireEvent.changeText(screen.getByLabelText("Find a real Ludex catalog title"), "Inception");
  await waitFor(() => expect(screen.getByText("Inception · 2010")).toBeTruthy());
  fireEvent.press(screen.getByRole("radio", { name: /Inception/ }));
  fireEvent.press(screen.getByText("Save row match"));

  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/imports/${preview.id}/rows/row-101/match`,
    { titleId: inception.id },
  ));
  expect(screen.getByText("Matched: Inception")).toBeTruthy();
});

it("requires a real catalog episode before matching a completed show row", async () => {
  const show: CatalogHit = {
    id: "tmdb:show:42",
    title: "Example Show",
    media: "show",
    providerIds: { tmdb: "42" },
    episodes: [{ id: "tmdb:episode:42:1", order: 1, releasedAt: null, title: "Pilot" }],
  };
  const preview: ImportPreview = {
    id: "batch-show",
    source: "csv",
    status: "preview",
    rows: [{
      id: "row-show",
      title: "Example Show",
      media: "show",
      status: "needs-episode",
      state: "completed",
      episodeTitle: "Pilot",
      matchedTitleId: show.id,
    }],
  };
  const request = jest.fn(async (path: string) => {
    if (path === "/connections") return { connections: [], capabilities: { csv: true } };
    if (path === "/connections/observations" || path === "/imports") return [];
    if (path === "/imports/preview") return preview;
    if (path === `/imports/${preview.id}/rows/row-show/match`) {
      return { id: "row-show", status: "matched", matchedTitleId: show.id, episodeId: "tmdb:episode:42:1" };
    }
    throw new Error(`Unexpected request ${path}`);
  });
  configureState(request, [show]);
  const screen = renderScreen();
  await waitFor(() => expect(screen.getByText("Captures to review")).toBeTruthy());

  fireEvent.changeText(screen.getByPlaceholderText(/Moonrise Kingdom/), "title,media,state\nExample Show,show,completed");
  fireEvent.press(screen.getByText("Preview matches"));
  await waitFor(() => expect(screen.getByText("Episode needed")).toBeTruthy());

  fireEvent.press(screen.getByText("Save row match"));
  expect(request).not.toHaveBeenCalledWith(`/imports/${preview.id}/rows/row-show/match`, expect.anything());
  fireEvent.press(screen.getByRole("radio", { name: /Pilot/ }));
  fireEvent.press(screen.getByText("Save row match"));

  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/imports/${preview.id}/rows/row-show/match`,
    { titleId: show.id, episodeId: "tmdb:episode:42:1" },
  ));
});

it("clears a previously selected episode when the row is remapped to another show", async () => {
  const firstEpisode = { id: "tmdb:episode:42:1", order: 1, releasedAt: null, title: "Old Pilot" };
  const nextEpisode = { id: "tmdb:episode:43:1", order: 1, releasedAt: null, title: "New Pilot" };
  const firstShow: CatalogHit = {
    id: "tmdb:show:42",
    title: "Example Show",
    media: "show",
    providerIds: { tmdb: "42" },
    episodes: [firstEpisode],
  };
  const nextShow: CatalogHit = {
    id: "tmdb:show:43",
    title: "Other Show",
    media: "show",
    providerIds: { tmdb: "43" },
    episodes: [nextEpisode],
  };
  const preview: ImportPreview = {
    id: "batch-remap",
    source: "csv",
    status: "preview",
    rows: [{
      id: "row-remap",
      title: "Example Show",
      media: "show",
      status: "matched",
      state: "completed",
      episodeTitle: "Old Pilot",
      episodeId: firstEpisode.id,
      matchedTitleId: firstShow.id,
    }],
  };
  const request = jest.fn(async (path: string) => {
    if (path === "/connections") return { connections: [], capabilities: { csv: true } };
    if (path === "/connections/observations" || path === "/imports") return [];
    if (path === "/imports/preview") return preview;
    if (path.startsWith("/catalog/search?")) return [firstShow, nextShow];
    if (path === `/imports/${preview.id}/rows/row-remap/match`) {
      return { id: "row-remap", status: "matched", matchedTitleId: nextShow.id, episodeId: nextEpisode.id };
    }
    throw new Error(`Unexpected request ${path}`);
  });
  configureState(request, [firstShow, nextShow]);
  const screen = renderScreen();

  await waitFor(() => expect(screen.getByText("Captures to review")).toBeTruthy());
  fireEvent.changeText(screen.getByPlaceholderText(/Moonrise Kingdom/), "title,media,state\nExample Show,show,completed");
  fireEvent.press(screen.getByText("Preview matches"));
  await waitFor(() => expect(screen.getByText("Matched: Example Show")).toBeTruthy());

  fireEvent(screen.getByLabelText("Find a real Ludex catalog title"), "focus");
  fireEvent.press(await screen.findByRole("radio", { name: /Other Show/ }));
  fireEvent.press(screen.getByText("Update match"));
  expect(request).not.toHaveBeenCalledWith(`/imports/${preview.id}/rows/row-remap/match`, expect.anything());

  fireEvent.press(screen.getByRole("radio", { name: /New Pilot/ }));
  fireEvent.press(screen.getByText("Update match"));
  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/imports/${preview.id}/rows/row-remap/match`,
    { titleId: nextShow.id, episodeId: nextEpisode.id },
  ));
});
