# Third-party components in `viewer-static.min.js`

The file `viewer-static.min.js` (diagrams.net viewer v32.6.10, see `NOTICE`)
is redistributed unmodified and bundles the third-party code listed below.
Each entry is taken from the license or header comment found inside the bundle.
Entries marked **확인 필요** could not be confirmed from the bundle alone.

| Component | Version | License (as stated in the bundle) | Upstream |
|---|---|---|---|
| DOMPurify | 3.4.17 | Apache-2.0 **or** MPL-2.0 (header: "Released under the Apache license 2.0 and Mozilla Public License 2.0") | https://github.com/cure53/DOMPurify (tag `3.4.17`, LICENSE at `blob/3.4.17/LICENSE`) |
| pako | 2.2.0 | MIT AND Zlib (header: `@license (MIT AND Zlib)`) | https://github.com/nodeca/pako |
| spin.js | 2.0.0 | **확인 필요**: the bundle has the header `fgnass.github.com/spin.js#v2.0.0` but no license text | https://github.com/fgnass/spin.js (header URL: `fgnass.github.com/spin.js`) |
| Babel helpers (`babel-helpers`) | not stated | MIT (header: "Copyright (c) 2014-present, Facebook, Inc. -- license (MIT)") | https://github.com/babel/babel (`packages/babel-helpers/LICENSE`) |

## Notes

- **JSZip**: the bundle calls a global `JSZip` and loads `js/extensions.min.js`
  from the draw.io server. JSZip code is not in this file, so it is not
  redistributed here.
- **mermaid**: the name appears only as config keys and property prefixes.
  No mermaid library code was found. **확인 필요**: confirm with a full
  search of the bundle before release.
- **Other code**: the bundle may contain further libraries without a header
  comment. The check above covers only the header strings it found.
  **확인 필요**: a full scan of the bundle for unlisted libraries.
- The draw.io code itself (JGraph Ltd) is Apache-2.0, see `LICENSE` in this folder.
- The bundle contains only header comments; full license texts for DOMPurify
  (Apache-2.0 and MPL-2.0) and pako (MIT, Zlib) are not in this folder.
  Their upstream repositories above hold the complete texts.
