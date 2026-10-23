'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');

// ---- splitSentences --------------------------------------------------------

test('splitSentences splits plain sentences and joins back losslessly', () => {
  const text = 'The city council met on Tuesday. They argued about the budget for hours. Nothing was decided in the end.';
  const parts = Core.splitSentences(text);
  assert.equal(parts.length, 3);
  assert.equal(parts.join(''), text);
  assert.match(parts[0], /The city council met on Tuesday\./);
});

test('splitSentences handles questions and exclamations', () => {
  const text = 'Did the plan work? Nobody expected it to! The results surprised everyone in the room.';
  const parts = Core.splitSentences(text);
  assert.equal(parts.length, 3);
  assert.equal(parts.join(''), text);
});

test('splitSentences does not split on abbreviations', () => {
  const text = 'Dr. Smith used e.g. this method in the U.S. last year. It worked well enough.';
  const parts = Core.splitSentences(text);
  assert.equal(parts.length, 2);
  assert.equal(parts.join(''), text);
});

test('splitSentences does not split decimals', () => {
  const text = 'The value rose by 3.5 points during the quarter. Traders had expected far less movement.';
  const parts = Core.splitSentences(text);
  assert.equal(parts.length, 2);
  assert.equal(parts.join(''), text);
});

test('splitSentences keeps initials together', () => {
  const text = 'J. R. R. Tolkien wrote the books over many years. They are still read today.';
  const parts = Core.splitSentences(text);
  assert.equal(parts.length, 2);
  assert.match(parts[0], /Tolkien wrote the books/);
});

test('splitSentences handles closing quotes after the full stop', () => {
  const text = 'She looked up and said "We leave at dawn." Then she closed the door behind her.';
  const parts = Core.splitSentences(text);
  assert.equal(parts.length, 2);
  assert.equal(parts.join(''), text);
});

test('splitSentences does not split a domain name', () => {
  const text = 'The docs live at example.com for everyone to read. They cover the whole API in detail.';
  const parts = Core.splitSentences(text);
  assert.equal(parts.length, 2);
  assert.equal(parts.join(''), text);
});

test('splitSentences keeps an ellipsis with a lowercase continuation together', () => {
  const text = 'He waited for a long moment... then the door finally opened wide. Two people walked out slowly.';
  const parts = Core.splitSentences(text);
  assert.equal(parts.length, 2);
  assert.equal(parts.join(''), text);
});

// ---- isExpandable ------------------------------------------------------------

test('isExpandable filters out short fragments', () => {
  assert.equal(Core.isExpandable('Yes, he did.'), false);
  assert.equal(Core.isExpandable('No way.'), false);
  assert.equal(Core.isExpandable('The committee published its final report on Friday morning.'), true);
  assert.equal(Core.isExpandable('1234 5678 9012 3456 7890'), false);
});

// ---- ExpansionState -----------------------------------------------------------

test('ExpansionState walks levels and collapses', () => {
  const st = new Core.ExpansionState('Short version here.');
  assert.equal(st.level, 0);
  assert.equal(st.expanded(), false);
  assert.equal(st.toggle(), 'fetch');

  st.applyExpansion('A longer version with more detail in it.');
  assert.equal(st.level, 1);
  assert.equal(st.text(), 'A longer version with more detail in it.');
  assert.equal(st.canMore(), true);

  st.applyMore('An even longer version with background and an example.');
  assert.equal(st.level, 2);
  assert.equal(st.canMore(), false);

  st.less();
  assert.equal(st.level, 1);
  assert.equal(st.toggle(), 'collapsed');
  assert.equal(st.level, 0);
  assert.equal(st.text(), 'Short version here.');

  // cached level 1 comes back without a fetch
  assert.equal(st.toggle(), 'shown');
  assert.equal(st.level, 1);
});

// ---- prompts and responses ----------------------------------------------------

test('buildExpandMessages includes the sentence and capped context', () => {
  const msgs = Core.buildExpandMessages('A short sentence to grow.', 'Some paragraph context.', 1);
  assert.equal(msgs.length, 2);
  assert.match(msgs[1].content, /A short sentence to grow\./);
  assert.match(msgs[1].content, /Some paragraph context\./);

  const more = Core.buildExpandMessages('A short sentence to grow.', '', 2);
  assert.match(more[1].content, /even further/);
  assert.doesNotMatch(more[1].content, /for context only/);
});

test('parseCompletion extracts and unquotes the text', () => {
  const json = { choices: [{ message: { content: '  "A fuller sentence."  ' } }] };
  assert.equal(Core.parseCompletion(json), 'A fuller sentence.');
  assert.equal(Core.parseCompletion({ choices: [] }), null);
  assert.equal(Core.parseCompletion(null), null);
  assert.equal(Core.parseCompletion({ choices: [{ message: { content: '   ' } }] }), null);
});

// ---- settings -----------------------------------------------------------------

test('normalizeSettings applies defaults and cleans the host list', () => {
  const s = Core.normalizeSettings({ disabledHosts: [' Example.com ', '', 42, 'news.site'] });
  assert.equal(s.model, Core.DEFAULT_MODEL);
  assert.equal(s.appKey, Core.DEFAULT_SETTINGS.appKey);
  assert.deepEqual(s.disabledHosts, ['example.com', 'news.site']);
  assert.equal(Core.normalizeSettings(null).apiKey, '');
});

test('resolveModel prefers the custom model id', () => {
  assert.equal(Core.resolveModel({ model: 'a/b', customModel: '' }), 'a/b');
  assert.equal(Core.resolveModel({ model: 'a/b', customModel: ' c/d ' }), 'c/d');
});

test('hostDisabled matches case-insensitively', () => {
  assert.equal(Core.hostDisabled({ disabledHosts: ['example.com'] }, 'EXAMPLE.com'), true);
  assert.equal(Core.hostDisabled({ disabledHosts: ['example.com'] }, 'other.com'), false);
});

// ---- device flow ---------------------------------------------------------------

test('deviceCodeRequestBody carries the app key as client_id', () => {
  assert.deepEqual(Core.deviceCodeRequestBody({ appKey: 'pk_test123' }), { client_id: 'pk_test123' });
});

test('interpretTokenResponse covers pending, connected and error', () => {
  assert.deepEqual(Core.interpretTokenResponse({ error: 'authorization_pending' }), { status: 'pending' });
  assert.deepEqual(
    Core.interpretTokenResponse({ access_token: 'sk_abc', token_type: 'bearer' }),
    { status: 'connected', apiKey: 'sk_abc' }
  );
  assert.equal(Core.interpretTokenResponse({ error: 'expired_token' }).status, 'error');
  assert.equal(Core.interpretTokenResponse(null).status, 'error');
});
