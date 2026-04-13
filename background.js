const BUILTIN_BLOCKED_DOMAINS = [
  'doubleclick.net','googlesyndication.com','googleadservices.com','adservice.google.com','ads.youtube.com','googletagservices.com','pagead2.googlesyndication.com',
  'adnxs.com','taboola.com','outbrain.com','criteo.com','rubiconproject.com','pubmatic.com','openx.net','adsrvr.org','casalemedia.com','smartadserver.com','zedo.com','moatads.com','lijit.com','33across.com','media.net','yieldmo.com','triplelift.com','sharethrough.com','teads.tv','onetag.com','imrworldwide.com','serving-sys.com','contextweb.com','sovrn.com','gumgum.com','undertone.com','rhythmone.com','trafficjunky.net','spotxchange.com',
  'scorecardresearch.com','quantserve.com','amazon-adsystem.com','everesttech.net','turn.com','tapad.com','mathtag.com','demdex.net','bluekai.com','exelator.com','sitescout.com','simpli.fi','crwdcntrl.net','adform.net','addthis.com','addtoany.com','rlcdn.com','bidswitch.net',
  'propellerads.com','propeller-tracking.com','popads.net','popcash.net','adcash.com','hilltopads.net','exoclick.com','juicyads.com','trafficstars.com','mgid.com','revcontent.com','adsterra.com','clickadu.com','adcashnetwork.com',
  'googletagmanager.com','google-analytics.com','facebook.net','connect.facebook.net','branch.io','braze.com','appsflyer.com','kochava.com','adjust.com','hotjar.com','segment.com','mixpanel.com','optimizely.com',
  'adcolony.com','applovin.com','unityads.unity3d.com','ironsrc.com','vungle.com','inmobi.com','chartboost.com','smaato.net','mobfox.com','inner-active.mobi','leadbolt.net','admob.com',
  'adroll.com','adriver.ru','adsafeprotected.com','adition.com','adscale.de','adtech.de','adtechus.com','admanmedia.com','adkernel.com','adnuntius.com','adgebra.co','adgrx.com','adview.cn',
  'bidr.io','rtbhouse.com','rtmark.net','smadex.com','xandr.com','loopme.com','imonomy.com','revx.io','performax.cz','w55c.net','mookie1.com','fwmrm.net','atdmt.com','2mdn.net'
];

const BUILTIN_URL_PATTERNS = [
  'doubleclick','googlesyndication','googleadservices','taboola','outbrain','criteo','adnxs','rubicon','pubmatic','adsrvr','advert','adserver','banner','popup','popunder','sponsor','promoted','tracking','pixel','retarget'
];

const BUILTIN_COSMETIC = [
  '.ad','.ads','.advertisement','.sponsored','[id^="ad-"]','[class*=" ad-"]',
  'iframe[src*="doubleclick.net"]','iframe[src*="googlesyndication.com"]',
  '.cookie-banner-ad','.newsletter-popup','.sticky-ad','.ad-slot','.banner-ad'
];

const API_BASE_URL = 'https://api.yourdomain.com/api';
const PRODUCT_ID = 'prod_adblocker_001';
const SOCIAL_LOGIN_URL = 'https://yourdomain.com/social-login';
const PREMIUM_PRICE_USD = 3;
const FREE_LIMITS = { ads: 200, popups: 100 };

const REDIRECT_OBSERVE_MS = 12000;
const REDIRECT_POLL_MS = 25;

const DEFAULT_STATE = {
  enabled: true,
  popupBlockingEnabled: true,
  cosmeticBlockingEnabled: true,
  allowlist: [],
  customBlockDomains: [],
  customCssSelectors: {},
  disabledBuiltinDomains: [],
  discoveredAdDomains: [],
  popupBlockSites: [],
  stats: { blockedTotal: 0, popupTotal: 0, adsBlockedTotal: 0 },
  usage: {
    monthKey: '',
    adsBlocked: 0,
    popupsBlocked: 0,
    limitExceeded: false,
    notifiedAt: null
  },
  auth: {
    token: '',
    user: null,
    productId: PRODUCT_ID,
    hasAccess: false,
    paymentStatus: 'unpaid',
    lastSyncTime: null
  },
  product: null,
  logger: [],
  perTab: {},
  maxLogEntries: 700,
  lastUpdatedAt: null,
  lastInspectorTabId: null
};

let state = structuredClone(DEFAULT_STATE);
const popupCandidates = new Map();
let stateLoaded = false;
let stateLoadPromise = null;

async function ensureStateLoaded() {
  if (stateLoaded) return;
  if (!stateLoadPromise) {
    stateLoadPromise = (async () => {
      await loadState();
      stateLoaded = true;
    })();
  }
  await stateLoadPromise;
}

function nowMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function hasPremiumAccess() {
  return !!(state.auth?.hasAccess || state.auth?.paymentStatus === 'paid');
}

function ensureUsageFresh() {
  state.usage = state.usage || structuredClone(DEFAULT_STATE.usage);
  const monthKey = nowMonthKey();
  if (state.usage.monthKey !== monthKey) {
    state.usage = {
      monthKey,
      adsBlocked: 0,
      popupsBlocked: 0,
      limitExceeded: false,
      notifiedAt: null
    };
  }
}

function isBlockingPausedByLimit() {
  ensureUsageFresh();
  return !!state.usage.limitExceeded && !hasPremiumAccess();
}

function isBlockingActive() {
  return !!state.enabled && !isBlockingPausedByLimit();
}

function normalizeHost(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function canonicalHost(input) {
  const host = normalizeHost(input) || String(input || '').trim().toLowerCase();
  if (!host) return '';
  return baseDomain(host) || host;
}

function hostMatchesList(host, entries = []) {
  const target = canonicalHost(host);
  if (!target) return false;
  return normalizeDomainList(entries).some((entry) => {
    const normalizedEntry = canonicalHost(entry);
    return !!normalizedEntry && (target === normalizedEntry || target.endsWith('.' + normalizedEntry));
  });
}

function baseDomain(host) {
  const parts = String(host || '').split('.').filter(Boolean);
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

function normalizeDomainList(values) {
  return [...new Set((values || []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean))];
}

function effectiveBuiltinDomains() {
  const disabled = new Set(normalizeDomainList(state.disabledBuiltinDomains));
  return BUILTIN_BLOCKED_DOMAINS.filter(domain => !disabled.has(domain));
}

function allBlockedDomains() {
  return normalizeDomainList([...effectiveBuiltinDomains(), ...state.customBlockDomains, ...state.discoveredAdDomains]);
}

function isAllowed(pageUrl) {
  return hostMatchesList(pageUrl, state.allowlist);
}

function shouldForcePopupBlock(pageUrl) {
  return hostMatchesList(pageUrl, state.popupBlockSites);
}

function adLikeHost(host) {
  const h = String(host || '').toLowerCase();
  return allBlockedDomains().some(d => h === d || h.endsWith('.' + d)) || /(ad|ads|trk|track|pop|banner|promo|sponsor|click|push)/i.test(h);
}

function adLikeUrl(url) {
  return /(doubleclick|googlesyndication|googleadservices|taboola|outbrain|criteo|adnxs|rubicon|pubmatic|adsrvr|advert|adserver|banner|popup|popunder|sponsor|promo|retarget|affiliate|tracking|clickid=)/i.test(String(url || ''));
}

function remotePopupLikely(sourceUrl, targetUrl) {
  const sourceHost = normalizeHost(sourceUrl);
  const targetHost = normalizeHost(targetUrl);
  if (!sourceHost || !targetHost) return false;
  if (baseDomain(sourceHost) === baseDomain(targetHost)) return false;
  return adLikeHost(targetHost) || adLikeUrl(targetUrl);
}

function isBrowserNewTabUrl(url) {
  const value = String(url || '').toLowerCase();
  return value === 'chrome://newtab/' || value === 'chrome://newtab' || value === 'about:newtab';
}

function ensureTab(tabId) {
  if (tabId < 0) return null;
  state.perTab[tabId] = state.perTab[tabId] || { total: 0, hosts: {}, rules: {}, recent: [], pageUrl: '' };
  return state.perTab[tabId];
}

function inferRule(url) {
  const host = normalizeHost(url);
  const domainMatch = allBlockedDomains().find(d => host === d || host.endsWith('.' + d));
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
  popupCandidates.set(tabId, {
    sourceTabId,
    createdAt: Date.now(),
    seenUrls: new Set(),
    firstTargetUrl: '',
    blocked: false
  });
}

function dropPopupCandidate(tabId) {
  popupCandidates.delete(tabId);
}

function learnAdDomain(url) {
  const host = normalizeHost(url);
  if (!host) return false;
  const blocked = new Set(allBlockedDomains());
  if (blocked.has(host)) return false;
  state.discoveredAdDomains = normalizeDomainList([...state.discoveredAdDomains, host]);
  return true;
}

function incrementUsage(kind) {
  ensureUsageFresh();
  if (kind === 'popup') state.usage.popupsBlocked += 1;
  else state.usage.adsBlocked += 1;

  const exceeded = state.usage.adsBlocked >= FREE_LIMITS.ads || state.usage.popupsBlocked >= FREE_LIMITS.popups;
  if (exceeded && !hasPremiumAccess()) {
    state.usage.limitExceeded = true;
    state.usage.notifiedAt = new Date().toISOString();
  }
}

async function setAuthStorage(auth) {
  await chrome.storage.local.set({
    token: auth.token || '',
    user: auth.user || null,
    productId: auth.productId || PRODUCT_ID,
    hasAccess: !!auth.hasAccess,
    paymentStatus: auth.paymentStatus || 'unpaid',
    lastSyncTime: auth.lastSyncTime || null
  });
}

async function apiFetch(path, options = {}) {
  const token = state.auth?.token;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

async function refreshProductMetadata() {
  try {
    const data = await apiFetch(`/products/${encodeURIComponent(PRODUCT_ID)}`, { method: 'GET' });
    state.product = data.product || data;
  } catch {
    const fallback = await apiFetch(`/products/plugin-metadata?productId=${encodeURIComponent(PRODUCT_ID)}`, { method: 'GET' });
    state.product = fallback.product || fallback;
  }
  state.auth.productId = PRODUCT_ID;
  await saveState();
  await setAuthStorage(state.auth);
  return state.product;
}

async function checkAccess() {
  if (!state.auth?.user?.id) return { hasAccess: false };
  const query = `?userId=${encodeURIComponent(state.auth.user.id)}&productId=${encodeURIComponent(PRODUCT_ID)}`;
  const data = await apiFetch(`/payments/check-access${query}`, { method: 'GET' });
  state.auth.hasAccess = !!data.hasAccess;
  state.auth.paymentStatus = data.hasAccess ? 'paid' : 'unpaid';
  state.auth.lastSyncTime = new Date().toISOString();
  if (state.auth.hasAccess) state.usage.limitExceeded = false;
  await saveState();
  await setAuthStorage(state.auth);
  await rebuildRules();
  return data;
}

async function maybeBlockPopupTarget(sourceTabId, targetTabId, sourceUrl, targetUrl, action, forceBlock = false) {
  if (!isBlockingActive()) return false;
  if (!sourceUrl || !targetUrl) return false;
  if (isBrowserNewTabUrl(targetUrl)) return false;
  if (!forceBlock && isAllowed(sourceUrl)) return false;
  if (!forceBlock && !remotePopupLikely(sourceUrl, targetUrl)) return false;

  if (!forceBlock) learnAdDomain(targetUrl);
  await chrome.tabs.remove(targetTabId).catch(() => {});
  dropPopupCandidate(targetTabId);

  const host = normalizeHost(targetUrl);
  const ruleText = inferRule(targetUrl);
  const item = { host, url: targetUrl, type: 'popup', action };
  bumpTab(sourceTabId, host, ruleText, item, 'popup');
  state.stats.popupTotal += 1;
  pushLog({ tabId: sourceTabId, ruleText, ...item });

  await rebuildRules();
  await saveState();
  return true;
}

function bumpTab(tabId, host, ruleText, item, usageKind = 'ad') {
  const tab = ensureTab(tabId);
  if (tab) {
    tab.total += 1;
    if (host) tab.hosts[host] = (tab.hosts[host] || 0) + 1;
    if (ruleText) tab.rules[ruleText] = (tab.rules[ruleText] || 0) + 1;
    if (item) pushRecent(tabId, item);
  }
  state.stats.blockedTotal += 1;
  state.stats.adsBlockedTotal = (state.stats.adsBlockedTotal || 0) + (usageKind === 'popup' ? 0 : 1);
  incrementUsage(usageKind);
  updateBadge(tabId).catch(() => {});
}

async function loadState() {
  const stored = await chrome.storage.local.get('state');
  const authStored = await chrome.storage.local.get(['token', 'user', 'productId', 'hasAccess', 'paymentStatus', 'lastSyncTime']);
  const syncStored = await chrome.storage.sync.get('persistentStats');
  state = { ...structuredClone(DEFAULT_STATE), ...(stored.state || {}) };
  state.customBlockDomains = normalizeDomainList(state.customBlockDomains);
  state.discoveredAdDomains = normalizeDomainList(state.discoveredAdDomains);
  state.disabledBuiltinDomains = normalizeDomainList(state.disabledBuiltinDomains);
  state.allowlist = normalizeDomainList(state.allowlist).map(canonicalHost).filter(Boolean);
  state.popupBlockSites = normalizeDomainList(state.popupBlockSites).map(canonicalHost).filter(Boolean);
  if (!state.stats || typeof state.stats !== 'object') state.stats = { ...DEFAULT_STATE.stats };
  if (!Number.isFinite(state.stats.adsBlockedTotal)) state.stats.adsBlockedTotal = Number(state.stats.blockedTotal || 0);
  mergePersistentStats(syncStored.persistentStats);
  state.auth = {
    ...structuredClone(DEFAULT_STATE.auth),
    ...(state.auth || {}),
    token: authStored.token || state.auth?.token || '',
    user: authStored.user || state.auth?.user || null,
    productId: authStored.productId || state.auth?.productId || PRODUCT_ID,
    hasAccess: authStored.hasAccess ?? state.auth?.hasAccess ?? false,
    paymentStatus: authStored.paymentStatus || state.auth?.paymentStatus || 'unpaid',
    lastSyncTime: authStored.lastSyncTime || state.auth?.lastSyncTime || null
  };
  ensureUsageFresh();
}

async function savePersistentStats() {
  const stats = state.stats || {};
  await chrome.storage.sync.set({
    persistentStats: {
      blockedTotal: Number(stats.blockedTotal || 0),
      popupTotal: Number(stats.popupTotal || 0),
      adsBlockedTotal: Number(stats.adsBlockedTotal || 0),
      updatedAt: new Date().toISOString()
    }
  });
}

function mergePersistentStats(persistentStats) {
  if (!persistentStats || typeof persistentStats !== 'object') return;
  state.stats = state.stats || { ...DEFAULT_STATE.stats };
  state.stats.blockedTotal = Math.max(Number(state.stats.blockedTotal || 0), Number(persistentStats.blockedTotal || 0));
  state.stats.popupTotal = Math.max(Number(state.stats.popupTotal || 0), Number(persistentStats.popupTotal || 0));
  state.stats.adsBlockedTotal = Math.max(Number(state.stats.adsBlockedTotal || 0), Number(persistentStats.adsBlockedTotal || 0));
}

async function saveState() {
  await chrome.storage.local.set({ state });
  await savePersistentStats();
}

const rulesFromDomains = (domains, allowlist = [], priority = 1) => domains.map((domain, idx) => ({
  id: 1000 + idx,
  priority,
  action: { type: 'block' },
  condition: {
    requestDomains: [domain],
    excludedInitiatorDomains: allowlist,
    resourceTypes: ['main_frame','sub_frame','script','image','xmlhttprequest','stylesheet','font','media']
  }
}));

const rulesFromPatterns = (patterns, allowlist = [], startId = 50000, priority = 1) => patterns.map((pattern, idx) => ({
  id: startId + idx,
  priority,
  action: { type: 'block' },
  condition: {
    urlFilter: pattern,
    excludedInitiatorDomains: allowlist,
    resourceTypes: ['main_frame','sub_frame','script','image','xmlhttprequest']
  }
}));

async function rebuildRules() {
  ensureUsageFresh();
  const active = isBlockingActive();
  const allDomains = active ? allBlockedDomains() : [];
  const allowlist = normalizeDomainList(state.allowlist).map(canonicalHost).filter(Boolean);
  const newRules = active ? [...rulesFromDomains(allDomains, allowlist), ...rulesFromPatterns(BUILTIN_URL_PATTERNS, allowlist)] : [];
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(r => r.id),
    addRules: newRules
  });
  state.lastUpdatedAt = new Date().toISOString();
  await saveState();
}

async function updateBadge(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const total = state.perTab[tabId]?.total || 0;
  await chrome.action.setBadgeBackgroundColor({ color: isBlockingPausedByLimit() ? '#ff4f4f' : '#5b5cf0', tabId });
  if (isBlockingPausedByLimit()) {
    await chrome.action.setBadgeText({ text: '!', tabId });
    return;
  }
  await chrome.action.setBadgeText({ text: total ? String(Math.min(total, 999)) : '', tabId });
}

async function checkCandidateRedirect(tabId, targetUrl) {
  const candidate = popupCandidates.get(tabId);
  if (!candidate || candidate.blocked) return;

  const sourceTabId = candidate.sourceTabId ?? -1;
  const source = sourceTabId >= 0 ? await chrome.tabs.get(sourceTabId).catch(() => null) : null;
  const sourceUrl = source?.url || '';

  if (!sourceUrl || isAllowed(sourceUrl)) {
    dropPopupCandidate(tabId);
    return;
  }

  const now = Date.now();
  if ((now - candidate.createdAt) > REDIRECT_OBSERVE_MS) {
    dropPopupCandidate(tabId);
    return;
  }

  if (targetUrl) {
    if (!candidate.firstTargetUrl) candidate.firstTargetUrl = targetUrl;
    candidate.seenUrls.add(targetUrl);
  }

  const forceBlock = shouldForcePopupBlock(sourceUrl);
  const shouldBlock = await maybeBlockPopupTarget(
    sourceTabId,
    tabId,
    sourceUrl,
    targetUrl,
    forceBlock ? 'blocked-site-popup-policy' : (candidate.seenUrls.size > 1 ? 'blocked-delayed-redirect' : 'blocked-fast-follow-up'),
    forceBlock
  );
  if (shouldBlock) {
    candidate.blocked = true;
    return;
  }

  const sourceBase = baseDomain(normalizeHost(sourceUrl));
  const targetBase = baseDomain(normalizeHost(targetUrl));
  if (!forceBlock && sourceBase && targetBase && sourceBase === targetBase && candidate.seenUrls.size <= 1) dropPopupCandidate(tabId);
}

async function syncAccessIfPossible() {
  if (!state.auth?.token || !state.auth?.user?.id) return;
  try { await checkAccess(); } catch {}
}

ensureStateLoaded().catch(() => {});

chrome.runtime.onInstalled.addListener(async () => {
  await loadState();
  await rebuildRules();
  chrome.alarms.create('refreshRules', { periodInMinutes: 60 });
  chrome.alarms.create('syncAccess', { periodInMinutes: 180 });
  try { await refreshProductMetadata(); } catch {}
});

chrome.runtime.onStartup.addListener(async () => {
  await loadState();
  await rebuildRules();
  await syncAccessIfPossible();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'refreshRules') {
    await loadState();
    await rebuildRules();
  }
  if (alarm.name === 'syncAccess') {
    await loadState();
    await syncAccessIfPossible();
  }
});

chrome.webRequest.onErrorOccurred.addListener(async (details) => {
  await ensureStateLoaded();
  if (!isBlockingActive()) return;
  if (!details.error || !details.error.includes('ERR_BLOCKED_BY_CLIENT')) return;
  const host = normalizeHost(details.url);
  const ruleText = inferRule(details.url);
  const item = { host, url: details.url, type: details.type || 'request', action: 'blocked' };
  bumpTab(details.tabId, host, ruleText, item, 'ad');
  pushLog({ tabId: details.tabId, ruleText, ...item });
  await saveState();
  if (isBlockingPausedByLimit()) await rebuildRules();
}, { urls: ['<all_urls>'] });

chrome.tabs.onCreated.addListener(async (tab) => {
  await ensureStateLoaded();
  if (!isBlockingActive() || !state.popupBlockingEnabled) return;
  if (tab.openerTabId == null) return;

  trackPopupCandidate(tab.id, tab.openerTabId);

  const opener = await chrome.tabs.get(tab.openerTabId).catch(() => null);
  const openerUrl = opener?.url || '';
  const forceBlock = shouldForcePopupBlock(openerUrl);
  if (!forceBlock && isAllowed(openerUrl)) return;

  if (await maybeBlockPopupTarget(tab.openerTabId, tab.id, openerUrl, tab.pendingUrl || '', forceBlock ? 'blocked-site-popup-policy' : 'blocked-before-open', forceBlock)) return;

  const startedAt = Date.now();
  const probe = async () => {
    if (!popupCandidates.has(tab.id)) return;
    if ((Date.now() - startedAt) > REDIRECT_OBSERVE_MS) {
      dropPopupCandidate(tab.id);
      return;
    }
    const latest = await chrome.tabs.get(tab.id).catch(() => null);
    const targetUrl = latest?.url || latest?.pendingUrl || '';
    await checkCandidateRedirect(tab.id, targetUrl);
    if (popupCandidates.has(tab.id)) setTimeout(probe, REDIRECT_POLL_MS);
  };
  setTimeout(probe, REDIRECT_POLL_MS);
});

chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  await ensureStateLoaded();
  if (!isBlockingActive() || !state.popupBlockingEnabled) return;
  trackPopupCandidate(details.tabId, details.sourceTabId);
  const source = details.sourceTabId >= 0 ? (await chrome.tabs.get(details.sourceTabId).catch(() => null)) : null;
  const sourceUrl = source?.url || '';
  const forceBlock = shouldForcePopupBlock(sourceUrl);
  await maybeBlockPopupTarget(details.sourceTabId, details.tabId, sourceUrl, details.url || '', forceBlock ? 'blocked-site-popup-policy' : 'blocked-before-load', forceBlock);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete state.perTab[tabId];
  dropPopupCandidate(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  await ensureStateLoaded();
  if (isBlockingActive() && state.popupBlockingEnabled && (info.url || tab.url) && popupCandidates.has(tabId)) {
    await checkCandidateRedirect(tabId, info.url || tab.url || '');
  }
  if (info.status === 'loading') {
    const entry = ensureTab(tabId);
    if (entry) entry.pageUrl = tab.url || entry.pageUrl;
    await updateBadge(tabId).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await ensureStateLoaded();
    if (message.type === 'getState') {
      ensureUsageFresh();
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
        builtinCosmetic: BUILTIN_COSMETIC,
        builtinAdDomains: BUILTIN_BLOCKED_DOMAINS,
        enabledBuiltinAdDomains: effectiveBuiltinDomains(),
        freeLimits: FREE_LIMITS,
        isBlockingPausedByLimit: isBlockingPausedByLimit(),
        premiumPriceUsd: PREMIUM_PRICE_USD
      });
      return;
    }
    if (message.type === 'getAccountState') {
      ensureUsageFresh();
      sendResponse({
        ok: true,
        auth: state.auth,
        product: state.product,
        freeLimits: FREE_LIMITS,
        usage: state.usage,
        isBlockingPausedByLimit: isBlockingPausedByLimit(),
        premiumPriceUsd: PREMIUM_PRICE_USD,
        apiBaseUrl: API_BASE_URL
      });
      return;
    }
    if (message.type === 'toggleEnabled') {
      state.enabled = !state.enabled;
      await saveState();
      await rebuildRules();
      sendResponse({ ok: true, enabled: state.enabled });
      return;
    }
    if (message.type === 'toggleAllowlist') {
      const host = canonicalHost(message.host || '');
      if (!host) return sendResponse({ ok: false });
      if (state.allowlist.includes(host)) state.allowlist = state.allowlist.filter(h => h !== host);
      else state.allowlist.push(host);
      state.allowlist = normalizeDomainList(state.allowlist).map(canonicalHost).filter(Boolean);
      await saveState();
      await rebuildRules();
      sendResponse({ ok: true, allowlist: state.allowlist });
      return;
    }
    if (message.type === 'togglePopupBlockSite') {
      const host = canonicalHost(message.host || '');
      if (!host) return sendResponse({ ok: false });
      if (state.popupBlockSites.includes(host)) state.popupBlockSites = state.popupBlockSites.filter(h => h !== host);
      else state.popupBlockSites.push(host);
      state.popupBlockSites = normalizeDomainList(state.popupBlockSites);
      await saveState();
      sendResponse({ ok: true, popupBlockSites: state.popupBlockSites });
      return;
    }
    if (message.type === 'toggleBuiltinDomain') {
      const domain = String(message.domain || '').trim().toLowerCase();
      const enabled = !!message.enabled;
      if (!domain || !BUILTIN_BLOCKED_DOMAINS.includes(domain)) return sendResponse({ ok: false });
      const disabled = new Set(state.disabledBuiltinDomains || []);
      if (enabled) disabled.delete(domain);
      else disabled.add(domain);
      state.disabledBuiltinDomains = [...disabled];
      await saveState();
      await rebuildRules();
      sendResponse({ ok: true, disabledBuiltinDomains: state.disabledBuiltinDomains });
      return;
    }
    if (message.type === 'removeDiscoveredDomain') {
      const domain = String(message.domain || '').trim().toLowerCase();
      if (!domain) return sendResponse({ ok: false });
      state.discoveredAdDomains = (state.discoveredAdDomains || []).filter(d => d !== domain);
      state.customBlockDomains = (state.customBlockDomains || []).filter(d => d !== domain);
      await saveState();
      await rebuildRules();
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'saveOptions') {
      const payload = { ...message.payload };
      payload.customBlockDomains = normalizeDomainList(payload.customBlockDomains);
      payload.allowlist = normalizeDomainList(payload.allowlist).map(canonicalHost).filter(Boolean);
      if (payload.popupBlockSites) payload.popupBlockSites = normalizeDomainList(payload.popupBlockSites).map(canonicalHost).filter(Boolean);
      state = { ...state, ...payload };
      await saveState();
      await rebuildRules();
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'popupBlocked') {
      if (!isBlockingActive()) return sendResponse({ ok: true, skipped: true });
      state.stats.popupTotal += 1;
      const host = normalizeHost(message.url || '');
      const ruleText = inferRule(message.url || '');
      const tabId = sender.tab?.id ?? -1;
      const item = { host, url: message.url || '', type: 'popup', action: 'blocked-in-page' };
      bumpTab(tabId, host, ruleText, item, 'popup');
      pushLog({ tabId, ruleText, ...item });
      await saveState();
      if (isBlockingPausedByLimit()) await rebuildRules();
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

    if (message.type === 'signup') {
      const data = await apiFetch('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: message.name, email: message.email, password: message.password })
      });
      sendResponse({ ok: true, data });
      return;
    }
    if (message.type === 'login') {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: message.email, password: message.password, productId: PRODUCT_ID })
      });
      if (data?.success) {
        state.auth.token = data.token || '';
        state.auth.user = data.user || null;
        state.auth.productId = PRODUCT_ID;
        state.auth.lastSyncTime = new Date().toISOString();
        await setAuthStorage(state.auth);
        await saveState();
      }
      sendResponse({ ok: true, data });
      return;
    }
    if (message.type === 'startSocialLogin') {
      const callbackUrl = encodeURIComponent(chrome.runtime.getURL('options.html'));
      const url = `${SOCIAL_LOGIN_URL}?productId=${encodeURIComponent(PRODUCT_ID)}&redirect=${callbackUrl}`;
      await chrome.tabs.create({ url });
      sendResponse({ ok: true, url });
      return;
    }
    if (message.type === 'setSocialToken') {
      state.auth.token = String(message.token || '');
      state.auth.user = message.user || state.auth.user || null;
      state.auth.lastSyncTime = new Date().toISOString();
      await saveState();
      await setAuthStorage(state.auth);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'checkAccess') {
      const data = await checkAccess();
      sendResponse({ ok: true, data });
      return;
    }
    if (message.type === 'refreshProductMetadata') {
      const product = await refreshProductMetadata();
      sendResponse({ ok: true, product });
      return;
    }
    if (message.type === 'startPaypalPayment') {
      if (!state.auth?.user?.id) throw new Error('Please log in first.');
      const data = await apiFetch('/payments/paypal/create-order', {
        method: 'POST',
        body: JSON.stringify({ userId: state.auth.user.id, productId: PRODUCT_ID })
      });
      if (data.approvalUrl) await chrome.tabs.create({ url: data.approvalUrl });
      sendResponse({ ok: true, data });
      return;
    }
    if (message.type === 'capturePaypalOrder') {
      if (!state.auth?.user?.id) throw new Error('Please log in first.');
      const data = await apiFetch('/payments/paypal/capture-order', {
        method: 'POST',
        body: JSON.stringify({ userId: state.auth.user.id, productId: PRODUCT_ID, orderId: message.orderId })
      });
      if (data.success) {
        state.auth.hasAccess = true;
        state.auth.paymentStatus = 'paid';
        state.usage.limitExceeded = false;
        state.auth.lastSyncTime = new Date().toISOString();
        await setAuthStorage(state.auth);
        await saveState();
        await rebuildRules();
      }
      sendResponse({ ok: true, data });
      return;
    }
    if (message.type === 'logout') {
      state.auth = structuredClone(DEFAULT_STATE.auth);
      await setAuthStorage(state.auth);
      await saveState();
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: 'Unknown message' });
  })().catch((error) => sendResponse({ ok: false, error: error.message || 'Request failed' }));
  return true;
});
