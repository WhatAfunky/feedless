// Feedless — a private, offline practice feed. Nothing here ever leaves this device.
(() => {
  "use strict";

  const BG_SWATCHES = ["#1a1a2e", "#7c5cff", "#ff5c8a", "#ffb703", "#06a77d", "#2176ff", "#e63946", "#111111", "#ffffff"];
  const TEXT_SWATCHES = ["#ffffff", "#111111", "#ffb703", "#ff5c8a", "#7c5cff", "#06a77d", "#2176ff", "#e63946"];
  const SIZE_STEPS = [16, 20, 26, 32, 40, 50];
  const MIN_PHOTO_SCALE = 1;
  const MAX_PHOTO_SCALE = 3;
  const DEFAULT_PHOTO_SCALE = 1.15;
  const ENGAGEMENT_CAP = 9999; // hard ceiling — never shows 10k or more

  const ICONS = {
    reply: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M3 4.5h18v12H8.5L4 20.5V16.5H3z"/></svg>',
    retweet: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4.5 7h11l-2.5-2.5M4.5 7L7 9.5M19.5 17h-11l2.5 2.5M19.5 17L17 14.5"/></svg>',
    like: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" d="M12 20.3S3.5 15.4 3.5 9.3A4.8 4.8 0 0112 6.2a4.8 4.8 0 018.5 3.1c0 6.1-8.5 11-8.5 11z"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3.5v11M8 7.5l4-4 4 4M5 20.5h14"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M6 3.5h12v17l-6-4-6 4v-17z"/></svg>',
  };

  const $ = (id) => document.getElementById(id);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }

  function fmtTime(ts) {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return "now";
    if (min < 60) return min + "m";
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h";
    const day = Math.floor(hr / 24);
    if (day < 7) return day + "d";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function fmtDateLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const dayKey = d.toDateString();
    if (dayKey === today.toDateString()) return "Today";
    const yest = new Date(today); yest.setDate(yest.getDate() - 1);
    if (dayKey === yest.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function dayKeyOf(ts) { return new Date(ts).toDateString(); }

  function resizeImageFile(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => { img.src = reader.result; };
      reader.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round(height * (maxDim / width)); width = maxDim; }
        else if (height >= width && height > maxDim) { width = Math.round(width * (maxDim / height)); height = maxDim; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ===== State =====
  let profile = { name: "You", handle: "you", avatar: "" };
  let settings = { fakeEngagement: true };
  let stories = [];
  let tweets = [];
  let feedPosts = [];
  let activeTab = "instagram";
  let igSub = "stories";

  // story composer transient state
  let composerBg = { type: "color", color: BG_SWATCHES[0] };
  let composerTexts = []; // {id, text, color, sizeIdx, xPct, yPct}
  let selectedTextId = null;
  let swatchMode = null; // "bg" | "text"

  // story viewer transient state
  let viewerItems = [];
  let viewerIndex = 0;

  let pendingTweetImage = null;
  let feedComposerImage = null;

  function defaultAvatar(seedText) {
    const letter = (seedText || "Y").trim().charAt(0).toUpperCase() || "Y";
    const hue = hashStr(seedText || "Y") % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <rect width="100" height="100" fill="hsl(${hue},55%,45%)"/>
      <text x="50" y="58" font-size="46" font-family="sans-serif" fill="#fff" text-anchor="middle">${letter}</text>
    </svg>`;
    return "data:image/svg+xml;base64," + btoa(svg);
  }

  async function loadState() {
    profile = await DB.kvGet("profile", null) || { name: "You", handle: "you", avatar: "" };
    if (!profile.avatar) profile.avatar = defaultAvatar(profile.name);
    settings = await DB.kvGet("settings", null) || { fakeEngagement: true };
    stories = await DB.getAll("stories");
    tweets = await DB.getAll("tweets");
    feedPosts = await DB.getAll("feedPosts");
    stories.sort((a, b) => a.createdAt - b.createdAt);
    tweets.sort((a, b) => b.createdAt - a.createdAt);
    feedPosts.sort((a, b) => b.createdAt - a.createdAt);
  }

  function saveProfile() { return DB.kvSet("profile", profile); }
  function saveSettings() { return DB.kvSet("settings", settings); }

  // ===== Toast =====
  let toastTimer = null;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 1800);
  }

  // ===== Posting progress bar (fast, not instant) =====
  function showPostProgress() {
    return new Promise((resolve) => {
      const bar = $("postProgressBar");
      bar.style.transition = "none";
      bar.style.width = "0%";
      bar.style.opacity = "1";
      // force reflow so the width transition below actually animates from 0
      void bar.offsetWidth;
      requestAnimationFrame(() => {
        bar.style.transition = "width .4s cubic-bezier(.2,.8,.2,1)";
        bar.style.width = "100%";
      });
      setTimeout(() => {
        bar.style.transition = "opacity .22s ease";
        bar.style.opacity = "0";
        resolve();
      }, 420);
    });
  }

  // ===== Confirm dialog =====
  function confirmDialog(message) {
    return new Promise((resolve) => {
      const dlg = $("confirmDialog");
      $("confirmMessage").textContent = message;
      dlg.classList.remove("hidden");
      const onCancel = () => { cleanup(); resolve(false); };
      const onOk = () => { cleanup(); resolve(true); };
      function cleanup() {
        dlg.classList.add("hidden");
        $("confirmCancel").removeEventListener("click", onCancel);
        $("confirmOk").removeEventListener("click", onOk);
      }
      $("confirmCancel").addEventListener("click", onCancel);
      $("confirmOk").addEventListener("click", onOk);
    });
  }

  // ===== Profile rendering =====
  function renderProfile() {
    $("profileAvatar").src = profile.avatar;
    $("composerAvatar").src = profile.avatar;
    $("feedComposeAvatar").src = profile.avatar;
    $("settingsAvatarPreview").src = profile.avatar;
    $("nameInput").value = profile.name;
    $("handleInput").value = profile.handle;
    $("fakeEngagementToggle").checked = !!settings.fakeEngagement;
  }

  // ===== Tabs =====
  function playViewAnim(el) {
    if (!el) return;
    el.classList.remove("anim-in");
    void el.offsetWidth; // restart the animation each time
    el.classList.add("anim-in");
  }

  function updateTopbarTitle() {
    if (activeTab === "instagram") $("topbarTitle").textContent = igSub === "stories" ? "Stories" : "Feed";
    else $("topbarTitle").textContent = "Posts";
  }

  function setTab(tab) {
    activeTab = tab;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $("igView").classList.toggle("hidden", tab !== "instagram");
    $("tweetsView").classList.toggle("hidden", tab !== "twitter");
    document.body.classList.toggle("mode-tweets", tab === "twitter");
    updateTopbarTitle();
    playViewAnim(tab === "instagram" ? $("igView") : $("tweetsView"));
  }

  function setIgSub(sub) {
    igSub = sub;
    document.querySelectorAll(".ig-sub-btn").forEach((b) => b.classList.toggle("active", b.dataset.sub === sub));
    $("igStoriesPane").classList.toggle("hidden", sub !== "stories");
    $("igFeedPane").classList.toggle("hidden", sub !== "feed");
    updateTopbarTitle();
    playViewAnim(sub === "stories" ? $("igStoriesPane") : $("igFeedPane"));
  }

  // ===== Stories: ring =====
  function groupStoriesByDay() {
    const map = new Map();
    for (const s of stories) {
      const key = dayKeyOf(s.createdAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
    const groups = Array.from(map.entries()).map(([key, items]) => ({
      key,
      items: items.sort((a, b) => a.createdAt - b.createdAt),
      latest: Math.max(...items.map((i) => i.createdAt)),
    }));
    groups.sort((a, b) => b.latest - a.latest);
    return groups;
  }

  function thumbForStory(story) {
    if (story.bg.type === "photo") return story.bg.dataUrl;
    return null;
  }

  function renderRing() {
    const row = $("ringRow");
    row.querySelectorAll(".ring-item:not(.add-ring)").forEach((n) => n.remove());
    const groups = groupStoriesByDay();
    $("storiesEmpty").classList.toggle("hidden", stories.length > 0);
    for (const group of groups) {
      const last = group.items[group.items.length - 1];
      const thumb = thumbForStory(last);
      const btn = document.createElement("button");
      btn.className = "ring-item";
      btn.innerHTML = `
        <span class="ring-thumb-wrap">
          <span class="ring-thumb-inner">
            ${thumb ? `<img src="${thumb}" alt="" />` : `<span class="ring-thumb" style="background:${last.bg.color || "#333"}"></span>`}
          </span>
        </span>
        <span class="ring-label">${fmtDateLabel(group.latest)}</span>
      `;
      btn.addEventListener("click", () => openStoryViewer(group.items, 0));
      row.appendChild(btn);
    }
  }

  function renderArchiveGrid() {
    const grid = $("storyArchiveGrid");
    grid.innerHTML = "";
    const sorted = [...stories].sort((a, b) => b.createdAt - a.createdAt);
    for (const s of sorted) {
      const thumb = thumbForStory(s);
      const cell = document.createElement("button");
      cell.className = "archive-cell";
      cell.innerHTML = `
        ${thumb ? `<img src="${thumb}" alt="" />` : `<div style="width:100%;height:100%;background:${s.bg.color || "#333"}"></div>`}
        <span class="archive-date">${fmtDateLabel(s.createdAt)}</span>
      `;
      cell.addEventListener("click", () => openStoryViewer([s], 0));
      grid.appendChild(cell);
    }
  }

  // ===== Story viewer =====
  function openStoryViewer(items, startIndex) {
    viewerItems = items;
    viewerIndex = startIndex;
    $("storyViewer").classList.remove("hidden");
    renderViewerItem();
  }

  function closeStoryViewer() { $("storyViewer").classList.add("hidden"); }

  function renderViewerItem() {
    const story = viewerItems[viewerIndex];
    if (!story) { closeStoryViewer(); return; }

    const row = $("storyProgressRow");
    row.innerHTML = "";
    viewerItems.forEach((_, i) => {
      const seg = document.createElement("div");
      seg.className = "seg" + (i <= viewerIndex ? " done" : "");
      seg.innerHTML = '<div class="fill"></div>';
      row.appendChild(seg);
    });

    $("storyViewerAvatar").src = profile.avatar;
    $("storyViewerName").textContent = profile.name;
    $("storyViewerTime").textContent = fmtTime(story.createdAt);

    const stage = $("storyStageContent");
    stage.innerHTML = "";
    if (story.bg.type === "photo") {
      const img = document.createElement("img");
      img.className = "cover-photo";
      img.src = story.bg.dataUrl;
      img.style.transform = `translate(calc(-50% + ${story.bg.tx || 0}%), calc(-50% + ${story.bg.ty || 0}%)) scale(${story.bg.scale || 1})`;
      stage.appendChild(img);
      stage.style.background = "#111";
    } else {
      stage.style.background = story.bg.color;
    }

    for (const t of story.texts || []) {
      const el = document.createElement("div");
      el.className = "story-text-overlay";
      el.textContent = t.text;
      el.style.color = t.color;
      el.style.fontSize = (SIZE_STEPS[t.sizeIdx] || 26) + "px";
      el.style.left = t.xPct + "%";
      el.style.top = t.yPct + "%";
      el.style.transform = "translate(-50%, -50%)";
      stage.appendChild(el);
    }
  }

  function viewerNext() {
    if (viewerIndex < viewerItems.length - 1) { viewerIndex++; renderViewerItem(); }
    else closeStoryViewer();
  }
  function viewerPrev() {
    if (viewerIndex > 0) { viewerIndex--; renderViewerItem(); }
  }

  async function deleteCurrentStory() {
    const story = viewerItems[viewerIndex];
    if (!story) return;
    const ok = await confirmDialog("Delete this story? This can't be undone.");
    if (!ok) return;
    await DB.remove("stories", story.id);
    stories = stories.filter((s) => s.id !== story.id);
    viewerItems = viewerItems.filter((s) => s.id !== story.id);
    renderRing();
    renderArchiveGrid();
    if (viewerItems.length === 0) { closeStoryViewer(); return; }
    if (viewerIndex >= viewerItems.length) viewerIndex = viewerItems.length - 1;
    renderViewerItem();
    toast("Story deleted");
  }

  // ===== Story composer =====
  // Rendering strategy: renderComposerCanvas() does a FULL rebuild, and is only
  // called when the *set* of nodes changes (open, add text, delete text, pick a
  // photo, switch to a flat color). Selecting, recoloring, resizing and dragging
  // all mutate the DOM node in place instead of rebuilding — rebuilding while a
  // contenteditable text box has focus would yank the cursor out from under you,
  // which is why text used to be impossible to edit.

  function resetComposer() {
    composerBg = { type: "color", color: BG_SWATCHES[hashStr(String(Date.now())) % BG_SWATCHES.length] };
    composerTexts = [];
    selectedTextId = null;
    swatchMode = null;
    $("colorSwatchRow").classList.add("hidden");
    renderComposerCanvas();
  }

  function openStoryComposer() {
    resetComposer();
    $("storyComposer").classList.remove("hidden");
  }
  function closeStoryComposer() { $("storyComposer").classList.add("hidden"); }

  function photoTransform() {
    return `translate(calc(-50% + ${composerBg.tx}%), calc(-50% + ${composerBg.ty}%)) scale(${composerBg.scale})`;
  }

  function clampPhotoOffset() {
    const maxOff = Math.max(0, (composerBg.scale - 1) * 50);
    composerBg.tx = Math.max(-maxOff, Math.min(maxOff, composerBg.tx));
    composerBg.ty = Math.max(-maxOff, Math.min(maxOff, composerBg.ty));
  }

  function updateZoomButtons() {
    const show = composerBg.type === "photo";
    $("storyZoomOut").classList.toggle("hidden", !show);
    $("storyZoomIn").classList.toggle("hidden", !show);
  }

  function createTextNode(t) {
    const el = document.createElement("div");
    el.className = "story-text-item";
    el.contentEditable = "true";
    el.spellcheck = false;
    el.textContent = t.text;
    el.style.color = t.color;
    el.style.fontSize = (SIZE_STEPS[t.sizeIdx] || 26) + "px";
    el.style.left = t.xPct + "%";
    el.style.top = t.yPct + "%";
    el.style.transform = "translate(-50%, -50%)";
    el.dataset.id = t.id;

    el.addEventListener("pointerdown", (e) => startDragText(e, t));
    el.addEventListener("click", (e) => e.stopPropagation()); // selection handled in pointerup, not here
    el.addEventListener("input", () => { t.text = el.textContent; });
    el.addEventListener("blur", () => {
      if (!el.textContent.trim()) {
        composerTexts = composerTexts.filter((x) => x.id !== t.id);
        if (selectedTextId === t.id) selectedTextId = null;
        el.remove();
        removeToolbar();
      }
    });
    return el;
  }

  function renderComposerCanvas() {
    const canvas = $("storyCanvas");
    canvas.innerHTML = "";
    canvas.style.background = composerBg.type === "color" ? composerBg.color : "#000";
    if (composerBg.type === "photo") {
      const img = document.createElement("img");
      img.className = "bg-photo";
      img.src = composerBg.dataUrl;
      img.style.transform = photoTransform();
      img.addEventListener("pointerdown", startDragPhoto);
      canvas.appendChild(img);
    }
    updateZoomButtons();
    for (const t of composerTexts) canvas.appendChild(createTextNode(t));
    if (selectedTextId) {
      const el = canvas.querySelector(`.story-text-item[data-id="${selectedTextId}"]`);
      const t = composerTexts.find((x) => x.id === selectedTextId);
      if (el && t) { el.classList.add("selected"); appendToolbarFor(t); }
      else selectedTextId = null;
    }
  }

  // Swap just the background (photo <-> color) without touching text nodes.
  function applyBackgroundToCanvas() {
    const canvas = $("storyCanvas");
    const oldPhoto = canvas.querySelector(".bg-photo");
    if (oldPhoto) oldPhoto.remove();
    if (composerBg.type === "photo") {
      canvas.style.background = "#000";
      const img = document.createElement("img");
      img.className = "bg-photo";
      img.src = composerBg.dataUrl;
      img.style.transform = photoTransform();
      img.addEventListener("pointerdown", startDragPhoto);
      canvas.insertBefore(img, canvas.firstChild);
    } else {
      canvas.style.background = composerBg.color;
    }
    updateZoomButtons();
  }

  function removeToolbar() {
    $("storyCanvas").querySelector(".text-toolbar")?.remove();
  }

  function repositionToolbar(t) {
    const bar = $("storyCanvas").querySelector(".text-toolbar");
    if (!bar) return;
    bar.style.left = t.xPct + "%";
    bar.style.top = Math.max(6, t.yPct - 10) + "%";
  }

  function appendToolbarFor(t) {
    removeToolbar();
    const canvas = $("storyCanvas");
    const bar = document.createElement("div");
    bar.className = "text-toolbar";
    bar.style.position = "absolute";
    bar.style.left = t.xPct + "%";
    bar.style.top = Math.max(6, t.yPct - 10) + "%";
    bar.style.transform = "translate(-50%, -100%)";
    bar.style.display = "flex";
    bar.style.gap = "6px";
    bar.innerHTML = `
      <button data-act="smaller" class="chip-btn" style="padding:4px 10px;">A-</button>
      <button data-act="bigger" class="chip-btn" style="padding:4px 10px;">A+</button>
      <button data-act="delete" class="chip-btn" style="padding:4px 10px;">✕</button>
    `;
    bar.addEventListener("pointerdown", (e) => e.stopPropagation());
    bar.addEventListener("click", (e) => {
      e.stopPropagation();
      const act = e.target.closest("button")?.dataset.act;
      if (!act) return;
      const el = canvas.querySelector(`.story-text-item[data-id="${t.id}"]`);
      if (act === "smaller") { t.sizeIdx = Math.max(0, t.sizeIdx - 1); if (el) el.style.fontSize = SIZE_STEPS[t.sizeIdx] + "px"; }
      if (act === "bigger") { t.sizeIdx = Math.min(SIZE_STEPS.length - 1, t.sizeIdx + 1); if (el) el.style.fontSize = SIZE_STEPS[t.sizeIdx] + "px"; }
      if (act === "delete") {
        composerTexts = composerTexts.filter((x) => x.id !== t.id);
        selectedTextId = null;
        el?.remove();
        removeToolbar();
        $("colorSwatchRow").classList.add("hidden");
        swatchMode = null;
      }
    });
    canvas.appendChild(bar);
  }

  // Select (and, by default, focus + select-all so typing replaces placeholder text).
  function selectText(id, { focusEl = true } = {}) {
    const canvas = $("storyCanvas");
    if (selectedTextId === id) {
      if (focusEl) {
        const el = canvas.querySelector(`.story-text-item[data-id="${id}"]`);
        if (el && document.activeElement !== el) el.focus();
      }
      return;
    }
    canvas.querySelectorAll(".story-text-item.selected").forEach((n) => n.classList.remove("selected"));
    removeToolbar();
    selectedTextId = id;
    swatchMode = "text";
    renderSwatchRow();
    const el = canvas.querySelector(`.story-text-item[data-id="${id}"]`);
    const t = composerTexts.find((x) => x.id === id);
    if (!el || !t) return;
    el.classList.add("selected");
    appendToolbarFor(t);
    if (focusEl) {
      el.focus();
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (err) { /* ignore */ }
    }
  }

  function deselectAll() {
    if (!selectedTextId) return;
    const canvas = $("storyCanvas");
    canvas.querySelectorAll(".story-text-item.selected").forEach((n) => n.classList.remove("selected"));
    removeToolbar();
    selectedTextId = null;
  }

  function dismissEditors() {
    deselectAll();
    $("colorSwatchRow").classList.add("hidden");
    swatchMode = null;
  }

  function startDragText(e, t) {
    e.stopPropagation();
    const canvas = $("storyCanvas");
    const rect = canvas.getBoundingClientRect();
    const target = e.currentTarget;
    const startX = e.clientX, startY = e.clientY;
    const DRAG_THRESHOLD = 6;
    let dragging = false;

    function onMove(ev) {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        target.setPointerCapture?.(e.pointerId);
        selectText(t.id, { focusEl: false });
      }
      ev.preventDefault();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      t.xPct = Math.max(2, Math.min(98, (x / rect.width) * 100));
      t.yPct = Math.max(2, Math.min(98, (y / rect.height) * 100));
      target.style.left = t.xPct + "%";
      target.style.top = t.yPct + "%";
      repositionToolbar(t);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!dragging) selectText(t.id); // a plain tap: select + focus for editing
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startDragPhoto(e) {
    if (composerBg.type !== "photo") return;
    e.stopPropagation();
    const canvas = $("storyCanvas");
    const rect = canvas.getBoundingClientRect();
    const img = e.currentTarget;
    const startX = e.clientX, startY = e.clientY;
    const startTx = composerBg.tx, startTy = composerBg.ty;
    img.setPointerCapture?.(e.pointerId);
    img.style.cursor = "grabbing";

    function onMove(ev) {
      ev.preventDefault();
      composerBg.tx = startTx + ((ev.clientX - startX) / rect.width) * 100;
      composerBg.ty = startTy + ((ev.clientY - startY) / rect.height) * 100;
      clampPhotoOffset();
      img.style.transform = photoTransform();
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      img.style.cursor = "grab";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function zoomPhoto(delta) {
    if (composerBg.type !== "photo") return;
    composerBg.scale = Math.max(MIN_PHOTO_SCALE, Math.min(MAX_PHOTO_SCALE, composerBg.scale + delta));
    clampPhotoOffset();
    const img = $("storyCanvas").querySelector(".bg-photo");
    if (img) img.style.transform = photoTransform();
  }

  function addTextItem() {
    const t = { id: uid(), text: "Tap to edit", color: TEXT_SWATCHES[0], sizeIdx: 2, xPct: 50, yPct: 45 };
    composerTexts.push(t);
    const el = createTextNode(t);
    $("storyCanvas").appendChild(el);
    selectText(t.id);
  }

  function renderSwatchRow() {
    const row = $("colorSwatchRow");
    const list = swatchMode === "text" ? TEXT_SWATCHES : BG_SWATCHES;
    row.innerHTML = "";
    for (const c of list) {
      const b = document.createElement("button");
      b.className = "swatch";
      b.style.background = c;
      b.addEventListener("click", () => {
        if (swatchMode === "text" && selectedTextId) {
          const t = composerTexts.find((x) => x.id === selectedTextId);
          if (t) {
            t.color = c;
            const el = $("storyCanvas").querySelector(`.story-text-item[data-id="${t.id}"]`);
            if (el) el.style.color = c;
          }
        } else if (swatchMode === "bg") {
          composerBg = { type: "color", color: c };
          applyBackgroundToCanvas();
        }
      });
      row.appendChild(b);
    }
    row.classList.remove("hidden");
  }

  async function handleStoryPhotoFile(file) {
    if (!file) return;
    const dataUrl = await resizeImageFile(file, 1280, 0.85);
    composerBg = { type: "photo", dataUrl, scale: DEFAULT_PHOTO_SCALE, tx: 0, ty: 0 };
    applyBackgroundToCanvas();
  }

  async function shareStory() {
    if (composerBg.type === "color" && composerTexts.length === 0) {
      const ok = await confirmDialog("Post a plain color story with no text?");
      if (!ok) return;
    }
    $("storyShareBtn").disabled = true;
    await showPostProgress();
    const bg = composerBg.type === "photo"
      ? { type: "photo", dataUrl: composerBg.dataUrl, scale: composerBg.scale, tx: composerBg.tx, ty: composerBg.ty }
      : { type: "color", color: composerBg.color };
    const story = {
      id: uid(),
      createdAt: Date.now(),
      bg,
      texts: composerTexts.map((t) => ({ text: t.text, color: t.color, sizeIdx: t.sizeIdx, xPct: t.xPct, yPct: t.yPct })),
    };
    await DB.put("stories", story);
    stories.push(story);
    stories.sort((a, b) => a.createdAt - b.createdAt);
    renderRing();
    renderArchiveGrid();
    closeStoryComposer();
    $("storyShareBtn").disabled = false;
    const newBubble = $("ringRow").children[1];
    if (newBubble) newBubble.classList.add("pop-in");
    toast("Posted to your story");
  }

  // ===== Fake engagement — starts near zero, creeps up slowly, always under 10k =====
  function engagementPotential(id) {
    const seed = hashStr(id);
    const base = 8 + (seed % 180);                                    // most posts: modest
    const viral = (seed % 37 === 0) ? (300 + (seed % 9600)) : 0;        // rare: a "viral" one
    return Math.min(ENGAGEMENT_CAP, base + viral);
  }

  function engagementGrowth(createdAt) {
    const elapsedHours = Math.max(0, (Date.now() - createdAt) / 3600000);
    return 1 - Math.exp(-elapsedHours / 2.5); // 0 at post-time, ~63% by 2.5h, ~95% by ~7.5h
  }

  function engagementFor(tweet) {
    if (!settings.fakeEngagement) return { likes: tweet.baseLikes || 0, retweets: tweet.baseRetweets || 0 };
    const seed = hashStr(tweet.id);
    const likes = Math.min(ENGAGEMENT_CAP, Math.round(engagementPotential(tweet.id) * engagementGrowth(tweet.createdAt)));
    const retweets = Math.min(ENGAGEMENT_CAP, Math.round(likes * (0.12 + (seed % 5) * 0.03)));
    return { likes, retweets };
  }

  function engagementForPost(post) {
    if (!settings.fakeEngagement) return { likes: post.baseLikes || 0, comments: post.baseComments || 0 };
    const seed = hashStr(post.id);
    const likes = Math.min(ENGAGEMENT_CAP, Math.round(engagementPotential(post.id) * engagementGrowth(post.createdAt)));
    const comments = Math.min(ENGAGEMENT_CAP, Math.round(likes * (0.03 + (seed % 4) * 0.02)));
    return { likes, comments };
  }

  // ===== Tweets =====
  function renderTweetCount() {
    const len = $("tweetText").value.length;
    $("tweetCount").textContent = String(280 - len);
    $("tweetPostBtn").disabled = len === 0 || len > 280;
  }

  function renderTweetImagePreview() {
    const wrap = $("tweetImagePreviewWrap");
    if (pendingTweetImage) {
      $("tweetImagePreview").src = pendingTweetImage;
      wrap.classList.remove("hidden");
    } else {
      wrap.classList.add("hidden");
    }
  }

  function renderTimeline() {
    const container = $("tweetTimeline");
    container.innerHTML = "";
    $("tweetsEmpty").classList.toggle("hidden", tweets.length > 0);
    for (const tw of tweets) {
      const eng = engagementFor(tw);
      const row = document.createElement("div");
      row.className = "tweet";
      row.innerHTML = `
        <img class="tweet-avatar" src="${profile.avatar}" alt="" />
        <div class="tweet-body">
          <div class="tweet-head">
            <span class="tweet-name">${escapeHtml(profile.name)}</span>
            <span class="tweet-handle">@${escapeHtml(profile.handle)}</span>
            <span class="tweet-time">· ${fmtTime(tw.createdAt)}</span>
          </div>
          <div class="tweet-text">${escapeHtml(tw.text)}</div>
          ${tw.image ? `<div class="tweet-image"><img src="${tw.image}" alt="" data-full="${tw.image}" /></div>` : ""}
          <div class="tweet-stats">
            <span>${ICONS.reply} ${tw.replies || 0}</span>
            <span>${ICONS.retweet} ${eng.retweets}</span>
            <span>${ICONS.like} ${eng.likes}</span>
            <span>${ICONS.share}</span>
          </div>
        </div>
        <button class="tweet-delete" data-id="${tw.id}">⋯</button>
      `;
      container.appendChild(row);
    }
  }

  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function formatFeedTime(ts) {
    const t = fmtTime(ts);
    return t === "now" ? "JUST NOW" : t.toUpperCase() + " AGO";
  }

  function renderCaptionHtml(name, caption) {
    const escaped = escapeHtml(caption || "");
    const linked = escaped.replace(/(^|[\s(])(#[A-Za-z0-9_]+)/g, '$1<span class="hashtag">$2</span>');
    return `<span class="fc-username">${escapeHtml(name)}</span>${linked}`;
  }

  async function handleTweetImageFile(file) {
    if (!file) return;
    pendingTweetImage = await resizeImageFile(file, 1080, 0.82);
    renderTweetImagePreview();
  }

  async function postTweet() {
    const text = $("tweetText").value.trim();
    if (!text) return;
    $("tweetPostBtn").disabled = true;
    await showPostProgress();
    const tweet = {
      id: uid(),
      createdAt: Date.now(),
      text,
      image: pendingTweetImage,
      replies: 0,
      baseLikes: 0,
      baseRetweets: 0,
    };
    await DB.put("tweets", tweet);
    tweets.unshift(tweet);
    $("tweetText").value = "";
    pendingTweetImage = null;
    renderTweetImagePreview();
    renderTweetCount();
    renderTimeline();
    const first = $("tweetTimeline").firstElementChild;
    if (first) first.classList.add("pop-in");
    toast("Posted");
  }

  async function deleteTweet(id) {
    const ok = await confirmDialog("Delete this post?");
    if (!ok) return;
    await DB.remove("tweets", id);
    tweets = tweets.filter((t) => t.id !== id);
    renderTimeline();
  }

  // ===== Instagram feed posts =====
  function renderFeedList() {
    const container = $("feedList");
    container.innerHTML = "";
    $("feedEmpty").classList.toggle("hidden", feedPosts.length > 0);
    for (const p of feedPosts) {
      const eng = engagementForPost(p);
      const card = document.createElement("div");
      card.className = "feed-card";
      card.innerHTML = `
        <div class="feed-card-head">
          <img class="feed-card-avatar" src="${profile.avatar}" alt="" />
          <span class="feed-card-name">${escapeHtml(profile.handle)}</span>
          <button class="feed-card-menu" data-id="${p.id}">⋯</button>
        </div>
        <div class="feed-image-wrap"><img src="${p.image}" alt="" data-full="${p.image}" /></div>
        <div class="feed-actions-row">
          <span>${ICONS.like}</span>
          <span>${ICONS.reply}</span>
          <span>${ICONS.share}</span>
          <span class="spacer"></span>
          <span>${ICONS.bookmark}</span>
        </div>
        <div class="feed-likes">${eng.likes.toLocaleString()} likes</div>
        ${p.caption ? `<div class="feed-caption">${renderCaptionHtml(profile.handle, p.caption)}</div>` : ""}
        ${eng.comments > 0 ? `<div class="feed-comments-link">View all ${eng.comments.toLocaleString()} comments</div>` : ""}
        <div class="feed-time">${formatFeedTime(p.createdAt)}</div>
      `;
      container.appendChild(card);
    }
  }

  function resetFeedComposer() {
    feedComposerImage = null;
    $("feedComposePreview").innerHTML = '<span class="feed-compose-hint">Pick or take a photo</span>';
    $("feedCaptionInput").value = "";
    $("feedShareBtn").disabled = true;
  }

  function openFeedComposer() {
    resetFeedComposer();
    $("feedComposer").classList.remove("hidden");
  }
  function closeFeedComposer() { $("feedComposer").classList.add("hidden"); }

  async function handleFeedPhotoFile(file) {
    if (!file) return;
    feedComposerImage = await resizeImageFile(file, 1280, 0.85);
    $("feedComposePreview").innerHTML = `<img src="${feedComposerImage}" alt="" />`;
    $("feedShareBtn").disabled = false;
  }

  async function shareFeedPost() {
    if (!feedComposerImage) return;
    $("feedShareBtn").disabled = true;
    await showPostProgress();
    const post = {
      id: uid(),
      createdAt: Date.now(),
      image: feedComposerImage,
      caption: $("feedCaptionInput").value.trim(),
      baseLikes: 0,
      baseComments: 0,
    };
    await DB.put("feedPosts", post);
    feedPosts.unshift(post);
    closeFeedComposer();
    renderFeedList();
    const first = $("feedList").firstElementChild;
    if (first) first.classList.add("pop-in");
    toast("Shared");
  }

  async function deleteFeedPost(id) {
    const ok = await confirmDialog("Delete this post?");
    if (!ok) return;
    await DB.remove("feedPosts", id);
    feedPosts = feedPosts.filter((p) => p.id !== id);
    renderFeedList();
  }

  // ===== Image lightbox =====
  function openLightbox(src) {
    $("imageLightboxImg").src = src;
    $("imageLightbox").classList.remove("hidden");
  }
  function closeLightbox() {
    $("imageLightbox").classList.add("hidden");
    $("imageLightboxImg").src = "";
  }

  // ===== Settings sheet =====
  function openSettings() {
    renderProfile();
    updateOfflineStatus();
    $("settingsSheet").classList.remove("hidden");
  }
  function closeSettings() { $("settingsSheet").classList.add("hidden"); }

  function updateOfflineStatus() {
    const el = $("offlineStatus");
    const online = navigator.onLine;
    const swReady = "serviceWorker" in navigator && navigator.serviceWorker.controller;
    el.textContent = online
      ? (swReady ? "Installed for offline use." : "Online now — open once more after install for full offline support.")
      : "You're offline right now, and it's working.";
  }

  async function exportBackup() {
    const data = { profile, settings, stories, tweets, feedPosts, exportedAt: Date.now(), version: 2 };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `feedless-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast("Backup saved");
  }

  async function importBackup(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const ok = await confirmDialog("Import this backup? It will replace everything currently on this device.");
      if (!ok) return;
      await DB.clearAll();
      if (data.profile) { profile = data.profile; await saveProfile(); }
      if (data.settings) { settings = data.settings; await saveSettings(); }
      for (const s of data.stories || []) await DB.put("stories", s);
      for (const t of data.tweets || []) await DB.put("tweets", t);
      for (const p of data.feedPosts || []) await DB.put("feedPosts", p);
      await loadState();
      renderAll();
      toast("Backup imported");
    } catch (err) {
      toast("Couldn't read that backup file");
    }
  }

  async function deleteEverything() {
    const ok = await confirmDialog("Delete every story, post and setting on this device? This can't be undone.");
    if (!ok) return;
    await DB.clearAll();
    profile = { name: "You", handle: "you", avatar: "" };
    profile.avatar = defaultAvatar(profile.name);
    settings = { fakeEngagement: true };
    stories = [];
    tweets = [];
    feedPosts = [];
    renderAll();
    toast("Everything deleted");
  }

  // ===== Wire up =====
  function renderAll() {
    renderProfile();
    renderRing();
    renderArchiveGrid();
    renderTimeline();
    renderFeedList();
  }

  function init() {
    document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
    document.querySelectorAll(".ig-sub-btn").forEach((b) => b.addEventListener("click", () => setIgSub(b.dataset.sub)));

    $("profileBtn").addEventListener("click", openSettings);
    $("settingsBtn").addEventListener("click", openSettings);
    $("settingsDoneBtn").addEventListener("click", closeSettings);
    $("settingsBackdrop").addEventListener("click", closeSettings);

    $("nameInput").addEventListener("input", async (e) => { profile.name = e.target.value || "You"; await saveProfile(); renderAll(); });
    $("handleInput").addEventListener("input", async (e) => { profile.handle = (e.target.value || "you").replace(/\s+/g, ""); await saveProfile(); renderAll(); });
    $("fakeEngagementToggle").addEventListener("change", async (e) => { settings.fakeEngagement = e.target.checked; await saveSettings(); renderTimeline(); renderFeedList(); });

    $("changeAvatarBtn").addEventListener("click", () => $("avatarInput").click());
    $("avatarInput").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      profile.avatar = await resizeImageFile(file, 300, 0.85);
      await saveProfile();
      renderAll();
      e.target.value = "";
    });

    $("exportBtn").addEventListener("click", exportBackup);
    $("importBtn").addEventListener("click", () => $("importInput").click());
    $("importInput").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) importBackup(file);
      e.target.value = "";
    });
    $("deleteAllBtn").addEventListener("click", deleteEverything);

    // Stories
    $("addStoryBtn").addEventListener("click", openStoryComposer);
    $("archiveToggleBtn").addEventListener("click", () => {
      const grid = $("storyArchiveGrid");
      const willShow = grid.classList.contains("hidden");
      grid.classList.toggle("hidden");
      $("archiveToggleBtn").textContent = willShow ? "Hide archive ▴" : "View archive ▾";
    });

    $("storyViewerClose").addEventListener("click", closeStoryViewer);
    $("storyViewerDelete").addEventListener("click", deleteCurrentStory);
    $("storyPrev").addEventListener("click", viewerPrev);
    $("storyNext").addEventListener("click", viewerNext);

    $("storyComposerClose").addEventListener("click", async () => {
      const hasContent = composerTexts.length > 0 || composerBg.type === "photo";
      if (hasContent) {
        const ok = await confirmDialog("Discard this story?");
        if (!ok) return;
      }
      closeStoryComposer();
    });
    $("storyPickPhoto").addEventListener("click", () => $("storyPhotoInput").click());
    $("storyPhotoInput").addEventListener("change", (e) => { handleStoryPhotoFile(e.target.files[0]); e.target.value = ""; });
    $("storyTakePhoto").addEventListener("click", () => $("storyCameraInput").click());
    $("storyCameraInput").addEventListener("change", (e) => { handleStoryPhotoFile(e.target.files[0]); e.target.value = ""; });
    $("storyColorBtn").addEventListener("click", () => {
      deselectAll();
      swatchMode = "bg";
      renderSwatchRow();
    });
    $("storyAddTextBtn").addEventListener("click", addTextItem);
    $("storyZoomOut").addEventListener("click", () => zoomPhoto(-0.15));
    $("storyZoomIn").addEventListener("click", () => zoomPhoto(0.15));
    $("storyCanvas").addEventListener("click", dismissEditors);
    $("storyCanvas").addEventListener("wheel", (e) => {
      if (composerBg.type !== "photo") return;
      e.preventDefault();
      zoomPhoto(e.deltaY < 0 ? 0.1 : -0.1);
    }, { passive: false });
    $("storyShareBtn").addEventListener("click", shareStory);

    // Tweets
    $("tweetText").addEventListener("input", renderTweetCount);
    $("tweetImageBtn").addEventListener("click", () => $("tweetImageInput").click());
    $("tweetImageInput").addEventListener("change", (e) => { handleTweetImageFile(e.target.files[0]); e.target.value = ""; });
    $("tweetCameraBtn").addEventListener("click", () => $("tweetCameraInput").click());
    $("tweetCameraInput").addEventListener("change", (e) => { handleTweetImageFile(e.target.files[0]); e.target.value = ""; });
    $("removeTweetImage").addEventListener("click", () => { pendingTweetImage = null; renderTweetImagePreview(); });
    $("tweetPostBtn").addEventListener("click", postTweet);
    $("tweetTimeline").addEventListener("click", (e) => {
      const btn = e.target.closest(".tweet-delete");
      if (btn) { deleteTweet(btn.dataset.id); return; }
      const img = e.target.closest(".tweet-image img");
      if (img) openLightbox(img.dataset.full || img.src);
    });

    // Instagram feed
    $("addFeedPostBtn").addEventListener("click", openFeedComposer);
    $("feedComposerClose").addEventListener("click", async () => {
      if (feedComposerImage) {
        const ok = await confirmDialog("Discard this post?");
        if (!ok) return;
      }
      closeFeedComposer();
    });
    $("feedPickPhotoBtn").addEventListener("click", () => $("feedPhotoInput").click());
    $("feedPhotoInput").addEventListener("change", (e) => { handleFeedPhotoFile(e.target.files[0]); e.target.value = ""; });
    $("feedTakePhotoBtn").addEventListener("click", () => $("feedCameraInput").click());
    $("feedCameraInput").addEventListener("change", (e) => { handleFeedPhotoFile(e.target.files[0]); e.target.value = ""; });
    $("feedShareBtn").addEventListener("click", shareFeedPost);
    $("feedList").addEventListener("click", (e) => {
      const btn = e.target.closest(".feed-card-menu");
      if (btn) { deleteFeedPost(btn.dataset.id); return; }
      const img = e.target.closest(".feed-image-wrap img");
      if (img) openLightbox(img.dataset.full || img.src);
    });

    $("imageLightbox").addEventListener("click", closeLightbox);

    window.addEventListener("online", updateOfflineStatus);
    window.addEventListener("offline", updateOfflineStatus);

    // Refresh engagement numbers periodically while app is open
    setInterval(() => {
      if (activeTab === "twitter") renderTimeline();
      else if (activeTab === "instagram" && igSub === "feed") renderFeedList();
    }, 30000);
  }

  async function start() {
    init();
    await loadState();
    renderAll();
    renderTweetCount();
    setTab("instagram");
    setIgSub("stories");

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", start);
})();
