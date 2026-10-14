import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as pause } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { isInvisibleDataResult, isSuccessfulApiResult } from "./api-results.mjs";
import { isQaPublishableKey } from "./environment.mjs";
import { assertDatabaseRunOwnership, QA_IMAGE } from "./fixtures.mjs";

export const MIN_REALTIME_DENIAL_WINDOW_MS = 3000;
const MAX_DENIAL_WINDOW_MS = 30000;
const TIMEOUT_MS = 15000;
const DENIAL_WINDOW_MS = 3500;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roles = ["seller", "buyer", "competitor"];

class RealtimeCheckError extends Error {}

function check(condition, label) {
  if (!condition) throw new RealtimeCheckError(`Realtime acceptance failed: ${label}.`);
}

/** Silence is evidence only on a healthy subscription bracketed by deliveries. */
export function isValidRealtimeDenialEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return false;
  const times = ["subscribedAt", "positiveControlBeforeAt", "windowStartedAt", "windowEndedAt", "positiveControlAfterAt"];
  if (times.some((name) => !Number.isFinite(evidence[name]) || evidence[name] < 0)) return false;
  const windowMs = evidence.windowEndedAt - evidence.windowStartedAt;
  return evidence.subscribedAt <= evidence.positiveControlBeforeAt
    && evidence.positiveControlBeforeAt <= evidence.windowStartedAt
    && evidence.windowEndedAt <= evidence.positiveControlAfterAt
    && windowMs >= MIN_REALTIME_DENIAL_WINDOW_MS && windowMs <= MAX_DENIAL_WINDOW_MS
    && Number.isSafeInteger(evidence.targetParticipantDeliveries) && evidence.targetParticipantDeliveries >= 2
    && evidence.targetUnauthorizedDeliveries === 0
    && evidence.transportFailureCount === 0 && evidence.protocolFailureCount === 0
    && evidence.postgresFailureCount === 0 && evidence.postgresReadyAfterWindow === true
    && evidence.subscribedAfterWindow === true;
}

/** A WebSocket join alone does not mean the database listener is ready. */
export function isMessageObserverReady(observer) {
  return !observer.closing && observer.status === "SUBSCRIBED" && observer.client.realtime.isConnected()
    && observer.postgresChangesStatus === "ok" && observer.postgresFailures === 0
    && observer.failures.length === 0 && observer.protocolFailures === 0;
}

async function success(request, label) {
  const result = await request;
  check(isSuccessfulApiResult(result), label);
  return result.data;
}

function assertHealthy(observers, { requireSubscribed = true } = {}) {
  for (const observer of observers) {
    check(observer.failures.length === 0, `${observer.role} subscription encountered a transport failure`);
    check(observer.protocolFailures === 0, `${observer.role} received an invalid message change`);
    check(observer.postgresFailures === 0, `${observer.role} database change subscription failed`);
    if (requireSubscribed) check(isMessageObserverReady(observer), `${observer.role} database change subscription must remain ready and connected`);
    if (observer.forbiddenConversationId) {
      check(!observer.events.some((event) => event.row.conversation_id === observer.forbiddenConversationId), "third account received another conversation's message change");
    }
  }
}

async function waitFor(predicate, label, observers, { timeoutMs = TIMEOUT_MS, requireSubscribed = true } = {}) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() <= deadline) {
    assertHealthy(observers, { requireSubscribed });
    const result = predicate();
    if (result) return result;
    await pause(25);
  }
  throw new RealtimeCheckError(`Realtime acceptance failed: ${label} timed out.`);
}

export function createMessageObserver(client, role, runId, conversationIds, forbiddenConversationId = null) {
  const observer = { client, role, events: [], failures: [], protocolFailures: 0, postgresChangesStatus: null, postgresFailures: 0, status: null, subscribedAt: null, closing: false, forbiddenConversationId };
  const channel = client.channel(`qa-${runId}-${role}-${randomUUID()}`);
  observer.channel = channel;
  // The service reports CDC readiness separately from the WebSocket join.
  // Never retain its free-text message, channel/topic or other private fields.
  channel.on("system", {}, (payload) => {
    if (observer.closing || payload?.extension !== "postgres_changes") return;
    if (payload.status === "ok") observer.postgresChangesStatus = "ok";
    else {
      observer.postgresChangesStatus = "error";
      observer.postgresFailures += 1;
    }
  });
  // Explicit INSERT/UPDATE bindings avoid DELETE's different RLS semantics.
  for (const conversationId of conversationIds) {
    for (const eventType of ["INSERT", "UPDATE"]) {
      channel.on("postgres_changes", { event: eventType, schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        if (observer.closing) return;
        const row = payload.new;
        if (payload.schema !== "public" || payload.table !== "messages" || payload.eventType !== eventType
          || !row || !uuid.test(row.id) || row.conversation_id !== conversationId || !uuid.test(row.sender_id)
          || typeof row.body !== "string" || !Number.isFinite(Date.parse(row.created_at))
          || (row.read_at !== null && !Number.isFinite(Date.parse(row.read_at)))) {
          observer.protocolFailures += 1;
          return;
        }
        observer.events.push({ eventType, row, receivedAt: performance.now() });
      });
    }
  }
  channel.subscribe((status) => {
    observer.status = status;
    if (status === "SUBSCRIBED") observer.subscribedAt ??= performance.now();
    else {
      observer.postgresChangesStatus = null;
      if (!observer.closing) observer.failures.push(status);
    }
    // Raw SDK errors may contain URLs, JWTs, or private server responses.
  }, TIMEOUT_MS);
  return observer;
}

async function delivery(observer, message, eventType, monitors) {
  return waitFor(() => observer.events.find((event) => event.eventType === eventType && event.row.id === message.id
    && event.row.conversation_id === message.conversationId && event.row.sender_id === message.senderId
    && event.row.body === message.body
    && (eventType === "INSERT" ? event.row.read_at === null : Number.isFinite(Date.parse(event.row.read_at)))), `${observer.role} ${eventType} delivery`, monitors);
}

async function send(client, accountId, conversationId, label, runId) {
  const body = `QA ${runId} ${label} ${randomUUID()}`;
  const id = await success(client.rpc("send_conversation_message", { p_conversation_id: conversationId, p_body: body }), "participant message RPC");
  check(uuid.test(id), "message RPC must return a persisted message ID");
  return { id, conversationId, senderId: accountId, body };
}

async function publishListing(context, seller) {
  const categories = await success(seller.from("categories").select("id").eq("is_active", true).limit(1), "active realtime listing category");
  check(uuid.test(categories?.[0]?.id), "realtime listing needs a real active category");
  const id = randomUUID();
  const storagePath = `${context.accounts.seller.id}/${id}/${randomUUID()}.png`;
  await success(seller.from("listings").insert({ id, seller_id: context.accounts.seller.id, submission_token: randomUUID(), category_id: categories[0].id, title: `QA ${context.runId} realtime`, description: "Disposable authenticated realtime messaging acceptance fixture.", price: 650, condition: "good" }), "realtime listing draft");
  await success(seller.storage.from("listing-images").upload(storagePath, QA_IMAGE, { contentType: "image/png", upsert: false }), "realtime listing image");
  await success(seller.from("listing_images").insert({ listing_id: id, storage_path: storagePath, sort_order: 0, is_cover: true }), "realtime listing image link");
  check(await success(seller.rpc("publish_listing", { p_listing_id: id }), "realtime listing publish") === id, "realtime listing publication must preserve its ID");
  return id;
}

async function preflight(context) {
  const { accounts, config, pool, runId } = context;
  check(uuid.test(runId) && roles.every((role) => uuid.test(accounts?.[role]?.id)), "run-owned fixture identities are required");
  check(new Set(roles.map((role) => accounts[role].id)).size === roles.length, "seller, buyer, and third account must have distinct identities");
  check(isQaPublishableKey(config?.publishableKey) && config.publishableKey !== config.serviceRoleKey, "realtime subscribers must use the public key");
  await assertDatabaseRunOwnership(pool, roles.map((role) => accounts[role].id), runId);
  const publication = await pool.query(`
    select publication.pubinsert, publication.pubupdate, relation.relrowsecurity,
      exists(select 1 from pg_publication_tables published where published.pubname='supabase_realtime'
        and published.schemaname='public' and published.tablename='messages') as messages_published
    from pg_publication publication, pg_class relation
    join pg_namespace namespace on namespace.oid=relation.relnamespace
    where publication.pubname='supabase_realtime' and namespace.nspname='public' and relation.relname='messages'
  `);
  const state = publication.rows[0];
  check(publication.rowCount === 1 && state?.pubinsert === true && state.pubupdate === true
    && state.relrowsecurity === true && state.messages_published === true,
  "messages must have RLS and INSERT/UPDATE in supabase_realtime; apply the staged SQL only to the approved disposable database after database messaging checks pass");
}

async function createSubscribers(context, clients) {
  const tokens = new Set();
  for (const role of roles) {
    const account = context.accounts[role];
    const session = await success(account.client.auth.getSession(), `${role} fixture session`);
    const token = session?.session?.access_token;
    let claims;
    try { claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); } catch { /* The check below fails closed. */ }
    check(typeof token === "string" && claims?.role === "authenticated" && claims.sub === account.id
      && session.session.user.id === account.id && !tokens.has(token), "realtime must use three separate authenticated student sessions");
    const identity = await success(account.client.auth.getUser(token), `${role} verified Auth identity`);
    check(identity?.user?.id === account.id && identity.user.app_metadata?.qa_run_id === context.runId, "realtime session must belong to this fixture run");
    tokens.add(token);
    // Fixed in-memory user tokens keep each socket independent from fixture Auth
    // refresh/logout. No service-role subscriber or persisted session is used.
    const client = createClient(context.config.supabaseUrl, context.config.publishableKey, {
      accessToken: async () => token,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      db: { timeout: TIMEOUT_MS },
      global: { fetch: (input, options = {}) => fetch(input, { ...options, signal: AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)].filter(Boolean)) }) },
      realtime: { timeout: TIMEOUT_MS },
    });
    clients[role] = client;
    await client.realtime.setAuth(token);
    const profile = await success(client.from("profiles").select("id,role,verification_status,account_status").eq("id", account.id).single(), `${role} realtime student state`);
    check(profile.id === account.id && profile.role === "student" && profile.verification_status === "verified" && profile.account_status === "active", "realtime fixtures must be eligible students");
  }
}

async function runChecks(context, clients, observers) {
  await preflight(context);
  await createSubscribers(context, clients);
  const { accounts, runId } = context;
  const listingId = await publishListing(context, clients.seller);
  const conversationId = await success(clients.buyer.rpc("start_listing_conversation", { p_listing_id: listingId }), "realtime buyer conversation");
  const controlId = await success(clients.competitor.rpc("start_listing_conversation", { p_listing_id: listingId }), "third account positive-control conversation");
  check(uuid.test(conversationId) && uuid.test(controlId) && conversationId !== controlId, "target and control conversations must be distinct");
  const conversation = await success(clients.buyer.from("conversations").select("buyer_id,seller_id,listing_id").eq("id", conversationId).single(), "target participant identities");
  check(conversation.buyer_id === accounts.buyer.id && conversation.seller_id === accounts.seller.id && conversation.listing_id === listingId, "target conversation must have exactly the seller and buyer fixtures");
  check(isInvisibleDataResult(await clients.competitor.from("messages").select("id,body").eq("conversation_id", conversationId)), "third account cannot read target message history");

  const seller = createMessageObserver(clients.seller, "seller", runId, [conversationId]);
  const buyer = createMessageObserver(clients.buyer, "buyer", runId, [conversationId]);
  // Both bindings share the same third-account channel and WebSocket. A live
  // control subscription prevents an outage from masquerading as RLS denial.
  const competitor = createMessageObserver(clients.competitor, "competitor", runId, [conversationId, controlId], conversationId);
  observers.push(seller, buyer, competitor);
  await waitFor(() => observers.every(isMessageObserverReady), "three authenticated database change subscriptions", observers, { requireSubscribed: false });

  const controlBefore = await send(clients.seller, accounts.seller.id, controlId, "control-before", runId);
  const beforeDelivery = await delivery(competitor, controlBefore, "INSERT", observers);
  const buyerMessage = await send(clients.buyer, accounts.buyer.id, conversationId, "buyer-to-seller", runId);
  await Promise.all([delivery(seller, buyerMessage, "INSERT", observers), delivery(buyer, buyerMessage, "INSERT", observers)]);
  const sellerMessage = await send(clients.seller, accounts.seller.id, conversationId, "seller-to-buyer", runId);
  await Promise.all([delivery(seller, sellerMessage, "INSERT", observers), delivery(buyer, sellerMessage, "INSERT", observers)]);
  check(await success(clients.seller.rpc("mark_conversation_read", { p_conversation_id: conversationId }), "seller mark-read RPC") === 1, "seller marks only the buyer's message read");
  await Promise.all([delivery(seller, buyerMessage, "UPDATE", observers), delivery(buyer, buyerMessage, "UPDATE", observers)]);
  check(await success(clients.buyer.rpc("mark_conversation_read", { p_conversation_id: conversationId }), "buyer mark-read RPC") === 1, "buyer marks only the seller's message read");
  await Promise.all([delivery(seller, sellerMessage, "UPDATE", observers), delivery(buyer, sellerMessage, "UPDATE", observers)]);

  const windowStartedAt = performance.now();
  await waitFor(() => performance.now() - windowStartedAt >= DENIAL_WINDOW_MS, "bounded unauthorized receive window", observers, { timeoutMs: MAX_DENIAL_WINDOW_MS });
  const windowEndedAt = performance.now();
  const controlAfter = await send(clients.seller, accounts.seller.id, controlId, "control-after", runId);
  const afterDelivery = await delivery(competitor, controlAfter, "INSERT", observers);
  const denialEvidence = {
    subscribedAt: competitor.subscribedAt, positiveControlBeforeAt: beforeDelivery.receivedAt,
    windowStartedAt, windowEndedAt, positiveControlAfterAt: afterDelivery.receivedAt,
    targetParticipantDeliveries: [seller, buyer].reduce((total, observer) => total + observer.events.length, 0),
    targetUnauthorizedDeliveries: competitor.events.filter((event) => event.row.conversation_id === conversationId).length,
    transportFailureCount: competitor.failures.length, protocolFailureCount: competitor.protocolFailures,
    postgresFailureCount: competitor.postgresFailures, postgresReadyAfterWindow: competitor.postgresChangesStatus === "ok",
    subscribedAfterWindow: competitor.status === "SUBSCRIBED" && clients.competitor.realtime.isConnected(),
  };
  check(isValidRealtimeDenialEvidence(denialEvidence), "third-account denial needs healthy positive controls and the full receive window");
  check(isInvisibleDataResult(await clients.competitor.from("messages").select("id,body").eq("conversation_id", conversationId)), "third-account message history remains hidden after delivery");

  const baseline = await success(clients.buyer.from("messages").select("id").eq("conversation_id", conversationId), "buyer pre-disconnect history");
  check(baseline.length === 2 && baseline.some((row) => row.id === buyerMessage.id) && baseline.some((row) => row.id === sellerMessage.id), "catch-up baseline must contain both delivered messages");
  buyer.closing = true;
  check(await clients.buyer.removeChannel(buyer.channel) === "ok", "buyer channel must unsubscribe before controlled disconnect");
  check(await clients.buyer.realtime.disconnect(1000, "QA controlled reconnect") === "ok", "buyer socket must close successfully");
  const offlineStartedAt = performance.now();
  check(!clients.buyer.realtime.isConnected() && clients.buyer.realtime.connectionState() === "closed", "buyer must actually be disconnected before the missed write");
  const liveObservers = [seller, competitor];
  const missed = await send(clients.seller, accounts.seller.id, conversationId, "during-buyer-disconnect", runId);
  await delivery(seller, missed, "INSERT", liveObservers);
  // Keep the socket closed through a bounded observation interval while the
  // seller's positive delivery proves the write reached the realtime service.
  await pause(250);
  assertHealthy(liveObservers);
  check(!clients.buyer.realtime.isConnected() && clients.buyer.realtime.connectionState() === "closed"
    && !buyer.events.some((event) => event.row.id === missed.id), "missed message must be persisted while buyer realtime is disconnected");
  const offlineEndedAt = performance.now();
  const reconnected = createMessageObserver(clients.buyer, "buyer-reconnected", runId, [conversationId]);
  observers.push(reconnected);
  const resumedObservers = [seller, competitor, reconnected];
  await waitFor(() => isMessageObserverReady(reconnected), "buyer reconnect database change subscription", resumedObservers, { requireSubscribed: false });
  assertHealthy(resumedObservers);
  const history = await success(clients.buyer.from("messages").select("id,conversation_id,sender_id,body,created_at,read_at").eq("conversation_id", conversationId).order("created_at", { ascending: true }).order("id", { ascending: true }), "authorized reconnect history catch-up");
  check(history.length === 3 && new Set(history.map((row) => row.id)).size === history.length
    && baseline.every((row) => history.some((message) => message.id === row.id)), "reconnect history must retain the baseline without duplicate rows");
  check(history.filter((row) => row.id === missed.id && row.conversation_id === conversationId && row.sender_id === missed.senderId && row.body === missed.body).length === 1, "authorized history fetch must recover the exact missed message once");
  const resumed = await send(clients.seller, accounts.seller.id, conversationId, "after-buyer-reconnect", runId);
  await Promise.all([delivery(seller, resumed, "INSERT", resumedObservers), delivery(reconnected, resumed, "INSERT", resumedObservers)]);
  assertHealthy(resumedObservers);

  return {
    count: 4,
    scenarios: [
      { name: "participant_insert_delivery", passed: true, evidence: { studentSessions: 3, directions: 2, participantDeliveries: 4 } },
      { name: "participant_read_update_delivery", passed: true, evidence: { recipientReadUpdates: 2, participantDeliveries: 4 } },
      { name: "third_account_realtime_denial", passed: true, evidence: { positiveControlDeliveries: 2, receiveWindowMs: Math.floor(windowEndedAt - windowStartedAt), unauthorizedDeliveries: 0, transportFailures: 0 } },
      { name: "reconnect_authorized_history_catchup", passed: true, evidence: { mode: "controlled_realtime_socket_disconnect_then_authorized_history_fetch", disconnectedDuringPersistedWrite: true, disconnectedMs: Math.floor(offlineEndedAt - offlineStartedAt), recoveredMissedMessages: 1, resumedParticipantDeliveries: 2, browserOfflineTested: false, websocketReplayClaimed: false } },
    ],
  };
}

/** Requires real disposable Supabase services; never substitute mocked events. */
export async function runRealtimeChecks(context) {
  const clients = {};
  const observers = [];
  let result;
  let failure;
  try { result = await runChecks(context, clients, observers); }
  catch (error) {
    failure = error instanceof RealtimeCheckError ? error : new RealtimeCheckError("Realtime acceptance could not complete. Check the disposable QA services, publication, and fixture sessions; no live acceptance was recorded.");
  } finally {
    for (const observer of observers) observer.closing = true;
    const cleanup = await Promise.allSettled(Object.values(clients).map(async (client) => {
      let removals;
      try { removals = await client.removeAllChannels(); }
      finally { await client.realtime.disconnect(); }
      check(removals.every((status) => status === "ok"), "all owned realtime channels must close cleanly");
    }));
    if (!failure && cleanup.some((entry) => entry.status === "rejected")) failure = new RealtimeCheckError("Realtime acceptance failed: owned socket cleanup did not complete.");
  }
  if (failure) throw failure;
  return result;
}
