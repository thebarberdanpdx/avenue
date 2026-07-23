# 🌐 WEBSITE HANDOFF — sanctuarybarberco.com (READ THIS FIRST)

> **Scope lock:** This session is **ONLY about the marketing website** for Sanctuary Barber Co.
> Do **NOT** touch the booking app (`src/App.jsx`, `api/`, the Vero/gotvero.com codebase) — that's
> a separate effort. Everything you need is in **`website/`** and this file.

## What this is
Dan wants a **brand-new, cleaner replacement** for his current website at **sanctuarybarberco.com**
(today it's GoDaddy + Kadence + Stellar WP — he's not married to those, he just wants **simple**).
The new site should let clients **book from the site** (the booking itself is handled by his existing
app at **gotvero.com** — the website's job is to look great and send people into booking).

## The business (facts for copy)
- **Sanctuary Barber Co** — Beaverton, Oregon, tucked inside **Image Studios**.
- Private, **appointment-only** barbering **for men**. Cuts, beard work, straight-razor shaves. Unrushed.
- Barbers: **Dan** and **Heather**.
- Vibe Dan wants: *"scream sanctuary — relaxing, calm, inviting,"* but **masculine / premium**, the
  place to be for men. **It is NOT a spa.**

## Where the work lives
- **`website/index.html`** — the current mockup, single self-contained file (inline CSS/JS, 3 embedded
  photos). Open it in a browser to see the latest. This is the source of truth.
- **`website/sanctuary-logo.png`** — the logo.
- Private preview (claude.ai artifact, only Dan can see it):
  `https://claude.ai/code/artifact/cdd07b48-4ef8-471c-b939-7291bfe495f7`
- ⚠️ Nothing here is public or live. Dan's real GoDaddy site is untouched.

## Design decisions Dan already made (honor these — don't relitigate)
1. **No gold. No spa look.** Mostly **black & white / monochrome**; he floated **off-white instead of
   cream** for the background.
2. **Consistent fonts**, **premium** feel. He disliked an early version that felt like *"a blog / editorial
   from the early 2000s"* — avoid that.
3. **No image at the very top** — the **business name** goes at the top instead, with the tagline
   **"one chair, one guest at a time"** as a **sub-header** under the name. He specifically liked the
   **font used for that "one chair, one guest" line** in an early mockup and wants it used (incl. on the
   section headers).
4. **Section order:** **Location comes BEFORE services.** No "See services" button (services sit right
   under the name).
5. **"What to Expect"** (renamed from "How It Works") sits at the **very bottom** as a **collapsible
   section** — only the header line shows; it expands on tap.
6. **Section headers:** all **black**, with the **"razor" underline/stroke effect** (like the "no rush"
   part) — the razor stroke rendered **white** against the black header.
7. **Photos:** a section featuring **Dan + Heather** (two supplied photos — there's no good one of just
   the two of them), and the **building photo** — all in **FULL COLOR**.
8. The **directions link on the building photo must actually work** (open maps to the shop).
9. Include an **email address for questions**.
10. Intro copy: he rejected *"Private, appointment-only barbering for men — tucked quietly inside Image
    Studios"* (specifically the part after "barbering"). He doesn't want to spell out who-it's-for or
    where — write something **better / more evocative**.

## Progress — 2026-07-23 (design finalize pass)
Done in `website/index.html` this session (all verified by rendering the file in headless Chrome):
- **Fonts (#2/#3):** embedded **Oswald** (condensed, premium, masculine — barbershop, not spa/blog) as
  the display face for the wordmark, hero name, tagline, and every section header. Embedded as a
  data-URI `@font-face` so it works offline AND inside the artifact preview (external font links are
  blocked by the artifact CSP). Body copy stays the system sans — one consistent display+body pairing.
- **Tagline (#3):** now the recorded **"one chair, one guest at a time"** (was "One guest. No rush."),
  with the hollow razor-outline effect Dan liked kept on the "at a time." line.
- **Razor headers (#6):** every section header now carries a tapered **razor-blade underline stroke**;
  on the black "Our Story" band it renders **white** (the "white against the black header" note).
- **Intro copy (#10):** rewrote the lede to something more evocative, dropped the who/where spelling-out.
- **Mobile fit bug:** the giant hero name overflowed the viewport on phones (silently clipped by
  `overflow-x:hidden`). Root-caused by measuring the glyph-width/font-size ratio (~4.87) and resized the
  hero to fit every width down to ~320px. NOTE: this env's headless Chrome can't render below ~500px, so
  true-phone layout was verified by measurement + calc, not a screenshot — worth an eyeball on a real phone.
- ⚠️ **Unverified content (pre-existing, not authored this session):** address `2077 NE Town Center Dr
  Suite 120`, phone `(503) 840-2389`, email, hours, "400+ five-star reviews". Confirm these are correct
  before go-live — a wrong address/phone on a live site is the high-risk item here.

## Still open (needs doing / a decision from Dan)
- **Design:** fonts / razor headers / tagline / intro copy are done (see Progress above). Remaining is
  Dan's eyeball + any taste tweaks (exact display font is a defensible pick, trivially swappable).
- **Booking integration:** how the site's "Book" flows into **gotvero.com** (link out vs embed). Confirm
  with Dan.
- **Go-live plan (Dan's open question, verbatim):** *"once we nail down everything, how do we replace my
  current website?"* — i.e. how to point **sanctuarybarberco.com** away from GoDaddy to the new site
  (hosting + DNS cutover). Draft the plain-English steps; don't execute anything on his domain without him.

## How to work here
- Edit `website/index.html`; open it in a browser (or publish it as an Artifact) to preview.
- Keep it a **single self-contained file** unless Dan asks otherwise — it's easy for him to preview and move.
- Senior-engineer standard still applies (flag risks, verify, don't over-promise, brief plain-English
  replies — Dan is not an engineer). See the `⭐ WORKING STANDARD` in `CLAUDE.md` for how he wants to be
  talked to — but **ignore the app-specific parts of CLAUDE.md; this session is website-only.**
