import { test, expect } from "@playwright/test";
test("premiere remains operable with reduced motion and retains immediate navigation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/discover/");
  await expect(page.getByRole("heading", { name: "Follow your curiosity." })).toBeVisible();
  await expect(page.locator(".premiere-stage")).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
  await page.getByRole("button", { name: "Dune: Part Two", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Log film", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".premiere-stage")).toBeVisible();
});
test("premiere motion is bounded and does not block title interaction", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/discover/");
  await expect(page.locator(".premiere-stage")).toBeVisible();
  await page.getByRole("button", { name: "Dune: Part Two", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Log film", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
  expect(errors).toEqual([]);
});
test("changing motion preferences cancels the entrance without hiding controls", async ({ page }) => {
  await page.goto("/discover/");
  await expect(page.locator(".premiere-stage")).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add("reduce-motion"));
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
  await expect(page.getByRole("button", { name: "Find your next obsession" })).toBeVisible();
  await page.getByRole("button", { name: "Find your next obsession" }).click();
  await expect(page.getByRole("textbox", { name: "Search catalog" })).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => document.documentElement.classList.remove("reduce-motion"));
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
});
test("feed reveals settle and reduced motion suppresses observed entries", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".activity").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".activity").last().scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
});
test("low-data accounts do not request premiere art while settings resolve", async ({ browser, request }) => {
  const api = "http://localhost:4000/api";
  const signup = await request.post(`${api}/auth/signup`, { data: { email: `art-${crypto.randomUUID()}@example.test`, password: "Testing-Journal-2026", displayName: "Low Data", inviteCode: "LUDEX-LOCAL-BETA" } });
  expect(signup.ok()).toBeTruthy();
  const session = await signup.json();
  const headers = { Authorization: `Bearer ${session.token}` };
  const context = await browser.newContext();
  await context.addInitScript(s => localStorage.setItem("ludex-session", JSON.stringify(s)), session);
  const page = await context.newPage();
  const art: string[] = [];
  page.on("request", req => { if (req.url().includes("/art/premiere.webp")) art.push(req.url()); });
  let resolveSettings!: () => void;
  const gate = new Promise<void>(resolve => { resolveSettings = resolve; });
  await page.route("**/api/account/settings", async route => {
    await gate;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lowData: true, reducedMotion: true }) });
  });
  try {
    await page.goto("/discover/");
    await expect(page.getByRole("button", { name: "Find your next obsession" })).toBeVisible();
    expect(art).toHaveLength(0);
    resolveSettings();
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("low-data"))).toBe(true);
    expect(art).toHaveLength(0);
    await page.getByRole("button", { name: "Find your next obsession" }).click();
    await expect(page.getByRole("textbox", { name: "Search catalog" })).toBeFocused();
  } finally {
    resolveSettings();
    await context.close();
    await request.post(`${api}/account/delete`, { headers, data: {} });
  }
});
