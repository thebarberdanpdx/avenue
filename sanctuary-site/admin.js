/* Announcements editor — reads/writes the same store the site uses. */
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function flash(el) {
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 1800);
  }

  function uid() {
    return "p" + Math.random().toString(36).slice(2, 9);
  }

  /* ---- banner ---- */
  function loadBanner() {
    const b = window.SBC.getBanner() || {};
    $("#b-enabled").checked = !!b.enabled;
    $("#b-text").value = b.text || "";
    $("#b-linklabel").value = b.linkLabel || "";
    $("#b-link").value = b.link || "";
  }
  $("#save-banner").addEventListener("click", () => {
    const state = window.SBC.getState();
    state.banner = {
      enabled: $("#b-enabled").checked,
      text: $("#b-text").value.trim(),
      linkLabel: $("#b-linklabel").value.trim(),
      link: $("#b-link").value.trim(),
    };
    window.SBC.saveState(state);
    flash($("#banner-saved"));
  });

  /* ---- posts ---- */
  function resetEditor() {
    $("#editor-title").textContent = "New announcement";
    $("#p-id").value = "";
    $("#p-title").value = "";
    $("#p-body").value = "";
    $("#p-tag").value = "News";
    $("#p-date").value = todayISO();
    $("#p-pinned").checked = false;
    $("#save-post").textContent = "Publish";
    $("#cancel-edit").style.display = "none";
  }

  function todayISO() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  $("#save-post").addEventListener("click", () => {
    const title = $("#p-title").value.trim();
    const body = $("#p-body").value.trim();
    if (!title || !body) {
      alert("Please add a title and a message.");
      return;
    }
    const state = window.SBC.getState();
    const id = $("#p-id").value || uid();
    const post = {
      id,
      title,
      body,
      tag: $("#p-tag").value,
      date: $("#p-date").value.trim() || todayISO(),
      pinned: $("#p-pinned").checked,
    };
    const i = state.posts.findIndex((p) => p.id === id);
    if (i >= 0) state.posts[i] = post;
    else state.posts.unshift(post);
    window.SBC.saveState(state);
    resetEditor();
    renderList();
    flash($("#post-saved"));
  });

  $("#cancel-edit").addEventListener("click", resetEditor);

  function edit(id) {
    const p = window.SBC.getState().posts.find((x) => x.id === id);
    if (!p) return;
    $("#editor-title").textContent = "Edit announcement";
    $("#p-id").value = p.id;
    $("#p-title").value = p.title;
    $("#p-body").value = p.body;
    $("#p-tag").value = p.tag || "News";
    $("#p-date").value = p.date || "";
    $("#p-pinned").checked = !!p.pinned;
    $("#save-post").textContent = "Save changes";
    $("#cancel-edit").style.display = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function remove(id) {
    if (!confirm("Delete this announcement?")) return;
    const state = window.SBC.getState();
    state.posts = state.posts.filter((p) => p.id !== id);
    window.SBC.saveState(state);
    renderList();
  }

  function togglePin(id) {
    const state = window.SBC.getState();
    const p = state.posts.find((x) => x.id === id);
    if (p) p.pinned = !p.pinned;
    window.SBC.saveState(state);
    renderList();
  }

  function renderList() {
    const posts = window.SBC.getPosts();
    const list = $("#plist");
    if (!posts.length) {
      list.innerHTML = '<li style="color:var(--faint);padding:8px 0">No announcements yet.</li>';
      return;
    }
    list.innerHTML = posts
      .map(
        (p) => `
      <li class="pitem">
        <div class="body">
          <span class="ptag">${esc(p.tag || "News")}</span>
          <h3>${esc(p.title)}</h3>
          <span class="pdate"> · ${esc(window.SBC.fmtDate(p.date))}</span>
          <p>${esc(p.body)}</p>
          ${p.pinned ? '<span class="pinflag"><i class="ti ti-pin"></i> Pinned to top</span>' : ""}
        </div>
        <div class="ctl">
          <button data-act="edit" data-id="${p.id}" title="Edit" aria-label="Edit"><i class="ti ti-edit"></i></button>
          <button data-act="pin" data-id="${p.id}" title="Pin/unpin" aria-label="Pin"><i class="ti ti-pin"></i></button>
          <button data-act="del" data-id="${p.id}" title="Delete" aria-label="Delete"><i class="ti ti-trash"></i></button>
        </div>
      </li>`
      )
      .join("");
    list.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.dataset.id;
        if (b.dataset.act === "edit") edit(id);
        else if (b.dataset.act === "del") remove(id);
        else if (b.dataset.act === "pin") togglePin(id);
      })
    );
  }

  $("#storage-note").innerHTML =
    "<strong>Where this saves:</strong> right now announcements live in this browser (a demo store) so you can try the full loop. " +
    "To make them visible to every visitor on every device, we connect this to a shared database (see README → Going live). The editor stays exactly the same.";

  loadBanner();
  resetEditor();
  renderList();
})();
