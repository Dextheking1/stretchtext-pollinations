'use strict';

// Area classification for the expansion router: growing one sentence must
// never pull other sentences, replacements, or unrelated text into the area
// it may rewrite. These tests pin the tag boundaries the router relies on.

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');

test('area: a stretch stays inside its own sentence tag', () => {
  const parts = Core.splitSentences('One tag grows here. A second tag sits beside it. A third tag closes the row.');
  assert.equal(parts.length, 3);
  assert.match(parts[0], /One tag grows here\./);
  assert.match(parts[1], /A second tag sits beside it\./);
  assert.doesNotMatch(parts[0], /second tag/);
});

test('area: generated replacement text is confined to the clicked span', () => {
  const st = new Core.ExpansionState('Original wording stays the anchor.');
  st.applyExpansion('Generated wording with added detail and a reason.');
  assert.equal(st.levels.length, 2);
  assert.equal(st.levels[0], 'Original wording stays the anchor.');
  st.collapse();
  assert.equal(st.text(), 'Original wording stays the anchor.');
});

test('prompt area: context is capped so a stretch request stays local', () => {
  const longContext = 'x'.repeat(5000);
  const msgs = Core.buildExpandMessages('A short sentence to grow.', longContext, 1);
  assert.ok(msgs[1].content.length < 2200, 'context slice keeps the request area small');
  assert.match(msgs[1].content, /A short sentence to grow\./);
});
