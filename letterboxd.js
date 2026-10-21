// Redirection vers Letterboxd. Aucune URL n'est inventée :
// 0. lien boxd.it importé depuis ton export Letterboxd (lien officiel de la fiche) ;
// 1. slug vérifié  -> https://letterboxd.com/film/<slug>/
// 2. id TMDB       -> https://letterboxd.com/tmdb/<id>  (route de redirection de Letterboxd)
// 3. sinon         -> recherche Letterboxd (titre + année), jamais une page devinée.
// Pas d'API Letterboxd : l'accès est sur demande et exclu pour les projets personnels,
// donc aucune publication directe de critique. Liens web uniquement : l'app Letterboxd
// les ouvre elle-même (liens universels) si elle est installée.
window.Letterboxd = {
  isUri: (u) => /^https:\/\/boxd\.it\/[A-Za-z0-9]+$/.test(u || ""),
  urlFor(film) {
    const own = window.Store && Store.lbUri(film.tmdbId);
    if (this.isUri(own)) return { exact: true, url: own };
    if (film.letterboxdSlug) {
      return { exact: true, url: "https://letterboxd.com/film/" + encodeURIComponent(film.letterboxdSlug) + "/" };
    }
    if (Number.isInteger(film.tmdbId)) {
      return { exact: true, url: "https://letterboxd.com/tmdb/" + film.tmdbId };
    }
    const q = encodeURIComponent(film.title + " " + film.year);
    return { exact: false, url: "https://letterboxd.com/search/films/" + q + "/" };
  }
};
