/**
 * Starts a QVAC provider service: reachable over the DHT by public key, serving loadModel()/completion() to a delegating consumer (see ../config/delegate.config.ts).
 * Usage: npm run provider --workspace=apps/backend -- [seed] [allowedConsumerPublicKey]. `seed` is identity material - prefer the QVAC_HYPERSWARM_SEED env var over this CLI arg (visible in `ps`/shell history).
 */
import { startProvider, stopProvider } from './infra/qvacProviderAdapter.js';

/** Same pattern `@qvac/sdk` validates a Hyperswarm public key/seed against - reject early with a clear error instead of `Buffer.from(x, 'hex')` silently truncating a malformed value. */
const HEX64 = /^[0-9a-fA-F]{64}$/;

async function main(): Promise<void> {
  const seed = process.argv[2];
  if (seed) {
    if (!HEX64.test(seed)) {
      throw new Error('seed must be a 64-character hex string (see usage above)');
    }
    process.env['QVAC_HYPERSWARM_SEED'] = seed;
  }
  // Lowercased: DHT public keys are canonical lowercase hex and the SDK's allow-list check is case-sensitive.
  const allowedConsumerPublicKey = process.argv[3]?.toLowerCase();
  if (allowedConsumerPublicKey && !HEX64.test(allowedConsumerPublicKey)) {
    throw new Error('allowedConsumerPublicKey must be a 64-character hex string (see usage above)');
  }

  console.log('▸ Starting provider service...');
  if (allowedConsumerPublicKey) {
    console.log(`▸ Firewall enabled: only allowing consumer ${allowedConsumerPublicKey}`);
  }

  const { publicKey } = await startProvider(
    allowedConsumerPublicKey ? { allowedConsumerPublicKeys: [allowedConsumerPublicKey] } : undefined,
  );

  console.log('▸ Provider service started successfully!');
  console.log(`▸ Provider Public Key: ${publicKey}`);
  console.log('');
  console.log('▸ Consumer setup:');
  console.log(`   DELEGATE_PROVIDER_PUBLIC_KEY=${publicKey} npm run dev:server`);
  console.log('');
  if (!seed) {
    console.log('▸ No seed given - identity is random this run. Pass a 64-char hex seed as the first argument for a reproducible public key across restarts.');
  }
  console.log('▸ Provider is running... Press Ctrl+C to stop');

  process.stdin.resume();
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });

  console.log('\n▸ Stopping provider service...');
  await stopProvider();
  console.log('▸ Provider service stopped');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n✖ Provider failed:', err);
  process.exit(1);
});
