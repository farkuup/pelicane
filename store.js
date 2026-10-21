// Stockage personnel local : { watchlist, lb } (ids de films ; lb = liens boxd.it importés depuis Letterboxd).
// Volontairement aucun champ note / étoiles / critique.
window.Store = (() => {
  const KEY = "appli-cine-v1";
  const load = () => {
    try { return Object.assign({ watchlist: [], lb: {} }, JSON.parse(localStorage.getItem(KEY))); }
    catch { return { watchlist: [], lb: {} }; }
  };
  const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
  const toggle = (list, id) => {
    const s = load();
    s[list] = s[list].includes(id) ? s[list].filter((x) => x !== id) : [...s[list], id];
    save(s);
  };
  return {
    isInList: (id) => load().watchlist.includes(id),
    toggleList: (id) => toggle("watchlist", id),
    addMany: (list, ids) => { const s = load(); s[list] = [...new Set([...s[list], ...ids])]; save(s); },
    setLbUri: (id, uri) => { const s = load(); s.lb[id] = uri; save(s); },
    lbUri: (id) => load().lb[id] || "",
    all: load
  };
})();
