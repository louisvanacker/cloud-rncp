'use strict';
const pino = require('pino');

// Logs JSON sur stdout -> collectés par Alloy -> Loki (12-factor).
// Les champs sensibles sont masqués (ISO 27001 A.8.12 : prévention de la fuite de données).
function createLogger(level = 'info', service = 'biblio-backend') {
  return pino({
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        '*.password',
        'password_hash',
        '*.password_hash',
        'token',
      ],
      censor: '[REDACTED]',
    },
  });
}

// Journal de sécurité (ISO 27001 A.8.15) : événements tagués security=true,
// filtrables dans Loki avec {service="biblio-backend"} | json | security="true"
function securityLog(logger, event, fields = {}) {
  logger.info({ security: true, event, ...fields }, `security:${event}`);
}

module.exports = { createLogger, securityLog };
