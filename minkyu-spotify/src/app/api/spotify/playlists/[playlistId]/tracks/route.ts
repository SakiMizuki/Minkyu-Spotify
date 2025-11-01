import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  SpotifyApiError,
  SpotifyAuthError,
  applyContextCookies,
  getSpotifyClient,
} from "@/lib/spotify/client";
import { getPlaylistWithTracks } from "@/lib/spotify/playlists";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ playlistId: string }> },
) {
  try {
    const { playlistId } = await context.params;

    if (!playlistId) {
      return NextResponse.json({ error: "Playlist ID is required" }, { status: 400 });
    }

    const { context: authContext, fetcher } = await getSpotifyClient(request);
    const playlist = await getPlaylistWithTracks(fetcher, playlistId);
    const response = NextResponse.json(playlist);
    applyContextCookies(response, authContext);
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
