import { useCallback, useEffect, useState } from 'react';
import { api, humanError, fmtDate, isLate, ROLE } from '../api.js';
import BookForm from './BookForm.jsx';

const TABS = [
  ['loans', 'Prêts en cours'],
  ['add', 'Ajouter un ouvrage'],
  ['import', 'Import CSV'],
  ['users', 'Utilisateurs'],
];

export default function Staff({ user }) {
  const [tab, setTab] = useState('loans');
  const tabs = TABS.filter(([k]) => k !== 'users' || user.role === 'admin');
  return (
    <section>
      <h1>Espace bibliothécaire</h1>
      <div className="tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={`chip ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'loans' && <CurrentLoans />}
      {tab === 'add' && <AddBook />}
      {tab === 'import' && <CsvImport />}
      {tab === 'users' && <Users me={user} />}
    </section>
  );
}

function CurrentLoans() {
  const [loans, setLoans] = useState(null);
  const [onlyLate, setOnlyLate] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(
    () =>
      api('/loans?status=current&limit=200')
        .then(setLoans)
        .catch((e) => setError(humanError(e))),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const giveBack = async (id) => {
    try {
      await api(`/loans/${id}/return`, { method: 'POST' });
      load();
    } catch (e) {
      setError(humanError(e));
    }
  };

  if (!loans) return <p className="muted">{error || 'Chargement…'}</p>;
  const late = loans.filter(isLate);
  const shown = onlyLate ? late : loans;
  return (
    <>
      <div className="row between">
        <p className="muted">
          {loans.length} prêt(s) en cours, dont <b className="late-text">{late.length} en retard</b>
        </p>
        <label className="check">
          <input type="checkbox" checked={onlyLate} onChange={(e) => setOnlyLate(e.target.checked)} /> Retards uniquement
        </label>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="card table">
        {shown.map((l) => (
          <div key={l.id} className={`loan-row ${isLate(l) ? 'late' : ''}`}>
            <a href={`#/books/${l.book_id}`} className="title">
              {l.title}
            </a>
            <span className="small">{l.user_name}</span>
            <span className={`small ${isLate(l) ? 'late-text' : ''}`}>retour prévu {fmtDate(l.due_at)}</span>
            <button className="btn" onClick={() => giveBack(l.id)}>
              Enregistrer le retour
            </button>
          </div>
        ))}
        {shown.length === 0 && <p className="muted pad">Rien à afficher.</p>}
      </div>
    </>
  );
}

function AddBook() {
  const [created, setCreated] = useState(null);
  return (
    <div className="card narrow">
      {created && (
        <div className="info">
          « {created.title} » ajouté. <a href={`#/books/${created.id}`}>Ouvrir la fiche pour ajouter une couverture →</a>
        </div>
      )}
      <BookForm onSaved={setCreated} />
    </div>
  );
}

function CsvImport() {
  const [imports, setImports] = useState([]);
  const [error, setError] = useState('');
  const load = useCallback(() => api('/imports').then(setImports).catch((e) => setError(humanError(e))), []);
  useEffect(() => {
    load();
  }, [load]);
  // Rafraîchit tant qu'un import est en cours de traitement par le worker
  useEffect(() => {
    if (!imports.some((i) => i.status === 'pending')) return undefined;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [imports, load]);

  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      await api('/imports', { method: 'POST', form });
      e.target.value = '';
      load();
    } catch (err) {
      setError(humanError(err));
    }
  };

  return (
    <>
      <div className="card">
        <p>
          Ajoutez des ouvrages en masse avec un fichier CSV (1 Mo max). Le fichier est stocké puis traité en arrière-plan ;
          vous recevez un e-mail à la fin.
        </p>
        <pre className="sample">isbn,titre,auteur,categorie,annee,exemplaires{'\n'}9782070612758,Le Petit Prince,Antoine de Saint-Exupéry,Roman,1943,3</pre>
        <label className="btn btn-primary upload-inline">
          Choisir un fichier CSV
          <input type="file" accept=".csv,text/csv" onChange={upload} hidden />
        </label>
        {error && <div className="alert">{error}</div>}
      </div>
      <h2>Imports récents</h2>
      <div className="card table">
        {imports.map((i) => (
          <div key={i.id} className="loan-row">
            <span className="title">{i.filename}</span>
            <span className="small">{fmtDate(i.created_at)} · {i.uploaded_by_name}</span>
            <span className={`badge ${i.status === 'done' ? 'ok' : i.status === 'failed' ? 'ko' : 'neutral'}`}>
              {i.status === 'pending' ? 'En cours…' : i.status === 'failed' ? 'Échec' : `${i.created_count} ajouté(s), ${i.skipped_count} ignoré(s)`}
            </span>
            {i.errors && <span className="small late-text" title={i.errors}>{i.errors.split('\n').length} ligne(s) en erreur</span>}
          </div>
        ))}
        {imports.length === 0 && <p className="muted pad">Aucun import.</p>}
      </div>
    </>
  );
}

function Users({ me }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const load = useCallback(() => api('/users').then(setUsers).catch((e) => setError(humanError(e))), []);
  useEffect(() => {
    load();
  }, [load]);
  const setRole = async (id, role) => {
    try {
      await api(`/users/${id}/role`, { method: 'PATCH', body: { role } });
      load();
    } catch (e) {
      setError(humanError(e));
    }
  };
  return (
    <>
      {error && <div className="alert">{error}</div>}
      <div className="card table">
        {users.map((u) => (
          <div key={u.id} className="loan-row">
            <span className="title">{u.name}</span>
            <span className="small">{u.email}</span>
            <span className="small">inscrit le {fmtDate(u.created_at)}</span>
            <select value={u.role} disabled={u.id === me.id} onChange={(e) => setRole(u.id, e.target.value)}>
              {Object.entries(ROLE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </>
  );
}
