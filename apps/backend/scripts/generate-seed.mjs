/**
 * Generates a QVAC_HYPERSWARM_SEED and prints the public key it produces.
 *
 * Hyperswarm derives its identity keypair from the seed as an Ed25519 key, so
 * the public key is computable up front - use it as the provider's
 * allowedConsumerPublicKey (see src/models/provider.ts).
 *
 * Usage: npm run seed:generate --workspace=apps/backend
 */
import { createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';

/** PKCS#8 DER prefix wrapping a raw 32-byte Ed25519 seed. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const seed = randomBytes(32);
const privateKey = createPrivateKey({
  key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
  format: 'der',
  type: 'pkcs8',
});
const publicKey = createPublicKey(privateKey).export({ format: 'jwk' }).x;
const publicKeyHex = Buffer.from(publicKey, 'base64url').toString('hex');

console.log(`QVAC_HYPERSWARM_SEED=${seed.toString('hex')}`);
console.log(`Public key: ${publicKeyHex}`);
