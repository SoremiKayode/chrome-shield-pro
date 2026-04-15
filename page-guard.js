(() => {
  const adHostRegex = /(doubleclick|googlesyndication|googleadservices|taboola|outbrain|criteo|adnxs|rubicon|pubmatic|adsrvr|adservice|adserver|adclick|popads?|popunder|affiliate|sponsor|mgid|revcontent|adsterra|trafficstars|clickadu)/i;
  const adPathRegex = /([/?#&._-])(ad[sx]?|adclick|adserver|adservice|sponsor|affiliate|promo|banner|popunder|popup|clickid|utm_(source|campaign)=ads?)\b/i;
  const adQueryRegex = /(?:^|[?&])(ad(id|s)?|adunit|adserver|adsource|clickid|gclid|yclid|fbclid|utm_source=ad)/i;

  const guardState = {
    ready: false,
    enabled: false,
    forcePopupBlock: false,
    allowlisted: false,
    blockedDomains: []
  };

  const base = (input) => {
    try {
      const p = new URL(input, location.href).hostname.split('.').filter(Boolean);
      return p.length <= 2 ? p.join('.') : p.slice(-2).join('.');
    } catch {
      return '';
    }
  };

  const sameBase = (a, b) => {
    const one = base(a);
    const two = base(b);
    return !!one && one === two;
  };

  const normalize = (hostOrUrl) => {
    try {
      const parsed = new URL(hostOrUrl, location.href);
      const host = parsed.hostname.toLowerCase();
      return base(host) || host;
    } catch {
      const host = String(hostOrUrl || '').toLowerCase();
      return base(host) || host;
    }
  };

  const hostMatches = (hostOrUrl, entries = []) => {
    const target = normalize(hostOrUrl);
    return (entries || []).some((entry) => {
      const normalized = normalize(entry);
      return normalized && (target === normalized || target.endsWith(`.${normalized}`));
    });
  };

  const adLike = (target) => {
    try {
      const url = new URL(target, location.href);
      const host = url.hostname.toLowerCase();
      if (hostMatches(host, guardState.blockedDomains)) return true;
      return adHostRegex.test(host) || adPathRegex.test(url.href) || adQueryRegex.test(url.search);
    } catch {
      const value = String(target || '');
      return adHostRegex.test(value) || adPathRegex.test(value);
    }
  };

  const isBrowserNewTab = (target) => {
    try {
      const absolute = new URL(target, location.href).href.toLowerCase();
      return absolute === 'chrome://newtab/' || absolute === 'chrome://newtab' || absolute === 'about:newtab';
    } catch {
      const value = String(target || '').toLowerCase();
      return value === 'chrome://newtab/' || value === 'chrome://newtab' || value === 'about:newtab';
    }
  };

  const shouldBlock = (target) => {
    if (!guardState.ready || !guardState.enabled) return false;
    if (isBrowserNewTab(target)) return false;
    try {
      const absolute = new URL(target, location.href).href;
      if (sameBase(location.href, absolute)) return false;
      return guardState.forcePopupBlock ? true : adLike(absolute);
    } catch {
      return false;
    }
  };

  const report = (url) => {
    document.dispatchEvent(new CustomEvent('chrome-shield-popup-blocked', { detail: { url } }));
  };

  const nativeOpen = window.open;
  function installMonitor(popupWindow) {
    if (!popupWindow) return popupWindow;
    try {
      const originalClose = popupWindow.close.bind(popupWindow);
      const originalFocus = popupWindow.focus ? popupWindow.focus.bind(popupWindow) : null;
      const closeFor = (url) => {
        try { originalClose(); } catch {}
        report(url || 'about:blank');
        return null;
      };
      try {
        const originalAssign = popupWindow.location.assign.bind(popupWindow.location);
        popupWindow.location.assign = (url) => shouldBlock(url) ? closeFor(url) : originalAssign(url);
      } catch {}
      try {
        const originalReplace = popupWindow.location.replace.bind(popupWindow.location);
        popupWindow.location.replace = (url) => shouldBlock(url) ? closeFor(url) : originalReplace(url);
      } catch {}
      if (originalFocus) {
        popupWindow.focus = () => {
          try {
            const href = popupWindow.location.href;
            if (shouldBlock(href)) return closeFor(href);
          } catch {}
          return originalFocus();
        };
      }
      const timer = setInterval(() => {
        try {
          if (popupWindow.closed) return clearInterval(timer);
          const href = popupWindow.location.href;
          if (href && href !== 'about:blank' && shouldBlock(href)) {
            clearInterval(timer);
            closeFor(href);
          }
        } catch {
          clearInterval(timer);
        }
      }, 10);
      setTimeout(() => clearInterval(timer), 1500);
    } catch {}
    return popupWindow;
  }

  window.open = function(url, target, features) {
    if (url && shouldBlock(url)) {
      report(url);
      return null;
    }
    const opened = nativeOpen.apply(this, arguments);
    if (!url || url === 'about:blank' || url === '') {
      return installMonitor(opened);
    }
    return opened;
  };

  const loadGuardState = () => {
    const sendMessage = globalThis.chrome?.runtime?.sendMessage;
    if (typeof sendMessage !== 'function') {
      guardState.ready = true;
      guardState.enabled = false;
      return;
    }

    sendMessage({ type: 'getState' }, (response) => {
      const state = response?.state;
      const host = location.hostname.toLowerCase();
      guardState.ready = true;
      guardState.blockedDomains = [
        ...(response?.enabledBuiltinAdDomains || []),
        ...(state?.customBlockDomains || []),
        ...(state?.discoveredAdDomains || [])
      ];
      guardState.allowlisted = hostMatches(host, state?.allowlist || []);
      guardState.forcePopupBlock = hostMatches(host, state?.popupBlockSites || []);
      guardState.enabled = !!(state?.enabled && state?.popupBlockingEnabled && !response?.isBlockingPausedByLimit) && !guardState.allowlisted;
    });
  };

  loadGuardState();

  const nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() {
    if (this.target === '_blank' && this.href && shouldBlock(this.href)) {
      report(this.href);
      return;
    }
    return nativeAnchorClick.call(this);
  };

  if (window.HTMLAreaElement && HTMLAreaElement.prototype.click) {
    const nativeAreaClick = HTMLAreaElement.prototype.click;
    HTMLAreaElement.prototype.click = function() {
      if (this.target === '_blank' && this.href && shouldBlock(this.href)) {
        report(this.href);
        return;
      }
      return nativeAreaClick.call(this);
    };
  }

  const nativeSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function() {
    const action = this.action || location.href;
    if (this.target === '_blank' && shouldBlock(action)) {
      report(action);
      return;
    }
    return nativeSubmit.call(this);
  };

  document.addEventListener('click', (event) => {
    const anchor = event.target && event.target.closest ? event.target.closest('a[target="_blank"], area[target="_blank"]') : null;
    if (!anchor) return;
    const href = anchor.href;
    if (href && shouldBlock(href)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      report(href);
    }
  }, true);

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form instanceof HTMLFormElement && form.target === '_blank') {
      const action = form.action || location.href;
      if (shouldBlock(action)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        report(action);
      }
    }
  }, true);
})();
