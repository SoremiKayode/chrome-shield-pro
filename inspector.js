function shortenUrl(url, limit = 90) {
  const text = String(url || '');
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

(async () => {
  const response = await chrome.runtime.sendMessage({ type: 'getState' });
  const recent = document.getElementById('inspectorRecent');
  const rules = document.getElementById('inspectorRules');
  const recentEntries = (response.recentItems || []).slice(0, 25);
  if (!recentEntries.length) {
    recent.innerHTML = '<div class="empty">No recent blocked items on this tab yet.</div>';
  } else {
    recentEntries.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'item-row';
      item.innerHTML = `<div class="stack min0"><strong>${entry.host || 'Blocked item'}</strong><div class="hint" title="${entry.url || ''}">${shortenUrl(entry.url || '')}</div></div><span class="type-chip">${entry.type || 'request'}</span>`;
      recent.appendChild(item);
    });
  }

  const ruleEntries = Object.entries(response.ruleCounts || {}).sort((a, b) => b[1] - a[1]).slice(0, 25);
  if (!ruleEntries.length) {
    rules.innerHTML = '<div class="empty">No rule hits on this tab yet.</div>';
  } else {
    ruleEntries.forEach(([rule, count]) => {
      const item = document.createElement('div');
      item.className = 'rule-card';
      item.innerHTML = `<div class="stack min0"><div class="rule-text">${rule}</div><div class="subtle">matched blocking rule</div></div><div class="count-pill">${count}</div>`;
      rules.appendChild(item);
    });
  }
})();
