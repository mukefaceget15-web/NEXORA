const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }
const initData = tg?.initData || "";
const $ = (id) => document.getElementById(id);
const detail = $("detail");

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": initData, ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
function showDetail(title, body) {
  detail.classList.remove("hidden");
  detail.innerHTML = `<div class="section-head"><h3>${title}</h3><button class="small-btn" id="closeDetail">Close</button></div>${body}`;
  $("closeDetail").onclick = () => detail.classList.add("hidden");
}
function safeText(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

async function loadProfile() {
  if (!initData) {
    $("minerHint").textContent = "Open this app from your Telegram bot to sign in securely.";
    return;
  }
  try {
    const data = await api("/api/me");
    const u = data.user;
    $("avatar").textContent = (u.firstName || "N").slice(0,1).toUpperCase();
    $("balance").textContent = Number(u.balanceNex || 0).toFixed(4);
    $("minerState").textContent = u.miningActive ? "MINING ACTIVE" : "NOT ACTIVE";
  } catch (e) { $("minerHint").textContent = e.message; }
}
$("activateBtn").addEventListener("click", () => {
  showDetail("Activate miner", `<p class="muted">Activation requires a 0.1 GRAM payment to the verified NEXORA receiving wallet. Payment verification is being configured; the miner cannot be activated by a client-side button alone.</p>`);
});
document.querySelectorAll("[data-tab]").forEach(btn => btn.addEventListener("click", () => {
  const tab = btn.dataset.tab;
  const content = {
    wallet: `<p class="muted">Connect a TON wallet using TON Connect. Wallet ownership must be verified before withdrawals.</p><button class="outline-btn" disabled>TON Connect integration — next step</button>`,
    invite: `<p class="muted">Your personal referral link will appear here after Telegram authentication and referral tracking are enabled.</p>`,
    tasks: `<p class="muted">Tasks: watch an ad (+50 NEX), join channel 1 (+100 NEX), join channel 2 (+100 NEX). Rewards are credited only after server-side verification.</p>`,
    boost: `<p class="muted">NEX purchases can increase mining speed after on-chain payment confirmation. Boost levels will be configured later.</p>`,
    profile: `<p class="muted">Telegram profile details are loaded from verified Telegram Mini App initData.</p>`
  };
  showDetail(tab[0].toUpperCase()+tab.slice(1), content[tab] || "");
}));
document.querySelectorAll("[data-task]").forEach(btn => btn.addEventListener("click", () => showDetail("Watch an ad", `<p class="muted">Ad provider integration is not configured yet. NEX rewards will only be credited after a valid ad completion callback.</p>`)));
loadProfile();