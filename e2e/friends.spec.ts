import { test, expect } from "@playwright/test";
test("follows do not grant friend progress; accepted request grants it and block removes it", async ({
  request,
}) => {
  const api = "http://localhost:4000/api";
  const sessions = [];
  for (const name of ["Morgan", "Jules"]) {
    const r = await request.post(`${api}/auth/signup`, {
      data: {
        email: `${name}-${Date.now()}@example.test`,
        password: "Testing-Journal-2026",
        displayName: name,
        inviteCode: "LUDEX-LOCAL-BETA",
      },
    });
    expect(r.ok()).toBeTruthy();
    sessions.push(await r.json());
  }
  const [a, b] = sessions;
  const ah = { Authorization: `Bearer ${a.token}` },
    bh = { Authorization: `Bearer ${b.token}` };
  try {
    const catalog = await request.get(`${api}/catalog/search`, { headers: ah });
    const title = (await catalog.json())[0];
    await request.post(`${api}/progress`, {
      headers: ah,
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
        note: "For accepted friends only",
        audience: { kind: "friends" },
        spoiler: { kind: "none" },
      },
    });
    await request.post(`${api}/social/follow`, {
      headers: bh,
      data: { targetId: a.user.id, following: true },
    });
    let f = await request.get(`${api}/feed?limit=20&filter=friends`, {
      headers: bh,
    });
    expect((await f.json()).items).toHaveLength(0);
    await request.post(`${api}/social/friendship`, {
      headers: bh,
      data: { targetId: a.user.id, action: "request" },
    });
    await request.post(`${api}/social/friendship`, {
      headers: ah,
      data: { targetId: b.user.id, action: "accept" },
    });
    f = await request.get(`${api}/feed?limit=20&filter=friends`, {
      headers: bh,
    });
    expect((await f.json()).items[0].note).toBe("For accepted friends only");
    await request.post(`${api}/social/block`, {
      headers: bh,
      data: { targetId: a.user.id },
    });
    f = await request.get(`${api}/feed?limit=20&filter=friends`, {
      headers: bh,
    });
    expect((await f.json()).items).toHaveLength(0);
  } finally {
    for (const s of sessions)
      await request.post(`${api}/account/delete`, {
        headers: { Authorization: `Bearer ${s.token}` },
        data: {},
      });
  }
});
