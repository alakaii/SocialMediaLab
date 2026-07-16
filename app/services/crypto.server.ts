import crypto from "crypto";

const ALGO = "aes-256-gcm";
const VERSION_PREFIX = "enc:v1:";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ENCRYPTION_KEY is required in production. Generate one with: openssl rand -base64 32",
      );
    }
    console.warn(
      "[crypto] ENCRYPTION_KEY is not set; tokens are stored as plaintext (development only).",
    );
    return null;
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be a base64-encoded 32-byte key (openssl rand -base64 32).");
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return VERSION_PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(value: string): string {
  // Legacy plaintext values are stored without the version marker; read them as-is.
  if (!value.startsWith(VERSION_PREFIX)) return value;
  const key = getKey();
  if (!key) {
    throw new Error("ENCRYPTION_KEY is required to decrypt stored tokens.");
  }
  const raw = Buffer.from(value.slice(VERSION_PREFIX.length), "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const enc = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
