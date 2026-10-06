import { test, expect } from "@playwright/test";
const api = "http://localhost:4000/api";
test("private movie log remains off feed and receipt undo persists", async ({
  browser,
  request,
}) => {
  const r = await request.post(`${api}/auth/signup`, {
    data: {
      email: `privacy-${Date.now()}@example.test`,
      password: "Testing-Journal-2026",
      displayName: "Ellis",
      inviteCode: "LUDEX-LOCAL-BETA",
    },
  });
  expect(r.ok()).toBeTruthy();
  const s = await r.json();
  const c = await browser.newContext();
  await c.addInitScript(
    (session) => localStorage.setItem("ludex-session", JSON.stringify(session)),
    s,
  );
  const page = await c.newPage();
  try {
    await page.goto("/discover/");
    await page
      .getByRole("button", { name: /Dune: Part Two/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Log film", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Audience", exact: true }),
    ).toHaveValue("private");
    await page
      .getByRole("button", { name: "Save to journal", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Undo log", exact: true }),
    ).toBeVisible();
    let list = await request.get(`${api}/library`, {
      headers: { Authorization: `Bearer ${s.token}` },
    });
    expect((await list.json())[0].runs[0].movieViewed).toBe(true);
    await page.getByRole("button", { name: "Undo log", exact: true }).click();
    await expect(page.getByText("Log undone", { exact: true })).toBeVisible();
    list = await request.get(`${api}/library`, {
      headers: { Authorization: `Bearer ${s.token}` },
    });
    expect((await list.json())[0].runs).toHaveLength(0);
    const feed = await request.get(`${api}/feed?limit=20&filter=following`, {
      headers: { Authorization: `Bearer ${s.token}` },
    });
    expect((await feed.json()).items).toHaveLength(0);
  } finally {
    await c.close();
    await request.post(`${api}/account/delete`, {
      headers: { Authorization: `Bearer ${s.token}` },
      data: {},
    });
  }
});
test("mobile layout and reduced motion preserve usable feed navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A life in stories." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Showcase", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Mara Chen", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("browser export downloads authenticated owner journal", async ({
  browser,
  request,
}) => {
  const api = "http://localhost:4000/api";
  const r = await request.post(`${api}/auth/signup`, {
    data: {
      email: `export-${Date.now()}@example.test`,
      password: "Testing-Journal-2026",
      displayName: "Quinn",
      inviteCode: "LUDEX-LOCAL-BETA",
    },
  });
  const s = await r.json();
  const c = await browser.newContext({ acceptDownloads: true });
  await c.addInitScript(
    (session) => localStorage.setItem("ludex-session", JSON.stringify(session)),
    s,
  );
  try {
    const page = await c.newPage();
    await page.goto("/settings/");
    const download = page.waitForEvent("download", { timeout: 5000 });
    await page
      .getByRole("button", { name: "Export my journal", exact: true })
      .click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("ludex-journal.json");
  } finally {
    await c.close();
    await request.post(`${api}/account/delete`, {
      headers: { Authorization: `Bearer ${s.token}` },
      data: {},
    });
  }
});
