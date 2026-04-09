import { PlaudConfig } from '@plaud/core';
import type { PlaudTokenData } from '@plaud/core';

export async function setTokenCommand(args: string[]): Promise<void> {
  const token = args[0];
  const region = (args[1] ?? 'us') as 'us' | 'eu';

  if (!token) {
    console.error('Usage: plaud set-token <jwt-token> [us|eu]');
    console.error('');
    console.error('Get your token from web.plaud.ai:');
    console.error('  1. Log in with Google');
    console.error('  2. Open DevTools → Network tab');
    console.error('  3. Look for API requests with Authorization: Bearer <token>');
    console.error('  4. Copy the token (starts with "eyJ...")');
    process.exit(1);
  }

  // Decode JWT to get expiry
  const parts = token.split('.');
  if (parts.length !== 3) {
    console.error('Error: Invalid JWT token format. Token should have 3 parts separated by dots.');
    process.exit(1);
  }

  let iat = 0;
  let exp = 0;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    iat = payload.iat ?? 0;
    exp = payload.exp ?? 0;
  } catch {
    console.error('Error: Could not decode JWT payload.');
    process.exit(1);
  }

  const config = new PlaudConfig();
  const tokenData: PlaudTokenData = {
    accessToken: token,
    tokenType: 'Bearer',
    issuedAt: iat * 1000,
    expiresAt: exp * 1000,
  };

  config.saveToken(tokenData);
  // Also save region as pseudo-credentials so the client knows which region to use
  config.save({ region } as any);

  const expiryDate = new Date(exp * 1000).toISOString().slice(0, 10);
  console.log(`Token saved! Expires: ${expiryDate}, Region: ${region}`);
}
