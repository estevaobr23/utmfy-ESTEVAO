// Migration 20261101000001: layout do painel por usuário (RLS: cada um só lê e grava o seu).
import { beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof freshDb>>;
let WS = "";
const USER = "11111111-1111-1111-1111-111111111111";
const COLLEAGUE = "22222222-2222-2222-2222-222222222222";
const STRANGER = "33333333-3333-3333-3333-333333333333";

beforeAll(async () => {
  t = await freshDb();
  await t.su(`insert into auth.users (id, email) values ($1, 'a@ex.com'), ($2, 'b@ex.com'), ($3, 'c@ex.com')`, [USER, COLLEAGUE, STRANGER]);
  [{ id: WS }] = await t.su<{ id: string }>(`insert into workspaces (name, slug) values ('A', 'a') returning id`);
  await t.su(`insert into workspace_members (workspace_id, user_id) values ($1, $2), ($1, $3)`, [WS, USER, COLLEAGUE]);
});

const upsert = (uid: string, owner: string, layout = '[{"id":"payment","span":6,"hidden":false}]') =>
  t.as(uid, `insert into dashboard_layouts (workspace_id, user_id, page, layout) values ($1, $2, 'resumo', $3::jsonb)
    on conflict (workspace_id, user_id, page) do update set layout = excluded.layout`, [WS, owner, layout]);

describe("dashboard_layouts", () => {
  it("o membro grava e relê o próprio layout (e regrava por cima)", async () => {
    await upsert(USER, USER);
    await upsert(USER, USER, '[{"id":"kpis","span":12,"hidden":false}]');
    const rows = await t.as<{ layout: { id: string }[] }>(USER, `select layout from dashboard_layouts where workspace_id = $1`, [WS]);
    expect(rows).toHaveLength(1);
    expect(rows[0].layout[0].id).toBe("kpis");
  });

  it("colega do mesmo workspace não vê nem grava o layout de outro", async () => {
    expect(await t.as(COLLEAGUE, `select * from dashboard_layouts`)).toEqual([]);
    await expect(upsert(COLLEAGUE, USER)).rejects.toThrow();
  });

  it("quem não é membro não grava nem no próprio nome", async () => {
    await expect(upsert(STRANGER, STRANGER)).rejects.toThrow();
  });

  it("recusa layout que não é lista", async () => {
    await expect(upsert(COLLEAGUE, COLLEAGUE, '{"a":1}')).rejects.toThrow();
  });
});
