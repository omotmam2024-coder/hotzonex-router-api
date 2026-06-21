import crypto from "crypto";
import { config } from "../config";

const ALG = "aes-256-gcm";

/** Encrypt a plaintext string. Returns iv:encrypted:tag as hex. */
export function encrypt(text: string): string {
  const key = Buffer.from(config.encryptionKey, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
}

/** Decrypt a string produced by encrypt(). */
export function decrypt(ciphertext: string): string {
  const [ivHex, encHex, tagHex] = ciphertext.split(":");
  const key = Buffer.from(config.encryptionKey, "hex");
  const decipher = crypto.createDecipheriv(ALG, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  // Concat the buffers BEFORE decoding so multi-byte chars split across the
  // update/final boundary aren't corrupted.
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
