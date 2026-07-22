# Pending SQL — run in Supabase (Dan)

Paste each file **once** into the Supabase dashboard → **SQL Editor** → **Run**.

Order does not matter. If a line says `already exists`, that’s fine — stop and tell Claude.

---

## 0. ⚠️ URGENT — new clients can't book on synced days (go-live blocker)

**File:** `fix-newclient-cap-sync-2026-07-22.sql`

**What it does:** Your "new clients per day" limit was counting every appointment synced from your old calendar as a "new client," so any day with synced appointments looked over the limit — and every brand-new client got rejected when they tried to book (this is the error Heather hit on July 31). This fix makes the limit count only real online bookings.

**After:** A brand-new client can book a Thursday/Friday again (your cap of 2 then works as intended).

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
