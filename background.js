const BUILTIN_BLOCKED_DOMAINS = [
  // Google / YouTube ad stack
  'doubleclick.net','googlesyndication.com','googleadservices.com','adservice.google.com','ads.youtube.com','googletagservices.com','pagead2.googlesyndication.com',
  // Major exchanges / DSP / SSP
  'adnxs.com','taboola.com','outbrain.com','criteo.com','rubiconproject.com','pubmatic.com','openx.net','adsrvr.org','casalemedia.com','smartadserver.com','zedo.com','moatads.com','lijit.com','33across.com','media.net','yieldmo.com','triplelift.com','sharethrough.com','teads.tv','onetag.com','imrworldwide.com','serving-sys.com','contextweb.com','sovrn.com','gumgum.com','undertone.com','rhythmone.com','trafficjunky.net','spotxchange.com',
  // Tracking / measurement / retargeting
  'scorecardresearch.com','quantserve.com','amazon-adsystem.com','everesttech.net','turn.com','tapad.com','mathtag.com','demdex.net','bluekai.com','exelator.com','sitescout.com','simpli.fi','crwdcntrl.net','adform.net','addthis.com','addtoany.com','rlcdn.com','bidswitch.net',
  // Affiliate / pop / push ad networks commonly seen in malicious redirects
  'propellerads.com','propeller-tracking.com','popads.net','popcash.net','adcash.com','hilltopads.net','exoclick.com','juicyads.com','trafficstars.com','mgid.com','revcontent.com','adsterra.com','clickadu.com','adcashnetwork.com','hilltopads.net',
  // Misc frequently blocked ad/tracker hosts
  'googletagmanager.com','google-analytics.com','facebook.net','connect.facebook.net','branch.io','braze.com','appsflyer.com','kochava.com','adjust.com','hotjar.com','segment.com','mixpanel.com','optimizely.com',
  // Additional ad infra domains
  'adcolony.com','applovin.com','unityads.unity3d.com','ironsrc.com','vungle.com','inmobi.com','chartboost.com','smaato.net','mobfox.com','inner-active.mobi','leadbolt.net','admob.com',
  // Common ad-serving CDNs / redirects
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

const REDIRECT_OBSERVE_MS = 12000;
const REDIRECT_POLL_MS = 250;

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
  const host = normalizeHost(pageUrl);
  return state.allowlist.some(entry => host === entry || host.endsWith('.' + entry));
}


function shouldForcePopupBlock(pageUrl) {
  const host = normalizeHost(pageUrl);
  return state.popupBlockSites.some(entry => host === entry || host.endsWith('.' + entry));
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

async function maybeBlockPopupTarget(sourceTabId, targetTabId, sourceUrl, targetUrl, action, forceBlock = false) {
  if (!sourceUrl || !targetUrl) return false;
  if (!forceBlock && isAllowed(sourceUrl)) return false;
  if (!forceBlock && !remotePopupLikely(sourceUrl, targetUrl)) return false;

  if (!forceBlock) learnAdDomain(targetUrl);
  await chrome.tabs.remove(targetTabId).catch(() => {});
  dropPopupCandidate(targetTabId);

  const host = normalizeHost(targetUrl);
  const ruleText = inferRule(targetUrl);
  const item = { host, url: targetUrl, type: 'popup', action };
  bumpTab(sourceTabId, host, ruleText, item);
  state.stats.popupTotal += 1;
  pushLog({ tabId: sourceTabId, ruleText, ...item });

  await rebuildRules();
  await saveState();
  return true;
}

function bumpTab(tabId, host, ruleText, item) {
  const tab = ensureTab(tabId);
  if (tab) {
    tab.total += 1;
    if (host) tab.hosts[host] = (tab.hosts[host] || 0) + 1;
    if (ruleText) tab.rules[ruleText] = (tab.rules[ruleText] || 0) + 1;
    if (item) pushRecent(tabId, item);
  }
  state.stats.blockedTotal += 1;
  state.stats.adsBlockedTotal = (state.stats.adsBlockedTotal || 0) + 1;
  updateBadge(tabId).catch(() => {});
}

async function loadState() {
  const stored = await chrome.storage.local.get('state');
  state = { ...structuredClone(DEFAULT_STATE), ...(stored.state || {}) };
  state.customBlockDomains = normalizeDomainList(state.customBlockDomains);
  state.discoveredAdDomains = normalizeDomainList(state.discoveredAdDomains);
  state.disabledBuiltinDomains = normalizeDomainList(state.disabledBuiltinDomains);
  state.allowlist = normalizeDomainList(state.allowlist);
  state.popupBlockSites = normalizeDomainList(state.popupBlockSites);
  if (!state.stats || typeof state.stats !== 'object') state.stats = { ...DEFAULT_STATE.stats };
  if (!Number.isFinite(state.stats.adsBlockedTotal)) {
    state.stats.adsBlockedTotal = Number(state.stats.blockedTotal || 0);
  }
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
  const allDomains = allBlockedDomains();
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
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const total = state.perTab[tabId]?.total || 0;
  await chrome.action.setBadgeBackgroundColor({ color: '#5b5cf0', tabId });
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
  if (!forceBlock && sourceBase && targetBase && sourceBase === targetBase && candidate.seenUrls.size <= 1) {
    dropPopupCandidate(tabId);
  }
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
  if (!state.enabled || !state.popupBlockingEnabled) return;
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
  if (state.enabled && state.popupBlockingEnabled && (info.url || tab.url) && popupCandidates.has(tabId)) {
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
        builtinCosmetic: BUILTIN_COSMETIC,
        builtinAdDomains: BUILTIN_BLOCKED_DOMAINS,
        enabledBuiltinAdDomains: effectiveBuiltinDomains()
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
    if (message.type === 'togglePopupBlockSite') {
      const host = String(message.host || '').toLowerCase();
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
      payload.allowlist = normalizeDomainList(payload.allowlist);
      if (payload.popupBlockSites) payload.popupBlockSites = normalizeDomainList(payload.popupBlockSites);
      state = { ...state, ...payload };
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
