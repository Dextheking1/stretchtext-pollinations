// background.js - Stretchtext service worker.
// Owns all network calls (generation + device flow) so the user's key never
// runs inside page context, and injects the content script on demand
// (activeTab + scripting, no blanket content-script permission).

importScripts('core.js');

var Core = self.StretchCore;
var GEN_BASE = 'https://gen.pollinations.ai';
var ENTER_BASE = 'https://enter.pollinations.ai';

// ---- settings ---------------------------------------------------------------

function getSettings() {
  return chrome.storage.local.get('stxSettings').then(function (out) {
    return Core.normalizeSettings(out.stxSettings);
  });
}

function saveSettings(settings) {
  return chrome.storage.local.set({ stxSettings: Core.normalizeSettings(settings) });
}

// ---- generation ---------------------------------------------------------------

function expandText(payload) {
  return getSettings().then(function (settings) {
    if (!settings.apiKey) {
      chrome.runtime.openOptionsPage();
      return { error: 'no-key' };
    }
    return fetch(GEN_BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + settings.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: Core.resolveModel(settings),
        messages: Core.buildExpandMessages(payload.sentence, payload.context, payload.level),
        temperature: 0.6
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          return { error: 'api', status: res.status, detail: String(t).slice(0, 200) };
        });
      }
      return res.json().then(function (json) {
        var text = Core.parseCompletion(json);
        return text ? { text: text } : { error: 'empty' };
      });
    }).catch(function (e) {
      return { error: 'network', detail: String(e && e.message || e) };
    });
  });
}

// ---- device flow (Bring Your Own Pollen) --------------------------------------

function deviceStart() {
  return getSettings().then(function (settings) {
    return fetch(ENTER_BASE + '/api/device/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Core.deviceCodeRequestBody(settings))
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok || !json.device_code) {
          return { error: 'device-code', detail: JSON.stringify(json).slice(0, 200) };
        }
        var pending = {
          device_code: json.device_code,
          user_code: json.user_code,
          verification_uri_complete: json.verification_uri_complete,
          interval: json.interval || 5,
          expiresAt: Date.now() + (json.expires_in || 1800) * 1000
        };
        return chrome.storage.local.set({ stxDevice: pending }).then(function () {
          return {
            user_code: pending.user_code,
            verification_uri_complete: pending.verification_uri_complete,
            interval: pending.interval
          };
        });
      });
    }).catch(function (e) {
      return { error: 'network', detail: String(e && e.message || e) };
    });
  });
}

function devicePoll() {
  return chrome.storage.local.get('stxDevice').then(function (out) {
    var pending = out.stxDevice;
    if (!pending) return { status: 'error', error: 'no-pending' };
    if (Date.now() > pending.expiresAt) {
      return chrome.storage.local.remove('stxDevice').then(function () {
        return { status: 'error', error: 'expired' };
      });
    }
    return fetch(ENTER_BASE + '/api/device/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: pending.device_code })
    }).then(function (res) {
      return res.json().catch(function () { return {}; });
    }).then(function (json) {
      var out2 = Core.interpretTokenResponse(json);
      if (out2.status === 'connected') {
        return getSettings().then(function (settings) {
          settings.apiKey = out2.apiKey;
          return saveSettings(settings)
            .then(function () { return chrome.storage.local.remove('stxDevice'); })
            .then(function () { return { status: 'connected' }; });
        });
      }
      return out2;
    }).catch(function (e) {
      return { status: 'error', error: 'network', detail: String(e && e.message || e) };
    });
  });
}

// ---- injection and toggling ----------------------------------------------------

function tabHost(tab) {
  try { return new URL(tab.url).hostname; } catch (e) { return ''; }
}

function isActiveOnTab(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function () { return !!(window.__stx && window.__stx.active); }
  }).then(function (res) {
    return !!(res && res[0] && res[0].result);
  }).catch(function () { return false; });
}

function setBadge(tabId, on) {
  chrome.action.setBadgeText({ tabId: tabId, text: on ? 'on' : '' }).catch(function () {});
  if (on) chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: '#5b4bd6' }).catch(function () {});
}

function injectAndActivate(tab) {
  return chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['src/content.css'] })
    .then(function () {
      return chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/core.js', 'src/content.js'] });
    })
    .then(function () {
      return chrome.tabs.sendMessage(tab.id, { type: 'stx-activate' });
    })
    .then(function (resp) {
      if (resp && resp.ok) setBadge(tab.id, true);
      return resp || { ok: false, error: 'no-response' };
    });
}

function toggleOnTab(tab) {
  if (!tab || !tab.id || !/^https?:|^file:/.test(tab.url || '')) {
    return Promise.resolve({ ok: false, error: 'unsupported-page' });
  }
  return getSettings().then(function (settings) {
    if (Core.hostDisabled(settings, tabHost(tab))) {
      return { ok: false, error: 'site-disabled' };
    }
    return isActiveOnTab(tab.id).then(function (active) {
      if (active) {
        return chrome.tabs.sendMessage(tab.id, { type: 'stx-deactivate' })
          .then(function () { setBadge(tab.id, false); return { ok: true, active: false }; })
          .catch(function () { return { ok: false, error: 'deactivate-failed' }; });
      }
      return injectAndActivate(tab).then(function (resp) {
        return resp && resp.ok ? { ok: true, active: true } : (resp || { ok: false });
      });
    });
  }).catch(function (e) {
    return { ok: false, error: String(e && e.message || e) };
  });
}

function activeTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
    return tabs && tabs[0];
  });
}

// ---- wiring ---------------------------------------------------------------------

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;
  if (msg.type === 'stx-expand') {
    expandText(msg).then(sendResponse);
    return true;
  }
  if (msg.type === 'stx-device-start') {
    deviceStart().then(sendResponse);
    return true;
  }
  if (msg.type === 'stx-device-poll') {
    devicePoll().then(sendResponse);
    return true;
  }
  if (msg.type === 'stx-toggle-tab') {
    var tabPromise = msg.tabId
      ? chrome.tabs.get(msg.tabId).catch(function () { return null; })
      : activeTab();
    tabPromise.then(function (tab) {
      return toggleOnTab(tab);
    }).then(sendResponse);
    return true;
  }
  if (msg.type === 'stx-state-tab') {
    var p = msg.tabId
      ? chrome.tabs.get(msg.tabId).catch(function () { return null; })
      : activeTab();
    p.then(function (tab) {
      if (!tab) return { ok: false };
      return isActiveOnTab(tab.id).then(function (active) {
        return { ok: true, active: active, host: tabHost(tab), url: tab.url };
      });
    }).then(sendResponse);
    return true;
  }
  if (msg.type === 'stx-open-options') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  }
});

chrome.commands.onCommand.addListener(function (command) {
  if (command !== 'toggle-stretch') return;
  activeTab().then(function (tab) { return toggleOnTab(tab); });
});

// Demo mode for the manual test fixture: auto-activate on localhost pages
// that ask for it. Used for screenshots and manual testing only.
chrome.tabs.onUpdated.addListener(function (tabId, info, tab) {
  if (info.status !== 'complete' || !tab.url) return;
  if (!/[?&]stretchtext-demo=1/.test(tab.url)) return;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(tab.url)) return;
  toggleOnTab(tab);
});
