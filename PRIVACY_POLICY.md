# Privacy Policy for All Downloader

**Last Updated:** October 1, 2026  
**Extension Name:** All Downloader  
**Repository:** [https://github.com/shibasishdas043/All-Downloader-Extension](https://github.com/shibasishdas043/All-Downloader-Extension)

All Downloader is a free, open-source browser extension designed to provide high-performance, multi-segment download acceleration, scheduling, and file management. 

We are committed to user privacy. **All Downloader does NOT collect, sell, transmit, or monetize your personal information, browsing history, or downloaded content.**

---

## 1. Information We Do NOT Collect
- We do **not** collect your name, email address, IP address, or physical location.
- We do **not** track or log the websites you visit or your browsing activity.
- We do **not** transmit download URLs, filenames, or file contents to any external telemetry servers or third parties.
- We do **not** use analytics tools, tracking pixels, or third-party advertising SDKs.

---

## 2. Information Handled Strictly on Your Device (Local Storage)
All Downloader operates **100% locally** within your browser using modern Web APIs:
- **Download Records & Metadata:** Filenames, download URLs, file sizes, timestamps, and completion statuses are stored solely in your browser's local storage (`chrome.storage.local` and IndexedDB).
- **In-Progress Data Chunks:** Download segments are buffered locally in your browser's private IndexedDB storage and assembled into final files directly on your computer.
- **User Preferences:** Settings such as dark mode, concurrent download limits, and speed limits are saved in `chrome.storage.local`.

None of this data ever leaves your computer or browser instance.

---

## 3. Browser Permissions & Justification

To perform its single purpose as a download manager, All Downloader requests the following browser permissions:

| Permission | Justification / Usage |
| :--- | :--- |
| `downloads` | Required to initiate and save completed download files to your local disk via Chrome's download manager. |
| `storage` & `unlimitedStorage` | Required to store user settings and buffer multi-gigabyte file chunks locally in IndexedDB without running out of quota. |
| `alarms` | Required to trigger scheduled downloads and keep the background Service Worker active during long-running file transfers. |
| `contextMenus` | Required to display the right-click "Download with All Downloader" context menu on downloadable links. |
| `notifications` | Required to display optional desktop notifications when downloads finish or encounter an error. |
| `offscreen` | Required in Manifest V3 to perform zero-copy Blob URL generation and cryptographic SHA-256 integrity verification in a separate DOM context. |
| `scripting` | Required to inject the link click interceptor into existing tabs upon extension installation/update without requiring a full browser restart. |
| `tabs` | Required solely to query existing dashboard tabs to avoid opening duplicate tabs when clicking the dashboard button, and to display brief in-page download confirmation toasts. |
| `<all_urls>` (Host Permissions) | Required to fetch file byte ranges (`Range: bytes=...`) from arbitrary third-party download servers requested by the user. |

---

## 4. Third-Party Services
All Downloader connects **only** to the specific URLs that you explicitly instruct it to download files from. It does not communicate with any external backend, API, or telemetry service operated by the extension authors.

---

## 5. Data Retention & Deletion
- All download history and buffered file chunks remain on your device until you manually clear them.
- You can clear your download history and chunk cache at any time via the extension's Dashboard (**History** > **Clear History** or **Settings**).
- Uninstalling the extension automatically removes all associated local storage and cached chunks managed by the browser.

---

## 6. Open Source Verification
All Downloader is open source under the MIT License. The complete source code is publicly inspectable and auditable on GitHub:  
[https://github.com/shibasishdas043/All-Downloader-Extension](https://github.com/shibasishdas043/All-Downloader-Extension)

---

## 7. Contact & Support
If you have any questions, feedback, or security concerns regarding this Privacy Policy, please open an issue on our GitHub repository:  
[https://github.com/shibasishdas043/All-Downloader-Extension/issues](https://github.com/shibasishdas043/All-Downloader-Extension/issues)
