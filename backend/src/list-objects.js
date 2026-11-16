'use strict';
// Liste le contenu du stockage objet (preuve pour le rapport, sans console web) :
//   docker compose exec backend node src/list-objects.js
//   kubectl exec -n <ns> deploy/backend -- node src/list-objects.js
// Fonctionne avec le pilote S3 (MinIO). Sur Azure : az storage blob list (voir GUIDE).
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { loadConfig } = require('./config');

async function main() {
  const config = loadConfig();
  if (config.storage.driver !== 's3') {
    console.log('Pilote Azure : utilisez "az storage blob list" (voir le guide).');
    return;
  }
  const c = config.storage.s3;
  const s3 = new S3Client({
    endpoint: c.endpoint,
    region: c.region,
    forcePathStyle: true,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
  });
  for (const Bucket of [config.storage.attachmentsBucket, config.storage.backupsBucket]) {
    const out = await s3.send(new ListObjectsV2Command({ Bucket }));
    console.log(`\n=== bucket ${Bucket} : ${out.KeyCount || 0} objet(s)`);
    for (const o of out.Contents || []) {
      console.log(`${o.LastModified.toISOString().slice(0, 19)}  ${String(o.Size).padStart(9)} o  ${o.Key}`);
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
