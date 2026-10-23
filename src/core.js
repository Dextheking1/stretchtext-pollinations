// core.js - pure logic for Stretchtext: no DOM, no chrome APIs.
// Loaded as a classic script in the extension (attaches StretchCore to the
// global) and required directly by the node tests.

(function (global) {
  'use strict';

  var MAX_LEVEL = 2;

  var DEFAULT_MODEL = 'openai/gpt-5.4-nano';

  var MODEL_CHOICES = [
    { id: 'openai/gpt-5.4-nano', label: 'GPT-5.4 Nano (cheap, default)' },
    { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6' },
    { id: 'openai/gpt-5.4', label: 'GPT-5.4 (pricier)' }
  ];

  var DEFAULT_SETTINGS = {
    apiKey: '',
    appKey: 'pk_YWA2rJwpVAxuuYD3',
    model: DEFAULT_MODEL,
    customModel: '',
    disabledHosts: []
  };

  function normalizeSettings(raw) {
    var s = {};
    var src = raw && typeof raw === 'object' ? raw : {};
    s.apiKey = typeof src.apiKey === 'string' ? src.apiKey.trim() : '';
    s.appKey = typeof src.appKey === 'string' && src.appKey.trim() ? src.appKey.trim() : DEFAULT_SETTINGS.appKey;
    s.model = typeof src.model === 'string' && src.model.trim() ? src.model.trim() : DEFAULT_MODEL;
    s.customModel = typeof src.customModel === 'string' ? src.customModel.trim() : '';
    s.disabledHosts = Array.isArray(src.disabledHosts)
      ? src.disabledHosts.filter(function (h) { return typeof h === 'string' && h.trim(); }).map(function (h) { return h.trim().toLowerCase(); })
      : [];
    return s;
  }

  function resolveModel(settings) {
    var s = normalizeSettings(settings);
    return s.customModel || s.model;
  }

  function hostDisabled(settings, host) {
    if (!host) return false;
    var s = normalizeSettings(settings);
    return s.disabledHosts.indexOf(String(host).toLowerCase()) !== -1;
  }

  // ---- sentence segmentation ---------------------------------------------

  var ABBREVIATIONS = {};
  [
    'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'prof', 'hon', 'fig', 'figs',
    'eq', 'eqs', 'e.g', 'i.e', 'etc', 'vs', 'approx', 'dept', 'inc', 'ltd',
    'co', 'no', 'nos', 'al', 'u.s', 'u.k', 'u.s.a', 'a.m', 'p.m', 'jan',
    'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov',
    'dec', 'gen', 'sen', 'rep', 'gov', 'sgt', 'capt', 'lt', 'col'
  ].forEach(function (a) { ABBREVIATIONS[a] = true; });

  var CLOSERS = '"\'\u201D\u2019)]}\u00BB';
  var OPENERS = '"\'\u201C\u2018([{';

  function isDigit(ch) { return ch >= '0' && ch <= '9'; }
  function isUpper(ch) { return ch.toUpperCase() === ch && ch.toLowerCase() !== ch; }

  function wordBefore(text, i) {
    var j = i - 1;
    var out = '';
    while (j >= 0 && /[A-Za-z.]/.test(text[j])) {
      out = text[j] + out;
      j--;
    }
    return out.replace(/\.$/, '');
  }

  // Splits text into raw sentence segments. Segments keep their trailing
  // whitespace, so segments.join('') === text for ordinary prose.
  function splitSentences(text) {
    var segments = [];
    var start = 0;
    var i = 0;
    var n = text.length;
    while (i < n) {
      var ch = text[i];
      if (ch === '.' || ch === '!' || ch === '?' || ch === '\u2026') {
        // decimal point inside a number
        if (ch === '.' && i > 0 && i + 1 < n && isDigit(text[i - 1]) && isDigit(text[i + 1])) { i++; continue; }
        // ellipsis written as dots: only the last dot can end a sentence
        if (ch === '.' && text[i + 1] === '.') { i++; continue; }
        if (ch === '.') {
          var word = wordBefore(text, i);
          if (ABBREVIATIONS[word.toLowerCase()]) { i++; continue; }
          if (/^[A-Z]$/.test(word)) { i++; continue; } // initial, e.g. "J. R. R. Tolkien"
        }
        var j = i + 1;
        while (j < n && CLOSERS.indexOf(text[j]) !== -1) j++;
        if (j < n && !/\s/.test(text[j])) { i++; continue; }
        var k = j;
        while (k < n && /\s/.test(text[k])) k++;
        if (k >= n) { segments.push(text.slice(start)); start = n; break; }
        var next = text[k];
        if (isUpper(next) || isDigit(next) || OPENERS.indexOf(next) !== -1) {
          segments.push(text.slice(start, k));
          start = k;
          i = k;
          continue;
        }
        i++;
        continue;
      }
      i++;
    }
    if (start < n) segments.push(text.slice(start));
    return segments.filter(function (s) { return s.length > 0; });
  }

  function isExpandable(sentence) {
    if (!sentence) return false;
    var trimmed = sentence.trim();
    if (trimmed.length < 20) return false;
    if (!/[A-Za-z\u00C0-\u024F]/.test(trimmed)) return false;
    var words = trimmed.split(/\s+/).filter(Boolean);
    return words.length >= 4;
  }

  // ---- expansion state -----------------------------------------------------

  function ExpansionState(original) {
    this.original = original;
    this.levels = [original];
    this.level = 0;
    this.loading = false;
  }
  ExpansionState.prototype.text = function () { return this.levels[this.level]; };
  ExpansionState.prototype.expanded = function () { return this.level > 0; };
  ExpansionState.prototype.canMore = function () { return this.level > 0 && this.level < MAX_LEVEL; };
  ExpansionState.prototype.hasLevel = function (lvl) { return typeof this.levels[lvl] === 'string'; };
  ExpansionState.prototype.applyExpansion = function (text) {
    this.levels[1] = text;
    this.level = 1;
  };
  ExpansionState.prototype.applyMore = function (text) {
    this.levels[2] = text;
    this.level = MAX_LEVEL;
  };
  ExpansionState.prototype.showLevel = function (lvl) {
    if (this.hasLevel(lvl)) this.level = lvl;
  };
  ExpansionState.prototype.less = function () {
    if (this.level > 0) this.level--;
  };
  ExpansionState.prototype.collapse = function () { this.level = 0; };
  // Plain click: expanded -> collapse; collapsed with a cached expansion ->
  // show it again without a new request; collapsed without one -> the caller
  // needs to fetch level 1 (signalled by returning 'fetch').
  ExpansionState.prototype.toggle = function () {
    if (this.level > 0) { this.collapse(); return 'collapsed'; }
    if (this.hasLevel(1)) { this.level = 1; return 'shown'; }
    return 'fetch';
  };

  // ---- prompts and responses ----------------------------------------------

  function buildExpandMessages(sentence, context, targetLevel) {
    var ctx = (context || '').trim();
    if (ctx.length > 1200) ctx = ctx.slice(0, 1200);
    var instruction = targetLevel >= 2
      ? 'Expand the sentence below even further. Add background, nuance, or a concrete example. Keep the same meaning and tone. Make it roughly twice as long as the version given. Return only the expanded sentence: no quotes, no preamble, no commentary.'
      : 'Expand the sentence below so it explains itself more fully. Add the missing detail, the reason behind it, or a brief example. Keep the same meaning and a similar tone. Make it about two to three times longer. Return only the expanded sentence: no quotes, no preamble, no commentary.';
    var user = instruction + '\n\nSentence:\n' + sentence;
    if (ctx) user += '\n\nThe sentence comes from this paragraph, for context only:\n' + ctx;
    return [
      { role: 'system', content: 'You rewrite single sentences from articles as clearer, fuller stretchtext. You return only the rewritten sentence.' },
      { role: 'user', content: user }
    ];
  }

  function parseCompletion(json) {
    try {
      var content = json.choices[0].message.content;
      if (typeof content !== 'string') return null;
      var text = content.trim();
      if (text.length >= 2) {
        var first = text[0];
        var last = text[text.length - 1];
        if ((first === '"' && last === '"') || (first === '\u201C' && last === '\u201D')) {
          text = text.slice(1, -1).trim();
        }
      }
      return text || null;
    } catch (e) {
      return null;
    }
  }

  // ---- device flow (Bring Your Own Pollen) ---------------------------------

  function deviceCodeRequestBody(settings) {
    var s = normalizeSettings(settings);
    return { client_id: s.appKey };
  }

  function interpretTokenResponse(json) {
    if (!json || typeof json !== 'object') return { status: 'error', error: 'bad-response' };
    if (typeof json.access_token === 'string' && json.access_token) {
      return { status: 'connected', apiKey: json.access_token };
    }
    if (json.error === 'authorization_pending') return { status: 'pending' };
    if (json.error) return { status: 'error', error: String(json.error) };
    return { status: 'error', error: 'bad-response' };
  }

  var api = {
    MAX_LEVEL: MAX_LEVEL,
    DEFAULT_MODEL: DEFAULT_MODEL,
    MODEL_CHOICES: MODEL_CHOICES,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    normalizeSettings: normalizeSettings,
    resolveModel: resolveModel,
    hostDisabled: hostDisabled,
    splitSentences: splitSentences,
    isExpandable: isExpandable,
    ExpansionState: ExpansionState,
    buildExpandMessages: buildExpandMessages,
    parseCompletion: parseCompletion,
    deviceCodeRequestBody: deviceCodeRequestBody,
    interpretTokenResponse: interpretTokenResponse
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.StretchCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
