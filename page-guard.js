(() => {
  const adHostRegex = /(doubleclick|googlesyndication|googleadservices|taboola|outbrain|criteo|adnxs|rubicon|pubmatic|adsrvr|promo|banner|pop(ad|up)?|trk|track|sponsor)/i;

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

  const adLike = (target) => {
    try {
      const url = new URL(target, location.href);
      return adHostRegex.test(url.hostname) || /(ad|popup|banner|promo|sponsor)/i.test(url.href);
    } catch {
      return /(ad|popup|banner|promo|sponsor)/i.test(String(target || ''));
    }
  };

  const shouldBlock = (target) => {
    try {
      const absolute = new URL(target, location.href).href;
      if (sameBase(location.href, absolute)) return false;
      return adLike(absolute);
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
      }, 25);
      setTimeout(() => clearInterval(timer), 4000);
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
