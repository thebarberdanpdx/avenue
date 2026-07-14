// Paginated "load every row" for Supabase/PostgREST.
//
// WHY THIS EXISTS: PostgREST returns AT MOST 1000 rows from a .select() by
// default (Supabase's hard cap). Any query that means "give me every row for
// this shop" silently stops at 1000 — no error, no warning. That is exactly
// how a 2,973-client shop only showed ~1,000 clients in the staff list, and
// how appointment / notify / reminder / iCal / refund-match scans quietly
// dropped everything past the first 1,000 rows as the shop grew.
//
// A PostgREST filter builder is single-use (it's thenable — awaiting it fires
// the request), so you CANNOT call .range() on the same object twice. Pass a
// FACTORY that builds a fresh query each call. Include a stable .order() (by the
// primary key "id") in the factory so LIMIT/OFFSET paging can't skip or repeat
// a row between pages.
//
//   const { data, error } = await selectAllRows(() =>
//     supabase.from("clients").select("data").eq("shop_id", shop).order("id"));
//
// Returns the same { data, error } shape callers already destructure. On error
// it returns whatever pages succeeded plus the error, so a caller that ignores
// the error still degrades to "some rows" rather than throwing.
export const PGREST_PAGE = 1000;

export async function selectAllRows(makeQuery, pageSize = PGREST_PAGE) {
  const all = [];
  let from = 0;
  // Backstop against a pathological non-terminating loop (page always full):
  // 100k pages × 1k = 100M rows, far beyond any real shop, but never infinite.
  for (let page = 0; page < 100000; page++) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) return { data: all, error };
    const batch = data || [];
    for (const row of batch) all.push(row);
    if (batch.length < pageSize) return { data: all, error: null };
    from += pageSize;
  }
  return { data: all, error: null };
}
