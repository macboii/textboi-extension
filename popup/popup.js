import { loginWithGoogle, logout } from "../utils/auth.js";
import { getAccessToken } from "../utils/storage.js";

async function init() {
  const token = await getAccessToken();
  token ? renderLoggedIn(token) : renderLoggedOut();
}

function decodeEmail(token) {
  try {
    return JSON.parse(atob(token.split(".")[1])).email || "";
  } catch {
    return "";
  }
}

function renderLoggedOut() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="tb-header">
      <img src="../icons/icon32.png" class="tb-logo-img" alt="TextBoi">
      <span class="tb-logo">TextBoi</span>
    </div>
    <div class="tb-auth">
      <p class="tb-auth-desc">Sign in for unlimited usage.</p>
      <button id="login-btn" class="tb-btn tb-btn--primary">Sign in with Google</button>
    </div>
  `;

  document.getElementById("login-btn").addEventListener("click", async () => {
    const btn = document.getElementById("login-btn");
    btn.disabled = true;
    btn.textContent = "Signing in...";
    try {
      await loginWithGoogle();
      init();
    } catch {
      btn.disabled = false;
      btn.textContent = "Sign in with Google";
    }
  });
}

async function renderLoggedIn(token) {
  const email = decodeEmail(token);
  const app = document.getElementById("app");

  app.innerHTML = `
    <div class="tb-header">
      <img src="../icons/icon32.png" class="tb-logo-img" alt="TextBoi">
      <span class="tb-logo">TextBoi</span>
      <button id="logout-btn" class="tb-btn tb-btn--ghost">Log out</button>
    </div>
    <p class="tb-email" id="tb-email"></p>
    <div class="tb-plan-section" id="plan-section">
      <div class="tb-plan-loading">Loading plan...</div>
    </div>
  `;

  document.getElementById("tb-email").textContent = email;

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await logout();
    init();
  });

  // 캐시된 플랜 먼저 즉시 표시 (로딩 없이)
  const cached = await new Promise((r) =>
    chrome.storage.local.get("tb_current_plan", ({ tb_current_plan }) => r(tb_current_plan || null))
  );
  if (cached) renderPlanSection(cached);

  // 최신 플랜 백그라운드 조회 후 갱신
  const plan = await chrome.runtime.sendMessage({ type: "GET_PLAN" })
    .then((r) => r?.plan)
    .catch(() => null);
  renderPlanSection(plan ?? cached);

  // 결제 완료 후 팝업이 열려 있으면 갱신
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "PLAN_REFRESHED") {
      renderPlanSection(msg.plan);
      showPopupToast("Payment successful! Plan updated.");
    }
    if (msg.type === "QUOTA_REFRESHED") {
      renderPlanSection(msg.plan);
    }
  });
}

function renderPlanSection(plan) {
  const planSection = document.getElementById("plan-section");
  if (!planSection) return;

  const planType = (plan?.plan_type || "free").toLowerCase();
  const planStatus = plan?.plan_status || "active";
  const eventType = plan?.event_type || "";
  const quota = plan?.token_quota ?? 50000;
  const used = Math.min(plan?.token_used ?? 0, quota);
  const remaining = quota - used;
  const pct = quota > 0 ? Math.round((remaining / quota) * 100) : 0;
  const fillClass = pct < 20 ? "tb-quota-fill tb-quota-fill--critical"
    : pct < 50 ? "tb-quota-fill tb-quota-fill--warning"
    : "tb-quota-fill";

  const renewalDate = plan?.billing_period_end
    ? new Date(plan.billing_period_end).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : "-";

  const daysUntilRenewal = plan?.billing_period_end
    ? Math.max(0, Math.ceil((new Date(plan.billing_period_end) - Date.now()) / 86400000))
    : null;

  const isFree = planType === "free";
  const isTrialing = planStatus === "trialing";
  const isScheduledCancel = planStatus === "scheduled" && eventType === "cancel";

  const badgeLabel = isTrialing ? "Trial" : planType.charAt(0).toUpperCase() + planType.slice(1);
  const badgeClass = isTrialing ? "trial" : planType;

  let actionBtn = "";
  if (isFree) {
    actionBtn = `<button class="tb-btn tb-btn--upgrade" id="plan-action-btn">Go Basic – $5/month</button>`;
  } else {
    actionBtn = `<button class="tb-btn tb-btn--manage" id="plan-action-btn">Manage Subscription</button>`;
  }

  const cancelNotice = isScheduledCancel
    ? `<p class="tb-cancel-notice">Subscription ends on ${renewalDate}</p>`
    : "";

  const renewalLine = daysUntilRenewal !== null && !isFree
    ? `<p class="tb-renewal-dday">Renews in ${daysUntilRenewal} day${daysUntilRenewal !== 1 ? "s" : ""}</p>`
    : "";

  planSection.innerHTML = `
    <div class="tb-current-plan">
      <span class="tb-current-plan-label">Current Plan</span>
      <span class="tb-plan-badge tb-plan-badge--${badgeClass}">${badgeLabel}</span>
    </div>
    <div class="tb-quota-wrap">
      <div class="tb-quota-bar">
        <div class="${fillClass}" style="width:${pct}%"></div>
      </div>
      <div class="tb-quota-row">
        <p class="tb-quota-text">${remaining.toLocaleString()} / ${quota.toLocaleString()} tokens remaining</p>
        <button class="tb-quota-refresh-btn" id="quota-refresh-btn" title="Refresh">↻</button>
      </div>
      ${renewalLine}
    </div>
    <div class="tb-plan-cards">
      <div class="tb-plan-card${isFree ? " tb-plan-card--active" : ""}">
        <div class="tb-plan-card-header">
          <span class="tb-plan-name">Free</span>
          <span class="tb-plan-price">$0<span class="tb-plan-per">/mo</span></span>
        </div>
        <ul class="tb-plan-features">
          <li>50,000 tokens / month</li>
          <li>GPT-4o mini</li>
          <li>Translate &amp; Correct</li>
        </ul>
      </div>
      <div class="tb-plan-card tb-plan-card--basic${!isFree ? " tb-plan-card--active" : ""}">
        <div class="tb-plan-card-header">
          <span class="tb-plan-name">Basic</span>
          <span class="tb-plan-price">$5<span class="tb-plan-per">/mo</span></span>
        </div>
        <ul class="tb-plan-features">
          <li>3,000,000 tokens / month</li>
          <li>All models including GPT-4.1</li>
          <li>Diff &amp; Explain</li>
        </ul>
        <div class="tb-plan-card-action">
          ${actionBtn}
          ${cancelNotice}
        </div>
      </div>
    </div>
  `;

  document.getElementById("plan-action-btn")?.addEventListener("click", () => {
    if (isFree) {
      startCheckout("basic");
    } else {
      openPortal();
    }
  });

  document.getElementById("quota-refresh-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("quota-refresh-btn");
    if (btn) btn.style.opacity = "0.4";
    const res = await chrome.runtime.sendMessage({ type: "GET_PLAN" }).catch(() => null);
    renderPlanSection(res?.plan ?? null);
  });
}

async function startCheckout(plan) {
  const btn = document.getElementById("plan-action-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Processing..."; }
  try {
    const res = await chrome.runtime.sendMessage({ type: "STRIPE_CHECKOUT", plan });
    if (res?.isUpgrade) {
      showPopupToast(res.message || "Plan change scheduled.");
    } else if (!res?.ok) {
      showPopupToast("Failed: " + (res?.error || "Unknown error"));
      if (btn) { btn.disabled = false; btn.textContent = "Go Basic – $5/month"; }
    }
    // url이 있으면 background.js가 이미 탭을 열었음
  } catch {
    showPopupToast("Checkout failed. Please try again.");
    if (btn) { btn.disabled = false; btn.textContent = "Go Basic – $5/month"; }
  }
}

async function openPortal() {
  const btn = document.getElementById("plan-action-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Opening..."; }
  try {
    const res = await chrome.runtime.sendMessage({ type: "STRIPE_PORTAL" });
    if (!res?.ok) {
      showPopupToast("Failed: " + (res?.error || "Unknown error"));
    }
  } catch {
    showPopupToast("Unable to open portal. Please try again.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Manage Subscription"; }
  }
}

function showPopupToast(message) {
  let toast = document.getElementById("tb-popup-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "tb-popup-toast";
    toast.className = "tb-popup-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("tb-popup-toast--visible");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("tb-popup-toast--visible"), 3000);
}

init();
