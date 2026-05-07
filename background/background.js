import {
  OPENAI_PROXY_URL,
  SUPABASE_REST_API_URL,
} from "../utils/constants.js";
import { buildTranslateMessages, buildCorrectMessages } from "../utils/api.js";
import { refreshAccessToken } from "../utils/auth.js";
import { getAccessToken, getDeviceId } from "../utils/storage.js";
import { applyTextCleanup } from "../utils/textCleanup.js";

// tabId → AbortController
const abortControllers = new Map();

/* =========================
   메시지 수신
========================= */
chrome.runtime.onMessage.addListener((msg, sender) => {
  // 외부 페이지 메시지 거부 (보안)
  if (sender.id !== chrome.runtime.id) return;

  if (msg.type === "PROCESS_TEXT") {
    const tabId = sender.tab?.id;
    if (!tabId) return;

    abortControllers.get(tabId)?.abort();
    const controller = new AbortController();
    abortControllers.set(tabId, controller);

    handleProcessText(msg, tabId, controller.signal).catch(console.error);
    return true;
  }

  if (msg.type === "ABORT_STREAM") {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    abortControllers.get(tabId)?.abort();
    abortControllers.delete(tabId);
  }
});

/* =========================
   단축키 처리
========================= */
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "COMMAND", mode: command });
  } catch (err) {
    console.error("[TextBoi] Command failed", err);
  }
});

/* =========================
   우클릭 메뉴
========================= */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "textboi-translate",
    title: "Translate with TextBoi",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "textboi-translate") return;
  if (!tab?.id || !info.selectionText) return;
  chrome.tabs.sendMessage(tab.id, {
    type: "PROCESS_TEXT",
    mode: "translate",
    text: info.selectionText,
  });
});

/* =========================
   핵심: 스트리밍 처리
========================= */
async function handleProcessText(msg, tabId, signal) {
  // 1. 토큰 확인 (만료 시 refresh 시도)
  let token = await getAccessToken();
  if (!token) {
    token = await refreshAccessToken();
  }

  const isGuest = !token;

  // 2. 게스트 한도 확인
  let guestRemaining = null;
  if (isGuest) {
    const deviceId = await getDeviceId();
    const quota = await checkGuestQuota(deviceId);
    if (!quota.ok) {
      chrome.tabs.sendMessage(tabId, { type: "GUEST_LIMIT_REACHED" });
      return;
    }
    guestRemaining = quota.remaining ?? null;
  }

  // 3. 엔드포인트 + 헤더 결정
  const deviceId = isGuest ? await getDeviceId() : null;
  const endpoint = isGuest
    ? `${SUPABASE_REST_API_URL}/guest/chat`
    : `${OPENAI_PROXY_URL}/v1/chat/completions`;

  const headers = {
    "Content-Type": "application/json",
    ...(isGuest
      ? { "x-device-id": deviceId }
      : { Authorization: `Bearer ${token}` }),
  };

  // 4. 메시지 빌드
  const messages =
    msg.mode === "translate"
      ? buildTranslateMessages(msg.text, msg.targetLang || "ko")
      : buildCorrectMessages(msg.text, msg.rewritePrompt || "proofread");

  // 5. 스트리밍 fetch (401 시 토큰 refresh 후 1회 재시도)
  const body = JSON.stringify({ model: msg.model || "gpt-4o-mini", stream: true, messages });

  let res;
  try {
    res = await fetch(endpoint, { method: "POST", headers, body, signal });
  } catch (e) {
    if (e.name === "AbortError") return;
    chrome.tabs.sendMessage(tabId, { type: "STREAM_ERROR", message: "Network error. Please try again." });
    return;
  }

  // 토큰 만료(401) → refresh 후 재시도
  if (res.status === 401 && !isGuest) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers.Authorization = `Bearer ${newToken}`;
      try {
        res = await fetch(endpoint, { method: "POST", headers, body, signal });
      } catch (e) {
        if (e.name === "AbortError") return;
        chrome.tabs.sendMessage(tabId, { type: "STREAM_ERROR", message: "Network error. Please try again." });
        return;
      }
    } else {
      chrome.tabs.sendMessage(tabId, {
        type: "STREAM_ERROR",
        message: "Session expired. Please sign in again from the extension popup.",
      });
      return;
    }
  }

  if (!res.ok) {
    chrome.tabs.sendMessage(tabId, {
      type: "STREAM_ERROR",
      message: res.status === 401
        ? "Sign in required. Open the extension popup to log in."
        : `API error (${res.status})`,
    });
    return;
  }

  // 6. SSE 파싱 + 청크 릴레이
  let fullResult = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");

      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (!line.startsWith("data:")) continue;

        const json = line.slice(5).trim();
        if (json === "[DONE]") {
          reader.cancel();
          break;
        }

        try {
          const parsed = JSON.parse(json);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullResult += delta;
            chrome.tabs.sendMessage(tabId, { type: "STREAM_CHUNK", chunk: delta });
          }
        } catch {
          // 파싱 실패한 청크 무시
        }
      }
      buffer = lines.at(-1) || "";
    }
  } catch (e) {
    if (e.name === "AbortError") return;
    chrome.tabs.sendMessage(tabId, { type: "STREAM_ERROR", message: "Streaming error. Please try again." });
    return;
  }

  if (isGuest && guestRemaining !== null) {
    chrome.tabs.sendMessage(tabId, { type: "GUEST_REMAINING", remaining: guestRemaining });
  }

  chrome.tabs.sendMessage(tabId, {
    type: "STREAM_DONE",
    result: applyTextCleanup(fullResult),
  });
}

/* =========================
   게스트 한도 확인
========================= */
async function checkGuestQuota(deviceId) {
  try {
    const res = await fetch(`${SUPABASE_REST_API_URL}/device/check-free`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
    });
    return await res.json();
  } catch {
    return { ok: true };
  }
}

