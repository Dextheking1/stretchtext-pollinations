// options.js - connection (device flow + pasted key), model, disabled sites.

(function () {
  'use strict';

  var connState = document.getElementById('connState');
  var connectBtn = document.getElementById('connectBtn');
  var disconnectBtn = document.getElementById('disconnectBtn');
  var deviceBox = document.getElementById('deviceBox');
  var deviceLink = document.getElementById('deviceLink');
  var deviceCode = document.getElementById('deviceCode');
  var deviceStatus = document.getElementById('deviceStatus');
  var keyInput = document.getElementById('keyInput');
  var saveKeyBtn = document.getElementById('saveKeyBtn');
  var modelSelect = document.getElementById('modelSelect');
  var customModel = document.getElementById('customModel');
  var saveModelBtn = document.getElementById('saveModelBtn');
  var modelSaved = document.getElementById('modelSaved');
  var hostList = document.getElementById('hostList');
  var hostInput = document.getElementById('hostInput');
  var addHostBtn = document.getElementById('addHostBtn');

  var MODEL_CHOICES = [
    { id: 'openai/gpt-5.4-nano', label: 'GPT-5.4 Nano (cheap, default)' },
    { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6' },
    { id: 'openai/gpt-5.4', label: 'GPT-5.4 (pricier)' }
  ];
  var DEFAULT_MODEL = 'openai/gpt-5.4-nano';

  var pollTimer = null;

  function loadRaw() {
    return chrome.storage.local.get('stxSettings').then(function (out) {
      return out.stxSettings || {};
    });
  }

  function saveRaw(patch) {
    return loadRaw().then(function (s) {
      Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
      return chrome.storage.local.set({ stxSettings: s }).then(function () { return s; });
    });
  }

  function renderHosts(settings) {
    hostList.textContent = '';
    (settings.disabledHosts || []).forEach(function (host) {
      var li = document.createElement('li');
      var span = document.createElement('span');
      span.textContent = host;
      var btn = document.createElement('button');
      btn.className = 'secondary';
      btn.textContent = 'remove';
      btn.addEventListener('click', function () {
        saveRaw({
          disabledHosts: (settings.disabledHosts || []).filter(function (h) { return h !== host; })
        }).then(refresh);
      });
      li.appendChild(span);
      li.appendChild(btn);
      hostList.appendChild(li);
    });
  }

  function refresh() {
    return loadRaw().then(function (settings) {
      connState.textContent = settings.apiKey ? 'connected' : 'not connected';
      disconnectBtn.disabled = !settings.apiKey;
      connectBtn.disabled = !!settings.apiKey;
      if (!settings.apiKey) keyInput.value = '';
      if (!modelSelect.options.length) {
        MODEL_CHOICES.forEach(function (m) {
          var opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.label;
          modelSelect.appendChild(opt);
        });
      }
      modelSelect.value = settings.model || DEFAULT_MODEL;
      customModel.value = settings.customModel || '';
      renderHosts(settings);
    });
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function startPolling(intervalSec) {
    stopPolling();
    pollTimer = setInterval(function () {
      chrome.runtime.sendMessage({ type: 'stx-device-poll' }).then(function (resp) {
        if (!resp) return;
        if (resp.status === 'connected') {
          stopPolling();
          deviceBox.hidden = true;
          refresh();
        } else if (resp.status === 'error') {
          stopPolling();
          deviceStatus.textContent = resp.error === 'expired'
            ? 'That code expired. Click Connect to get a fresh one.'
            : 'Sign-in failed (' + resp.error + '). Click Connect to try again.';
        }
      });
    }, Math.max(3, intervalSec || 5) * 1000);
  }

  connectBtn.addEventListener('click', function () {
    connectBtn.disabled = true;
    deviceStatus.textContent = 'Waiting for approval...';
    chrome.runtime.sendMessage({ type: 'stx-device-start' }).then(function (resp) {
      connectBtn.disabled = false;
      if (!resp || resp.error) {
        deviceBox.hidden = false;
        deviceStatus.textContent = 'Could not start sign-in. Check your connection and try again.';
        return;
      }
      deviceCode.textContent = resp.user_code || '';
      deviceLink.href = resp.verification_uri_complete || 'https://enter.pollinations.ai/device';
      deviceBox.hidden = false;
      window.open(deviceLink.href, '_blank');
      startPolling(resp.interval);
    });
  });

  disconnectBtn.addEventListener('click', function () {
    stopPolling();
    deviceBox.hidden = true;
    saveRaw({ apiKey: '' }).then(refresh);
  });

  saveKeyBtn.addEventListener('click', function () {
    var key = keyInput.value.trim();
    if (!key) return;
    saveRaw({ apiKey: key }).then(function () {
      keyInput.value = '';
      return refresh();
    });
  });

  saveModelBtn.addEventListener('click', function () {
    saveRaw({ model: modelSelect.value, customModel: customModel.value.trim() }).then(function () {
      modelSaved.textContent = 'saved';
      setTimeout(function () { modelSaved.textContent = ''; }, 2000);
      return refresh();
    });
  });

  addHostBtn.addEventListener('click', function () {
    var host = hostInput.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!host) return;
    loadRaw().then(function (settings) {
      var hosts = settings.disabledHosts || [];
      if (hosts.indexOf(host) === -1) hosts.push(host);
      return saveRaw({ disabledHosts: hosts });
    }).then(function () {
      hostInput.value = '';
      return refresh();
    });
  });

  // Resume polling if a sign-in was left pending.
  chrome.storage.local.get('stxDevice').then(function (out) {
    if (out.stxDevice && Date.now() < out.stxDevice.expiresAt) {
      deviceCode.textContent = out.stxDevice.user_code || '';
      deviceLink.href = out.stxDevice.verification_uri_complete || 'https://enter.pollinations.ai/device';
      deviceBox.hidden = false;
      startPolling(out.stxDevice.interval);
    }
  });

  refresh();
})();
