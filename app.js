(() => {

  // --- iOS/Chrome: stabilizuj scroll przy klawiaturze (żeby po dodaniu nie "uciekało") ---
  let __lastScrollY = 0;
  let __scrollRestoreTimer = null;
  function rememberScroll(){
    __lastScrollY = window.scrollY || 0;
  }
  function restoreScrollSoon(delayMs=60){
    if(__scrollRestoreTimer) clearTimeout(__scrollRestoreTimer);
    __scrollRestoreTimer = setTimeout(()=>{
      // "instant" is not a valid scroll behavior in most browsers.
      // Using "auto" makes the restore reliable on Chrome/Android + iOS.
      try { window.scrollTo({ top: __lastScrollY, left: 0, behavior: "auto" }); }
      catch(e){ window.scrollTo(0, __lastScrollY); }
    }, delayMs);
  }


function ensureInputVisible(el){
  try{
    if(!el) return;
    // Only on mobile where virtual keyboard can cover inputs
    const vv = window.visualViewport;
    const rect = el.getBoundingClientRect();
    // Keep input BELOW sticky header (dynamic height) and ABOVE keyboard.
    // iOS/Chrome sometimes doesn't scroll focused inputs into view, especially near the bottom.
    const header = document.querySelector('.app-header');
    const headerH = header ? header.getBoundingClientRect().height : 0;
    const topPad = Math.round(headerH + 9);   // safe space under the locked header
    const bottomPad = 22; // space above keyboard / bottom UI
    let viewH = (vv && vv.height) ? vv.height : window.innerHeight;

    // If element is below the visible viewport (covered by keyboard), scroll down a bit.
    const desiredBottom = viewH - bottomPad;
    if(rect.bottom > desiredBottom){
      const delta = rect.bottom - desiredBottom;
      window.scrollBy({ top: delta, left: 0, behavior: "auto" });
      return;
    }
    // If element is above the visible viewport (under header), scroll up a bit.
    const desiredTop = topPad;
    if(rect.top < desiredTop){
      const delta = rect.top - desiredTop;
      window.scrollBy({ top: delta, left: 0, behavior: "auto" });
    }
  }catch(e){}
}

  const LS_KEY = "zamowienia_pro_v1";
  const DEFAULT_CATS = ["Warzywa","Mięso","Nabiał","Mrożonki","Suchy magazyn","Przyprawy","Owoce","Ryby","Inne"];
  const DEFAULT_SECTIONS = ["Grill","Palniki","Zimna","Wydawka"];
  const TZ = "Europe/Warsaw";

  // --- LIVE (Firebase Firestore) ---
  const LIVE = {
    enabled: false,
    ready: false,
    db: null,
    orderId: "",
    status: "offline",
    orderStatus: "open",
    unsubItems: null,
    unsubOrder: null
  };

  const LS_ORDER = "zamowienia_pro_live_order";

  function liveEl(id){ return document.getElementById(id); }
  function liveSetStatus(txt){ const el = liveEl("liveStatus"); if(el) el.textContent = txt; }
  function liveCanWrite(){ return LIVE.enabled && LIVE.orderId && LIVE.orderStatus !== "closed"; }

  function initFirebase(){
    try{
      const cfg = window.__FIREBASE_CONFIG__;
      if(!cfg || !cfg.projectId){ LIVE.status="no-config"; liveSetStatus("LIVE: brak konfiguracji (firebase-config.js)"); return; }
      if(!window.firebase || !firebase.firestore){ LIVE.status="no-sdk"; liveSetStatus("LIVE: brak SDK Firebase"); return; }
      if(!firebase.apps || !firebase.apps.length){ firebase.initializeApp(cfg); }
      LIVE.db = firebase.firestore();
      LIVE.enabled = true;
      LIVE.status = "ready";
      LIVE.ready = true;
      LIVE.orderId = localStorage.getItem(LS_ORDER) || "";
      LIVE.aliasName = localStorage.getItem("LIVE_ALIAS") || "";
      liveSetStatus("LIVE: gotowe");
    }catch(e){
      console.error(e);
      LIVE.status="error";
      liveSetStatus("LIVE: błąd init (sprawdź config)");
    }
  }

  function liveBindUI(){
    const inp = liveEl("orderCode");
    const btnC = liveEl("btnCreateOrder");
    const btnJ = liveEl("btnJoinOrder");
    const btnX = liveEl("btnCloseOrder");
    const sel = liveEl("userSelect");
    if(inp){ inp.value = LIVE.orderId || ""; }
    if(btnC) btnC.addEventListener("click", async()=>{ if(!LIVE.ready){ toast("LIVE nie jest gotowe"); return; }
      const code = await liveCreateOrder();
      if(inp) inp.value = code;
      toast("Utworzono zamówienie: " + code);
    });
    if(btnJ) btnJ.addEventListener("click", async()=>{ if(!LIVE.ready){ toast("LIVE nie jest gotowe"); return; }
      const code = norm(inp ? inp.value : "");
      if(!code){ toast("Wpisz kod zamówienia"); return; }
      const ok = await liveJoinOrder(code);
      if(ok){ toast("Dołączono: " + code); }
    });
    if(btnX) btnX.addEventListener("click", async()=>{ if(!liveCanWrite()){ toast("Brak aktywnego zamówienia"); return; }
      if(!confirm("Zamknąć zamówienie? Po zamknięciu nie da się dodawać.")) return;
      await liveCloseOrder();
    });
    if(sel){ sel.addEventListener("change", ()=>{
      const v = sel.value;
      if(v){ const inUser = liveEl("userName"); if(inUser){ inUser.value = v; }
        state.settings.userName = v; save(); renderAll(); }
    }); }
  }

  function liveLoadPeople(){
    const sel = liveEl("userSelect");
    if(!LIVE.ready || !sel) return;
    LIVE.db.collection("people").where("active","==",true).orderBy("order").get().then((snap)=>{
      const opts = ['<option value="">— (wpiszę ręcznie)</option>'];
      snap.forEach(doc=>{ const d=doc.data()||{}; if(d.name) opts.push(`<option value="${escapeAttr(d.name)}">${escapeHtml(d.name)}</option>`); });
      sel.innerHTML = opts.join("");
    }).catch((e)=>{ console.warn(e); liveSetStatus("LIVE: brak dostępu do people (sprawdź reguły)"); });
  }

  function liveOrderRef(id){ return LIVE.db.collection("orders").doc(id); }
  function liveItemsCol(){ return liveOrderRef(LIVE.orderId).collection("items"); }
  function liveNewCode(){ return "META-" + Math.random().toString(36).slice(2,6).toUpperCase(); }

  // --- LIVE: prosty tryb nazwy (alias -> otwarte zamówienie) ---
  function liveAliasKey(name){
    return norm(name).toLowerCase().replace(/\s+/g,"-");
  }
  function liveAliasRef(name){
    return LIVE.db.collection("orderAliases").doc(liveAliasKey(name));
  }
  async function liveResolveAlias(name){
    const snap = await liveAliasRef(name).get();
    if(!snap.exists) return null;
    const d = snap.data() || {};
    if(d.status !== "open" || !d.orderId) return null;
    return d.orderId;
  }
  async function liveSetAlias(name, orderId){
    await liveAliasRef(name).set({
      name: String(name||"").trim(),
      orderId,
      status: "open",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, {merge:true});
  }
  async function liveCloseAlias(name){
    await liveAliasRef(name).set({
      status: "closed",
      closedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, {merge:true});
  }

  async function liveTouchAlias(){
    if(!LIVE.ready || !LIVE.aliasName) return;
    try{
      await liveAliasRef(LIVE.aliasName).set({ updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
    }catch(e){}
  }


  async function liveCreateOrder(){
    const inp = liveEl("orderCode");
    const rawName = inp ? inp.value : "";
    const name = norm(rawName);
    if(!name){ toast("Wpisz nazwę zamówienia (np. Dostawa)"); return false; }

    // jeśli jest otwarte zamówienie pod tą nazwą → dołącz
    const existingId = await liveResolveAlias(name);
    if(existingId){
      LIVE.aliasName = name;
      await liveUseOrder(existingId);
      toast("Dołączono do otwartego zamówienia: " + name);
      return existingId;
    }

    // w przeciwnym razie → utwórz nowe zamówienie i ustaw alias
    const orderId = liveNewCode();
    await liveOrderRef(orderId).set({
      status: "open",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      name
    }, {merge:true});

    LIVE.aliasName = name;
    await liveSetAlias(name, orderId);
    await liveUseOrder(orderId);
    toast("Utworzono nowe zamówienie: " + name);
    return orderId;
  }

  async function liveJoinOrder(code){
    // w trybie nazw: "code" traktujemy jako nazwę (pole orderCode)
    const rawName = code || (liveEl("orderCode") ? liveEl("orderCode").value : "");
    const name = norm(rawName);
    if(!name){ toast("Wpisz nazwę zamówienia"); return false; }

    const orderId = await liveResolveAlias(name);
    if(!orderId){ toast("Nie ma otwartego zamówienia: " + name); return false; }

    LIVE.aliasName = name;
    await liveUseOrder(orderId);
    toast("Dołączono: " + name);
    return true;
  }

  async function liveUseOrder(code){
    LIVE.orderId = code;
    localStorage.setItem(LS_ORDER, code);
    if(LIVE.aliasName) localStorage.setItem("LIVE_ALIAS", LIVE.aliasName);
    const inp = liveEl("orderCode"); if(inp) inp.value = code;
    $("hdrSub").textContent = "LIVE: " + code;
    if(LIVE.unsubItems) try{ LIVE.unsubItems(); }catch(e){}
    if(LIVE.unsubOrder) try{ LIVE.unsubOrder(); }catch(e){}
    // listen order status
    LIVE.unsubOrder = liveOrderRef(code).onSnapshot((doc)=>{
      const d = doc.data() || {};
      LIVE.orderStatus = d.status || "open";
      const btnX = liveEl("btnCloseOrder");
      if(btnX) btnX.style.display = (LIVE.orderStatus === "open") ? "" : "none";
      if(LIVE.orderStatus === "closed") toast("Zamówienie jest zamknięte");
      renderAll();
    });
    // listen items
    LIVE.unsubItems = liveItemsCol().orderBy("updatedAt","desc").onSnapshot((snap)=>{
      const arr = [];
      snap.forEach(doc=>{ const d=doc.data()||{}; arr.push({ id: doc.id, name:d.name, category:d.category||"", qty:d.qty||"", updatedAt: d.updatedAt ? (d.updatedAt.toMillis? d.updatedAt.toMillis(): Date.now()) : Date.now(), by: (d.by && Array.isArray(d.by)) ? d.by.join(", ") : (d.by||"") , __live:true, section: d.section||"" }); });
      state.order.items = arr;
      renderAll();
    });
    liveSetStatus("LIVE: połączono ("+code+")");
  }

  async function liveCloseOrder(){
    await liveOrderRef(LIVE.orderId).set({ status:"closed", closedAt: firebase.firestore.FieldValue.serverTimestamp(), closedBy: norm(state.settings.userName)||"" }, {merge:true});
    if(LIVE.aliasName) try{ await liveCloseAlias(LIVE.aliasName); }catch(e){ console.warn(e); }

  }

  function liveDocId(name, section){
    const key = (norm(name)+"__"+norm(section)).toLowerCase();
    // simple hash to keep doc id short
    let h=2166136261;
    for(let i=0;i<key.length;i++){ h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    return "i_" + (h>>>0).toString(16);
  }

  async function liveAddItem(p, qty){
    const by = norm(state.settings.userName)||"—";
    const section = norm(state.ui.filterSection)|| (p.sections && p.sections[0]) || "";
    const id = liveDocId(p.name, section);
    const ref = liveItemsCol().doc(id);
    await LIVE.db.runTransaction(async (tx)=>{
      const snap = await tx.get(ref);
      if(!snap.exists){
        tx.set(ref, { name: p.name, category: p.category||"", section, qty, by: [by], updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      } else {
        const d = snap.data()||{};
        const oldQty = d.qty || "";
        const newQty = mergeQty(oldQty, qty);
        const byArr = Array.isArray(d.by) ? d.by.slice() : (d.by ? [d.by] : []);
        if(by && !byArr.includes(by)) byArr.push(by);
        tx.set(ref, { name: d.name||p.name, category: d.category||p.category||"", section: d.section||section, qty: newQty, by: byArr, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
      }
    });
    try{ await liveOrderRef(LIVE.orderId).set({ updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, {merge:true}); }catch(e){}
    liveTouchAlias();
  }

  async function liveSetItemQty(it, newQty){
    const by = norm(state.settings.userName)||"—";
    const ref = liveItemsCol().doc(it.id);
    await ref.set({ qty: newQty, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), by: firebase.firestore.FieldValue.arrayUnion(by) }, {merge:true});
    try{ await liveOrderRef(LIVE.orderId).set({ updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, {merge:true}); }catch(e){}
    liveTouchAlias();
  }

  async function liveDeleteItem(it){
    await liveItemsCol().doc(it.id).delete();
    try{ await liveOrderRef(LIVE.orderId).set({ updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, {merge:true}); }catch(e){}
    liveTouchAlias();
  }


  const $ = (id) => document.getElementById(id);

  // --- mobile UX: keep last interacted row visible across re-renders (iOS keyboard / sticky header) ---
  let lastActionKey = "";
  let lastActionFocus = false;

  const state = {
    settings: { userName: "", restaurant: "Zamówienia PRO", sections: DEFAULT_SECTIONS.slice() },
    ui: { filterSection: "", filterCategory: "", search: "", favMode: false, topMode: false, onlyInCart: false },
    catalog: [], // {id, name, category, sections[], createdAt}
    order: { items: [] },
    stats: { usage: {}, favorites: [] } // {id, name, category, qty, updatedAt, by}
  };

  function uid() {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function norm(s){ return String(s||"").replace(/\s+/g," ").trim(); }
  function capFirst(s){ s = norm(s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }

  function load() {
    try{
      const raw = localStorage.getItem(LS_KEY);
      if(raw){
        const data = JSON.parse(raw);
        if(data && typeof data === "object"){
          Object.assign(state, data);
        }
      }
    }catch(e){}
    // Ensure shapes
    state.settings ||= { userName:"", restaurant:"Zamówienia PRO", sections: DEFAULT_SECTIONS.slice() };
    state.settings.sections ||= DEFAULT_SECTIONS.slice();
    state.catalog ||= [];
    state.order ||= { items: [] };
    state.order.items ||= [];
  }

  function save() {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }

  function fmtDate(ts){
    if(!ts) return "—";
    const d = new Date(ts);
    // Use user's locale; include weekday.
    const opts = { weekday:"long", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" };
    return d.toLocaleString("pl-PL", opts);
  }

  function lastOrderTime(){
    const it = state.order.items;
    if(!it.length) return null;
    return it.reduce((m,x)=>Math.max(m, x.updatedAt || x.createdAt || 0), 0);
  }

  function uniqueBy(){
    const set = new Set();
    for(const it of state.order.items){
      if(it.by) set.add(it.by);
    }
    return Array.from(set);
  }

  function parseSections(val){
    if(!val) return [];
    if(Array.isArray(val)) return val.map(norm).filter(Boolean).map(capFirst);
    return String(val).split(",").map(norm).filter(Boolean).map(capFirst);
  }

  function getCheckedSections(){
    const box = $("secCheckboxes");
    if(!box) return [];
    const checks = box.querySelectorAll('input[type="checkbox"]:checked');
    return Array.from(checks).map(i=>capFirst(i.value));
  }

  function buildSections(){
    const set = new Set((state.settings.sections||DEFAULT_SECTIONS).map(capFirst));
    for(const p of state.catalog){
      for(const s of parseSections(p.sections)) set.add(capFirst(s));
    }
    return Array.from(set).sort((a,b)=>a.localeCompare(b,"pl"));
  }

  function buildCategories(section){
    const set = new Set(DEFAULT_CATS.map(capFirst));
    for(const p of state.catalog){
      if(section && section!=="Wszystkie" && section!=="__ALL__"){
        const secs = parseSections(p.sections);
        if(!secs.includes(section)) continue;
      }
      if(p.category) set.add(capFirst(p.category));
    }
    return Array.from(set).sort((a,b)=>a.localeCompare(b,"pl"));
  }

  function ensureSeed(){
    if(state.catalog.length) return;
    const seed = [
      ["Ogórek","Warzywa"],["Pomidor","Warzywa"],["Cebula","Warzywa"],["Sałata","Warzywa"],
      ["Kurczak","Mięso"],["Karkówka","Mięso"],["Kiełbasa","Mięso"],
      ["Masło","Nabiał"],["Mleko","Nabiał"],
      ["Frytki","Mrożonki"],["Lód","Mrożonki"],
      ["Mąka","Suchy magazyn"],["Ryż","Suchy magazyn"],["Cukier","Suchy magazyn"],
      ["Musztarda","Inne"],["Sos BBQ","Inne"]
    ];
    const now = Date.now();
    state.catalog = seed.map(([name, category]) => ({ id: uid(), name, category, sections: [], createdAt: now }));
    save();
  }

  // UI: header
  function renderHeader(){
    const rest = norm(state.settings.restaurant) || "Zamówienia PRO";
    document.querySelector(".brand__title").textContent = rest;

    const t = lastOrderTime();
    const who = uniqueBy();
    const sub = t
      ? `${fmtDate(t)} • ${who.length ? ("Kto: " + who.join(", ")) : "—"}`
      : "Brak pozycji w zamówieniu";
    $("hdrSub").textContent = sub;
  }

  // Panels
  function showPanel(id){
    for(const el of document.querySelectorAll(".panel")) el.classList.add("hidden");
    $(id).classList.remove("hidden");
    // pewne odświeżanie po przełączeniu zakładki
    renderAll();
    if(id === "panelCatalog") renderCatalogSectionPicker();
    // refresh export if needed
    if(id === "panelExport") renderExport();
  }

  function renderFilters(){
	  // Sekcja
	  const selSec = $("filterSection");
	  const secs = buildSections();
	  const currentSec = selSec.value || "__ALL__";
	  selSec.innerHTML = "";
	  const optAllSec = document.createElement("option");
	  optAllSec.value = "__ALL__";
	  optAllSec.textContent = "Wszystkie";
	  selSec.appendChild(optAllSec);
	  for(const s of secs){
	    const o = document.createElement("option");
	    o.value = s;
	    o.textContent = s;
	    selSec.appendChild(o);
	  }
	  selSec.value = secs.includes(currentSec) ? currentSec : "__ALL__";

	  // Kategoria (lista zależy od sekcji, żeby było czytelniej)
	  const sel = $("filterCategory");
	  const cats = buildCategories(selSec.value);
	  const current = sel.value || "__ALL__";

    sel.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "__ALL__";
    optAll.textContent = "Wszystkie";
    sel.appendChild(optAll);

    for(const c of cats){
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c;
      sel.appendChild(o);
    }

	  sel.value = cats.includes(current) ? current : "__ALL__";

	  // datalist for catalog add
	  const dl = $("catDatalist");
	  dl.innerHTML = "";
	  for(const c of buildCategories("__ALL__")){
	    const o = document.createElement("option");
	    o.value = c;
	    dl.appendChild(o);
	  }
	  const dlSec = $("secDatalist");
	  dlSec.innerHTML = "";
	  for(const s of secs){
	    const o = document.createElement("option");
	    o.value = s;
	    dlSec.appendChild(o);
	  }
  
    const favBtn = document.getElementById("btnFav");
    if(favBtn){
      // IMPORTANT: do NOT use textContent here, because it would remove
      // the <span class="hide-mobile">...</span> (and then "Ulubione" shows on phone).
      favBtn.innerHTML = `⭐<span class="hide-mobile"> Ulubione${state.ui.favMode ? " ✓" : ""}</span>`;
      favBtn.classList.toggle("primary", !!state.ui.favMode);
    }
    const topBtn = document.getElementById("btnTop");
    if(topBtn){
      topBtn.textContent = state.ui.topMode ? "Włączone" : "Wyłączone";
      topBtn.classList.toggle("primary", !!state.ui.topMode);
    }
    const onlyBtn = document.getElementById("btnOnlyCart");
    if(onlyBtn){
      onlyBtn.textContent = state.ui.onlyInCart ? "Włączone" : "Wyłączone";
      onlyBtn.classList.toggle("primary", !!state.ui.onlyInCart);
    }
  }

  function getFilteredProducts(){
	  const sec = $("filterSection").value || "__ALL__";
    const cat = $("filterCategory").value || "__ALL__";
    const q = norm($("filterSearch").value).toLowerCase();
    let arr = [...state.catalog];

	  if(sec !== "__ALL__"){
	    arr = arr.filter(p => parseSections(p.sections).includes(sec));
	  }
    if(cat !== "__ALL__"){
      arr = arr.filter(p => capFirst(p.category) === cat);
    }
    if(q){
      arr = arr.filter(p => (p.name||"").toLowerCase().includes(q));
    }
    if(state.ui.favMode){
      const favs = new Set(state.stats.favorites||[]);
      arr = arr.filter(p => favs.has((p.name||"").toLowerCase()));
    }
    if(state.ui.onlyInCart){
      const inCart = new Set(state.order.items.map(it => ((it.name||"").toLowerCase()) + "||" + ((it.category||"").toLowerCase())));
      arr = arr.filter(p => inCart.has(((p.name||"").toLowerCase()) + "||" + ((capFirst(p.category)||"").toLowerCase())));
    }
    if(state.ui.topMode){
      arr.sort((a,b)=>(state.stats.usage[(b.name||"").toLowerCase()]||0) - (state.stats.usage[(a.name||"").toLowerCase()]||0) || (a.name||"").localeCompare(b.name||"","pl"));
      arr = arr.slice(0, 40);
    }else{
      arr.sort((a,b)=>(a.name||"").localeCompare(b.name||"","pl"));
    }
    return arr;
  }

  function renderProductList(){
    // Preserve scroll position when re-rendering the list (mobile keyboard + rebuild)
    const prevScrollY = window.scrollY || 0;
    const vv = window.visualViewport;
    const activeEl = document.activeElement;

    // Key of the row we want to keep visible after re-render (either focused qty input, or last action)
    let keepKey = activeEl && activeEl.classList && activeEl.classList.contains("qty")
      ? (activeEl.closest(".item")?.getAttribute("data-key") || "")
      : "";
    if(!keepKey && lastActionKey) keepKey = lastActionKey;

    const list = $("productList");
    list.innerHTML = "";

    const arr = getFilteredProducts();
    const ordered = new Set(state.order.items.map(it => (it.name||"").toLowerCase()));
    if(!arr.length){
      const empty = document.createElement("div");
      empty.className = "card";
      empty.innerHTML = `<div class="small">Brak produktów. Dodaj w zakładce „Baza”.</div>`;
      list.appendChild(empty);
      return;
    }

    for(const p of arr){
      const row = document.createElement("div");
	  const key = ((p.name||"").toLowerCase()) + "||" + ((capFirst(p.category)||"Inne").toLowerCase());
      row.className = "item" + (ordered.has((p.name||"").toLowerCase()) ? " item--inCart" : "");
      row.setAttribute("data-key", key);
	      const secs = parseSections(p.sections);
	      const meta = [capFirst(p.category) || "Inne", secs.length ? `• ${secs.join(", ")}` : ""].filter(Boolean).join(" ");
	      row.innerHTML = `
        <div class="item__left">
          <div class="item__name">${escapeHtml(p.name)}</div>
	          <div class="item__meta">${escapeHtml(meta)}</div>
        </div>
        <div class="item__right">
          <input class="qty" inputmode="text" placeholder="np. 2kg" />
          <button class="starbtn" title="Ulubione">☆</button>
          <button class="smallbtn">➕</button>
        </div>
      `;
      const qtyEl = row.querySelector("input.qty");
      if(qtyEl){
        qtyEl.addEventListener("focus", ()=>{
          lastActionKey = key;
          lastActionFocus = true;
          rememberScroll();
          // iOS/Chrome: when keyboard opens, the focused input near bottom may stay under keyboard/header.
          // Run a few times to catch late visualViewport adjustments.
          setTimeout(()=>ensureInputVisible(qtyEl), 40);
          setTimeout(()=>ensureInputVisible(qtyEl), 140);
          setTimeout(()=>ensureInputVisible(qtyEl), 260);
        });
        qtyEl.addEventListener("blur", ()=>{
          // User stopped editing; allow normal scroll behavior on next renders
          lastActionFocus = false;
        });
      }

      const starBtn = row.querySelector("button.starbtn");
      if(starBtn){
        // Do not steal focus from qty input on mobile
        try{ starBtn.setAttribute("tabindex","-1"); }catch(e){}
        // Keep mobile UX smooth without cancelling the click event
        starBtn.addEventListener("pointerdown", (ev)=>{ ev.stopPropagation(); });
        starBtn.addEventListener("touchstart", (ev)=>{ ev.stopPropagation(); }, {passive:true});

        const on = isFav(p.name);
        starBtn.classList.toggle("on", on);
        starBtn.textContent = on ? "★" : "☆";
        starBtn.addEventListener("click", (ev)=>{
          ev.preventDefault(); ev.stopPropagation();
          toggleFav(p.name);
          const now = isFav(p.name);
          starBtn.classList.toggle("on", now);
          starBtn.textContent = now ? "★" : "☆";
        });
      }

      const btn = row.querySelector("button.smallbtn");
      if(btn){
        // Prevent button from stealing focus (iOS hides the input behind keyboard/header after tap)
        try{ btn.setAttribute("tabindex","-1"); }catch(e){}
        btn.addEventListener("pointerdown", (ev)=>{ ev.preventDefault(); });
        btn.addEventListener("touchstart", (ev)=>{ ev.preventDefault(); }, {passive:false});
      }


      btn.addEventListener("click", () => {
        const qty = norm(qtyEl.value);
        if(!qty){ toast("Wpisz ilość"); return; }
        lastActionKey = key;
        lastActionFocus = true;
        rememberScroll();
        addToOrder(p, qty);
        row.classList.add("item--flash");
        setTimeout(()=>row.classList.remove("item--flash"), 650);
        // Keep keyboard open and keep editing context visible
        qtyEl.value = "";
        setTimeout(()=>{
          try{ qtyEl.focus({ preventScroll:true }); }catch(e){ try{ qtyEl.focus(); }catch(e2){} }
          ensureInputVisible(qtyEl);
        }, 30);
        setTimeout(()=>ensureInputVisible(qtyEl), 160);
      });

      qtyEl.addEventListener("keydown", (ev) => {
        if(ev.key === "Enter"){
          ev.preventDefault();
          rememberScroll();
          btn.click();
        }
      });

      list.appendChild(row);
    }
    updateCartCount();

    // Restore scroll (avoid fighting iOS keyboard viewport changes while editing quantity)
    if(!lastActionFocus){
      try{ window.scrollTo({ top: prevScrollY, left: 0, behavior: "auto" }); }catch(e){ window.scrollTo(0, prevScrollY); }
    }

    try{
      if(keepKey){
        const header = document.querySelector('.app-header');
        const headerH = header ? header.getBoundingClientRect().height : 0;
        const topPad = Math.round(headerH + 24);
        const bottomPad = 16;
        const viewH = (vv && vv.height) ? vv.height : window.innerHeight;

        const rowEl = document.querySelector(`.item[data-key="${cssEscape(keepKey)}"]`);
        if(rowEl){
          const r = rowEl.getBoundingClientRect();
          // If hidden under header, scroll up a bit so it sits below header
          if(r.top < topPad){
            window.scrollBy({ top: (r.top - topPad), left: 0, behavior: "auto" });
          }else if(r.bottom > (viewH - bottomPad)){
            window.scrollBy({ top: (r.bottom - (viewH - bottomPad)), left: 0, behavior: "auto" });
          }
        }
      }
    

    // If user is editing a quantity, re-focus the same row after re-render (Safari/iOS loses focus on DOM rebuild)
    try{
      if(lastActionFocus && keepKey){
        const rowEl2 = document.querySelector(`.item[data-key="${cssEscape(keepKey)}"]`);
        const input2 = rowEl2 ? rowEl2.querySelector('input.qty') : null;
        if(input2){
          // preventScroll avoids Safari doing its own jump; we handle visibility ourselves
          setTimeout(()=>{
            try{ input2.focus({ preventScroll: true }); }catch(e){ try{ input2.focus(); }catch(e2){} }
            ensureInputVisible(input2);
          }, 50);
        }
      }
    }catch(e){}
}catch(e){}

    // one-shot: only keep last action for the next render
    if(!lastActionFocus) lastActionKey = "";
}

  function addToOrder(prod, qty){
    const by = norm(state.settings.userName) || "—";
    const category = capFirst(prod.category) || "Inne";
    const name = capFirst(prod.name);

    // merge if same product+category
    const it = state.order.items.find(x => x.name === name && x.category === category);
    const now = Date.now();
    if(it){
      it.qty = mergeQty(it.qty, qty);
      it.updatedAt = now;
      it.by = it.by && it.by !== by ? it.by : by; // keep if mixed; we'll track via list anyway
    }else{
      state.order.items.push({ id: uid(), name, category, qty, updatedAt: now, by });
    }
    toast("Dodano do koszyka ✅");
    // usage stats
    const ukey = (prod.name||"").toLowerCase();
    state.stats.usage[ukey] = (state.stats.usage[ukey]||0) + 1;
    renderProductList();
    updateCartCount();
    if(liveCanWrite()){
	      // BUGFIX: previously used an undefined variable `p` here.
	      // We must pass the product we are adding.
	      liveAddItem(prod, qty).catch(e=>{console.error(e); toast("Błąd LIVE zapisu");});
    }else{
      save();
      renderAll();
    }
  }

  function mergeQty(oldQ, addQ){
    // Simple logic: if both are "number+unit" with same unit, add; otherwise concat " + ".
    const a = parseQty(oldQ);
    const b = parseQty(addQ);
    if(a && b && a.num != null && b.num != null && (a.unit||"") === (b.unit||"")){
      const n = a.num + b.num;
      return formatNum(n) + (a.unit || "");
    }
    if(!norm(oldQ)) return norm(addQ);
    return norm(oldQ) + " + " + norm(addQ);
  }

  function parseQty(s){
    s = norm(s);
    if(!s) return null;
    const m = s.match(/^([0-9]+(?:[.,][0-9]+)?)\s*([^\d]*)$/);
    if(!m) return { raw:s, num:null, unit:null };
    const num = parseFloat(m[1].replace(",", "."));
    const unit = norm(m[2] || "");
    return { raw:s, num: Number.isFinite(num) ? num : null, unit };
  }
  function formatNum(n){
    const isInt = Math.abs(n - Math.round(n)) < 1e-10;
    if(isInt) return String(Math.round(n));
    let str = n.toFixed(3).replace(/0+$/,"").replace(/\.$/,"");
    return str.replace(".", ",");
  }

  function renderBasket(){
    const items = [...state.order.items];

    const targetIds = ["basket","basketExport"];
    for(const id of targetIds){
      const el = document.getElementById(id);
      if(!el) continue;
      const box = $(id);

      if(!items.length){
        box.innerHTML = `<div class="basket__empty">Koszyk pusty. Dodaj coś z listy produktów.</div>`;
        continue;
      }

      // group by category
      const sorted = [...items].sort((a,b)=> (a.category||"").localeCompare(b.category||"","pl") || (a.name||"").localeCompare(b.name||"","pl"));
      const groups = new Map();
      for(const it of sorted){
        const k = capFirst(it.category) || "Inne";
        if(!groups.has(k)) groups.set(k, []);
        groups.get(k).push(it);
      }

      box.innerHTML = "";
      for(const [cat, arr] of groups.entries()){
        const g = document.createElement("div");
        g.className = "group";
        g.innerHTML = `<div class="group__title">=== ${escapeHtml(cat.toUpperCase())} ===</div>`;
        for(const it of arr){
          const r = document.createElement("div");
          r.className = "brow";
          r.innerHTML = `
            <div class="brow__left">
              <div class="brow__name">${escapeHtml(it.name)}</div>
              <div class="brow__by">Dodane przez: ${escapeHtml(it.by || "—")}</div>
            </div>
            <div class="brow__right">
              <div class="brow__qty" title="Kliknij, żeby edytować">${escapeHtml(it.qty)}</div>
              <button class="smallbtn danger" title="Usuń">🗑</button>
            </div>
          `;
          const qty = r.querySelector(".brow__qty");
          const del = r.querySelector("button");

          qty.addEventListener("click", () => {
            const v = prompt(`Zmień ilość: ${it.name}`, it.qty);
            if(v === null) return;
            const nv = norm(v);
            if(!nv){ toast("Ilość nie może być pusta"); return; }

            // LIVE sync: edycja ma być widoczna na innych urządzeniach
            if(it.__live && liveCanWrite()){
              liveSetItemQty(it, nv).catch(e=>{ console.error(e); toast("Błąd LIVE zapisu"); });
              return;
            }

            it.qty = nv;
            save();
            renderAll();
          });

          del.addEventListener("click", () => {
            if(!confirm(`Usunąć: ${it.name}?`)) return;

            // LIVE sync: usuń z bazy, żeby zniknęło na wszystkich urządzeniach
            if(it.__live && liveCanWrite()){
              liveDeleteItem(it).catch(e=>{ console.error(e); toast("Błąd LIVE usuwania"); });
              return;
            }

            // lokalnie
            if(it.id){
              state.order.items = state.order.items.filter(x => x && x.id !== it.id);
            }else{
              state.order.items = state.order.items.filter(x => !(x.name===it.name && x.category===it.category && x.by===it.by && x.qty===it.qty));
            }
            save();
            renderAll();
          });
g.appendChild(r);
        }
        box.appendChild(g);
      }
    }
  }

  function renderCatalog(){
    const list = $("catalogList");
    const ordered = new Set(state.order.items.map(it => (it.name||"").toLowerCase()));
    list.innerHTML = "";
    const arr = [...state.catalog].sort((a,b)=>(a.category||"").localeCompare(b.category||"","pl") || (a.name||"").localeCompare(b.name||"","pl"));
    if(!arr.length){
      list.innerHTML = `<div class="card"><div class="small">Brak produktów. Dodaj je powyżej albo kliknij „Wgraj przykładowe”.</div></div>`;
      return;
    }

    for(const p of arr){
      const row = document.createElement("div");
      row.className = "item" + (ordered.has((p.name||"").toLowerCase()) ? " item--inCart" : "");
      row.innerHTML = `
        <div class="item__left">
          <div class="item__name">${escapeHtml(p.name)}</div>
          <div class="item__meta">${escapeHtml(capFirst(p.category) || "Inne")}</div>
        </div>
        <div class="item__right">
          <button class="smallbtn danger" title="Usuń">🗑</button>
        </div>
      `;
      const del = row.querySelector("button");
      del.addEventListener("click", () => {
        if(!confirm(`Usunąć z bazy: ${p.name}?`)) return;
        state.catalog = state.catalog.filter(x => x.id !== p.id);
        save();
        renderAll();
      });
      list.appendChild(row);
    }
    updateCartCount();
  }

  function renderCatalogSectionPicker(){
    const box = $("secCheckboxes");
    if(!box) return;
    box.innerHTML = "";
    const sections = buildSections();
    if(!sections.length){
      box.innerHTML = `<div class="small" style="opacity:.8">Brak sekcji. Dodaj je w Ustawieniach.</div>`;
      return;
    }
    for(const s of sections){
      const id = `sec_${s.replace(/\s+/g,'_')}`;
      const lab = document.createElement("label");
      lab.className = "chip";
      lab.style.cursor = "pointer";
      lab.innerHTML = `<input type="checkbox" value="${escapeHtml(s)}" id="${id}"> <span>${escapeHtml(s)}</span>`;
      box.appendChild(lab);
    }

    // sync to text input
    box.addEventListener("change", () => {
      const vals = getCheckedSections();
      $("newProdSections").value = vals.join(", ");
    }, { once:false });
  }

  function buildExportText(){
    const items = [...state.order.items];
    if(!items.length){
      return { title:"ZAMÓWIENIE", date:"—", meta:"Brak pozycji.", textBody:"Brak pozycji w zamówieniu.", textFull:"Brak pozycji w zamówieniu." };
    }

    const t = lastOrderTime();
    const dateStr = fmtDate(t);
    const who = uniqueBy();
    const meta = `Zamówione przez: ${who.length ? who.join(", ") : "-"}`;

    // group and format
    items.sort((a,b)=> (a.category||"").localeCompare(b.category||"","pl") || (a.name||"").localeCompare(b.name||"","pl"));
    const groups = new Map();
    for(const it of items){
      const k = capFirst(it.category) || "Inne";
      if(!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    const bodyLines = [];

    for(const [cat, arr] of groups.entries()){
      bodyLines.push(`=== ${cat.toUpperCase()} ===`);
      for(const it of arr){
        bodyLines.push(`- ${it.name}: ${it.qty}`);
      }
      bodyLines.push("");
    }

    const textBody = bodyLines.join("\n").trim();
    const textFull = [meta, `Data: ${dateStr}`, "", textBody].join("\n").trim();
    return { title:"ZAMÓWIENIE", date:dateStr, meta, textBody, textFull };
  }

  
  function openExport(){
    showPanel("panelExport");
    renderExport();
    renderBasket();
  }

function renderExport(){
    const out = buildExportText();
    $("expTitle").textContent = out.title;
    $("expDate").textContent = out.date;
    $("expMeta").textContent = out.meta;
    $("exportText").value = out.textBody;
  }

  function updateCartCount(){
    const n = (state.order.items||[]).length;
    const badge = document.getElementById("cartCount");
    if(badge){
      badge.textContent = String(n);
      badge.style.display = n ? "inline-flex" : "none";
    }
  }

  function renderAll(){
    renderHeader();
    renderFilters();
    renderProductList();
    updateCartCount();
    renderBasket();
    renderCatalog();
    updateCartCount();
    // export lazy
  }

  // Settings sheet
  function openSheet(){
    $("sheet").classList.remove("hidden");
    $("userName").value = state.settings.userName || "";
    $("restName").value = state.settings.restaurant || "Zamówienia PRO";
  }
  function closeSheet(){ $("sheet").classList.add("hidden"); }

  // Toast
  let toastTimer = null;
  function toast(msg){
    let el = document.getElementById("toast");
    if(!el){
      el = document.createElement("div");
      el.id = "toast";
      el.style.position = "fixed";
      el.style.left = "50%";
      el.style.bottom = "18px";
      el.style.transform = "translateX(-50%)";
      el.style.background = "rgba(0,0,0,.78)";
      el.style.color = "#fff";
      el.style.padding = "10px 12px";
      el.style.borderRadius = "12px";
      el.style.border = "1px solid rgba(255,255,255,.18)";
      el.style.zIndex = "999";
      el.style.fontWeight = "800";
      el.style.maxWidth = "92vw";
      el.style.textAlign = "center";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "block";
    if(toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = "none"; }, 1800);
  }

  function escapeAttr(s){ return String(s||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  function escapeHtml(s){
    return String(s ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  // --- Historia PDF (lokalnie) ---
  const HISTORY_KEY = "zamowienia_pro_history_v1";

  // --- Lokalna lista zamówień (gdy LIVE wyłączone) ---
  const LOCAL_ORDERS_KEY = "zamowienia_pro_orders_local_v1";
  const LOCAL_CURRENT_KEY = "zamowienia_pro_orders_current_v1";

  function localOrdersLoad(){
    try{ return JSON.parse(localStorage.getItem(LOCAL_ORDERS_KEY) || "[]") || []; }catch(e){ return []; }
  }
  function localOrdersSave(list){
    try{ localStorage.setItem(LOCAL_ORDERS_KEY, JSON.stringify(list || [])); }catch(e){}
  }
  function localOrdersEnsureCurrent(){
    if(LIVE.ready) return;
    let id = localStorage.getItem(LOCAL_CURRENT_KEY) || "";
    if(id) return;
    id = "o" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    localStorage.setItem(LOCAL_CURRENT_KEY, id);
    const list = localOrdersLoad();
    list.unshift({ id, name: state.settings.userName ? ("Zamówienie – " + state.settings.userName) : "Zamówienie", status: "open", createdAt: Date.now(), updatedAt: Date.now(), lastPdfHurt: "" });
    localOrdersSave(list);
  }
  function localOrdersTouch(){
    if(LIVE.ready) return;
    localOrdersEnsureCurrent();
    const id = localStorage.getItem(LOCAL_CURRENT_KEY);
    const list = localOrdersLoad();
    const i = list.findIndex(x=>x && x.id === id);
    if(i>=0){ list[i].updatedAt = Date.now(); }
    localOrdersSave(list);
  }
  function localOrdersSetLastPdf(pdfId){
    if(LIVE.ready) return;
    localOrdersEnsureCurrent();
    const id = localStorage.getItem(LOCAL_CURRENT_KEY);
    const list = localOrdersLoad();
    const i = list.findIndex(x=>x && x.id === id);
    if(i>=0){
      list[i].lastPdfHurt = pdfId;
      list[i].updatedAt = Date.now();
    }
    localOrdersSave(list);
  }
  function localOrdersNew(){
    if(LIVE.ready) return;
    localOrdersEnsureCurrent();
    const cur = localStorage.getItem(LOCAL_CURRENT_KEY);
    const list = localOrdersLoad();
    const i = list.findIndex(x=>x && x.id === cur);
    if(i>=0){ list[i].status = "closed"; list[i].updatedAt = Date.now(); }
    const id = "o" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    localStorage.setItem(LOCAL_CURRENT_KEY, id);
    list.unshift({ id, name: state.settings.userName ? ("Zamówienie – " + state.settings.userName) : "Zamówienie", status: "open", createdAt: Date.now(), updatedAt: Date.now(), lastPdfHurt: "" });
    localOrdersSave(list);
  }

  function loadHistory(){
    try{ return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") || []; }catch(e){ return []; }
  }
  function saveHistory(list){
    try{ localStorage.setItem(HISTORY_KEY, JSON.stringify(list || [])); }catch(e){}
  }
  function historyAdd(entry){
    const list = loadHistory();
    list.unshift(entry);
    // limit (żeby localStorage nie puchło)
    if(list.length > 80) list.length = 80;
    saveHistory(list);
  }
  function historyDelete(id){
    const list = loadHistory().filter(x => x && x.id !== id);
    saveHistory(list);
  }
  function historyClearAll(){
    saveHistory([]);
  }

  // --- Drukowanie HTML: popup -> fallback iframe (tablet/PWA) ---
  function printHtmlViaIframe(html){
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      try{ iframe.contentWindow.focus(); iframe.contentWindow.print(); }
      catch(e){ alert("Nie udało się uruchomić wydruku (iframe)."); }
      finally{ setTimeout(()=>{ try{ iframe.remove(); }catch(e){} }, 1500); }
    };
  }

  function openPrintDoc(html, winName){
    let win = null;
    try{ win = window.open("", winName || "PRINT", "width=900,height=700"); }catch(e){ win = null; }
    if(!win){
      printHtmlViaIframe(html);
      return;
    }
    try{
      win.document.open();
      win.document.write(html);
      win.document.close();
    }catch(e){
      // jeżeli coś poszło nie tak (np. Safari), spróbuj iframe
      try{ win.close(); }catch(_e){}
      printHtmlViaIframe(html);
    }
  }

  // --- UI: Menedżer zamówień (LIVE + lokalnie) ---
  function ordersModalEl(id){ return document.getElementById(id); }

  const ORDERS_UI = { tab: "orders", q: "", status: "all", sort: "updated_desc" };
  let __liveOrdersCache = null; // [{name, status, orderId, updatedAt, createdAt, __aliasId}]
  let __ordersUnsub = null;

  function ordersIsOpen(){
    const m = ordersModalEl("ordersModal");
    return !!(m && !m.classList.contains("hidden"));
  }

  function ordersStartLiveListener(){
    if(!LIVE.ready) return;
    if(__ordersUnsub) return;
    try{
      __ordersUnsub = LIVE.db.collection("orderAliases").orderBy("updatedAt","desc").limit(200)
        .onSnapshot((snap)=>{
          const rows = [];
          snap.forEach(doc=>{
            const d = doc.data()||{};
            const name = norm(d.name || d.displayName || d.title || "") || (d.orderId || doc.id);
            const status = (d.status||"open");
            const updatedAt = d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : (d.updatedAt || 0);
            const createdAt = d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : (d.createdAt || 0);
            const orderId = d.orderId || "";
            rows.push({ name, status, orderId, updatedAt, createdAt, __aliasId: doc.id });
          });
          __liveOrdersCache = rows;
          if(ordersIsOpen() && ORDERS_UI.tab === "orders"){
            ordersRender();
          }
        }, (err)=>{ console.warn(err); });
    }catch(e){
      console.warn(e);
    }
  }

  function ordersStopLiveListener(){
    if(__ordersUnsub){
      try{ __ordersUnsub(); }catch(e){}
      __ordersUnsub = null;
    }
  }


  function ordersOpen(tab){
    if(tab) ORDERS_UI.tab = tab;
    const m = ordersModalEl("ordersModal");
    if(m){ m.classList.remove("hidden"); m.setAttribute("aria-hidden","false"); }
    ordersStartLiveListener();
    ordersRender();
  }
  function ordersClose(){
    const m = ordersModalEl("ordersModal");
    if(m){ m.classList.add("hidden"); m.setAttribute("aria-hidden","true"); }
    ordersStopLiveListener();
  }

  function statusBadgeHtml(st){
    const s = (st||"").toLowerCase();
    if(s === "closed") return `<span class="status-badge status-badge--closed">Zamknięte</span>`;
    return `<span class="status-badge status-badge--open">Otwarte</span>`;
  }

  function ordersApplyUiFromControls(){
    const q = ordersModalEl("ordersSearch");
    const st = ordersModalEl("ordersStatus");
    const so = ordersModalEl("ordersSort");
    ORDERS_UI.q = norm(q ? q.value : "");
    ORDERS_UI.status = st ? st.value : "all";
    ORDERS_UI.sort = so ? so.value : "updated_desc";
  }

  function ordersSyncControls(){
    const t1 = ordersModalEl("ordersTabOrders");
    const t2 = ordersModalEl("ordersTabPdfs");
    if(t1) t1.classList.toggle("primary", ORDERS_UI.tab === "orders");
    if(t2) t2.classList.toggle("primary", ORDERS_UI.tab === "pdfs");
  }

  async function liveFetchOrdersList(){
    if(!LIVE.ready) return [];
    try{
      const snap = await LIVE.db.collection("orderAliases").orderBy("updatedAt","desc").limit(200).get();
      const rows = [];
      snap.forEach(doc=>{
        const d = doc.data()||{};
        const name = norm(d.name || d.displayName || d.title || "") || (d.orderId || doc.id);
        const status = (d.status||"open");
        const updatedAt = d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : (d.updatedAt || 0);
        const createdAt = d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : (d.createdAt || 0);
        const orderId = d.orderId || "";
        rows.push({ name, status, orderId, updatedAt, createdAt, __aliasId: doc.id });
      });

      // dopnij createdAt/updatedAt z dokumentu order, jeśli brakuje
      const need = rows.filter(r=>r.orderId && (!r.createdAt || !r.updatedAt));
      await Promise.all(need.map(async (r)=>{
        try{
          const od = await liveOrderRef(r.orderId).get();
          const d = od.data()||{};
          if(!r.createdAt){
            const ca = d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : (d.createdAt || 0);
            if(ca) r.createdAt = ca;
          }
          if(!r.updatedAt){
            const ua = d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : (d.updatedAt || 0);
            if(ua) r.updatedAt = ua;
          }
          if(!r.name && d.name) r.name = norm(d.name);
        }catch(e){}
      }));

      __liveOrdersCache = rows;
      return rows;
    }catch(e){
      console.warn(e);
      return [];
    }
  }

  function sortRows(rows){
    const s = ORDERS_UI.sort || "updated_desc";
    const byUpd = (a,b)=>(b.updatedAt||0) - (a.updatedAt||0);
    const byUpdAsc = (a,b)=>(a.updatedAt||0) - (b.updatedAt||0);
    const byName = (a,b)=>(a.name||"").localeCompare(b.name||"","pl");
    const byNameDesc = (a,b)=>(b.name||"").localeCompare(a.name||"","pl");
    if(s === "updated_asc") rows.sort(byUpdAsc);
    else if(s === "name_asc") rows.sort(byName);
    else if(s === "name_desc") rows.sort(byNameDesc);
    else rows.sort(byUpd);
  }

  function filterRows(rows){
    const q = (ORDERS_UI.q||"").toLowerCase();
    const st = ORDERS_UI.status || "all";
    let arr = rows.slice();
    if(st !== "all") arr = arr.filter(r => (r.status||"open") === st);
    if(q) arr = arr.filter(r => ((r.name||"") + " " + (r.orderId||"")).toLowerCase().includes(q));
    return arr;
  }

  function renderPdfHistory(){
    const box = ordersModalEl("ordersList");
    const help = ordersModalEl("ordersHelp");
    if(help){
      help.textContent = "Tu są zapisane wydruki PDF. Kliknij PDF, żeby ponownie wydrukować. 🗑 usuwa wpis z listy.";
    }
    if(!box) return;
    const list = loadHistory();
    if(!list.length){
      box.innerHTML = '<div class="small" style="opacity:.85">Brak zapisanych PDF. Wydrukuj „PDF Hurtownia”, a pojawią się tutaj.</div>';
      return;
    }
    box.innerHTML = list.map(x=>{
      const kind = "Hurtownia";
      const title = escapeHtml(x.title || "Zamówienie");
      const date = escapeHtml(x.date || "—");
      const meta = escapeHtml(x.meta || "");
      const id = escapeAttr(x.id);
      return `
        <div class="order-item">
          <div class="order-item__meta">
            <div class="order-item__title">${title}</div>
            <div class="order-item__sub">${date} <span class="dot">•</span> ${kind}${meta ? " <span class='dot'>•</span> " + meta : ""}</div>
          </div>
          <div class="order-item__actions">
            <button class="btn" type="button" onclick="window.__ordersPrint('${id}')">📄 PDF</button>
            <button class="btn danger" type="button" onclick="window.__ordersDel('${id}')">🗑</button>
          </div>
        </div>`;
    }).join("");
  }

  async function livePrintOrder(orderId){
    if(!LIVE.ready || !orderId){ toast("Brak danych zamówienia"); return; }
    try{
      const odSnap = await liveOrderRef(orderId).get();
      const od = odSnap.data()||{};
      const orderName = norm(od.name) || "Zamówienie";

      const itemsSnap = await liveOrderRef(orderId).collection("items").get();
      const items = [];
      itemsSnap.forEach(doc=>{
        const d = doc.data()||{};
        items.push({ name: d.name||"", category: d.category||"", qty: d.qty||"", updatedAt: d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : (d.updatedAt||0), by: (d.by && Array.isArray(d.by)) ? d.by.join(", ") : (d.by||"") });
      });
      if(!items.length){ toast("To zamówienie nie ma pozycji"); return; }

      // zbuduj meta
      const bySet = new Set();
      for(const it of items){ if(it.by) String(it.by).split(",").map(s=>norm(s)).filter(Boolean).forEach(s=>bySet.add(s)); }
      const meta = `Zamówione przez: ${Array.from(bySet).join(", ") || "-"}`;
      const t = items.reduce((m,x)=>Math.max(m, x.updatedAt||0), 0);
      const dateStr = fmtDate(t || Date.now());

      // grupowanie jak w export
      items.sort((a,b)=> (a.category||"").localeCompare(b.category||"","pl") || (a.name||"").localeCompare(b.name||"","pl"));
      const groups = new Map();
      for(const it of items){
        const k = capFirst(it.category) || "Inne";
        if(!groups.has(k)) groups.set(k, []);
        groups.get(k).push(it);
      }
      const bodyLines = [];
      for(const [cat, arr] of groups.entries()){
        bodyLines.push(`=== ${cat.toUpperCase()} ===`);
        for(const it of arr){ bodyLines.push(`- ${it.name}: ${it.qty}`); }
        bodyLines.push("");
      }
      const textBody = bodyLines.join("\n").trim();

      const out = { title: orderName, date: dateStr, meta, textBody, textFull: [meta, `Data: ${dateStr}`, "", textBody].join("\n").trim() };

      const html = buildHurtPrintHtml(out);
      historyAdd({ id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2,6), kind: "hurtownia", title: out.title, date: out.date, meta: out.meta, createdAt: Date.now(), html, orderId, orderName });
      openPrintDoc(html, "PRINT_HURT");
    }catch(e){
      console.error(e);
      toast("Nie udało się przygotować PDF");
    }
  }

  async function liveDeleteOrderRow(row){
    if(!LIVE.ready) return;
    if(!row || !row.orderId) return;
    const name = row.name || row.orderId;
    if(!confirm(`Usunąć zamówienie „${name}”?\nTo skasuje pozycje i wpis z listy.`)) return;
    try{
      // delete items in chunks
      const itemsRef = liveOrderRef(row.orderId).collection("items");
      const snap = await itemsRef.get();
      const docs = snap.docs || [];
      for(let i=0;i<docs.length;i+=400){
        const batch = LIVE.db.batch();
        for(const d of docs.slice(i,i+400)) batch.delete(d.ref);
        await batch.commit();
      }
      await liveOrderRef(row.orderId).delete();
      if(row.__aliasId) await LIVE.db.collection("orderAliases").doc(row.__aliasId).delete();
      if(LIVE.orderId === row.orderId){
        LIVE.orderId = "";
        localStorage.removeItem(LS_ORDER);
        localStorage.removeItem("LIVE_ALIAS");
        $("hdrSub").textContent = "—";
      }
      toast("Usunięto");
      await ordersRender();
    }catch(e){
      console.error(e);
      toast("Nie udało się usunąć");
    }
  }
  async function liveCloseOrderRow(row){
    if(!LIVE.ready) return;
    if(!row || !row.orderId) return;
    if((row.status||"open") === "closed"){ toast("Już zamknięte"); return; }
    const name = row.name || row.orderId;
    if(!confirm(`Zamknąć zamówienie „${name}”?\nPo zamknięciu nie da się dodawać.`)) return;
    try{
      await liveOrderRef(row.orderId).set({
        status:"closed",
        closedAt: firebase.firestore.FieldValue.serverTimestamp(),
        closedBy: norm(state.settings.userName)||""
      }, {merge:true});
      if(row.__aliasId){
        await LIVE.db.collection("orderAliases").doc(row.__aliasId).set({
          status:"closed",
          closedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, {merge:true});
      }
      toast("Zamknięto");
    }catch(e){
      console.error(e);
      toast("Nie udało się zamknąć");
    }
  }

  async function ordersRender(){
    ordersSyncControls();
    ordersApplyUiFromControls();
    const help = ordersModalEl("ordersHelp");
    const box = ordersModalEl("ordersList");
    if(!box) return;

    if(ORDERS_UI.tab === "pdfs"){
      renderPdfHistory();
      return;
    }

    if(help){
      help.textContent = LIVE.ready
        ? "Lista zamówień LIVE: nazwa, data, status. PDF drukuje bez przełączania zamówienia. 🗑 usuwa zamówienie z bazy (razem z pozycjami)."
        : "Lista lokalna (bez LIVE): zapisuje się po „Kopiuj” i „Nowe zamówienie”.";
    }

    box.innerHTML = '<div class="small" style="opacity:.85">Ładowanie…</div>';

    // LIVE
    if(LIVE.ready){
      const rows = (__liveOrdersCache && __liveOrdersCache.length) ? __liveOrdersCache : await liveFetchOrdersList();
      let arr = filterRows(rows);
      sortRows(arr);
      if(!arr.length){ box.innerHTML = '<div class="small" style="opacity:.85">Brak zamówień do pokazania.</div>'; return; }

      box.innerHTML = arr.map(r=>{
        const title = escapeHtml(r.name || r.orderId || "Zamówienie");
        const dt = fmtDate(r.updatedAt || r.createdAt || 0);
        const oid = escapeAttr(r.orderId || "");
        const aliasId = escapeAttr(r.__aliasId || "");
        const canClose = (r.status||"open") !== "closed";
        const closeBtn = canClose
          ? `<button class="btn" type="button" onclick="window.__orderClose('${oid}','${aliasId}')">Zamknij</button>`
          : `<button class="btn" type="button" disabled>Zamknięte</button>`;
        return `
          <div class="order-item">
            <div class="order-item__meta">
              <div class="order-item__title">${title}</div>
              <div class="order-item__sub">${escapeHtml(dt)} <span class="dot">•</span> ${statusBadgeHtml(r.status)}</div>
            </div>
            <div class="order-item__actions">
              <button class="btn" type="button" onclick="window.__orderOpen('${escapeAttr(r.name||"")}')">Otwórz</button>
              ${closeBtn}
              <button class="btn" type="button" onclick="window.__orderPdf('${oid}','hurtownia')">📄 PDF</button>
              <button class="btn danger" type="button" onclick="window.__orderDel('${oid}','${aliasId}')">🗑</button>
            </div>
          </div>`;
      }).join("");
      return;
    }

    // OFFLINE (lokalna lista zamówień)
    localOrdersEnsureCurrent();
    let rows = localOrdersLoad();
    rows = filterRows(rows);
    sortRows(rows);
    if(!rows.length){ box.innerHTML = '<div class="small" style="opacity:.85">Brak zamówień do pokazania.</div>'; return; }

    box.innerHTML = rows.map(r=>{
      const title = escapeHtml(r.name || "Zamówienie");
      const dt = fmtDate(r.updatedAt || r.createdAt || 0);
      const id = escapeAttr(r.id || "");
      const hasHurt = !!r.lastPdfHurt;
      const canClose = (r.status||"open") !== "closed";
      const closeBtn = canClose
        ? `<button class="btn" type="button" onclick="window.__localOrderClose('${id}')">Zamknij</button>`
        : `<button class="btn" type="button" disabled>Zamknięte</button>`;
      return `
        <div class="order-item">
          <div class="order-item__meta">
            <div class="order-item__title">${title}</div>
            <div class="order-item__sub">${escapeHtml(dt)} <span class="dot">•</span> ${statusBadgeHtml(r.status)}</div>
          </div>
          <div class="order-item__actions">
            <button class="btn" type="button" ${hasHurt ? `onclick="window.__localPdf('${escapeAttr(r.lastPdfHurt)}')"` : "disabled"}>📄 PDF</button>
            ${closeBtn}
            <button class="btn danger" type="button" onclick="window.__localOrderDel('${id}')">🗑</button>
          </div>
        </div>`;
    }).join("");
  }

  // expose handlers for inline buttons
  window.__ordersPrint = (id)=>{
    const e = loadHistory().find(x=>x && x.id === id);
    if(!e || !e.html){ toast("Brak danych PDF"); return; }
    openPrintDoc(e.html, "PRINT_FROM_HISTORY");
  };
  window.__ordersDel = (id)=>{
    if(!confirm("Usunąć ten wpis z listy?")) return;
    historyDelete(id);
    ordersRender();
  };
  window.__orderPdf = (orderId)=>{ livePrintOrder(orderId); };
  window.__orderDel = (orderId, aliasId)=>{
    liveDeleteOrderRow({ orderId, __aliasId: aliasId });
  };
  window.__orderClose = (orderId, aliasId)=>{
    liveCloseOrderRow({ orderId, __aliasId: aliasId });
  };
  window.__orderOpen = async (name)=>{
    // otwórz / dołącz po nazwie
    if(!LIVE.ready){ toast("LIVE nie jest włączone"); return; }
    const ok = await liveJoinOrder(name);
    if(ok){ ordersClose(); showPanel("panelOrder"); }
  };

  window.__localPdf = (histId)=>{
    const e = loadHistory().find(x=>x && x.id === histId);
    if(!e || !e.html){ toast("Brak danych PDF"); return; }
    openPrintDoc(e.html, "PRINT_FROM_LOCAL");
  };
  window.__localOrderDel = (id)=>{
    if(!confirm("Usunąć to zamówienie z listy lokalnej?")) return;
    const list = localOrdersLoad().filter(x=>x && x.id !== id);
    localOrdersSave(list);
    const cur = localStorage.getItem(LOCAL_CURRENT_KEY);
    if(cur === id) localStorage.removeItem(LOCAL_CURRENT_KEY);
    ordersRender();
  };

  window.__localOrderClose = (id)=>{
    const list = localOrdersLoad();
    const it = list.find(x=>x && x.id === id);
    if(!it){ toast("Brak zamówienia"); return; }
    if((it.status||"open")==="closed"){ toast("Już zamknięte"); return; }
    if(!confirm(`Zamknąć zamówienie „${it.name||"Zamówienie"}”?`)) return;
    it.status = "closed";
    it.updatedAt = Date.now();
    localOrdersSave(list);
    toast("Zamknięto");
    ordersRender();
  };


  window.__localOrderClose = (id)=>{
    const list = localOrdersLoad();
    const it = list.find(x=>x && x.id === id);
    if(!it){ toast("Brak zamówienia"); return; }
    if((it.status||"open") === "closed"){ toast("Już zamknięte"); return; }
    if(!confirm(`Zamknąć zamówienie „${it.name||'Zamówienie'}”?\nPo zamknięciu nie da się dodawać.`)) return;
    it.status = "closed";
    it.updatedAt = Date.now();
    localOrdersSave(list);
    toast("Zamknięto");
    ordersRender();
  };


  function cssEscape(s){
    try{ return (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s).replace(/[^a-zA-Z0-9_\-]/g, (c)=>'\\'+c); }
    catch(e){ return String(s).replace(/[^a-zA-Z0-9_\-]/g, (c)=>'\\'+c); }
  }
  function favKey(name){ return (name||"").toLowerCase(); }
  function isFav(name){
    const k = favKey(name);
    return (state.stats.favorites||[]).includes(k);
  }
  function toggleFav(name){
    const k = favKey(name);
    state.stats.favorites ||= [];
    const i = state.stats.favorites.indexOf(k);
    if(i>=0) state.stats.favorites.splice(i,1);
    else state.stats.favorites.push(k);
    save();
  }

  // Actions
  function addProductFromForm(){
    const name = capFirst($("newProdName").value.toLowerCase());
    const cat = capFirst($("newProdCat").value);
	  const checked = getCheckedSections();
	  const sections = checked.length ? checked : parseSections($("newProdSections").value);
    if(!name){ toast("Podaj nazwę produktu"); return; }
    if(!cat){ toast("Podaj kategorię"); return; }

    // de-dupe by name+cat
    const exists = state.catalog.find(p => capFirst(p.name) === name && capFirst(p.category) === cat);
    if(exists){ toast("Taki produkt już jest"); return; }

	  state.catalog.push({ id: uid(), name, category: cat, sections, createdAt: Date.now() });
    $("newProdName").value = "";
    $("newProdCat").value = "";
	  $("newProdSections").value = "";
    save();
    renderAll();
    toast("Dodano produkt");
  }

  function newOrder(){
    if(!confirm("Wyczyścić koszyk i zacząć nowe zamówienie?")) return;
    localOrdersNew();
    state.order.items = [];
    save();
    // reset filters for convenience
	    $("filterSection").value = "__ALL__";
	    $("filterCategory").value = "__ALL__";
	    $("search").value = "";
    renderAll();
    toast("Nowe zamówienie");
  }

  function copyExport(){
    localOrdersTouch();
    const out = buildExportText();
    const txt = out.textFull || out.textBody || "";
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(()=>toast("Skopiowano")).catch(()=>fallbackCopy(txt));
    }else{
      fallbackCopy(txt);
    }
  }

  function fallbackCopy(txt){
    const ta = $("exportText");
    ta.value = txt;
    ta.focus();
    ta.select();
    document.execCommand("copy");
    // restore body view
    renderExport();
    toast("Skopiowano");
  }

  // --- HTML builders for PDF (reuse for LIVE printing) ---
  function buildStdPrintHtml(out){
    return `
<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(out.title || "Zamówienie")}</title>
<style>
  body{font-family: Arial, sans-serif; padding:18px; color:#000;}
  .wrap{border:2px solid #000; border-radius:14px; padding:14px;}
  .top{display:flex; justify-content:space-between; align-items:flex-end; gap:10px; margin-bottom:10px;}
  .h1{font-size:18pt; font-weight:900; letter-spacing:.5px;}
  .dt{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace; font-size:10.5pt; color:#333;}
  .meta{margin:0 0 10px; font-size:11pt;}
  pre{margin:0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace; font-size:11.5pt; line-height:1.35; white-space:pre-wrap;}
  @media print{ body{padding:0} .wrap{border:none; border-radius:0; padding:0} }
</style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="h1">${escapeHtml(out.title || "ZAMÓWIENIE")}</div>
      <div class="dt">${escapeHtml(out.date || "—")}</div>
    </div>
    <div class="meta"><b>${escapeHtml(out.meta || "")}</b></div>
    <pre>${escapeHtml(out.textBody || '')}</pre>
  </div>
<script>window.onload=()=>{ setTimeout(()=>window.print(), 150); };</script>
</body>
</html>`;
  }

  function buildHurtPrintHtml(out){
    const meta = out.meta || "";
    const lines = (out.textBody || "").split("\n");
    const typed = [];
    let currentCat = "";
    for(const ln0 of lines){
      const ln = (ln0||"").trimEnd();
      const m = ln.match(/^===\s*(.+?)\s*===$/);
      if(m){ currentCat = m[1].trim(); typed.push({k:"cat", text: currentCat}); continue; }
      if(ln.trim().startsWith("- ")){ typed.push({k:"item", text: ln.trim().slice(2), cat: currentCat}); continue; }
      if(!ln.trim()) typed.push({k:"sp", text:""});
    }

    const LINES_PER_COL = 52;
    const pages = [];
    let page = [[],[]];
    let col = 0;
    let used = [0,0];
    const cost = (k)=> (k==="cat" ? 2 : 1);

    const startNewCol = (catForCont)=>{
      if(col===0) col=1;
      else { pages.push(page); page=[[],[]]; col=0; }
      used[col]=0;
      if(catForCont){ page[col].push({k:"cat", text:`${catForCont} (ciąg dalszy)`}); used[col]+=2; }
    };

    const push = (k,text,catForCont)=>{
      const c = cost(k);
      if(used[col] + c > LINES_PER_COL) startNewCol(catForCont && k!=="cat" ? catForCont : "");
      page[col].push({k,text});
      used[col]+=c;
    };

    for(const t of typed){
      if(t.k==="cat") push("cat", t.text, t.text);
      else if(t.k==="item") push("item", t.text, t.cat);
      else push("sp","", "");
    }
    if(page[0].length || page[1].length) pages.push(page);

    const style = `
      <style>
        @page { size: A4; margin: 12mm; }
        body{ font-family: Arial, sans-serif; }
        .hdr{ display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #000; padding-bottom:6mm; margin-bottom:6mm; }
        .hdr h1{ margin:0; font-size:18px; }
        .hdr .meta{ font-size:11px; margin-top:2mm; }
        .page{ page-break-after: always; }
        .cols{ display:flex; gap:8mm; }
        .col{ width:50%; font-size:11px; line-height:1.35; }
        .cat{ font-weight:700; margin:4mm 0 2mm; text-transform:uppercase; }
        .item{ margin-left:3mm; }
        .sp{ height: 10px; }
      </style>
    `;

    const colHtml = (arr)=>arr.map(x=>{
      if(x.k==="cat") return `<div class="cat">${escapeHtml(x.text)}</div>`;
      if(x.k==="item") return `<div class="item">• ${escapeHtml(x.text)}</div>`;
      return `<div class="sp"></div>`;
    }).join("");

    const pagesHtml = pages.map((p, i) => `
      <div class="page">
        <div class="hdr">
          <div>
            <h1>${escapeHtml(out.title || "Zamówienie")}</h1>
            <div class="meta">${escapeHtml("Data: " + (out.date||"—"))}</div>
            <div class="meta">${escapeHtml(meta)}</div>
          </div>
          <div class="meta">HURTOWNIA • Strona ${i+1}/${pages.length}</div>
        </div>
        <div class="cols">
          <div class="col">${colHtml(p[0])}</div>
          <div class="col">${colHtml(p[1])}</div>
        </div>
      </div>
    `).join("");

    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(out.title || "Zamówienie")}</title>${style}</head><body>${pagesHtml}<script>window.onload=()=>{window.print();};</script></body></html>`;
  }

  function printExportHurt(){
    const out = buildExportText();
    const orderId = LIVE.ready ? (LIVE.orderId || "") : "";
    const orderName = LIVE.ready ? (LIVE.aliasName || "") : "";
    const html = buildHurtPrintHtml({ ...out, title: (orderName || out.title) });

    const histId = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    historyAdd({
      id: histId,
      kind: "hurtownia",
      title: (orderName || out.title || "Zamówienie"),
      date: out.date || "—",
      meta: out.meta || "",
      createdAt: Date.now(),
      html,
      orderId,
      orderName
    });

    localOrdersSetLastPdf(histId);

    openPrintDoc(html, "PRINT_HURT");
  }


  // Init + events
  function wire(){
    $("btnMenu").addEventListener("click", openSheet);
    $("sheetBackdrop").addEventListener("click", closeSheet);
    $("btnCloseSheet").addEventListener("click", closeSheet);
    $("btnSaveSettings").addEventListener("click", () => {
      state.settings.userName = capFirst($("userName").value);
      state.settings.restaurant = norm($("restName").value) || "Zamówienia PRO";
      save();
      closeSheet();
      renderAll();
    });

	    $("filterSection").addEventListener("change", () => { renderFilters(); renderProductList(); });
	    $("filterCategory").addEventListener("change", renderProductList);
    $("filterSearch").addEventListener("input", renderProductList);
    const favBtn = document.getElementById("btnFav");
    if(favBtn){ favBtn.addEventListener("click", ()=>{ state.ui.favMode = !state.ui.favMode; save(); renderFilters(); renderProductList(); }); }
    const topBtn = document.getElementById("btnTop");
    if(topBtn){ topBtn.addEventListener("click", ()=>{ state.ui.topMode = !state.ui.topMode; save(); renderFilters(); renderProductList(); }); }

    const onlyBtn = document.getElementById("btnOnlyCart");
    if(onlyBtn){ onlyBtn.addEventListener("click", ()=>{ state.ui.onlyInCart = !state.ui.onlyInCart; save(); renderFilters(); renderProductList(); }); }


    $("btnCart").addEventListener("click", openExport);
    $("btnGoExport").addEventListener("click", openExport);
    const btnQuick = document.getElementById("btnQuickRefresh");
    if(btnQuick) btnQuick.addEventListener("click", refreshCatalogQuick);
    
    if(document.getElementById("btnNewOrder2")) $("btnNewOrder2").addEventListener("click", newOrder);
    if(document.getElementById("btnClearCart")) $("btnClearCart").addEventListener("click", () => { if(confirm("Wyczyścić koszyk?")){ state.order.items=[]; save(); renderAll(); toast("Koszyk wyczyszczony"); } });
$("btnBack").addEventListener("click", () => showPanel("panelOrder"));

    $("btnCopy").addEventListener("click", copyExport);
    const btnPrintHurt = document.getElementById("btnPrintHurt");
    if(btnPrintHurt) btnPrintHurt.addEventListener("click", printExportHurt);

    // Menedżer zamówień (LIVE + PDF)
    const btnOrders = document.getElementById("btnOrders");
    if(btnOrders) btnOrders.addEventListener("click", () => ordersOpen("orders"));
    const oBack = document.getElementById("ordersBackdrop");
    if(oBack) oBack.addEventListener("click", ordersClose);
    const oClose = document.getElementById("btnOrdersClose");
    if(oClose) oClose.addEventListener("click", ordersClose);
    const oClear = document.getElementById("btnOrdersClearAll");
    if(oClear) oClear.addEventListener("click", async ()=>{
      // PDF history tab
      if(ORDERS_UI.tab === "pdfs"){
        if(!confirm("Usunąć CAŁĄ historię zapisanych PDF?")) return;
        historyClearAll();
        ordersRender();
        toast("Usunięto historię");
        return;
      }

      // Orders tab
      if(LIVE.ready){
        const rows = (__liveOrdersCache && __liveOrdersCache.length) ? __liveOrdersCache : await liveFetchOrdersList();
        let arr = filterRows(rows);
        sortRows(arr);
        if(!arr.length){ toast("Brak zamówień do usunięcia"); return; }

        const howMany = arr.length;
        if(!confirm(`Usunąć ${howMany} zamówień z listy?
To skasuje też ich pozycje w bazie.`)) return;

        const deleteOne = async (row)=>{
          // delete items in chunks
          const itemsRef = liveOrderRef(row.orderId).collection("items");
          const snap = await itemsRef.get();
          const docs = snap.docs || [];
          for(let i=0;i<docs.length;i+=400){
            const batch = LIVE.db.batch();
            for(const d of docs.slice(i,i+400)) batch.delete(d.ref);
            await batch.commit();
          }
          await liveOrderRef(row.orderId).delete();
          if(row.__aliasId) await LIVE.db.collection("orderAliases").doc(row.__aliasId).delete();

          if(LIVE.orderId === row.orderId){
            LIVE.orderId = "";
            localStorage.removeItem(LS_ORDER);
            localStorage.removeItem("LIVE_ALIAS");
            $("hdrSub").textContent = "—";
          }
        };

        try{
          for(const row of arr){
            if(!row || !row.orderId) continue;
            await deleteOne(row);
          }
          toast("Usunięto zamówienia");
          await ordersRender();
        }catch(e){
          console.error(e);
          toast("Nie udało się usunąć wszystkich");
        }
        return;
      }

      // OFFLINE: wyczyść lokalną listę zamówień
      if(!confirm("Usunąć wszystkie zapisane zamówienia z listy lokalnej?")) return;
      localOrdersSave([]);
      ordersRender();
      toast("Usunięto");
    });

    const tabO = document.getElementById("ordersTabOrders");
    if(tabO) tabO.addEventListener("click", ()=>{ ORDERS_UI.tab = "orders"; ordersRender(); });
    const tabP = document.getElementById("ordersTabPdfs");
    if(tabP) tabP.addEventListener("click", ()=>{ ORDERS_UI.tab = "pdfs"; ordersRender(); });
    const oSearch = document.getElementById("ordersSearch");
    if(oSearch) oSearch.addEventListener("input", ()=>ordersRender());
    const oStatus = document.getElementById("ordersStatus");
    if(oStatus) oStatus.addEventListener("change", ()=>ordersRender());
    const oSort = document.getElementById("ordersSort");
    if(oSort) oSort.addEventListener("change", ()=>ordersRender());

    $("btnAddProduct").addEventListener("click", addProductFromForm);
    $("btnSeed").addEventListener("click", () => { ensureSeed(); renderAll(); toast("Wgrano przykładowe"); });

    // Zamówienia (szybki przycisk na górze)
    const btnGoOrdersTop = document.getElementById("btnGoOrdersTop");
    if(btnGoOrdersTop) btnGoOrdersTop.addEventListener("click", () => ordersOpen("orders"));

    // Baza produktów (przeniesiona do koszyka)
    const btnGoCatalogFromCart = document.getElementById("btnGoCatalogFromCart");
    if(btnGoCatalogFromCart) btnGoCatalogFromCart.addEventListener("click", () => (location.hash = "catalog"));

    const btnBackFromCatalog = document.getElementById("btnBackFromCatalog");
    if(btnBackFromCatalog) btnBackFromCatalog.addEventListener("click", () => (location.hash = "order"));

    const btnImportCatalog = document.getElementById("btnImportCatalog");
    if(btnImportCatalog) btnImportCatalog.addEventListener("click", importCatalogFromGoogleSheets);

    const btnExportCatalog = document.getElementById("btnExportCatalog");
    if(btnExportCatalog) btnExportCatalog.addEventListener("click", exportCatalogToCSV);

    // Simple navigation via hash
    window.addEventListener("hashchange", () => {
      const h = location.hash.replace("#","") || "order";
      if(h === "catalog") showPanel("panelCatalog");
      else if(h === "export") showPanel("panelExport");
      else showPanel("panelOrder");
    });

    // Add a simple bottom nav for small screens by gestures: swipe? keep simple
    // Use keyboard shortcuts on desktop
    document.addEventListener("keydown", (e) => {
      if(e.ctrlKey && e.key === "1") location.hash = "order";
      if(e.ctrlKey && e.key === "2") location.hash = "catalog";
      if(e.ctrlKey && e.key === "3") location.hash = "export";
    });

    // Register service worker
    if("serviceWorker" in navigator){
      // Cache-bust SW itself to ensure Chrome/iOS fetches the newest worker.
      navigator.serviceWorker.register("./sw.js?v=20260106i").catch(()=>{});
    }
  }

  // --- Import/Export katalogu (Google Sheets CSV) ---
  // Oczekiwany format CSV: name,category,sections (sections jako lista rozdzielona średnikiem)
  async function doImportCatalogFromUrl(url, {saveUrl=false}={}){
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) throw new Error("Nie mogę pobrać CSV");
    const csv = await res.text();
    const rows = parseCSV(csv);
    if(rows.length < 1) throw new Error("Pusty plik CSV");

    const header = rows[0].map(h => norm(h).toLowerCase());
    const idxName = header.indexOf("name");
    const idxCategory = header.indexOf("category");
    const idxSections = header.indexOf("sections");
    if(idxName === -1 || idxCategory === -1) throw new Error("CSV musi mieć kolumny name i category");

    const out = [];
    for(let i=1;i<rows.length;i++){
      const r = rows[i];
      const name = capFirst(norm(r[idxName] || ""));
      const category = capFirst(norm(r[idxCategory] || ""));
      if(!name || !category) continue;
      const sections = idxSections >= 0 ? norm(r[idxSections] || "") : "";
      out.push({ id: uid(), name, category, sections, createdAt: Date.now() });
    }
    state.catalog = out;
    if(saveUrl){
      state.settings.catalogCsvUrl = url.trim();
    }
    save();
    renderAll();
    toast(`Baza zaktualizowana ✅ (${out.length} produktów)`);
  }

  async function importCatalogFromGoogleSheets(){
    try{
      const url = prompt(
        "Wklej link CSV z Google Sheets (Opublikowane do internetu)\n" +
        "Przykład: .../pub?output=csv\n\n" +
        "Kolumny: name, category, sections",
        state.settings.catalogCsvUrl || ""
      );
      if(!url) return;
      await doImportCatalogFromUrl(url.trim(), {saveUrl:true});
    }catch(e){
      console.error(e);
      toast("Błąd importu bazy ❌");
      alert("Błąd importu: " + (e && e.message ? e.message : e));
    }
  }

  async function refreshCatalogQuick(){
    try{
      const url = norm(state.settings.catalogCsvUrl);
      if(!url){
        toast("Brak linku CSV — wczytaj raz w Bazie produktów");
        return;
      }
      await doImportCatalogFromUrl(url.trim(), {saveUrl:false});
    }catch(e){
      console.error(e);
      toast("Błąd odświeżania bazy ❌");
      alert("Błąd odświeżania: " + (e && e.message ? e.message : e));
    }
  }

  function exportCatalogToCSV(){
    const lines = ["name,category,sections"]; // sections = ';' separated
    for(const p of (state.catalog || [])){
      const name = csvEsc(p.name);
      const cat = csvEsc(p.category);
      const sec = csvEsc((p.sections || []).join(";"));
      lines.push([name,cat,sec].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "baza_produktow.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    toast("Pobrano CSV");
  }

  function csvEsc(v){
    const s = String(v ?? "");
    if(/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  }

  // Minimalny parser CSV (obsługuje cudzysłowy)
  function parseCSV(text){
    const rows = [];
    let row = [];
    let cur = "";
    let inQ = false;
    for(let i=0;i<text.length;i++){
      const ch = text[i];
      const next = text[i+1];
      if(inQ){
        if(ch === '"' && next === '"'){ cur += '"'; i++; continue; }
        if(ch === '"'){ inQ = false; continue; }
        cur += ch; continue;
      }
      if(ch === '"'){ inQ = true; continue; }
      if(ch === ','){ row.push(cur); cur=""; continue; }
      if(ch === '\n'){ row.push(cur); rows.push(row); row=[]; cur=""; continue; }
      if(ch === '\r') continue;
      cur += ch;
    }
    row.push(cur);
    rows.push(row);
    // trim trailing empty lines
    return rows.filter(r => r.some(c => norm(c)));
  }

  function boot(){
    load();
    ensureSeed(); // comment this out if you don't want starter catalog
    renderAll();
    wire();
    // LIVE init
    initFirebase();
    liveBindUI();
    liveLoadPeople();
    if(LIVE.enabled && LIVE.orderId){
      liveUseOrder(LIVE.orderId).catch(e=>console.error(e));
    }

    // Prompt settings if missing
    if(!norm(state.settings.userName)){
      setTimeout(() => {
        toast("Ustaw swoje imię w menu ☰");
        openSheet();
      }, 450);
    }
  }

  boot();
})();
