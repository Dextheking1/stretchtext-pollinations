'use strict';

// DOM-level test of the content script in jsdom, with a minimal chrome stub.
// Verifies: activation marks expandable sentences, a click expands through
// the (stubbed) background, "more"/"less" walk the levels, and deactivate
// restores the original paragraph HTML byte for byte.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const coreSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core.js'), 'utf8');
const contentSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');

const ARTICLE = `
<article>
  <h1>Test</h1>
  <p>The harbour at low tide is a different place from the harbour everyone photographs. The water pulls back and leaves the boats resting on dark mud, tilted at odd angles. Gulls pick through the exposed flats for crabs and shellfish in the morning light.</p>
  <p>Short one.</p>
</article>`;

function makePage() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body>' + ARTICLE + '</body></html>', {
    url: 'http://localhost:8931/test/fixture.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;

  const expandCalls = [];
  window.chrome = {
    storage: {
      local: {
        get: () => Promise.resolve({ stxSettings: { apiKey: 'sk_test', disabledHosts: [] } }),
        set: () => Promise.resolve(),
        remove: () => Promise.resolve()
      }
    },
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: (msg) => {
        if (msg.type === 'stx-expand') {
          expandCalls.push(msg);
          return Promise.resolve({ text: 'EXPANDED[' + msg.level + ']: ' + msg.sentence });
        }
        return Promise.resolve({});
      }
    }
  };

  window.eval(coreSrc);
  window.eval(contentSrc);
  return { dom, window, expandCalls };
}

const tick = () => new Promise((r) => setTimeout(r, 25));

test('activation marks sentences, click expands, controls walk levels, deactivate restores', async () => {
  const { window, expandCalls } = makePage();
  const { document } = window;

  assert.ok(window.__stx, 'content script registered __stx');
  const firstP = document.querySelectorAll('p')[0];
  const originalHTML = firstP.innerHTML;

  const res = await window.__stx.activate();
  assert.equal(res.ok, true);
  assert.equal(res.paragraphs, 1, 'only the long paragraph qualifies');

  const segs = document.querySelectorAll('.stx-seg');
  assert.equal(segs.length, 3, 'three sentences are expandable');

  // click the first sentence -> level 1 through the stubbed background
  segs[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick();
  assert.equal(expandCalls.length, 1);
  assert.equal(expandCalls[0].level, 1);
  assert.match(segs[0].textContent, /EXPANDED\[1\]/);
  assert.ok(segs[0].classList.contains('stx-expanded'));
  assert.ok(segs[0].querySelector('.stx-more'), 'more control offered');
  assert.ok(segs[0].querySelector('.stx-less'), 'less control offered');

  // "more" -> level 2
  segs[0].querySelector('.stx-more').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick();
  assert.equal(expandCalls.length, 2);
  assert.equal(expandCalls[1].level, 2);
  assert.match(segs[0].textContent, /EXPANDED\[2\]/);
  assert.equal(segs[0].querySelector('.stx-more'), null, 'no more beyond level 2');

  // "less" -> back to level 1 without a new request
  segs[0].querySelector('.stx-less').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick();
  assert.equal(expandCalls.length, 2);
  assert.match(segs[0].textContent, /EXPANDED\[1\]/);

  // click the expanded sentence -> collapse to the original words
  segs[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick();
  assert.match(segs[0].textContent, /The harbour at low tide is a different place/);
  assert.ok(!segs[0].classList.contains('stx-expanded'));

  // click again -> cached level 1 returns with no new request
  segs[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick();
  assert.equal(expandCalls.length, 2, 'cached expansion reused');
  assert.match(segs[0].textContent, /EXPANDED\[1\]/);

  // deactivate restores the exact original markup
  const off = window.__stx.deactivate();
  assert.equal(off.ok, true);
  assert.equal(document.querySelectorAll('.stx-seg').length, 0);
  assert.equal(firstP.innerHTML, originalHTML);
});

test('host on the disabled list refuses activation', async () => {
  const { window } = makePage();
  window.chrome.storage.local.get = () =>
    Promise.resolve({ stxSettings: { apiKey: 'sk_test', disabledHosts: ['localhost'] } });
  const res = await window.__stx.activate();
  assert.equal(res.ok, false);
  assert.equal(res.error, 'site-disabled');
  assert.equal(window.document.querySelectorAll('.stx-seg').length, 0);
});
