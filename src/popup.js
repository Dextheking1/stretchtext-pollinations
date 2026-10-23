// popup.js - per-tab state, connect state, per-site disable.

(function () {
  'use strict';

  var connState = document.getElementById('connState');
  var toggleBtn = document.getElementById('toggleBtn');
  var toggleNote = document.getElementById('toggleNote');
  var siteOff = document.getElementById('siteOff');
  var siteHost = document.getElementById('siteHost');
  var optionsBtn = document.getElementById('optionsBtn');

  var currentTab = null;
  var currentHost = '';

  // The popup only needs raw settings fields, so it reads storage directly;
  // normalization happens in core.js wherever settings are consumed.
  function loadRaw() {
    return chrome.storage.local.get('stxSettings').then(function (out) {
      return out.stxSettings || {};
    });
  }

  function saveRaw(s) {
    return chrome.storage.local.set({ stxSettings: s });
  }

  function refresh() {
    return Promise.all([
      loadRaw(),
      chrome.runtime.sendMessage({ type: 'stx-state-tab', tabId: currentTab && currentTab.id })
    ]).then(function (results) {
      var settings = results[0];
      var state = results[1] || {};
      connState.textContent = settings.apiKey ? 'connected' : 'not connected';
      var disabled = (settings.disabledHosts || []).indexOf(currentHost) !== -1;
      siteOff.checked = disabled;
      siteHost.textContent = currentHost || 'this site';
      toggleBtn.disabled = !currentTab || disabled;
      toggleBtn.textContent = state.active ? 'Disable on this page' : 'Enable on this page';
      toggleNote.textContent = disabled
        ? 'This site is disabled in the list below and in Options.'
        : (!settings.apiKey ? 'Tip: connect Pollinations in Options before stretching, or expanding will open Options for you.' : '');
    });
  }

  toggleBtn.addEventListener('click', function () {
    toggleBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'stx-toggle-tab', tabId: currentTab.id }).then(function (resp) {
      if (resp && resp.error === 'site-disabled') {
        toggleNote.textContent = 'This site is disabled. Untick the box below to use Stretchtext here.';
      } else if (resp && !resp.ok) {
        toggleNote.textContent = 'Could not run on this page (browser pages and the web store are off limits).';
      }
      return refresh();
    });
  });

  siteOff.addEventListener('change', function () {
    loadRaw().then(function (settings) {
      var hosts = (settings.disabledHosts || []).filter(function (h) { return h !== currentHost; });
      if (siteOff.checked && currentHost) hosts.push(currentHost);
      settings.disabledHosts = hosts;
      return saveRaw(settings);
    }).then(refresh);
  });

  optionsBtn.addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
  });

  chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
    currentTab = tabs && tabs[0];
    try { currentHost = new URL(currentTab.url).hostname; } catch (e) { currentHost = ''; }
    return refresh();
  });
})();
