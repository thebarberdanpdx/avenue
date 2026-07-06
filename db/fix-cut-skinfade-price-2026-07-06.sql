-- ── FIX: "Haircut" skin-fade double-charged ($89 / 85 min instead of $47 / 45) ──
--
-- The "Haircut" service (id = 'cut') carries a library question, "Choose your cut",
-- with answers Standard / Skin Fade / Transformation. The booking engine ADDS a
-- chosen answer's price + time on TOP of the base service (that's how add-on answers
-- are meant to work — e.g. "Transformation +$10").
--
-- But this service's PER-BARBER answer overrides were stored as FULL prices, not
-- extras:  dan skinfade answerPrice = 47, answerDur = 45.  So the engine computed
--   base $42 + $47 = $89  and  40 min + 45 min = 85 min.
--
-- Correct model = deltas (the "extra" over the base):
--   Standard      → +$0  / +0 min   → $42 / 40 min   (base, no upcharge)
--   Skin Fade     → +$5  / +5 min   → $47 / 45 min
--   Transformation→ +$10 / +10 min  → $52 / 50 min   (already the answer's own price)
--
-- Fix: set each barber's Skin Fade override to the +$5 / +5 min DELTA, and drop the
-- Standard / Transformation overrides so they fall back to the answer's own values
-- (0 / 0 and 10 / 10). Only the 'skinfade' key is kept, as the +5 delta.
--
-- This is a DATA fix only — the pricing engine is untouched. It corrects both the
-- price the client is quoted online AND the price locked onto the appointment, so
-- checkout and every report agree at $47. Nothing else on the service is changed.
--
-- Run once in the Supabase SQL editor. Transactional. Safe to re-run (idempotent).

begin;

update services
set data = jsonb_set(
             jsonb_set(
               jsonb_set(
                 jsonb_set(
                   data,
                   '{staff,dan,answerPrice,libq-q178294805869715fula4}',     '{"skinfade":5}'::jsonb, true),
                 '{staff,dan,answerDur,libq-q178294805869715fula4}',         '{"skinfade":5}'::jsonb, true),
               '{staff,heather,answerPrice,libq-q178294805869715fula4}',     '{"skinfade":5}'::jsonb, true),
             '{staff,heather,answerDur,libq-q178294805869715fula4}',         '{"skinfade":5}'::jsonb, true)
where id = 'cut';

-- Show the corrected per-barber overrides so you can eyeball them before committing.
select id,
       data->'staff'->'dan'->'answerPrice'->'libq-q178294805869715fula4'     as dan_price,
       data->'staff'->'dan'->'answerDur'->'libq-q178294805869715fula4'       as dan_dur,
       data->'staff'->'heather'->'answerPrice'->'libq-q178294805869715fula4' as heather_price,
       data->'staff'->'heather'->'answerDur'->'libq-q178294805869715fula4'   as heather_dur
from services
where id = 'cut';

commit;
