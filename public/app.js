
const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const initData = tg?.initData || "";

const $ = (id) => document.getElementById(id);
const detail = $("detail");

let currentUser = null;
let profileError = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initData,
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function showDetail(title, body) {
  detail.classList.remove("hidden");

  detail.innerHTML = `
    <div class="section-head">
      <h3>${safeText(title)}</h3>
      <button class="small-btn" id="closeDetail">Close</button>
    </div>
    ${body}
  `;

  $("closeDetail").onclick = () => {
    detail.classList.add("hidden");
  };
}

function profileContent() {
  if (!initData) {
    return `
      <p class="muted">
        Please open NEXORA from your Telegram bot.
      </p>
    `;
  }

  if (!currentUser) {
    return `
      <p class="muted">
        ${safeText(profileError || "Loading Telegram profile...")}
      </p>
      <button class="outline-btn" id="retryProfile">
        Try Again
      </button>
    `;
  }

  const fullName = [
    currentUser.firstName,
    currentUser.lastName
  ].filter(Boolean).join(" ") || "NEXORA User";

  return `
    <div class="profile-info">
      <p><b>Name:</b> ${safeText(fullName)}</p>

      <p><b>Username:</b>
        ${safeText(
          currentUser.username
            ? "@" + currentUser.username
            : "Not set"
        )}
      </p>

      <p><b>Telegram ID:</b>
        ${safeText(currentUser.telegramId)}
      </p>

      <p><b>NEX Balance:</b>
        ${Number(currentUser.balanceNex || 0).toFixed(4)}
      </p>

      <p><b>Total Mined:</b>
        ${Number(currentUser.totalMinedNex || 0).toFixed(4)} NEX
      </p>

      <p><b>Wallet:</b>
        ${safeText(currentUser.walletAddress || "Not connected")}
      </p>

      <p><b>Mining:</b>
        ${currentUser.miningActive ? "Active" : "Not Active"}
      </p>
    </div>
  `;
}

async function loadProfile() {
  if (!initData) {
    profileError = "Open this app from your Telegram bot to sign in.";
    $("minerHint").textContent = profileError;
    return;
  }

  try {
    profileError = null;

    const data = await api("/api/me");

    currentUser = data.user;

    $("avatar").textContent = (
      currentUser.firstName || "N"
    ).slice(0, 1).toUpperCase();

    $("balance").textContent = Number(
      currentUser.balanceNex || 0
    ).toFixed(4);

    $("minerState").textContent = currentUser.miningActive
      ? "MINING ACTIVE"
      : "NOT ACTIVE";

    $("minerHint").textContent = "Telegram account connected.";

  } catch (e) {
    profileError = e.message;
    $("minerHint").textContent = e.message;
  }
}

$("activateBtn").addEventListener("click", () => {
  showDetail(
    "Activate miner",
    `
      <p class="muted">
        Activation requires a 0.1 GRAM payment.
        Payment verification is not configured yet.
        The miner cannot be activated until the server
        verifies the payment.
      </p>
    `
  );
});

document.querySelectorAll("[data-tab]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const tab = btn.dataset.tab;

    const content = {
      wallet: `
        <p class="muted">
          Connect a TON wallet using TON Connect.
          Wallet ownership must be verified before withdrawals.
        </p>
        <button class="outline-btn" disabled>
          TON Connect integration — coming soon
        </button>
      `,

      invite: `
        <p class="muted">
          Your personal referral link will appear here
          after referral tracking is enabled.
        </p>
      `,

      tasks: `
        <p class="muted">
          Tasks: watch an ad (+50 NEX),
          join channel 1 (+100 NEX),
          join channel 2 (+100 NEX).
          Rewards require server-side verification.
        </p>
      `,

      boost: `
        <p class="muted">
          NEX purchases can increase mining speed
          after on-chain payment confirmation.
        </p>
      `
    };

    if (tab === "profile") {
      if (!currentUser && !profileError) {
        await loadProfile();
      }

      showDetail("Profile", profileContent());

      const retry = $("retryProfile");

      if (retry) {
        retry.onclick = async () => {
          profileError = null;
          retry.disabled = true;
          retry.textContent = "Loading...";

          await loadProfile();

          showDetail("Profile", profileContent());
        };
      }

      return;
    }

    showDetail(
      tab[0].toUpperCase() + tab.slice(1),
      content[tab] || ""
    );
  });
});

document.querySelectorAll("[data-task]").forEach(btn => {
  btn.addEventListener("click", () => {
    showDetail(
      "Watch an ad",
      `
        <p class="muted">
          Ad provider integration is not configured yet.
          Rewards will only be credited after a valid
          ad completion callback.
        </p>
      `
    );
  });
});

loadProfile();
