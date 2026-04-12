async function getState(tabId) {
  return chrome.runtime.sendMessage({ type: 'getState', tabId });
}

function fmtDate(v) {
  if (!v) return '-';
  try { return new Date(v).toLocaleString(); } catch { return v; }
}

function shortenUrl(url, limit = 62) {
  const text = String(url || '');
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

function renderCountList(container, entries, emptyText, formatter) {
  container.innerHTML = '';
  if (!entries.length) {
    container.innerHTML = `<div class="empty">${emptyText}</div>`;
    return;
  }
  entries.forEach(formatter);
}

async function getShowSiteHost() {
  const stored = await chrome.storage.local.get('showSiteHost');
  return stored.showSiteHost !== false;
}

async function setShowSiteHost(showSiteHost) {
  await chrome.storage.local.set({ showSiteHost });
}

async function render() {
  const [tabQuery] = await chrome.tabs.query({ active: true, currentWindow: true });
  const response = await getState(tabQuery?.id);
  const state = response.state;
  const tab = response.activeTab;
  const host = (() => { try { return new URL(tab?.url || '').hostname; } catch { return '-'; } })();
  const showSiteHost = await getShowSiteHost();

  document.getElementById('enabledToggle').checked = !!state.enabled;
  document.getElementById('statusText').textContent = state.enabled ? 'Enabled' : 'Disabled';
  document.getElementById('totalBlocked').textContent = String(state.stats.adsBlockedTotal || state.stats.blockedTotal || 0);
  document.getElementById('popupBlocked').textContent = String(state.stats.popupTotal || 0);
  document.getElementById('siteHost').textContent = showSiteHost ? host : 'Hidden';
  document.getElementById('updatedAt').textContent = `Last rules update: ${fmtDate(state.lastUpdatedAt)}`;

  const allowlisted = state.allowlist.includes(host);
  const popupSiteOn = (state.popupBlockSites || []).includes(host);
  document.getElementById('allowlistToggle').checked = allowlisted;
  document.getElementById('popupSiteToggle').checked = popupSiteOn;
  document.getElementById('siteHostToggle').checked = showSiteHost;

  const domainList = document.getElementById('domainList');
  const domainEntries = Object.entries(response.hostCounts || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  renderCountList(domainList, domainEntries, 'No blocked requests on this tab yet.', ([domain, count]) => {
    const item = document.createElement('div');
    item.className = 'domain-card';
    item.innerHTML = `<div class="stack min0"><div class="domain">${domain}</div><div class="subtle">blocked requests</div></div><div class="count-pill">${count}</div>`;
    domainList.appendChild(item);
  });

  const rulesList = document.getElementById('rulesList');
  const ruleEntries = Object.entries(response.ruleCounts || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  renderCountList(rulesList, ruleEntries, 'No rule hits on this tab yet.', ([rule, count]) => {
    const item = document.createElement('div');
    item.className = 'rule-card';
    item.innerHTML = `<div class="stack min0"><div class="rule-text">${rule}</div><div class="subtle">matched blocking rule</div></div><div class="count-pill">${count}</div>`;
    rulesList.appendChild(item);
  });

  const recentList = document.getElementById('recentItems');
  const recentEntries = (response.recentItems || []).slice(0, 5);
  renderCountList(recentList, recentEntries, 'No recent blocked items on this tab yet.', (entry) => {
    const item = document.createElement('div');
    item.className = 'item-row';
    item.innerHTML = `
      <div class="stack min0">
        <strong>${entry.host || 'Blocked item'}</strong>
        <div class="hint" title="${entry.url || ''}">${shortenUrl(entry.url || '')}</div>
      </div>
      <span class="type-chip">${entry.type || 'request'}</span>`;
    recentList.appendChild(item);
  });

  document.getElementById('enabledToggle').onchange = async () => {
    await chrome.runtime.sendMessage({ type: 'toggleEnabled' });
    render();
  };
  document.getElementById('allowlistToggle').onchange = async () => {
    await chrome.runtime.sendMessage({ type: 'toggleAllowlist', host });
    render();
  };
  document.getElementById('popupSiteToggle').onchange = async () => {
    await chrome.runtime.sendMessage({ type: 'togglePopupBlockSite', host });
    render();
  };
  document.getElementById('siteHostToggle').onchange = async (event) => {
    await setShowSiteHost(event.target.checked);
    render();
  };
  document.getElementById('openOptions').onclick = () => chrome.runtime.openOptionsPage();
  document.getElementById('openInspector').onclick = async () => {
    await chrome.runtime.sendMessage({ type: 'openInspector', tabId: tabQuery?.id });
    window.close();
  };
  document.getElementById('pickElement').onclick = async () => {
    if (!tab?.id) return;
    await chrome.tabs.sendMessage(tab.id, { type: 'startPicker' });
    window.close();
  };
}

render();
