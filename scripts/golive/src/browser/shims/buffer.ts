/**
 * The slice of Node's Buffer that @neighborline/paypal's OAuth call uses (`Buffer.from(s).toString('base64')`), for
 * the browser bundle (esbuild `inject`). UTF-8 and base64/base64url only.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

class BrowserBuffer {
  constructor(readonly bytes: Uint8Array) {}
  get length(): number {
    return this.bytes.length;
  }
  toString(encoding = 'utf8'): string {
    if (encoding === 'base64' || encoding === 'base64url') {
      let s = '';
      for (const b of this.bytes) s += String.fromCharCode(b);
      const b64 = btoa(s);
      return encoding === 'base64' ? b64 : b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    return dec.decode(this.bytes);
  }
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const Buffer = {
  from(v: string | Uint8Array | ArrayBuffer | BrowserBuffer, encoding?: string): BrowserBuffer {
    if (v instanceof BrowserBuffer) return new BrowserBuffer(v.bytes.slice());
    if (typeof v === 'string') return new BrowserBuffer(encoding === 'base64' || encoding === 'base64url' ? fromBase64(v) : enc.encode(v));
    return new BrowserBuffer(new Uint8Array(v));
  },
  isBuffer: (x: unknown): x is BrowserBuffer => x instanceof BrowserBuffer,
  concat(list: BrowserBuffer[]): BrowserBuffer {
    const out = new Uint8Array(list.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of list) out.set(b.bytes, (at += b.length) - b.length);
    return new BrowserBuffer(out);
  },
};
