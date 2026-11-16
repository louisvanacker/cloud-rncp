import { useEffect, useState } from 'react';
import { api, getToken, setToken, ROLE } from './api.js';
import Login from './pages/Login.jsx';
import Catalog from './pages/Catalog.jsx';
import BookDetail from './pages/BookDetail.jsx';
import MyLoans from './pages/MyLoans.jsx';
import Staff from './pages/Staff.jsx';

// Routage par hash : aucune réécriture d'URL à gérer côté Nginx / Ingress.
function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash.slice(1);
}

export default function App() {
  const route = useHashRoute();
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api('/users/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return <div className="center muted">Chargement…</div>;

  if (!user) {
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          window.location.hash = '#/';
        }}
      />
    );
  }

  const logout = () => {
    setToken(null);
    setUser(null);
  };
  const staff = user.role !== 'member';

  let page;
  const book = route.match(/^\/books\/(\d+)$/);
  if (book) page = <BookDetail id={Number(book[1])} user={user} />;
  else if (route === '/me') page = <MyLoans />;
  else if (route.startsWith('/admin') && staff) page = <Staff user={user} />;
  else page = <Catalog />;

  const tab = (href, label, active) => (
    <a href={href} className={`nav-link ${active ? 'active' : ''}`}>
      {label}
    </a>
  );

  return (
    <div className="layout">
      <header className="topbar">
        <a href="#/" className="brand">
          <span className="logo">B</span> Biblio
        </a>
        <nav>
          {tab('#/', 'Catalogue', route === '/' || !!book)}
          {tab('#/me', 'Mes emprunts', route === '/me')}
          {staff && tab('#/admin', 'Espace bibliothécaire', route.startsWith('/admin'))}
        </nav>
        <div className="who">
          {user.name} <span className={`role role-${user.role}`}>{ROLE[user.role]}</span>
          <button className="btn btn-ghost" onClick={logout}>
            Déconnexion
          </button>
        </div>
      </header>
      <main className="container">{page}</main>
    </div>
  );
}
