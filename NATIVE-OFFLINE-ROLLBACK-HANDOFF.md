# Handoff: Offline Native Work & iOS UI Regression (Jul 2026)

> **For Claude:** Read this file first before touching native iOS, Capacitor config, viewport, or offline work.
> **Current `main`:** restore commit `31046c7` (rolled back to pre-offline `f0f19d4`).
> **Dan's last step:** Xcode → Pull → force-quit app → Run. Verify UI on iPhone.

---

## What we were trying to do

**Goal:** Make Vero's native iOS app offline-first so network/backend outages wouldn't stop the shop (#1 priority in `RELIABILITY-PLAN.md`).

**Approach (native SQLite, not PowerSync):**
1. Stage 0: Add `@capacitor-community/sqlite` behind `OFFLINE_NATIVE` flag
2. Stage 1: Read from SQLite on native (seed from last sync)
3. Stage 2: Offline writes (never started)

**Historical setup:** Native app used `capacitor.config.json` → `server.url: "https://gotvero.com"` so the shell loaded the **live site** (web deploys reached the app without Xcode rebuilds).

**The pivot that broke things:** PR #279 removed `server.url` and shipped a **local `dist/` bundle** for airplane mode.

---

## Timeline (newest first)

| Commit | What it did | Problem |
|--------|-------------|---------|
| `31046c7` | **Full restore to `f0f19d4`** | Current main — rollback everything below |
| `fcc735d` | Tracked `ios/App/App/capacitor.config.json` in git | Good; `ios/App/App/public/` still gitignored |
| `58afff0` | `isNativeShell()` viewport + `cap:prepare` | Unverified; crash still reported |
| `b7e90f9` | Removed viewport lock, restored `server.url` | Stabilization attempt |
| `8458516` | Added `lockNativeShellLayout()` using `innerWidth` | **Worst regression — 2.5× zoomed UI** |
| `5e63b3c` | Shell CSS, cache boot, `build:cap` | Didn't fix viewport |
| `80f177c` (#280) | Shop settings cache | Data only |
| `b12f90c` (#279) | Removed `server.url`, local bundle | Broke viewport; required cap sync |
| `329d94b` (#278) | `OFFLINE_NATIVE = true` | SQLite on native |
| `345d6b5` (#276) | Offline stage 0 groundwork | Start of offline work |
| `f0f19d4` | **Last known-good before offline** | Restore target |

---

## Root causes (with evidence)

### 1. Enlarged UI (giant date pills, huge nav, grey calendar)

- **`lockNativeShellLayout()` in `main.jsx` (commit `8458516`):** Read `window.innerWidth` (~980px in WKWebView), wrote it into viewport meta → entire UI zoomed on ~390pt iPhone.
- **Calendar day strip `flex: 0 0 14.2%`:** At 980px layout width, date cells became ~139px wide.
- **Grid columns `flex: 1`:** Appointment tiles became wide flat grey bars.
- **Local bundle (`#279`):** `capacitor://` + `device-width` often resolves wrong on first paint.

### 2. Viewport fix gap

- `index.html` boot script only ran when `protocol === 'capacitor:'`.
- With `server.url`, protocol is `https:` — boot script skipped, but `lockNativeShellLayout` still ran via `Capacitor.isNativePlatform()`.

### 3. Stale iOS shell on Dan's Mac

- `ios/App/App/public/` is **gitignored** — bundled JS never arrives via `git pull`.
- Without `npx cap sync` on Dan's Mac, Xcode ran old bundle (no `server.url`, old viewport code).
- **Git push alone does not fix the phone.**

### 4. Crash screen ("Something went wrong / The app hit a snag")

- `App.jsx` `ErrorBoundary` with `minimal` prop — React render crash, not Sentry fallback.
- Likely from offline/viewport code added after `f0f19d4`. Restored in `31046c7`.

### 5. Process failures

- Claimed "fixed" without iPhone verification (cloud agents cannot run Xcode).
- `ship-check` guards required `OFFLINE_NATIVE = true` and blocked `server.url` — fought rollback.
- Stacked fixes on unverified fixes (`8458516` made things worse).

---

## What `31046c7` restored

- `server.url: https://gotvero.com` in root + tracked ios config
- Simple `index.html` with `device-width` viewport (no boot scripts)
- Clean `main.jsx` (no viewport locks)
- `App.jsx` without offline SQLite / cache boot (~350 lines removed)
- Removed `@capacitor-community/sqlite` from package.json
- Removed `CAPACITOR_BUILD`, `cap:prepare`, `verify-cap-bundle.mjs`
- **Kept:** calendar sync fixes (#269–#273), provider email/phone guards, SMS consent ×4

---

## NEVER repeat this

1. **Never claim native fix without device verification.**
2. **Never use `innerWidth` for viewport on Capacitor** — use `screen.width` before paint if needed, or don't touch viewport when using `server.url`.
3. **Don't remove `server.url` until local bundle is proven on a real iPhone.**
4. **Git push ≠ iOS update** — `ios/App/App/public/` requires `npm run build:cap && npx cap sync` on the Mac that runs Xcode (unless using `server.url` where web deploy carries JS).
5. **Revert to last known-good first** when native UI breaks — don't stack fixes.
6. **Ship-check guards should block regressions, not require features to stay ON** (e.g. don't guard `OFFLINE_NATIVE = true` when pausing is valid).
7. **Two modes — pick deliberately:**

| Mode | Pros | Cons |
|------|------|------|
| `server.url` → gotvero.com | Web deploy updates native instantly | No offline |
| Local `dist/` bundle | Airplane mode | Every change needs build:cap + cap sync + Xcode; viewport fragile |

---

## If re-approaching offline later

Gates before re-enabling:
1. Local bundle renders correctly on iPhone (device test)
2. Document mandatory ritual: `build:cap` → `cap sync` → Xcode
3. Airplane mode: JS loads, cached data shows, honest errors (no demo data)
4. SQLite seed doesn't corrupt calendar units (start/end seconds vs minutes)
5. Separate ship-check profile for offline-ON vs production

---

## Files to audit

| File | Offline saga | Status at `31046c7` |
|------|--------------|---------------------|
| `src/App.jsx` | Offline store, cache, calApptMin | Reverted |
| `src/main.jsx` | lockNativeShellLayout, ensureNativeViewport | Reverted |
| `index.html` | Viewport boot scripts | Reverted |
| `capacitor.config.json` | server.url removed/added | Restored |
| `vite.config.js` | CAPACITOR_BUILD | Reverted |
| `package.json` | sqlite dep | Reverted |
| `scripts/ship-check.mjs` | Offline guards | Reverted |
| `ios/App/App/capacitor.config.json` | Now tracked | Has server.url |
| `db/RUN-PENDING-SQL.md` | Added in offline work | May still exist — optional cleanup |

---

## One-line summary

Offline-native work (#276–#280) broke WKWebView viewport (worsened by an `innerWidth` "fix"); stale Xcode bundles meant fixes never reached Dan's phone; app crashed to error boundary. **`main` at `31046c7` fully restores pre-offline `f0f19d4`** while keeping calendar sync. Do not touch offline without a device-test plan.
