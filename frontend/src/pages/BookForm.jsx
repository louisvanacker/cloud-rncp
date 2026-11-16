import { useState } from 'react';
import { api, humanError } from '../api.js';

const EMPTY = { title: '', author: '', isbn: '', category: 'Général', published_year: '', total_copies: 1, description: '' };

// Formulaire de création / modification d'une notice (bibliothécaire)
export default function BookForm({ initial, onSaved }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...Object.fromEntries(Object.entries(initial || {}).map(([k, v]) => [k, v ?? ''])) }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = {
      title: form.title,
      author: form.author,
      category: form.category || 'Général',
      isbn: form.isbn || null,
      published_year: form.published_year ? Number(form.published_year) : null,
      total_copies: Number(form.total_copies),
      description: form.description || null,
    };
    try {
      const book = initial
        ? await api(`/books/${initial.id}`, { method: 'PATCH', body })
        : await api('/books', { method: 'POST', body });
      onSaved(book);
      if (!initial) setForm(EMPTY);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form grid-form" onSubmit={submit}>
      <label className="span2">
        Titre
        <input required value={form.title} onChange={set('title')} />
      </label>
      <label>
        Auteur
        <input required value={form.author} onChange={set('author')} />
      </label>
      <label>
        Catégorie
        <input value={form.category} onChange={set('category')} />
      </label>
      <label>
        ISBN
        <input value={form.isbn} onChange={set('isbn')} placeholder="facultatif" />
      </label>
      <label>
        Année
        <input type="number" value={form.published_year} onChange={set('published_year')} />
      </label>
      <label>
        Exemplaires
        <input type="number" min="0" required value={form.total_copies} onChange={set('total_copies')} />
      </label>
      <label className="span2">
        Résumé
        <textarea rows={3} value={form.description} onChange={set('description')} />
      </label>
      {error && <div className="alert span2">{error}</div>}
      <button className="btn btn-primary" disabled={busy}>
        {initial ? 'Enregistrer' : "Ajouter l'ouvrage"}
      </button>
    </form>
  );
}
