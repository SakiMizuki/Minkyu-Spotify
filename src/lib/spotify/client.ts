import { NextRequest, NextResponse } from "next/server";

import { SPOTIFY_API_URL } from "@/lib/spotify/constants";
import { applyAuthCookies } from "@/lib/spotify/cookies";
import { ensureValidTokens } from "@/lib/spotify/auth";

export class SpotifyAuthError extends Error {
  constructor(message = "Spotify authentication required") {
    super(message);
    this.name = "SpotifyAuthError";
  }
}

export class SpotifyApiError extends Error {
  status: number;
  statusText: string;
  details?: unknown;

  constructor(status: number, statusText: string, details?: unknown) {
    super(`Spotify API error: ${status} ${statusText}`);
    this.name = "SpotifyApiError";
    this.status = status;
    this.statusText = statusText;
    this.details = details;
  }
}

export class SpotifyScopeError extends Error {
  missingScopes: string[];

  constructor(missingScopes: string[]) {
    super(`Missing required Spotify scopes: ${missingScopes.join(", ")}`);
    this.name = "SpotifyScopeError";
    this.missingScopes = missingScopes;
  }
}

export interface SpotifyAccessContext {
  accessToken: string;
  tokenType: string;
  scope?: string;
  applyCookies?: (response: NextResponse) => void;
}

export async function resolveAccessToken(request: NextRequest): Promise<SpotifyAccessContext> {
  const tokenInfo = await ensureValidTokens(request);

  if (!tokenInfo) {
    throw new SpotifyAuthError();
  }

  return {
    accessToken: tokenInfo.payload.accessToken,
    tokenType: tokenInfo.payload.tokenType,
    scope: tokenInfo.payload.scope,
    applyCookies: tokenInfo.needsRefresh
      ? (response: NextResponse) => applyAuthCookies(response, tokenInfo.payload)
      : undefined,
  };
}

function buildSpotifyUrl(path: string | URL): string {
  if (path instanceof URL) {
    return path.toString();
  }

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${SPOTIFY_API_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

export type SpotifyFetcher = <T = unknown>(path: string | URL, init?: RequestInit) => Promise<T>;

export function createSpotifyFetcher(context: SpotifyAccessContext): SpotifyFetcher {
  return async function <T = unknown>(path: string | URL, init: RequestInit = {}): Promise<T> {
    const maxRetries = 5;
    let attempt = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const headers = new Headers(init.headers ?? {});
      headers.set("Authorization", `${context.tokenType} ${context.accessToken}`);
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const response = await fetch(buildSpotifyUrl(path), {
        ...init,
        headers,
        cache: "no-store",
      });

      if (response.status === 429) {
        if (attempt >= maxRetries) {
          const details = await safeParseErrorBody(response);
          throw new SpotifyApiError(response.status, response.statusText, details);
        }

        const retryAfterMs = parseRetryAfterHeader(response.headers);
        attempt += 1;
        await delay(retryAfterMs);
        continue;
      }

      if (!response.ok) {
        const details = await safeParseErrorBody(response);
        throw new SpotifyApiError(response.status, response.statusText, details);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      if (response.headers.get("Content-Type")?.includes("application/json")) {
        return (await response.json()) as T;
      }

      const text = await response.text();
      return text as unknown as T;
    }
  };
}

export async function getSpotifyClient(request: NextRequest): Promise<{
  context: SpotifyAccessContext;
  fetcher: SpotifyFetcher;
}> {
  const context = await resolveAccessToken(request);
  return { context, fetcher: createSpotifyFetcher(context) };
}

export function applyContextCookies(response: NextResponse, context: SpotifyAccessContext): void {
  if (context.applyCookies) {
    context.applyCookies(response);
  }
}

function parseRetryAfterHeader(headers: Headers): number {
  const retryAfter = headers.get("Retry-After");

  if (!retryAfter) {
    return 1_000;
  }

  const asNumber = Number(retryAfter);

  if (!Number.isNaN(asNumber)) {
    return Math.max(1, Math.round(asNumber * 1_000));
  }

  const asDate = Date.parse(retryAfter);

  if (!Number.isNaN(asDate)) {
    const diff = asDate - Date.now();
    return Math.max(1_000, diff);
  }

  return 1_000;
}

async function safeParseErrorBody(response: Response): Promise<unknown> {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ensureSpotifyScopes(context: SpotifyAccessContext, requiredScopes: string[]): void {
  const availableScopes = new Set((context.scope ?? "").split(" ").filter(Boolean));
  const missing = requiredScopes.filter((scope) => !availableScopes.has(scope));

  if (missing.length > 0) {
    throw new SpotifyScopeError(missing);
  }
}
