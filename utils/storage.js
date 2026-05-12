import { DEFAULT_SETTINGS, resolveLocale } from "./constants.js";

function isContextAlive() {
  try { return !!chrome.runtime?.id; } catch { return false; }
}


export async function getSettings() {
  if (!isContextAlive()) return { ...DEFAULT_SETTINGS };
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get("tb_settings", ({ tb_settings }) => {
        const merged = { ...DEFAULT_SETTINGS, ...tb_settings };
        // If targetLang was never explicitly saved, auto-detect from browser locale
        if (!tb_settings?.targetLang) {
          const locale = (typeof navigator !== "undefined" && navigator.language) || "en-US";
          merged.targetLang = resolveLocale(locale);
        }
        resolve(merged);
      });
    } catch {
      resolve({ ...DEFAULT_SETTINGS });
    }
  });
}

export async function saveSettings(partial) {
  if (!isContextAlive()) return;
  const current = await getSettings();
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ tb_settings: { ...current, ...partial } }, resolve);
    } catch {
      resolve();
    }
  });
}

export async function getAccessToken() {
  if (!isContextAlive()) return null;
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get("tb_access_token", ({ tb_access_token }) => {
        resolve(tb_access_token || null);
      });
    } catch {
      resolve(null);
    }
  });
}

export async function getRefreshToken() {
  if (!isContextAlive()) return null;
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get("tb_refresh_token", ({ tb_refresh_token }) => {
        resolve(tb_refresh_token || null);
      });
    } catch {
      resolve(null);
    }
  });
}

export async function setTokens(accessToken, refreshToken) {
  if (!isContextAlive()) return;
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set(
        { tb_access_token: accessToken, tb_refresh_token: refreshToken },
        resolve
      );
    } catch {
      resolve();
    }
  });
}

export async function clearTokens() {
  if (!isContextAlive()) return;
  return new Promise((resolve) => {
    try {
      chrome.storage.local.remove(["tb_access_token", "tb_refresh_token"], resolve);
    } catch {
      resolve();
    }
  });
}

export async function getDeviceId() {
  if (!isContextAlive()) return "unknown";
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get("tb_device_id", ({ tb_device_id }) => {
        if (tb_device_id) return resolve(tb_device_id);
        const id = crypto.randomUUID();
        chrome.storage.local.set({ tb_device_id: id }, () => resolve(id));
      });
    } catch {
      resolve(crypto.randomUUID());
    }
  });
}
