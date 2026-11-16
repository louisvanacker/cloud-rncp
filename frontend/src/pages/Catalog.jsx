import { useEffect, useState } from 'react';
import { api, humanError } from '../api.js';
import { Cover, Availability } from '../components.jsx';

export default function Catalog() {
  const [books, setBooks] = useState(null);
  const [categories, setCategories] = useState([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/books/categories').then(setCategories).catch(() => {});
  }, []);

  // Recherche avec un léger délai pour ne pas interroger l'API à chaque frappe
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (q.trim()) p.set('q', q.trim());
      if (category) p.set('category', category);
      if (onlyAvailable) p.set('available', 'true');
      api(`/books?${p}`)
        .then((b) => {
          setBooks(b);
          setError('');
        })
        .catch((e) => setError(humanError(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, category, onlyAvailable]);

  return (
    <section>
      <div className="row between">
        <h1>Catalogue</h1>
      </div>
      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Titre, auteur ou ISBN…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Toutes les catégories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} />
          Disponibles uniquement
        </label>
      </div>
      {error && <div className="alert">{error}</div>}
      {!books && !error && <p className="muted">Chargement…</p>}
      {books && books.length === 0 && <div className="card empty">Aucun ouvrage ne correspond à la recherche.</div>}
      {books && books.length > 0 && (
        <div className="book-grid">
          {books.map((b) => (
            <a key={b.id} href={`#/books/${b.id}`} className="book-card">
              <Cover book={b} />
              <div className="book-meta">
                <strong className="clamp">{b.title}</strong>
                <span className="muted small">{b.author}</span>
                <Availability book={b} />
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
