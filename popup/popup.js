import { loginWithGoogle, logout } from "../utils/auth.js";
import { getAccessToken, getSettings, saveSettings } from "../utils/storage.js";
import { MODELS, LANGUAGES, REWRITE_PROMPTS } from "../utils/constants.js";

async function init() {
  const [token, settings] = await Promise.all([getAccessToken(), getSettings()]);
  token ? renderLoggedIn(token, settings) : renderLoggedOut();
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

function renderLoggedIn(token, settings) {
  const email = decodeEmail(token);
  const app = document.getElementById("app");

  const langOpts = LANGUAGES.map(l =>
    `<option value="${l.code}">${l.label}</option>`
  ).join("");

  const modelOpts = MODELS.map(m =>
    `<option value="${m.id}">${m.label}</option>`
  ).join("");

  const rewriteOpts = Object.entries(REWRITE_PROMPTS).map(([k, v]) =>
    `<option value="${k}">${k}</option>`
  ).join("");

  app.innerHTML = `
    <div class="tb-header">
      <img src="../icons/icon32.png" class="tb-logo-img" alt="TextBoi">
      <span class="tb-logo">TextBoi</span>
      <button id="logout-btn" class="tb-btn tb-btn--ghost">Log out</button>
    </div>
    <p class="tb-email" id="tb-email"></p>
    <div class="tb-settings">
      <div class="tb-field">
        <label class="tb-label">Mode</label>
        <div class="tb-tabs">
          <button class="tb-tab${settings.mode === "translate" ? " tb-tab--active" : ""}" data-mode="translate">Translate</button>
          <button class="tb-tab${settings.mode === "correct" ? " tb-tab--active" : ""}" data-mode="correct">Correct</button>
        </div>
      </div>
      <div class="tb-field" id="lang-field">
        <label class="tb-label">Target language</label>
        <select id="lang-select" class="tb-select">${langOpts}</select>
      </div>
      <div class="tb-field" id="rewrite-field">
        <label class="tb-label">Correction style</label>
        <select id="rewrite-select" class="tb-select">${rewriteOpts}</select>
      </div>
      <div class="tb-field">
        <label class="tb-label">Model</label>
        <select id="model-select" class="tb-select">${modelOpts}</select>
      </div>
    </div>
  `;

  // 동적 값은 textContent/value로 설정
  document.getElementById("tb-email").textContent = email;
  document.getElementById("lang-select").value = settings.targetLang;
  document.getElementById("model-select").value = settings.model;
  document.getElementById("rewrite-select").value = settings.rewritePrompt;

  const langField = document.getElementById("lang-field");
  const rewriteField = document.getElementById("rewrite-field");
  langField.style.display = settings.mode === "translate" ? "" : "none";
  rewriteField.style.display = settings.mode === "correct" ? "" : "none";

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await logout();
    init();
  });

  document.querySelectorAll(".tb-tab").forEach(tab => {
    tab.addEventListener("click", async () => {
      document.querySelectorAll(".tb-tab").forEach(t => t.classList.remove("tb-tab--active"));
      tab.classList.add("tb-tab--active");
      const mode = tab.dataset.mode;
      await saveSettings({ mode });
      langField.style.display = mode === "translate" ? "" : "none";
      rewriteField.style.display = mode === "correct" ? "" : "none";
    });
  });

  document.getElementById("lang-select").addEventListener("change", e =>
    saveSettings({ targetLang: e.target.value })
  );
  document.getElementById("rewrite-select").addEventListener("change", e =>
    saveSettings({ rewritePrompt: e.target.value })
  );
  document.getElementById("model-select").addEventListener("change", e =>
    saveSettings({ model: e.target.value })
  );
}

init();
