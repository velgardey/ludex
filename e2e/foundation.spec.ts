import { test, expect } from "@playwright/test";
const api = "http://localhost:4000/api";
test("real journal collections, review drafts, public social flow and persistent showcase", async ({
  browser,
  request,
}) => {
  const suffix = Date.now();
  const sessions = [];
  for (const name of ["Arden", "Robin"]) {
    const r = await request.post(`${api}/auth/signup`, {
      data: {
        email: `${name.toLowerCase()}-${suffix}@example.test`,
        password: "Testing-Journal-2026",
        displayName: `${name} ${suffix}`,
        inviteCode: "LUDEX-LOCAL-BETA",
      },
    });
    expect(r.ok()).toBeTruthy();
    sessions.push(await r.json());
  }
  const contexts = await Promise.all(
    sessions.map(async (s) => {
      const c = await browser.newContext();
      await c.addInitScript(
        (session) =>
          localStorage.setItem("ludex-session", JSON.stringify(session)),
        s,
      );
      return c;
    }),
  );
  try {
    const page = await contexts[0].newPage();
    await page.goto("/collection/");
    await expect(
      page.getByRole("button", { name: "Create collection", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Create collection", exact: true })
      .click();
    await page.getByLabel("Collection name").fill("Worlds after midnight");
    await page
      .getByRole("button", { name: "Choose Dune: Part Two", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save collection", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Worlds after midnight", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Worlds after midnight", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Discover", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: /Dune: Part Two/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Write a review", exact: true })
      .click();
    await page
      .getByLabel("Your review")
      .fill("The desert becomes a language of its own.");
    await page
      .getByRole("button", { name: "Save private draft", exact: true })
      .click();
    await expect(
      page.getByText("Private draft saved", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Review rating").selectOption("9");
    await expect(
      page.getByText("Private draft saved", { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Review audience").selectOption("public");
    await page
      .getByRole("button", { name: "Publish review", exact: true })
      .click();
    const robin = await contexts[1].newPage();
    await robin.goto("/discover/");
    await robin
      .getByRole("button", { name: new RegExp(`Arden ${suffix}`) })
      .first()
      .click();
    await robin.getByRole("button", { name: "Follow", exact: true }).click();
    await robin.reload();
    await expect(
      robin.getByRole("button", { name: "Following", exact: true }).first(),
    ).toBeVisible();
    await robin
      .getByRole("button", { name: "Feed", exact: true })
      .first()
      .click();
    await expect(
      robin.getByText("The desert becomes a language of its own.", {
        exact: true,
      }),
    ).toBeVisible();
    await robin
      .getByRole("button", { name: "Discuss activity", exact: true })
      .first()
      .click();
    await robin
      .getByLabel("Your reply")
      .fill("Putting this on my weekend shortlist.");
    let releaseReply!: () => void;
    const heldReply = new Promise<void>((resolve) => {
      releaseReply = resolve;
    });
    let replyStarted!: () => void;
    const startedReply = new Promise<void>((resolve) => {
      replyStarted = resolve;
    });
    await robin.route("**/api/social/reply", async (route) => {
      replyStarted();
      await heldReply;
      await route.continue();
    });
    await robin
      .getByRole("button", { name: "Send reply", exact: true })
      .click();
    await startedReply;
    // Repeated Enter submits the same mounted form while its first write is pending.
    await robin
      .getByLabel("Your reply")
      .evaluate((field) => field.closest("form")!.requestSubmit());
    releaseReply();
    await expect(
      robin.getByText("Putting this on my weekend shortlist.", { exact: true }),
    ).toBeVisible();
    await expect(robin.getByLabel("Your reply")).toHaveValue("");
    await expect(
      robin.getByText("Putting this on my weekend shortlist.", { exact: true }),
    ).toHaveCount(1);
    const feedResult = await request.get(
      `${api}/feed?limit=20&filter=following`,
      { headers: { Authorization: `Bearer ${sessions[1].token}` } },
    );
    const activity = (await feedResult.json()).items[0];
    await expect
      .poll(async () => {
        const replies = await request.get(
          `${api}/social/replies?activityId=${encodeURIComponent(activity.id)}`,
          { headers: { Authorization: `Bearer ${sessions[1].token}` } },
        );
        return (await replies.json()).length;
      })
      .toBe(1);
    await page.goto("/profile/");
    await page
      .getByRole("button", { name: "Edit showcase", exact: true })
      .click();
    await page.getByRole("button", { name: /Add a shelf/ }).click();
    await page.getByLabel("Shelf title").fill("The long way home");
    await page
      .getByRole("button", { name: "Dune: Part Two", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save showcase", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "Set the scene.", exact: true })).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "The long way home", exact: true }),
    ).toBeVisible();
  } finally {
    await Promise.allSettled(contexts.map((c) => c.close()));
    for (const s of sessions)
      await request.post(`${api}/account/delete`, {
        headers: { Authorization: `Bearer ${s.token}` },
        data: {},
      });
  }
});
