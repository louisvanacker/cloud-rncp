'use strict';
// Abstraction du stockage objet, 2 pilotes :
//  - s3    : MinIO (docker compose / kind) ou tout stockage compatible S3
//  - azure : Azure Blob Storage, authentification SANS clé via Workload Identity
//            (DefaultAzureCredential lit le jeton fédéré injecté dans le pod).
// Même code utilisé par l'API (couvertures, CSV d'import) et le worker (exports PDF, sauvegardes).

function createS3Storage(cfg) {
  const {
    S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, CreateBucketCommand,
  } = require('@aws-sdk/client-s3');
  const s3 = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return {
    async put(bucket, key, body, contentType) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async getStream(bucket, key) {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return out.Body;
    },
    async remove(bucket, key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    // Crée les buckets manquants (stockage S3 local : MinIO). Idempotent.
    async ensureBuckets(buckets) {
      for (const Bucket of buckets) {
        try {
          await s3.send(new HeadBucketCommand({ Bucket }));
        } catch {
          await s3.send(new CreateBucketCommand({ Bucket }));
        }
      }
    },
  };
}

function createAzureStorage(cfg) {
  const { BlobServiceClient } = require('@azure/storage-blob');
  const { DefaultAzureCredential } = require('@azure/identity');
  const service = new BlobServiceClient(cfg.accountUrl, new DefaultAzureCredential());
  const blob = (bucket, key) => service.getContainerClient(bucket).getBlockBlobClient(key);
  return {
    async put(bucket, key, body, contentType) {
      const client = blob(bucket, key);
      const opts = { blobHTTPHeaders: { blobContentType: contentType } };
      if (Buffer.isBuffer(body)) await client.uploadData(body, opts);
      else await client.uploadStream(body, 4 * 1024 * 1024, 4, opts);
    },
    async getStream(bucket, key) {
      const res = await blob(bucket, key).download();
      return res.readableStreamBody;
    },
    async remove(bucket, key) {
      await blob(bucket, key).deleteIfExists();
    },
    // Sur Azure, les conteneurs sont créés par Terraform (et l'identité n'a pas le droit d'en créer)
    async ensureBuckets() {},
  };
}

function createStorage(storageConfig) {
  if (storageConfig.driver === 'azure') return createAzureStorage(storageConfig.azure);
  return createS3Storage(storageConfig.s3);
}

module.exports = { createStorage };
