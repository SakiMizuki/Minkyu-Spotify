import { NextRequest, NextResponse } from "next/server";

import { getRequiredEnv } from "@/lib/env";
import {
  ACCESS_TOKEN_COOKIE,
  CODE_VERIFIER_COOKIE,
  EXPIRES_AT_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SCOPE_COOKIE,
  SPOTIFY_AUTH_URL,
  SPOTIFY_SCOPES,
  SPOTIFY_TOKEN_URL,
  STATE_COOKIE,
  TOKEN_REFRESH_THRESHOLD_MS,
  TOKEN_TYPE_COOKIE,
} from "@/lib/spotify/constants";
import {
  AuthCookiePayload,
  applyAuthCookies,
  clearAuthCookies,
  clearPkceCookies,
  getCookie,
  setPkceCookies,
} from "@/lib/spotify/cookies";
import { generateCodeChallenge, generateCodeVerifier, generateState } from "@/lib/spotify/pkce";

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

function buildAuthorizeUrl(codeChallenge: string, state: string): string {
  const url = new URL(SPOTIFY_AUTH_URL);

  url.searchParams.set("client_id", getRequiredEnv("SPOTIFY_CLIENT_ID"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", getRequiredEnv("SPOTIFY_REDIRECT_URI"));
  url.searchParams.set("scope", SPOTIFY_SCOPES.join(" "));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("state", state);

  return url.toString();
}

async function requestTokens(body: URLSearchParams): Promise<SpotifyTokenResponse> {
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Spotify token request failed: ${response.status} ${detail}`);
  }

  return (await response.json()) as SpotifyTokenResponse;
}

export async function handleLogin(): Promise<NextResponse> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState(16);

  const authorizeUrl = buildAuthorizeUrl(codeChallenge, state);
  const response = NextResponse.redirect(authorizeUrl);

  setPkceCookies(response, codeVerifier, state);

  return response;
}

export function tokenResponseToPayload(tokens: SpotifyTokenResponse, refreshTokenFallback?: string): AuthCookiePayload {
  const refreshToken = tokens.refresh_token ?? refreshTokenFallback;

  if (!refreshToken) {
    throw new Error("Spotify token response did not include a refresh token");
  }

  const expiresAt = Date.now() + tokens.expires_in * 1000;

  return {
    accessToken: tokens.access_token,
    refreshToken,
    tokenType: tokens.token_type,
    scope: tokens.scope,
    expiresAt,
  };
}

export async function handleCallback(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  const storedState = getCookie(request, STATE_COOKIE);
  const codeVerifier = getCookie(request, CODE_VERIFIER_COOKIE);

  let redirectUrl = getRequiredEnv("NEXT_PUBLIC_BASE_URL");

  if (!state || !storedState || state !== storedState) {
    redirectUrl += "?error=state_mismatch";
    const response = NextResponse.redirect(redirectUrl);
    clearPkceCookies(response);
    clearAuthCookies(response);
    return response;
  }

  if (error) {
    redirectUrl += `?error=${encodeURIComponent(error)}`;
    const response = NextResponse.redirect(redirectUrl);
    clearPkceCookies(response);
    return response;
  }

  if (!code || !codeVerifier) {
    redirectUrl += "?error=missing_code";
    const response = NextResponse.redirect(redirectUrl);
    clearPkceCookies(response);
    clearAuthCookies(response);
    return response;
  }

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRequiredEnv("SPOTIFY_REDIRECT_URI"),
    client_id: getRequiredEnv("SPOTIFY_CLIENT_ID"),
    code_verifier: codeVerifier,
  });

  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (clientSecret) {
    tokenBody.set("client_secret", clientSecret);
  }

  try {
    const tokens = await requestTokens(tokenBody);
    const payload = tokenResponseToPayload(tokens);
    const response = NextResponse.redirect(redirectUrl);

    clearPkceCookies(response);
    applyAuthCookies(response, payload);

    return response;
  } catch (tokenError) {
    redirectUrl += "?error=token_exchange_failed";
    const response = NextResponse.redirect(redirectUrl);
    clearPkceCookies(response);
    clearAuthCookies(response);
    console.error(tokenError);
    return response;
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: getRequiredEnv("SPOTIFY_CLIENT_ID"),
  });

  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  return requestTokens(body);
}

export async function ensureValidTokens(
  request: NextRequest,
): Promise<{ payload: AuthCookiePayload; needsRefresh: boolean } | undefined> {
  const accessToken = getCookie(request, ACCESS_TOKEN_COOKIE);
  const refreshToken = getCookie(request, REFRESH_TOKEN_COOKIE);
  const expiresAt = getCookie(request, EXPIRES_AT_COOKIE);
  const tokenType = getCookie(request, TOKEN_TYPE_COOKIE) ?? "Bearer";
  const scope = getCookie(request, SCOPE_COOKIE) ?? undefined;

  if (!accessToken || !refreshToken || !expiresAt) {
    return undefined;
  }

  const expiresAtNumber = Number(expiresAt);
  const now = Date.now();

  if (Number.isNaN(expiresAtNumber)) {
    return undefined;
  }

  if (now < expiresAtNumber - TOKEN_REFRESH_THRESHOLD_MS) {
    return {
      payload: {
        accessToken,
        refreshToken,
        tokenType,
        scope,
        expiresAt: expiresAtNumber,
      },
      needsRefresh: false,
    };
  }

  const tokens = await refreshAccessToken(refreshToken);

  return {
    payload: tokenResponseToPayload(tokens, refreshToken),
    needsRefresh: true,
  };
}

export function logout(): NextResponse {
  const response = NextResponse.redirect(getRequiredEnv("NEXT_PUBLIC_BASE_URL"));
  clearAuthCookies(response);
  clearPkceCookies(response);
  return response;
}
