import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { QA_IMAGE, requireResult } from "./fixtures.mjs";
import { isExpectedDataDenial } from "./api-results.mjs";

async function publishRaceListing({ accounts, runId }) {
  const { seller } = accounts;
  const category = requireResult(await seller.client.from("categories").select("id").eq("slug", "school-supplies").eq("is_active", true).single(), "Concurrency category");
  const id = randomUUID();
  requireResult(await seller.client.from("listings").insert({ id, seller_id: seller.id, submission_token: randomUUID(), category_id: category.id, title: `QA ${runId} concurrency`, description: "Disposable QA transaction concurrency fixture.", price: 650, condition: "good" }), "Concurrency draft");
  const storagePath = `${seller.id}/${id}/${randomUUID()}.png`;
  requireResult(await seller.client.storage.from("listing-images").upload(storagePath, QA_IMAGE, { contentType: "image/png", upsert: false }), "Concurrency image upload");
  requireResult(await seller.client.from("listing_images").insert({ listing_id: id, storage_path: storagePath, sort_order: 0, is_cover: true }), "Concurrency image link");
  requireResult(await seller.client.rpc("publish_listing", { p_listing_id: id }), "Concurrency publish");
  return id;
}

/** A held parent-row lock and observed blocked sessions prove real overlap. */
async function raceWithBarrier(context, listingId, sql, parameters) {
  const { pool, accounts, runId } = context;
  const blocker = await pool.connect();
  const participants = [];
  const pending = [];
  let released = false;
  try {
    await blocker.query("begin");
    await blocker.query("select id from public.listings where id=$1 for update", [listingId]);
    for (let index = 0; index < parameters.length; index++) {
      const session = await pool.connect();
      participants.push(session);
      await session.query("begin");
      await session.query("set local role authenticated");
      await session.query("set local statement_timeout='20s'");
      await session.query("set local lock_timeout='15s'");
      await session.query("select set_config('application_name',$1,true), set_config('request.jwt.claim.sub',$2,true), set_config('request.jwt.claims',$3,true)", [`qa-${runId}-${index}`, accounts.seller.id, JSON.stringify({ sub: accounts.seller.id, role: "authenticated" })]);
      // Start both queries without awaiting either; each must enter lock wait.
      pending.push((async () => {
        try {
          const result = await session.query(sql, parameters[index]);
          await session.query("commit");
          return { ok: true, result };
        } catch (error) {
          await session.query("rollback");
          return { ok: false, code: error.code };
        }
      })());
    }
    const deadline = Date.now() + 8000;
    let waiting = 0;
    do {
      const state = await pool.query("select count(*)::int as waiting from pg_stat_activity where application_name=any($1::text[]) and wait_event_type='Lock'", [parameters.map((_, index) => `qa-${runId}-${index}`)]);
      waiting = state.rows[0].waiting;
      if (waiting === parameters.length) break;
      await new Promise((resolve) => setTimeout(resolve, 40));
    } while (Date.now() < deadline);
    assert.equal(waiting, parameters.length, "Concurrency test requires two actually overlapping blocked PostgreSQL sessions.");
    await blocker.query("commit");
    released = true;
    return await Promise.all(pending);
  } finally {
    try {
      if (!released) await blocker.query("rollback");
      await Promise.allSettled(pending);
    } finally {
      // Even an outage during rollback must not leave pool.end() waiting on a
      // leased QA connection. Destroy interrupted sessions if settlement failed.
      for (const session of participants) session.release(!released);
      blocker.release(!released);
    }
  }
}

/** Prove a stale draft INSERT cannot finish after another session publishes. */
async function runImagePublicationRace(context) {
  const { accounts, pool, runId } = context;
  const { seller } = accounts;
  const category = requireResult(await seller.client.from("categories").select("id").eq("slug", "school-supplies").eq("is_active", true).single(), "Image race category");
  const listingId = randomUUID();
  requireResult(await seller.client.from("listings").insert({ id: listingId, seller_id: seller.id, submission_token: randomUUID(), category_id: category.id, title: `QA ${runId} image publication race`, description: "Disposable parent-lock image insertion regression.", price: 600, condition: "good" }), "Image race draft");
  const paths = [0, 1].map(() => `${seller.id}/${listingId}/${randomUUID()}.png`);
  for (const path of paths) requireResult(await seller.client.storage.from("listing-images").upload(path, QA_IMAGE, { contentType: "image/png", upsert: false }), "Image race upload");
  requireResult(await seller.client.from("listing_images").insert({ listing_id: listingId, storage_path: paths[0], sort_order: 0, is_cover: true }), "Image race cover link");
  const blocker = await pool.connect();
  let participant;
  const applicationName = `qa-${runId}-image-insert`;
  let pending;
  let released = false;
  try {
    participant = await pool.connect();
    await blocker.query("begin");
    await blocker.query("select id from public.listings where id=$1 for update", [listingId]);
    await blocker.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [seller.id, JSON.stringify({ sub: seller.id, role: "authenticated" })]);
    await participant.query("begin");
    await participant.query("set local role authenticated");
    await participant.query("set local statement_timeout='20s'");
    await participant.query("set local lock_timeout='15s'");
    await participant.query("select set_config('application_name',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claims',$3,true)", [applicationName, seller.id, JSON.stringify({ sub: seller.id, role: "authenticated" })]);
    pending = (async () => {
      try {
        await participant.query("insert into public.listing_images(listing_id,storage_path,sort_order,is_cover) values($1,$2,2,false)", [listingId, paths[1]]);
        await participant.query("commit");
        return { ok: true };
      } catch (error) {
        await participant.query("rollback");
        return { ok: false, code: error.code };
      }
    })();
    const deadline = Date.now() + 8000;
    let waiting = false;
    do {
      const state = await pool.query("select exists(select 1 from pg_stat_activity where application_name=$1 and wait_event_type='Lock') as waiting", [applicationName]);
      waiting = state.rows[0].waiting;
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 40));
    } while (Date.now() < deadline);
    assert.equal(waiting, true, "Image race requires a real overlapping, blocked authenticated INSERT.");
    await blocker.query("select public.publish_listing($1)", [listingId]);
    await blocker.query("commit");
    released = true;
    assert.deepEqual(await pending, { ok: false, code: "42501" }, "A stale draft INSERT must recheck and reject the now-published parent.");
    const state = (await pool.query("select l.status,count(i.id)::int as images,min(i.sort_order)::int as first_order,max(i.sort_order)::int as last_order from public.listings l join public.listing_images i on i.listing_id=l.id where l.id=$1 group by l.id", [listingId])).rows[0];
    assert.deepEqual(state, { status: "available", images: 1, first_order: 0, last_order: 0 }, "Publication must retain exactly the validated contiguous image set.");
  } finally {
    try {
      if (!released) await blocker.query("rollback");
      if (pending) await Promise.allSettled([pending]);
      else if (participant) await participant.query("rollback");
    } finally {
      participant?.release(!released);
      blocker.release(!released);
    }
  }
}

export async function runConcurrencyChecks(context) {
  assert.ok(context.config.databaseUrl, "Real concurrency cannot run in the embedded emulator.");
  await runImagePublicationRace(context);
  const { accounts, pool } = context;
  const listingId = await publishRaceListing(context);
  const requests = await Promise.all([accounts.buyer, accounts.competitor].map(async (account) => requireResult(await account.client.rpc("request_reservation", { p_listing_id: listingId, p_message: "QA concurrent acceptance request." }), "Concurrency request")));
  assert.equal(new Set(requests).size, 2, "Two distinct buyers must have separate pending requests.");
  const accepted = await raceWithBarrier(context, listingId, "select public.accept_reservation($1) as status", requests.map((id) => [id]));
  assert.equal(accepted.filter((result) => result.ok).length, 1, "Exactly one concurrent acceptance must succeed.");
  assert.ok(accepted.filter((result) => !result.ok).every((result) => ["P0002", "PT409", "40001", "23505"].includes(result.code)), "The loser must fail for a state conflict, not an unavailable service.");
  const reservationState = (await pool.query("select id,status,buyer_id from public.reservations where listing_id=$1", [listingId])).rows;
  assert.equal(reservationState.filter((row) => row.status === "accepted").length, 1);
  assert.equal(reservationState.filter((row) => row.status === "rejected").length, 1);
  assert.equal((await pool.query("select status from public.listings where id=$1", [listingId])).rows[0].status, "reserved");
  const winner = reservationState.find((row) => row.status === "accepted");
  const stale = await accounts.seller.client.rpc("accept_reservation", { p_reservation_id: reservationState.find((row) => row.status === "rejected").id });
  assert.ok(isExpectedDataDenial(stale, ["P0002", "PT409", "40001"]), "A stale pending page must fail with a real state conflict, not an outage.");
  requireResult(await accounts.seller.client.rpc("upsert_meetup", { p_reservation_id: winner.id, p_location_name: "UC Main Campus Lobby", p_location_details: "QA near the security desk", p_scheduled_at: new Date(Date.now() + 86400000).toISOString(), p_notes: "Disposable QA race completion.", p_expected_updated_at: null }), "Concurrency meetup");
  const completion = await raceWithBarrier(context, listingId, "select public.complete_sale($1) as status", [[winner.id], [winner.id]]);
  assert.ok(completion.some((result) => result.ok), "At least one concurrent sale completion must succeed.");
  assert.ok(completion.filter((result) => !result.ok).every((result) => ["P0002", "P0001", "PT409", "40001"].includes(result.code)), "Repeated completion may be idempotent or reject a stale state, but must not deadlock.");
  const final = (await pool.query("select l.status as listing_status,r.status as reservation_status,m.status as meetup_status from public.listings l join public.reservations r on r.listing_id=l.id join public.meetups m on m.reservation_id=r.id where r.id=$1", [winner.id])).rows[0];
  assert.deepEqual(final, { listing_status: "sold", reservation_status: "completed", meetup_status: "completed" });
  const duplicateEvents = await pool.query("select user_id,event_key from public.notifications where listing_id=$1 group by user_id,event_key having count(*)>1", [listingId]);
  assert.equal(duplicateEvents.rowCount, 0, "Race retries must not duplicate notification events.");
  console.log("Real PostgreSQL concurrency: all three race scenarios passed (image publication, competing acceptance, repeated atomic sale completion); stale state and recipient/event uniqueness verified.");
  return 3;
}
