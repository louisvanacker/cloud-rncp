'use strict';
const { Queue } = require('bullmq');

const QUEUE_NAME = 'biblio';

function redisConnection(redisUrl, password) {
  const u = new URL(redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: password || undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

// File de messages Redis/BullMQ : l'API ne fait que publier, le worker consomme.
function createQueue(redisUrl, password) {
  const queue = new Queue(QUEUE_NAME, {
    connection: redisConnection(redisUrl, password),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
  return {
    add: (name, data) => queue.add(name, data),
    ping: async () => (await queue.client).ping(),
    close: () => queue.close(),
  };
}

module.exports = { createQueue, QUEUE_NAME };
