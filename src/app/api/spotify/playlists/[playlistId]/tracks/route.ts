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
import { toPlaylistSummary, toSpotifyTrack, type SpotifyPlaylistTrackItem } from "@/lib/spotify/playlists";
import type { PlaylistSummary, SpotifyTrack } from "@/types/spotify";

interface SpotifyPlaylistTracksPage {
  items?: SpotifyPlaylistTrackItem[];
  next?: string | null;
  total?: number;
}

interface PlaylistTracksPageResponse {
  summary: PlaylistSummary | null;
  tracks: SpotifyTrack[];
  offset: number;
  limit: number;
  total: number;
  loaded: number;
  nextOffset: number | null;
}

function parseOffset(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function parseLimit(value: string | null): number {
  const DEFAULT_LIMIT = 100;
  const MAX_LIMIT = 100;
  const MIN_LIMIT = 1;

  if (!value) {
    return DEFAULT_LIMIT;
  }

  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(parsed)));
}

function extractNextOffset(nextUrl: string | null | undefined): number | null {
  if (!nextUrl) {
    return null;
  }

  try {
    const url = new URL(nextUrl);
    const offset = url.searchParams.get("offset");
    return offset ? Number(offset) : null;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ playlistId: string }> },
) {
  try {
    const { playlistId } = await context.params;

    if (!playlistId) {
      return NextResponse.json({ error: "Playlist ID is required" }, { status: 400 });
    }

    const searchParams = request.nextUrl.searchParams;
    const offset = parseOffset(searchParams.get("offset"));
    const limit = parseLimit(searchParams.get("limit"));

    const { context: authContext, fetcher } = await getSpotifyClient(request);
    ensureSpotifyScopes(authContext, ["playlist-read-private", "playlist-read-collaborative"]);

    const tracksPage = await fetcher<SpotifyPlaylistTracksPage>(
      `/playlists/${playlistId}/tracks?offset=${offset}&limit=${limit}&fields=items(track(id,uri,name,duration_ms,is_local,album(id,name,images),artists(id,name))),next,total`,
    );

    const tracksRaw = Array.isArray(tracksPage.items) ? tracksPage.items : [];
    const tracks: SpotifyTrack[] = [];

    for (const item of tracksRaw) {
      const track = toSpotifyTrack(item as SpotifyPlaylistTrackItem);
      if (track) {
        tracks.push(track);
      }
    }

    let summary: PlaylistSummary | null = null;
    let total = typeof tracksPage.total === "number" ? tracksPage.total : 0;

    if (offset === 0) {
      const currentUser = await fetcher<{ id: string }>("/me");
      const playlistMetadata = await fetcher<{
        id: string;
        name: string;
        description?: string | null;
        images: { url: string; height: number | null; width: number | null }[];
        owner: { id?: string | null; display_name?: string | null };
        collaborative?: boolean;
        tracks: { total: number };
        external_urls?: { spotify?: string };
      }>(
        `/playlists/${playlistId}?fields=id,name,description,images,collaborative,owner(id,display_name),tracks(total),external_urls`,
      );

      summary = toPlaylistSummary(playlistMetadata, currentUser.id);
      total = playlistMetadata.tracks?.total ?? total;
    }

    const nextOffset = extractNextOffset(tracksPage.next ?? null);
    const loaded = Math.min(offset + tracks.length, total);

    const responsePayload: PlaylistTracksPageResponse = {
      summary,
      tracks,
      offset,
      limit,
      total,
      loaded,
      nextOffset,
    };

    const response = NextResponse.json(responsePayload);
    applyContextCookies(response, authContext);
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
