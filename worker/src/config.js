'use strict';

function required(env, key) {
  if (!env[key]) throw new Error(`Variable d'environnement manquante : ${key}`);
  return env[key];
}

function loadConfig(env = process.env) {
  const driver = env.STORAGE_DRIVER || 's3';
  return {
    logLevel: env.LOG_LEVEL || 'info',
    metricsPort: Number(env.METRICS_PORT || 9100),
    concurrency: Number(env.WORKER_CONCURRENCY || 5),
    exportRetentionDays: Number(env.EXPORT_RETENTION_DAYS || 7),
    backupRetentionDays: Number(env.BACKUP_RETENTION_DAYS || 14),
    importRetentionDays: Number(env.IMPORT_RETENTION_DAYS || 30),
    // Règles des tâches planifiées de la bibliothèque
    library: {
      reminderDaysBefore: Number(env.REMINDER_DAYS_BEFORE || 2), // rappel avant la date de retour
      overdueRepeatDays: Number(env.OVERDUE_REPEAT_DAYS || 7), // relance des retards tous les N jours
      holdDays: Number(env.RESERVATION_HOLD_DAYS || 3), // exemplaire mis de côté N jours
    },
    dailyCron: env.DAILY_JOB_CRON || '0 8 * * *', // tous les jours à 08:00 (heure de Paris)
    appUrl: env.APP_URL || 'http://localhost:8080',
    db: {
      host: env.DB_HOST || 'localhost',
      port: Number(env.DB_PORT || 5432),
      database: env.DB_NAME || 'biblio',
      user: env.DB_USER || 'biblio',
      password: required(env, 'DB_PASSWORD'),
      ssl: env.DB_SSL || 'disable',
      sslCaFile: env.DB_SSL_CA_FILE,
      max: Number(env.DB_POOL_MAX || 5),
    },
    redisUrl: env.REDIS_URL || 'redis://localhost:6379',
    redisPassword: env.REDIS_PASSWORD,
    smtp: {
      host: env.SMTP_HOST || 'localhost',
      port: Number(env.SMTP_PORT || 1025),
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
      from: env.SMTP_FROM || 'Biblio <no-reply@biblio.local>',
    },
    storage: {
      driver,
      attachmentsBucket: env.STORAGE_ATTACHMENTS_BUCKET || 'attachments',
      backupsBucket: env.STORAGE_BACKUPS_BUCKET || 'backups',
      s3: {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION || 'us-east-1',
        accessKeyId: driver === 's3' ? required(env, 'S3_ACCESS_KEY') : undefined,
        secretAccessKey: driver === 's3' ? required(env, 'S3_SECRET_KEY') : undefined,
      },
      azure: { accountUrl: driver === 'azure' ? required(env, 'AZURE_STORAGE_ACCOUNT_URL') : undefined },
    },
  };
}

module.exports = { loadConfig };
