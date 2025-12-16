//background.js

import { callTextBoiAPI } from "../utils/api.js";
import { getAccessToken } from "../utils/auth.js";

/* 단축키 */
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, {
    type: "COMMAND",
    mode: command
  });
});

/* bubble / content → API 처리 */
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== "PROCESS_TEXT") return;

  (async () => {
    const token = await getAccessToken();
    const result = await callTextBoiAPI(
      { mode: msg.mode, text: msg.text },
      token
    );

    if (!sender.tab?.id) return;

    chrome.tabs.sendMessage(sender.tab.id, {
      type: "SHOW_RESULT",
      payload: result
    });
  })();
});

/* 우클릭 메뉴 생성 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "textboi-translate",
    title: "TextBoi로 번역",
    contexts: ["selection", "editable"]
  });
});

/* 우클릭 → PROCESS_TEXT만 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "textboi-translate") return;
  if (!tab?.id || !info.selectionText) return;

  chrome.tabs.sendMessage(tab.id, {
    type: "PROCESS_TEXT",
    mode: "translate",
    text: info.selectionText
  });
});
