import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  CODE_VERIFIER_COOKIE,
  EXPIRES_AT_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SCOPE_COOKIE,
  STATE_COOKIE,
  TOKEN_TYPE_COOKIE,
} from "@/lib/spotify/constants";
import { isProduction } from "@/lib/env";

export interface AuthCookiePayload {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scope?: string;
  expiresAt: number;
}

const BASE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax" as const,
  path: "/",
};

export function applyAuthCookies(response: NextResponse, payload: AuthCookiePayload): void {
  const maxAge = Math.max(0, Math.floor((payload.expiresAt - Date.now()) / 1000));

  response.cookies.set({
    name: ACCESS_TOKEN_COOKIE,
    value: payload.accessToken,
    ...BASE_OPTIONS,
    maxAge,
  });

  response.cookies.set({
    name: REFRESH_TOKEN_COOKIE,
    value: payload.refreshToken,
    ...BASE_OPTIONS,
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });

  response.cookies.set({
    name: EXPIRES_AT_COOKIE,
    value: payload.expiresAt.toString(),
    ...BASE_OPTIONS,
    maxAge: 30 * 24 * 60 * 60,
  });

  response.cookies.set({
    name: TOKEN_TYPE_COOKIE,
    value: payload.tokenType,
    ...BASE_OPTIONS,
    maxAge: 30 * 24 * 60 * 60,
  });

  response.cookies.set({
    name: SCOPE_COOKIE,
    value: payload.scope ?? "",
    ...BASE_OPTIONS,
    maxAge: 30 * 24 * 60 * 60,
  });
}

export function clearAuthCookies(response: NextResponse): void {
  [
    ACCESS_TOKEN_COOKIE,
    REFRESH_TOKEN_COOKIE,
    EXPIRES_AT_COOKIE,
    TOKEN_TYPE_COOKIE,
    SCOPE_COOKIE,
  ].forEach((name) => {
    response.cookies.set({
      name,
      value: "",
      ...BASE_OPTIONS,
      maxAge: 0,
    });
  });
}

export function setPkceCookies(response: NextResponse, codeVerifier: string, state: string): void {
  const maxAge = 10 * 60; // 10 minutes

  response.cookies.set({
    name: CODE_VERIFIER_COOKIE,
    value: codeVerifier,
    ...BASE_OPTIONS,
    maxAge,
  });

  response.cookies.set({
    name: STATE_COOKIE,
    value: state,
    ...BASE_OPTIONS,
    maxAge,
  });
}

export function clearPkceCookies(response: NextResponse): void {
  [CODE_VERIFIER_COOKIE, STATE_COOKIE].forEach((name) => {
    response.cookies.set({
      name,
      value: "",
      ...BASE_OPTIONS,
      maxAge: 0,
    });
  });
}

export function getCookie(request: NextRequest, name: string): string | undefined {
  return request.cookies.get(name)?.value;
}
