import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  SpotifyApiError,
  SpotifyAuthError,
  applyContextCookies,
  getSpotifyClient,
} from "@/lib/spotify/client";
import { syncPlaylistsWithFetcher } from "@/lib/spotify/playlists";

interface SyncRequestBody {
  sourcePlaylistId?: string;
  targetPlaylistId?: string;
  twoWay?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const { sourcePlaylistId, targetPlaylistId, twoWay = false } = (await request.json()) as SyncRequestBody;

    if (!sourcePlaylistId || !targetPlaylistId) {
      return NextResponse.json({ error: "Both sourcePlaylistId and targetPlaylistId are required" }, { status: 400 });
    }

    const { context, fetcher } = await getSpotifyClient(request);
    const result = await syncPlaylistsWithFetcher(fetcher, sourcePlaylistId, targetPlaylistId, twoWay);
    const response = NextResponse.json(result);
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
