// Test de charge pour démontrer l'autoscaling horizontal (HPA) du backend.
// Scénario réaliste : des membres parcourent et recherchent dans le catalogue, ouvrent des fiches,
// consultent leurs emprunts.
// Lancement (Docker, aucune installation) :
//   docker run --rm -i -e BASE_URL=https://dev.biblio.<IP>.nip.io grafana/k6 run - < tests/load/k6-load.js
// Pendant le test : kubectl get hpa -n biblio-dev -w   (les réplicas backend montent)
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://biblio.localtest.me';
const SEARCHES = ['', 'le', 'roman', 'dune', 'hugo', 'science', 'a', 'prince', 'kubernetes', '19'];

export const options = {
  scenarios: {
    montee: {
      executor: 'ramping-vus',
      stages: [
        { duration: '1m', target: 20 },
        { duration: '3m', target: 50 }, // plateau : l'HPA doit ajouter des pods
        { duration: '1m', target: 0 },
      ],
    },
  },
  // Seuils alignés sur le SLO (docs/SLO.md) : le test échoue s'ils ne sont pas tenus
  thresholds: {
    http_req_failed: ['rate<0.005'],
    'http_req_duration{name:search}': ['p(95)<300'],
  },
};

const json = { headers: { 'Content-Type': 'application/json' } };

export function setup() {
  const email = `charge-${Date.now()}@example.com`;
  const password = 'motdepasse-de-charge';
  http.post(`${BASE}/api/auth/register`, JSON.stringify({ email, name: 'Test de charge', password }), json);
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password }), json);
  return { token: res.json('token') };
}

export default function (data) {
  const auth = { headers: { Authorization: `Bearer ${data.token}` } };

  const q = SEARCHES[Math.floor(Math.random() * SEARCHES.length)];
  const search = http.get(`${BASE}/api/books?q=${encodeURIComponent(q)}`, { ...auth, tags: { name: 'search' } });
  check(search, { 'recherche 200': (r) => r.status === 200 });

  const books = search.status === 200 ? search.json() : [];
  if (books.length) {
    const b = books[Math.floor(Math.random() * books.length)];
    check(http.get(`${BASE}/api/books/${b.id}`, { ...auth, tags: { name: 'book' } }), { 'fiche 200': (r) => r.status === 200 });
  }
  if (Math.random() < 0.3) {
    check(http.get(`${BASE}/api/loans`, { ...auth, tags: { name: 'loans' } }), { 'emprunts 200': (r) => r.status === 200 });
  }
  sleep(0.5);
}
