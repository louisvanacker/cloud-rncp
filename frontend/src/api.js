// Client API minimal. Le JWT est gardé en sessionStorage (effacé à la fermeture de l'onglet).
const TOKEN_KEY = 'biblio_token';

export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  if (res.status === 401 && token) {
    setToken(null);
    window.location.hash = '#/login';
  }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || res.statusText);
  return data;
}

// Téléchargement authentifié (le header Authorization empêche un simple <a href>)
export async function download(path, filename) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError(res.status, 'download_failed');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export const LOAN_STATUS = { active: 'En cours', overdue: 'En retard', returned: 'Rendu' };
export const RESA_STATUS = {
  waiting: 'En attente',
  available: 'Disponible pour vous',
  fulfilled: 'Empruntée',
  cancelled: 'Annulée',
  expired: 'Expirée',
};
export const ROLE = { member: 'membre', librarian: 'bibliothécaire', admin: 'admin' };

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
export const isLate = (loan) => !loan.returned_at && new Date(loan.due_at) < new Date();

export const humanError = (err) =>
  ({
    invalid_credentials: 'Email ou mot de passe incorrect.',
    email_taken: 'Cet email est déjà utilisé.',
    validation_error: 'Champs invalides (mot de passe : 10 caractères minimum).',
    too_many_requests: 'Trop de tentatives, réessayez dans quelques minutes.',
    unsupported_file_type: 'Type de fichier non autorisé.',
    limit_file_size: 'Fichier trop volumineux.',
    forbidden: "Vous n'avez pas les droits pour cette action.",
    not_available: "Plus aucun exemplaire disponible : vous pouvez le réserver.",
    already_borrowed: 'Vous avez déjà cet ouvrage.',
    has_overdue: 'Vous avez un emprunt en retard : rendez-le avant de pouvoir emprunter à nouveau.',
    loan_limit: "Vous avez atteint le nombre maximal d'emprunts simultanés.",
    book_available: 'Cet ouvrage est disponible : empruntez-le directement.',
    already_reserved_or_borrowed: 'Vous avez déjà réservé ou emprunté cet ouvrage.',
    isbn_taken: 'Un ouvrage avec cet ISBN existe déjà.',
    copies_in_use: "Impossible : des exemplaires sont actuellement empruntés.",
    book_has_loans: "Impossible de supprimer un ouvrage qui a déjà été emprunté (historique conservé).",
  })[err.message] || `Erreur : ${err.message}`;
