import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(key: string, parts: (string | Buffer)[]): string {
  const h = createHmac("sha256", key);
  for (const p of parts) h.update(p);
  return h.digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Mostra só o final de um identificador: "••••1a2b". Nunca use com secret inteiro em log. */
export function hint(value: string | null | undefined, visible = 4): string | null {
  if (!value) return null;
  return `••••${value.slice(-visible)}`;
}
