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

function setStatus(text) {
  document.getElementById('saveStatus').textContent = text;
}

function setAuthTab(activeTab) {
  const isLogin = activeTab === 'login';
  const loginTab = document.getElementById('authTabLogin');
  const signupTab = document.getElementById('authTabSignup');
  const loginPanel = document.getElementById('loginPanel');
  const signupPanel = document.getElementById('signupPanel');

  loginTab.classList.toggle('active', isLogin);
  signupTab.classList.toggle('active', !isLogin);
  loginTab.setAttribute('aria-selected', String(isLogin));
  signupTab.setAttribute('aria-selected', String(!isLogin));

  loginPanel.classList.toggle('active', isLogin);
  signupPanel.classList.toggle('active', !isLogin);
  loginPanel.hidden = !isLogin;
  signupPanel.hidden = isLogin;
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function syntaxHighlightJson(jsonText) {
  let escaped = escapeHtml(jsonText);
  escaped = escaped.replace(/("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"\s*:)|("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*")|(\btrue\b|\bfalse\b)|(\bnull\b)|(-?\b\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?\b)|([{}\[\],:])/g, (match, key, string, boolean, nullLiteral, number, punctuation) => {
    if (key) return `<span class="key">${key}</span>`;
    if (string) return `<span class="string">${string}</span>`;
    if (boolean) return `<span class="boolean">${boolean}</span>`;
    if (nullLiteral) return `<span class="null">${nullLiteral}</span>`;
    if (number) return `<span class="number">${number}</span>`;
    if (punctuation) return `<span class="punctuation">${punctuation}</span>`;
    return match;
  });
  return escaped;
}

function updateCustomSelectorPreview() {
  const input = document.getElementById('customCssSelectors').value || '{}';
  const preview = document.getElementById('cssSelectorPreview');
  try {
    const parsed = JSON.parse(input);
    const pretty = JSON.stringify(parsed, null, 2);
    preview.innerHTML = syntaxHighlightJson(pretty);
  } catch {
    preview.innerHTML = `<span class="error">Invalid JSON</span>\n${escapeHtml(input)}`;
  }
}

async function refreshAccountSummary() {
  const res = await chrome.runtime.sendMessage({ type: 'getAccountState' });
  if (!res?.ok) return;
  const { auth, usage, freeLimits, isBlockingPausedByLimit } = res;
  const banner = document.getElementById('accountBanner');
  const logoutBtn = document.getElementById('logoutBtn');
  const isLoggedIn = !!auth.user?.id;

  logoutBtn.hidden = !isLoggedIn;
  banner.textContent = `User: ${auth.user?.email || 'not logged in'} | Access: ${auth.hasAccess ? 'paid' : 'unpaid'} | Usage: ${usage.adsBlocked}/${freeLimits.ads} ads, ${usage.popupsBlocked}/${freeLimits.popups} popups this month${isBlockingPausedByLimit ? ' | Blocking paused by limit' : ''}`;
}

async function load() {
  const { state, builtinAdDomains, enabledBuiltinAdDomains } = await chrome.runtime.sendMessage({ type: 'getState' });
  document.getElementById('popupBlockingEnabled').checked = !!state.popupBlockingEnabled;
  document.getElementById('cosmeticBlockingEnabled').checked = !!state.cosmeticBlockingEnabled;
  document.getElementById('customBlockDomains').value = (state.customBlockDomains || []).join('\n');
  document.getElementById('allowlist').value = (state.allowlist || []).join('\n');
  document.getElementById('customCssSelectors').value = JSON.stringify(state.customCssSelectors || {}, null, 2);
  updateCustomSelectorPreview();

  const builtinContainer = document.getElementById('builtinDomainList');
  builtinContainer.innerHTML = '';
  const enabledSet = new Set(enabledBuiltinAdDomains || []);
  (builtinAdDomains || []).sort().forEach((domain) => {
    const row = renderDomainToggleRow(domain, enabledSet.has(domain), async (enabled) => {
      await chrome.runtime.sendMessage({ type: 'toggleBuiltinDomain', domain, enabled });
      setStatus(`Updated ${domain}.`);
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
          setStatus(`Removed ${domain} from blacklist.`);
          await load();
        }
      });
      discoveredContainer.appendChild(row);
    });
  }

  await refreshAccountSummary();
}

document.getElementById('authTabLogin').addEventListener('click', () => setAuthTab('login'));
document.getElementById('authTabSignup').addEventListener('click', () => setAuthTab('signup'));

document.getElementById('signupBtn').addEventListener('click', async () => {
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const res = await chrome.runtime.sendMessage({ type: 'signup', name, email, password });
  if (res?.ok) setAuthTab('login');
  setStatus(res?.ok ? 'Signup successful. Please login now.' : (res?.error || 'Signup failed.'));
});

document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const res = await chrome.runtime.sendMessage({ type: 'login', email, password });
  if (!res?.ok || !res?.data?.success) {
    setStatus(res?.error || 'Login failed.');
    return;
  }
  await chrome.runtime.sendMessage({ type: 'checkAccess' });
  setStatus('Login successful. Access re-synced.');
  await refreshAccountSummary();
});

document.getElementById('googleBtn').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'startSocialLogin' });
  setStatus(res?.ok ? 'Opened hosted Google login flow in a new tab.' : (res?.error || 'Unable to start social login.'));
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'logout' });
  setStatus('Logged out.');
  await refreshAccountSummary();
});

document.getElementById('loadProductBtn').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'refreshProductMetadata' });
  if (!res?.ok) {
    setStatus(res?.error || 'Failed to load metadata.');
    return;
  }
  document.getElementById('productMeta').textContent = JSON.stringify(res.product, null, 2);
  setStatus('Product metadata loaded.');
});

document.getElementById('checkAccessBtn').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'checkAccess' });
  setStatus(res?.ok ? `Access check complete. hasAccess=${!!res?.data?.hasAccess}` : (res?.error || 'Access check failed.'));
  await refreshAccountSummary();
});

document.getElementById('upgradeBtn').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'startPaypalPayment' });
  setStatus(res?.ok ? 'Opened PayPal approval page.' : (res?.error || 'Could not start PayPal payment.'));
});

document.getElementById('customCssSelectors').addEventListener('input', updateCustomSelectorPreview);

document.getElementById('saveBtn').addEventListener('click', async () => {
  let customCssSelectors = {};
  try {
    customCssSelectors = JSON.parse(document.getElementById('customCssSelectors').value || '{}');
  } catch {
    setStatus('Invalid JSON in custom CSS selectors.');
    updateCustomSelectorPreview();
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
  setStatus('Saved settings.');
  await load();
});

document.getElementById('openInspector').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.runtime.sendMessage({ type: 'openInspector', tabId: tab?.id });
});

setAuthTab('login');
load();
