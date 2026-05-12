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
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Sign in with Google";
    }
  });
}

function renderLoggedIn(token) {
  const email = decodeEmail(token);
  const app = document.getElementById("app");

  app.innerHTML = `
    <div class="tb-header">
      <img src="../icons/icon32.png" class="tb-logo-img" alt="TextBoi">
      <span class="tb-logo">TextBoi</span>
      <button id="logout-btn" class="tb-btn tb-btn--ghost">Log out</button>
    </div>
    <p class="tb-email" id="tb-email"></p>
    <div class="tb-plan-section">
      <div class="tb-current-plan">
        <span class="tb-current-plan-label">Current Plan</span>
        <span class="tb-plan-badge tb-plan-badge--free" id="current-plan-badge">Free</span>
      </div>
      <div class="tb-plan-cards">
        <div class="tb-plan-card" id="plan-card-free">
          <div class="tb-plan-card-header">
            <span class="tb-plan-name">Free</span>
            <span class="tb-plan-price"><strong>$0</strong> <span class="tb-plan-per">/ month</span></span>
          </div>
          <ul class="tb-plan-features">
            <li>✅ Max 150,000 characters / month</li>
            <li>🌍 Translate 150+ languages</li>
            <li>📝 Proofreading &amp; grammar check</li>
            <li>🤖 Model: GPT-4o mini</li>
          </ul>
        </div>
        <div class="tb-plan-card tb-plan-card--basic" id="plan-card-basic">
          <div class="tb-plan-card-header">
            <span class="tb-plan-name">Basic</span>
            <span class="tb-plan-price"><strong>$5</strong> <span class="tb-plan-per">/ month</span></span>
          </div>
          <ul class="tb-plan-features">
            <li>✅ Max 9,000,000 characters / month</li>
            <li>🌍 Translate 150+ languages</li>
            <li>📝 Proofreading &amp; grammar check</li>
            <li>📖 Dictionary lookup</li>
            <li>💡 Revision insights</li>
            <li>🤖 GPT-4o mini, 4.1-mini, 4.1, GPT-5</li>
          </ul>
          <button class="tb-btn tb-btn--upgrade" id="upgrade-btn">Go Basic – Free for 30 Days</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("tb-email").textContent = email;

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await logout();
    init();
  });

  document.getElementById("upgrade-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://textboi.ai/#pricing" });
  });
}

init();
