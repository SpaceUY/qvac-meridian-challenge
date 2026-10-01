/**
 * Starts a QVAC provider service: makes this process reachable over the
 * DHT by public key, serving loadModel()/completion() to any consumer that
 * delegates to it (see ../config/delegate.config.ts on the consumer side).
 *
 * Usage: npm run provider --workspace=apps/backend -- [seed] [allowedConsumerPublicKey]
 *  - seed: optional 64-char hex QVAC_HYPERSWARM_SEED for a reproducible
 *    provider identity across restarts. Prefer setting it as an actual env
 *    var (`QVAC_HYPERSWARM_SEED=<seed> npm run provider ...`) instead of
 *    this argument - it's identity material, and a CLI argument is visible
 *    in `ps` output and shell history.
 *  - allowedConsumerPublicKey: optional firewall allow-list entry - when
 *    set, only that consumer's public key may delegate to this provider.
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
  // Lowercased: the DHT's own public keys are canonical lowercase hex, and
  // the SDK's firewall allow-list check is case-sensitive - an
  // uppercase-pasted key would otherwise be silently denied.
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
