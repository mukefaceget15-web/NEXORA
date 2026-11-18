// NEXORA Worker — server-side ledger. The browser never decides balances or payments.

const num = (v, d) => (v !== undefined && v !== "" && !isNaN(Number(v)) ? Number(v) : d);
const now = () => Math.floor(Date.now() / 1000);

function cfg(env) {
  return {
    baseRate: num(env.MINING_DAILY_RATE, 320),
    boostPer1k: num(env.BOOST_PER_1K, 100),
    refBonus: num(env.REF_BONUS, 500),
    minWithdraw: num(env.MIN_WITHDRAW, 5000),
    adReward: num(env.AD_REWARD, 50),
    adLimit: num(env.AD_LIMIT, 5),
    adSeconds: num(env.AD_SECONDS, 10),
    payNano: String(env.PAY_NANO || "100000000"), // 0.1 TON
    channelReward: num(env.CHANNEL_REWARD, 100),
    channels: [env.CHANNEL_1, env.CHANNEL_2].filter(Boolean)
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        app: "NEXORA",
        hasBotToken: Boolean(env.TELEGRAM_BOT_TOKEN),
        hasPayAddress: Boolean(env.PAY_ADDRESS),
        hasTonKey: Boolean(env.TONCENTER_API_KEY),
        hasDb: Boolean(env.DB)
      });
    }
    if (url.pathname === "/api/telegram/webhook" && request.method === "POST") return handleTelegramWebhook(request, env);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const auth = await authenticateTelegram(request, env);
    if (!auth.ok) return json({ error: auth.error }, 401);
    const tg = auth.user, id = String(tg.id), C = cfg(env), p = url.pathname, m = request.method;

    try {
      await upsertTelegramUser(env.DB, tg, auth.startParam);
      if (p === "/api/me" && m === "GET") return json(await state(env, id, C));
      if (p === "/api/wallet/link" && m === "POST") return walletLink(request, env, id);
      if (p === "/api/pay/create" && m === "POST") return payCreate(env, id);
      if (p === "/api/pay/verify" && m === "POST") return payVerify(env, id, C);
      if (p === "/api/boost" && m === "POST") return boost(request, env, id, C);
      if (p === "/api/task/ad/start" && m === "POST") return adStart(env, id, C);
      if (p === "/api/task/ad/claim" && m === "POST") return adClaim(env, id, C);
      if (p === "/api/task/channel" && m === "POST") return channelClaim(request, env, id, C);
      if (p === "/api/withdraw" && m === "POST") return withdraw(request, env, id, C);
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: "Server error" }, 500);
    }
  }
};

/* ---------- ledger helpers ---------- */
const rateOf = (u, C) => C.baseRate + (u.boost_spent || 0) / 1000 * C.boostPer1k;
function liveBalance(u, C) {
  const bal = u.balance_nex || 0;
  if (!u.mining_started_at) return bal;
  const last = u.last_accrual_at || u.mining_started_at;
  return bal + Math.max(0, now() - last) * rateOf(u, C) / 86400;
}
// Move accrued mining into the stored balance. Call before any balance change.
async function checkpoint(env, id, C) {
  const u = await getUser(env.DB, id);
  if (u.mining_started_at) {
    const add = liveBalance(u, C) - (u.balance_nex || 0);
    await env.DB.prepare("UPDATE users SET balance_nex = balance_nex + ?, total_mined_nex = COALESCE(total_mined_nex,0) + ?, last_accrual_at = ?, updated_at = ? WHERE telegram_id = ?")
      .bind(add, add, now(), now(), id).run();
  }
  return getUser(env.DB, id);
}
async function state(env, id, C) {
  const u = await getUser(env.DB, id);
  const refs = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN mining_started_at IS NOT NULL THEN 1 ELSE 0 END) AS active FROM users WHERE referrer_id = ?").bind(id).first();
  const done = await env.DB.prepare("SELECT task_key FROM tasks_done WHERE telegram_id = ?").bind(id).all();
  const keys = (done.results || []).map(r => r.task_key);
  const wd = await env.DB.prepare("SELECT amount, status, created_at FROM withdrawals WHERE telegram_id = ? ORDER BY id DESC LIMIT 5").bind(id).all();
  const today = new Date().toISOString().slice(0, 10);
  return {
    user: publicUser(u),
    balance: liveBalance(u, C),
    rate: rateOf(u, C),
    level: 1 + Math.floor((u.boost_spent || 0) / 5000),
    refs: { total: refs?.total || 0, active: refs?.active || 0 },
    ads: { count: u.ad_day === today ? u.ad_count : 0, limit: C.adLimit },
    channelsDone: C.channels.map((_, i) => keys.includes("channel_" + i)),
    withdrawals: wd.results || [],
    config: {
      payAddress: env.PAY_ADDRESS, payNano: C.payNano, minWithdraw: C.minWithdraw, boostPer1k: C.boostPer1k,
      refBonus: C.refBonus, adReward: C.adReward, adSeconds: C.adSeconds, channelReward: C.channelReward,
      channels: C.channels.map(c => "https://t.me/" + c.replace("@", ""))
    }
  };
}

/* ---------- wallet ---------- */
async function walletLink(request, env, id) {
  const b = await safeJson(request);
  if (!b || typeof b.address !== "string" || b.address.length > 128) return json({ error: "Invalid wallet address" }, 400);
  await env.DB.prepare("UPDATE users SET wallet_address = ?, updated_at = ? WHERE telegram_id = ?").bind(b.address, now(), id).run();
  return json({ ok: true });
}

/* ---------- activation payment (0.1 TON, verified on-chain) ---------- */
async function payCreate(env, id) {
  const u = await getUser(env.DB, id);
  if (u.mining_started_at) return json({ error: "Already active" }, 409);
  const old = await env.DB.prepare("SELECT code FROM payments WHERE telegram_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").bind(id).first();
  if (old) return json({ code: old.code });
  const code = "nx" + [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO payments (code, telegram_id, created_at) VALUES (?, ?, ?)").bind(code, id, now()).run();
  return json({ code });
}
function commentOf(msg) {
  if (typeof msg.message === "string" && msg.message) return msg.message.trim();
  const t = msg.msg_data && msg.msg_data.text;
  if (t) { try { return new TextDecoder().decode(Uint8Array.from(atob(t), c => c.charCodeAt(0))).trim(); } catch { return ""; } }
  return "";
}
async function findPayment(env, code, since, C) {
  if (!env.PAY_ADDRESS) return null;
  const r = await fetch("https://toncenter.com/api/v2/getTransactions?limit=50&address=" + encodeURIComponent(env.PAY_ADDRESS),
    { headers: env.TONCENTER_API_KEY ? { "X-API-Key": env.TONCENTER_API_KEY } : {} });
  const d = await r.json();
  if (!d.ok) return null;
  for (const tx of d.result || []) {
    const m = tx.in_msg;
    if (!m || !m.source) continue;
    if (commentOf(m) !== code) continue;
    if (BigInt(m.value || "0") < BigInt(C.payNano)) continue;
    if ((tx.utime || 0) < since - 120) continue;
    return tx.transaction_id && tx.transaction_id.hash;
  }
  return null;
}
async function payVerify(env, id, C) {
  const u = await getUser(env.DB, id);
  if (u.mining_started_at) return json({ ok: true, already: true });
  const pend = await env.DB.prepare("SELECT code, created_at FROM payments WHERE telegram_id = ? AND status = 'pending'").bind(id).all();
  for (const row of pend.results || []) {
    const hash = await findPayment(env, row.code, row.created_at, C);
    if (!hash) continue;
    const claim = await env.DB.prepare("UPDATE payments SET status = 'done', tx_hash = ? WHERE code = ? AND status = 'pending'").bind(hash, row.code).run();
    if (!claim.meta.changes) continue;
    await env.DB.prepare("UPDATE users SET mining_started_at = ?, last_accrual_at = ?, updated_at = ? WHERE telegram_id = ? AND mining_started_at IS NULL").bind(now(), now(), now(), id).run();
    if (u.referrer_id) await env.DB.prepare("UPDATE users SET balance_nex = balance_nex + ? WHERE telegram_id = ?").bind(C.refBonus, u.referrer_id).run();
    return json({ ok: true, activated: true });
  }
  return json({ ok: false, error: "Payment not found yet. Wait a minute and try again." }, 404);
}

/* ---------- boost ---------- */
async function boost(request, env, id, C) {
  const b = await safeJson(request), a = Number(b && b.amount);
  if (!(a > 0) || a > 1e9) return json({ error: "Invalid amount" }, 400);
  await checkpoint(env, id, C);
  const r = await env.DB.prepare("UPDATE users SET balance_nex = balance_nex - ?, boost_spent = boost_spent + ?, updated_at = ? WHERE telegram_id = ? AND balance_nex >= ?").bind(a, a, now(), id, a).run();
  if (!r.meta.changes) return json({ error: "Not enough NEX" }, 400);
  return json(await state(env, id, C));
}

/* ---------- tasks ---------- */
async function adStart(env, id, C) {
  const today = new Date().toISOString().slice(0, 10);
  const u = await getUser(env.DB, id);
  const count = u.ad_day === today ? u.ad_count : 0;
  if (count >= C.adLimit) return json({ error: "Daily ad limit reached" }, 429);
  await env.DB.prepare("UPDATE users SET ad_day = ?, ad_count = ?, ad_started_at = ? WHERE telegram_id = ?").bind(today, count, now(), id).run();
  return json({ ok: true, seconds: C.adSeconds });
}
async function adClaim(env, id, C) {
  const u = await getUser(env.DB, id);
  if (!u.ad_started_at || now() - u.ad_started_at < C.adSeconds - 1) return json({ error: "Ad not finished" }, 400);
  if ((u.ad_count || 0) >= C.adLimit) return json({ error: "Daily ad limit reached" }, 429);
  const r = await env.DB.prepare("UPDATE users SET ad_started_at = NULL, ad_count = ad_count + 1, balance_nex = balance_nex + ? WHERE telegram_id = ? AND ad_started_at IS NOT NULL").bind(C.adReward, id).run();
  if (!r.meta.changes) return json({ error: "Ad not started" }, 400);
  return json(await state(env, id, C));
}
async function channelClaim(request, env, id, C) {
  const b = await safeJson(request), i = Number(b && b.index);
  const ch = C.channels[i];
  if (!ch) return json({ error: "Unknown channel" }, 400);
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(ch)}&user_id=${id}`);
  const d = await res.json();
  const ok = d.ok && ["member", "administrator", "creator"].includes(d.result.status);
  if (!ok) return json({ error: "Join the channel first" }, 400);
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO tasks_done (telegram_id, task_key, created_at) VALUES (?, ?, ?)").bind(id, "channel_" + i, now()).run();
  if (ins.meta.changes) await env.DB.prepare("UPDATE users SET balance_nex = balance_nex + ? WHERE telegram_id = ?").bind(C.channelReward, id).run();
  return json(await state(env, id, C));
}

/* ---------- withdraw (stored as a pending request for manual payout) ---------- */
async function withdraw(request, env, id, C) {
  const b = await safeJson(request), a = Number(b && b.amount);
  let u = await getUser(env.DB, id);
  if (!u.mining_started_at) return json({ error: "Activate your miner first" }, 400);
  if (!u.wallet_address) return json({ error: "Connect your wallet first" }, 400);
  if (!(a >= C.minWithdraw)) return json({ error: "Minimum is " + C.minWithdraw + " NEX" }, 400);
  await checkpoint(env, id, C);
  const r = await env.DB.prepare("UPDATE users SET balance_nex = balance_nex - ?, updated_at = ? WHERE telegram_id = ? AND balance_nex >= ?").bind(a, now(), id, a).run();
  if (!r.meta.changes) return json({ error: "Not enough NEX" }, 400);
  await env.DB.prepare("INSERT INTO withdrawals (telegram_id, amount, wallet_address, created_at) VALUES (?, ?, ?, ?)").bind(id, a, u.wallet_address, now()).run();
  return json(await state(env, id, C));
}

/* ---------- infrastructure ---------- */
function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() } });
}
async function safeJson(request) { try { return await request.json(); } catch { return null; } }

async function authenticateTelegram(request, env) {
  const initData = request.headers.get("X-Telegram-Init-Data") || "";
  if (!initData || !env.TELEGRAM_BOT_TOKEN) return { ok: false, error: "Telegram authentication is not configured." };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "Missing Telegram hash." };
  params.delete("hash");
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const enc = new TextEncoder();
  const secretKey = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", secretKey, enc.encode(env.TELEGRAM_BOT_TOKEN));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(dataCheckString));
  const calc = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
  if (!timingSafeEqual(calc, hash)) return { ok: false, error: "Invalid Telegram signature." };
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || now() - authDate > 86400) return { ok: false, error: "Telegram session expired." };
  let user;
  try { user = JSON.parse(params.get("user") || "null"); } catch {}
  if (!user?.id) return { ok: false, error: "Telegram user missing." };
  return { ok: true, user, startParam: params.get("start_param") || "" };
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
async function upsertTelegramUser(db, u, startParam) {
  const id = String(u.id), t = now();
  const exists = await db.prepare("SELECT 1 AS x FROM users WHERE telegram_id = ?").bind(id).first();
  let ref = null;
  if (!exists && /^ref_\d+$/.test(startParam || "")) {
    const rid = startParam.slice(4);
    if (rid !== id && await db.prepare("SELECT 1 AS x FROM users WHERE telegram_id = ?").bind(rid).first()) ref = rid;
  }
  await db.prepare(`INSERT INTO users (telegram_id, username, first_name, last_name, photo_url, referrer_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name,
    last_name=excluded.last_name, photo_url=excluded.photo_url, updated_at=excluded.updated_at`)
    .bind(id, u.username || null, u.first_name || null, u.last_name || null, u.photo_url || null, ref, t, t).run();
}
async function getUser(db, id) { return db.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(id).first(); }
function publicUser(u) {
  return {
    telegramId: u.telegram_id, username: u.username, firstName: u.first_name, lastName: u.last_name,
    photoUrl: u.photo_url, walletAddress: u.wallet_address, miningActive: Boolean(u.mining_started_at)
  };
}
async function handleTelegramWebhook(request, env) {
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) return json({ error: "Unauthorized" }, 401);
  const update = await safeJson(request);
  const message = update?.message;
  if (message?.text?.startsWith("/start")) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: message.chat.id, text: "Welcome to NEXORA! Open the Mini App to view your mining dashboard." })
    });
  }
  return json({ ok: true });
}
