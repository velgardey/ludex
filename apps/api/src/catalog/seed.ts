import type {
  CatalogHit,
  Preview,
  User,
  Showcase,
  Activity,
} from "../../../../packages/domain/src/types.ts";
export const catalog: CatalogHit[] = [
  {
    id: "b460f5f2-7c36-4ef9-94df-6314b6500001",
    media: "movie",
    title: "Dune: Part Two",
    year: 2024,
    providerIds: { "tmdb:movie": "693134" },
    artwork: "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
    synopsis:
      "Paul Atreides joins the Fremen while facing a choice between love and the fate of the universe.",
    genres: ["Science fiction", "Adventure"],
    sample: true,
    artworkAttribution:
      "TMDB artwork; provider approval required before production use.",
  },
  {
    id: "b460f5f2-7c36-4ef9-94df-6314b6500002",
    media: "show",
    title: "Severance",
    year: 2022,
    providerIds: { "tmdb:tv": "95396" },
    artwork: "https://media.themoviedb.org/t/p/w440_and_h660_face/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg",
    backdrop:
      "https://image.tmdb.org/t/p/w1280/ixgFmf1X59PUZam2qbAfskx2gQr.jpg",
    synopsis:
      "Office workers discover the cost of separating their work and personal memories.",
    genres: ["Drama", "Mystery"],
    ended: false,
    sample: true,
    episodes: Array.from({ length: 9 }, (_, i) => ({
      id: `e56ece56-228c-46bc-b600-${String(i + 1).padStart(12, "0")}`,
      order: i + 1,
      season: 1,
      number: i + 1,
      title: `Episode ${i + 1}`,
      releasedAt: `2022-03-${String(i + 1).padStart(2, "0")}`,
    })),
  },
  {
    id: "b460f5f2-7c36-4ef9-94df-6314b6500003",
    media: "game",
    title: "Disco Elysium",
    year: 2019,
    providerIds: { "steam:app": "632470" },
    artwork:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/632470/library_600x900_2x.jpg",
    synopsis:
      "A detective with a fractured memory investigates a murder in a city full of contradictions.",
    genres: ["Role-playing", "Narrative"],
    platform: "PC",
    backdrop: "https://cdn.akamai.steamstatic.com/steam/apps/632470/library_hero.jpg",
    sample: true,
  },
  {
    id: "b460f5f2-7c36-4ef9-94df-6314b6500004",
    media: "movie",
    title: "Past Lives",
    backdrop: "https://image.tmdb.org/t/p/w780/7HR38hMBl23lf38MAN63y4pKsHz.jpg",
    year: 2023,
    providerIds: { "tmdb:movie": "666277" },
    artwork: "https://media.themoviedb.org/t/p/w440_and_h660_face/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg",
    genres: ["Drama", "Romance"],
    synopsis:
      "Two childhood friends reconnect across continents and consider the lives they might have led.",
    sample: true,
  },
  {
    id: "b460f5f2-7c36-4ef9-94df-6314b6500005",
    media: "game",
    title: "Hades",
    year: 2020,
    providerIds: { "steam:app": "1145360" },
    artwork:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/library_600x900_2x.jpg",
    platform: "PC",
    backdrop:
      "https://cdn.akamai.steamstatic.com/steam/apps/1145360/header.jpg",
    genres: ["Action", "Roguelike"],
    synopsis:
      "Fight through the underworld as the son of Hades, one attempt at a time.",
    sample: true,
  },
  {
    id: "b460f5f2-7c36-4ef9-94df-6314b6500006",
    media: "show",
    title: "The Bear",
    year: 2022,
    providerIds: { "tmdb:tv": "136315" },
    artwork: "https://image.tmdb.org/t/p/w500/sHFlbKS3WLqMnp9t2ghADIJFnuQ.jpg",
    ended: false,
    genres: ["Drama", "Comedy"],
    synopsis:
      "A young chef returns to Chicago to run his family sandwich shop.",
    sample: true,
    episodes: Array.from({ length: 8 }, (_, i) => ({
      id: `e56ece56-228c-46bc-b601-${String(i + 1).padStart(12, "0")}`,
      order: i + 1,
      season: 1,
      number: i + 1,
      releasedAt: "2022-06-23",
    })),
  },
  {
    id: "b460f5f2-7c36-4ef9-94df-6314b6500007",
    media: "game",
    title: "The Legend of Zelda: Ocarina of Time",
    year: 1998,
    providerIds: { "manual:edition": "n64-original" },
    platform: "Nintendo 64",
    genres: ["Adventure"],
    synopsis:
      "An adventure through Hyrule across two eras. Device and emulator are tracked separately from the original release.",
    sample: true,
  },
  {
    id: "b460f5f2-7c36-4ef9-94df-6314b6500008",
    media: "movie",
    title: "Everything Everywhere All at Once",
    year: 2022,
    providerIds: { "tmdb:movie": "545611" },
    artwork: "https://image.tmdb.org/t/p/w500/w3LxiVYdWWRvEVdn5RYq6jIqkb1.jpg",
    genres: ["Science fiction", "Comedy"],
    synopsis:
      "A family struggles to reconnect while their lives unfold across possible universes.",
    sample: true,
  },
];
export const sampleUsers: User[] = [
  {
    id: "b460f5f2-7c36-4ef9-94df-6314b6500101",
    displayName: "Mara Chen",
    roles: ["user"],
    sample: true,
    bio: "Films for the big screen. Games for long nights.",
  },
  {
    id: "b460f5f2-7c36-4ef9-94df-6314b6500102",
    displayName: "Theo Park",
    roles: ["user"],
    sample: true,
    bio: "One more episode. One more run.",
  },
];
export const sampleShowcase: Showcase = {
  userId: sampleUsers[0].id,
  version: 1,
  theme: "lounge",
  featuredTitleId: catalog[2].id,
  shelves: [
    {
      id: "b460f5f2-7c36-4ef9-94df-6314b6500201",
      title: "Still thinking about these",
      layout: "covers",
      itemIds: [
        catalog[2].id,
        catalog[3].id,
        catalog[0].id,
        catalog[1].id,
        catalog[4].id,
        catalog[7].id,
      ],
      audience: { kind: "public" },
    },
    {
      id: "b460f5f2-7c36-4ef9-94df-6314b6500202",
      title: "For another evening",
      layout: "spread",
      itemIds: [catalog[4].id, catalog[7].id, catalog[6].id],
      audience: { kind: "public" },
    },
  ],
};
const notes = [
  "The silence after the credits stayed with me.",
  "A city I keep returning to, even when I know where the story ends.",
  "Watched the first episode together. Already comparing theories.",
];
export const sampleActivities: Activity[] = [
  catalog[3],
  catalog[2],
  catalog[1],
].map((title, i) => ({
  id: `b460f5f2-7c36-4ef9-94df-6314b65003${String(i + 1).padStart(2, "0")}`,
  authorId: sampleUsers[i % 2].id,
  author: sampleUsers[i % 2],
  titleId: title.id,
  title,
  caption:
    i === 0
      ? "Watched a film"
      : i === 1
        ? "Logged a game session"
        : "Watched an episode",
  note: notes[i],
  detailHidden: false,
  occurredAt: { precision: "day", day: "2026-10-06" },
  publishedAt: `2026-10-06T${String(14 - i).padStart(2, "0")}:00:00Z`,
  audience: { kind: "public" },
  spoiler: { kind: "none" },
  kind: "progress",
  likedByViewer: false,
  reactionCount: [12, 8, 4][i],
  replyCount: [3, 2, 1][i],
  rating: i === 0 ? 9 : undefined,
  sample: true,
}));
sampleActivities.push({
  id: "b460f5f2-7c36-4ef9-94df-6314b6500304",
  authorId: sampleUsers[1].id,
  author: sampleUsers[1],
  titleId: "hidden",
  title: { id: "hidden", media: "game", title: "Hidden game", providerIds: {} },
  caption: "Shared a game milestone",
  detailHidden: true,
  occurredAt: { precision: "day", day: "2026-10-05" },
  publishedAt: "2026-10-05T20:00:00Z",
  audience: { kind: "public" },
  spoiler: { kind: "hidden", titleId: "hidden" },
  kind: "progress",
  likedByViewer: false,
  reactionCount: 3,
  replyCount: 0,
  sample: true,
});
export function preview(): Preview {
  return {
    sample: true,
    label:
      "Sample lounge — invented people and activity. Your account starts empty.",
    catalog,
    feed: { items: sampleActivities, etag: "sample-v1" },
    showcase: sampleShowcase,
    users: sampleUsers,
  };
}
