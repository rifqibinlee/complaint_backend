/**
 * s3.js — AWS S3 upload helper.
 *
 * Required .env vars:
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   AWS_REGION         e.g. ap-southeast-1
 *   S3_BUCKET          e.g. aduan-awam-uploads
 *
 * Falls back to local disk storage if S3_BUCKET is not set.
 */

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');

let _client = null;

function getClient() {
  if (_client) return _client;
  if (!process.env.S3_BUCKET) return null;
  _client = new S3Client({
    region:      process.env.AWS_REGION ?? 'ap-southeast-1',
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

/**
 * Upload a file buffer to S3.
 * @param {Buffer} buffer
 * @param {string} originalName
 * @param {string} mimeType
 * @returns {Promise<string>} Public URL or local path
 */
async function uploadFile(buffer, originalName, mimeType) {
  const client = getClient();
  if (!client) return null; // caller handles local fallback

  const ext = path.extname(originalName).toLowerCase();
  const key = `complaints/${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;

  await client.send(new PutObjectCommand({
    Bucket:      process.env.S3_BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: mimeType,
  }));

  return `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION ?? 'ap-southeast-1'}.amazonaws.com/${key}`;
}

/**
 * Delete an S3 object by its full URL.
 * Safe to call on local paths (no-op).
 */
async function deleteFile(url) {
  const client = getClient();
  if (!client || !url || !url.includes('.amazonaws.com/')) return;
  const key = url.split('.amazonaws.com/')[1];
  await client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key })).catch(() => {});
}

module.exports = { uploadFile, deleteFile, isS3Enabled: () => !!process.env.S3_BUCKET };
