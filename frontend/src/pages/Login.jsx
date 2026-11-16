import { useState } from 'react';
import { api, setToken, humanError } from '../api.js';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', name: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = mode === 'login' ? { email: form.email, password: form.password } : form;
      const res = await api(`/auth/${mode}`, { method: 'POST', body });
      setToken(res.token);
      onLogin(res.user);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card auth" onSubmit={submit}>
        <div className="brand big">
          <span className="logo">B</span> Biblio
        </div>
        <p className="muted">{mode === 'login' ? 'Connectez-vous pour emprunter et réserver des livres.' : 'Créez votre compte.'}</p>
        <label>
          Email
          <input type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
        </label>
        {mode === 'register' && (
          <label>
            Nom
            <input required value={form.name} onChange={set('name')} />
          </label>
        )}
        <label>
          Mot de passe
          <input
            type="password"
            required
            minLength={mode === 'register' ? 10 : 1}
            value={form.password}
            onChange={set('password')}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <div className="alert">{error}</div>}
        <button className="btn btn-primary wide" disabled={busy}>
          {mode === 'login' ? 'Se connecter' : 'Créer le compte'}
        </button>
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Pas de compte ? Inscription' : 'Déjà un compte ? Connexion'}
        </button>
      </form>
    </div>
  );
}
