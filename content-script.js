(() => {
  const styleId = 'chrome-shield-pro-style';
  let pickerEnabled = false;

  function injectCss(selectors) {
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      (document.head || document.documentElement).appendChild(style);
    }
    const cleaned = [...new Set(selectors.filter(Boolean))];
    style.textContent = cleaned.length ? `${cleaned.join(',\n')} { display:none !important; visibility:hidden !important; }` : '';
  }

  function removeCommonOverlays() {
    const selectors = [
      '[class*="cookie"][class*="banner"]','[class*="newsletter"]','[class*="subscribe-popup"]',
      '[class*="overlay"]','[class*="modal"]','[class*="sticky-ad"]','[id*="ad-"]'
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => {
        if (el instanceof HTMLElement) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 220 && rect.height > 80) el.style.setProperty('display', 'none', 'important');
        }
      });
    }
  }

  function ellipsisLoggerHints() {
    const hints = document.querySelectorAll('.item-row .hint');
    hints.forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      el.style.maxWidth = '100%';
      el.style.overflow = 'hidden';
      el.style.textOverflow = 'ellipsis';
      el.style.whiteSpace = 'nowrap';
      const left = el.closest('.item-row > div');
      if (left instanceof HTMLElement) {
        left.style.minWidth = '0';
        left.style.flex = '1 1 auto';
      }
      const parent = el.closest('.item-row');
      if (parent instanceof HTMLElement) {
        parent.style.alignItems = 'center';
        parent.style.gap = '10px';
      }
    });
  }

  document.addEventListener('chrome-shield-popup-blocked', (ev) => {
    chrome.runtime.sendMessage({ type: 'popupBlocked', url: ev.detail?.url || '' });
  });

  function baseDomain(host) {
    const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
    return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
  }

  function matchesHostList(host, entries = []) {
    const target = baseDomain(host) || String(host || '').toLowerCase();
    return (entries || []).some((entry) => {
      const normalized = baseDomain(entry) || String(entry || '').toLowerCase();
      return normalized && (target === normalized || target.endsWith('.' + normalized));
    });
  }

  chrome.runtime.sendMessage({ type: 'getState' }, (response) => {
    const state = response?.state;
    if (!state?.enabled || !state.cosmeticBlockingEnabled || response?.isBlockingPausedByLimit) return;
    const host = location.hostname.toLowerCase();
    if (matchesHostList(host, state.allowlist || [])) return;
    const custom = state.customCssSelectors?.[host] || [];
    injectCss([...(response.builtinCosmetic || []), ...custom]);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { removeCommonOverlays(); ellipsisLoggerHints(); }, { once: true });
    } else {
      removeCommonOverlays();
      ellipsisLoggerHints();
    }
    new MutationObserver(() => { removeCommonOverlays(); ellipsisLoggerHints(); }).observe(document.documentElement, { childList: true, subtree: true });
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'startPicker') {
      if (pickerEnabled) return;
      pickerEnabled = true;
      let last;
      const over = (e) => {
        if (last) last.style.outline = '';
        last = e.target;
        if (last instanceof HTMLElement) last.style.outline = '2px solid #6c5ce7';
      };
      const click = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const el = e.target;
        if (!(el instanceof HTMLElement)) return;
        const selector = el.id ? `#${CSS.escape(el.id)}` : `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].slice(0,3).map(CSS.escape).join('.') : ''}`;
        chrome.runtime.sendMessage({ type: 'elementPicked', host: location.hostname.toLowerCase(), selector });
        el.style.display = 'none';
        cleanup();
      };
      const cleanup = () => {
        pickerEnabled = false;
        document.removeEventListener('mouseover', over, true);
        document.removeEventListener('click', click, true);
        if (last) last.style.outline = '';
      };
      document.addEventListener('mouseover', over, true);
      document.addEventListener('click', click, true);
      sendResponse({ ok: true });
      return true;
    }
  });
})();
