(() => {
  const LS_KEY = "zamowienia_pro_v1";
  const DEFAULT_CATS = ["Warzywa","Mięso","Nabiał","Mrożonki","Suchy magazyn","Inne"];
  const TZ = "Europe/Warsaw";

  const $ = (id) => document.getElementById(id);

  const state = {
    settings: { userName: "", restaurant: "Zamówienia PRO" },
    catalog: [], // {id, name, category, createdAt}
    order: { items: [] } // {id, name, category, qty, updatedAt, by}
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
    state.settings ||= { userName:"", restaurant:"Zamówienia PRO" };
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

  function buildCategories(){
    const set = new Set(DEFAULT_CATS.map(capFirst));
    for(const p of state.catalog){
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
    state.catalog = seed.map(([name, category]) => ({ id: uid(), name, category, createdAt: now }));
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
    // refresh export if needed
    if(id === "panelExport") renderExport();
  }

  function renderFilters(){
    const sel = $("filterCategory");
    const cats = buildCategories();
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
    for(const c of cats){
      const o = document.createElement("option");
      o.value = c;
      dl.appendChild(o);
    }
  }

  function getFilteredProducts(){
    const cat = $("filterCategory").value || "__ALL__";
    const q = norm($("filterSearch").value).toLowerCase();
    let arr = [...state.catalog];

    if(cat !== "__ALL__"){
      arr = arr.filter(p => capFirst(p.category) === cat);
    }
    if(q){
      arr = arr.filter(p => (p.name||"").toLowerCase().includes(q));
    }
    arr.sort((a,b)=>(a.name||"").localeCompare(b.name||"","pl"));
    return arr;
  }

  function renderProductList(){
    const list = $("productList");
    list.innerHTML = "";

    const arr = getFilteredProducts();
    if(!arr.length){
      const empty = document.createElement("div");
      empty.className = "card";
      empty.innerHTML = `<div class="small">Brak produktów. Dodaj w zakładce „Baza”.</div>`;
      list.appendChild(empty);
      return;
    }

    for(const p of arr){
      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <div class="item__left">
          <div class="item__name">${escapeHtml(p.name)}</div>
          <div class="item__meta">${escapeHtml(capFirst(p.category) || "Inne")}</div>
        </div>
        <div class="item__right">
          <input class="qty" inputmode="text" placeholder="np. 2kg" />
          <button class="smallbtn">➕</button>
        </div>
      `;
      const qtyEl = row.querySelector("input.qty");
      const btn = row.querySelector("button.smallbtn");

      btn.addEventListener("click", () => {
        const qty = norm(qtyEl.value);
        if(!qty){ toast("Wpisz ilość"); return; }
        addToOrder(p, qty);
        qtyEl.value = "";
      });

      qtyEl.addEventListener("keydown", (ev) => {
        if(ev.key === "Enter"){
          ev.preventDefault();
          btn.click();
        }
      });

      list.appendChild(row);
    }
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
    save();
    renderAll();
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
    const box = $("basket");
    const items = [...state.order.items];
    if(!items.length){
      box.innerHTML = `<div class="basket__empty">Koszyk pusty. Dodaj coś z listy produktów.</div>`;
      return;
    }

    // group by category
    items.sort((a,b)=> (a.category||"").localeCompare(b.category||"","pl") || (a.name||"").localeCompare(b.name||"","pl"));
    const groups = new Map();
    for(const it of items){
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
          it.qty = nv;
          it.updatedAt = Date.now();
          it.by = norm(state.settings.userName) || it.by || "—";
          save();
          renderAll();
        });

        // long press delete for mobile convenience
        let pressTimer = null;
        const startPress = () => pressTimer = setTimeout(() => del.click(), 600);
        const endPress = () => { if(pressTimer) clearTimeout(pressTimer); pressTimer=null; };

        r.addEventListener("touchstart", startPress, {passive:true});
        r.addEventListener("touchend", endPress, {passive:true});
        r.addEventListener("touchcancel", endPress, {passive:true});

        del.addEventListener("click", () => {
          if(!confirm(`Usunąć: ${it.name}?`)) return;
          state.order.items = state.order.items.filter(x => x.id !== it.id);
          save();
          renderAll();
        });

        g.appendChild(r);
      }
      box.appendChild(g);
    }
  }

  function renderCatalog(){
    const list = $("catalogList");
    list.innerHTML = "";
    const arr = [...state.catalog].sort((a,b)=>(a.category||"").localeCompare(b.category||"","pl") || (a.name||"").localeCompare(b.name||"","pl"));
    if(!arr.length){
      list.innerHTML = `<div class="card"><div class="small">Brak produktów. Dodaj je powyżej albo kliknij „Wgraj przykładowe”.</div></div>`;
      return;
    }

    for(const p of arr){
      const row = document.createElement("div");
      row.className = "item";
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
  }

  function buildExportText(){
    const items = [...state.order.items];
    if(!items.length){
      return { title:"ZAMÓWIENIE", date:"—", meta:"Brak pozycji.", text:"Brak pozycji w zamówieniu." };
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

    const lines = [];
    lines.push(meta);
    lines.push(`Data: ${dateStr}`);
    lines.push("");

    for(const [cat, arr] of groups.entries()){
      lines.push(`=== ${cat.toUpperCase()} ===`);
      for(const it of arr){
        lines.push(`- ${it.name}: ${it.qty}`);
      }
      lines.push("");
    }

    return { title:"ZAMÓWIENIE", date:dateStr, meta, text: lines.join("\n").trim() };
  }

  function renderExport(){
    const out = buildExportText();
    $("expTitle").textContent = out.title;
    $("expDate").textContent = out.date;
    $("expMeta").textContent = out.meta;
    $("exportText").value = out.text;
  }

  function renderAll(){
    renderHeader();
    renderFilters();
    renderProductList();
    renderBasket();
    renderCatalog();
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

  function escapeHtml(s){
    return String(s ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  // Actions
  function addProductFromForm(){
    const name = capFirst($("newProdName").value.toLowerCase());
    const cat = capFirst($("newProdCat").value);
    if(!name){ toast("Podaj nazwę produktu"); return; }
    if(!cat){ toast("Podaj kategorię"); return; }

    // de-dupe by name+cat
    const exists = state.catalog.find(p => capFirst(p.name) === name && capFirst(p.category) === cat);
    if(exists){ toast("Taki produkt już jest"); return; }

    state.catalog.push({ id: uid(), name, category: cat, createdAt: Date.now() });
    $("newProdName").value = "";
    $("newProdCat").value = "";
    save();
    renderAll();
    toast("Dodano produkt");
  }

  function newOrder(){
    if(!confirm("Wyczyścić koszyk i zacząć nowe zamówienie?")) return;
    state.order.items = [];
    save();
    // reset filters for convenience
    $("filterCategory").value = "__ALL__";
    $("filterSearch").value = "";
    renderAll();
    toast("Nowe zamówienie");
  }

  function copyExport(){
    const ta = $("exportText");
    ta.focus();
    ta.select();
    document.execCommand("copy");
    toast("Skopiowano");
  }

  function printExport(){
    const out = buildExportText();
    // Open a minimal print view.
    const w = window.open("", "_blank");
    if(!w){ alert("Przeglądarka zablokowała okno. Zezwól na wyskakujące okna."); return; }

    const html = `
<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zamówienie</title>
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
      <div class="h1">ZAMÓWIENIE</div>
      <div class="dt">${escapeHtml(out.date)}</div>
    </div>
    <div class="meta"><b>${escapeHtml(out.meta)}</b></div>
    <pre>${escapeHtml(out.text)}</pre>
  </div>
<script>window.onload=()=>{ setTimeout(()=>window.print(), 150); };</script>
</body>
</html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
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

    $("filterCategory").addEventListener("change", renderProductList);
    $("filterSearch").addEventListener("input", renderProductList);

    $("btnNewOrder").addEventListener("click", newOrder);
    $("btnGoExport").addEventListener("click", () => showPanel("panelExport"));
    $("btnBack").addEventListener("click", () => showPanel("panelOrder"));

    $("btnCopy").addEventListener("click", copyExport);
    $("btnPrint").addEventListener("click", printExport);

    $("btnAddProduct").addEventListener("click", addProductFromForm);
    $("btnSeed").addEventListener("click", () => { ensureSeed(); renderAll(); toast("Wgrano przykładowe"); });

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
      navigator.serviceWorker.register("./sw.js").catch(()=>{});
    }
  }

  function boot(){
    load();
    ensureSeed(); // comment this out if you don't want starter catalog
    renderAll();
    wire();
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
