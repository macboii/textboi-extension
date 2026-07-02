import {
  OPENAI_PROXY_URL,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_REST_API_URL,
  STRIPE_WORKER_URL,
  MODELS,
} from "../utils/constants.js";
import { buildTranslateMessages, buildCorrectMessages } from "../utils/api.js";
import { refreshAccessToken } from "../utils/auth.js";
import { getAccessToken, getDeviceId } from "../utils/storage.js";
import { applyTextCleanup } from "../utils/textCleanup.js";
import { countTokens, getModelMultiplier } from "../utils/tokenCount.js";

// content script가 없는 탭(chrome://, 새 탭 등)에 보낼 때 "Receiving end does not exist" 무시
const sendToTab = (tabId, msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => {});

// tabId → AbortController
const abortControllers = new Map();

const VALID_MODEL_IDS = new Set(MODELS.map((m) => m.id));
const LANG_CODE_RE = /^[a-z]{2,3}(-[A-Z]{2,4})?$/;
const MAX_TEXT_LEN = 10_000;
const MAX_PROMPT_LEN = 500;

function sanitizeMsg(msg) {
  return {
    ...msg,
    model: VALID_MODEL_IDS.has(msg.model) ? msg.model : "gpt-4o-mini",
    text: typeof msg.text === "string" ? msg.text.slice(0, MAX_TEXT_LEN) : "",
    targetLang: LANG_CODE_RE.test(msg.targetLang ?? "") ? msg.targetLang : "en-US",
    rewritePrompt:
      typeof msg.rewritePrompt === "string"
        ? msg.rewritePrompt.slice(0, MAX_PROMPT_LEN)
        : "proofread",
  };
}

/* =========================
   메시지 수신
========================= */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 외부 페이지 메시지 거부 (보안)
  if (sender.id !== chrome.runtime.id) return;

  if (msg.type === "PROCESS_TEXT") {
    const tabId = sender.tab?.id;
    if (!tabId) return;

    abortControllers.get(tabId)?.abort();
    const controller = new AbortController();
    abortControllers.set(tabId, controller);

    handleProcessText(sanitizeMsg(msg), tabId, controller.signal).catch(console.error);
    return true;
  }

  if (msg.type === "ABORT_STREAM") {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    abortControllers.get(tabId)?.abort();
    abortControllers.delete(tabId);
  }

  if (msg.type === "EXPLAIN_DIFF") {
    handleExplainDiff(msg).then(sendResponse).catch(() => sendResponse({ type: "error", message: "Explanation failed" }));
    return true;
  }

  if (msg.type === "POST_LOGIN") {
    handlePostLogin().catch(console.error);
    return;
  }

  if (msg.type === "STRIPE_CHECKOUT") {
    handleStripeCheckout(msg.plan).then(sendResponse).catch(() => sendResponse({ ok: false, error: "Checkout failed" }));
    return true;
  }

  if (msg.type === "STRIPE_PORTAL") {
    handleStripePortal().then(sendResponse).catch(() => sendResponse({ ok: false, error: "Portal failed" }));
    return true;
  }

  if (msg.type === "GET_PLAN") {
    (async () => {
      try {
        let plan = await fetchCurrentPlan();
        // 플랜이 없거나 만료된 경우 새 달 플랜 자동 생성
        const isExpired = plan?.billing_period_end && new Date(plan.billing_period_end) <= new Date();
        if (!plan || isExpired) {
          const token = await getValidToken();
          const deviceId = await getDeviceId();
          if (token && deviceId) {
            await ensureFreePlanIfNeeded(token, deviceId);
            plan = await fetchCurrentPlan();
          }
        }
        if (plan) chrome.storage.local.set({ tb_current_plan: plan });
        sendResponse({ plan });
      } catch {
        // 네트워크/인증 실패 시 캐시된 플랜 반환
        chrome.storage.local.get("tb_current_plan", ({ tb_current_plan }) => {
          sendResponse({ plan: tb_current_plan || null });
        });
      }
    })();
    return true;
  }

  if (msg.type === "TRIGGER_LOGIN") {
    chrome.action.openPopup().catch(() => {});
    return;
  }

  if (msg.type === "GET_GUEST_QUOTA") {
    // /device/free-status (GET, 읽기 전용) 사용 — check-free는 카운트를 올리므로 절대 사용 금지
    getDeviceId()
      .then((deviceId) => fetchGuestStatus(deviceId))
      .then((quota) => sendResponse({ quota }))
      .catch(() => sendResponse({ quota: { ok: true, remaining: 10 } }));
    return true;
  }

  if (msg.type === "APPLY_COUPON") {
    handleApplyCoupon(msg.code).then(sendResponse).catch(() => sendResponse({ ok: false, error: "Coupon failed" }));
    return true;
  }
});


/* =========================
   단축키 처리
========================= */
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    sendToTab(tab.id, { type: "COMMAND", mode: command });
  } catch (err) {
    console.error("[TextBoi] Command failed", err);
  }
});

/* =========================
   우클릭 메뉴
========================= */
function _createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      { id: "textboi-translate", title: "Translate with TextBoi", contexts: ["selection"] },
      () => void chrome.runtime.lastError
    );
  });
}
chrome.runtime.onInstalled.addListener(_createContextMenu);
chrome.runtime.onStartup.addListener(_createContextMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "textboi-translate") return;
  if (!tab?.id || !info.selectionText) return;
  sendToTab(tab.id, {
    type: "PROCESS_TEXT",
    mode: "translate",
    text: info.selectionText,
  });
});

/* =========================
   핵심: 스트리밍 처리
========================= */
function isTokenExpired(token) {
  try {
    const exp = JSON.parse(atob(token.split(".")[1])).exp;
    return exp * 1000 < Date.now() + 60_000; // 60초 여유
  } catch {
    return true;
  }
}

async function getValidToken() {
  const token = await getAccessToken();
  if (!token) return await refreshAccessToken();
  if (isTokenExpired(token)) return await refreshAccessToken();
  return token;
}

// 만료 여부 무관하게 저장된 토큰 반환 (JWT 페이로드 디코딩 전용)
async function getAnyToken() {
  return (await getValidToken()) || (await getAccessToken());
}

async function handleProcessText(msg, tabId, signal) {
  // 1. 토큰 확인 (만료 시 proactive refresh)
  let token = await getValidToken();

  const isGuest = !token;

  // 2. 한도 확인
  const deviceId = await getDeviceId();

  // 로그인 사용자: 장치 세션 1회 등록 (미등록이면 save-history가 실패하므로)
  if (!isGuest) await ensureDeviceSessionOnce(token, deviceId);
  let guestRemaining = null;
  if (isGuest) {
    const quota = await checkGuestQuota(deviceId);
    if (!quota.ok) {
      chrome.tabs.sendMessage(tabId, { type: "GUEST_LIMIT_REACHED" });
      return;
    }
    guestRemaining = quota.remaining ?? null;
    // 게스트는 gpt-4o-mini 고정
    msg = { ...msg, model: "gpt-4o-mini" };
  } else {
    const quota = await checkUserQuota(token, deviceId);
    if (!quota.ok) {
      chrome.tabs.sendMessage(tabId, { type: "QUOTA_EXCEEDED" });
      return;
    }
    // free plan은 gpt-4o-mini 고정
    if (quota.planType === "free") {
      msg = { ...msg, model: "gpt-4o-mini" };
    }
  }

  // 3. 엔드포인트 + 헤더 결정
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

  if (isGuest) {
    // check-free 반환값(guestRemaining)은 증가 직후 값이라 부정확할 수 있음
    // 스트리밍 완료 후 free-status(읽기 전용)로 실제 잔여 횟수 조회
    const status = await fetchGuestStatus(deviceId).catch(() => null);
    const remaining = status?.remaining ?? guestRemaining;
    if (remaining !== null) {
      chrome.tabs.sendMessage(tabId, { type: "GUEST_REMAINING", remaining });
    }
  }

  const cleanResult = applyTextCleanup(fullResult);
  chrome.tabs.sendMessage(tabId, { type: "STREAM_DONE", result: cleanResult });

  // 로그인 사용자: 히스토리 저장 후 quota 갱신 알림
  if (!isGuest) {
    saveHistory(msg, fullResult, token, deviceId)
      .then(async () => {
        const plan = await fetchCurrentPlan();
        if (plan) chrome.storage.local.set({ tb_current_plan: plan });
        chrome.runtime.sendMessage({ type: "QUOTA_REFRESHED", plan }).catch(() => {});
      })
      .catch(console.error);
  }
}

/* =========================
   Diff 설명 생성
========================= */
async function handleExplainDiff(msg) {
  let token = await getValidToken();
  if (!token) return { type: "error", message: "Sign in required" };

  const rawModel = msg.model ?? "gpt-4o-mini";
  const { diffHtml, rewritePrompt = "proofread", locale = "en-US" } = msg;
  const model = VALID_MODEL_IDS.has(rawModel) ? rawModel : "gpt-4o-mini";

  const systemPrompt = `You are a writing assistant. Analyze the HTML diff below and explain each change made.

Instruction context: ${rewritePrompt}

The diff uses:
- <del class="diff-removed"> for deleted text
- <span class="diff-added"> for added text
- unchanged text is plain

Return ONLY a JSON object with a "changes" array (no markdown, no explanations outside JSON), where each item has:
- "original": string (the original phrase that was changed, or "" if it was an insertion)
- "corrected": string (the corrected phrase, or "" if it was a deletion)
- "explanation": string (a brief explanation of why this change was made, in ${locale} language)

Rules:
- One object per distinct change.
- Explanations must be in ${locale} language.
- Output must be valid JSON (double quotes only, no trailing commas).
- No markdown fences or prose outside the JSON.
- If no changes are found, return {"changes":[]}.`.trim();

  const responseFormat = {
    type: "json_schema",
    json_schema: {
      name: "DiffExplanation",
      schema: {
        type: "object",
        properties: {
          changes: {
            type: "array",
            items: {
              type: "object",
              required: ["original", "corrected", "explanation"],
              properties: {
                original: { type: "string" },
                corrected: { type: "string" },
                explanation: { type: "string" },
              },
              additionalProperties: false,
            },
          },
        },
        required: ["changes"],
        additionalProperties: false,
      },
      strict: true,
    },
  };

  const res = await fetch(`${OPENAI_PROXY_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0,
      response_format: responseFormat,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: diffHtml },
      ],
    }),
  });

  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content);

  // user_diff 저장 (fire-and-forget)
  saveDiff({ diffHtml, systemPrompt, content, locale, model, rewritePrompt, token }).catch(() => {});

  return { type: "success", changes: parsed.changes ?? [] };
}

async function saveDiff({ diffHtml, systemPrompt, content, locale, model, rewritePrompt, token }) {
  try {
    const deviceId = await getDeviceId();
    await ensureDeviceSessionOnce(token, deviceId);

    const multiplier = getModelMultiplier(model);
    const tok_html = countTokens(diffHtml);
    const tok_prompt = countTokens(systemPrompt);
    const tok_exp = countTokens(content);
    const tok_total = Math.round((tok_html + tok_prompt + tok_exp) * multiplier);

    const payload = {
      diffhtml_text: diffHtml,
      diff_prompt_text: systemPrompt,
      diffexp_text: content,
      token_usage_diffhtml: tok_html,
      token_usage_dffprompt: tok_prompt,
      token_usage_diffexp: tok_exp,
      token_usage_diff_total: tok_total,
      locale,
      model,
      rewrite_prompt: rewritePrompt,
    };

    const doSave = () =>
      fetch(`${SUPABASE_REST_API_URL}/save-diff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-device-id": deviceId,
        },
        body: JSON.stringify(payload),
      });

    let res = await doSave();
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[TextBoi] save-diff failed:", res.status, errText);

      // 장치 세션 미등록 → 스탈 캐시 제거 후 /save-session 재등록, 재시도
      if (res.status === 401 && (errText.includes("DEVICE_NOT_AUTHORIZED") || errText.includes("device"))) {
        const sessionKey = `tb_session_${deviceId}`;
        chrome.storage.local.remove(sessionKey);
        const ok = await registerDeviceSession(token, deviceId);
        if (ok) chrome.storage.local.set({ [sessionKey]: true });
        if (ok) {
          res = await doSave();
          if (!res.ok) console.error("[TextBoi] save-diff retry failed:", res.status, await res.text().catch(() => ""));
        }
      }
    }
  } catch (e) {
    console.error("[TextBoi] save-diff error:", e);
  }
}

/* =========================
   게스트 한도 확인
========================= */
// 실제 API 호출 전 — 카운트를 +1 증가시키고 한도 초과 여부 반환
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

// 팝업/UI 표시용 — 읽기 전용, 카운트 변경 없음
async function fetchGuestStatus(deviceId) {
  try {
    const res = await fetch(`${SUPABASE_REST_API_URL}/device/free-status`, {
      method: "GET",
      headers: { "x-device-id": deviceId },
    });
    return await res.json(); // { ok, remaining, limitExceeded }
  } catch {
    return { ok: true, remaining: 10, limitExceeded: false };
  }
}

/* =========================
   로그인 사용자 Quota 체크
========================= */
async function checkUserQuota(token, deviceId) {
  try {
    const now = encodeURIComponent(new Date().toISOString());
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_plans?plan_status=in.(active,trialing,scheduled)&billing_period_end=gt.${now}&select=token_quota,token_used,plan_type&order=activated_at.desc&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      // 플랜 없음 → 이번 달 최초 → ensure-free-plan 생성 후 허용
      ensureFreePlanIfNeeded(token, deviceId).catch(console.error);
      return { ok: true, planType: "free" };
    }
    const { token_quota, token_used, plan_type } = rows[0];
    return { ok: token_used < token_quota, used: token_used, quota: token_quota, planType: plan_type ?? "free" };
  } catch {
    return { ok: true, planType: "free" }; // 네트워크 오류 시 허용 (free로 간주)
  }
}

async function ensureFreePlanIfNeeded(token, deviceId) {
  try {
    await fetch(`${SUPABASE_REST_API_URL}/ensure-free-plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-device-id": deviceId,
      },
    });
  } catch {
    // 조용히 무시
  }
}

/* =========================
   POST_LOGIN — 사용자 등록 + Free Plan 생성
========================= */
async function handlePostLogin() {
  const token = await getValidToken();
  if (!token) return;

  let payload;
  try {
    payload = JSON.parse(atob(token.split(".")[1]));
  } catch {
    return;
  }
  const userId = payload.sub;
  const email = payload.email || "";
  const name = payload.user_metadata?.full_name || payload.user_metadata?.name || email;
  const avatarUrl = payload.user_metadata?.avatar_url || payload.user_metadata?.picture || null;
  const provider = payload.app_metadata?.provider || "google";
  const deviceId = await getDeviceId();

  // 1. public.users 등록/갱신
  // - INSERT: ignore-duplicates → 신규 유저만 생성, 기존 유저 트리거(민감 컬럼 차단) 회피
  // - PATCH: 민감 컬럼 제외한 안전한 필드만 업데이트 (재로그인 시 last_login_at 갱신)
  const now = new Date().toISOString();
  const appVersion = chrome.runtime.getManifest().version;
  try {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({
        id: userId,
        email,
        name,
        avatar_url: avatarUrl,
        provider,
        platform: "chrome-extension",
        app_version: appVersion,
        locale: navigator.language,
        token_quota: 50000,
        token_input: 0,
        token_output: 0,
        created_at: now,
        last_login_at: now,
      }),
    });
    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error("[TextBoi] users insert failed:", insertRes.status, errText);
    }
  } catch (e) {
    console.error("[TextBoi] users insert error:", e);
  }

  // 기존 유저: 민감 컬럼 제외 안전 필드만 PATCH (UPDATE 트리거 안전)
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          name,
          avatar_url: avatarUrl,
          platform: "chrome-extension",
          app_version: appVersion,
          locale: navigator.language,
          last_login_at: now,
        }),
      }
    );
  } catch {
    // 조용히 무시
  }

  // 2. Device Session 등록 (ensure-free-plan 전에 반드시 선행)
  try {
    await fetch(`${SUPABASE_REST_API_URL}/save-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        user_id: userId,
        device_id: deviceId,
        device_name: "chrome-extension",
        user_agent: navigator.userAgent,
      }),
    });
  } catch {
    // 조용히 무시
  }

  // 3. 이번 달 Free Plan 생성 (없을 때만)
  try {
    await fetch(`${SUPABASE_REST_API_URL}/ensure-free-plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-device-id": deviceId,
      },
    });
  } catch {
    // 조용히 무시
  }

  // 4. 로그인 브로드캐스트
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: "AUTH_CHANGED", loggedIn: true }).catch(() => {});
  }
}

/* =========================
   히스토리 저장 + 토큰 차감
========================= */
async function saveHistory(msg, rawOutput, token, deviceId) {
  const messages =
    msg.mode === "translate"
      ? buildTranslateMessages(msg.text, msg.targetLang || "en-US")
      : buildCorrectMessages(msg.text, msg.rewritePrompt || "proofread");
  const systemPromptText = messages[0].content;

  const inputTokens = countTokens(msg.text);
  const outputTokens = countTokens(rawOutput);
  const promptTokens = countTokens(systemPromptText);
  // Desktop과 동일: 메시지 오버헤드 +4/메시지 × 2메시지 + 2 총합 = 10
  const overhead = 10;
  const multiplier = getModelMultiplier(msg.model);
  const total = Math.round((inputTokens + outputTokens + promptTokens + overhead) * multiplier);

  const isTranslate = msg.mode === "translate";
  const histPayload = {
    mode: isTranslate ? "TRANSLATE" : "CORRECT",
    input_text: msg.text,
    output_text: rawOutput,
    input_lang: "auto",
    output_lang: isTranslate ? (msg.targetLang || "en-US") : "auto",
    model: msg.model || "gpt-4o-mini",
    detected_lang: "auto",
    ...(isTranslate
      ? { trans_prompt_text: systemPromptText, token_usage_transprompt: promptTokens }
      : {
          correct_prompt_text: systemPromptText,
          token_usage_correctprompt: promptTokens,
          rewrite_prompt: msg.rewritePrompt,
        }),
    token_usage_input: inputTokens,
    token_usage_output: outputTokens,
    token_usage_history_total: total,
  };

  const doSave = () =>
    fetch(`${SUPABASE_REST_API_URL}/save-history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-device-id": deviceId,
      },
      body: JSON.stringify(histPayload),
    });

  let res = await doSave();
  console.log("[TextBoi] save-history status:", res.status);

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[TextBoi] save-history failed:", res.status, errText);

    // 토큰 만료(401 "expired") → 토큰 재발급 후 재시도
    if (res.status === 401 && (errText.includes("expired") || errText.includes("Invalid"))) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        const retryRes = await fetch(`${SUPABASE_REST_API_URL}/save-history`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${newToken}`,
            "x-device-id": deviceId,
          },
          body: JSON.stringify(histPayload),
        });
        console.log("[TextBoi] save-history retry (new token) status:", retryRes.status);
        if (!retryRes.ok) console.error("[TextBoi] save-history retry failed:", await retryRes.text().catch(() => ""));
        return;
      }
    }

    // 장치 세션 미등록 → 스탈 캐시 제거 후 /save-session 재등록, 재시도
    if (res.status === 401 && (errText.includes("DEVICE_NOT_AUTHORIZED") || errText.includes("device"))) {
      const sessionKey = `tb_session_${deviceId}`;
      chrome.storage.local.remove(sessionKey); // 잘못 캐시된 키 제거
      const ok = await registerDeviceSession(token, deviceId);
      if (ok) chrome.storage.local.set({ [sessionKey]: true });
      if (ok) {
        res = await doSave();
        if (!res.ok) console.error("[TextBoi] save-history retry (session) failed:", res.status, await res.text().catch(() => ""));
      } else {
        console.error("[TextBoi] save-session failed, skipping save-history retry");
      }
    }
  }
}

// 장치 세션이 이미 등록됐으면 스킵, 아니면 /save-session 1회 호출
async function ensureDeviceSessionOnce(token, deviceId) {
  const key = `tb_session_${deviceId}`;
  const cached = await new Promise((r) => chrome.storage.local.get(key, (v) => r(v[key])));
  if (cached) return;
  const ok = await registerDeviceSession(token, deviceId);
  // 성공한 경우에만 캐시 (실패 시 다음 요청에서 재시도)
  if (ok) chrome.storage.local.set({ [key]: true });
}

async function registerDeviceSession(token, deviceId) {
  try {
    let payload;
    try { payload = JSON.parse(atob(token.split(".")[1])); } catch { return false; }
    const res = await fetch(`${SUPABASE_REST_API_URL}/save-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        user_id: payload.sub,
        device_id: deviceId,
        device_name: "chrome-extension",
        user_agent: navigator.userAgent,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[TextBoi] save-session failed:", res.status, body);
      return false;
    }
    console.log("[TextBoi] save-session success for device:", deviceId);
    return true;
  } catch (e) {
    console.error("[TextBoi] save-session error:", e);
    return false;
  }
}

/* =========================
   현재 플랜 조회
========================= */
async function fetchCurrentPlan() {
  const token = await getAnyToken();
  if (!token) return null;
  try {
    let payload;
    try { payload = JSON.parse(atob(token.split(".")[1])); } catch { return null; }
    const userId = payload.sub;
    // 유효 토큰 우선, 만료된 경우 Supabase가 401 반환 → null 처리
    const validToken = await getValidToken() || token;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_plans?user_id=eq.${userId}&order=activated_at.desc&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${validToken}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch {
    return null;
  }
}

/* =============================================
   Stripe 고객 ID 조회 (stripe_customer_id가 있는 가장 최근 행)
============================================= */
async function fetchCustomerId() {
  const token = await getAnyToken();
  if (!token) return null;
  try {
    let payload;
    try { payload = JSON.parse(atob(token.split(".")[1])); } catch { return null; }
    const userId = payload.sub;
    const validToken = await getValidToken() || token;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_plans?user_id=eq.${userId}&stripe_customer_id=not.is.null&order=activated_at.desc&limit=1&select=stripe_customer_id`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${validToken}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0]?.stripe_customer_id || null;
  } catch {
    return null;
  }
}

/* =========================
   Stripe Checkout
========================= */
async function handleStripeCheckout(plan) {
  // Stripe Worker는 JWT 검증 없음 — 만료 토큰이라도 페이로드만 추출하면 됨
  const token = await getAnyToken();
  if (!token) return { ok: false, error: "Not logged in" };

  let payload;
  try { payload = JSON.parse(atob(token.split(".")[1])); } catch { return { ok: false, error: "Invalid token" }; }
  const userId = payload.sub;
  const email = payload.email || "";
  const name = payload.user_metadata?.full_name || email;

  try {
    const res = await fetch(`${STRIPE_WORKER_URL}/api/stripe/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan,
        user_id: userId,
        email,
        name,
        success_url: "https://textboi.ai/billing-success-ext?session_id={CHECKOUT_SESSION_ID}",
      }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data.isUpgrade) return { ok: true, isUpgrade: true, message: data.message };
    if (data.url) {
      chrome.tabs.create({ url: data.url });
      return { ok: true, url: data.url };
    }
    return { ok: false, error: data.error || "No URL" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* =========================
   Stripe Customer Portal
========================= */
async function handleStripePortal() {
  const token = await getAnyToken();
  if (!token) return { ok: false, error: "Not logged in" };

  const customerId = await fetchCustomerId();
  if (!customerId) return { ok: false, error: "No Stripe customer ID found. Please complete a purchase first." };

  try {
    const res = await fetch(`${STRIPE_WORKER_URL}/api/stripe/create-portal-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stripe_customer_id: customerId,
        return_url: "https://textboi.ai/billing-success-ext",
      }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data.url) {
      chrome.tabs.create({ url: data.url });
      return { ok: true, url: data.url };
    }
    return { ok: false, error: data.error || "No URL" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* =========================
   쿠폰 적용
========================= */
async function handleApplyCoupon(code) {
  const token = await getValidToken();
  if (!token) return { ok: false, error: "NOT_LOGGED_IN" };

  let payload;
  try { payload = JSON.parse(atob(token.split(".")[1])); } catch { return { ok: false, error: "Invalid token" }; }
  const userId = payload.sub;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/apply_coupon`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_code: code, p_user_id: userId }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.message || `HTTP ${res.status}` };
    // 성공 시 플랜 캐시 갱신 + QUOTA_REFRESHED 브로드캐스트
    if (data.ok) {
      fetchCurrentPlan().then((plan) => {
        if (plan) chrome.storage.local.set({ tb_current_plan: plan });
        chrome.runtime.sendMessage({ type: "QUOTA_REFRESHED", plan }).catch(() => {});
      }).catch(() => {});
    }
    return data;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* =========================
   결제 완료 감지 (tabs.onUpdated)
========================= */
const _billingTabsSeen = new Set();
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // changeInfo.url: 리다이렉트 전 URL 변경 시 / tab.url: status=complete 시
  const url = changeInfo.url || (changeInfo.status === "complete" ? tab.url : "") || "";
  if (!url.startsWith("https://textboi.ai/billing-success-ext") &&
      !url.startsWith("https://textboi.ai/billing-success")) return;
  if (_billingTabsSeen.has(tabId)) return;
  _billingTabsSeen.add(tabId);
  setTimeout(() => _billingTabsSeen.delete(tabId), 30000);

  const sessionId = new URL(url).searchParams.get("session_id");
  if (sessionId) {
    try {
      await fetch(`${STRIPE_WORKER_URL}/api/stripe/success-verify?session_id=${sessionId}`);
    } catch {}
  }

  // 최대 5회 polling — webhook 처리 대기 (1.5s 간격)
  let plan = null;
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 1500));
    plan = await fetchCurrentPlan();
    if (plan?.plan_type && plan.plan_type.toLowerCase() !== "free") break;
  }

  if (plan) chrome.storage.local.set({ tb_current_plan: plan });

  // 팝업이 열려있으면 UI 갱신
  chrome.runtime.sendMessage({ type: "PLAN_REFRESHED", plan }).catch(() => {});
});

