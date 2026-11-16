'use strict';
// Toute la configuration vient de l'environnement (12-factor) :
// ConfigMap pour le non sensible, Secret Kubernetes (alimenté par Key Vault) pour le sensible.
// Aucune valeur secrète par défaut : l'application refuse de démarrer si elle manque.

function required(env, key) {
  const v = env[key];
  if (!v) throw new Error(`Variable d'environnement manquante : ${key}`);
  return v;
}

function loadConfig(env = process.env) {
  const storageDriver = env.STORAGE_DRIVER || 's3';
  return {
    env: env.NODE_ENV || 'development',
    port: Number(env.PORT || 3000),
    logLevel: env.LOG_LEVEL || 'info',
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:8080').split(',').map((s) => s.trim()),
    jwtSecret: required(env, 'JWT_SECRET'),
    jwtTtl: env.JWT_TTL || '1h',
    bcryptRounds: Number(env.BCRYPT_ROUNDS || 12),
    db: {
      host: env.DB_HOST || 'localhost',
      port: Number(env.DB_PORT || 5432),
      database: env.DB_NAME || 'biblio',
      user: env.DB_USER || 'biblio',
      password: required(env, 'DB_PASSWORD'),
      ssl: env.DB_SSL || 'disable', // disable | require
      sslCaFile: env.DB_SSL_CA_FILE,
      max: Number(env.DB_POOL_MAX || 10),
    },
    redisUrl: env.REDIS_URL || 'redis://localhost:6379',
    redisPassword: env.REDIS_PASSWORD,
    storage: {
      driver: storageDriver, // s3 (MinIO en local) | azure (Blob Storage + Workload Identity)
      attachmentsBucket: env.STORAGE_ATTACHMENTS_BUCKET || 'attachments',
      backupsBucket: env.STORAGE_BACKUPS_BUCKET || 'backups',
      s3: {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION || 'us-east-1',
        accessKeyId: storageDriver === 's3' ? required(env, 'S3_ACCESS_KEY') : undefined,
        secretAccessKey: storageDriver === 's3' ? required(env, 'S3_SECRET_KEY') : undefined,
      },
      azure: {
        accountUrl: storageDriver === 'azure' ? required(env, 'AZURE_STORAGE_ACCOUNT_URL') : undefined,
      },
    },
    // Règles métier de la bibliothèque (modifiables sans rebuild, via le ConfigMap)
    library: {
      loanDays: Number(env.LOAN_DAYS || 21),
      maxActiveLoans: Number(env.MAX_ACTIVE_LOANS || 5),
      holdDays: Number(env.RESERVATION_HOLD_DAYS || 3),
    },
    upload: {
      coverMaxBytes: Number(env.COVER_MAX_BYTES || 2 * 1024 * 1024),
      coverTypes: (env.COVER_ALLOWED_TYPES || 'image/png,image/jpeg,image/webp').split(','),
      csvMaxBytes: Number(env.CSV_MAX_BYTES || 1024 * 1024),
    },
  };
}

module.exports = { loadConfig };
