// The public key an app declares for browser sync: `[sync] public_key` in ebill.app.toml. eBill's sync window seals
// each bill a person chooses to share to it, so only the app's server can open what is shared (openSyncedDocument).
//
// Read without any crypto library, the same rule eBill applies to every push: one PEM block "PUBLIC KEY"
// (SubjectPublicKeyInfo), an RSA key, of 2048 to 4096 bits. Make one with:
//
//   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out sync-private.pem
//   openssl pkey -in sync-private.pem -pubout -out sync-public.pem

export const SYNC_KEY_MIN_BITS = 2048;
export const SYNC_KEY_MAX_BITS = 4096;
/** The longest PEM a 4096-bit key makes, with room for line breaks. */
export const SYNC_KEY_MAX_LENGTH = 1000;

const PEM = /^-----BEGIN PUBLIC KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)-----END PUBLIC KEY-----\r?\n?$/;
// 1.2.840.113549.1.1.1, rsaEncryption.
const RSA_ENCRYPTION = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];

interface Element {
  tag: number;
  start: number;
  end: number;
}

function element(bytes: Uint8Array, at: number, limit: number): Element | undefined {
  const tag = bytes[at];
  const first = bytes[at + 1];
  if (tag === undefined || first === undefined) return undefined;
  let length = first;
  let start = at + 2;
  if (first & 0x80) {
    const count = first & 0x7f;
    if (count === 0 || count > 2) return undefined;
    length = 0;
    for (let i = 0; i < count; i += 1) length = length * 256 + (bytes[start + i] ?? 0);
    start += count;
  }
  const end = start + length;
  return end <= limit ? { tag, start, end } : undefined;
}

function integerBits(bytes: Uint8Array, integer: Element): number {
  let at = integer.start;
  while (at < integer.end && bytes[at] === 0) at += 1;
  const top = bytes[at];
  if (top === undefined || at >= integer.end) return 0;
  return (integer.end - at - 1) * 8 + (32 - Math.clz32(top));
}

function base64Bytes(text: string): Uint8Array | undefined {
  try {
    const binary = atob(text.replace(/[\r\n]/g, ""));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function rsaAlgorithmEnd(bytes: Uint8Array, info: Element): number | undefined {
  const algorithm = element(bytes, info.start, info.end);
  if (algorithm?.tag !== 0x30) return undefined;
  const oid = element(bytes, algorithm.start, algorithm.end);
  if (oid?.tag !== 0x06 || oid.end - oid.start !== RSA_ENCRYPTION.length) return undefined;
  return RSA_ENCRYPTION.every((byte, i) => bytes[oid.start + i] === byte) ? algorithm.end : undefined;
}

function modulusIn(bytes: Uint8Array, at: number, info: Element): Element | undefined {
  const bits = element(bytes, at, info.end);
  if (bits?.tag !== 0x03 || bits.end !== info.end || bytes[bits.start] !== 0) return undefined;
  const key = element(bytes, bits.start + 1, bits.end);
  if (key?.tag !== 0x30 || key.end !== bits.end) return undefined;
  const modulus = element(bytes, key.start, key.end);
  const exponent = modulus?.tag === 0x02 ? element(bytes, modulus.end, key.end) : undefined;
  if (!modulus || exponent?.tag !== 0x02 || exponent.end !== key.end) return undefined;
  return isF4(bytes.subarray(exponent.start, exponent.end)) ? modulus : undefined;
}

// The public exponent is 65537, as every key `openssl` and Node make has: a weak one (e = 1 seals nothing) is no key.
const isF4 = (e: Uint8Array): boolean => e.length === 3 && e[0] === 0x01 && e[1] === 0x00 && e[2] === 0x01;

/** The bits of the RSA modulus in `pem`, a SubjectPublicKeyInfo PEM; undefined when it is not one. */
export function syncKeyBits(pem: string): number | undefined {
  if (pem.length > SYNC_KEY_MAX_LENGTH) return undefined;
  const body = PEM.exec(pem)?.[1];
  const bytes = body === undefined ? undefined : base64Bytes(body);
  if (!bytes) return undefined;
  const info = element(bytes, 0, bytes.length);
  if (info?.tag !== 0x30 || info.end !== bytes.length) return undefined;
  const algorithmEnd = rsaAlgorithmEnd(bytes, info);
  const modulus = algorithmEnd === undefined ? undefined : modulusIn(bytes, algorithmEnd, info);
  return modulus ? integerBits(bytes, modulus) : undefined;
}

/** Why `pem` is not a key eBill seals to; undefined when it is one. */
export function syncKeyProblem(pem: string): string | undefined {
  const bits = syncKeyBits(pem);
  if (bits === undefined) return 'must be an RSA public key in PEM ("-----BEGIN PUBLIC KEY-----"), as `openssl pkey -pubout` writes it';
  if (bits < SYNC_KEY_MIN_BITS || bits > SYNC_KEY_MAX_BITS) {
    return `must be ${String(SYNC_KEY_MIN_BITS)} to ${String(SYNC_KEY_MAX_BITS)} bits; this one is ${String(bits)}`;
  }
  return undefined;
}
