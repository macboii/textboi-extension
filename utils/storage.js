import { DEFAULT_SETTINGS } from "./constants.js";

export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get("tb_settings", ({ tb_settings }) => {
      resolve({ ...DEFAULT_SETTINGS, ...tb_settings });
    });
  });
}

export async function saveSettings(partial) {
  const current = await getSettings();
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { tb_settings: { ...current, ...partial } },
      resolve
    );
  });
}

export async function getAccessToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get("tb_access_token", ({ tb_access_token }) => {
      resolve(tb_access_token || null);
    });
  });
}

export async function getRefreshToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get("tb_refresh_token", ({ tb_refresh_token }) => {
      resolve(tb_refresh_token || null);
    });
  });
}

export async function setTokens(accessToken, refreshToken) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { tb_access_token: accessToken, tb_refresh_token: refreshToken },
      resolve
    );
  });
}

export async function clearTokens() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(["tb_access_token", "tb_refresh_token"], resolve);
  });
}

export async function getDeviceId() {
  return new Promise((resolve) => {
    chrome.storage.local.get("tb_device_id", ({ tb_device_id }) => {
      if (tb_device_id) return resolve(tb_device_id);
      const id = crypto.randomUUID();
      chrome.storage.local.set({ tb_device_id: id }, () => resolve(id));
    });
  });
}
