async function openPanel() {
  const url = chrome.runtime.getURL("panel.html");
  const [panel] = await chrome.runtime.getContexts({ contextTypes: ["TAB"], documentUrls: [url] });
  if (!panel) return chrome.tabs.create({ url });
  await chrome.windows.update(panel.windowId, { focused: true });
  return chrome.tabs.update(panel.tabId, { active: true });
}

chrome.action.onClicked.addListener(openPanel);
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === "openTeacherPanel" && sender.id === chrome.runtime.id) openPanel();
});
