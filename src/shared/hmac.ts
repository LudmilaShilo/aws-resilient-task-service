import { createHmac } from 'crypto';

// Blind index: deterministic HMAC-SHA256 of userId for log identification
// without exposing PII. In production, store this index in the users table
// to look up a malicious actor by userIdIndex from logs.
export function createUserIdIndex(userId: string): string {
  return createHmac('sha256', process.env.HMAC_SECRET ?? '')
    .update(userId)
    .digest('hex');
}
