# Third-party software

The booth itself has **no npm or pip packages** and no bundled fonts. It uses only Node.js built-in modules (`http`, `fs`, `path`, `os`, `crypto`, `child_process`) and browser features. Nothing else is copied into this repository.

Everything below is either installed separately by whoever runs the booth, or used only to build the PDF guide. None of it is redistributed here.

## Needed to run

| Software | Used for | Licence | Bundled here? | MIT conflict? |
|---|---|---|---|---|
| [Node.js](https://nodejs.org) 18 or newer | Runs `app/booth-server.js` | MIT (Node.js licence; its bundled parts are mostly MIT, BSD, Apache-2.0) | No. You install it, or drop a copy in `runtime/` (git-ignored) | No |
| Google Chrome or Chromium | Recorder and tablet pages (camera, canvas, MediaRecorder) | Chrome: proprietary freeware ([terms](https://policies.google.com/terms)). Chromium: BSD-3-Clause plus other open-source licences | No | No. You use it as an installed program; it is not part of this code |

## Optional

| Software | Used for | Licence | Bundled here? | MIT conflict? |
|---|---|---|---|---|
| [rclone](https://rclone.org) | Linux only: uploads clips to Google Drive (`storage.sync` in `booth-settings.json`). The server runs it as a separate program (`child_process`). | MIT | No | No |
| Google Drive for desktop | macOS/Windows: saves clips into a Drive folder | Proprietary freeware ([terms](https://policies.google.com/terms)) | No | No. Separate program; this repo only writes to a folder |
| A Google Cloud OAuth client of your own | Needed for rclone uploads without hitting shared-quota limits (see README) | Google API Services terms | No. You create your own; none is included | No |

## Used for the docs only

| Software | Used for | Licence | Bundled here? | MIT conflict? |
|---|---|---|---|---|
| Fraunces, Inter, IBM Plex Mono | Type in `SignOffBooth-program-and-guide.pdf` and the rig drawing. Loaded from Google Fonts when the PDF is built; the PDF embeds the glyphs it uses. The booth pages themselves use system fonts. | SIL Open Font License 1.1 | Not as font files. Glyph subsets are embedded in the PDF, which the OFL allows | No. OFL fonts may be embedded in documents; the fonts are not sold on their own |
| Google Chrome (headless) | Renders the PDF and the screenshots | See above | No | No |

## Code that needs a credit

**QR code maker (`app/booth-qr.js`).** The file says it is written in-house with no outside library. Its error-correction tables and module-count formula are the standard ones from the QR Code specification (ISO/IEC 18004) and match those published in [Project Nayuki's QR Code generator](https://www.nayuki.io/page/qr-code-generator-library) (MIT). Nayuki's source is not copied, as far as can be told, but the structure is close enough that a credit costs nothing. MIT is compatible with MIT, so this is a courtesy, not a conflict:

> QR Code generator library, Copyright (c) Project Nayuki. https://www.nayuki.io/page/qr-code-generator-library
> Released under the MIT licence.

If you know the file was written from scratch, you can drop this note. Check with the author first.

## Artwork

`brand/logo*.png` are neutral placeholder logos made for this project and are covered by the same MIT licence. Replace them with your own (see README, "Make it yours"). The screenshots and drawings in `docs/` are made from this code and are covered by the same licence.

## Conflicts

None found. Everything is MIT, BSD, OFL or separate freeware that you install yourself. Nothing is GPL, AGPL or "non-commercial", and no FFmpeg code is used or linked (FFmpeg is not a dependency of this program).

Not covered here: the licence of anything *you* add, such as your logo, fonts or a promo video, and the terms of services you connect (Google Drive, Google Cloud).
