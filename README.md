# Stretchtext, powered by Pollinations

[![Made with pollinations.ai](https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg)](https://pollinations.ai/?ref=badge)

A browser extension that turns any article into [stretchtext](https://en.wikipedia.org/wiki/StretchText). Ted Nelson described the idea in 1967: text that grows where the reader wants more and shrinks back where they don't. Writing every level by hand was too much work back then. Generating the extra levels on demand makes it cheap.

Sentences arrive at their normal length. The ones that can stretch get a dotted underline. Click one and it grows in place, fuller and clearer. Click **more** to stretch it further, **less** to step back, and click the sentence itself to collapse it to the original words.

Expansions are generated with [Pollinations](https://pollinations.ai) and paid for with **your own Pollen** (Bring Your Own Pollen). The extension holds no key of its own and has no server.

## Screenshots

_To be added. To see it live in the meantime, load the extension and open the manual test page described under Development: every stretchable sentence gets a dotted underline, and one click grows it in place._

## Install (load unpacked)

There is no store listing yet. Load it unpacked, it takes a minute:

1. Download this repository (green **Code** button, **Download ZIP**) and unzip it, or clone it.
2. Open `chrome://extensions` (Chrome or Edge) or `about:debugging` (Firefox).
3. Turn on **Developer mode** (Chrome/Edge).
4. Click **Load unpacked** and pick the repository folder (the one with `manifest.json` in it).
   Firefox: **Load Temporary Add-on** and pick `manifest.json`.
5. Pin the Stretchtext button to the toolbar.

## Use it

1. Open any article.
2. Click the Stretchtext toolbar button (or press `Alt+Shift+S`) and choose **Enable on this page**.
3. Click a dotted sentence to stretch it.

Turning it off restores the page to its exact original markup.

## Connect your Pollen

Expansions spend your Pollen, so the extension needs your Pollinations key once:

1. Open the extension **Options** page.
2. Click **Connect with Pollinations**. A Pollinations device page opens; approve it there.
3. Done. The approved key is stored only in your browser (`chrome.storage.local`). It is a normal Pollinations key with a budget and an expiry that you control, and you can revoke it from your Pollinations dashboard at any time.

No account yet? The same approval page lets you sign in with GitHub and top up Pollen if you need to.

Fallback: if you already have a Pollinations key, paste it on the Options page instead.

## Options

- **Model**: a cheap default (`openai/gpt-5.4-nano`), two presets, or any custom model id.
- **Per-site disable**: list of hosts where Stretchtext never activates. The popup has the same switch for the current site.

## Privacy

No tracking, no analytics, no logs. The extension talks to exactly two hosts:

- `gen.pollinations.ai` — the sentence you clicked, its paragraph for context, and your key.
- `enter.pollinations.ai` — only during sign-in (device flow).

Nothing else leaves the browser.

## Development

Plain JavaScript, no build step. Tests use the built-in node test runner:

```bash
npm install   # jsdom, for the content-script DOM test
npm test      # 19 tests: segmentation, expansion state, device flow, DOM behavior
```

A manual test page lives at `test/fixture.html`. Serve the repo over localhost and open it with the demo flag, and the extension activates on it by itself:

```bash
python3 -m http.server 8931
# open http://localhost:8931/test/fixture.html?stretchtext-demo=1
```

Layout:

- `src/core.js` — pure logic: sentence splitting, expansion levels, prompts, device-flow helpers.
- `src/content.js` — page side: finds paragraphs, wraps sentences, handles clicks.
- `src/background.js` — service worker: API calls, device flow, on-demand injection.
- `src/popup.*`, `src/options.*` — toolbar popup and options page.

## License

MIT. See `LICENSE`.
