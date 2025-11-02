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
import { removeTracksFromPlaylist, type SpotifyPlaylistResponse } from "@/lib/spotify/playlists";

interface RemoveRequestBody {
  playlistId?: string;
  entries?: { uri?: string; position?: number }[];
}

export async function POST(request: NextRequest) {
  try {
    const { playlistId, entries } = (await request.json()) as RemoveRequestBody;

    if (!playlistId) {
      return NextResponse.json({ error: "playlistId is required" }, { status: 400 });
    }

    if (!Array.isArray(entries)) {
      return NextResponse.json({ error: "entries must be an array" }, { status: 400 });
    }

    const normalizedEntries = entries
      .map((entry) => {
        const uri = typeof entry?.uri === "string" ? entry.uri.trim() : "";
        const position = typeof entry?.position === "number" ? Math.floor(entry.position) : Number.NaN;

        if (!uri || Number.isNaN(position) || position < 0) {
          return null;
        }

        return { uri, position };
      })
      .filter((entry): entry is { uri: string; position: number } => entry !== null);

    if (normalizedEntries.length === 0) {
      return NextResponse.json({ error: "Provide at least one valid entry to remove." }, { status: 400 });
    }

    const { context, fetcher } = await getSpotifyClient(request);
    ensureSpotifyScopes(context, [
      "playlist-read-private",
      "playlist-read-collaborative",
      "playlist-modify-private",
      "playlist-modify-public",
    ]);

    const currentUser = await fetcher<{ id: string }>("/me");
    const playlistDetails = await fetcher<SpotifyPlaylistResponse>(
      `/playlists/${playlistId}?fields=id,name,collaborative,owner(id),tracks(total,items(track(uri))),external_urls`
    );

    const isCollaborative = playlistDetails.collaborative ?? false;
    const ownerId = playlistDetails.owner?.id ?? null;
    const isOwned = ownerId === currentUser.id;

    if (!isCollaborative && !isOwned) {
      return NextResponse.json(
        { error: "You can only remove tracks from playlists you own or that are collaborative." },
        { status: 403 },
      );
    }

    const removalResult = await removeTracksFromPlaylist(fetcher, playlistId, normalizedEntries);

    const response = NextResponse.json({
      removedCount: removalResult.removedCount,
      removedUris: removalResult.removedUris,
    });
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
