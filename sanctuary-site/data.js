/* ============================================================
   Announcements store
   ------------------------------------------------------------
   This is the ONE place announcements live. The website (main.js)
   reads from here; the editor (admin.js) writes to here.

   For now it persists to the browser's localStorage so you can
   demo the full "post a message → it appears on the site" loop
   with zero backend. To make posts visible to every visitor on
   every device, swap the two functions at the bottom for Supabase
   calls (see README.md → "Going live"). Nothing else changes.
   ============================================================ */
(function () {
  const KEY = "sbc_site_v1";

  // Seed content — used the first time, and as a reset fallback.
  const SEED = {
    banner: {
      enabled: true,
      text: "Holiday hours: closed July 4th — book early, slots are filling fast.",
      link: "#book",
      linkLabel: "Book now",
    },
    posts: [
      {
        id: "p1",
        tag: "News",
        date: "2026-06-16",
        title: "Summer Saturdays are back",
        body: "We've opened more Saturday morning slots through August. They go quick — if you've got a wedding or trip coming up, grab your spot now.",
        pinned: true,
      },
      {
        id: "p2",
        tag: "Update",
        date: "2026-06-02",
        title: "New hot towel facial add-on",
        body: "By popular request, our hot towel facial is now available as a stand-alone visit. Twenty quiet minutes, warm towels, and you walk out brand new.",
        pinned: false,
      },
      {
        id: "p3",
        tag: "Thank you",
        date: "2026-05-20",
        title: "400 five-star reviews — thank you",
        body: "We just crossed 400 all five-star Google reviews. Every one means the world to a small husband-and-wife shop. Thank you.",
        pinned: false,
      },
    ],
  };

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(SEED);
      const parsed = JSON.parse(raw);
      // shallow guard so a malformed value can't break the page
      if (!parsed || !Array.isArray(parsed.posts)) return structuredClone(SEED);
      return parsed;
    } catch {
      return structuredClone(SEED);
    }
  }

  function write(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function sortPosts(posts) {
    return [...posts].sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return (b.date || "").localeCompare(a.date || "");
    });
  }

  // Public API used by the site + editor.
  window.SBC = {
    SEED,
    getState: read,
    saveState: write,
    getPosts: () => sortPosts(read().posts),
    getBanner: () => read().banner,
    reset: () => write(structuredClone(SEED)),
    sortPosts,
    fmtDate(iso) {
      if (!iso) return "";
      const [y, m, d] = iso.split("-").map(Number);
      const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      if (!y || !m || !d) return iso;
      return `${months[m - 1]} ${d}, ${y}`;
    },
  };
})();
