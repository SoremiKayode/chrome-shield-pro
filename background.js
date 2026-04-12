const BUILTIN_BLOCKED_DOMAINS = [
  'doubleclick.net','googlesyndication.com','googleadservices.com','adservice.google.com',
  'ads.youtube.com','adnxs.com','taboola.com','outbrain.com','criteo.com','rubiconproject.com',
  'pubmatic.com','openx.net','adsrvr.org','scorecardresearch.com','quantserve.com',
  'amazon-adsystem.com','casalemedia.com','smartadserver.com','zedo.com','moatads.com',
  'googletagmanager.com','google-analytics.com','facebook.net','connect.facebook.net'
];

const BUILTIN_URL_PATTERNS = [
  'doubleclick',
  'googlesyndication',
  'googleadservices',
  'taboola',
  'outbrain',
  'adservice',
  'adserver',
  'banner',
  'popup',
  'sponsor'
];

const BUILTIN_COSMETIC = [
  '.ad','.ads','.advertisement','.sponsored','[id^="ad-"]','[class*=" ad-"]',
  'iframe[src*="doubleclick.net"]','iframe[src*="googlesyndication.com"]',
  '.cookie-banner-ad','.newsletter-popup','.sticky-ad','.ad-slot','.banner-ad'
];

const DEFAULT_STATE = {
  enabled: true,
  popupBlockingEnabled: true,
  cosmeticBlockingEnabled: true,
  allowlist: [],
  customBlockDomains: [],
  customCssSelectors: {},
  stats: { blockedTotal: 0, popupTotal: 0 },
  logger: [],
  perTab: {},
  maxLogEntries: 700,
  lastUpdatedAt: null,
  lastInspectorTabId: null
};

let state = structuredClone(DEFAULT_STATE);
const popupCandidates = new Map();

function normalizeHost(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function baseDomain(host) {
  const parts = String(host || '').split('.').filter(Boolean);
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

function isAllowed(pageUrl) {
  const host = normalizeHost(pageUrl);
  return state.allowlist.some(entry => host === entry || host.endsWith('.' + entry));
}

function adLikeHost(host) {
  const h = String(host || '').toLowerCase();
  return BUILTIN_BLOCKED_DOMAINS.some(d => h === d || h.endsWith('.' + d)) || /(ad|ads|trk|track|pop|banner|promo|sponsor)/i.test(h);
}

function adLikeUrl(url) {
  return /(doubleclick|googlesyndication|googleadservices|taboola|outbrain|criteo|adnxs|rubicon|pubmatic|adsrvr|advert|adserver|banner|popup|sponsor|promo)/i.test(String(url || ''));
}

function remotePopupLikely(sourceUrl, targetUrl) {
  const sourceHost = normalizeHost(sourceUrl);
  const targetHost = normalizeHost(targetUrl);
  if (!sourceHost || !targetHost) return false;
  if (baseDomain(sourceHost) === baseDomain(targetHost)) return false;
  return adLikeHost(targetHost) || adLikeUrl(targetUrl);
}

function ensureTab(tabId) {
  if (tabId < 0) return null;
  state.perTab[tabId] = state.perTab[tabId] || { total: 0, hosts: {}, rules: {}, recent: [], pageUrl: '' };
  return state.perTab[tabId];
}

function inferRule(url) {
  const host = normalizeHost(url);
  const domainMatch = [...BUILTIN_BLOCKED_DOMAINS, ...state.customBlockDomains]
    .map(v => String(v || '').trim().toLowerCase())
    .filter(Boolean)
    .find(d => host === d || host.endsWith('.' + d));
  if (domainMatch) return `||${domainMatch}^`;
  const patternMatch = BUILTIN_URL_PATTERNS.find(token => token && String(url || '').toLowerCase().includes(String(token).toLowerCase()));
  return patternMatch || (host ? `||${host}^` : 'popup-block');
}

function pushRecent(tabId, item) {
  const tab = ensureTab(tabId);
  if (!tab) return;
  tab.recent.unshift(item);
  tab.recent = tab.recent.slice(0, 15);
}

function pushLog(entry) {
  state.logger.unshift({ id: crypto.randomUUID(), ts: Date.now(), ...entry });
  state.logger = state.logger.slice(0, state.maxLogEntries);
}

function trackPopupCandidate(tabId, sourceTabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  popupCandidates.set(tabId, { sourceTabId, createdAt: Date.now() });
}

function dropPopupCandidate(tabId) {
  popupCandidates.delete(tabId);
}

async function maybeBlockPopupTarget(sourceTabId, targetTabId, sourceUrl, targetUrl, action) {
  if (!sourceUrl || isAllowed(sourceUrl) || !targetUrl) return false;
  if (!remotePopupLikely(sourceUrl, targetUrl)) return false;
  await chrome.tabs.remove(targetTabId).catch(() => {});
  dropPopupCandidate(targetTabId);
  const host = normalizeHost(targetUrl);
  const ruleText = inferRule(targetUrl);
  const item = { host, url: targetUrl, type: 'popup', action };
  bumpTab(sourceTabId, host, ruleText, item);
  state.stats.popupTotal += 1;
  pushLog({ tabId: sourceTabId, ruleText, ...item });
  await saveState();
  return true;
}

function bumpTab(tabId, host, ruleText, item) {
  const tab = ensureTab(tabId);
  if (!tab) return;
  tab.total += 1;
  if (host) tab.hosts[host] = (tab.hosts[host] || 0) + 1;
  if (ruleText) tab.rules[ruleText] = (tab.rules[ruleText] || 0) + 1;
  if (item) pushRecent(tabId, item);
  state.stats.blockedTotal += 1;
  updateBadge(tabId).catch(() => {});
}

async function loadState() {
  const stored = await chrome.storage.local.get('state');
  state = { ...structuredClone(DEFAULT_STATE), ...(stored.state || {}) };
}

async function saveState() {
  await chrome.storage.local.set({ state });
}

const rulesFromDomains = (domains, priority = 1) => domains.map((domain, idx) => ({
  id: 1000 + idx,
  priority,
  action: { type: 'block' },
  condition: {
    requestDomains: [domain],
    resourceTypes: ['main_frame','sub_frame','script','image','xmlhttprequest','stylesheet','font','media']
  }
}));

const rulesFromPatterns = (patterns, startId = 50000, priority = 1) => patterns.map((pattern, idx) => ({
  id: startId + idx,
  priority,
  action: { type: 'block' },
  condition: {
    urlFilter: pattern,
    resourceTypes: ['main_frame','sub_frame','script','image','xmlhttprequest']
  }
}));

async function rebuildRules() {
  const allDomains = [...new Set([...BUILTIN_BLOCKED_DOMAINS, ...state.customBlockDomains.map(v => v.trim()).filter(Boolean)])];
  const newRules = [...rulesFromDomains(allDomains), ...rulesFromPatterns(BUILTIN_URL_PATTERNS)];
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(r => r.id),
    addRules: newRules
  });
  state.lastUpdatedAt = new Date().toISOString();
  await saveState();
}

async function updateBadge(tabId) {
  const total = state.perTab[tabId]?.total || 0;
  await chrome.action.setBadgeBackgroundColor({ color: '#5b5cf0', tabId });
  await chrome.action.setBadgeText({ text: total ? String(Math.min(total, 999)) : '', tabId });
}

chrome.runtime.onInstalled.addListener(async () => {
  await loadState();
  await rebuildRules();
  chrome.alarms.create('refreshRules', { periodInMinutes: 60 });
});

chrome.runtime.onStartup.addListener(async () => {
  await loadState();
  await rebuildRules();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'refreshRules') {
    await loadState();
    await rebuildRules();
  }
});

chrome.webRequest.onErrorOccurred.addListener(async (details) => {
  if (!state.enabled) return;
  if (!details.error || !details.error.includes('ERR_BLOCKED_BY_CLIENT')) return;
  const host = normalizeHost(details.url);
  const ruleText = inferRule(details.url);
  const item = { host, url: details.url, type: details.type || 'request', action: 'blocked' };
  bumpTab(details.tabId, host, ruleText, item);
  pushLog({ tabId: details.tabId, ruleText, ...item });
  await saveState();
}, { urls: ['<all_urls>'] });

chrome.tabs.onCreated.addListener(async (tab) => {
  if (!state.enabled || !state.popupBlockingEnabled) return;
  if (tab.openerTabId == null) return;
  trackPopupCandidate(tab.id, tab.openerTabId);
  const opener = await chrome.tabs.get(tab.openerTabId).catch(() => null);
  const openerUrl = opener?.url || '';
  if (isAllowed(openerUrl)) return;
  if (await maybeBlockPopupTarget(tab.openerTabId, tab.id, openerUrl, tab.pendingUrl || '', 'blocked-before-open')) return;
  const startedAt = Date.now();
  const probe = async () => {
    if (!popupCandidates.has(tab.id)) return;
    if ((Date.now() - startedAt) > 2500) return;
    const latest = await chrome.tabs.get(tab.id).catch(() => null);
    const targetUrl = latest?.url || latest?.pendingUrl || '';
    const blocked = await maybeBlockPopupTarget(tab.openerTabId, tab.id, openerUrl, targetUrl, 'blocked-fast-follow-up');
    if (!blocked) setTimeout(probe, 120);
  };
  setTimeout(probe, 120);
});


chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  if (!state.enabled || !state.popupBlockingEnabled) return;
  trackPopupCandidate(details.tabId, details.sourceTabId);
  const source = details.sourceTabId >= 0 ? (await chrome.tabs.get(details.sourceTabId).catch(() => null)) : null;
  const sourceUrl = source?.url || '';
  await maybeBlockPopupTarget(details.sourceTabId, details.tabId, sourceUrl, details.url || '', 'blocked-before-load');
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete state.perTab[tabId];
  dropPopupCandidate(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (state.enabled && state.popupBlockingEnabled && (info.url || tab.url) && popupCandidates.has(tabId)) {
    const candidate = popupCandidates.get(tabId);
    const sourceTabId = candidate?.sourceTabId ?? tab.openerTabId ?? -1;
    const source = sourceTabId >= 0 ? await chrome.tabs.get(sourceTabId).catch(() => null) : null;
    const sourceUrl = source?.url || '';
    const targetUrl = info.url || tab.url || '';
    const candidateExpired = !candidate || (Date.now() - candidate.createdAt) > 5000;
    if (!sourceUrl || isAllowed(sourceUrl) || candidateExpired) {
      dropPopupCandidate(tabId);
    } else if (await maybeBlockPopupTarget(sourceTabId, tabId, sourceUrl, targetUrl, 'blocked-on-redirect')) {
      return;
    } else if (baseDomain(normalizeHost(sourceUrl)) === baseDomain(normalizeHost(targetUrl))) {
      dropPopupCandidate(tabId);
    }
  }
  if (info.status === 'loading') {
    const entry = ensureTab(tabId);
    if (entry) entry.pageUrl = tab.url || entry.pageUrl;
    await updateBadge(tabId).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'getState') {
      const requestedTabId = Number.isInteger(message.tabId) ? message.tabId : null;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = requestedTabId ?? state.lastInspectorTabId ?? (tab?.id ?? -1);
      const entry = state.perTab[tabId] || { hosts: {}, rules: {}, recent: [] };
      sendResponse({
        ok: true,
        state,
        activeTabId: tabId,
        activeTab: tab,
        hostCounts: entry.hosts || {},
        ruleCounts: entry.rules || {},
        recentItems: entry.recent || [],
        builtinCosmetic: BUILTIN_COSMETIC
      });
      return;
    }
    if (message.type === 'toggleEnabled') {
      state.enabled = !state.enabled;
      await saveState();
      sendResponse({ ok: true, enabled: state.enabled });
      return;
    }
    if (message.type === 'toggleAllowlist') {
      const host = String(message.host || '').toLowerCase();
      if (!host) return sendResponse({ ok: false });
      if (state.allowlist.includes(host)) state.allowlist = state.allowlist.filter(h => h !== host);
      else state.allowlist.push(host);
      await saveState();
      sendResponse({ ok: true, allowlist: state.allowlist });
      return;
    }
    if (message.type === 'saveOptions') {
      state = { ...state, ...message.payload };
      await saveState();
      await rebuildRules();
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'popupBlocked') {
      state.stats.popupTotal += 1;
      const host = normalizeHost(message.url || '');
      const ruleText = inferRule(message.url || '');
      const tabId = sender.tab?.id ?? -1;
      const item = { host, url: message.url || '', type: 'popup', action: 'blocked-in-page' };
      bumpTab(tabId, host, ruleText, item);
      pushLog({ tabId, ruleText, ...item });
      await saveState();
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'elementPicked') {
      const host = String(message.host || '').toLowerCase();
      if (!host || !message.selector) return sendResponse({ ok: false });
      const current = state.customCssSelectors[host] || [];
      if (!current.includes(message.selector)) current.push(message.selector);
      state.customCssSelectors[host] = current;
      await saveState();
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'openInspector') {
      state.lastInspectorTabId = Number.isInteger(message.tabId) ? message.tabId : state.lastInspectorTabId;
      await saveState();
      await chrome.tabs.create({ url: chrome.runtime.getURL('inspector.html') });
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: 'Unknown message' });
  })();
  return true;
});
