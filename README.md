# Sacred Hymnody PWA

Companion app to [fbckjv.app](https://fbckjv.app) — Baptist congregational singing & sung Psalms.

## Deployment (GitHub Pages)

All three files go in the **root** of this repository:

```
index.html      ← main app
sw.js           ← service worker (must be at root, same level as index.html)
manifest.json   ← PWA manifest
```

### GitHub Pages setup

1. Push all three files to `main` branch root
2. In repo Settings → Pages → Source: **Deploy from branch** → `main` / `/ (root)`
3. App will be live at `https://fbckjv.github.io/Hymns/`
4. Optional: add `CNAME` file containing `hymns.fbckjv.app` for custom subdomain

### Custom domain (hymns.fbckjv.app)

Add a `CNAME` file in the repo root containing:
```
hymns.fbckjv.app
```

Then in Cloudflare DNS, add a CNAME record:
- **Name:** `hymns`
- **Target:** `fbckjv.github.io`
- **Proxy:** DNS only (grey cloud) — GitHub Pages requires this

### Audio sources

All audio streams directly from these public archives:
- `baptistarchive.com` — Olmstead Baptist congregational recordings
- `smallchurchmusic.com` — Rev. Clyde McLennan organ/piano recordings  
- `bbc-media-files.s3.amazonaws.com` — Bible Baptist DeLand piano project
- `archive.org` — Internet Archive Baptist music collection
- `thepsalmssung.org` — Scottish Metrical Psalter sung recordings

All are public domain or freely licensed for ministry use.
