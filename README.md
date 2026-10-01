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
| 🌍 Download Interceptor | Smart intent tracking for browser downloads & context menus |
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
├── tsconfig.json               ← TypeScript config
├── tsconfig.test.json          ← Test typings config
├── vite.config.ts              ← Vite + Vitest unified config
├── src/
│   ├── background/
│   │   ├── service-worker.ts   ← Main SW + message router (TS source)
│   │   ├── download-engine.ts  ← Fetch + chunk + pause/resume (TS source)
│   │   ├── queue-manager.ts    ← Priority queue + scheduler (TS source)
│   │   ├── speed-tracker.ts    ← Rolling-window speed/ETA (TS source)
│   │   └── storage.ts          ← chrome.storage + IndexedDB (TS source)
│   ├── popup/                  ← Compact 380px popup (popup.ts, popup.html, popup.css)
│   ├── dashboard/              ← Full-page SPA dashboard (dashboard.ts, dashboard.html, dashboard.css)
│   ├── content/                ← Link interceptor (link-interceptor.ts)
│   ├── shared/                 ← Constants, types.ts, utils.ts
│   └── assets/icons/
├── _locales/en/messages.json
├── tests/unit/
└── package.json
```

---

## 🚀 Load in Chrome (Developer Mode)

1. Run `npm run build` (or `npm run dev` during development)
2. Open `chrome://extensions`
3. Enable **Developer Mode** (top right)
4. Click **Load Unpacked**
5. Select the **`dist/`** folder
6. Pin the extension to the toolbar

---

## 🛠️ Development & TypeScript

```bash
npm install         # Install dev dependencies
npm run dev         # Watch mode: live build on changes (vite build --watch)
npm run typecheck   # Type-check TypeScript sources (tsc --noEmit)
npm test            # Run unit tests with Vitest
npm run bundle      # Fast bundle with Vite (npx vite build)
npm run build       # Full build: typecheck + Vite build + package dist/ & zip
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
