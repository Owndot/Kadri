# Building Kadri (for Mozilla add-on reviewers)

## Requirements
- Linux or macOS with Node.js 18 or newer (tested: Linux, Node.js 22.22) and the `zip` command line tool
  (Debian/Ubuntu: `sudo apt install zip`).
- No npm packages and no network access needed. `npm install` is NOT required (there are no dependencies).

## Steps
1. Unzip this source archive into an empty folder and open a terminal there.
2. Run: `node tools/build.js`
3. The Firefox extension is now in `dist/firefox/` (and zipped as `dist/kadri-firefox-<version>.zip`).
   Its files are identical to the uploaded add-on package.

## What the build does
- `content.js` is made by concatenating the plain JavaScript files in `src/` (in file-name order) between
  `firefox/prelude.js` and `firefox/epilogue.js`. Three fixed text replacements are applied: the userscript
  header comment is removed, and two display names ("Video-Assistent" → "Kadri") are swapped. Nothing is
  minified, transpiled or obfuscated.
- `defaults.js` is generated from the settings block in `src/020-einstellungen-sprache.js` (plain JSON).
- All other files are copied unchanged from `firefox/`. `__VERSION__` in `firefox/manifest.json` is replaced
  with the version from `package.json`.
- `vendor/hls.min.js` is the unmodified official hls.js 1.7.3 release (Apache-2.0),
  SHA-256 a12e7ee1cd64a69dcdb314157e45dafcba705bfb0b1440b7935cb265d374423e.
