import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  SpotifyApiError,
  SpotifyAuthError,
  SpotifyScopeError,
  applyContextCookies,
  ensureSpotifyScopes,
  getSpotifyClient,
} from "@/lib/spotify/client";
import { getUserPlaylists } from "@/lib/spotify/playlists";

export async function GET(request: NextRequest) {
  try {
    const { context, fetcher } = await getSpotifyClient(request);
    ensureSpotifyScopes(context, ["playlist-read-private", "playlist-read-collaborative"]);
    const { playlists, total } = await getUserPlaylists(fetcher);
    const response = NextResponse.json({ playlists, total });
    applyContextCookies(response, context);
    return response;
  } catch (error) {
    if (error instanceof SpotifyAuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (error instanceof SpotifyScopeError) {
      return NextResponse.json(
        {
          error: "Missing Spotify permissions",
          details: { missingScopes: error.missingScopes },
          action: "Please log in again to re-authorize the required playlist scopes.",
        },
        { status: 403 },
      );
    }

    if (error instanceof SpotifyApiError) {
      return NextResponse.json({ error: error.statusText, details: error.details }, { status: error.status });
    }

    console.error(error);
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
