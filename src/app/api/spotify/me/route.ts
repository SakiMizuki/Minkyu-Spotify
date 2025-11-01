import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  SpotifyApiError,
  SpotifyAuthError,
  applyContextCookies,
  getSpotifyClient,
} from "@/lib/spotify/client";

export async function GET(request: NextRequest) {
  try {
    const { context, fetcher } = await getSpotifyClient(request);
    const profile = await fetcher("/me");
    const response = NextResponse.json(profile);
    applyContextCookies(response, context);
    return response;
  } catch (error) {
    if (error instanceof SpotifyAuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (error instanceof SpotifyApiError) {
      return NextResponse.json({ error: error.statusText, details: error.details }, { status: error.status });
    }

    console.error(error);
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
