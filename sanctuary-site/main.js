/* ============================================================
   Sanctuary Barber Co — site behavior.
   Renders the banner + announcements from window.SBC (data.js),
   powers the "build your visit" menu, nav, scroll reveals, and
   cross-tab refresh. Vanilla JS, no build step.
   ============================================================ */
(function () {
  "use strict";

  var STORE_KEY = "sbc_site_v1"; // matches data.js / admin.js
  var BANNER_DISMISS_KEY = "sbc_banner_dismissed";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------------------------------------------------
     BANNER
  --------------------------------------------------------- */
  function bannerSignature(b) {
    // Used so a re-enabled / re-edited banner reappears after dismissal.
    return [b && b.enabled ? "1" : "0", (b && b.text) || "", (b && b.link) || ""].join("|");
  }

  function renderBanner() {
    var el = $("#banner");
    if (!el || !window.SBC) return;

    var b = (window.SBC.getBanner && window.SBC.getBanner()) || {};
    var text = (b.text || "").trim();

    if (!b.enabled || !text) {
      el.hidden = true;
      return;
    }

    // Honor dismissal only for this exact banner content (per session).
    var dismissed = sessionStorage.getItem(BANNER_DISMISS_KEY);
    if (dismissed && dismissed === bannerSignature(b)) {
      el.hidden = true;
      return;
    }

    $("#banner-text").textContent = text;

    var linkEl = $("#banner-link");
    var label = (b.linkLabel || "").trim();
    var href = (b.link || "").trim();
    if (label && href) {
      linkEl.textContent = label;
      linkEl.setAttribute("href", href);
      linkEl.hidden = false;
    } else {
      linkEl.hidden = true;
      linkEl.removeAttribute("href");
    }

    el.hidden = false;

    var dismissBtn = $("#banner-dismiss");
    if (dismissBtn && !dismissBtn.dataset.bound) {
      dismissBtn.dataset.bound = "1";
      dismissBtn.addEventListener("click", function () {
        var cur = (window.SBC.getBanner && window.SBC.getBanner()) || {};
        sessionStorage.setItem(BANNER_DISMISS_KEY, bannerSignature(cur));
        el.hidden = true;
      });
    }
  }

  /* ---------------------------------------------------------
     ANNOUNCEMENTS ("What's new")
  --------------------------------------------------------- */
  function renderPosts() {
    var list = $("#posts");
    if (!list || !window.SBC) return;

    var posts = (window.SBC.getPosts && window.SBC.getPosts()) || [];

    if (!posts.length) {
      list.innerHTML = '<li class="posts-empty">Nothing new just now.</li>';
      return;
    }

    list.innerHTML = posts
      .map(function (p) {
        var date = window.SBC.fmtDate ? window.SBC.fmtDate(p.date) : p.date;
        var pinned = !!p.pinned;
        return (
          '<li class="post' + (pinned ? " pinned" : "") + '">' +
            '<div class="post-aside">' +
              '<span class="post-tag">' + esc(p.tag || "News") + "</span>" +
              '<span class="post-date">' + esc(date) + "</span>" +
              (pinned
                ? '<span class="post-pin"><i class="ti ti-pin" aria-hidden="true"></i> Pinned</span>'
                : "") +
            "</div>" +
            '<div class="post-main">' +
              '<h3 class="post-title">' + esc(p.title) + "</h3>" +
              '<p class="post-body">' + esc(p.body) + "</p>" +
            "</div>" +
          "</li>"
        );
      })
      .join("");
  }

  /* ---------------------------------------------------------
     BUILD YOUR VISIT
  --------------------------------------------------------- */
  function money(n) { return "$" + n; }

  function durationLabel(mins) {
    if (mins < 60) return mins + " min";
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    var hr = h + (h === 1 ? " hr" : " hrs");
    return m ? hr + " " + m + " min" : hr;
  }

  function setupMenu() {
    var rows = $$(".menu-row");
    if (!rows.length) return;

    var summaryList = $("#summary-list");
    var summaryTotal = $("#summary-total");
    var priceEl = $("#summary-price");
    var timeEl = $("#summary-time");
    var reserveBtns = [$("#reserve-summary"), $("#reserve-hero"), $("#reserve-footer")].filter(Boolean);
    var navReserve = $(".nav-reserve");
    if (navReserve) reserveBtns.push(navReserve);

    var baseLabels = reserveBtns.map(function (b) { return b.textContent.trim(); });

    function update() {
      var selected = rows.filter(function (r) { return r.getAttribute("aria-pressed") === "true"; });

      // Summary list
      if (!selected.length) {
        summaryList.innerHTML = '<li class="summary-empty">Nothing selected yet — tap a service to begin.</li>';
        summaryTotal.hidden = true;
      } else {
        summaryList.innerHTML = selected
          .map(function (r) {
            var name = r.getAttribute("data-name") || "";
            var price = parseInt(r.getAttribute("data-price"), 10) || 0;
            return (
              '<li class="summary-line">' +
                '<span class="s-name">' + esc(name) + "</span>" +
                '<span class="s-price">' + money(price) + "</span>" +
              "</li>"
            );
          })
          .join("");
        summaryTotal.hidden = false;
      }

      // Totals
      var totalPrice = 0;
      var totalMin = 0;
      selected.forEach(function (r) {
        totalPrice += parseInt(r.getAttribute("data-price"), 10) || 0;
        totalMin += parseInt(r.getAttribute("data-dur"), 10) || 0;
      });

      if (priceEl) priceEl.textContent = money(totalPrice);
      if (timeEl) timeEl.textContent = totalMin ? "About " + durationLabel(totalMin) + " in the chair." : "";

      // Reserve button labels reflect the selection.
      reserveBtns.forEach(function (btn, i) {
        var base = baseLabels[i] || "Reserve your chair";
        btn.textContent = selected.length ? base + " · " + money(totalPrice) : base;
      });
    }

    function toggle(row) {
      var on = row.getAttribute("aria-pressed") === "true";
      row.setAttribute("aria-pressed", on ? "false" : "true");
      update();
    }

    rows.forEach(function (row) {
      row.addEventListener("click", function () { toggle(row); });
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          toggle(row);
        }
      });
    });

    update();
  }

  /* ---------------------------------------------------------
     HEADER SCROLL STATE
  --------------------------------------------------------- */
  function setupHeader() {
    var header = $("#header");
    if (!header) return;
    var onScroll = function () {
      if (window.scrollY > 12) header.classList.add("scrolled");
      else header.classList.remove("scrolled");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------------------------------------------------------
     MOBILE MENU
  --------------------------------------------------------- */
  function setupMenu_mobile() {
    var toggle = $("#menu-toggle");
    var nav = $("#nav");
    var backdrop = $("#menu-backdrop");
    if (!toggle || !nav) return;

    function open() {
      nav.classList.add("open");
      if (backdrop) backdrop.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "Close menu");
    }
    function close() {
      nav.classList.remove("open");
      if (backdrop) backdrop.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open menu");
    }

    toggle.addEventListener("click", function () {
      if (nav.classList.contains("open")) close();
      else open();
    });
    if (backdrop) backdrop.addEventListener("click", close);
    $$(".nav a").forEach(function (a) { a.addEventListener("click", close); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("open")) close();
    });
  }

  /* ---------------------------------------------------------
     SMOOTH ANCHOR SCROLL (with sticky-header offset)
  --------------------------------------------------------- */
  function setupAnchors() {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    $$('a[href^="#"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        var id = a.getAttribute("href");
        if (!id || id === "#") return;
        var target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        var headerH = 78;
        var y = target.getBoundingClientRect().top + window.scrollY - headerH;
        window.scrollTo({ top: y < 0 ? 0 : y, behavior: reduce ? "auto" : "smooth" });
      });
    });
  }

  /* ---------------------------------------------------------
     SCROLL REVEAL
  --------------------------------------------------------- */
  function setupReveal() {
    var els = $$(".reveal");
    if (!els.length) return;

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("in"); });
      return;
    }

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------------------------------------------------------
     MISC
  --------------------------------------------------------- */
  function setYear() {
    var y = $("#footer-year");
    if (y) y.textContent = new Date().getFullYear();
  }

  // Re-render store-driven content if another tab updates the store.
  function setupStorageSync() {
    window.addEventListener("storage", function (e) {
      if (e.key === STORE_KEY || e.key === null) {
        renderBanner();
        renderPosts();
      }
    });
  }

  /* ---------------------------------------------------------
     INIT
  --------------------------------------------------------- */
  function init() {
    renderBanner();
    renderPosts();
    setupMenu();
    setupHeader();
    setupMenu_mobile();
    setupAnchors();
    setupReveal();
    setupStorageSync();
    setYear();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
