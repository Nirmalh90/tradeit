/* =========================================================
   SwapSquare (Demo) - script.js
   Firebase Auth (Option A: script tag module) + local demo data
   - Auth: Firebase Email/Password (and optional Google if you exposed it)
   - Data: still localStorage for items/swaps/messages for now
   ========================================================= */

/* -------------------------
   Storage keys
------------------------- */
const K_USERS = "ss_users";              // legacy (kept only for seed/demo fallback)
const K_CURRENT = "ss_currentUserId";    // legacy (no longer used for auth)
const K_ITEMS = "ss_items";
const K_SWAPS = "ss_swaps";
const K_MSGS = "ss_messages";
const K_PROFILES = "ss_profiles";        // NEW: stores { [uid]: {name, city, email} } locally

/* -------------------------
   DOM helpers
------------------------- */
const $ = (id) => document.getElementById(id);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* -------------------------
   Utils
------------------------- */
const now = () => Date.now();

function uid(prefix = "") {
  return prefix + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

function safeText(v) {
  return (v ?? "").toString();
}

function toast(msg) {
  const el = $("toast");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.classList.remove("hidden");
  el.style.opacity = "1";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.classList.add("hidden"), 250);
  }, 2200);
}

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

/* -------------------------
   Firebase Auth handle (Option A)
------------------------- */
function getFb() {
  // supports either window.fbAuth (your later screenshot) or window.firebaseAuth (earlier snippet)
  return window.fbAuth || window.firebaseAuth || null;
}
function requireFb() {
  const fb = getFb();
  if (!fb) {
    toast("Firebase Auth is not available. Check your <script type='module'> setup in index.html.");
    throw new Error("Firebase Auth not found on window (fbAuth/firebaseAuth).");
  }
  return fb;
}

/* -------------------------
   Data accessors
------------------------- */
function getProfiles() { return lsGet(K_PROFILES, {}); }
function setProfiles(v) { lsSet(K_PROFILES, v); }

function getItems() { return lsGet(K_ITEMS, []); }
function setItems(v) { lsSet(K_ITEMS, v); }

function getSwaps() { return lsGet(K_SWAPS, []); }
function setSwaps(v) { lsSet(K_SWAPS, v); }

function getMsgs() { return lsGet(K_MSGS, {}); } // { [swapId]: [ {fromUserId,text,ts} ] }
function setMsgs(v) { lsSet(K_MSGS, v); }

/* -------------------------
   Current user (Firebase-backed)
------------------------- */
let currentUser = null; // { id, name, email, city }
let activeConversationSwapId = null;
let activeDetailItemId = null;

/* -------------------------
   Seed (optional) - only for local demo content
   NOTE: We do NOT seed users anymore because Firebase owns auth.
------------------------- */
function ensureSeed() {
  // keep storage initialized
  if (!localStorage.getItem(K_ITEMS)) setItems([]);
  if (!localStorage.getItem(K_SWAPS)) setSwaps([]);
  if (!localStorage.getItem(K_MSGS)) setMsgs({});
  if (!localStorage.getItem(K_PROFILES)) setProfiles({});
}

/* =========================================================
   AUTH UI
========================================================= */
function setAuthView(isAuthed) {
  const auth = $("authSection");
  const main = $("mainSection");
  if (!auth || !main) return;
  auth.classList.toggle("hidden", isAuthed);
  main.classList.toggle("hidden", !isAuthed);
}

function renderUserBadge() {
  const badge = $("userBadge");
  if (!badge) return;
  if (!currentUser) { badge.textContent = ""; return; }
  badge.textContent = `${currentUser.name} • ${currentUser.city}`;
}

function setCurrentUserFromFirebase(fbUser) {
  if (!fbUser) {
    currentUser = null;
    return;
  }

  const profiles = getProfiles();
  const p = profiles[fbUser.uid];

  // fallback name if profile missing
  const email = fbUser.email || "";
  const fallbackName = email ? email.split("@")[0] : "User";
  const profile = p || { name: fallbackName, city: "Winnipeg", email };

  // ensure stored
  profiles[fbUser.uid] = { ...profile, email };
  setProfiles(profiles);

  currentUser = {
    id: fbUser.uid,
    name: profile.name || fallbackName,
    city: profile.city || "Winnipeg",
    email,
  };
}

/* =========================================================
   NAV / Pages
========================================================= */
function showSection(sectionId) {
  const pages = ["homeSection", "browseSection", "myItemsSection", "swapsSection", "messagesSection"];
  pages.forEach(id => $(id)?.classList.toggle("hidden", id !== sectionId));

  qsa(".nav .nav-link").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.target === sectionId);
  });

  rerenderAll();
}

function wireNav() {
  qsa(".nav .nav-link").forEach(btn => {
    btn.addEventListener("click", () => showSection(btn.dataset.target));
  });

  // Buttons that jump to sections (home buttons)
  qsa("[data-target]").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.target;
      if (t && $(t)) showSection(t);
    });
  });
}

/* =========================================================
   Image helpers (upload)
========================================================= */
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function readImagesFromInput(inputEl, max = 3) {
  const files = Array.from(inputEl?.files || []).slice(0, max);
  if (files.length === 0) return [];

  // Basic demo size guard (prevents localStorage blow-ups)
  const tooBig = files.find(f => f.size > 1.5 * 1024 * 1024);
  if (tooBig) throw new Error("One image is too large. Please upload images under ~1.5MB each.");

  const dataUrls = [];
  for (const f of files) dataUrls.push(await fileToDataURL(f));
  return dataUrls;
}

/* =========================================================
   Helpers to read profiles
========================================================= */
function userById(id) {
  const profiles = getProfiles();
  const p = profiles[id];
  return p ? { id, ...p } : null;
}

function itemById(id) {
  return getItems().find(i => i.id === id) || null;
}

function swapById(id) {
  return getSwaps().find(s => s.id === id) || null;
}

function formatMeta(it) {
  const owner = userById(it.ownerId);
  return `${it.category} • ${it.condition} • ${it.city} • Posted by ${owner ? owner.name : "Unknown"}`;
}

/* =========================================================
   ITEMS - My Items
========================================================= */
function canUserPostMoreItems() {
  const mine = getItems().filter(i => i.ownerId === currentUser.id);
  return mine.length < 3;
}

function wireAddItem() {
  const form = $("addItemForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    // Limit: 3 per user
    const myCount = getItems().filter(it => it.ownerId === currentUser.id).length;
    if (myCount >= 3) {
      toast("You can only post up to 3 items. Delete one to post a new item.");
      return;
    }

    const title = safeText($("itemTitle")?.value).trim();
    const category = safeText($("itemCategory")?.value).trim();
    const condition = safeText($("itemCondition")?.value).trim();
    const city = safeText($("itemCity")?.value).trim();
    const description = safeText($("itemDescription")?.value).trim();
    const imgInput = $("itemImages");

    if (!title || !category || !condition || !city || !description) {
      toast("Please fill in all required fields.");
      return;
    }

    // Images required (1-3)
    let images = [];
    try {
      images = await readImagesFromInput(imgInput, 3);
    } catch (err) {
      toast(err.message || "Image upload failed.");
      return;
    }
    if (images.length < 1) {
      toast("Please upload at least 1 image.");
      return;
    }

    const items = getItems();
    items.push({
      id: uid("i_"),
      ownerId: currentUser.id,
      title,
      category,
      condition,
      city,
      description,
      images,
      status: "active",     // active | locked
      lockedBySwapId: null,
      createdAt: now(),
    });

    setItems(items);

    form.reset();
    if ($("itemCity")) $("itemCity").value = currentUser.city;
    toast("Item posted!");
    rerenderAll();
  });
}

function deleteMyItem(itemId) {
  const items = getItems();
  const it = items.find(x => x.id === itemId);
  if (!it) return;
  if (it.ownerId !== currentUser.id) return;

  if (it.status === "locked") {
    toast("This item is locked in a swap. Resolve the swap to delete it.");
    return;
  }

  setItems(items.filter(x => x.id !== itemId));
  toast("Item deleted.");
  rerenderAll();
}

function renderMyItems() {
  const list = $("myItemsList");
  const empty = $("myItemsEmptyMsg");
  if (!list || !empty) return;

  const mine = getItems().filter(i => i.ownerId === currentUser.id).sort((a,b) => b.createdAt - a.createdAt);

  empty.classList.toggle("hidden", mine.length !== 0);
  list.innerHTML = "";

  mine.forEach((it, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "my-item-row";

    if (idx > 0) {
      wrap.style.borderTop = "1px solid rgba(255,255,255,0.08)";
      wrap.style.paddingTop = "14px";
      wrap.style.marginTop = "14px";
    }

    const left = document.createElement("div");
    left.className = "my-item-left";

    const img = document.createElement("img");
    img.className = "my-item-thumb";
    const firstImg = (it.images && it.images[0]) ? it.images[0] : "";
    if (firstImg) img.src = firstImg;
    img.alt = it.title;
    img.style.width = "60px";
    img.style.height = "60px";
    img.style.objectFit = "cover";
    img.style.borderRadius = "12px";
    img.style.border = "1px solid rgba(255,255,255,0.10)";
    img.style.background = "rgba(255,255,255,0.04)";

    const info = document.createElement("div");
    info.className = "my-item-info";
    info.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="font-weight:700;">${it.title}</div>
        ${it.status === "locked" ? `<span class="badge">Locked</span>` : ``}
      </div>
      <div class="muted">${it.category} • ${it.condition} • ${it.city}</div>
    `;

    left.appendChild(img);
    left.appendChild(info);

    const right = document.createElement("div");
    right.className = "my-item-actions";

    const del = document.createElement("button");
    del.className = "btn ghost";
    del.type = "button";
    del.textContent = "Delete";
    del.disabled = it.status === "locked";
    del.addEventListener("click", () => deleteMyItem(it.id));

    right.appendChild(del);

    wrap.appendChild(left);
    wrap.appendChild(right);

    list.appendChild(wrap);
  });
}

/* =========================================================
   BROWSE
========================================================= */
function getBrowseFilters() {
  const q = safeText($("searchInput")?.value).trim().toLowerCase();
  const cat = safeText($("categoryFilter")?.value).trim();
  const sameCity = !!$("sameCityOnly")?.checked;
  const hideOwn = !!$("hideOwnItems")?.checked;
  return { q, cat, sameCity, hideOwn };
}

function matchItemToFilters(it, f) {
  if (f.hideOwn && it.ownerId === currentUser.id) return false;
  if (f.sameCity && it.city.toLowerCase() !== currentUser.city.toLowerCase()) return false;
  if (f.cat && it.category !== f.cat) return false;

  if (f.q) {
    const hay = `${it.title} ${it.description}`.toLowerCase();
    if (!hay.includes(f.q)) return false;
  }
  return true;
}

function wireBrowseFilters() {
  ["searchInput","categoryFilter","sameCityOnly","hideOwnItems"].forEach(id => {
    $(id)?.addEventListener("input", rerenderAll);
    $(id)?.addEventListener("change", rerenderAll);
  });
}

function renderBrowse() {
  const grid = $("browseItemsGrid");
  const empty = $("browseEmptyMsg");
  if (!grid || !empty) return;

  const f = getBrowseFilters();
  const items = getItems()
    .filter(it => matchItemToFilters(it, f))
    .sort((a,b) => b.createdAt - a.createdAt);

  empty.classList.toggle("hidden", items.length !== 0);
  grid.innerHTML = "";

  items.forEach(it => {
    const card = document.createElement("div");
    card.className = "item-card";
    card.style.cursor = "pointer";

    const img = document.createElement("div");
    img.className = "item-img";
    const firstImg = (it.images && it.images[0]) ? it.images[0] : "";
    if (firstImg) {
      img.style.backgroundImage = `url("${firstImg}")`;
      img.style.backgroundSize = "cover";
      img.style.backgroundPosition = "center";
    } else {
      img.textContent = "No Image";
      img.style.display = "flex";
      img.style.alignItems = "center";
      img.style.justifyContent = "center";
      img.style.color = "rgba(255,255,255,0.6)";
      img.style.background = "rgba(255,255,255,0.04)";
    }

    const body = document.createElement("div");
    body.className = "item-body";

    const owner = userById(it.ownerId);
    body.innerHTML = `
      <div class="item-title">${it.title}</div>
      <div class="muted">${it.category} • ${it.condition} • ${it.city}</div>
      <div class="muted">Posted by ${owner ? owner.name : "Unknown"}</div>
      <div class="item-actions">
        <span class="chip">Barter only</span>
        <button class="btn ghost" type="button">View & Swap</button>
      </div>
    `;

    card.appendChild(img);
    card.appendChild(body);

    card.addEventListener("click", () => openItemDetail(it.id));
    grid.appendChild(card);
  });
}

/* =========================================================
   ITEM DETAIL MODAL + CAROUSEL
========================================================= */
function closeItemDetail() {
  $("itemDetailModal")?.classList.add("hidden");
  activeDetailItemId = null;
}

function openItemDetail(itemId) {
  const it = itemById(itemId);
  if (!it) return;

  activeDetailItemId = itemId;

  const modal = $("itemDetailModal");
  if (!modal) return;

  $("detailTitle").textContent = it.title;
  $("detailMeta").textContent = formatMeta(it);

  const desc = $("detailDesc");
  if (desc) desc.textContent = it.description;

  const mainImg = $("detailMainImage");
  const thumbs = $("detailThumbs");
  const imgs = (it.images && it.images.length) ? it.images : [];
  const safeImgs = imgs.slice(0, 3);

  if (mainImg) {
    if (safeImgs[0]) mainImg.src = safeImgs[0];
    else mainImg.removeAttribute("src");
  }

  if (thumbs) {
    thumbs.innerHTML = "";
    safeImgs.forEach((src, idx) => {
      const t = document.createElement("img");
      t.className = "detail-thumb" + (idx === 0 ? " active" : "");
      t.src = src;
      t.alt = "thumb";
      t.addEventListener("click", () => {
        if (mainImg) mainImg.src = src;
        qsa(".detail-thumb", thumbs).forEach(x => x.classList.remove("active"));
        t.classList.add("active");
      });
      thumbs.appendChild(t);
    });
  }

  const offerSelect = $("detailOfferSelect");
  const noItemsMsg = $("detailSwapNoItemsMsg");
  const lockedNote = $("detailLockedNote");
  const sendBtn = $("sendSwapFromDetailBtn");

  if (lockedNote) lockedNote.classList.add("hidden");
  if (noItemsMsg) noItemsMsg.classList.add("hidden");

  if (!currentUser) return;

  if (it.ownerId === currentUser.id) {
    if (lockedNote) {
      lockedNote.textContent = "This is your item.";
      lockedNote.classList.remove("hidden");
    }
    if (sendBtn) sendBtn.disabled = true;
  } else {
    if (sendBtn) sendBtn.disabled = false;
  }

  if (offerSelect) {
    offerSelect.innerHTML = `<option value="">Select one of your items</option>`;

    const myActive = getItems()
      .filter(x => x.ownerId === currentUser.id)
      .filter(x => x.status === "active")
      .filter(x => x.id !== it.id);

    if (myActive.length === 0) {
      if (noItemsMsg) {
        noItemsMsg.textContent = "No available items to offer (add items or unlock pending swaps).";
        noItemsMsg.classList.remove("hidden");
      }
      if (sendBtn) sendBtn.disabled = true;
    } else {
      myActive.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = `${m.title} (${m.category}, ${m.condition})`;
        offerSelect.appendChild(opt);
      });
      if (sendBtn && it.ownerId !== currentUser.id) sendBtn.disabled = false;
    }
  }

  modal.classList.remove("hidden");
}

function wireItemDetailModal() {
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t) return;

    if (t.id === "closeItemDetailModal" || t.classList.contains("modal-close") || t.dataset.close === "itemDetailModal") {
      closeItemDetail();
      return;
    }
    if (t.id === "itemDetailModal") {
      closeItemDetail();
      return;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeItemDetail();
  });

  $("sendSwapFromDetailBtn")?.addEventListener("click", () => {
    const offerId = safeText($("detailOfferSelect")?.value).trim();
    if (!offerId) {
      toast("Select one of your items to offer.");
      return;
    }
    if (!activeDetailItemId) return;

    sendSwapRequest(offerId, activeDetailItemId);
  });
}

/* =========================================================
   SWAPS - rules + locking/unlocking
========================================================= */
function lockItem(itemId, swapId) {
  const items = getItems();
  const it = items.find(x => x.id === itemId);
  if (!it) return;
  it.status = "locked";
  it.lockedBySwapId = swapId;
  setItems(items);
}

function unlockItem(itemId, swapId = null) {
  const items = getItems();
  const it = items.find(x => x.id === itemId);
  if (!it) return;
  if (swapId && it.lockedBySwapId && it.lockedBySwapId !== swapId) return;
  it.status = "active";
  it.lockedBySwapId = null;
  setItems(items);
}

function sendSwapRequest(offeredItemId, requestedItemId) {
  const offered = itemById(offeredItemId);
  const requested = itemById(requestedItemId);
  if (!offered || !requested) return;

  if (offered.ownerId !== currentUser.id) {
    toast("You can only offer your own items.");
    return;
  }
  if (requested.ownerId === currentUser.id) {
    toast("You can’t swap with your own item.");
    return;
  }
  if (offered.status !== "active") {
    toast("That item is locked in another swap. Choose a different item.");
    return;
  }

  const swaps = getSwaps();
  const s = {
    id: uid("s_"),
    fromUserId: currentUser.id,
    toUserId: requested.ownerId,
    offeredItemId,
    requestedItemId,
    status: "pending",
    createdAt: now(),
    updatedAt: now(),
  };
  swaps.push(s);
  setSwaps(swaps);

  lockItem(offeredItemId, s.id);

  toast("Swap request sent!");
  closeItemDetail();
  rerenderAll();
}

function acceptSwap(swapId) {
  const swaps = getSwaps();
  const s = swaps.find(x => x.id === swapId);
  if (!s) return;
  if (s.toUserId !== currentUser.id) return;
  if (s.status !== "pending") return;

  lockItem(s.requestedItemId, s.id);

  s.status = "accepted";
  s.updatedAt = now();
  setSwaps(swaps);

  const msgs = getMsgs();
  if (!msgs[s.id]) msgs[s.id] = [];
  setMsgs(msgs);

  toast("Swap accepted! You can now message in Messages.");
  rerenderAll();
}

function rejectSwap(swapId) {
  const swaps = getSwaps();
  const s = swaps.find(x => x.id === swapId);
  if (!s) return;
  if (s.toUserId !== currentUser.id) return;
  if (s.status !== "pending") return;

  s.status = "rejected";
  s.updatedAt = now();
  setSwaps(swaps);

  unlockItem(s.offeredItemId, s.id);

  toast("Swap rejected.");
  rerenderAll();
}

function cancelSwap(swapId) {
  const swaps = getSwaps();
  const s = swaps.find(x => x.id === swapId);
  if (!s) return;
  if (s.fromUserId !== currentUser.id) return;
  if (s.status !== "pending") {
    toast("You can only cancel pending swaps.");
    return;
  }

  s.status = "canceled";
  s.updatedAt = now();
  setSwaps(swaps);

  unlockItem(s.offeredItemId, s.id);

  toast("Swap canceled.");
  rerenderAll();
}

function withdrawSwap(swapId) {
  const swaps = getSwaps();
  const s = swaps.find(x => x.id === swapId);
  if (!s) return;
  if (s.fromUserId !== currentUser.id) return;

  if (s.status !== "accepted") {
    toast("You can withdraw only after a swap is accepted.");
    return;
  }

  s.status = "withdrawn";
  s.updatedAt = now();
  setSwaps(swaps);

  unlockItem(s.offeredItemId, s.id);
  unlockItem(s.requestedItemId, s.id);

  toast("You withdrew from the accepted swap. Items are active again.");
  rerenderAll();
}

function renderSwaps() {
  const incomingList = $("incomingSwapsList");
  const outgoingList = $("outgoingSwapsList");
  const inEmpty = $("incomingEmptyMsg");
  const outEmpty = $("outgoingEmptyMsg");
  if (!incomingList || !outgoingList || !inEmpty || !outEmpty) return;

  const swaps = getSwaps().slice().sort((a,b) => b.createdAt - a.createdAt);
  const incoming = swaps.filter(s => s.toUserId === currentUser.id);
  const outgoing = swaps.filter(s => s.fromUserId === currentUser.id);

  inEmpty.classList.toggle("hidden", incoming.length !== 0);
  outEmpty.classList.toggle("hidden", outgoing.length !== 0);

  incomingList.innerHTML = "";
  outgoingList.innerHTML = "";

  incoming.forEach(s => {
    const offered = itemById(s.offeredItemId);
    const requested = itemById(s.requestedItemId);
    const fromU = userById(s.fromUserId);

    const row = document.createElement("div");
    row.className = "swap-row";
    row.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
        <div>
          <div style="font-weight:800;">${fromU ? fromU.name : "Someone"} wants: ${requested ? requested.title : "your item"}</div>
          <div class="muted">They offer: ${offered ? offered.title : "Unknown"} • ${offered ? offered.condition : ""}</div>
          <div class="muted">Status: <b>${s.status}</b></div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end;">
          ${s.status === "pending" ? `
            <button class="btn primary" data-act="accept" data-id="${s.id}" type="button">Accept</button>
            <button class="btn ghost" data-act="reject" data-id="${s.id}" type="button">Reject</button>
          ` : `<span class="badge">${s.status}</span>`}
        </div>
      </div>
    `;
    incomingList.appendChild(row);
  });

  outgoing.forEach(s => {
    const offered = itemById(s.offeredItemId);
    const requested = itemById(s.requestedItemId);
    const toU = userById(s.toUserId);

    const row = document.createElement("div");
    row.className = "swap-row";
    row.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
        <div>
          <div style="font-weight:800;">You proposed to ${toU ? toU.name : "someone"}</div>
          <div class="muted">You offer: ${offered ? offered.title : "Unknown"} ⇄ Their: ${requested ? requested.title : "Unknown"}</div>
          <div class="muted">Status: <b>${s.status}</b></div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end;">
          ${s.status === "pending" ? `
            <button class="btn ghost" data-act="cancel" data-id="${s.id}" type="button">Cancel</button>
          ` : s.status === "accepted" ? `
            <button class="btn ghost" data-act="withdraw" data-id="${s.id}" type="button">Withdraw</button>
            <button class="btn primary" data-act="openchat" data-id="${s.id}" type="button">Open chat</button>
          ` : `<span class="badge">${s.status}</span>`}
        </div>
      </div>
    `;
    outgoingList.appendChild(row);
  });

  incomingList.onclick = (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === "accept") acceptSwap(id);
    if (btn.dataset.act === "reject") rejectSwap(id);
  };

  outgoingList.onclick = (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === "cancel") cancelSwap(id);
    if (btn.dataset.act === "withdraw") withdrawSwap(id);
    if (btn.dataset.act === "openchat") {
      showSection("messagesSection");
      openConversation(id);
    }
  };
}

/* =========================================================
   MESSAGES
========================================================= */
function acceptedSwapsForUser() {
  return getSwaps().filter(s =>
    s.status === "accepted" &&
    (s.fromUserId === currentUser.id || s.toUserId === currentUser.id)
  ).sort((a,b) => b.updatedAt - a.updatedAt);
}

function otherParty(swap) {
  const otherId = swap.fromUserId === currentUser.id ? swap.toUserId : swap.fromUserId;
  return userById(otherId);
}

function renderConversations() {
  const list = $("conversationsList");
  const empty = $("conversationsEmptyMsg");
  if (!list || !empty) return;

  const swaps = acceptedSwapsForUser();
  empty.classList.toggle("hidden", swaps.length !== 0);
  list.innerHTML = "";

  const msgs = getMsgs();

  swaps.forEach(s => {
    const other = otherParty(s);
    const offered = itemById(s.offeredItemId);
    const requested = itemById(s.requestedItemId);

    const last = (msgs[s.id] && msgs[s.id].length) ? msgs[s.id][msgs[s.id].length - 1] : null;
    const lastText = last ? `${last.fromUserId === currentUser.id ? "You" : (other ? other.name : "Them")}: ${last.text}` : "No messages yet.";

    const row = document.createElement("div");
    row.className = "conversation-row";
    row.dataset.swapId = s.id;

    row.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
        <div>
          <div style="font-weight:800;">${other ? other.name : "Conversation"}</div>
          <div class="muted" style="margin-top:4px;">${offered ? offered.title : "Your item"} ⇄ ${requested ? requested.title : "Their item"}</div>
          <div class="muted" style="margin-top:6px;">Last: ${lastText}</div>
        </div>
        <span class="badge">Active</span>
      </div>
    `;

    row.addEventListener("click", () => openConversation(s.id));
    list.appendChild(row);
  });
}

function openConversation(swapId) {
  const s = swapById(swapId);
  if (!s) return;
  if (s.status !== "accepted") {
    toast("Chat is only available for accepted swaps.");
    return;
  }

  activeConversationSwapId = swapId;

  const other = otherParty(s);
  const offered = itemById(s.offeredItemId);
  const requested = itemById(s.requestedItemId);

  const title = $("conversationTitle");
  const sub = $("conversationSubtitle");
  if (title) title.textContent = `Chat with ${other ? other.name : "User"}`;
  if (sub) sub.textContent = `${offered ? offered.title : "Your item"} ⇄ ${requested ? requested.title : "Their item"}`;

  $("conversationForm")?.classList.remove("hidden");
  renderConversationMessages();
}

function renderConversationMessages() {
  const box = $("conversationMessages");
  if (!box) return;

  const msgs = getMsgs();
  const arr = msgs[activeConversationSwapId] || [];

  box.innerHTML = "";
  arr.forEach(m => {
    const bubble = document.createElement("div");
    const mine = m.fromUserId === currentUser.id;
    bubble.className = "msg-bubble " + (mine ? "mine" : "theirs");

    const sender = userById(m.fromUserId);
    bubble.innerHTML = `
      <div class="msg-meta">${mine ? "You" : (sender ? sender.name : "Them")}</div>
      <div class="msg-text">${escapeHtml(m.text)}</div>
    `;
    box.appendChild(bubble);
  });

  box.scrollTop = box.scrollHeight;
}

function escapeHtml(s) {
  return safeText(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wireMessages() {
  const form = $("conversationForm");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!activeConversationSwapId) {
      toast("Select a conversation first.");
      return;
    }
    const s = swapById(activeConversationSwapId);
    if (!s || s.status !== "accepted") {
      toast("This conversation is not active.");
      return;
    }
    const input = $("conversationInput");
    const txt = safeText(input?.value).trim();
    if (!txt) return;

    const msgs = getMsgs();
    if (!msgs[activeConversationSwapId]) msgs[activeConversationSwapId] = [];
    msgs[activeConversationSwapId].push({ fromUserId: currentUser.id, text: txt, ts: now() });
    setMsgs(msgs);

    const swaps = getSwaps();
    const sw = swaps.find(x => x.id === activeConversationSwapId);
    if (sw) {
      sw.updatedAt = now();
      setSwaps(swaps);
    }

    if (input) input.value = "";
    renderConversationMessages();
    renderBadges();
  });
}

/* =========================================================
   Badges (Swaps / Messages)
========================================================= */
function renderBadges() {
  const swaps = getSwaps();
  const incomingPending = swaps.filter(s => s.toUserId === currentUser.id && s.status === "pending").length;
  const swapsBadge = $("swapsBadge");
  if (swapsBadge) {
    swapsBadge.textContent = incomingPending;
    swapsBadge.classList.toggle("hidden", incomingPending === 0);
  }

  const msgs = getMsgs();
  const accepted = acceptedSwapsForUser();
  let unread = 0;
  accepted.forEach(s => {
    const arr = msgs[s.id] || [];
    if (arr.length === 0) return;
    const last = arr[arr.length - 1];
    if (last.fromUserId !== currentUser.id) unread++;
  });

  const mBadge = $("messagesBadge");
  if (mBadge) {
    mBadge.textContent = unread;
    mBadge.classList.toggle("hidden", unread === 0);
  }
}

/* =========================================================
   Rerender (single entry)
========================================================= */
function rerenderAll() {
  if (!currentUser) return;

  renderUserBadge();
  renderBadges();

  renderMyItems();
  renderBrowse();
  renderSwaps();
  renderConversations();

  if (activeConversationSwapId) renderConversationMessages();
}

/* =========================================================
   AUTH wiring (Firebase)
========================================================= */
function wireAuth() {
  const fb = requireFb();

  // ✅ auth INSTANCE (what Firebase expects as the first arg)
  // If you set window.fbAuth = { auth, createUserWithEmailAndPassword, ... }
  // then auth will exist as fb.auth
  // If you didn't, fallback to fb itself (some people set window.fbAuth = auth)
  // auth instance vs exported helper functions
  const auth = fb.auth || window.firebaseAuth || fb;

  const loginTab = $("loginTab");
  const signupTab = $("signupTab");
  const loginForm = $("loginForm");
  const signupForm = $("signupForm");

  function setTab(which) {
    const isLogin = which === "login";
    loginTab?.classList.toggle("active", isLogin);
    signupTab?.classList.toggle("active", !isLogin);
    loginForm?.classList.toggle("hidden", !isLogin);
    signupForm?.classList.toggle("hidden", isLogin);
  }

  loginTab?.addEventListener("click", () => setTab("login"));
  signupTab?.addEventListener("click", () => setTab("signup"));

  // ✅ LOGIN
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = safeText($("loginEmail")?.value).trim();
    const pass = safeText($("loginPassword")?.value);

    if (!email || !pass) return;

    try {
      await fb.signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
      toast(err?.message || "Login failed.");
    }
  });

  // ✅ SIGNUP
  signupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = safeText($("signupName")?.value).trim();
    const city = safeText($("signupCity")?.value).trim();
    const email = safeText($("signupEmail")?.value).trim();
    const pass = safeText($("signupPassword")?.value);

    if (!name || !city || !email || !pass) return;

    try {
      const cred = await fb.createUserWithEmailAndPassword(auth, email, pass);
      const u = cred.user;

      // store profile locally for now
      const profiles = getProfiles();
      profiles[u.uid] = { name, city, email };
      setProfiles(profiles);

      toast("Account created. You can start posting items.");
    } catch (err) {
      toast(err?.message || "Signup failed.");
    }
  });

  // ✅ LOGOUT
  $("logoutBtn")?.addEventListener("click", async () => {
    try {
      await fb.signOut(auth);
    } catch (err) {
      toast(err?.message || "Logout failed.");
    }
  });

  // ✅ AUTH STATE
  fb.onAuthStateChanged(auth, (fbUser) => {
    setCurrentUserFromFirebase(fbUser);

    if (currentUser) {
      setAuthView(true);
      renderUserBadge();
      if ($("itemCity")) $("itemCity").value = currentUser.city;
      showSection("homeSection");
      toast(`Welcome, ${currentUser.name}!`);
    } else {
      activeConversationSwapId = null;
      activeDetailItemId = null;
      setAuthView(false);
    }

    rerenderAll();
  });
}


/* =========================================================
   MAIN init
========================================================= */
function main() {
  ensureSeed();

  wireNav();
  wireAddItem();
  wireBrowseFilters();
  wireItemDetailModal();
  wireMessages();

  // Auth wiring last (needs fbAuth present)
  wireAuth();
}

document.addEventListener("DOMContentLoaded", main);
