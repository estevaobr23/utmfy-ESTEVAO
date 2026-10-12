import { beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "./helpers/db";

type TestDb = Awaited<ReturnType<typeof freshDb>>;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const VIEWER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("ciclo de vida seguro das ofertas", () => {
  let t: TestDb;
  let workspace = "";
  let account = "";
  let pixel = "";

  beforeAll(async () => {
    t = await freshDb();
    await t.su("insert into auth.users (id, email) values ($1, 'owner@test.local'), ($2, 'viewer@test.local')", [OWNER, VIEWER]);
    [{ id: workspace }] = await t.su<{ id: string }>("insert into workspaces (name, slug) values ('Teste', 'teste-lifecycle') returning id");
    await t.su("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'viewer')", [workspace, OWNER, VIEWER]);
    [{ id: account }] = await t.su<{ id: string }>("insert into meta_ad_accounts (workspace_id, account_id) values ($1, '123456') returning id", [workspace]);
    [{ id: pixel }] = await t.su<{ id: string }>("insert into pixels (workspace_id, external_pixel_id, name) values ($1, '987654', 'Pixel compartilhado') returning id", [workspace]);
  });

  it("exclui oferta vazia e preserva conta e pixel compartilhados", async () => {
    const [{ id: offer }] = await t.su<{ id: string }>("insert into offers (workspace_id, name, slug) values ($1, 'Oferta vazia', 'oferta-vazia') returning id", [workspace]);
    await t.su("insert into offer_ad_accounts (workspace_id, offer_id, ad_account_id) values ($1, $2, $3)", [workspace, offer, account]);
    await t.su("insert into offer_pixels (workspace_id, offer_id, pixel_id) values ($1, $2, $3)", [workspace, offer, pixel]);

    const result = await t.as<{ result: { deleted: boolean } }>(OWNER, "select delete_empty_offer($1, 'Oferta vazia') result", [offer]);
    expect(result[0].result.deleted).toBe(true);
    expect((await t.su<{ n: number }>("select count(*)::int n from offers where id = $1", [offer]))[0].n).toBe(0);
    expect((await t.su<{ n: number }>("select count(*)::int n from meta_ad_accounts where id = $1", [account]))[0].n).toBe(1);
    expect((await t.su<{ n: number }>("select count(*)::int n from pixels where id = $1", [pixel]))[0].n).toBe(1);
  });

  it("bloqueia exclusão quando existe histórico financeiro", async () => {
    const [{ id: offer }] = await t.su<{ id: string }>("insert into offers (workspace_id, name, slug) values ($1, 'Oferta histórica', 'oferta-historica') returning id", [workspace]);
    await t.su("insert into orders (workspace_id, offer_id, external_order_id, status) values ($1, $2, 'HIST-1', 'paid')", [workspace, offer]);
    await expect(t.as(OWNER, "select delete_empty_offer($1, 'Oferta histórica')", [offer])).rejects.toThrow(/offer_has_history/);
    expect((await t.su<{ n: number }>("select count(*)::int n from offers where id = $1", [offer]))[0].n).toBe(1);
    expect((await t.su<{ n: number }>("select count(*)::int n from orders where offer_id = $1", [offer]))[0].n).toBe(1);
  });

  it("nega exclusão ao perfil viewer", async () => {
    const [{ id: offer }] = await t.su<{ id: string }>("insert into offers (workspace_id, name, slug) values ($1, 'Sem permissão', 'sem-permissao') returning id", [workspace]);
    await expect(t.as(VIEWER, "select delete_empty_offer($1, 'Sem permissão')", [offer])).rejects.toThrow(/offer_forbidden/);
  });
});

describe("associações explícitas da Meta", () => {
  let t: TestDb;
  let workspace = "";
  let account = "";
  let offerA = "";
  let offerB = "";

  beforeAll(async () => {
    t = await freshDb();
    await t.su("insert into auth.users (id, email) values ($1, 'owner-bindings@test.local')", [OWNER]);
    [{ id: workspace }] = await t.su<{ id: string }>("insert into workspaces (name, slug) values ('Bindings', 'bindings') returning id");
    await t.su("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspace, OWNER]);
    [{ id: account }] = await t.su<{ id: string }>("insert into meta_ad_accounts (workspace_id, account_id) values ($1, '456789') returning id", [workspace]);
    [{ id: offerA }] = await t.su<{ id: string }>("insert into offers (workspace_id, name, slug) values ($1, 'Oferta A', 'binding-a') returning id", [workspace]);
    [{ id: offerB }] = await t.su<{ id: string }>("insert into offers (workspace_id, name, slug) values ($1, 'Oferta B', 'binding-b') returning id", [workspace]);
  });

  it("impede confirmar a mesma campanha em duas ofertas", async () => {
    await t.as(OWNER, "select replace_offer_meta_bindings($1, $2, array['1001'], array[]::text[])", [offerA, account]);
    await expect(t.as(OWNER, "select replace_offer_meta_bindings($1, $2, array['1001'], array[]::text[])", [offerB, account])).rejects.toThrow(/meta_binding_conflict/);
  });

  it("permite separar um conjunto específico de uma campanha", async () => {
    await t.as(OWNER, "select replace_offer_meta_bindings($1, $2, array[]::text[], array['2002'])", [offerB, account]);
    const rows = await t.su<{ offer_id: string; level: string; object_id: string }>("select offer_id, level, object_id from offer_meta_bindings order by level, object_id");
    expect(rows).toEqual(expect.arrayContaining([
      { offer_id: offerA, level: "campaign", object_id: "1001" },
      { offer_id: offerB, level: "adset", object_id: "2002" },
    ]));
  });

  it("desassociar a conta remove somente os vínculos da oferta", async () => {
    await t.as(OWNER, "delete from offer_ad_accounts where offer_id = $1 and ad_account_id = $2", [offerB, account]);
    expect((await t.su<{ n: number }>("select count(*)::int n from offer_meta_bindings where offer_id = $1", [offerB]))[0].n).toBe(0);
    expect((await t.su<{ n: number }>("select count(*)::int n from meta_ad_accounts where id = $1", [account]))[0].n).toBe(1);
  });
});
