function renderDomainToggleRow(domain, enabled, onToggle) {
  const item = document.createElement('div');
  item.className = 'domain-card switch-row';
  item.innerHTML = `
    <div class="stack min0">
      <div class="domain">${domain}</div>
      <div class="subtle">${enabled ? 'Blacklisted' : 'Removed from blacklist'}</div>
    </div>
    <label class="toggle compact"><input type="checkbox" ${enabled ? 'checked' : ''}><span></span></label>
  `;
  const input = item.querySelector('input');
  input.addEventListener('change', () => onToggle(input.checked));
  return item;
}

async function load() {
  const { state, builtinAdDomains, enabledBuiltinAdDomains } = await chrome.runtime.sendMessage({ type: 'getState' });

  document.getElementById('popupBlockingEnabled').checked = !!state.popupBlockingEnabled;
  document.getElementById('cosmeticBlockingEnabled').checked = !!state.cosmeticBlockingEnabled;
  document.getElementById('customBlockDomains').value = (state.customBlockDomains || []).join('\n');
  document.getElementById('allowlist').value = (state.allowlist || []).join('\n');
  document.getElementById('customCssSelectors').value = JSON.stringify(state.customCssSelectors || {}, null, 2);

  const builtinContainer = document.getElementById('builtinDomainList');
  builtinContainer.innerHTML = '';
  const enabledSet = new Set(enabledBuiltinAdDomains || []);
  (builtinAdDomains || []).sort().forEach((domain) => {
    const row = renderDomainToggleRow(domain, enabledSet.has(domain), async (enabled) => {
      await chrome.runtime.sendMessage({ type: 'toggleBuiltinDomain', domain, enabled });
      document.getElementById('saveStatus').textContent = `Updated ${domain}.`;
      await load();
    });
    builtinContainer.appendChild(row);
  });

  const discoveredContainer = document.getElementById('discoveredDomainList');
  discoveredContainer.innerHTML = '';
  const discovered = [...(state.discoveredAdDomains || [])].sort();
  if (!discovered.length) {
    discoveredContainer.innerHTML = '<div class="empty">No discovered redirect ad domains yet.</div>';
  } else {
    discovered.forEach((domain) => {
      const row = renderDomainToggleRow(domain, true, async (enabled) => {
        if (!enabled) {
          await chrome.runtime.sendMessage({ type: 'removeDiscoveredDomain', domain });
          document.getElementById('saveStatus').textContent = `Removed ${domain} from blacklist.`;
          await load();
        }
      });
      discoveredContainer.appendChild(row);
    });
  }
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  let customCssSelectors = {};
  try {
    customCssSelectors = JSON.parse(document.getElementById('customCssSelectors').value || '{}');
  } catch {
    document.getElementById('saveStatus').textContent = 'Invalid JSON in custom CSS selectors.';
    return;
  }

  const payload = {
    popupBlockingEnabled: document.getElementById('popupBlockingEnabled').checked,
    cosmeticBlockingEnabled: document.getElementById('cosmeticBlockingEnabled').checked,
    customBlockDomains: document.getElementById('customBlockDomains').value.split(/\r?\n/).map(v => v.trim()).filter(Boolean),
    allowlist: document.getElementById('allowlist').value.split(/\r?\n/).map(v => v.trim().toLowerCase()).filter(Boolean),
    customCssSelectors
  };
  await chrome.runtime.sendMessage({ type: 'saveOptions', payload });
  document.getElementById('saveStatus').textContent = 'Saved.';
  await load();
});

document.getElementById('openInspector').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.runtime.sendMessage({ type: 'openInspector', tabId: tab?.id });
});

load();
