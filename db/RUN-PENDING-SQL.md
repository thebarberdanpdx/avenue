# Pending SQL — run in Supabase (Dan)

Paste each file **once** into the Supabase dashboard → **SQL Editor** → **Run**.

Order does not matter. If a line says `already exists`, that’s fine — stop and tell Claude.

---

## 000. 🚨 RUN THIS NOW — blocked clients can currently book online

**File:** `restore-blocked-guard-2026-07-23.sql`

**What it does:** An earlier SQL update accidentally removed the rule that stops blocked clients from booking online — so right now a client you blocked can still book. This puts the block back (and keeps the new-client-limit fix). Verified live that the block was off.

**After:** A blocked client's online booking is refused — they see the neutral "online booking unavailable" message, never anything about being blocked.

---

## 00b. $5 selfie credit becomes one-time-per-client (recommended)

**File:** `selfie-reward-ledger-2026-07-23.sql`

**What it does:** The $5 "add a selfie" credit is meant to be a one-time perk. Until now it was only blocked from repeating by "do we already have their photo?" — which a client could get around (skip or remove the photo) to grab the $5 again on a later booking. This makes it a real one-time-per-client rule on the server: once someone's gotten the $5, they never get it again, even if the photo changes. The app now also locks the selfie once added (no "Remove" button on the confirmation screen).

**After:** A returning client who already got the selfie $5 is not offered it again and can't re-claim it. No change for a first-time selfie.

---

## 00. Client can re-load their photos on a new phone (optional but recommended)

**File:** `booking-extras-read-2026-07-23.sql`

**What it does:** When a client comes back and taps "Edit photos & notes," lets the app pull the photos they attached back from the server. The note and the "Edit" button already work without this; this is only so the actual **photos** reappear after a full reload or on a different phone (photos aren't kept on the device, to save space). Safe, read-only, adds nothing that affects booking.

**After:** Edit a booking's photos on a fresh browser/phone → the photos you added at booking show up, not a blank box.

---

## 0. ⚠️ URGENT — new clients can't book on synced days (go-live blocker)

**File:** `fix-newclient-cap-sync-2026-07-22.sql`

**What it does:** Two fixes in one paste. (1) Your "new clients per day" limit was counting every appointment synced from your old calendar as a "new client," so any day with synced appointments looked over the limit — and every brand-new client got rejected when they tried to book (this is the error Heather hit on July 31). This makes the limit count only real online bookings. (2) It also lets the booking page see each barber's new-client load (times only, no client info), so a day that's already at the limit is hidden from new clients up front — they never fill out the form just to be rejected at the end.

**After:** A brand-new client can book a Thursday/Friday again (your cap of 2 works as intended), and days at the limit simply don't show times to new clients.

---

## 1. Client notes/photos → staff in-app alert

**File:** `visit-extras-2026-07-08.sql`

**What it does:** When a **client** adds or changes notes/photos on a visit, staff get the in-app bell. Also adds a fallback path when the client is signed in but doesn’t have the appointment manage token.

**After:** Book as a test client → add a note on an upcoming visit → staff app should show the alert.

---

## 2. Cancel/reschedule window — server wall

**File:** `cancel-window-guard-2026-07-08.sql`

**What it does:** Blocks **public** (booking-page) cancels or time moves inside your change window. Staff can still move/cancel anything. The app already enforces this in the UI; this is the real wall behind it.

**After:** No visible UI change unless someone tries to cheat the window via a direct API call.

---

## How to run

1. Open [Supabase](https://supabase.com/dashboard) → your Vero project  
2. **SQL Editor** → **New query**  
3. Open the `.sql` file from this repo in a text editor, copy all, paste, **Run**  
4. Repeat for the second file  

If anything errors, copy the full error message to Claude — don’t guess.
