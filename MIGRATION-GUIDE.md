# Mangomint → Vero migration guide (Sanctuary Barber Co)

> The step-by-step plan for moving the shop's book — clients, past visits, and upcoming
> appointments — off Mangomint and onto Vero, with Mangomint kept as a fail-safe for the
> first two weeks. Written 2026-07-06 against the live code (the importer, calendar sync,
> reminders cron, and reports were all read before writing this — the mechanics below are
> how the app actually behaves, not guesses).

---

## The shape of the move (read this first)

**One import night. One system in charge the next morning. Mangomint frozen, not dead, for two weeks.**

1. **Day 0 (a closed evening):** export everything from Mangomint, import clients + full
   appointment history + upcoming appointments into Vero, verify, and shut off Mangomint's
   client texts and online booking.
2. **Day 1 (go-live):** every booking link points at Vero. The whole team books, reschedules,
   checks in, and takes payment in Vero only. **Nothing new is ever typed into Mangomint again.**
3. **Days 1–14 (the overlap):** Mangomint stays paid-for and untouched — a frozen archive you
   can fall back on. A 2-minute daily ritual proves Vero is holding the book.
4. **Exit gate:** after ~10 clean business days, pull final exports, save them forever, cancel.

**Why not run both systems "actively" for two weeks?** Two live calendars means double data
entry, double reminder texts to clients, and two versions of the truth that drift apart — that's
where migrations go wrong. The fail-safe isn't a second live register; it's (a) Mangomint frozen
with all its history intact, (b) your saved exports, and (c) a nightly screenshot of the Vero
calendar. If Vero ever had a catastrophic day-one problem, you reopen Mangomint's online booking
and you're back where you started, minus nothing.

---

## Phase 0 — The week before (prep)

- [ ] **Finish the in-app launch checklist** (the guided "Ready to go live?" list) if anything's
      still open — staff, menu, hours, Stripe live, storefront, messages.
- [ ] **Staff names in Vero match Mangomint's spellings.** The importer attributes each history
      row to a staff member by matching the first word of the name (e.g. "Heather" ↔ "Heather").
      A row it can't match lands on the **Default staff member** you pick during import.
- [ ] **Service names: make the CSV match Vero's menu.** The importer matches services by exact
      name, then by "contains". Since the Vero menu was rebuilt (Scissor Cut, Skin Fade, …), open
      the Mangomint export in a spreadsheet and find-and-replace old service names to Vero's names
      **before importing**. Why it matters: matched services give imported *upcoming* appointments
      the right length and price; an unmatched service imports fine as text but defaults to **30
      minutes**, which you'd have to fix by hand on the calendar.
- [ ] **Confirm Supabase automated backups are ON** (Supabase dashboard → project → Backups).
      `DATABASE.md` flags this as the real protection for client/appointment data — verify it
      before the import, not after.
- [ ] **Prove the money path once more:** one real test booking on gotvero.com end-to-end,
      charged and refunded through Vero checkout.
- [ ] **Prove reminders:** confirm an upcoming real appointment received its confirmation/reminder
      text (SMS has been live since 7/03 — this is just a spot-check).
- [ ] **Get the Mangomint exports early** (Phase 1) and do the 5-row dry run (Phase 2, step 3)
      days before the real import night, so surprises surface with time to spare.

---

## Phase 1 — Export from Mangomint

Grab these, and park every file in a folder you'll keep forever (Drive):

- [ ] **Clients CSV** — name, phone, email, birthday (+ notes column if their export includes it).
- [ ] **Appointments CSV — all time, through the end of the book** (past AND future), one row per
      appointment, with: client name, phone (email too if available), date, start time, service,
      staff, status, price.
- [ ] **Sales / payment history export** — for your tax records only. It will NOT import; Vero's
      collected-money records start at Day 1.
- [ ] **Outstanding balances list:** gift cards, packages, memberships — who, how much is left,
      what it's worth. This list becomes your manual ledger (Phase 4).
- [ ] **Photos / formulas you'd hate to lose.** Bulk photo export usually isn't offered —
      screenshot the ones that matter for your top clients.

If you can't find an export in Mangomint's UI, **ask Mangomint support for a full data export** —
tell them: *"CSV please — clients, and all appointments (one row per appointment) with client
name, phone, email, date, start time, service, staff, status, and price."*

**The ideal appointments CSV** (column names don't need to be exact — you map them by hand in
the importer, and it auto-guesses the obvious ones):

```
First Name, Last Name, Phone, Email, Birthday, Appointment Date, Start Time, Service, Staff, Status, Price
```

At minimum, make sure **phone** is in there — phone is what duplicate-matching keys on.

---

## Phase 2 — Import night (Day 0 — a closed evening, e.g. Sunday)

Where the tools live: **Reports → scroll to the bottom → Data** → *Import data* /
*Merge duplicates*. The Import card has two tabs: **Spreadsheet** and **Calendar**.

**Do these in order — the order matters:**

1. [ ] **Remove the calendar-sync feeds first** (Import data → Calendar tab → remove each
       connected calendar). Those mirrored tiles were a bridge while Mangomint was primary;
       tonight the real appointments arrive via CSV, and if the feeds stay connected every
       upcoming appointment will show **twice** on the calendar (the imported one + the mirror).
       Removing a feed deletes only its mirrored tiles — never real Vero appointments. If any
       mirrored tiles linger, the Calendar tab has a "clear mirrored appointments" action.
2. [ ] **Turn OFF Mangomint's automated client messages** (confirmations, reminders — all of
       them). From tonight, imported upcoming appointments are real Vero appointments and **Vero
       will text their reminders**. If Mangomint's texts stay on, clients get two texts per visit.
3. [ ] **Dry run:** copy the appointments CSV, delete all but ~5 rows, import it, check the
       result on a client card and the calendar, then tap **Undo this import**. Undo removes
       exactly that batch and nothing else — this is your safety net all night.
4. [ ] **Import the APPOINTMENTS file first** (the full one: history + upcoming).
       Upload → line up columns (it guesses most) → pick the **Default staff member** → Preview.
       The preview shows: new clients, matched-to-existing, appointment count (past / upcoming),
       exactly who merges into an existing card (phone/email match), and possible same-name
       duplicates. Read it before tapping Import.
       - **Why appointments before clients:** visit count, last visit, average rebook cadence,
         and imported lifetime spend are computed from history **only for clients the batch
         creates**. Let the history file create the clients; the client file then fills gaps.
5. [ ] **Import the CLIENTS file second.** Anyone already created merges by phone → email (their
       blank email/birthday gets filled in — existing info is never overwritten), and clients
       with no appointment history get added fresh.
6. [ ] **Run Merge duplicates** (Reports → Data) — collapses any clients sharing a phone number.
7. [ ] **Review the "possible duplicates" flags** from the preview: same name but no matching
       phone/email imports as a *separate* client on purpose (same-name ≠ same person). If one
       really is the same person, add their phone to that card or merge by hand.
8. [ ] **Spot-check 10 regulars:** phone right, visit count ≈ Mangomint's, last visit right,
       upcoming appointment on the calendar at the right time with the right barber.
9. [ ] **Groom the next 2–3 weeks on the calendar:** fix any 30-minute default tiles (unmatched
       service names), wrong staff, or odd times. Every unmatched service tile still shows the
       original service text from Mangomint, so you can see what it was meant to be.
10. [ ] **Re-block anyone on your blocked list** — blocked status doesn't come through a CSV.
11. [ ] **Family members:** a kid booked under a parent's phone number merges into the parent's
        card (same phone = same person, by design). Re-add family members on the parent's card
        where it matters; the history staying under the parent is fine.
12. [ ] Anything look wrong at any point → **Undo this import**, fix the file, import again.
        (Don't import the same appointments file twice without undoing first — clients dedupe,
        but the appointments would double.)

**Things that happen automatically — know about them:**

- **Duplicate matching is phone first, then email.** A match reuses the existing Vero card
  (someone who already booked online keeps their card; the import adds their history to it).
- **The retention engine wakes up for imported clients:** last visit + average cadence are
  derived from their history, so "due soon" / "overdue" rebooking nudges work from day one.
- **Imported upcoming appointments get real Vero reminder texts** on schedule. One built-in
  courtesy: a reminder whose send-window already passed by more than ~2 hours at import time is
  skipped, so import night won't spray stale texts.
- **Birthdays imported = birthday texts.** If the automated birthday message is on, imported
  clients with birthdays are now in that pool. Decide if you want that on during week 1.
- **Each imported client's "provider" is set to the Default staff member you picked** — their
  visit history still shows the correct barber per appointment, but the card's home barber
  defaults to that one person. Fix per client on the card if it matters (or ask Claude to make
  the importer derive it from their visit history before import night — small change).

**One money-truth thing to expect (verified in the code):** the **Revenue report counts every
"done" appointment in the period at its recorded price — including imported ones.** So for the
switch month, Vero's revenue report shows your *true* combined month (Mangomint-era visits + Vero
visits), which is useful — but it will NOT match Stripe payouts or the **Transactions ledger**
(those only ever contain money actually collected through Vero). For "what did I actually collect
in Vero," use the Transactions ledger / Tax report; for "how did the shop do," the Revenue report
now includes the imported history it sits on. If you'd rather Vero's reports start clean, import
history with prices anyway — just read this month's revenue knowing what's in it.

---

## Phase 3 — Go-live morning (Day 1)

- [ ] **Every "Book Now" points at Vero:** the sanctuary site, Instagram bio, Google Business
      Profile, linktree, saved links in text threads — hunt them all down. A stray Mangomint link
      is how ghost bookings happen during week 1.
- [ ] **Mangomint online booking OFF.** Nobody can book there even by accident.
- [ ] **Vero storefront ON** (it already is — verify).
- [ ] **House rule for the team, said out loud:** *"Everything happens in Vero now. Booking,
      rebooking, walk-ins, check-in, checkout, cards. If you touch Mangomint, something is
      wrong."*
- [ ] At the chair: *"We switched booking systems — texts come from our new number now, and the
      first time you book online it'll ask you to confirm your info once."*

---

## Phase 4 — The two-week overlap (fail-safe mode)

Mangomint is now a **frozen archive you're paying for two more weeks**. Its job is to exist.

**Daily, 2 minutes (evening):**
- [ ] Tomorrow's list in Vero looks right (right people, right times, right barbers).
- [ ] Screenshot the next 7 days of the Vero calendar (30 seconds — your paper-proof fallback).
- [ ] Today's take in Vero matches reality (drawer + Stripe).

**Weekly:**
- [ ] Skim Revenue + per-staff reports for anything weird.
- [ ] Reminders are landing — clients confirming and showing up is the signal; a spot "did you
      get our text?" at the chair settles it.

**As Mangomint-era balances walk in:**
- [ ] Gift card / package / membership client arrives → check your exported balances list →
      honor it as a **discount at Vero checkout** → note the remaining balance on their client
      card (e.g. *"GC: $25 left — from Mangomint"*) → update the list. The list is the ledger;
      Vero doesn't have gift cards yet.
- [ ] **Cancel Mangomint membership auto-charges** at cutover (don't keep billing people through
      a system you've left) and decide how you'll honor remaining membership value.

**Cards on file:** they physically cannot move between processors — Mangomint's vault stays in
Mangomint. Coverage rebuilds on its own: online bookings save a card, and checkout can save one.
Expect a few weeks before card-on-file protection is back to normal; don't lean on no-show
charges for imported bookings in the meantime.

**Optional, stricter fail-safe (only if you want it):** each evening of week 1, hand-copy the
day's *new* future bookings into Mangomint **with its client notifications off**, so Mangomint
stays instantly bookable if you ever had to retreat. Honest advice: if this costs more than ~10
minutes a day, skip it — the frozen archive + nightly screenshot + Supabase backups already cover
the realistic failure cases, and double-entry is where mistakes breed.

**Rules of the road:**
- Reschedules and cancellations for *any* appointment — including imported ones — happen in Vero.
- If a client says "I booked online but you don't see me" → a stray Mangomint link is live
  somewhere. Find the link, kill it, recreate the appointment in Vero.

---

## Phase 5 — The exit gate (ending the overlap)

Cancel Mangomint only when **all of these have been true for ~10 straight business days:**

- [ ] Every visit that happened was in Vero, on the right client.
- [ ] Every charge ran through Vero checkout (tips included) and payouts arrived.
- [ ] Reminder texts are demonstrably going out (no-show rate looks normal).
- [ ] Nobody walked in who Vero didn't know.

Then, in order:

- [ ] **Final Mangomint exports** — clients, all-time appointments, full sales/tax history, final
      gift-card balances — into the permanent folder. Once you cancel, access to the data ends.
- [ ] Cancel the subscription.
- [ ] Keep the balances list alive until every old gift card/package is redeemed or expired.
- [ ] Keep the export folder forever (taxes).

---

## What does NOT come over — set expectations now

| Thing | What happens | What to do |
|---|---|---|
| **Client private notes / formulas** | The importer has no notes column — they don't import. | Keep the Mangomint export handy for lookups; hand-copy the top ~20 clients' notes onto their Vero cards; or ask Claude to add a Notes column to the importer before import night (small change). |
| **Photos** | No bulk export from Mangomint. | Screenshot the ones that matter; Vero's per-client gallery is filled going forward. |
| **Cards on file** | Not exportable from any processor. | Rebuild at online booking + checkout over the first weeks. |
| **Collected-payment history** | Stays in Mangomint's export (taxes). | Vero's Transactions ledger starts Day 1; the Revenue report includes imported visit values (see Phase 2 note). |
| **Gift cards / packages / memberships** | No Vero equivalent yet. | Exported balances list + manual honoring at checkout (Phase 4). |
| **Blocked list, family links** | Not in a CSV. | Re-create by hand — minutes of work (Phase 2, steps 10–11). |
| **Reviews** | Google reviews are untouched by any of this. | Nothing. |

---

## If something goes wrong

- **A bad import** → the done screen's **Undo this import** removes that batch (its clients + its
  appointments) and nothing else. Fix the file, run it again.
- **Duplicates discovered later** → Reports → Data → **Merge duplicates** (same phone). Same name
  but different/missing phone? Fix the phone on one card first, then merge.
- **A client got two texts for one visit** → Mangomint's automated messages aren't actually off.
  That's the only way it happens.
- **A ghost "mirror" tile on the calendar** → a calendar feed is still connected. Import data →
  Calendar tab → remove it / clear mirrored appointments.
- **An imported upcoming appointment is the wrong length** → its service name didn't match the
  Vero menu (30-min default). Drag it right; done.
- **Catastrophic "go back" scenario** (Vero unusable, week 1): reopen Mangomint online booking,
  point the site's Book Now back at it, and work from Mangomint (it still holds everything from
  before Day 0) + the nightly calendar screenshots for anything booked since. Nothing is lost;
  you retreat, regroup, re-cut another Sunday.
