import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { activateLicense } from '../core/license.js';

// A test-only issuer exercises the same signature validation as a delivered offline key.
const testIssuer = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const testLicensePublicKey = testIssuer.publicKey.export({ type: 'spki', format: 'pem' });

export function signedTestLicense(overrides = {}) {
  const payload = Buffer.from(JSON.stringify({
    productType: 'shroom-sdk', boundSensorTypes: 'all',
    sdkFeatures: ['serial', 'serial.raw', 'stream', 'recording'],
    expireDate: Date.now() + 86400000, version: 3, ...overrides,
  })).toString('base64');
  const signature = sign('RSA-SHA256', Buffer.from(payload), testIssuer.privateKey).toString('base64');
  return Buffer.from(JSON.stringify({ payload, signature })).toString('base64');
}

export async function activateTestLicense(overrides = {}, api = { activateLicense }) {
  return api.activateLicense(signedTestLicense(overrides), { mode: 'offline', publicKey: testLicensePublicKey });
}

/** Supply standard browser facilities to VM-based classic-bundle tests. */
export const licenseBrowserGlobals = {
  crypto: webcrypto, TextEncoder, TextDecoder, atob, btoa, URL,
  setInterval, clearInterval, setTimeout, clearTimeout, AbortController,
};
