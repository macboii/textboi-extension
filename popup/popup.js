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

async function renderLoggedOut() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="tb-header">
      <img src="../icons/icon32.png" class="tb-logo-img" alt="TextBoi">
      <span class="tb-logo">TextBoi</span>
    </div>
    <div class="tb-activation-row">
      <span class="tb-activation-label">Activation</span>
      <label class="tb-toggle" title="Enable / disable extension">
        <input type="checkbox" id="ext-toggle">
        <span class="tb-toggle-slider"></span>
      </label>
    </div>
    <div class="tb-guest-quota-wrap" id="guest-quota-wrap">
      <div class="tb-guest-quota-bar-bg">
        <div class="tb-guest-quota-bar-fill" id="guest-quota-fill" style="width:100%"></div>
      </div>
      <p class="tb-guest-quota-text" id="guest-quota-text">Loading free uses…</p>
    </div>
    <div class="tb-auth">
      <button id="login-btn" class="tb-btn tb-btn--primary">Sign in with Google</button>
      <p class="tb-auth-hint">Sign in for more usage &amp; all models</p>
    </div>
  `;

  _bindToggle();

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

  // 게스트 잔여 횟수 로드 — GET_GUEST_QUOTA는 /device/free-status (읽기 전용) 사용
  try {
    const res = await chrome.runtime.sendMessage({ type: "GET_GUEST_QUOTA" });
    const quota = res?.quota;
    const GUEST_MAX = 10;
    const remaining = typeof quota?.remaining === "number" ? quota.remaining : GUEST_MAX;
    const limitExceeded = quota?.limitExceeded === true || remaining <= 0;
    const pct = Math.max(0, (remaining / GUEST_MAX) * 100);

    const fillEl = document.getElementById("guest-quota-fill");
    const textEl = document.getElementById("guest-quota-text");
    if (fillEl) {
      fillEl.style.width = `${pct}%`;
      if (limitExceeded) fillEl.classList.add("tb-guest-quota-bar-fill--low");
      else if (remaining <= 2) fillEl.classList.add("tb-guest-quota-bar-fill--low");
    }
    if (textEl) {
      if (limitExceeded) {
        textEl.textContent = "No free uses left — sign in to continue";
        textEl.classList.add("tb-guest-quota-text--empty");
      } else {
        textEl.textContent = `${remaining} of ${GUEST_MAX} free uses remaining`;
      }
    }
  } catch {
    const textEl = document.getElementById("guest-quota-text");
    if (textEl) textEl.textContent = "10 free uses available";
  }
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
    <div class="tb-activation-row">
      <span class="tb-activation-label">Activation</span>
      <label class="tb-toggle" title="Enable / disable extension">
        <input type="checkbox" id="ext-toggle">
        <span class="tb-toggle-slider"></span>
      </label>
    </div>
    <p class="tb-email" id="tb-email"></p>
    <div class="tb-plan-section" id="plan-section">
      <div class="tb-plan-loading">Loading plan...</div>
    </div>
  `;

  document.getElementById("tb-email").textContent = email;

  _bindToggle();

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
    actionBtn = `<button class="tb-btn tb-btn--upgrade" id="plan-action-btn">Get Basic — $5 / mo</button>`;
  } else {
    actionBtn = `<button class="tb-btn tb-btn--manage" id="plan-action-btn">Manage Subscription</button>`;
  }

  const cancelNotice = isScheduledCancel
    ? `<p class="tb-cancel-notice">Subscription ends on ${renewalDate}</p>`
    : "";

  const renewalLine = daysUntilRenewal !== null
    ? `<p class="tb-renewal-dday">
        <span class="tb-renewal-label">${isFree ? "Resets" : "Renews"}</span>
        <span class="tb-renewal-date">${renewalDate}</span>
        <span class="tb-renewal-sep">·</span>
        <span class="tb-renewal-days">${daysUntilRenewal} day${daysUntilRenewal !== 1 ? "s" : ""} left</span>
       </p>`
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
          <span class="tb-plan-name">FREE</span>
          <span class="tb-plan-price">$0<span class="tb-plan-per"> / month</span></span>
        </div>
        <p class="tb-plan-subtitle">Enough for daily use</p>
        <ul class="tb-plan-features">
          <li>150,000 characters / month</li>
          <li>10 free uses as guest (no signup)</li>
          <li>150+ languages</li>
          <li>Proofreading &amp; grammar check</li>
          <li>GPT-4o mini</li>
        </ul>
      </div>
      <div class="tb-plan-card tb-plan-card--basic${!isFree ? " tb-plan-card--active" : ""}">
        <div class="tb-plan-card-header">
          <span class="tb-plan-name">BASIC <span class="tb-popular-badge">Most Popular</span></span>
          <span class="tb-plan-price">$5<span class="tb-plan-per"> / month</span></span>
        </div>
        <p class="tb-plan-subtitle">Use it all day, every day</p>
        <ul class="tb-plan-features">
          <li>9,000,000 characters / month — no daily limits</li>
          <li>150+ languages</li>
          <li>Proofreading &amp; grammar check</li>
          <li>Dictionary lookup</li>
          <li>Revision insights</li>
          <li>All models: 4o-mini, 4o, 4.1, 4.1-mini, 5</li>
        </ul>
        <div class="tb-plan-card-action">
          ${actionBtn}
          ${cancelNotice}
        </div>
      </div>
    </div>
    <a href="https://textboi.ai" target="_blank" class="tb-visit-link">Want more power? Visit textboi.ai →</a>
    <div class="tb-legal-links">
      <a href="https://textboi.ai/terms" target="_blank" class="tb-legal-link">Terms of Service</a>
      <span class="tb-legal-sep">·</span>
      <a href="https://textboi.ai/privacy" target="_blank" class="tb-legal-link">Privacy Policy</a>
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
      if (btn) { btn.disabled = false; btn.textContent = "Get Basic — $5 / mo"; }
    }
    // url이 있으면 background.js가 이미 탭을 열었음
  } catch {
    showPopupToast("Checkout failed. Please try again.");
    if (btn) { btn.disabled = false; btn.textContent = "Get Basic — $5 / mo"; }
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

function _bindToggle() {
  const checkbox = document.getElementById("ext-toggle");
  if (!checkbox) return;

  // 저장된 상태 로드 (기본값: true)
  chrome.storage.local.get("tb_enabled", ({ tb_enabled }) => {
    checkbox.checked = tb_enabled !== false;
  });

  checkbox.addEventListener("change", () => {
    chrome.storage.local.set({ tb_enabled: checkbox.checked });
  });
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
