// Clé TMDB : celle de config.js / config.local.js, sinon celle saisie au premier lancement (gardée dans ce navigateur).
try { window.TMDB_KEY = window.TMDB_KEY || localStorage.getItem("tmdb-key") || ""; } catch { window.TMDB_KEY = window.TMDB_KEY || ""; }
const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const IMG = "https://image.tmdb.org/t/p/";

const LB_ICON = '<svg class="lb" viewBox="0 0 30 18" aria-hidden="true"><circle cx="5" cy="9" r="4.5" fill="#ff8000"/><circle cx="15" cy="9" r="4.5" fill="#00e054"/><circle cx="25" cy="9" r="4.5" fill="#40bcf4"/></svg>';

// ---- TMDB ----
async function tmdb(path, params = {}) {
  const key = window.TMDB_KEY;
  const url = new URL("https://api.themoviedb.org/3" + path);
  url.search = new URLSearchParams({ language: "fr-FR", ...params, ...(key.length > 40 ? {} : { api_key: key }) });
  const res = await fetch(url, key.length > 40 ? { headers: { Authorization: "Bearer " + key } } : undefined);
  if (!res.ok) throw new Error("TMDB " + res.status);
  return res.json();
}
// Date de sortie en France si TMDB la fournit (salles : type 3, puis 2 ou 1), sinon date générale.
function frDate(m) {
  const fr = m.release_dates?.results?.find((r) => r.iso_3166_1 === "FR")?.release_dates || [];
  for (const t of [3, 2, 1]) {
    const hit = fr.filter((d) => d.type === t && d.release_date).sort((a, b) => a.release_date.localeCompare(b.release_date))[0];
    if (hit) return hit.release_date.slice(0, 10);
  }
  return m.release_date || "";
}
const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "");
// Bande-annonce YouTube fournie par TMDB (VF en priorité, officielle en priorité).
function trailerKey(m) {
  const v = (m.videos?.results || []).filter((x) => x.site === "YouTube" && x.type === "Trailer" && x.key);
  const score = (x) => (x.iso_639_1 === "fr" ? 2 : 0) + (x.official ? 1 : 0);
  return v.sort((a, b) => score(b) - score(a))[0]?.key || "";
}
const norm = (m) => ({
  trailer: trailerKey(m),
  backdrop: m.backdrop_path, vote: m.vote_average, votes: m.vote_count, originalLang: m.original_language,
  countries: (m.production_countries || []).map((c) => c.name),
  cast: (m.credits?.cast || []).slice(0, 12),
  tmdbId: m.id, title: m.title, originalTitle: m.original_title, year: (m.release_date || "").slice(0, 4), date: frDate(m),
  poster: m.poster_path, synopsis: m.overview, duration: m.runtime,
  genres: (m.genres || []).map((g) => g.name), genreIds: m.genre_ids || [],
  director: (m.credits?.crew || []).filter((c) => c.job === "Director").map((c) => c.name).join(", ")
});

let nowPlaying = null, genreMap = {};
async function loadNowPlaying() {
  if (nowPlaying) return nowPlaying;
  const [g, p1, p2] = await Promise.all([
    tmdb("/genre/movie/list"),
    tmdb("/movie/now_playing", { region: TMDB_REGION, page: 1 }),
    tmdb("/movie/now_playing", { region: TMDB_REGION, page: 2 })
  ]);
  g.genres.forEach((x) => (genreMap[x.id] = x.name));
  const seen = new Set();
  nowPlaying = [...p1.results, ...p2.results].filter((m) => !seen.has(m.id) && seen.add(m.id)).map(norm);
  return nowPlaying;
}

// ---- Séances : cinémas indépendants (SCARE / Data Ciné Indés, Licence Ouverte 2.0) ----
// Ne couvre PAS UGC, MK2 ni Pathé. Rapprochement par titre uniquement (pas d'identifiant commun).
const SHOW_API = "https://datacinesindes.fr/data-fair/api/v1/datasets/programmation-cinemas/lines";
const flat = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const VERSION = { VERSION_ORIGINAL: "VO", VERSION_LOCAL: "VF" };

async function showtimesFor(f) {
  const url = new URL(SHOW_API);
  url.search = new URLSearchParams({
    q: f.title, size: 1000, sort: "showstart", showstart_gte: new Date().toISOString(),
    select: "filmtitle,showstart,cinenom,cineville,cinecp,showurl,filmversion"
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error("Séances " + res.status);
  const wanted = new Set([flat(f.title), flat(f.originalTitle)].filter(Boolean));
  return (await res.json()).results.filter((s) => wanted.has(flat(s.filmtitle)));
}

function renderShowtimes(list, city) {
  const c = flat(city);
  const shows = list.filter((s) => !c || flat(s.cineville).includes(c) || String(s.cinecp).startsWith(c));
  if (!shows.length) return `<p>Aucune séance trouvée${city ? " pour cette ville" : ""} parmi les cinémas indépendants.</p>`;
  const byCine = {};
  shows.forEach((s) => ((byCine[s.cinenom + "|" + s.cineville] ??= []).push(s)));
  const fmt = (d) => d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  return Object.entries(byCine).map(([k, ss]) => {
    const [nom, ville] = k.split("|");
    const days = {};
    ss.forEach((s) => { const d = new Date(s.showstart); (days[fmt(d)] ??= []).push({ d, s }); });
    return `<details class="cine"><summary>${esc(nom)} <small>${esc(ville)} · ${ss.length} séance${ss.length > 1 ? "s" : ""}</small></summary>` + Object.entries(days).map(([day, items]) =>
      `<div class="day"><b>${esc(day)}</b> ` + items.map(({ d, s }) => {
        const t = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) + (VERSION[s.filmversion] ? " " + VERSION[s.filmversion] : "");
        return /^https:\/\//.test(s.showurl || "") ? `<a class="slot" href="${esc(s.showurl)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>` : `<span class="slot">${esc(t)}</span>`;
      }).join("") + "</div>").join("") + "</details>";
  }).join("");
}

// ---- Vues ----
function missingKey() {
  app.innerHTML = `<h1>Bienvenue sur Pélicane</h1>
    <p class="hint">Pour afficher les films, colle ta clé TMDB (gratuite : <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">themoviedb.org</a>).
    Elle est gardée uniquement dans ce navigateur, sur cet appareil.</p>
    <form id="key-form" class="filters"><input id="key-in" placeholder="Clé d'API TMDB" autocomplete="off" required><button>Enregistrer</button></form>`;
  document.getElementById("key-form").onsubmit = (e) => {
    e.preventDefault();
    try { localStorage.setItem("tmdb-key", document.getElementById("key-in").value.trim()); } catch {}
    location.reload();
  };
}
const errorView = (e) => (app.innerHTML = `<p>Impossible de charger les films (${esc(e.message)}). Vérifie ta clé TMDB et ta connexion. <a href="#" onclick="try{localStorage.removeItem('tmdb-key')}catch(e){}location.reload();return false">Changer de clé</a></p>`);

function card(f) {
  const lim = new Date(); lim.setFullYear(lim.getFullYear() - 1);
  const old = !!f.date && new Date(f.date) < lim;
  const img = f.poster ? `<img class="poster" loading="lazy" alt="" src="${IMG}w500${f.poster}">` : `<div class="poster noimg">${esc(f.title)}</div>`;
  return `<a class="card" href="#/film/${f.tmdbId}"><div class="thumb">${img}</div>
    <h3>${esc(f.title)}</h3><p>${esc(old ? "Film de " + f.year : fmtDate(f.date) || f.year)}</p></a>`;
}

// Apparition progressive des cartes au défilement (comme sur le portfolio).
function reveal() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { rootMargin: "0px 0px -6% 0px" });
  app.querySelectorAll(".card").forEach((c, i) => { c.classList.add("wait"); c.style.transitionDelay = (i % 4) * 60 + "ms"; io.observe(c); });
}

const setTitle = (t) => { const el = document.getElementById("page-title"); if (el) el.textContent = t; };

let filter = { q: "", genre: "", tab: "new" };
async function home() {
  app.innerHTML = "<p>Chargement…</p>";
  const films = await loadNowPlaying();
  const genres = [...new Set(films.flatMap((f) => f.genreIds.map((i) => genreMap[i])).filter(Boolean))].sort();
  app.innerHTML = `
    <section class="hero"><h1>À l'affiche <span>cette semaine</span></h1><p>${films.length} films en salles en France</p></section>
    <div class="filters">
      <input id="q" type="search" placeholder="Rechercher un film…" value="${esc(filter.q)}">
      <select id="g"><option value="">Tous les genres</option>${genres.map((g) => `<option${g === filter.genre ? " selected" : ""}>${esc(g)}</option>`).join("")}</select>
    </div>
    <div class="tabs" role="tablist">
      <button class="tab" data-tab="new" role="tab">Nouveautés <small id="n-new"></small></button>
      <button class="tab" data-tab="old" role="tab">Ressorties <small id="n-old"></small></button>
    </div>
    <p class="hint" id="tab-hint"></p>
    <div class="grid" id="grid"></div>`;
  // Ressortie = film dont la sortie d'origine date de plus d'un an et qui est de nouveau en salles.
  // Nouveautés = sorti depuis moins d'un an. Les sorties de la semaine (depuis mercredi) sont marquées.
  const limit = new Date(); limit.setFullYear(limit.getFullYear() - 1);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const isOld = (f) => !!f.date && f.date < ymd(limit);
  const byDate = (a, b) => (b.date || "").localeCompare(a.date || "");
  const draw = () => {
    const q = filter.q.trim().toLowerCase();
    const list = films.filter((f) => (!q || f.title.toLowerCase().includes(q)) && (!filter.genre || f.genreIds.some((i) => genreMap[i] === filter.genre)));
    const news = list.filter((f) => !isOld(f)).sort(byDate), olds = list.filter(isOld).sort(byDate);
    document.getElementById("n-new").textContent = news.length;
    document.getElementById("n-old").textContent = olds.length;
    app.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === filter.tab));
    document.getElementById("tab-hint").textContent = filter.tab === "new" ? "Films sortis il y a moins d'un an." : "Films anciens de retour en salles.";
    const shown = filter.tab === "new" ? news : olds;
    document.getElementById("grid").innerHTML = shown.length ? shown.map(card).join("") : "<p>Aucun film.</p>";
    reveal();
  };
  app.querySelectorAll(".tab").forEach((b) => (b.onclick = () => { filter.tab = b.dataset.tab; draw(); }));
  document.getElementById("q").oninput = (e) => { filter.q = e.target.value; draw(); };
  document.getElementById("g").onchange = (e) => { filter.genre = e.target.value; draw(); };
  draw();
}

function castHtml(f) {
  if (!f.cast.length) return "";
  return `<h2>Distribution</h2><div class="cast">${f.cast.map((a) =>
    `<div class="actor">${a.profile_path ? `<img loading="lazy" alt="" src="${IMG}w185${a.profile_path}">` : '<div class="noph"></div>'}<b>${esc(a.name)}</b><small>${esc(a.character || "")}</small></div>`).join("")}</div>`;
}

async function filmPage(id) {
  app.innerHTML = "<p>Chargement…</p>";
  const f = norm(await tmdb("/movie/" + id, { append_to_response: "credits,release_dates,videos", include_video_language: "fr,en,null" }));
  const lb = Letterboxd.urlFor(f);
  const lang = f.originalLang ? (new Intl.DisplayNames(["fr"], { type: "language" }).of(f.originalLang) || f.originalLang) : "";
  const hm = f.duration ? `${Math.floor(f.duration / 60)}h ${String(f.duration % 60).padStart(2, "0")}m` : "";
  const row = (k, v) => (v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : "");
  const ytUrl = f.trailer ? "https://www.youtube.com/watch?v=" + encodeURIComponent(f.trailer) : "";
  const media = f.backdrop
    ? `<div class="media"><img alt="" src="${IMG}w1280${f.backdrop}">${ytUrl ? `<a class="play" data-trailer="${esc(f.trailer)}" href="${ytUrl}" target="_blank" rel="noopener noreferrer" aria-label="Voir la bande-annonce"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#fff"/></svg></a>` : ""}</div>` : "";
  app.innerHTML = `
    <a href="#/">← Retour</a>
    <div class="film">
      <aside>
        ${f.poster ? `<img class="poster" alt="" src="${IMG}w500${f.poster}">` : ""}
        <h2 class="bar">Détails</h2>
        <dl class="facts">
          ${row("Titre original", f.originalTitle)}${row("Langue originale", lang)}${row("Date de sortie", fmtDate(f.date))}
          ${row("Réalisateur", f.director)}${row("Pays de production", f.countries.join(", "))}
        </dl>
      </aside>
      <section class="main">
        <h1>${esc(f.title)}</h1>
        <div class="stats">
          ${f.votes ? `<span class="score"><svg viewBox="0 0 24 24"><path d="M12 2l3 6.9 7.5.7-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4-5.7-5 7.5-.7z" fill="currentColor"/></svg><b>${f.vote.toFixed(1)}</b><small>${f.votes} évaluations<br>(TMDB)</small></span>` : ""}
          ${f.year ? `<span>${esc(f.year)}</span>` : ""}${hm ? `<span>${hm}</span>` : ""}
        </div>
        ${media}
        <div class="pills">${f.genres.map((g) => `<span>${esc(g)}</span>`).join("")}</div>
        <p>${esc(f.synopsis || "Pas de synopsis.")}</p>
        <div class="actions">
          <button id="b-list">${Store.isInList(id) ? "Retirer de ma liste" : "Ajouter à ma liste"}</button>
          <a class="lbbtn" href="${lb.url}" target="_blank" rel="noopener noreferrer">${LB_ICON}Critiquer ce film sur Letterboxd</a>
        </div>
    <h2>Mes cinémas</h2>
    <div class="actions">
      <a class="chain" href="https://www.mk2.com/salle/mk2-nation" target="_blank" rel="noopener noreferrer">★ mk2 Nation</a>
      <a class="chain" href="https://www.mk2.com/salle/mk2-bibliotheque" target="_blank" rel="noopener noreferrer">★ mk2 BNF</a>
      <a class="chain" href="https://www.ugc.fr/cinema.html?id=12" target="_blank" rel="noopener noreferrer">★ UGC Bercy</a>
    </div>
    <h2>Séances en cinémas indépendants</h2>
    <div class="filters"><input id="city" placeholder="Ville ou code postal (ex. Paris, 69)" value="${esc(localStorage.getItem("city") || "")}"></div>
    <div id="shows"><p>Chargement des séances…</p></div>
    ${castHtml(f)}
      </section>
    </div>`;
  document.getElementById("b-list").onclick = () => { Store.toggleList(id); filmPage(id); };
  const box = document.getElementById("shows"), cityIn = document.getElementById("city");
  try {
    const list = await showtimesFor(f);
    const draw = () => { try { localStorage.setItem("city", cityIn.value); } catch {} box.innerHTML = renderShowtimes(list, cityIn.value); };
    cityIn.oninput = draw; draw();
  } catch (e) { box.innerHTML = `<p>Séances indisponibles (${esc(e.message)}).</p>`; }
}

// ---- Import d'un export Letterboxd (CSV) : films vus ou watchlist ----
// Le fichier reste dans ton navigateur ; seuls titres et années sont envoyés à TMDB pour retrouver les films.
function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

async function findTmdb({ name, year }) {
  let hit = (await tmdb("/search/movie", { query: name, year })).results[0];
  if (!hit) hit = (await tmdb("/search/movie", { query: name })).results.find((m) => Math.abs(+(m.release_date || "0").slice(0, 4) - year) <= 1);
  return hit?.id;
}

let lastImport = null;
async function importLetterboxd(file, target, progress) {
  const rows = parseCSV((await file.text()).replace(/^\uFEFF/, ""));
  const head = rows.shift().map((h) => h.trim().toLowerCase());
  const iN = head.indexOf("name"), iY = head.indexOf("year"), iU = head.indexOf("letterboxd uri");
  if (iN < 0 || iY < 0) throw new Error("colonnes « Name » et « Year » introuvables : est-ce bien un export Letterboxd ?");
  const items = rows.filter((r) => r[iN]).map((r) => ({ name: r[iN], year: +r[iY], uri: iU >= 0 ? r[iU] : "" }));
  const ids = [], missing = []; let done = 0;
  for (let i = 0; i < items.length; i += 5) {
    await Promise.all(items.slice(i, i + 5).map(async (it) => {
      try {
        const id = await findTmdb(it);
        if (id) { ids.push(id); if (Letterboxd.isUri(it.uri)) Store.setLbUri(id, it.uri); } else missing.push(it);
      } catch { missing.push(it); }
      progress(++done, items.length);
    }));
  }
  Store.addMany(target, ids);
  lastImport = { total: items.length, ok: ids.length, target, missing };
}

function importBlock() {
  const r = lastImport;
  return `<h2>Importer depuis Letterboxd</h2>
    <p class="hint">Dans Letterboxd : Paramètres → Données → Exporter. Choisis ici le fichier <code>watchlist.csv</code>. Rien n'est envoyé à Letterboxd.</p>
    <div class="filters">
      <input type="file" id="imp-file" accept=".csv">
    </div>
    <p class="hint" id="imp-status">${r ? `${r.ok} films importés sur ${r.total}.` : ""}</p>
    ${r && r.missing.length ? `<details class="cine"><summary>${r.missing.length} film(s) non retrouvé(s)</summary><ul>${r.missing.map((m) => `<li>${esc(m.name)} (${esc(m.year)})</li>`).join("")}</ul></details>` : ""}`;
}

function wireImport() {
  const file = document.getElementById("imp-file"), st = document.getElementById("imp-status");
  if (!file) return;
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    const target = "watchlist";
    try { await importLetterboxd(f, target, (d, n) => { st.textContent = `Import en cours… ${d}/${n}`; }); await myList(); }
    catch (e) { st.textContent = "Import impossible : " + e.message; }
  };
}

async function myList() {
  app.innerHTML = "<p>Chargement…</p>";
  const s = Store.all();
  const load = (ids) => Promise.all(ids.map((i) => tmdb("/movie/" + i).then(norm)));
  const todo = await load(s.watchlist);
  const block = (t, l) => (l.length ? `<div class="grid">${l.map(card).join("")}</div>` : "<p>Rien pour l'instant.</p>");
  app.innerHTML = `<h1>Ma liste</h1>${block("À voir", todo)}${importBlock()}`;
  wireImport();
  reveal();
}


// Ma watchlist Letterboxd, préchargée une seule fois (seed.js) dans « À voir ».
(function applySeed() {
  if (!window.SEED) return;
  try {
    if (localStorage.getItem("seed-v1")) return;
    Store.addMany("watchlist", SEED.watchlist);
    Object.entries(SEED.lb).forEach(([id, uri]) => { if (Letterboxd.isUri(uri)) Store.setLbUri(+id, uri); });
    localStorage.setItem("seed-v1", "1");
  } catch {}
})();

// Bandeau d'alerte (une fois par session) quand un film de ma liste est au cinéma.
function toast(html) {
  const t = document.createElement("div");
  t.className = "toast"; t.innerHTML = html;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  const close = () => { t.classList.remove("show"); setTimeout(() => t.remove(), 400); };
  t.onclick = close; setTimeout(close, 9000);
}

// ---- Notifications (dans l'appli, calculées à l'ouverture ; pas de notification système) ----
//  1. un film de ma liste « À voir » est sorti (il est à l'affiche en ce moment) ;
//  2. un film à l'affiche pourrait me plaire (recommandations TMDB basées sur mes films vus / à voir).
const getSeen = () => { try { return JSON.parse(localStorage.getItem("notif-seen")) || []; } catch { return []; } };
const setSeen = (a) => { try { localStorage.setItem("notif-seen", JSON.stringify(a)); } catch {} };
let notifCache = null, notifSig = "";

async function buildNotifs() {
  const s = Store.all(), sig = JSON.stringify(s.watchlist);
  if (notifCache && sig === notifSig) return notifCache;
  const playing = await loadNowPlaying(), byId = new Map(playing.map((f) => [f.tmdbId, f]));
  const out = [];
  s.watchlist.forEach((id) => { const f = byId.get(id); if (f) out.push({ key: "out:" + id, film: f, text: `« ${f.title} » est au cinéma en ce moment.` }); });
  const known = new Set(s.watchlist);
  const bases = s.watchlist.slice(-6);
  const recs = new Map();
  await Promise.all(bases.map(async (id) => {
    try {
      const [base, r] = await Promise.all([tmdb("/movie/" + id), tmdb(`/movie/${id}/recommendations`)]);
      r.results.forEach((m) => {
        if (!byId.has(m.id) || known.has(m.id)) return;
        const e = recs.get(m.id) || { n: 0, vote: m.vote_average || 0, from: base.title };
        e.n++; recs.set(m.id, e);
      });
    } catch {}
  }));
  [...recs.entries()].sort((a, b) => b[1].n - a[1].n || b[1].vote - a[1].vote).slice(0, 3).forEach(([id, e]) => {
    const f = byId.get(id);
    out.push({ key: "rec:" + id, film: f, text: `« ${f.title} » pourrait te plaire, comme « ${e.from} ».` });
  });
  notifCache = out; notifSig = sig;
  return out;
}

async function updateBell() {
  const el = document.getElementById("bell-n");
  if (!el || !window.TMDB_KEY) return;
  try {
    const seen = getSeen(), fresh = (await buildNotifs()).filter((x) => !seen.includes(x.key));
    el.textContent = fresh.length || ""; el.hidden = !fresh.length;
    const out = fresh.filter((x) => x.key.startsWith("out:"));
    let shown = false;
    try { shown = sessionStorage.getItem("toast") === "1"; } catch {}
    if (out.length && !shown) {
      try { sessionStorage.setItem("toast", "1"); } catch {}
      toast(`<b>🎬 Au cinéma</b><br>${out.length === 1 ? esc(out[0].text) : `${out.length} films de ta liste sont au cinéma.`}<br><a href="#/notifications">Voir</a>`);
    }
  } catch {}
}

async function notificationsPage() {
  app.innerHTML = "<p>Chargement…</p>";
  const list = await buildNotifs(), seen = getSeen();
  app.innerHTML = `<h1>Notifications</h1>` + (list.length
    ? `<ul class="notifs">${list.map((n) => `<li class="${seen.includes(n.key) ? "" : "new"}"><a href="#/film/${n.film.tmdbId}">
        ${n.film.poster ? `<img alt="" src="${IMG}w92${n.film.poster}">` : '<div class="noph"></div>'}<span>${esc(n.text)}</span></a></li>`).join("")}</ul>`
    : `<p class="hint">Rien pour l'instant. Ajoute des films à « À voir » ou marque des films comme vus pour recevoir des suggestions.</p>`);
  setSeen([...new Set([...seen, ...list.map((n) => n.key)])]);
  updateBell();
}

// ---- Découvrir : fil vertical plein écran façon TikTok (pensé pour le téléphone) ----
// Défiler = film suivant ; double-tape = j'aime -> ajouté à « À voir » ; bande-annonce en lien YouTube.
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.4l-1.5-1.3C5.4 15.5 2 12.4 2 8.6 2 5.5 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.5 22 8.6c0 3.8-3.4 6.9-8.5 11.5L12 21.4z" fill="currentColor"/></svg>';

function slide(f) {
  const liked = Store.isInList(f.tmdbId);
  const names = f.genreIds.map((i) => genreMap[i]).filter(Boolean).slice(0, 3).join(" · ");
  return `<section class="slide" data-id="${f.tmdbId}">
    ${f.poster ? `<img class="bg" alt="" loading="lazy" src="${IMG}w780${f.poster}">` : ""}
    <img class="bg gal" alt="" aria-hidden="true"><img class="bg gal" alt="" aria-hidden="true">
    <div class="shade"></div>
    <div class="heartpop" aria-hidden="true">${HEART}</div>
    <button class="like${liked ? " on" : ""}" aria-label="Ajouter à ma liste">${HEART}<small>Ma liste</small></button>
    <div class="info">
      <div class="stitle">${esc(f.title)}</div>
      <div class="smeta">${esc(fmtDate(f.date) || f.year)}${names ? " · " + esc(names) : ""}</div>
      <p class="syn">${esc(f.synopsis || "Pas de synopsis.")}</p>
      <div class="sacts">
        <a class="trailer" target="_blank" rel="noopener noreferrer" hidden>▶ Bande-annonce</a>
        <a class="more" href="#/film/${f.tmdbId}">Fiche du film</a>
      </div>
    </div>
  </section>`;
}

async function feedPage() {
  app.innerHTML = "<p>Chargement…</p>";
  const films = await loadNowPlaying();
  app.innerHTML = `<div class="feed" id="feed">${films.map(slide).join("")}</div>`;
  const feed = document.getElementById("feed"), hint = document.getElementById("feed-hint");
  setTimeout(() => hint?.classList.add("gone"), 5000);

  const like = (sl, add) => {
    const id = +sl.dataset.id, btn = sl.querySelector(".like");
    const inList = Store.isInList(id);
    if (add && !inList) Store.addMany("watchlist", [id]);
    else if (!add) Store.toggleList(id);
    btn.classList.toggle("on", Store.isInList(id));
    if (add) { const p = sl.querySelector(".heartpop"); p.classList.remove("go"); void p.offsetWidth; p.classList.add("go"); hint?.classList.add("gone"); }
  };
  feed.addEventListener("click", (e) => { const b = e.target.closest(".like"); if (b) like(b.closest(".slide"), false); });
  let last = 0;
  feed.addEventListener("touchend", (e) => {
    if (e.target.closest("a,button")) return;
    const now = Date.now();
    if (now - last < 320) { like(e.target.closest(".slide"), true); last = 0; } else last = now;
  });
  feed.addEventListener("dblclick", (e) => { if (!e.target.closest("a,button")) like(e.target.closest(".slide"), true); });

  // Galerie : si on reste plus de 2,5 s sur un film, des images du film défilent en fondu (toutes les 3 s).
  const gallery = new Map(), stops = new Set();
  const stopGallery = (sl) => {
    clearTimeout(sl._t); clearInterval(sl._iv);
    sl.querySelectorAll(".gal").forEach((g) => g.classList.remove("on"));
  };
  const startGallery = (sl) => {
    stopGallery(sl);
    sl._t = setTimeout(async () => {
      const id = +sl.dataset.id;
      if (!gallery.has(id)) {
        try {
          const r = await tmdb(`/movie/${id}/images`, { include_image_language: "fr,en,null" });
          const list = (r.backdrops.length ? r.backdrops : r.posters).slice(0, 8);
          gallery.set(id, list.map((x) => `${IMG}w780${x.file_path}`));
        } catch { gallery.set(id, []); }
      }
      const urls = gallery.get(id);
      if (!urls.length) return;
      const layers = sl.querySelectorAll(".gal"); let i = 0, side = 0;
      const next = () => {
        const img = layers[side], other = layers[1 - side], url = urls[i % urls.length]; i++; side = 1 - side;
        img.onload = () => { img.classList.add("on"); other.classList.remove("on"); };
        img.src = url;
      };
      next(); sl._iv = setInterval(next, 3000);
      stops.add(sl);
    }, 2500);
  };
  addEventListener("hashchange", () => stops.forEach(stopGallery), { once: true });

  // Bande-annonce chargée quand le film est à l'écran (une requête par film).
  const done = new Set();
  const io = new IntersectionObserver((es) => es.forEach(async (e) => {
    if (!e.isIntersecting) { stopGallery(e.target); return; }
    startGallery(e.target);
    const sl = e.target, id = +sl.dataset.id;
    if (done.has(id)) return; done.add(id);
    try {
      const m = await tmdb("/movie/" + id, { append_to_response: "videos", include_video_language: "fr,en,null" });
      const key = trailerKey(m), a = sl.querySelector(".trailer");
      if (key) { a.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(key); a.dataset.trailer = key; a.hidden = false; }
    } catch {}
  }), { root: feed, threshold: 0.6 });
  feed.querySelectorAll(".slide").forEach((s) => io.observe(s));
}

async function route() {
  if (!window.TMDB_KEY) return missingKey();
  const h = location.hash.replace(/^#/, "") || "/";
  const feedMode = h === "/feed" || (h === "/" && matchMedia("(max-width: 760px)").matches);
  document.body.classList.toggle("feed", feedMode);
  try {
    scrollTo(0, 0);
    if (feedMode) await feedPage();
    else if (h.startsWith("/film/")) await filmPage(Number(h.slice(6)));
    else if (h === "/ma-liste") await myList();
    else if (h === "/notifications") await notificationsPage();
    else await home();
  } catch (e) { errorView(e); }
  updateBell();
}
addEventListener("hashchange", route);
route();

// Bande-annonce lue directement dans l'appli (fenêtre plein écran). Demande un serveur local : lancer.bat.
// Ouvert depuis un simple fichier, YouTube refuse l'intégration : on ouvre alors YouTube dans un nouvel onglet.
function closeTrailer() { document.getElementById("trailer-modal")?.remove(); }
function openTrailer(key) {
  closeTrailer();
  const m = document.createElement("div");
  m.id = "trailer-modal";
  m.innerHTML = `<button class="tclose" aria-label="Fermer">✕</button>
    <iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&playsinline=1&rel=0" title="Bande-annonce"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
  m.addEventListener("click", (e) => { if (e.target === m || e.target.closest(".tclose")) closeTrailer(); });
  document.body.appendChild(m);
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-trailer]");
  if (!a || location.protocol === "file:") return;
  e.preventDefault(); openTrailer(a.dataset.trailer);
});
addEventListener("keydown", (e) => { if (e.key === "Escape") closeTrailer(); });
addEventListener("hashchange", closeTrailer);
