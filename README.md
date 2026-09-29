# All-Downloader Extension

> A **secure**, **open-source** browser download manager — built for speed, privacy, and power.

![Palette](https://img.shields.io/badge/palette-5%20colors-8ecae6?style=flat-square)
![MV3](https://img.shields.io/badge/manifest-v3-219ebc?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-023047?style=flat-square)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🚀 Multi-segment downloads | Splits files into 8 parallel chunks like IDM |
| ⏸ Pause / Resume | Byte-range aware — resumes exactly where it stopped |
| 📋 Smart queue | Configurable concurrency, priority reordering |
| ⏰ Scheduler | Download at a specific date/time via chrome.alarms |
| 🔐 SHA-256 integrity | Verifies file hash using Web Crypto API — no deps |
| 📊 Statistics | Speed, ETA, category breakdown, lifetime totals |
| 🎨 Beautiful UI | Dark navy theme, animated progress bars, micro-animations |
| 🌍 Link Interceptor | Hover any downloadable link for a "Download with ADL" button |
| 🔒 Zero telemetry | No analytics, no server, 100% local |

---

## 🎨 Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| Sky Blue | `#8ecae6` | Progress fills, secondary accents |
| Ocean | `#219ebc` | Primary buttons, active states |
| Deep Navy | `#023047` | Backgrounds, base surface |
| Amber | `#ffb703` | Speed display, warnings |
| Orange | `#fb8500` | CTAs, errors, badges |

---

## 📁 Project Structure

```
All-Downloader-Extension/
├── manifest.json               ← MV3 manifest
├── src/
│   ├── background/
│   │   ├── service-worker.js   ← Main SW + message router
│   │   ├── download-engine.js  ← Fetch + chunk + pause/resume
│   │   ├── queue-manager.js    ← Priority queue + scheduler
│   │   ├── speed-tracker.js    ← Rolling-window speed/ETA
│   │   ├── integrity.js        ← SHA-256 (SubtleCrypto)
│   │   └── storage.js          ← chrome.storage + IndexedDB
│   ├── popup/                  ← Compact 380px popup
│   ├── dashboard/              ← Full-page SPA dashboard
│   ├── content/                ← Link interceptor
│   ├── shared/                 ← Constants, utils (no side effects)
│   └── assets/icons/
├── _locales/en/messages.json
├── tests/unit/
├── scripts/build.js
└── package.json
```

---

## 🚀 Load in Chrome (Developer Mode)

1. Open `chrome://extensions`
2. Enable **Developer Mode** (top right)
3. Click **Load Unpacked**
4. Select this folder (`All-Downloader-Extension/`)
5. Pin the extension to the toolbar

---

## 🛠️ Development

```bash
npm install       # Install dev dependencies
npm run lint      # Lint all JS files
npm test          # Run unit tests
npm run build     # Build to /dist
```

---

## 🔐 Security

- **Manifest V3** — strict CSP, no eval, no remote code
- **No external servers** — all processing is local
- **SHA-256 file integrity** — via native SubtleCrypto
- **Minimal permissions** — only what is absolutely needed
- **Open source** — full code audit welcome

---

## 📄 License

MIT © All-Downloader Contributors
