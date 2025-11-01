import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { tokenResponseToPayload, refreshAccessToken } from "@/lib/spotify/auth";
import { REFRESH_TOKEN_COOKIE } from "@/lib/spotify/constants";
import { applyAuthCookies, getCookie } from "@/lib/spotify/cookies";

export async function POST(request: NextRequest) {
  const refreshToken = getCookie(request, REFRESH_TOKEN_COOKIE);

  if (!refreshToken) {
    return NextResponse.json({ error: "No refresh token available" }, { status: 401 });
  }

  try {
    const tokens = await refreshAccessToken(refreshToken);
    const payload = tokenResponseToPayload(tokens, refreshToken);
    const response = NextResponse.json({ success: true, expiresIn: tokens.expires_in });
    applyAuthCookies(response, payload);
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to refresh token" }, { status: 500 });
  }
}
