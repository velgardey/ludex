import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
} from "@playwright/test";
const api = "http://localhost:4000/api";
async function fixture(browser: Browser, request: APIRequestContext) {
  const result = await request.post(`${api}/auth/signup`, {
    data: {
      email: `boundary-${crypto.randomUUID()}@example.test`,
      password: "Testing-Journal-2026",
      displayName: "Boundary Tester",
      inviteCode: "LUDEX-LOCAL-BETA",
    },
  });
  expect(result.ok()).toBeTruthy();
  const session = await result.json();
  const context = await browser.newContext();
  await context.addInitScript(
    (s) => localStorage.setItem("ludex-session", JSON.stringify(s)),
    session,
  );
  const page = await context.newPage();
  const headers = { Authorization: `Bearer ${session.token}` };
  const publish = async (note: string) => {
    const response = await request.post(`${api}/progress`, {
      headers,
      data: {
        commandId: crypto.randomUUID(),
        titleId: "b460f5f2-7c36-4ef9-94df-6314b6500001",
        baseVersion: 0,
        change: {
          kind: "movie-viewed",
          titleId: "b460f5f2-7c36-4ef9-94df-6314b6500001",
          runId: crypto.randomUUID(),
        },
        occurredAt: { precision: "day", day: "2026-10-06" },
        note,
        audience: { kind: "public" },
        spoiler: { kind: "none" },
      },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  return {
    page,
    context,
    headers,
    publish,
    async close() {
      await context.close();
      await request.post(`${api}/account/delete`, { headers, data: {} });
    },
  };
}
test("pending feed cannot cross filters or sign-out", async ({
  browser,
  request,
}) => {
  const f = await fixture(browser, request);
  try {
    await f.page.clock.install();
    await f.page.goto("/");
    await expect(f.page.getByText("Your circle, unfolding.")).toBeVisible();
    await f.publish("A moment owned by the signed-in account");
    await f.page.clock.fastForward(30000);
    await expect(
      f.page.getByRole("button", { name: "New moments are waiting" }),
    ).toBeVisible();
    await f.page.getByRole("button", { name: "Friends", exact: true }).click();
    await expect(
      f.page.getByRole("button", { name: "New moments are waiting" }),
    ).toHaveCount(0);
    await expect(
      f.page.getByText("A moment owned by the signed-in account", {
        exact: true,
      }),
    ).toBeVisible();
    await f.page
      .getByRole("button", { name: "Privacy & settings", exact: true })
      .click();
    await f.page.getByRole("button", { name: "Sign out", exact: true }).click();
    await f.page
      .getByRole("button", { name: "Feed", exact: true })
      .first()
      .click();
    await expect(f.page.locator(".preview-label")).toBeVisible();
    await expect(
      f.page.getByText("A moment owned by the signed-in account", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      f.page.getByRole("button", { name: "New moments are waiting" }),
    ).toHaveCount(0);
  } finally {
    await f.close();
  }
});
test("late authenticated refresh is discarded after sign-out", async ({
  browser,
  request,
}) => {
  const f = await fixture(browser, request);
  try {
    await f.publish("Delayed account-only refresh marker");
    await f.page.goto("/");
    await expect(
      f.page.getByText("Delayed account-only refresh marker", { exact: true }),
    ).toBeVisible();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let captured!: () => void;
    const capture = new Promise<void>((resolve) => {
      captured = resolve;
    });
    await f.page.route("**/api/feed?**", async (route) => {
      const response = await route.fetch();
      captured();
      await held;
      await route.fulfill({ response });
    });
    await f.page
      .getByRole("button", { name: "Latest first", exact: true })
      .click();
    await capture;
    await f.page
      .getByRole("button", { name: "Privacy & settings", exact: true })
      .click();
    await f.page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(f.page.locator(".preview-label")).toBeVisible();
    const delivered = f.page.waitForResponse((response) =>
      response.url().includes("/api/feed?"),
    );
    release();
    await delivered;
    await f.page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await f.page
      .getByRole("button", { name: "Feed", exact: true })
      .first()
      .click();
    await expect(
      f.page.getByText("Delayed account-only refresh marker", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await f.close();
  }
});

test("sign-out discards an unaccepted feed banner", async ({
  browser,
  request,
}) => {
  const f = await fixture(browser, request);
  try {
    await f.page.clock.install();
    await f.page.goto("/");
    await expect(f.page.getByText("Your circle, unfolding.")).toBeVisible();
    await f.publish("Unaccepted previous-account moment");
    await f.page.clock.fastForward(30000);
    await expect(
      f.page.getByRole("button", { name: "New moments are waiting" }),
    ).toBeVisible();
    await f.page
      .getByRole("button", { name: "Privacy & settings", exact: true })
      .click();
    await f.page.getByRole("button", { name: "Sign out", exact: true }).click();
    await f.page
      .getByRole("button", { name: "Feed", exact: true })
      .first()
      .click();
    await expect(f.page.locator(".preview-label")).toBeVisible();
    await expect(
      f.page.getByRole("button", { name: "New moments are waiting" }),
    ).toHaveCount(0);
    await expect(
      f.page.getByText("Unaccepted previous-account moment", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await f.close();
  }
});
