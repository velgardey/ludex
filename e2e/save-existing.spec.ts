import { test, expect } from "@playwright/test";
test("save for later preserves an already completed journal", async ({
  browser,
  request,
}) => {
  const api = "http://localhost:4000/api";
  const r = await request.post(`${api}/auth/signup`, {
    data: {
      email: `save-${Date.now()}@example.test`,
      password: "Testing-Journal-2026",
      displayName: "Rowan",
      inviteCode: "LUDEX-LOCAL-BETA",
    },
  });
  const s = await r.json();
  const headers = { Authorization: `Bearer ${s.token}` };
  const catalog = await request.get(`${api}/catalog/search`, { headers });
  const title = (await catalog.json())[0];
  await request.post(`${api}/progress`, {
    headers,
    data: {
      commandId: crypto.randomUUID(),
      titleId: title.id,
      baseVersion: 0,
      change: {
        kind: "movie-viewed",
        titleId: title.id,
        runId: crypto.randomUUID(),
      },
      occurredAt: { precision: "day", day: "2026-10-06" },
      audience: { kind: "private" },
      spoiler: { kind: "none" },
    },
  });
  const c = await browser.newContext();
  await c.addInitScript(
    (session) => localStorage.setItem("ludex-session", JSON.stringify(session)),
    s,
  );
  try {
    const page = await c.newPage();
    await page.goto("/discover/");
    await page
      .getByRole("button", { name: /Dune: Part Two/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Save for later", exact: true })
      .click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("library");
    const library = await request.get(`${api}/library`, { headers });
    expect((await library.json())[0].state).toBe("completed");
  } finally {
    await c.close();
    await request.post(`${api}/account/delete`, { headers, data: {} });
  }
});
