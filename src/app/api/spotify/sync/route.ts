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
import { addTracksToPlaylist, getFilteredCandidateUris, type SpotifyPlaylistResponse } from "@/lib/spotify/playlists";
import { setUndoEntry } from "@/lib/spotify/undo-store";

interface SyncRequestBody {
  targetPlaylistId?: string;
  trackUris?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const { targetPlaylistId, trackUris } = (await request.json()) as SyncRequestBody;

    if (!targetPlaylistId) {
      return NextResponse.json({ error: "targetPlaylistId is required" }, { status: 400 });
    }

    if (!Array.isArray(trackUris)) {
      return NextResponse.json({ error: "trackUris must be an array" }, { status: 400 });
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
      `/playlists/${targetPlaylistId}?fields=id,name,description,images,collaborative,owner(id,display_name),tracks(total,items(track(id,uri,name,duration_ms,is_local,album(id,name,images),artists(id,name))),next),external_urls`,
    );

    const isCollaborative = playlistDetails.collaborative ?? false;
    const ownerId = playlistDetails.owner?.id ?? null;
    const isOwned = ownerId === currentUser.id;

    if (!isCollaborative && !isOwned) {
      return NextResponse.json(
        { error: "You can only sync into playlists you own or that are collaborative." },
        { status: 403 },
      );
    }

    const filteredUris = await getFilteredCandidateUris(fetcher, targetPlaylistId, trackUris, {
      initialPlaylist: playlistDetails,
    });
    const { addedUris, addedEntries, snapshotId } = await addTracksToPlaylist(fetcher, targetPlaylistId, filteredUris, {
      startingPosition: playlistDetails.tracks.total,
    });

    const undoResult =
      addedEntries.length > 0 ? setUndoEntry(context, targetPlaylistId, { entries: addedEntries, snapshotId }) : null;
    const undoToken = undoResult?.undoToken ?? null;

    const response = NextResponse.json({ addedUris, undoToken });
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
