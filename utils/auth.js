import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} from "./constants.js";
import { setTokens, clearTokens, getRefreshToken } from "./storage.js";

export async function loginWithGoogle() {
  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl =
    `${SUPABASE_URL}/auth/v1/authorize?provider=google` +
    `&redirect_to=${encodeURIComponent(redirectUrl)}`;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      async (redirected) => {
        if (chrome.runtime.lastError || !redirected) {
          return reject(
            new Error(chrome.runtime.lastError?.message || "Login cancelled")
          );
        }

        const url = new URL(redirected);
        const params = new URLSearchParams(
          url.hash ? url.hash.slice(1) : url.search.slice(1)
        );

        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");

        if (!accessToken) return reject(new Error("No access token"));

        await setTokens(accessToken, refreshToken);
        broadcastAuthChange(true);
        resolve();
      }
    );
  });
}

export async function refreshAccessToken() {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }
    );

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.access_token) return null;

    await setTokens(data.access_token, data.refresh_token);
    return data.access_token;
  } catch {
    return null;
  }
}

export async function logout() {
  await clearTokens();
  broadcastAuthChange(false);
}

function broadcastAuthChange(loggedIn) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs
        .sendMessage(tab.id, { type: "AUTH_CHANGED", loggedIn })
        .catch(() => {});
    }
  });
}
