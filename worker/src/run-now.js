'use strict';
// Déclenche immédiatement une tâche planifiée, pour la démonstration (inutile d'attendre 08:00) :
//   kubectl exec -n biblio-dev deploy/worker -- node src/run-now.js daily-loans
//   docker compose exec worker node src/run-now.js daily-loans
// Tâches possibles : daily-loans (rappels, retards, réservations) | cleanup
const { Queue } = require('bullmq');
const { loadConfig } = require('./config');

const ALLOWED = ['daily-loans', 'cleanup'];

async function main() {
  const name = process.argv[2] || 'daily-loans';
  if (!ALLOWED.includes(name)) {
    console.error(`Tâche inconnue. Possibles : ${ALLOWED.join(', ')}`);
    process.exit(1);
  }
  const config = loadConfig();
  const u = new URL(config.redisUrl);
  const queue = new Queue('biblio', {
    connection: { host: u.hostname, port: Number(u.port || 6379), password: config.redisPassword || undefined },
  });
  const job = await queue.add(name, {});
  console.log(`Tâche "${name}" envoyée dans la file (id ${job.id}). Suivez : logs du worker + Mailpit.`);
  await queue.close();
}

main();
