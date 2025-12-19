// background/background.js

import { callTextBoiAPI } from "../utils/api.js";
import { getAccessToken } from "../utils/auth.js";

/* =========================
   단축키 처리
========================= */
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id) return;

    // content script에게 실행 신호만 전달
    chrome.tabs.sendMessage(tab.id, {
      type: "COMMAND",
      mode: command
    });
  } catch (err) {
    console.error("[TextBoi] Command handling failed", err);
  }
});

/* =========================
   Content → API 처리
========================= */
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "PROCESS_TEXT") return;

  (async () => {
    try {
      const token = await getAccessToken();

      const result = await callTextBoiAPI(
        {
          mode: msg.mode,
          text: msg.text
        },
        token
      );

      if (!sender.tab?.id) return;

      chrome.tabs.sendMessage(sender.tab.id, {
        type: "SHOW_RESULT",
        payload: result
      });
    } catch (err) {
      console.error("[TextBoi] PROCESS_TEXT failed", err);

      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: "SHOW_RESULT",
          payload: {
            error: true,
            message: "Translation failed"
          }
        });
      }
    }
  })();

  return true; // 🔥 MV3 비동기 응답 필수
});

/* =========================
   우클릭 메뉴 생성
========================= */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "textboi-translate",
    title: "TextBoi로 번역",
    contexts: ["selection", "editable"]
  });
});

/* =========================
   우클릭 → 번역 실행
========================= */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "textboi-translate") return;
  if (!tab?.id || !info.selectionText) return;

  chrome.tabs.sendMessage(tab.id, {
    type: "PROCESS_TEXT",
    mode: "translate",
    text: info.selectionText
  });
});
