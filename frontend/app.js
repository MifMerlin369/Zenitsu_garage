/* ══════════════════════════════════════════════════════════════════
   GarageDiag PRO — app.js
══════════════════════════════════════════════════════════════════ */

const API = window.location.origin + "/api";

/* ── STATE ─────────────────────────────────────────────────────── */
const S = {
  token: null, username: null, role: null,
  currentDossier: null, currentVehicle: null,
};

/* ── HTTP ──────────────────────────────────────────────────────── */
const http = {
  h() { return { "Content-Type":"application/json", ...(S.token ? {Authorization:`Bearer ${S.token}`} : {}) }; },
  async get(p)    { try { return await (await fetch(`${API}${p}`, {headers:this.h()})).json(); } catch { return {error:"Serveur inaccessible"}; } },
  async post(p,b) { return (await fetch(`${API}${p}`, {method:"POST",   headers:this.h(), body:JSON.stringify(b)})).json(); },
  async put(p,b)  { return (await fetch(`${API}${p}`, {method:"PUT",    headers:this.h(), body:JSON.stringify(b)})).json(); },
  async patch(p,b){ return (await fetch(`${API}${p}`, {method:"PATCH",  headers:this.h(), body:JSON.stringify(b)})).json(); },
  async del(p)    { return (await fetch(`${API}${p}`, {method:"DELETE", headers:this.h()})).json(); },
};

/* ── DOM HELPERS ───────────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const qs = s  => document.querySelector(s);
const qsa= s  => [...document.querySelectorAll(s)];

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls)  e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function esc(v) {
  if (v == null || v === "") return "—";
  return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function fmt(v)  { return v ? String(v) : "—"; }
function fmtCFA(v){ return v ? Number(v).toLocaleString("fr-FR",{minimumFractionDigits:0})+" CFA" : "0 CFA"; }

function toast(id, msg, type="err") {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${type}`;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 4500);
}

const STATUTS = {en_attente:"En attente", en_cours:"En cours", termine:"Terminé", livre:"Livré", archive:"Archivé"};
const URGENCES = {normal:"Normal", urgent:"Urgent", tres_urgent:"🔴 Très urgent"};
const TYPES = {reparation:"Réparation", entretien:"Entretien", diagnostic:"Diagnostic", carrosserie:"Carrosserie", controle:"Contrôle"};

function badge(val, map, cls_prefix) {
  const label = map[val] || val;
  return `<span class="badge b-${val}">${esc(label)}</span>`;
}

/* ── SCREENS ───────────────────────────────────────────────────── */
function showScreen(n) {
  qsa(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(`sc-${n}`)?.classList.add("active");
}

/* ── TABS ──────────────────────────────────────────────────────── */
const App = {
  goTab(name) {
    qsa(".tab").forEach(t => t.classList.remove("active"));
    qsa(".snav-item").forEach(b => b.classList.remove("active"));
    document.getElementById(`tab-${name}`)?.classList.add("active");
    qs(`.snav-item[data-tab="${name}"]`)?.classList.add("active");
    const loaders = {
      dashboard: loadDashboard, kanban: loadKanban,
      dossiers: loadDossiers, vehicles: loadVehicles,
      clients: loadClients, admin: loadUsers,
      nouveau: resetForm,
    };
    loaders[name]?.();
  }
};
window.App = App;

/* ══════════════════════════════════════════════════════════════════
   AUTH
══════════════════════════════════════════════════════════════════ */
async function login() {
  const username = $("l-user").value.trim();
  const password = $("l-pass").value;
  if (!username || !password) { toast("l-err","Remplis les deux champs."); return; }
  const btn = $("btn-login");
  btn.textContent = "Connexion..."; btn.disabled = true;
  try {
    const d = await http.post("/login", {username, password});
    if (d.token) {
      S.token = d.token; S.username = d.username; S.role = d.role;
      $("tb-user").textContent = d.username;
      const rb = $("tb-role");
      rb.textContent = d.role === "admin" ? "ADMIN" : "TECH";
      rb.className = `tb-role r-${d.role}`;
      if (d.role !== "admin") $("snav-admin").style.display = "none";
      showScreen("app");
      App.goTab("dashboard");
    } else {
      toast("l-err", d.error || "Erreur.");
    }
  } catch { toast("l-err","Serveur inaccessible."); }
  btn.textContent = "CONNEXION →"; btn.disabled = false;
}

function logout() {
  Object.assign(S, {token:null, username:null, role:null, currentDossier:null, currentVehicle:null});
  showScreen("login");
  $("l-pass").value = "";
}

/* ══════════════════════════════════════════════════════════════════
   GLOBAL SEARCH
══════════════════════════════════════════════════════════════════ */
let searchTimer = null;

async function globalSearch(q) {
  if (!q || q.length < 2) { $("gsearch-results").classList.add("hidden"); return; }
  const [dos, vehs] = await Promise.all([
    http.get(`/dossiers?q=${encodeURIComponent(q)}`),
    http.get(`/vehicles?q=${encodeURIComponent(q)}`),
  ]);
  const dd = $("gsearch-results");
  dd.innerHTML = "";

  if (Array.isArray(dos) && dos.length) {
    dd.appendChild(el("div","gsd-section","DOSSIERS"));
    dos.slice(0,5).forEach(d => {
      const item = el("div","gsd-item");
      item.innerHTML = `
        <div class="gsd-main">
          <div class="gsd-title">${esc(d.client_nom)} — ${esc(d.matricule)}</div>
          <div class="gsd-sub">${esc(d.numero)} · ${esc(d.marque||"")} ${esc(d.modele||"")} · ${esc(d.technician)}</div>
        </div>
        ${badge(d.statut, STATUTS, "b-")}`;
      item.addEventListener("click", () => {
        dd.classList.add("hidden");
        $("gsearch").value = "";
        openDossierModal(d);
      });
      dd.appendChild(item);
    });
  }

  if (Array.isArray(vehs) && vehs.length) {
    dd.appendChild(el("div","gsd-section","VÉHICULES"));
    vehs.slice(0,4).forEach(v => {
      const item = el("div","gsd-item");
      item.innerHTML = `
        <div class="gsd-main">
          <div class="gsd-title">${esc(v.matricule)} ${v.marque ? "— "+esc(v.marque)+" "+esc(v.modele||"") : ""}</div>
          <div class="gsd-sub">${esc(v.client_nom)} · <span style="color:var(--amber)">${v.nb_dossiers} dossier(s)</span></div>
        </div>`;
      item.addEventListener("click", () => {
        dd.classList.add("hidden");
        $("gsearch").value = "";
        openVehicleModal(v.id);
      });
      dd.appendChild(item);
    });
  }

  if (!dd.innerHTML) dd.innerHTML = '<div class="empty">Aucun résultat.</div>';
  dd.classList.remove("hidden");
}

/* ══════════════════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════════════════ */
async function loadDashboard() {
  $("pdate").textContent = new Date().toLocaleDateString("fr-FR",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const [stats, dos] = await Promise.all([http.get("/stats"), http.get("/dossiers?q=")]);
  if (stats.error) return;

  // KPIs — Total, En cours, Terminé cliquables
  const kpis = [
    {l:"Total dossiers", v:stats.total,      c:0, statut:""},
    {l:"En cours",       v:stats.en_cours,   c:2, statut:"en_cours"},
    {l:"Terminés",       v:stats.termine,    c:3, statut:"termine"},
    {l:"Clients",        v:stats.nb_clients, c:0, statut:null},
    {l:"Véhicules",      v:stats.nb_vehicles,c:0, statut:null},
  ];
  $("kpi-row").innerHTML = kpis.map(k=>{
    const clickable = k.statut !== null;
    return `<div class="kpi c${k.c}${clickable?' kpi-clickable':''}" ${clickable?`onclick="kpiClick('${k.statut}')"`:''}>
      <div class="kpi-n">${k.v}</div><div class="kpi-l">${k.l}</div>
    </div>`;
  }).join("");

  // Badge urgents topbar
  if (stats.urgents > 0) {
    $("tb-urgents").classList.remove("hidden");
    $("tb-urgents-count").textContent = stats.urgents;
  }

  // Sidebar mini stats
  $("sidebar-mini-stats").innerHTML = [
    {l:"EN COURS",   v:stats.en_cours,   c:"var(--blue)"},
    {l:"TERMINÉ",    v:stats.termine,    c:"var(--cyan)"},
    {l:"CA MOIS",    v:fmtCFA(stats.ca_mois), c:"var(--green)"},
  ].map(i=>`<div class="sms-row"><span class="sms-lbl">${i.l}</span><span class="sms-val" style="color:${i.c}">${i.v}</span></div>`).join("");

  // Badge sidebar dossiers
  $("snav-badge-dos").textContent = stats.total;

  // Stat bars
  const t = stats.total || 1;
  $("stat-bars").innerHTML = [
    {l:"En cours",   v:stats.en_cours,   max:t, c:"var(--blue)"},
    {l:"Terminé",    v:stats.termine,    max:t, c:"var(--cyan)"},
  ].map(b=>`
    <div class="sbar-row">
      <div class="sbar-label"><span>${b.l}</span><span>${b.v}</span></div>
      <div class="sbar-track"><div class="sbar-fill" style="width:${Math.round(b.v/b.max*100)}%;background:${b.c}"></div></div>
    </div>`).join("");

  // Recent dossiers — 12 max
  const recent = Array.isArray(dos) ? dos.slice(0,12) : [];
  $("dash-recent").innerHTML = "";
  recent.forEach(d => $("dash-recent").appendChild(buildDosCard(d)));
  if (!recent.length) $("dash-recent").innerHTML = '<div class="empty">Aucun dossier.</div>';
}

/* ══════════════════════════════════════════════════════════════════
   KANBAN
══════════════════════════════════════════════════════════════════ */
async function loadKanban() {
  const data = await http.get("/dossiers/kanban");
  if (data.error) return;
  const cols = [
    {key:"en_cours",   label:"En cours",    color:"var(--blue)"},
    {key:"termine",    label:"Terminé",     color:"var(--cyan)"},
  ];
  $("kanban-board").innerHTML = "";
  cols.forEach(col => {
    const cards = data[col.key] || [];
    const colEl = el("div","kb-col");
    colEl.innerHTML = `
      <div class="kb-col-head" style="color:${col.color}">
        ${col.label}
        <span class="cnt">${cards.length}</span>
      </div>
      <div class="kb-cards" id="kb-${col.key}"></div>`;
    $("kanban-board").appendChild(colEl);
    const container = document.getElementById(`kb-${col.key}`);
    if (!cards.length) {
      container.innerHTML = `<div class="kb-empty">Aucun dossier</div>`;
      return;
    }
    cards.forEach(d => {
      const card = el("div", `kb-card urg-${d.urgence}`);
      card.innerHTML = `
        <div class="kb-card-num">${esc(d.numero)}</div>
        <div class="kb-card-client">${esc(d.client_nom)}</div>
        <div class="kb-card-car">${esc([d.marque,d.modele].filter(Boolean).join(" "))}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="kb-card-plate">${esc(d.matricule)}</div>
          ${d.urgence !== "normal" ? badge(d.urgence, URGENCES) : ""}
        </div>`;
      card.addEventListener("click", () => openDossierModal(d));
      card.title = "Clic: voir · Double-clic: changer statut";
      card.addEventListener("dblclick", async (e) => {
        e.stopPropagation();
        const next = {en_cours:"termine"};
        const nxt = next[d.statut];
        if (!nxt) return;
        await http.patch(`/dossiers/${d.id}/statut`, {statut:nxt});
        loadKanban();
      });
      container.appendChild(card);
    });
  });
}

/* ══════════════════════════════════════════════════════════════════
   DOSSIERS LIST
══════════════════════════════════════════════════════════════════ */
async function loadDossiers() {
  const q  = $("gsearch").value.trim();
  const st = $("f-statut")?.value || "";
  const ur = $("f-urgence")?.value || "";
  const ty = $("f-type")?.value || "";
  let path = `/dossiers?q=${encodeURIComponent(q)}`;
  if (st) path += `&statut=${st}`;
  if (ur) path += `&urgence=${ur}`;
  if (ty) path += `&type=${ty}`;
  const data = await http.get(path);
  const cont = $("dos-list");
  cont.innerHTML = "";
  if (!Array.isArray(data) || !data.length) {
    cont.innerHTML = '<div class="empty">Aucun dossier trouvé.</div>'; return;
  }
  data.forEach(d => cont.appendChild(buildDosCard(d)));
}

function buildDosCard(d) {
  const total = ((d.cout_pieces||0)+(d.cout_main_oeuvre||0)-(d.remise||0));
  const card = el("div", `dos-card urg-${d.urgence||"normal"}`);
  card.innerHTML = `
    <div class="dos-head">
      <div class="dos-num">${esc(d.numero)}</div>
      <div class="dos-client">${esc(d.client_nom)}</div>
      <div class="dos-plate">${esc(d.matricule)}</div>
      <div class="dos-car">${esc([d.marque,d.modele,d.annee].filter(Boolean).join(" "))}</div>
      <div class="dos-tech">↳ ${esc(d.technician)}</div>
      <div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
        ${badge(d.statut,STATUTS)} ${badge(d.type_intervention||"reparation",TYPES)}
      </div>
    </div>
    <div class="dos-body">
      <div class="dos-panne">${esc(d.panne_description||"Aucune description")}</div>
      <div class="dos-meta">
        <div class="dos-date">${fmt(d.date_entree)}</div>
        ${total>0?`<div class="dos-cost">${fmtCFA(total)}</div>`:""}
        ${d.urgence!=="normal"?badge(d.urgence,URGENCES):""}
      </div>
    </div>`;
  card.addEventListener("click", () => openDossierModal(d));
  return card;
}

/* ══════════════════════════════════════════════════════════════════
   VEHICLES
══════════════════════════════════════════════════════════════════ */
async function loadVehicles() {
  const q = $("v-search")?.value.trim() || "";
  const data = await http.get(`/vehicles?q=${encodeURIComponent(q)}`);
  const cont = $("vehicles-grid");
  cont.innerHTML = "";
  if (!Array.isArray(data) || !data.length) {
    cont.innerHTML = '<div class="empty">Aucun véhicule trouvé.</div>'; return;
  }
  const grid = el("div","veh-grid");
  data.forEach(v => {
    const card = el("div","veh-card");
    card.innerHTML = `
      <div class="veh-plate">${esc(v.matricule)}</div>
      <div class="veh-car">${esc([v.marque,v.modele].filter(Boolean).join(" "))||"—"}</div>
      <div class="veh-client">↳ ${esc(v.client_nom||"Client inconnu")}</div>
      <div class="veh-meta">
        ${v.annee?`<span class="veh-chip">${v.annee}</span>`:""}
        ${v.carburant?`<span class="veh-chip">${v.carburant}</span>`:""}
        ${v.couleur?`<span class="veh-chip">${v.couleur}</span>`:""}
      </div>
      <div class="veh-hist"><span>${v.nb_dossiers||0}</span> intervention(s)${v.derniere_visite?` · Dernière : ${v.derniere_visite.slice(0,10)}`:""}</div>`;
    card.addEventListener("click", () => openVehicleModal(v.id));
    grid.appendChild(card);
  });
  cont.appendChild(grid);
}

async function openVehicleModal(vid) {
  const data = await http.get(`/vehicles/${vid}`);
  if (data.error) return;
  S.currentVehicle = data;
  $("mv-plaque").textContent = data.matricule;
  $("mv-car").textContent = [data.marque,data.modele,data.annee].filter(Boolean).join(" ") || "—";

  const body = $("modal-vehicle-body");
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div>
        <div class="ms">
          <div class="ms-title">Véhicule</div>
          <div class="mg mg2" style="gap:10px">
            ${mf("Plaque",data.matricule,true)} ${mf("VIN",data.vin,true)}
            ${mf("Marque",data.marque)} ${mf("Modèle",data.modele)}
            ${mf("Année",data.annee)} ${mf("Couleur",data.couleur)}
            ${mf("Carburant",data.carburant)} ${mf("Transmission",data.transmission)}
          </div>
        </div>
        <div class="ms">
          <div class="ms-title">Client</div>
          <div class="mg mg2" style="gap:10px">
            ${mf("Nom",data.client_nom)} ${mf("Tél",data.client_tel)}
            ${mf("Email",data.client_email)} ${mf("Adresse",data.client_adresse)}
          </div>
        </div>
      </div>
      <div>
        <div class="ms-title">Historique des interventions (${data.dossiers?.length||0})</div>
        <div id="veh-history"></div>
      </div>
    </div>`;

  const hist = document.getElementById("veh-history");
  if (!data.dossiers?.length) {
    hist.innerHTML = '<div class="empty">Aucune intervention enregistrée.</div>';
  } else {
    const colors = {en_attente:"var(--amber)",en_cours:"var(--blue)",termine:"var(--cyan)",livre:"var(--green)",archive:"var(--tx3)"};
    data.dossiers.forEach(d => {
      const item = el("div","hist-item");
      const total = ((d.cout_pieces||0)+(d.cout_main_oeuvre||0)-(d.remise||0));
      item.innerHTML = `
        <div class="hist-dot" style="background:${colors[d.statut]||"var(--tx3)"}"></div>
        <div class="hist-content">
          <div class="hist-num">${esc(d.numero)} · ${badge(d.statut,STATUTS)} ${badge(d.type_intervention||"reparation",TYPES)}</div>
          <div class="hist-title">${esc(d.panne_description||"Intervention")}</div>
          <div class="hist-sub">${esc(d.technician)}${total>0?" · "+fmtCFA(total):""}</div>
        </div>
        <div class="hist-date">${fmt(d.date_entree)}</div>`;
      item.addEventListener("click", () => {
        document.getElementById("modal-vehicle").classList.add("hidden");
        openDossierModal(d);
      });
      hist.appendChild(item);
    });
  }

  $("mv-new-dos").onclick = () => {
    document.getElementById("modal-vehicle").classList.add("hidden");
    prefillFormVehicle(data);
    App.goTab("nouveau");
  };
  // Boutons suppression (admin seulement)
  const mvFoot = document.querySelector("#modal-vehicle .modal-foot");
  ["mv-del-vehicle","mv-del-client"].forEach(id => { const b = document.getElementById(id); if(b) b.remove(); });
  if (S.role === "admin") {
    const btnV = el("button","btn-danger");
    btnV.id = "mv-del-vehicle";
    btnV.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg> Supprimer véhicule`;
    btnV.onclick = () => deleteVehicle(data.id, data.matricule);
    mvFoot.insertBefore(btnV, mvFoot.querySelector(".btn-primary"));
    const btnC = el("button","btn-danger");
    btnC.id = "mv-del-client";
    btnC.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg> Supprimer client`;
    btnC.onclick = () => deleteClient(data.client_id, data.client_nom);
    mvFoot.insertBefore(btnC, mvFoot.querySelector(".btn-primary"));
  }
  document.getElementById("modal-vehicle").classList.remove("hidden");
}

/* ══════════════════════════════════════════════════════════════════
   CLIENTS
══════════════════════════════════════════════════════════════════ */
async function loadClients() {
  const q = $("c-search")?.value.trim() || "";
  const data = await http.get(`/clients?q=${encodeURIComponent(q)}`);
  const cont = $("clients-list");
  cont.innerHTML = "";
  if (!Array.isArray(data) || !data.length) {
    cont.innerHTML = '<div class="empty">Aucun client trouvé.</div>'; return;
  }
  const wrap = el("div","cli-wrap");
  const table = el("table","cli-table");
  table.innerHTML = `<thead><tr>
    <th>Nom</th><th>Téléphone</th><th>Email</th><th>Adresse</th><th>Véhicules</th><th>Enregistré</th>
  </tr></thead>`;
  const tbody = el("tbody");
  data.forEach(c => {
    const tr = el("tr");
    tr.innerHTML = `
      <td style="font-weight:600">${esc(c.nom)}</td>
      <td style="font-family:var(--mono);font-size:11px">${esc(c.tel)}</td>
      <td>${esc(c.email)}</td>
      <td style="color:var(--tx2)">${esc(c.adresse)}</td>
      <td style="font-family:var(--mono);color:var(--amber)">${c.nb_vehicles||0}</td>
      <td style="font-family:var(--mono);font-size:10px;color:var(--tx3)">${(c.created_at||"").slice(0,10)}</td>`;
    tr.addEventListener("click", async () => {
      const full = await http.get(`/clients/${c.id}`);
      if (full.error) return;
      // Ouvre le premier véhicule ou juste affiche les infos
      if (full.vehicles?.length) openVehicleModal(full.vehicles[0].id);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  cont.appendChild(wrap);
}

/* ══════════════════════════════════════════════════════════════════
   FORM — NOUVEAU / ÉDITION
══════════════════════════════════════════════════════════════════ */
function resetForm() {
  $("form-title").textContent = "Nouveau dossier";
  $("form-numero").textContent = "";
  $("fd-id").value = "";
  $("fd-vehicle-id").value = "";
  $("fd-client-id").value = "";
  // Clear all fields
  ["fc-nom","fc-tel","fc-email","fc-adresse"].forEach(id => $(id).value="");
  ["fv-matricule","fv-vin","fv-marque","fv-modele","fv-annee","fv-couleur"].forEach(id => $(id).value="");
  $("fv-carburant").value = "essence"; $("fv-transmission").value = "manuelle";
  $("fi-type").value = "reparation"; $("fi-urgence").value = "normal"; $("fi-statut").value = "en_attente";
  $("fi-date-entree").value = new Date().toISOString().slice(0,10);
  ["fi-date-sortie-prevue","fi-date-sortie-reelle"].forEach(id=>$(id).value="");
  ["fi-panne","fi-resolution","fi-pieces","fi-observations"].forEach(id=>$(id).value="");
  $("fi-garantie").value=""; $("fi-tarif").value="facture";
  ["fi-pieces-cout","fi-mo","fi-remise"].forEach(id=>$(id).value="");
  updateTotal();
  $("form-msg").classList.add("hidden");
  $("alerte-km").classList.add("hidden");
  $("lookup-result").classList.add("hidden");
  $("lookup-input").value = "";
}

function prefillFormVehicle(vdata) {
  resetForm();
  $("fv-matricule").value  = vdata.matricule || "";
  $("fv-vin").value        = vdata.vin || "";
  $("fv-marque").value     = vdata.marque || "";
  $("fv-modele").value     = vdata.modele || "";
  $("fv-annee").value      = vdata.annee || "";
  $("fv-couleur").value    = vdata.couleur || "";
  $("fv-carburant").value  = vdata.carburant || "essence";
  $("fv-transmission").value = vdata.transmission || "manuelle";
  $("fc-nom").value        = vdata.client_nom || "";
  $("fc-tel").value        = vdata.client_tel || "";
  $("fc-email").value      = vdata.client_email || "";
  $("fc-adresse").value    = vdata.client_adresse || "";
  $("fd-vehicle-id").value = vdata.id || "";
  $("fd-client-id").value  = vdata.client_id || "";
}

function fillFormDossier(d) {
  $("form-title").textContent = `Modifier ${d.numero}`;
  $("form-numero").textContent = d.numero;
  $("fd-id").value         = d.id;
  $("fd-vehicle-id").value = d.vehicle_id;
  $("fd-client-id").value  = d.client_id;
  // Client
  $("fc-nom").value    = d.client_nom || "";
  $("fc-tel").value    = d.client_tel || "";
  $("fc-email").value  = d.client_email || "";
  $("fc-adresse").value= d.client_adresse || "";
  // Véhicule
  $("fv-matricule").value    = d.matricule || "";
  $("fv-vin").value          = d.vin || "";
  $("fv-marque").value       = d.marque || "";
  $("fv-modele").value       = d.modele || "";
  $("fv-annee").value        = d.annee || "";
  $("fv-couleur").value      = d.couleur || "";
  $("fv-carburant").value    = d.carburant || "essence";
  $("fv-transmission").value = d.transmission || "manuelle";
  // Intervention
  $("fi-type").value              = d.type_intervention || "reparation";
  $("fi-urgence").value           = d.urgence || "normal";
  $("fi-statut").value            = d.statut || "en_attente";
  $("fi-date-entree").value       = d.date_entree || "";
  $("fi-date-sortie-prevue").value= d.date_sortie_prevue || "";
  $("fi-date-sortie-reelle").value= d.date_sortie_reelle || "";
  $("fi-panne").value             = d.panne_description || "";
  $("fi-resolution").value        = d.panne_resolution || "";
  $("fi-pieces").value            = d.pieces_changees || "";
  $("fi-garantie").value          = d.garantie_mois || "";
  $("fi-observations").value      = d.observations || "";
  $("fi-tarif").value             = d.type_tarif || "facture";
  $("fi-pieces-cout").value       = d.cout_pieces || "";
  $("fi-mo").value                = d.cout_main_oeuvre || "";
  $("fi-remise").value            = d.remise || "";
  updateTotal();
}

function updateTotal() {
  const p = parseFloat($("fi-pieces-cout")?.value)||0;
  const m = parseFloat($("fi-mo")?.value)||0;
  const r = parseFloat($("fi-remise")?.value)||0;
  $("total-box").textContent = fmtCFA(p+m-r);
}

/* Smart lookup */
async function lookupVehicle() {
  const q = $("lookup-input").value.trim();
  if (!q) return;
  const data = await http.get(`/vehicles/lookup?q=${encodeURIComponent(q)}`);
  const box = $("lookup-result");
  if (!data.found) {
    box.innerHTML = `<div class="lookup-not-found">Véhicule inconnu — les champs restent vides, tu peux les saisir manuellement.</div>`;
    box.classList.remove("hidden");
    return;
  }
  // Auto-remplissage
  prefillFormVehicle(data);
  box.innerHTML = `<div class="lookup-found">✓ Véhicule trouvé — informations chargées automatiquement</div>
    <div style="font-size:12px;color:var(--tx2)">${esc(data.matricule)} · ${esc([data.marque,data.modele].filter(Boolean).join(" "))} · Client : ${esc(data.client_nom)}</div>`;
  box.classList.remove("hidden");
  setTimeout(() => box.classList.add("hidden"), 4000);
}

async function saveDossier() {
  const nom       = $("fc-nom").value.trim();
  const matricule = $("fv-matricule").value.trim();
  const vin       = $("fv-vin").value.trim();
  if (!nom || !matricule) { toast("form-msg","Nom client et plaque sont obligatoires."); return; }
  // Validation VIN optionnel — si saisi doit être 17 chars alphanumériques
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) {
    toast("form-msg","VIN invalide — doit contenir exactement 17 caractères alphanumériques (lettres et chiffres, sans I/O/Q)."); return;
  }

  const btn = $("btn-save");
  btn.textContent = "Enregistrement..."; btn.disabled = true;

  const editId    = $("fd-id").value;
  let vehicleId   = $("fd-vehicle-id").value;
  let clientId    = $("fd-client-id").value;

  try {
    // Si nouveau dossier : créer/récupérer client + véhicule
    if (!editId) {
      // Client
      if (!clientId) {
        const cr = await http.post("/clients", {
          nom, tel:$("fc-tel").value, email:$("fc-email").value, adresse:$("fc-adresse").value
        });
        clientId = cr.id;
      }
      // Véhicule
      if (!vehicleId) {
        const vr = await http.post("/vehicles", {
          client_id: clientId,
          matricule, vin:$("fv-vin").value,
          marque:$("fv-marque").value, modele:$("fv-modele").value,
          annee:$("fv-annee").value||null, couleur:$("fv-couleur").value,
          carburant:$("fv-carburant").value, transmission:$("fv-transmission").value,
        });
        vehicleId = vr.id;
      }
    }

    const payload = {
      vehicle_id: vehicleId, client_id: clientId,
      statut:$("fi-statut").value, type_intervention:$("fi-type").value, urgence:$("fi-urgence").value,
      date_entree:$("fi-date-entree").value, date_sortie_prevue:$("fi-date-sortie-prevue").value,
      date_sortie_reelle:$("fi-date-sortie-reelle").value,
      panne_description:$("fi-panne").value, panne_resolution:$("fi-resolution").value,
      pieces_changees:$("fi-pieces").value, garantie_mois:$("fi-garantie").value||0,
      observations:$("fi-observations").value,
      type_tarif:$("fi-tarif").value,
      cout_pieces:parseFloat($("fi-pieces-cout").value)||0,
      cout_main_oeuvre:parseFloat($("fi-mo").value)||0,
      remise:parseFloat($("fi-remise").value)||0,
    };

    let res;
    if (editId) {
      res = await http.put(`/dossiers/${editId}`, payload);
    } else {
      res = await http.post("/dossiers", payload);
    }

    if (res.success) {
      const msg = editId ? "Dossier mis à jour." : `Dossier ${res.numero} créé avec succès.`;
      toast("form-msg", msg, "ok");
      if (res.alerte) {
        $("alerte-km").textContent = res.alerte;
        $("alerte-km").classList.remove("hidden");
      }
      if (!editId) {
        $("form-numero").textContent = res.numero;
        $("form-title").textContent  = `Dossier ${res.numero}`;
      }
      $("snav-badge-dos").textContent = "…";
      http.get("/stats").then(s => {
        if (s.total !== undefined) $("snav-badge-dos").textContent = s.total;
      });
    } else {
      toast("form-msg", res.error || "Erreur.");
    }
  } catch(e) {
    toast("form-msg","Erreur réseau.");
  }
  btn.innerHTML = `<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Enregistrer le dossier`;
  btn.disabled = false;
}

/* ══════════════════════════════════════════════════════════════════
   MODAL DOSSIER
══════════════════════════════════════════════════════════════════ */
async function openDossierModal(d) {
  // Charger le dossier complet si on n'a pas les logs
  if (!d.logs) {
    const full = await http.get(`/dossiers/${d.id}`);
    if (!full.error) d = full;
  }
  S.currentDossier = d;
  $("m-numero").textContent = d.numero;
  $("m-client").textContent = d.client_nom;
  $("m-badge").innerHTML    = badge(d.statut, STATUTS);
  $("m-urgence-badge").innerHTML = d.urgence !== "normal" ? badge(d.urgence, URGENCES) : "";

  const total = ((d.cout_pieces||0)+(d.cout_main_oeuvre||0)-(d.remise||0));

  $("modal-body").innerHTML = `
    <div class="ms">
      <div class="ms-title">Client</div>
      <div class="mg">
        ${mf("Nom",d.client_nom)} ${mf("Téléphone",d.client_tel)} ${mf("Email",d.client_email)}
        ${mf("Adresse",d.client_adresse)}
      </div>
    </div>
    <div class="ms">
      <div class="ms-title">Véhicule</div>
      <div class="mg mg4">
        ${mf("Plaque",d.matricule,true)} ${mf("VIN",d.vin,true)}
        ${mf("Marque",d.marque)} ${mf("Modèle",d.modele)}
        ${mf("Année",d.annee)} ${mf("Couleur",d.couleur)}
        ${mf("Carburant",d.carburant)} ${mf("Transmission",d.transmission)}
      </div>
    </div>
    <div class="ms">
      <div class="ms-title">Intervention</div>
      <div class="mg mg4">
        ${mf("Type",TYPES[d.type_intervention]||d.type_intervention)}
        ${mf("Urgence",URGENCES[d.urgence]||d.urgence)}
        ${mf("Date entrée",d.date_entree)}
        ${mf("Sortie prévue",d.date_sortie_prevue)}
        ${mf("Sortie réelle",d.date_sortie_reelle)}
        ${mf("Technicien",d.technician)}
      </div>
    </div>
    <div class="ms">
      <div class="ms-title">Diagnostic & Travaux</div>
      <div class="mf" style="margin-bottom:10px"><div class="mf-label">DESCRIPTION PANNE</div><div class="mf-block">${esc(d.panne_description)}</div></div>
      <div class="mf" style="margin-bottom:10px"><div class="mf-label">RÉSOLUTION / TRAVAUX</div><div class="mf-block">${esc(d.panne_resolution)}</div></div>
      <div class="mf" style="margin-bottom:10px"><div class="mf-label">PIÈCES CHANGÉES</div><div class="mf-block">${esc(d.pieces_changees)}</div></div>
      ${d.observations?`<div class="mf"><div class="mf-label">OBSERVATIONS</div><div class="mf-block">${esc(d.observations)}</div></div>`:""}
      ${d.garantie_mois?`<div style="margin-top:8px">${mf("Garantie pièces",d.garantie_mois+" mois")}</div>`:""}
    </div>
    <div class="ms">
      <div class="ms-title">Financier — ${badge(d.type_tarif||"facture",{devis:"Devis",facture:"Facture"})}</div>
      <div class="mg mg4">
        ${mf("Pièces",fmtCFA(d.cout_pieces))}
        ${mf("Main d'œuvre",fmtCFA(d.cout_main_oeuvre))}
        ${d.remise?mf("Remise","-"+fmtCFA(d.remise)):""}
        <div class="mf"><div class="mf-label">TOTAL</div><div class="mf-val big">${fmtCFA(total)}</div></div>
      </div>
    </div>
    <div class="ms">
      <div class="ms-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>Photos</span>
        <label class="btn-sm-ghost" style="cursor:pointer">
          <svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          Ajouter
          <input type="file" id="photo-input" accept="image/*" multiple style="display:none" onchange="uploadPhotos(${d.id})"/>
        </label>
      </div>
      <div id="photos-grid" class="photos-grid"><div class="empty">Chargement…</div></div>
    </div>
    <div class="ms">
      <div class="ms-title">Historique des modifications</div>
      <div id="modal-logs"></div>
    </div>`;

  // Charger photos
  loadPhotos(d.id);

  // Logs
  const logsEl = document.getElementById("modal-logs");
  if (d.logs?.length) {
    d.logs.forEach(l => {
      const item = el("div","log-item");
      item.innerHTML = `<div class="log-time">${(l.created_at||"").slice(0,16)}</div>
        <div><span class="log-user">${esc(l.user)}</span> <span class="log-action">${esc(l.action)}</span>
        ${l.detail?`<span class="log-detail"> — ${esc(l.detail)}</span>`:""}</div>`;
      logsEl.appendChild(item);
    });
  } else {
    logsEl.innerHTML = '<div class="empty">Aucune entrée de journal.</div>';
  }

  $("m-btn-delete").style.display = S.role==="admin"?"":"none";
  // Pré-sélectionner le statut actuel dans le select
  const sel = $("m-statut-sel");
  if (sel) sel.value = d.statut || "en_cours";
  // Bouton WhatsApp
  renderWhatsApp(d);
  $("modal").classList.remove("hidden");
}

function mf(label, val, mono=false) {
  return `<div class="mf">
    <div class="mf-label">${label}</div>
    <div class="mf-val${mono?" mono":""}">${esc(val)}</div>
  </div>`;
}

function closeModal() {
  $("modal").classList.add("hidden");
  S.currentDossier = null;
}

/* ══════════════════════════════════════════════════════════════════
   PHOTOS
══════════════════════════════════════════════════════════════════ */
async function loadPhotos(dossierId) {
  const grid = $("photos-grid");
  if (!grid) return;
  grid.innerHTML = '<div class="empty">Chargement…</div>';
  const photos = await http.get(`/dossiers/${dossierId}/photos`);
  grid.innerHTML = "";
  if (!Array.isArray(photos) || !photos.length) {
    grid.innerHTML = '<div class="empty">Aucune photo pour ce dossier.</div>';
    return;
  }
  photos.forEach(p => {
    const wrap = el("div","photo-thumb");
    wrap.innerHTML = `
      <img src="${p.src}" alt="${esc(p.caption)}" onclick="openPhotoFull('${p.src}')"/>
      <div class="photo-caption">${esc(p.caption)||"—"}</div>
      ${S.role==="admin"?`<button class="photo-del" onclick="deletePhoto(${p.id},${dossierId})" title="Supprimer">✕</button>`:""}`;
    grid.appendChild(wrap);
  });
}

async function uploadPhotos(dossierId) {
  const input = $("photo-input");
  const files = Array.from(input.files);
  if (!files.length) return;
  for (const file of files) {
    const src = await new Promise(res => {
      const r = new FileReader();
      r.onload = e => res(e.target.result);
      r.readAsDataURL(file);
    });
    await http.post(`/dossiers/${dossierId}/photos`, {src, caption:""});
  }
  input.value = "";
  loadPhotos(dossierId);
}
window.uploadPhotos = uploadPhotos;

async function deletePhoto(pid, dossierId) {
  if (!confirm("Supprimer cette photo ?")) return;
  await http.del(`/photos/${pid}`);
  loadPhotos(dossierId);
}
window.deletePhoto = deletePhoto;

function openPhotoFull(src) {
  const ov = el("div","photo-fullscreen");
  ov.innerHTML = `<img src="${src}"/><button onclick="this.parentElement.remove()">✕</button>`;
  ov.addEventListener("click", e => { if(e.target===ov) ov.remove(); });
  document.body.appendChild(ov);
}
window.openPhotoFull = openPhotoFull;

/* ══════════════════════════════════════════════════════════════════
   WHATSAPP / SMS
══════════════════════════════════════════════════════════════════ */
function renderWhatsApp(d) {
  const foot = $("modal").querySelector(".modal-foot");
  const old = foot.querySelector(".btn-whatsapp");
  if (old) old.remove();
  if (!d.client_tel) return;
  const tel = d.client_tel.replace(/\D/g,"");
  const msg = encodeURIComponent(
    `Bonjour ${d.client_nom},\n\nVotre véhicule *${d.matricule}* (${[d.marque,d.modele].filter(Boolean).join(" ")||"—"}) est *${d.statut==="termine"?"prêt à récupérer":"en cours de traitement"}* au garage Zenitsu.\n\nDossier N° ${d.numero}${d.date_sortie_prevue?`\nSortie prévue : ${d.date_sortie_prevue}`:""}${(d.cout_pieces||d.cout_main_oeuvre)?`\nMontant : ${fmtCFA((d.cout_pieces||0)+(d.cout_main_oeuvre||0)-(d.remise||0))}`:""}.\n\nMerci pour votre confiance. 🔧`
  );
  const btn = el("a","btn-whatsapp");
  btn.href = `https://wa.me/${tel}?text=${msg}`;
  btn.target = "_blank";
  btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.118.549 4.105 1.51 5.833L.057 23.25l5.565-1.457A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.737 9.737 0 0 1-4.966-1.355l-.356-.211-3.305.866.882-3.22-.232-.371A9.722 9.722 0 0 1 2.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/></svg> WhatsApp`;
  foot.insertBefore(btn, foot.querySelector(".btn-warning"));
}

/* ══════════════════════════════════════════════════════════════════
   DELETE CLIENT / VEHICLE
══════════════════════════════════════════════════════════════════ */
async function deleteClient(cid, nom) {
  if (!confirm(`Supprimer le client "${nom}" et tous ses véhicules / dossiers archivés ?`)) return;
  const res = await http.del(`/clients/${cid}`);
  if (res.success) {
    document.getElementById("modal-vehicle").classList.add("hidden");
    App.goTab("clients");
  } else {
    alert(res.error || "Erreur lors de la suppression.");
  }
}
window.deleteClient = deleteClient;

async function deleteVehicle(vid, matricule) {
  if (!confirm(`Supprimer le véhicule "${matricule}" et ses dossiers archivés ?`)) return;
  const res = await http.del(`/vehicles/${vid}`);
  if (res.success) {
    document.getElementById("modal-vehicle").classList.add("hidden");
    App.goTab("vehicles");
  } else {
    alert(res.error || "Erreur lors de la suppression.");
  }
}
window.deleteVehicle = deleteVehicle;

/* ══════════════════════════════════════════════════════════════════
   PRINT
══════════════════════════════════════════════════════════════════ */
function printDossier(d) {
  const total = ((d.cout_pieces||0)+(d.cout_main_oeuvre||0)-(d.remise||0));
  $("print-zone").innerHTML = `
    <div class="p-header">
      <div>
        <div class="p-logo">Zenitsu <em>Garage</em></div>
        <div class="p-numero">${esc(d.numero)}</div>
      </div>
      <div>
        <div class="p-doc-type">${d.type_tarif==="devis"?"DEVIS":"FACTURE"}</div>
        <div class="p-date">Date : ${d.date_entree||new Date().toISOString().slice(0,10)}</div>
      </div>
    </div>

    <div class="p-grid2">
      <div class="p-section">
        <div class="p-section-title">Client</div>
        <div class="p-row"><span class="p-key">Nom</span><span class="p-val">${esc(d.client_nom)}</span></div>
        <div class="p-row"><span class="p-key">Téléphone</span><span class="p-val">${esc(d.client_tel)}</span></div>
        <div class="p-row"><span class="p-key">Email</span><span class="p-val">${esc(d.client_email)}</span></div>
        <div class="p-row"><span class="p-key">Adresse</span><span class="p-val">${esc(d.client_adresse)}</span></div>
      </div>
      <div class="p-section">
        <div class="p-section-title">Véhicule</div>
        <div class="p-row"><span class="p-key">Plaque</span><span class="p-val">${esc(d.matricule)}</span></div>
        <div class="p-row"><span class="p-key">Marque / Modèle</span><span class="p-val">${esc([d.marque,d.modele].filter(Boolean).join(" "))}</span></div>
        <div class="p-row"><span class="p-key">Année</span><span class="p-val">${esc(d.annee)}</span></div>
        <div class="p-row"><span class="p-key">VIN</span><span class="p-val">${esc(d.vin)}</span></div>
      </div>
    </div>

    <div class="p-section">
      <div class="p-section-title">Description de la panne</div>
      <div class="p-block">${esc(d.panne_description||"—")}</div>
    </div>
    <div class="p-section">
      <div class="p-section-title">Travaux effectués</div>
      <div class="p-block">${esc(d.panne_resolution||"—")}</div>
    </div>
    <div class="p-section">
      <div class="p-section-title">Pièces changées</div>
      <div class="p-block">${esc(d.pieces_changees||"—")}</div>
    </div>
    ${d.observations?`<div class="p-section"><div class="p-section-title">Observations</div><div class="p-block">${esc(d.observations)}</div></div>`:""}
    ${d.garantie_mois?`<div class="p-row"><span class="p-key">Garantie pièces</span><span class="p-val">${d.garantie_mois} mois</span></div>`:""}

    <div class="p-totals">
      <div class="p-section-title">Détail financier</div>
      <div class="p-total-row"><span>Coût pièces</span><span>${fmtCFA(d.cout_pieces)}</span></div>
      <div class="p-total-row"><span>Main d'œuvre</span><span>${fmtCFA(d.cout_main_oeuvre)}</span></div>
      ${d.remise?`<div class="p-total-row"><span>Remise</span><span>- ${fmtCFA(d.remise)}</span></div>`:""}
      <div class="p-total-row p-total-final"><span>TOTAL</span><span>${fmtCFA(total)}</span></div>
    </div>

    <div class="p-signature">
      <div class="p-sig-box">Signature client</div>
      <div class="p-sig-box">Cachet & signature garage</div>
    </div>
    <div class="p-footer">GarageDiag PRO · Technicien : ${esc(d.technician)} · Imprimé le ${new Date().toLocaleDateString("fr-FR")}</div>`;
  window.print();
}

/* ══════════════════════════════════════════════════════════════════
   ADMIN
══════════════════════════════════════════════════════════════════ */
async function loadUsers() {
  const data = await http.get("/users");
  const cont = $("users-list");
  cont.innerHTML = "";
  if (!Array.isArray(data)) return;
  data.forEach(u => {
    const row = el("div","user-row user-row-click");
    const isMe = u.username === S.username;
    row.innerHTML = `
      <div class="user-info">
        <div class="user-avatar ${u.role === 'admin' ? 'ua-admin' : 'ua-tech'}">
          ${u.username.slice(0,2).toUpperCase()}
        </div>
        <div>
          <div class="user-name">${esc(u.username)} ${isMe ? '<span class="user-me">moi</span>' : ''}</div>
          <div class="user-sub">Membre depuis ${(u.created_at||"").slice(0,10)}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        ${badge(u.role,{admin:"Admin",technician:"Technicien"})}
        <svg class="user-edit-ico" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </div>`;
    row.addEventListener("click", () => openUserModal(u));
    cont.appendChild(row);
  });
}

async function openUserModal(u) {
  $("mu-id").value          = u.id;
  $("mu-user").value        = u.username;
  $("mu-pass").value        = "";
  $("mu-role").value        = u.role;
  $("mu-username-title").textContent = u.username;
  $("mu-role-badge").innerHTML = badge(u.role, {admin:"Admin", technician:"Technicien"});
  $("mu-msg").classList.add("hidden");

  // Charger logs + stats
  $("mu-logs").innerHTML = '<div class="empty">Chargement…</div>';
  $("mu-stats").innerHTML = "";
  const res = await http.get(`/users/${u.id}/logs`);
  if (!res.error) {
    // Stats
    $("mu-stats").innerHTML = `
      <div class="mu-stat-row">
        <div class="mu-stat"><div class="mu-stat-n">${res.total}</div><div class="mu-stat-l">Actions totales</div></div>
        <div class="mu-stat"><div class="mu-stat-n">${res.logs.length < res.total ? res.logs.length+'+' : res.logs.length}</div><div class="mu-stat-l">Affichées</div></div>
      </div>`;
    // Logs
    const logsEl = $("mu-logs");
    logsEl.innerHTML = "";
    if (res.logs.length) {
      res.logs.forEach(l => {
        const item = el("div","log-item");
        item.innerHTML = `
          <div class="log-time">${(l.created_at||"").slice(0,16)}</div>
          <div>
            <span class="log-action">${esc(l.action)}</span>
            <span style="color:var(--cyan);font-family:var(--mono);font-size:10px"> ${esc(l.numero||"")}</span>
            ${l.detail?`<span class="log-detail"> — ${esc(l.detail)}</span>`:""}
          </div>`;
        logsEl.appendChild(item);
      });
    } else {
      logsEl.innerHTML = '<div class="empty">Aucune action enregistrée.</div>';
    }
  }
  $("modal-user").classList.remove("hidden");
}

function closeUserModal() {
  $("modal-user").classList.add("hidden");
}

async function saveUser() {
  const id       = $("mu-id").value;
  const username = $("mu-user").value.trim();
  const password = $("mu-pass").value;
  const role     = $("mu-role").value;
  if (!username) { toast("mu-msg","Identifiant requis."); return; }
  const btn = $("mu-btn-save");
  btn.textContent = "Enregistrement…"; btn.disabled = true;
  const res = await http.put(`/users/${id}`, {username, password, role});
  btn.innerHTML = `<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round"><polyline points="20 6 9 17 4 12"/></svg> Enregistrer`;
  btn.disabled = false;
  if (res.success) {
    toast("mu-msg","Modifications enregistrées.","ok");
    // Mettre à jour le token si c'est l'utilisateur courant
    if ($("mu-user").dataset.originalName === S.username) {
      $("tb-user").textContent = username;
      S.username = username;
    }
    loadUsers();
  } else {
    toast("mu-msg", res.error||"Erreur.");
  }
}

async function addUser() {
  const username = $("au-user").value.trim();
  const password = $("au-pass").value;
  const role     = $("au-role").value;
  if (!username || !password) { toast("au-msg","Champs requis."); return; }
  const res = await http.post("/users", {username, password, role});
  if (res.success) {
    toast("au-msg","Utilisateur créé.","ok");
    $("au-user").value = ""; $("au-pass").value = "";
    loadUsers();
  } else {
    toast("au-msg", res.error||"Erreur.");
  }
}

/* ══════════════════════════════════════════════════════════════════
   THEMES — 3 palettes, tirage aléatoire au démarrage
══════════════════════════════════════════════════════════════════ */
const THEMES = ["theme-cyan", "theme-navy", "theme-light"];
function applyRandomTheme() {
  const t = THEMES[Math.floor(Math.random() * THEMES.length)];
  document.documentElement.className = t;
}

/* ══════════════════════════════════════════════════════════════════
   KPI CLICK — filtre la liste dossiers par statut
══════════════════════════════════════════════════════════════════ */
function kpiClick(statut) {
  App.goTab("dossiers");
  const sel = $("f-statut");
  if (sel) sel.value = statut;
  loadDossiers();
}
window.kpiClick = kpiClick;

/* ══════════════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {

  // Thème aléatoire au démarrage
  applyRandomTheme();

  // Login
  $("btn-login").addEventListener("click", login);
  $("l-pass").addEventListener("keydown", e => { if(e.key==="Enter") login(); });
  $("l-user").addEventListener("keydown", e => { if(e.key==="Enter") $("l-pass").focus(); });
  $("btn-logout").addEventListener("click", logout);

  // Nav
  qsa(".snav-item").forEach(b => b.addEventListener("click", () => App.goTab(b.dataset.tab)));

  // Global search
  $("gsearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => globalSearch($("gsearch").value.trim()), 300);
  });
  $("gsearch").addEventListener("keydown", e => {
    if (e.key === "Escape") {
      $("gsearch-results").classList.add("hidden");
      $("gsearch").value = "";
    }
    if (e.key === "Enter") {
      $("gsearch-results").classList.add("hidden");
      App.goTab("dossiers");
      loadDossiers();
    }
  });
  document.addEventListener("click", e => {
    if (!$("gsearch-wrap").contains(e.target)) $("gsearch-results").classList.add("hidden");
  });

  // Filters on dossiers tab
  ["f-statut","f-urgence","f-type"].forEach(id => $(id)?.addEventListener("change", () => {
    if (qs("#tab-dossiers.active")) loadDossiers();
  }));

  // Vehicles / clients search
  $("v-search")?.addEventListener("keydown", e => { if(e.key==="Enter") loadVehicles(); });
  $("c-search")?.addEventListener("keydown", e => { if(e.key==="Enter") loadClients(); });

  // Form
  $("btn-save").addEventListener("click", saveDossier);
  $("btn-cancel").addEventListener("click", () => App.goTab("dossiers"));
  $("fi-pieces-cout").addEventListener("input", updateTotal);
  $("fi-mo").addEventListener("input", updateTotal);
  $("fi-remise").addEventListener("input", updateTotal);

  // Lookup
  $("btn-lookup").addEventListener("click", lookupVehicle);
  $("lookup-input").addEventListener("keydown", e => { if(e.key==="Enter") lookupVehicle(); });

  // Modal dossier
  $("modal").addEventListener("click", e => { if(e.target===$("modal")) closeModal(); });
  $("m-btn-edit").addEventListener("click", () => {
    const d = S.currentDossier;
    closeModal();
    fillFormDossier(d);
    App.goTab("nouveau");
  });
  $("m-btn-print").addEventListener("click", () => { if(S.currentDossier) printDossier(S.currentDossier); });
  $("m-btn-delete").addEventListener("click", async () => {
    const d = S.currentDossier;
    if (!confirm(`Supprimer le dossier ${d.numero} ?`)) return;
    const res = await http.del(`/dossiers/${d.id}`);
    if (res.success) { closeModal(); App.goTab("dossiers"); }
  });

  // Changement de statut rapide depuis modal
  $("m-btn-statut")?.addEventListener("click", async () => {
    const d = S.currentDossier;
    if (!d) return;
    const newStatut = $("m-statut-sel").value;
    if (newStatut === d.statut) return;
    const res = await http.patch(`/dossiers/${d.id}/statut`, {statut: newStatut});
    if (res.success) {
      d.statut = newStatut;
      $("m-badge").innerHTML = badge(newStatut, STATUTS);
      toast("form-msg", `Statut mis à jour → ${STATUTS[newStatut]}`, "ok");
    }
  });

  // Modal utilisateur
  $("modal-user")?.addEventListener("click", e => { if(e.target===$("modal-user")) closeUserModal(); });
  $("mu-btn-save")?.addEventListener("click", saveUser);

  // Admin
  $("btn-add-user").addEventListener("click", addUser);
});
