import { loginWithGoogle, logout } from "../utils/auth.js";
import { getAccessToken } from "../utils/storage.js";

const _isKo = (chrome.i18n?.getUILanguage?.() || navigator.language || "").startsWith("ko");
const _p = {
  activation:        _isKo ? "활성화" : "Activation",
  loadingFreeUses:   _isKo ? "무료 사용 횟수 로딩 중…" : "Loading free uses…",
  signInGoogle:      _isKo ? "Google로 로그인" : "Sign in with Google",
  signingIn:         _isKo ? "로그인 중..." : "Signing in...",
  signInForMore:     _isKo ? "로그인하면 더 많은 사용량과 모든 모델을 이용할 수 있습니다" : "Sign in for more usage &amp; all models",
  noFreeUsesLeft:    _isKo ? "무료 사용 횟수 소진 — 계속하려면 로그인하세요" : "No free uses left — sign in to continue",
  freeUsesRemaining: (n, max) => _isKo ? `무료 ${n}/${max}회 남음` : `${n} of ${max} free uses remaining`,
  freeUsesAvailable: _isKo ? "무료 10회 사용 가능" : "10 free uses available",
  logOut:            _isKo ? "로그아웃" : "Log out",
  loadingPlan:       _isKo ? "플랜 로딩 중..." : "Loading plan...",
  currentPlan:       _isKo ? "현재 플랜" : "Current Plan",
  tokensRemaining:   (n, q) => _isKo ? `${n.toLocaleString()} / ${q.toLocaleString()} 토큰 남음` : `${n.toLocaleString()} / ${q.toLocaleString()} tokens remaining`,
  resets:            _isKo ? "초기화" : "Resets",
  renews:            _isKo ? "갱신" : "Renews",
  daysLeft:          (n) => _isKo ? `${n}일 남음` : `${n} day${n !== 1 ? "s" : ""} left`,
  getBasic:          _isKo ? "Basic 시작 — $5 / 월" : "Get Basic — $5 / mo",
  manageSubscription: _isKo ? "구독 관리" : "Manage Subscription",
  subscriptionEnds:  (d) => _isKo ? `구독 종료일: ${d}` : `Subscription ends on ${d}`,
  processing:        _isKo ? "처리 중..." : "Processing...",
  opening:           _isKo ? "열리는 중..." : "Opening...",
  enoughForDaily:    _isKo ? "일상적인 사용에 충분합니다" : "Enough for daily use",
  useAllDay:         _isKo ? "온종일 사용 가능" : "Use it all day, every day",
  perMonth:          _isKo ? " / 월" : " / month",
  mostPopular:       _isKo ? "인기" : "Most Popular",
  paymentSuccess:    _isKo ? "결제 완료! 플랜이 업데이트되었습니다." : "Payment successful! Plan updated.",
  // FREE 플랜 기능 목록
  freeFeature1:      _isKo ? "월 15만 글자" : "150,000 characters / month",
  freeFeature2:      _isKo ? "비로그인 게스트 10회 무료" : "10 free uses as guest (no signup)",
  freeFeature3:      _isKo ? "150개 이상 언어 지원" : "150+ languages",
  freeFeature4:      _isKo ? "맞춤법·문법 교정" : "Proofreading & grammar check",
  freeFeature5:      "GPT-4o mini",
  // BASIC 플랜 기능 목록
  basicFeature1:     _isKo ? "월 900만 글자 — 일일 제한 없음" : "9,000,000 characters / month — no daily limits",
  basicFeature2:     _isKo ? "150개 이상 언어 지원" : "150+ languages",
  basicFeature3:     _isKo ? "맞춤법·문법 교정" : "Proofreading & grammar check",
  basicFeature4:     _isKo ? "사전 검색" : "Dictionary lookup",
  basicFeature5:     _isKo ? "교정 인사이트" : "Revision insights",
  basicFeature6:     _isKo ? "모든 모델: 4o-mini, 4o, 4.1, 4.1-mini, 5" : "All models: 4o-mini, 4o, 4.1, 4.1-mini, 5",
  // 쿠폰
  couponSectionTitle: _isKo ? "🎟️ 프로모션 코드" : "🎟️ Promo Code",
  couponPlaceholder:  _isKo ? "코드 입력 (예: TB-XXXX-XXXX)" : "Enter code (e.g. TB-XXXX-XXXX)",
  couponApply:        _isKo ? "적용" : "Apply",
  couponApplying:     _isKo ? "적용 중..." : "Applying...",
  couponSuccess: (type, value) =>
    type === "token_grant"
      ? (_isKo ? `${Number(value).toLocaleString()} 토큰이 추가되었습니다! 🎉` : `${Number(value).toLocaleString()} tokens added! 🎉`)
      : (_isKo ? `${value}개월 Basic 플랜이 활성화되었습니다! 🎉` : `${value}-month Basic plan activated! 🎉`),
  couponErrorInvalid: _isKo ? "유효하지 않은 코드입니다." : "Invalid code.",
  couponErrorUsed:    _isKo ? "이미 사용한 코드입니다." : "Already used.",
  couponErrorExpired: _isKo ? "만료된 코드입니다." : "Code expired.",
  couponErrorMax:     _isKo ? "사용 한도가 초과된 코드입니다." : "Usage limit reached.",
  // 하단 링크
  visitLink:         _isKo ? "더 많은 기능이 필요하신가요? textboi.ai →" : "Want more power? Visit textboi.ai →",
  termsOfService:    _isKo ? "서비스 이용약관" : "Terms of Service",
  privacyPolicy:     _isKo ? "개인정보처리방침" : "Privacy Policy",
};

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
      <span class="tb-activation-label">${_p.activation}</span>
      <label class="tb-toggle" title="Enable / disable extension">
        <input type="checkbox" id="ext-toggle">
        <span class="tb-toggle-slider"></span>
      </label>
    </div>
    <div class="tb-guest-quota-wrap" id="guest-quota-wrap">
      <div class="tb-guest-quota-bar-bg">
        <div class="tb-guest-quota-bar-fill" id="guest-quota-fill" style="width:100%"></div>
      </div>
      <p class="tb-guest-quota-text" id="guest-quota-text">${_p.loadingFreeUses}</p>
    </div>
    <div class="tb-auth">
      <button id="login-btn" class="tb-btn tb-btn--primary">${_p.signInGoogle}</button>
      <p class="tb-auth-hint">${_p.signInForMore}</p>
    </div>
  `;

  _bindToggle();

  document.getElementById("login-btn").addEventListener("click", async () => {
    const btn = document.getElementById("login-btn");
    btn.disabled = true;
    btn.textContent = _p.signingIn;
    try {
      await loginWithGoogle();
      init();
    } catch {
      btn.disabled = false;
      btn.textContent = _p.signInGoogle;
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
        textEl.textContent = _p.noFreeUsesLeft;
        textEl.classList.add("tb-guest-quota-text--empty");
      } else {
        textEl.textContent = _p.freeUsesRemaining(remaining, GUEST_MAX);
      }
    }
  } catch {
    const textEl = document.getElementById("guest-quota-text");
    if (textEl) textEl.textContent = _p.freeUsesAvailable;
  }
}

async function renderLoggedIn(token) {
  const email = decodeEmail(token);
  const app = document.getElementById("app");

  app.innerHTML = `
    <div class="tb-header">
      <img src="../icons/icon32.png" class="tb-logo-img" alt="TextBoi">
      <span class="tb-logo">TextBoi</span>
      <button id="logout-btn" class="tb-btn tb-btn--ghost">${_p.logOut}</button>
    </div>
    <div class="tb-activation-row">
      <span class="tb-activation-label">${_p.activation}</span>
      <label class="tb-toggle" title="Enable / disable extension">
        <input type="checkbox" id="ext-toggle">
        <span class="tb-toggle-slider"></span>
      </label>
    </div>
    <p class="tb-email" id="tb-email"></p>
    <div class="tb-plan-section" id="plan-section">
      <div class="tb-plan-loading">${_p.loadingPlan}</div>
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
      showPopupToast(_p.paymentSuccess);
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
    ? new Date(plan.billing_period_end).toLocaleDateString(_isKo ? "ko-KR" : "en-US", { year: "numeric", month: "short", day: "numeric" })
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
    actionBtn = `<button class="tb-btn tb-btn--upgrade" id="plan-action-btn">${_p.getBasic}</button>`;
  } else {
    actionBtn = `<button class="tb-btn tb-btn--manage" id="plan-action-btn">${_p.manageSubscription}</button>`;
  }

  const cancelNotice = isScheduledCancel
    ? `<p class="tb-cancel-notice">${_p.subscriptionEnds(renewalDate)}</p>`
    : "";

  const renewalLine = daysUntilRenewal !== null
    ? `<p class="tb-renewal-dday">
        <span class="tb-renewal-label">${isFree ? _p.resets : _p.renews}</span>
        <span class="tb-renewal-date">${renewalDate}</span>
        <span class="tb-renewal-sep">·</span>
        <span class="tb-renewal-days">${_p.daysLeft(daysUntilRenewal)}</span>
       </p>`
    : "";

  planSection.innerHTML = `
    <div class="tb-current-plan">
      <span class="tb-current-plan-label">${_p.currentPlan}</span>
      <span class="tb-plan-badge tb-plan-badge--${badgeClass}">${badgeLabel}</span>
    </div>
    <div class="tb-quota-wrap">
      <div class="tb-quota-bar">
        <div class="${fillClass}" style="width:${pct}%"></div>
      </div>
      <div class="tb-quota-row">
        <p class="tb-quota-text">${_p.tokensRemaining(remaining, quota)}</p>
        <button class="tb-quota-refresh-btn" id="quota-refresh-btn" title="Refresh">↻</button>
      </div>
      ${renewalLine}
    </div>
    <div class="tb-plan-cards">
      <div class="tb-plan-card${isFree ? " tb-plan-card--active" : ""}">
        <div class="tb-plan-card-header">
          <span class="tb-plan-name">FREE</span>
          <span class="tb-plan-price">$0<span class="tb-plan-per">${_p.perMonth}</span></span>
        </div>
        <p class="tb-plan-subtitle">${_p.enoughForDaily}</p>
        <ul class="tb-plan-features">
          <li>${_p.freeFeature1}</li>
          <li>${_p.freeFeature2}</li>
          <li>${_p.freeFeature3}</li>
          <li>${_p.freeFeature4}</li>
          <li>${_p.freeFeature5}</li>
        </ul>
      </div>
      <div class="tb-plan-card tb-plan-card--basic${!isFree ? " tb-plan-card--active" : ""}">
        <div class="tb-plan-card-header">
          <span class="tb-plan-name">BASIC <span class="tb-popular-badge">${_p.mostPopular}</span></span>
          <span class="tb-plan-price">$5<span class="tb-plan-per">${_p.perMonth}</span></span>
        </div>
        <p class="tb-plan-subtitle">${_p.useAllDay}</p>
        <ul class="tb-plan-features">
          <li>${_p.basicFeature1}</li>
          <li>${_p.basicFeature2}</li>
          <li>${_p.basicFeature3}</li>
          <li>${_p.basicFeature4}</li>
          <li>${_p.basicFeature5}</li>
          <li>${_p.basicFeature6}</li>
        </ul>
        <div class="tb-plan-card-action">
          ${actionBtn}
          ${cancelNotice}
        </div>
      </div>
    </div>
    <div class="tb-coupon-section">
      <div class="tb-coupon-title">${_p.couponSectionTitle}</div>
      <div class="tb-coupon-row">
        <input type="text" id="coupon-input" class="tb-coupon-input"
          placeholder="${_p.couponPlaceholder}" maxlength="40" spellcheck="false" autocomplete="off">
        <button class="tb-btn tb-coupon-btn" id="coupon-apply-btn">${_p.couponApply}</button>
      </div>
      <p class="tb-coupon-error" id="coupon-error" style="display:none"></p>
    </div>
    <a href="https://textboi.ai" target="_blank" class="tb-visit-link">${_p.visitLink}</a>
    <div class="tb-legal-links">
      <a href="https://textboi.ai/terms" target="_blank" class="tb-legal-link">${_p.termsOfService}</a>
      <span class="tb-legal-sep">·</span>
      <a href="https://textboi.ai/privacy" target="_blank" class="tb-legal-link">${_p.privacyPolicy}</a>
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

  document.getElementById("coupon-apply-btn")?.addEventListener("click", applyCoupon);
  document.getElementById("coupon-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyCoupon();
  });
}

async function startCheckout(plan) {
  const btn = document.getElementById("plan-action-btn");
  if (btn) { btn.disabled = true; btn.textContent = _p.processing; }
  try {
    const res = await chrome.runtime.sendMessage({ type: "STRIPE_CHECKOUT", plan });
    if (res?.isUpgrade) {
      showPopupToast(res.message || (_isKo ? "플랜 변경이 예약되었습니다." : "Plan change scheduled."));
    } else if (!res?.ok) {
      showPopupToast("Failed: " + (res?.error || "Unknown error"));
      if (btn) { btn.disabled = false; btn.textContent = _p.getBasic; }
    }
    // url이 있으면 background.js가 이미 탭을 열었음
  } catch {
    showPopupToast(_isKo ? "결제 진행에 실패했습니다. 다시 시도해주세요." : "Checkout failed. Please try again.");
    if (btn) { btn.disabled = false; btn.textContent = _p.getBasic; }
  }
}

async function applyCoupon() {
  const input = document.getElementById("coupon-input");
  const btn = document.getElementById("coupon-apply-btn");
  const errorEl = document.getElementById("coupon-error");

  const code = input?.value?.trim();
  if (!code || !btn || btn.disabled) return;

  btn.disabled = true;
  btn.textContent = _p.couponApplying;
  if (errorEl) errorEl.style.display = "none";

  try {
    const res = await chrome.runtime.sendMessage({ type: "APPLY_COUPON", code });
    if (res?.ok) {
      if (input) input.value = "";
      showPopupToast(_p.couponSuccess(res.type, res.value));
      // QUOTA_REFRESHED는 background.js가 브로드캐스트하므로 별도 GET_PLAN 불필요
    } else {
      const errMap = {
        INVALID_CODE: _p.couponErrorInvalid,
        ALREADY_USED: _p.couponErrorUsed,
        EXPIRED: _p.couponErrorExpired,
        MAX_USES_REACHED: _p.couponErrorMax,
      };
      const errMsg = errMap[res?.error] || _p.couponErrorInvalid;
      if (errorEl) { errorEl.textContent = errMsg; errorEl.style.display = "block"; }
    }
  } catch {
    if (errorEl) { errorEl.textContent = _p.couponErrorInvalid; errorEl.style.display = "block"; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = _p.couponApply; }
  }
}

async function openPortal() {
  const btn = document.getElementById("plan-action-btn");
  if (btn) { btn.disabled = true; btn.textContent = _p.opening; }
  try {
    const res = await chrome.runtime.sendMessage({ type: "STRIPE_PORTAL" });
    if (!res?.ok) {
      showPopupToast("Failed: " + (res?.error || "Unknown error"));
    }
  } catch {
    showPopupToast(_isKo ? "포털을 열 수 없습니다. 다시 시도해주세요." : "Unable to open portal. Please try again.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = _p.manageSubscription; }
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
