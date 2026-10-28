/** node:crypto in the browser bundle: randomUUID from Web Crypto; the HMAC helpers (approval tokens) are never used. */
const unavailable = (name: string) => () => {
  throw new Error(`node:crypto ${name} is not available in the browser spike bundle`);
};
export const randomUUID = (): string => globalThis.crypto.randomUUID();
export const createHash = unavailable('createHash');
export const createHmac = unavailable('createHmac');
export const timingSafeEqual = unavailable('timingSafeEqual');
export default { randomUUID, createHash, createHmac, timingSafeEqual };
