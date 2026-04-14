async function getState(tabId) {
  return chrome.runtime.sendMessage({ type: 'getState', tabId });
}

function fmtDate(v) {
  if (!v) return '-';
  try { return new Date(v).toLocaleString(); } catch { return v; }
}

function baseDomain(host) {
  const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

function canonicalHost(hostOrUrl) {
  try {
    const parsed = new URL(hostOrUrl);
    return baseDomain(parsed.hostname) || parsed.hostname.toLowerCase();
  } catch {
    const host = String(hostOrUrl || '').trim().toLowerCase();
    return baseDomain(host) || host;
  }
}

function hostMatches(host, entries = []) {
  const target = canonicalHost(host);
  if (!target) return false;
  return (entries || []).some((entry) => {
    const normalized = canonicalHost(entry);
    return normalized && (target === normalized || target.endsWith('.' + normalized));
  });
}

async function getShowSiteHost() {
  const stored = await chrome.storage.local.get('showSiteHost');
  return stored.showSiteHost !== false;
}

async function setShowSiteHost(showSiteHost) {
  await chrome.storage.local.set({ showSiteHost });
}

async function startPremiumCheckout(auth) {
  if (!auth?.user?.id) {
    alert('Please login first from dashboard, then upgrade.');
    chrome.runtime.openOptionsPage();
    return;
  }
  const res = await chrome.runtime.sendMessage({ type: 'startPaypalPayment' });
  if (!res?.ok) alert(res?.error || 'Unable to start payment');
}

async function render() {
  const [tabQuery] = await chrome.tabs.query({ active: true, currentWindow: true });
  const response = await getState(tabQuery?.id);
  if (!response?.ok) return;

  const { state, activeTab, freeLimits } = response;
  const host = (() => { try { return new URL(activeTab?.url || '').hostname; } catch { return '-'; } })();
  const showSiteHost = await getShowSiteHost();

  const usage = state.usage || { adsBlocked: 0, popupsBlocked: 0 };
  const totals = state.stats || { adsBlockedTotal: 0, popupTotal: 0 };
  const paused = response.isBlockingPausedByLimit;
  const auth = state.auth || {};

  document.getElementById('enabledToggle').checked = !!state.enabled;
  document.getElementById('statusText').textContent = paused ? 'Paused (monthly limit reached)' : (state.enabled ? 'Enabled' : 'Disabled');
  document.getElementById('adsMonth').textContent = String(totals.adsBlockedTotal || 0);
  document.getElementById('popupsMonth').textContent = String(totals.popupTotal || 0);
  document.getElementById('siteHost').textContent = showSiteHost ? host : 'Hidden';
  document.getElementById('updatedAt').textContent = `Last rules update: ${fmtDate(state.lastUpdatedAt)}`;
  document.getElementById('limitUsageText').textContent = `Free plan: ${usage.adsBlocked || 0}/${freeLimits.ads} ads, ${usage.popupsBlocked || 0}/${freeLimits.popups} popups this month.`;

  document.getElementById('limitNotice').style.display = paused ? 'block' : 'none';
  document.getElementById('loginState').textContent = auth.user?.email ? 'Logged in' : 'Logged out';
  document.getElementById('paidState').textContent = auth.hasAccess ? 'Paid' : 'Unpaid';

  const allowlisted = hostMatches(host, state.allowlist || []);
  const popupSiteOn = hostMatches(host, state.popupBlockSites || []);
  document.getElementById('allowlistToggle').checked = allowlisted;
  document.getElementById('popupSiteToggle').checked = popupSiteOn;
  document.getElementById('siteHostToggle').checked = showSiteHost;

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
  document.getElementById('openDashboard').onclick = () => chrome.runtime.openOptionsPage();
  document.getElementById('openInspector').onclick = async () => {
    await chrome.runtime.sendMessage({ type: 'openInspector', tabId: tabQuery?.id });
    window.close();
  };
  document.getElementById('pickElement').onclick = async () => {
    if (!activeTab?.id) return;
    await chrome.tabs.sendMessage(activeTab.id, { type: 'startPicker' });
    window.close();
  };
  document.getElementById('subscribePremium').onclick = async () => {
    await startPremiumCheckout(auth);
  };
  document.getElementById('refreshAccess').onclick = async () => {
    const res = await chrome.runtime.sendMessage({ type: 'checkAccess' });
    if (!res?.ok) alert(res?.error || 'Failed to re-sync access');
    render();
  };
  document.getElementById('upgradeNow').onclick = async () => {
    await startPremiumCheckout(auth);
  };
  document.getElementById('blockingUpgradeNow').onclick = async () => {
    await startPremiumCheckout(auth);
  };

  const blockingScreen = document.getElementById('limitBlockingScreen');
  const closeLimitOverlayBtn = document.getElementById('closeLimitOverlay');
  closeLimitOverlayBtn.onclick = () => {
    sessionStorage.setItem('limitOverlayDismissed', '1');
    blockingScreen.style.display = 'none';
  };

  if (!paused) {
    sessionStorage.removeItem('limitOverlayDismissed');
    blockingScreen.style.display = 'none';
    return;
  }

  const overlayDismissed = sessionStorage.getItem('limitOverlayDismissed') === '1';
  blockingScreen.style.display = overlayDismissed ? 'none' : 'flex';
}

render();
