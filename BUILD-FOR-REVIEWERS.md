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
- `vendor/public_suffix_list.dat` is the unmodified official Public Suffix List (https://publicsuffix.org,
  Mozilla Public License 2.0; from https://github.com/publicsuffix/list, commit
  8437e5262f13305f94087abe699b4fe2be1d1de8),
  SHA-256 d3e6243b51695327984abb3e2a5aa7077096867f75121e031e6a5a3840ca8bcd.
  `vendor/psl.js` (copied unchanged into the package as `psl.js`) is generated from it by `node tools/make-psl.js`:
  comments are dropped, rules are lowercased and converted to Punycode (`url.domainToASCII`), plus a small
  readable lookup function. It is committed so the build does not depend on the Node.js ICU version; running
  `node tools/make-psl.js` reproduces it.
