async function load() {
  const { state } = await chrome.runtime.sendMessage({ type: 'getState' });
  document.getElementById('popupBlockingEnabled').checked = !!state.popupBlockingEnabled;
  document.getElementById('cosmeticBlockingEnabled').checked = !!state.cosmeticBlockingEnabled;
  document.getElementById('customBlockDomains').value = (state.customBlockDomains || []).join('\n');
  document.getElementById('allowlist').value = (state.allowlist || []).join('\n');
  document.getElementById('customCssSelectors').value = JSON.stringify(state.customCssSelectors || {}, null, 2);
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  const payload = {
    popupBlockingEnabled: document.getElementById('popupBlockingEnabled').checked,
    cosmeticBlockingEnabled: document.getElementById('cosmeticBlockingEnabled').checked,
    customBlockDomains: document.getElementById('customBlockDomains').value.split(/\r?\n/).map(v => v.trim()).filter(Boolean),
    allowlist: document.getElementById('allowlist').value.split(/\r?\n/).map(v => v.trim().toLowerCase()).filter(Boolean),
    customCssSelectors: JSON.parse(document.getElementById('customCssSelectors').value || '{}')
  };
  await chrome.runtime.sendMessage({ type: 'saveOptions', payload });
  document.getElementById('saveStatus').textContent = 'Saved.';
});

document.getElementById('openInspector').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.runtime.sendMessage({ type: 'openInspector', tabId: tab?.id });
});


load();
