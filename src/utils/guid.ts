import crypto from 'crypto';

export function createGuid() {
  return crypto.randomBytes(16).toString('hex');
}

export function createHash(data: string) {
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 7);
}
