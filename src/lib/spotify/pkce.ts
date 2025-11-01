import crypto from "crypto";

const PKCE_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export function generateCodeVerifier(length = 128): string {
  if (length < 43 || length > 128) {
    throw new Error("PKCE code verifier length must be between 43 and 128 characters");
  }

  const randomBytes = crypto.randomBytes(length);
  let verifier = "";

  for (let i = 0; i < length; i += 1) {
    const index = randomBytes[i] % PKCE_CHARSET.length;
    verifier += PKCE_CHARSET[index];
  }

  return verifier;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generateState(length = 16): string {
  const randomBytes = crypto.randomBytes(length);
  return base64UrlEncode(randomBytes);
}

export function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64UrlEncode(hash);
}
