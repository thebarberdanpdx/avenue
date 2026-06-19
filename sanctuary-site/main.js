/* Site behavior: render announcements, banner, nav, reveals. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) =>
    String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---- announcement bar ---- */
  function renderBanner() {
    const bar = $("#bar");
    const b = window.SBC.getBanner();
    const dismissed = sessionStorage.getItem("sbc_bar_dismissed") === "1";
    if (!b || !b.enabled || !b.text || dismissed) {
      bar.hidden = true;
      bar.classList.add("hidden");
      return;
    }
    $("#bar-text").innerHTML = esc(b.text);
    const link = $("#bar-link");
    if (b.linkLabel && b.link) {
      link.textContent = b.linkLabel;
      link.setAttribute("href", b.link);
      link.style.display = "";
    } else {
      link.style.display = "none";
    }
    bar.hidden = false;
    bar.classList.remove("hidden");
  }
  $("#bar-close").addEventListener("click", () => {
    sessionStorage.setItem("sbc_bar_dismissed", "1");
    $("#bar").classList.add("hidden");
  });

  /* ---- announcements list ---- */
  function renderPosts() {
    const list = $("#ann-list");
    const posts = window.SBC.getPosts();
    if (!posts.length) {
      list.innerHTML = '<p class="ann-empty">No announcements just yet — check back soon.</p>';
      return;
    }
    list.innerHTML = posts
      .map((p) => {
        const initial = "D";
        return `
        <article class="post${p.pinned ? " pinned" : ""}">
          <div class="meta">
            <span class="pill">${esc(p.tag || "News")}</span>
            <span class="date">${esc(window.SBC.fmtDate(p.date))}</span>
          </div>
          <h3>${esc(p.title)}</h3>
          <p>${esc(p.body)}</p>
          <div class="byline"><span class="av">${initial}</span> Posted by Dan &amp; Heather</div>
        </article>`;
      })
      .join("");
  }

  /* ---- build your visit ---- */
  (function initBuilder() {
    const rows = [...document.querySelectorAll("#menu .svc")];
    const chips = $("#builder-chips");
    const label = $("#builder-label");
    const book = $("#builder-book");
    if (!rows.length || !label || !book) return;
    const selected = new Set();

    function update() {
      const items = rows.filter((r) => selected.has(r.dataset.id));
      if (!items.length) {
        label.textContent = "Select the services you'd like and we'll total your visit.";
        chips.innerHTML = "";
        book.textContent = "Book your appointment";
        return;
      }
      let price = 0,
        dur = 0;
      items.forEach((r) => {
        price += Number(r.dataset.price) || 0;
        dur += Number(r.dataset.dur) || 0;
      });
      chips.innerHTML = items.map((r) => `<span class="builder-chip">${esc(r.dataset.name)}</span>`).join("");
      label.innerHTML = `Your visit · <strong>$${price}</strong> · approx. ${dur} min`;
      book.textContent = `Book your visit · $${price}`;
    }

    rows.forEach((r) => {
      const toggle = () => {
        const id = r.dataset.id;
        const on = !selected.has(id);
        on ? selected.add(id) : selected.delete(id);
        r.classList.toggle("sel", on);
        r.setAttribute("aria-pressed", String(on));
        update();
      };
      r.addEventListener("click", toggle);
      r.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      });
    });
    update();
  })();

  /* ---- header scroll state ---- */
  const header = $("#header");
  const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---- mobile menu ---- */
  const toggle = $("#nav-toggle");
  const menu = $("#mobile-menu");
  toggle.addEventListener("click", () => {
    const open = menu.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  menu.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      menu.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    })
  );

  /* ---- scroll reveal ---- */
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  /* ---- re-render if the editor saved in another tab ---- */
  window.addEventListener("storage", (e) => {
    if (e.key === "sbc_site_v1") {
      renderBanner();
      renderPosts();
    }
  });

  renderBanner();
  renderPosts();
})();
