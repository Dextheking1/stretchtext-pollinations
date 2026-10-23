// content.js - Stretchtext page logic. Injected on demand by background.js.
// Finds article paragraphs, wraps expandable sentences in clickable spans,
// and grows them in place using the reader's own Pollinations key
// (all API calls go through the background worker).

(function () {
  'use strict';

  if (window.__stx) return; // already injected on this page

  var Core = window.StretchCore;
  var originals = new Map();   // paragraph element -> original innerHTML
  var segData = new WeakMap(); // span element -> { state, context }
  var active = false;
  var clickBound = false;

  function getSettings() {
    return chrome.storage.local.get('stxSettings').then(function (out) {
      return Core.normalizeSettings(out.stxSettings);
    });
  }

  function host() {
    return location.hostname || '';
  }

  // ---- paragraph discovery ---------------------------------------------------

  function findParagraphs() {
    var root = document.querySelector('article')
      || document.querySelector('main')
      || document.querySelector('[role="main"]')
      || document.body;
    if (!root) return [];
    var ps = Array.prototype.slice.call(root.querySelectorAll('p'));
    return ps.filter(function (p) {
      if (p.dataset.stxDone) return false;
      if (p.closest('nav, header, footer, aside, form, [contenteditable="true"]')) return false;
      var text = (p.textContent || '').trim();
      return text.length >= 120;
    }).slice(0, 80);
  }

  function processParagraph(p) {
    var context = (p.textContent || '').trim();
    originals.set(p, p.innerHTML);
    var walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var parent = node.parentElement;
        if (!parent || parent.closest('a, button, code, pre, script, style, textarea')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach(function (node) {
      var segments = Core.splitSentences(node.nodeValue);
      if (!segments.some(function (s) { return Core.isExpandable(s); })) return;
      var frag = document.createDocumentFragment();
      segments.forEach(function (seg) {
        if (Core.isExpandable(seg)) {
          var span = document.createElement('span');
          span.className = 'stx-seg';
          span.title = 'Click to stretch this sentence';
          span.textContent = seg;
          segData.set(span, { state: new Core.ExpansionState(seg), context: context });
          frag.appendChild(span);
        } else {
          frag.appendChild(document.createTextNode(seg));
        }
      });
      node.replaceWith(frag);
    });
    p.dataset.stxDone = '1';
  }

  // ---- rendering ---------------------------------------------------------------

  function render(span) {
    var data = segData.get(span);
    if (!data) return;
    var st = data.state;
    span.textContent = '';
    span.appendChild(document.createTextNode(st.text()));
    span.classList.toggle('stx-expanded', st.expanded());
    if (st.expanded()) {
      var ctl = document.createElement('span');
      ctl.className = 'stx-ctls';
      ctl.setAttribute('contenteditable', 'false');
      if (st.canMore()) {
        var more = document.createElement('button');
        more.type = 'button';
        more.className = 'stx-btn stx-more';
        more.textContent = 'more';
        more.title = 'Stretch further';
        ctl.appendChild(more);
      }
      var less = document.createElement('button');
      less.type = 'button';
      less.className = 'stx-btn stx-less';
      less.textContent = 'less';
      less.title = st.level > 1 ? 'Back one level' : 'Collapse to the original sentence';
      ctl.appendChild(less);
      span.appendChild(ctl);
    }
  }

  function flashError(span, message) {
    span.classList.add('stx-error');
    var oldTitle = span.title;
    span.title = message;
    setTimeout(function () {
      span.classList.remove('stx-error');
      span.title = oldTitle;
    }, 3000);
  }

  // ---- expansion -----------------------------------------------------------------

  function requestExpansion(span, targetLevel) {
    var data = segData.get(span);
    if (!data || data.state.loading) return Promise.resolve();
    var st = data.state;
    st.loading = true;
    span.classList.add('stx-loading');
    return chrome.runtime.sendMessage({
      type: 'stx-expand',
      sentence: st.text(),
      context: data.context,
      level: targetLevel
    }).then(function (resp) {
      st.loading = false;
      span.classList.remove('stx-loading');
      if (!resp || resp.error) {
        if (resp && resp.error === 'no-key') {
          flashError(span, 'Connect Pollinations first (the extension options page should be open now).');
        } else if (resp && resp.error === 'api' && resp.status === 402) {
          flashError(span, 'Not enough Pollen on the connected account for this request.');
        } else {
          flashError(span, 'Stretch failed. Check the connection and try again.');
        }
        return;
      }
      if (targetLevel >= 2) st.applyMore(resp.text);
      else st.applyExpansion(resp.text);
      render(span);
    }).catch(function () {
      st.loading = false;
      span.classList.remove('stx-loading');
      flashError(span, 'Stretch failed. Check the connection and try again.');
    });
  }

  function onSegClick(span) {
    var data = segData.get(span);
    if (!data || data.state.loading) return;
    var action = data.state.toggle();
    if (action === 'fetch') requestExpansion(span, 1);
    else render(span);
  }

  function onControlClick(btn) {
    var span = btn.closest('.stx-seg');
    if (!span) return;
    var data = segData.get(span);
    if (!data || data.state.loading) return;
    var st = data.state;
    if (btn.classList.contains('stx-more')) {
      if (st.hasLevel(2)) { st.showLevel(2); render(span); }
      else requestExpansion(span, 2);
    } else if (btn.classList.contains('stx-less')) {
      st.less();
      render(span);
    }
  }

  function onClick(e) {
    if (!active) return;
    var btn = e.target && e.target.closest ? e.target.closest('.stx-btn') : null;
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      onControlClick(btn);
      return;
    }
    var seg = e.target && e.target.closest ? e.target.closest('.stx-seg') : null;
    if (seg) onSegClick(seg);
  }

  // ---- activate / deactivate -------------------------------------------------------

  function activate() {
    if (active) return Promise.resolve({ ok: true, active: true });
    return getSettings().then(function (settings) {
      if (Core.hostDisabled(settings, host())) {
        return { ok: false, error: 'site-disabled' };
      }
      var paragraphs = findParagraphs();
      paragraphs.forEach(processParagraph);
      active = true;
      if (!clickBound) {
        document.addEventListener('click', onClick, true);
        clickBound = true;
      }
      document.documentElement.classList.add('stx-on');
      return { ok: true, active: true, paragraphs: paragraphs.length };
    }).catch(function (e) {
      return { ok: false, error: String(e && e.message || e) };
    });
  }

  function deactivate() {
    originals.forEach(function (html, p) {
      if (p.isConnected) {
        p.innerHTML = html;
        delete p.dataset.stxDone;
      }
    });
    originals.clear();
    active = false;
    document.documentElement.classList.remove('stx-on');
    return { ok: true, active: false };
  }

  window.__stx = {
    get active() { return active; },
    activate: activate,
    deactivate: deactivate
  };

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.type === 'stx-activate') {
      activate().then(sendResponse);
      return true;
    }
    if (msg.type === 'stx-deactivate') {
      sendResponse(deactivate());
    }
  });

  // Fixture/demo pages on localhost can self-activate.
  try {
    var params = new URLSearchParams(location.search);
    if (params.get('stretchtext-demo') === '1' &&
        (location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      activate();
    }
  } catch (e) { /* plain page without demo mode */ }
})();
