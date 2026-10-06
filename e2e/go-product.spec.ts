import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixturePath = process.env.LUDEX_GO_SMOKE_SESSION;
test.skip(
  !fixturePath,
  "Run Go product smoke first and set LUDEX_GO_SMOKE_SESSION to its ignored local session file.",
);
test("real Go journal opens plans, confirmed discussion, connections and saved companion", async ({
  page,
}) => {
  const seed = JSON.parse(readFileSync(fixturePath!, "utf8"));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    (session) => localStorage.setItem("ludex-session", JSON.stringify(session)),
    seed.session,
  );
  await page.goto("/plan/");
  await page.getByRole("button", { name: "After hours · Friday" }).click();
  await expect(
    page.getByText("Same time, different worlds.", { exact: true }),
  ).toBeVisible();
  await page.goto("/settings/");
  await page.getByRole("button", { name: "Connections & imports" }).click();
  await expect(
    page.getByRole("heading", { name: "Bring your history with you." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Your companion" }).click();
  await expect(
    page.getByRole("log", { name: "Saved conversation" }),
  ).toBeVisible();
  await expect(
    page.getByText("What have I watched?", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
