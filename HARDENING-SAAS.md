# 🔵 Hardening — Track B: Multi-Tenant SaaS (sell Vero to other shops)

**Purpose:** make Vero safe to sell to many independent shops.
**Do:** later (after your own shop is live). **Owner:** Dan. **Driver:** Claude.

> ⚠️ **Track B includes all of Track A first.** You cannot run a multi-tenant SaaS without the single-shop fundamentals in `HARDENING-SHOP.md`. Finish Track A, then add the layer below. Nothing in Track A is wasted — it's the first half of Track B.

## Status legend
`✅ done` · `🔶 in progress` · `🟦 next` · `🟨 queued` · `☐ not started`

## Overall: ~5%  ▓░░░░░░░░░

| Status | Item | Why it's multi-tenant-only |
|---|---|---|
| ✅ | Audit + threat model | Done |
| ☐ | **Prereq:** complete all of Track A | Foundation |
| ☐ | Tenant isolation — enforce RLS from session; remove URL-trusted `shop_id` + `'sanctuary'` fallback | Stops one shop reading another's data |
| ☐ | Cross-tenant payment scoping (charge/refund bound to caller's shop) | Stops one shop refunding another's money |
| ☐ | Server-enforced authorization (not UI-only roles) | Stops staff self-escalating to owner |
| ☐ | Tenant-signup abuse controls | Stops spam/squatter shops |
| ☐ | SaaS billing (Stripe Billing, trials, dunning, entitlements) | How you actually get paid |
| ☐ | Multi-tenant legal (DPA, Vero ToS/Privacy, tenant-templated client policies, DSAR export/delete, retention) | Required to hold other shops' customer data |
| ☐ | Per-tenant SMS branding + 10DLC model | One campaign can't represent many brands |
| ☐ | Scalability (windowed data loads, virtualized lists, cron fan-out, realtime deltas) | Survive thousands of shops |
| ☐ | Accessibility (ADA) pass | Legal exposure at scale |

## Diagnostics log
- _(cross-tenant isolation test results recorded here)_
