const DAILY_RATE = 320;
const ACTIVATION_AMOUNT = "0.1";
const ACTIVATION_ASSET = "GRAM";

/**
 * NEXORA starter API.
 * Important: activation deliberately remains disabled until a real on-chain
 * payment verifier is configured. Never trust a client-provided "paid" flag.
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, app: "NEXORA", miningDailyRate: DAILY_RATE });
    }

    if (url.pathname === "/api/telegram/webhook" && request.method === "POST") {
      return handleTelegramWebhook(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      const auth = await authenticateTelegram(request, env);
      if (!auth.ok) return json({ error: auth.error }, 401);

      const telegramUser = auth.user;
      if (url.pathname === "/api/me" && request.method === "GET") {
        await upsertTelegramUser(env.DB, telegramUser);
        const user = await getUser(env.DB, String(telegramUser.id));
        return json({ user: publicUser(user), miningDailyRate: DAILY_RATE });
      }

      if (url.pathname === "/api/mining/start" && request.method === "POST") {
        // Do not activate until payment status is verified by the server.
        const user = await getUser(env.DB, String(telegramUser.id));
        if (!user) return json({ error: "User not found" }, 404);
        return json({
          error: "Activation payment verification is not configured yet.",
          requiredAmount: ACTIVATION_AMOUNT,
          asset: ACTIVATION_ASSET
        }, 409);
      }

      if (url.pathname === "/api/mining/status" && request.method === "GET") {
        const user = await getUser(env.DB, String(telegramUser.id));
        if (!user) return json({ error: "User not found" }, 404);
        const now = Math.floor(Date.now() / 1000);
        const elapsed = user.mining_started_at ? Math.max(0, now - user.mining_started_at) : 0;
        const accrued = user.mining_started_at ? Math.min(DAILY_RATE, elapsed * DAILY_RATE / 86400) : 0;
        return json({
          active: Boolean(user.mining_started_at),
          dailyRate: DAILY_RATE,
          accruedSinceStart: Number(accrued.toFixed(8)),
          balance: user.balance_nex
        });
      }

      if (url.pathname === "/api/wallet/link" && request.method === "POST") {
        const body = await safeJson(request);
        if (!body || typeof body.address !== "string" || body.address.length > 128) {
          return json({ error: "Invalid wallet address" }, 400);
        }
        // Linking an address is not proof of ownership. Add TON Connect proof verification
        // before allowing withdrawals or sensitive wallet actions.
        await env.DB.prepare(
          "UPDATE users SET wallet_address = ?, updated_at = ? WHERE telegram_id = ?"
        ).bind(body.address, Math.floor(Date.now()/1000), String(telegramUser.id)).run();
        return json({ ok: true, note: "Address saved; ownership proof is not yet verified." });
      }

      return json({ error: "Not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};

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
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join("\n");
  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey("raw", encoder.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(env.TELEGRAM_BOT_TOKEN));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(dataCheckString));
  const calculated = [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, "0")).join("");
  if (!timingSafeEqual(calculated, hash)) return { ok: false, error: "Invalid Telegram signature." };
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Math.floor(Date.now()/1000) - authDate > 86400) return { ok: false, error: "Telegram session expired." };
  let user;
  try { user = JSON.parse(params.get("user") || "null"); } catch {}
  if (!user?.id) return { ok: false, error: "Telegram user missing." };
  return { ok: true, user };
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
async function upsertTelegramUser(db, u) {
  const now = Math.floor(Date.now()/1000);
  await db.prepare(`INSERT INTO users (telegram_id, username, first_name, last_name, photo_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name,
    last_name=excluded.last_name, photo_url=excluded.photo_url, updated_at=excluded.updated_at`)
    .bind(String(u.id), u.username || null, u.first_name || null, u.last_name || null, u.photo_url || null, now, now).run();
}
async function getUser(db, id) {
  return db.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(id).first();
}
function publicUser(u) {
  return {
    telegramId: u.telegram_id, username: u.username, firstName: u.first_name,
    lastName: u.last_name, photoUrl: u.photo_url, walletAddress: u.wallet_address,
    balanceNex: u.balance_nex, totalMinedNex: u.total_mined_nex,
    miningActive: Boolean(u.mining_started_at)
  };
}
async function handleTelegramWebhook(request, env) {
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) return json({ error: "Unauthorized" }, 401);
  const update = await safeJson(request);
  const message = update?.message;
  if (message?.text?.startsWith("/start")) {
    const chatId = message.chat.id;
    const text = "Welcome to NEXORA! Open the Mini App to view your mining dashboard.";
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  }
  return json({ ok: true });
}
