import { useCallback, useEffect, useState } from 'react';
import { api, download, humanError, fmtDate, isLate, LOAN_STATUS, RESA_STATUS } from '../api.js';

export default function MyLoans() {
  const [loans, setLoans] = useState(null);
  const [resas, setResas] = useState([]);
  const [error, setError] = useState('');
  const [exportState, setExportState] = useState(null);

  const load = useCallback(() => {
    Promise.all([api('/loans'), api('/reservations')])
      .then(([l, r]) => {
        setLoans(l);
        setResas(r);
      })
      .catch((e) => setError(humanError(e)));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // L'export PDF est fait par le worker : on interroge son statut jusqu'à la fin
  useEffect(() => {
    if (exportState?.status !== 'pending') return undefined;
    const t = setInterval(async () => {
      const s = await api(`/exports/${exportState.id}`);
      if (s.status !== 'pending') setExportState(s);
    }, 1500);
    return () => clearInterval(t);
  }, [exportState]);

  const startExport = async () => {
    try {
      setExportState(await api('/exports', { method: 'POST' }));
    } catch (e) {
      setError(humanError(e));
    }
  };
  const cancel = async (id) => {
    try {
      await api(`/reservations/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(humanError(e));
    }
  };

  if (!loans) return <p className="muted">{error || 'Chargement…'}</p>;
  const current = loans.filter((l) => !l.returned_at);
  const history = loans.filter((l) => l.returned_at);
  const openResas = resas.filter((r) => ['waiting', 'available'].includes(r.status));

  return (
    <section>
      <div className="row between">
        <h1>Mes emprunts</h1>
        <div className="row">
          <button className="btn" onClick={startExport} disabled={exportState?.status === 'pending'}>
            {exportState?.status === 'pending' ? 'Génération du PDF…' : 'Exporter mon historique (PDF)'}
          </button>
          {exportState?.status === 'done' && (
            <button className="btn btn-primary" onClick={() => download(`/exports/${exportState.id}/download`, 'historique-emprunts.pdf')}>
              Télécharger le PDF
            </button>
          )}
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      {exportState?.status === 'failed' && <div className="alert">L’export a échoué, réessayez.</div>}

      <h2>En cours ({current.length})</h2>
      {current.length === 0 && <p className="muted">Aucun emprunt en cours. Allez faire un tour dans le catalogue !</p>}
      <div className="card table">
        {current.map((l) => (
          <a key={l.id} href={`#/books/${l.book_id}`} className={`loan-row ${isLate(l) ? 'late' : ''}`}>
            <span className="title">{l.title}</span>
            <span className="muted small">{l.author}</span>
            <span className="small">emprunté le {fmtDate(l.borrowed_at)}</span>
            <span className={`badge ${isLate(l) ? 'ko' : 'neutral'}`}>
              {isLate(l) ? `En retard depuis le ${fmtDate(l.due_at)}` : `À rendre le ${fmtDate(l.due_at)}`}
            </span>
          </a>
        ))}
      </div>

      <h2>Mes réservations ({openResas.length})</h2>
      {openResas.length === 0 && <p className="muted">Aucune réservation en cours.</p>}
      <div className="card table">
        {openResas.map((r) => (
          <div key={r.id} className="loan-row">
            <a href={`#/books/${r.book_id}`} className="title">
              {r.title}
            </a>
            <span className="muted small">{r.author}</span>
            <span className={`badge ${r.status === 'available' ? 'ok' : 'neutral'}`}>
              {r.status === 'available' ? `À retirer avant le ${fmtDate(r.expires_at)}` : `${RESA_STATUS.waiting} · position ${r.position}`}
            </span>
            <button className="btn btn-ghost" onClick={() => cancel(r.id)}>
              Annuler
            </button>
          </div>
        ))}
      </div>

      <h2>Historique ({history.length})</h2>
      <div className="card table">
        {history.map((l) => (
          <div key={l.id} className="loan-row muted">
            <span className="title">{l.title}</span>
            <span className="small">{l.author}</span>
            <span className="small">
              {fmtDate(l.borrowed_at)} → {fmtDate(l.returned_at)}
            </span>
            <span className="badge neutral">{LOAN_STATUS.returned}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
