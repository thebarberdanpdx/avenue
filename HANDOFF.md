# Vero — session handoff

> For a brand-new Claude Code session. Pick up exactly where this one left off.
> Pair this with **`CLAUDE.md`** (the durable developer guide) — this file is the *session-specific* state on top of it.
> Everything below was pulled from the actual code + git state on **2026-06-17**, not from memory.

---

## 0. TL;DR — current state in one breath

- **Working tree is CLEAN.** Nothing is uncommitted. `main` is in sync with `origin/main`. Everything done this session is committed *and* deployed to gotvero.com.
- `src/App.jsx` is **20,985 lines**. Latest commit: `c0c77df`.
- Build passes: `npm run build` → **exit 0** (`✓ built in ~300ms`).
- Consent guard intact: `grep -c "reminders from Sanctuary Barber Co" src/App.jsx` → **4**.

So: there is **no risk of losing in-progress work** — you are starting from a clean, deployed baseline. If you want to confirm, run the commands in §6.

---

## 1. Repo + stack basics

- **Product:** Vero — booking / client-management SaaS for service businesses (barbershops, salons, spas, tattoo). Live at **gotvero.com**. UI brand = "Vero"; the repo/package is named `avenue` for historical reasons — **same app**.
- **Stack:** React 19 + Vite 8 SPA. **Single source file: `src/App.jsx`** (~21k lines, ~233 top-level declarations). NOT split into modules — keep it that way unless explicitly asked. `App.backup.jsx` / `App.backup2.jsx` are old snapshots — ignore.
- **Backend:** Supabase (Postgres + magic-link auth). Per-shop synced lists (`clients` / `appts` / `services` / `providers` / `waitlist`) with an 800ms debounced save + realtime `postgres_changes` refetch. Business settings live on the `shops` table and are **NOT** realtime-refetched.
- **Payments:** Stripe live, via serverless `api/stripe.js` (`setup` / `sale_intent` / `charge` / `refund`). Publishable key inline in App.jsx (public, fine). Secret key only in Vercel env.
- **Hosting:** Vercel (`npx vercel --prod --force`).
- **iOS native:** Capacitor 8 wraps the web app. **`capacitor.config.json` → `server.url: "https://gotvero.com"`** — the native app loads the LIVE site, so **a web deploy automatically reaches the native app**. You only need `npm run build && npx cap sync` → Xcode ▶ when testing the native *shell itself* (push notifications, etc.).
- **Icons:** `lucide-react`. **Fonts:** Fraunces (serif, display) / Jost (sans, body) — `FONT_DISPLAY` / `FONT_BODY`.

### Commands
```bash
npm run dev                  # Vite dev server (web) — port 5173, see .claude/launch.json
npm run build                # production build — THE gate; clean exit = compiles
npm run lint                 # eslint
npx vercel --prod --force    # deploy web (also reaches native via gotvero.com)
npm run build && npx cap sync   # then Xcode ▶ — only when testing the native iOS shell
```
There is no web test runner. `gesture.test.js` is standalone. Verify with `npm run build`.

---

## 2. Uncommitted state right now (verified via git)

```
$ git status --short --branch
## main...origin/main          # ← no file lines below it
```
**Nothing staged, nothing unstaged, nothing untracked.** `git diff --stat` and `git diff --cached --stat` are both empty.

This session committed-and-deployed incrementally, so the working tree ended clean. The relevant commits (newest first, this session's range):

| Commit | What landed |
|---|---|
| `c0c77df` | Products editor: roomier layout + categories (group list, create-your-own) |
| `0413894` | Products: promoted to its own top-level Settings line |
| `1c35398` | Retail products **Phase 1**: catalog w/ photos, sell at checkout, stock, retail report |
| `58707b8` | Reports: hub is just the report list; filters moved into the open report; open at top |
| `2693207` | Reports: open straight to the report list (tools nested inside) |
| `5285c9d` | Toast redesign (premium dark-glass, spring animation) |
| `41f9002` | `ConfirmModal` — animated calendar confirmation dialogs |
| `47f0832` / `3c6fcf8` | Drag-reschedule reliability fixes |
| `9c50670` | In-service block readability + NOTIFY persistence |
| `4dea30a` | Calendar blocks → full service-color fill |
| `1b3f46b` | Option-C app-wide restyle + per-visit wrap notes + Rebook + contact links + reschedule guard |
| `c50d301` | Client-card (ClientProfile) Studio redesign + **CLAUDE.md** created |

(Use `git log --oneline -20` to see the full run.)

---

## 3. What's been done this session (with function names + approx. line numbers)

> Line numbers are approximate (the file shifted as edits landed). Search by the named anchor to be safe.

### a) Option-C app-wide white restyle (kill the grey)
The brief: a true black-and-white app in the **Studio** theme — no depressing grey.
- **`THEMES`** array `~536`; **studio token block `~546`**: `canvas:#FFFFFF`, `panel2:#FFFFFF`, `border:#DCDCDC`, `border2:#CFCFCF`, `faint:#AEAEAE`, `gold:#0A0A0A` (Studio's accent is near-black).
- **`buildThemeCSS` `~601`**: adds `--tint` / `--tint2` (Studio = white; other themes = gold wash), `--wash` (Studio = `transparent`; others = gold wash), and a Studio-only soft **`--shadow-sm/md/lg`** tier. Non-Studio themes keep their gold washes untouched.
- Net effect: surfaces are white in Studio and depth comes from hairline borders + soft shadows, not grey fills.

### b) Calendar appointment blocks → full service-color fill
- **`CalendarView` `~15803`**. Block paint vars at **`~16713`**:
  - `blkBg` = `tint` (full service-color tint; `var(--panel2)` when the appt is done) — **NOT** a monochrome border.
  - `blkBorder` = `color-mix(accent 30%, --border)`; `blkLeft` = `4px solid accent` (service color).
  - `blkShadow` = `--shadow-lg` while dragging else `--shadow-sm`.
- **In-service readability:** `darkBlock = a.status === "in-service" && theme === "studio"` (**`~16704`**) flips text to light (`onColor` / `subOn` / `text2On`) so an in-service dark fill stays readable.
- **Note:** "monochrome blocks" was an *intermediate* state that was **reverted** — current code is full service color (commit `4dea30a`). See §4 — this resolves one of the pre-listed "open decisions."

### c) Reschedule double-booking HARD guard
- Owner-side inline reschedule on the client card: **`reschedClashes(id, dateObj, start)`** in `ClientProfile` **`~20428`** — provider-overlap + buffer check (includes blocks); **blocks** the move, doesn't just warn. Consistent with the public booking guard. By design it does **not** enforce working hours / lead time / caps (user explicitly scoped it to double-bookings only).
- Calendar drag-move: **`commitMove(p)`** **`~16145`** uses a **functional `setAppts((cur) => cur.map(...))`** updater (fixes a stale-closure "works on the 3rd try" bug), and the live-sync race was closed by stamping `lastSaveAt.current.<table> = Date.now()` on the *local* edit, not only after the 800ms debounce — see the list-save effects at **`~1654`**.

### d) Tappable contact links (no pill buttons)
- **`PhoneLink({number})` `~817`** (→ `sms:` / `tel:`) and **`EmailLink({email})` `~854`** (→ `mailto:`).
- Used in the `ClientProfile` header (**`~20495`**) — the three old action pills were removed in favor of the name/phone/email being the live links.

### e) Per-visit wrap-up notes
- Stored on the appt as **`appt.wrapNote`** (+ `wrapNoteAt`).
- Authored in two places: `PulseView` wrap-up flow (save at **`~6350`**, "Note / Edit note" button **`~6359`**) and `ClientProfile` Visits tab (**`saveWrap(id, text)` `~20414`**, editor `~20776`, displayed `~20623`). Both use functional `setAppts` updaters.

### f) Rebook button
- **`rebook(a)`** in `ClientProfile` **`~20419`** → calls `onRebook({clientId, serviceId, providerId})`.
- Wired through `ShopDashboard` via **`rebookSeed` state `~8740`** → `CalendarView` consumes it and prefills **`NewAppointmentForm` `~15401`** (`initialClient` / `initialService` props).

### g) Toast + confirmation-dialog redesign
- **`Toast({msg, onDone})` `~8665`** — premium dark-glass card, spring-in/ease-out, check/alert badge. Fired via `showToast(msg)`.
- **`ConfirmModal({open, onClose, children, maxWidth}) `~8710`** — animated scrim+card with enter/exit, retains last children during exit. Now backs the calendar's Move / conflict / cap / waitlist dialogs (usages at `~16768`, `~16789`, `~16817`, `~16854`).

### h) "Me" → real name on the calendar
- **`apptDisplayName(a, clients) `~1027`** (module-level) resolves the "Me" placeholder to the linked client/family name. Used in the calendar tile, `AppointmentSheet` header/initials, and `ProgressCard`.

### i) Check-in flow
- NOTIFY persists to **`appt.lobbyNotifiedAt`**; `AppointmentSheet` (**`~18424`**) shows "NOTIFIED" once set (`notified = !!appt.lobbyNotifiedAt` `~18755`). "Start service" path fixed alongside the in-service readability work.

### j) Reports reorg + per-report date range
- **`ReportsHub` `~19298`**: the hub is now **just the report list** — the old top-of-screen Dates/Staff/Service filters were removed. Scrolls to top on open. A "Data" sub-list (import / merge dupes / test data) is nested at the bottom via `onOpenCard`.
- Date range is chosen **inside an opened report** through a shared `datePicker` with calendar-aware presets (Today / Yesterday / This week / Last 7 / This month / Last month / Last 30 / This quarter / YTD / Last year) **+ custom From/To** (`<input type="date">` at `~7030` / `~7033`, styled with `var(--panel2)` = white in Studio).

### k) Retail products — Phase 1 (complete)
- Data lives on **`business.products[]`** and **`business.productCategories[]`** (comment header `~13903`). Module helper **`compressImageFile(file, onResult, max=720, q=0.72)`** and `PRODUCT_CATEGORIES` default list.
- **`ProductsEditor({products, categories, onChange, onCategoriesChange, showToast}) `~13927`** — premium storefront: a category filter bar (All + per-category counts + an "Edit" chip → manage-categories Sheet), a 2-col photo-card grid (`ProductCard` with stock/hidden badges), an `AddTile`, and an add/edit form with image upload, a **category dropdown** (populated from the managed categories), price, cost, track-inventory toggle, active toggle.
- **Settings placement:** its own top-level line. Settings card `id:"products"` at **`~14477`** (`fullBleed`), and the **`productscat`** CATS entry at **`~14529`** (`section:"Set up your shop"`, single setting → opens directly). The card's `onChange`/`onCategoriesChange` **dual-write to both `form` and `business`** (`~14480`) so products persist immediately and no duplicate "Save changes" button appears.
- **Checkout:** `Checkout` (**`~17078`**) POS supports `lines[]`; `addSheet:"service"|"product"`; **`prodCat` filter `~17128`**; the "+ Product" picker (**`~17295`**) shows category tabs (when >1 category) + a filtered photo grid + a one-off item. `makeRec` writes `items:[{name,price,productId,qty}]` (**`~17180`**). **`recordSale`** decrements `business.products` `onHand` for tracked lines, **first sale only** (guarded by `!reopen`, comment `~17155`) — safe because `shops` isn't realtime-refetched.
- **Retail report:** report catalog entry `id:"retail"` (**`~19371`**); render branch `if (id === "retail")` (**`~19455`**).

---

## 4. What's left / open decisions

**Two items the prior session pre-listed as "open" are actually RESOLVED in current code** — recording so the next session doesn't re-do them:
- ~~Date-range picker has grey `#F4F4F4` fields that clash with Option C~~ → **resolved.** The custom date inputs use `var(--panel2)`, which is `#FFFFFF` in Studio. `grep -n "#F4F4F4" src/App.jsx` finds it only inside *other* themes' palette definitions, never in component styling.
- ~~Whether appointment left-bars stay monochrome or go back to service color~~ → **resolved.** Blocks are full service-color fill with a service-color left bar (commit `4dea30a`); monochrome was reverted.

**Genuinely still open:**
- **Retail Phase 2 (NOT started — confirm before building):** low-stock alerts + reorder list, "receive shipment" restocking flow, margin / inventory-valuation reports, and **per-staff product commission**. Right now `PerBarberView` still hard-codes **`const productSales = 0; // no product sales in prototype` (`~11597`)** — product revenue is not yet attributed to staff comp. This is the most concrete loose thread.
- **Authed-screen click-testing:** the dashboard is behind a staff magic-link login, so local verification can only smoke-test that the app *loads*, not click through authed flows. Real verification of checkout / reports / client-card happens on gotvero.com after deploy (or by logging in locally). Flag this limitation to the user rather than claiming a screen was click-tested.
- **No automated tests** for any of the above — all verification is build + manual.

---

## 5. Ship ritual + guardrails (do this every time)

**Gates before any deploy:**
1. `npm run build` → **exit 0** (esbuild parse + bundle clean).
2. `grep -c "reminders from Sanctuary Barber Co" src/App.jsx` → **exactly 4** (SMS 10DLC consent lines, ~4484 / ~4808 / ~4953 / ~5589).
3. Bracket / JSX sanity-check the edited regions (no obvious imbalance).

**Do NOT touch without explicit instruction:**
- **SMS consent / privacy / terms wording** — under 10DLC carrier vetting. Don't edit consent copy as a side effect of other work. Verify the count of 4 before every deploy.
- **`api/stripe.js`** — don't overwrite; it handles `setup` / `sale_intent` / `charge` / `refund`.
- Don't rebuild the **Checkout / refund / AppointmentSheet** engines — reuse them (`Checkout` with `reopen`/`alreadyPaid`; `ApptRefundSheet`).

**Process rule (hard):**
- **Never auto-commit and never auto-deploy.** When work is ready, **stop and show the user a one-line summary of each change first**, and wait for their go-ahead before `git commit` / `vercel --prod`. The user reviews before anything ships.

---

## 6. How to verify (copy-paste)

```bash
# clean-tree + sync check
git status --short --branch          # expect: ## main...origin/main, no file lines
git log --oneline -5                  # expect c0c77df at top

# build gate
npm run build                         # expect ✓ built (exit 0)

# consent guard
grep -c "reminders from Sanctuary Barber Co" src/App.jsx   # expect 4

# file size sanity
wc -l src/App.jsx                     # ~20985
```

For a visual smoke test: `npm run dev` → open the port-5173 URL (see `.claude/launch.json`). The public booking flow renders without login; the owner/staff dashboard needs a magic-link sign-in, so locally you can confirm it *loads* but full click-through of authed screens is best done on gotvero.com after deploy.

---

_Generated this session. If anything here disagrees with the code, trust the code and update this file._
