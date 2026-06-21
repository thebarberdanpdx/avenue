// Returns the CURRENTLY-DEPLOYED app version. Never cached, so a stale (cached) app
// can ask "what's live?" and compare to the version baked into its own bundle. If they
// differ, the app knows it's running old code and refreshes itself. See the version
// check in App.jsx. Source: Vercel's per-deployment git SHA (falls back to the unique
// deployment URL, then 'dev' for local).
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  res.setHeader("Access-Control-Allow-Origin", "*");
  const version = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_URL || "dev";
  res.status(200).json({
    version,
    sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    url: process.env.VERCEL_URL || null,
  });
}
