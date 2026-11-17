# Feedless

A private, offline practice feed — a Stories mode and a Posts (tweet-style) mode, both with your own previous posts visible. Nothing you post ever leaves your phone: it's all stored locally in the browser (IndexedDB), with no server, no account, no login.

## Try it locally

```bash
cd FakeFeedApp
python3 -m http.server 8767
```

Then open `http://localhost:8767` in a browser.

## Put it on your phone (no 7-day signing limit)

This is a web app (PWA), not a native iOS app, so Apple's 7-day developer-signing expiry doesn't apply — it's just a bookmark with a home-screen icon.

1. **Host it somewhere with `https`** (required for offline support + add-to-home-screen). Easiest free option: GitHub Pages.
   - Create a new **public** GitHub repo (e.g. `feedless`).
   - Push this `FakeFeedApp` folder's contents to it.
   - In the repo's Settings → Pages, set the source to the `main` branch, root folder.
   - Your app will be live at `https://<your-username>.github.io/feedless/`.
2. On your iPhone, open that link **in Safari** (must be Safari, not Chrome, for Add to Home Screen to install a PWA).
3. Tap the **Share** icon → **Add to Home Screen**.
4. Open it from the home screen icon. It now runs full-screen, with no browser bars.
5. Turn on Airplane Mode and reopen it — it should still work. (The very first visit must happen online so the service worker can cache the app; after that, it's offline.)

## Backing up your posts

Safari can clear site data (e.g. if storage runs low, or if you clear history). To be safe:
- Open **Settings** (⚙ in the app) → **Export backup** periodically. It saves a `.json` file via Safari's share sheet — save it to Files or iCloud Drive.
- **Import backup** restores from that file on any device.

## What's in here

- `index.html` / `style.css` / `app.js` — the app
- `db.js` — tiny IndexedDB wrapper (local storage only)
- `sw.js` — service worker, caches the app shell for offline use
- `manifest.json` — home-screen icon + standalone display
- `icons/` — generated app icons

## Notes

- Fake likes/retweets grow automatically over time (toggle in Settings).
- Stories stay in the ring permanently (grouped by day) — nothing auto-expires. There's also an "archive" grid of every story ever posted.
- All of it is local to one browser profile. Nothing is synced anywhere.
