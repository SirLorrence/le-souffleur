chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "capture") {
    return false;
  }

  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || tab.id == null) {
        sendResponse({ error: "Can't read this page type." });
        return;
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          html: document.documentElement.outerHTML,
          url: location.href,
        }),
      });

      const result = results && results[0] && results[0].result;
      if (!result) {
        sendResponse({ error: "Can't read this page type." });
        return;
      }

      sendResponse(result);
    } catch (e) {
      const detail = e && e.message ? e.message : String(e);
      sendResponse({ error: "Can't read this page: " + detail });
    }
  })();

  return true;
});
