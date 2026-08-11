import { AwsClient } from 'aws4fetch';

// The R2 credentials and request signing the scripts in this directory share. It duplicates
// what app/_lib/objectStorageClient.js does, for the reason clear-abandoned-library.mjs gives
// — that module uses ESM syntax only Next's bundler can load, and these are plain Node scripts
// — but there is no such barrier between two `.mjs` siblings, so it is not duplicated twice.
//
// Deliberately not a storage client: each script's own get/put/del/list stay with the script,
// because they are what those scripts are, and one of them signs a request against the bucket
// rather than against a key.

const R2_REGION = 'auto';
const r2Endpoint = (accountId) => `https://${accountId}.r2.cloudflarestorage.com`;

// Same cap objectStorageClient.js sets, for the same reason: aws4fetch otherwise retries a
// 5xx ten times, backing off to about half a minute held open per call.
const RETRIES = 2;

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Set it in the environment this runs with.`);
  return value;
}

// `base` addresses the bucket itself, which is what a listing is sent to; a key is appended to
// it. Every variable is read before either is built, so a missing one fails on the name rather
// than as a 403 from a signature over the wrong host.
export function createR2Signer() {
  const base = `${r2Endpoint(requireEnv('R2_ACCOUNT_ID'))}/${requireEnv('R2_BUCKET')}`;
  const aws = new AwsClient({
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    service: 's3',
    region: R2_REGION,
    retries: RETRIES,
  });

  return { aws, base };
}
