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
    const fetchResponse = await fetch(buildSpotifyUrl(path), {
      ...init,
      headers: {
        Authorization: `${context.tokenType} ${context.accessToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });

    if (!fetchResponse.ok) {
      let details: unknown;
      try {
        details = await fetchResponse.json();
      } catch {
        details = await fetchResponse.text();
      }

      throw new SpotifyApiError(fetchResponse.status, fetchResponse.statusText, details);
    }

    return (await fetchResponse.json()) as T;
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
