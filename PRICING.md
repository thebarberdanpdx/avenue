# 💈 Vero — Pricing (sell-to-other-shops plan)

_Plain-English pricing sheet. Decided with Dan, 2026-06-26. This is Track B (selling Vero to other shops) — not needed to open Dan's own shop. Money model = **monthly subscription only** (no payment %, though a quiet ~0.25% card markup is an optional future lever — see bottom)._

---

## The plans — priced **per location**, by how many chairs that location has

| Plan | Chairs at that location | Price / month | Your cost to run | Your margin |
|---|---|---|---|---|
| **Solo** | 1 barber | **$29** | ~$8 | **~$21** |
| **Duo** | 2–3 barbers | **$59** | ~$15 | **~$44** |
| **Shop** | 4–6 barbers | **$89** | ~$30 | **~$59** |
| **Big Shop** | 7–10 barbers | **$99** | ~$50 | **~$49** |
| **Custom** | 11+ barbers | let's talk | — | — |

_Costs assume texts ON (included) at modest scale. They DROP as you grow — the shared ~$60–100/mo platform overhead spreads across more shops, so per-shop cost falls toward ~$1–2 plus that shop's text bill. So these margins are the floor, not the ceiling._

- **Each price is for ONE location.** The chair count is how many barbers work at that one shop.
- A 2-person and a 3-person shop both pay the **Duo $59** — no per-person math, just pick your size (like t-shirt sizes).
- _(Open decision: the Duo could drop to **$49** if Dan wants the solo→duo step to feel friendlier. Leaning $59.)_

## Got more than one shop? — **per location, 10% off each extra**
Each location pays for its own size. Knock **10% off every location after the first.**

**Example — 3 Big Shops (8 chairs each):**
- Location 1: $99
- Location 2: $99 − 10% = $89
- Location 3: $99 − 10% = $89
- **Total: $277 / month**

(Each location's text bill is separate, so 3 shops = 3× the cost AND 3× the price — it always covers expenses.)

## It grows with you
Start solo at **$29.** Add a barber (like Dan added Heather) and Vero steps up to the next plan **automatically** — like adding a line to a phone plan. Stripe charges the small difference for the rest of the month, then bills the new rate. A barber leaves? It steps back down. **You never pay for chairs you don't have.**

## What every plan includes
- Your own booking page + calendar
- Client list with notes, photos, history
- **Automatic text + email reminders** (texts included — fair-use ~3,000/mo, which almost no shop ever reaches)
- Card payments built in
- Reports
- The iPhone app

## The pitch (kid-simple)
> "Vero is like Netflix for running your barbershop. A little each month and you get everything — booking page, calendar, client list, and automatic text reminders so people show up. The bigger your shop, the bigger the plan. Costs way less than Mangomint and looks nicer."

---

## Why these numbers (the business case)
- **Cost to run one shop:** Solo ~$7–10/mo · Big Shop ~$35–55/mo. The whole difference is **text messages** — every text costs ~2.4¢, and a busy 8-chair shop sends ~5,000/mo. That's why big shops pay more.
- **Margin stays healthy at every tier** (Duo costs ~$15 to run / charge $59; Big Shop costs ~$50 / charge $99).
- **Market position:** premium tools (Mangomint, Boulevard) charge **$165–410**. Barber tools (Squire, Booksy) sit **$30–90**. Nothing polished lives between $60–165 → Vero's lane is **"premium feel, mid-market price."**

## Optional future lever — quiet card markup
A ~0.25% slice of each card payment, baked invisibly into a normal-looking processing rate (legal + standard — Square/Booksy/Mangomint all do it). Requires building **Stripe Connect** (already Track B item #2). Use "Express" Connect to keep the slice invisible. Not day-one; it's the easy future margin if texts get expensive at scale. **One rule:** never *claim* "no markup" — bundling is fine, lying isn't. Put one line in the Terms: _"Vero may receive a portion of processing fees."_
