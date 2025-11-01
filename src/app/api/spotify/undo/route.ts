import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  SpotifyApiError,
  SpotifyAuthError,
  applyContextCookies,
  getSpotifyClient,
} from "@/lib/spotify/client";
import { removeTracksFromPlaylist } from "@/lib/spotify/playlists";
import { consumeUndoEntry } from "@/lib/spotify/undo-store";

interface UndoRequestBody {
  targetPlaylistId?: string;
  undoToken?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { targetPlaylistId, undoToken } = (await request.json()) as UndoRequestBody;

    if (!targetPlaylistId) {
      return NextResponse.json({ error: "targetPlaylistId is required" }, { status: 400 });
    }

    if (!undoToken) {
      return NextResponse.json({ error: "undoToken is required" }, { status: 400 });
    }

    const { context, fetcher } = await getSpotifyClient(request);
    const uris = consumeUndoEntry(context, targetPlaylistId, undoToken);

    if (!uris || uris.length === 0) {
      return NextResponse.json({ error: "No undoable sync found" }, { status: 404 });
    }

    const { removedUris } = await removeTracksFromPlaylist(fetcher, targetPlaylistId, uris);

    const response = NextResponse.json({ removedUris });
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
