'use strict';
// Même abstraction que l'API (voir backend/src/storage.js), avec upload en flux
// pour les sauvegardes de base (pg_dump peut dépasser la mémoire du pod).

function createS3Storage(cfg) {
  const { S3Client, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
  const { Upload } = require('@aws-sdk/lib-storage');
  const s3 = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return {
    async put(bucket, key, body, contentType) {
      await new Upload({ client: s3, params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType } }).done();
    },
    async getStream(bucket, key) {
      return (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body;
    },
    async remove(bucket, key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
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
      const opts = { blobHTTPHeaders: { blobContentType: contentType } };
      if (Buffer.isBuffer(body)) await blob(bucket, key).uploadData(body, opts);
      else await blob(bucket, key).uploadStream(body, 4 * 1024 * 1024, 4, opts);
    },
    async getStream(bucket, key) {
      return (await blob(bucket, key).download()).readableStreamBody;
    },
    async remove(bucket, key) {
      await blob(bucket, key).deleteIfExists();
    },
  };
}

function createStorage(storageConfig) {
  return storageConfig.driver === 'azure' ? createAzureStorage(storageConfig.azure) : createS3Storage(storageConfig.s3);
}

module.exports = { createStorage };
