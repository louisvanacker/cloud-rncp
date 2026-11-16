import { useCallback, useEffect, useState } from 'react';
import { api, humanError, fmtDate, LOAN_STATUS } from '../api.js';
import { Cover, Availability } from '../components.jsx';
import BookForm from './BookForm.jsx';

export default function BookDetail({ id, user }) {
  const [book, setBook] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [editing, setEditing] = useState(false);
  const staff = user.role !== 'member';

  const load = useCallback(
    () =>
      api(`/books/${id}`)
        .then(setBook)
        .catch((e) => setError(humanError(e))),
    [id],
  );
  useEffect(() => {
    load();
  }, [load]);

  const run = (fn, success) => async (...args) => {
    setError('');
    setInfo('');
    try {
      await fn(...args);
      if (success) setInfo(success);
      await load();
    } catch (e) {
      setError(humanError(e));
    }
  };

  const borrow = run(() => api('/loans', { method: 'POST', body: { book_id: id } }), 'Emprunt enregistré : un e-mail de confirmation vous a été envoyé.');
  const reserve = run(() => api('/reservations', { method: 'POST', body: { book_id: id } }), 'Réservation enregistrée : vous serez prévenu par e-mail.');
  const cancel = run(() => api(`/reservations/${book.my_reservation.id}`, { method: 'DELETE' }), 'Réservation annulée.');
  const giveBack = (loanId) => run(() => api(`/loans/${loanId}/return`, { method: 'POST' }), 'Retour enregistré.')();
  const uploadCover = run(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    await api(`/books/${id}/cover`, { method: 'POST', form });
    e.target.value = '';
  }, 'Couverture mise à jour.');

  if (!book) return <p className="muted">{error || 'Chargement…'}</p>;

  // Que peut faire le membre ?
  let action;
  if (book.my_loan) {
    action = (
      <div className={`status-box ${book.my_loan.status === 'overdue' ? 'late' : ''}`}>
        Vous avez cet ouvrage — à rendre le <b>{fmtDate(book.my_loan.due_at)}</b>
      </div>
    );
  } else if (book.my_reservation?.status === 'available') {
    action = (
      <>
        <div className="status-box ok">
          Un exemplaire vous attend jusqu'au <b>{fmtDate(book.my_reservation.expires_at)}</b>
        </div>
        <button className="btn btn-primary" onClick={borrow}>
          Emprunter mon exemplaire réservé
        </button>
      </>
    );
  } else if (book.my_reservation) {
    action = (
      <>
        <div className="status-box">Vous êtes dans la file d'attente pour cet ouvrage.</div>
        <button className="btn" onClick={cancel}>
          Annuler ma réservation
        </button>
      </>
    );
  } else if (book.available_copies > 0) {
    action = (
      <button className="btn btn-primary" onClick={borrow}>
        Emprunter
      </button>
    );
  } else {
    action = (
      <button className="btn btn-primary" onClick={reserve}>
        Réserver {book.waiting_count > 0 && `(${book.waiting_count} en attente)`}
      </button>
    );
  }

  return (
    <section className="detail">
      <a href="#/" className="back">
        ← Catalogue
      </a>
      <div className="book-detail">
        <div>
          <Cover book={book} size="lg" />
          {staff && (
            <label className="btn wide upload">
              Changer la couverture
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadCover} hidden />
            </label>
          )}
        </div>
        <div>
          <span className="muted small">{book.category}</span>
          <h1>{book.title}</h1>
          <p className="lead">
            {book.author}
            {book.published_year ? ` · ${book.published_year}` : ''}
            {book.isbn ? ` · ISBN ${book.isbn}` : ''}
          </p>
          <Availability book={book} />
          {book.description && <p className="pre desc">{book.description}</p>}
          {error && <div className="alert">{error}</div>}
          {info && <div className="info">{info}</div>}
          <div className="actions">{action}</div>

          {staff && (
            <div className="card staff-box">
              <div className="row between">
                <h3>Gestion (bibliothécaire)</h3>
                <button className="btn btn-ghost" onClick={() => setEditing(!editing)}>
                  {editing ? 'Fermer' : 'Modifier la notice'}
                </button>
              </div>
              {editing && (
                <BookForm
                  initial={book}
                  onSaved={() => {
                    setEditing(false);
                    load();
                  }}
                />
              )}
              <h4>Exemplaires empruntés ({book.active_loans?.length || 0})</h4>
              {book.active_loans?.length ? (
                <table className="table-plain">
                  <tbody>
                    {book.active_loans.map((l) => (
                      <tr key={l.id}>
                        <td>{l.user_name}</td>
                        <td className={l.status === 'overdue' ? 'late-text' : ''}>
                          retour {fmtDate(l.due_at)} · {LOAN_STATUS[l.status]}
                        </td>
                        <td className="right">
                          <button className="btn" onClick={() => giveBack(l.id)}>
                            Enregistrer le retour
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted small">Aucun.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
