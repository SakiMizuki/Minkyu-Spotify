import type { PlaylistSummary, PlaylistWithTracks, SpotifyTrack } from "@/types/spotify";
import type { SpotifyFetcher } from "@/lib/spotify/client";

interface SpotifyImageResponse {
  url: string;
  height: number | null;
  width: number | null;
}

interface SpotifyPlaylistOwner {
  display_name?: string | null;
}

interface SpotifyPlaylistItem {
  id: string;
  name: string;
  description?: string | null;
  images: SpotifyImageResponse[];
  owner: SpotifyPlaylistOwner;
  tracks: {
    total: number;
  };
  external_urls?: {
    spotify?: string;
  };
}

interface SpotifyPlaylistPage {
  items: SpotifyPlaylistItem[];
  next: string | null;
  total: number;
}

interface SpotifyPlaylistTrackItem {
  track: {
    id: string | null;
    uri: string;
    name: string;
    duration_ms: number;
    is_local: boolean;
    artists: { id: string | null; name: string }[];
    album: { id: string | null; name: string; images: SpotifyImageResponse[] };
  } | null;
}

interface SpotifyPlaylistResponse extends SpotifyPlaylistItem {
  tracks: {
    items: SpotifyPlaylistTrackItem[];
    next: string | null;
    total: number;
  };
}

export interface PlaylistComparison {
  source: PlaylistWithTracks;
  target: PlaylistWithTracks;
  missingInTarget: SpotifyTrack[];
  missingInSource: SpotifyTrack[];
}

function toPlaylistSummary(playlist: SpotifyPlaylistItem): PlaylistSummary {
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description ?? null,
    images: playlist.images,
    ownerName: playlist.owner?.display_name ?? null,
    trackCount: playlist.tracks.total,
    externalUrl: playlist.external_urls?.spotify,
  };
}

function toSpotifyTrack(item: SpotifyPlaylistTrackItem): SpotifyTrack | undefined {
  if (!item.track) {
    return undefined;
  }

  return {
    id: item.track.id,
    uri: item.track.uri,
    name: item.track.name,
    duration_ms: item.track.duration_ms,
    is_local: item.track.is_local,
    artists: item.track.artists.map((artist) => ({ id: artist.id, name: artist.name })),
    album: {
      id: item.track.album.id,
      name: item.track.album.name,
      images: item.track.album.images,
    },
  };
}

async function fetchAllPlaylistTracks(fetcher: SpotifyFetcher, initial: SpotifyPlaylistResponse): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = [];

  for (const item of initial.tracks.items) {
    const track = toSpotifyTrack(item);
    if (track) {
      tracks.push(track);
    }
  }

  let nextUrl = initial.tracks.next;

  while (nextUrl !== null) {
    const page: {
      items: SpotifyPlaylistTrackItem[];
      next: string | null;
    } = await fetcher(nextUrl);

    for (const item of page.items) {
      const track = toSpotifyTrack(item);
      if (track) {
        tracks.push(track);
      }
    }

    nextUrl = page.next;
  }

  return tracks;
}

export async function getUserPlaylists(fetcher: SpotifyFetcher): Promise<{ playlists: PlaylistSummary[]; total: number }> {
  const playlists: PlaylistSummary[] = [];
  let total = 0;
  let url: string | null = "/me/playlists?limit=50";

  while (url !== null) {
    const page: SpotifyPlaylistPage = await fetcher(url);
    total = page.total;
    playlists.push(...page.items.map(toPlaylistSummary));
    url = page.next;
  }

  return { playlists, total };
}

export async function getPlaylistWithTracks(fetcher: SpotifyFetcher, playlistId: string): Promise<PlaylistWithTracks> {
  const playlist = await fetcher<SpotifyPlaylistResponse>(
    `/playlists/${playlistId}?fields=id,name,description,images,owner(display_name),tracks(total,items(track(id,uri,name,duration_ms,is_local,album(id,name,images),artists(id,name))),next),external_urls`,
  );

  const tracks = await fetchAllPlaylistTracks(fetcher, playlist);

  return {
    summary: toPlaylistSummary(playlist),
    tracks,
  };
}

export async function comparePlaylistsWithFetcher(
  fetcher: SpotifyFetcher,
  sourceId: string,
  targetId: string,
): Promise<PlaylistComparison> {
  const [sourceResponse, targetResponse] = await Promise.all([
    fetcher<SpotifyPlaylistResponse>(
      `/playlists/${sourceId}?fields=id,name,description,images,owner(display_name),tracks(total,items(track(id,uri,name,duration_ms,is_local,album(id,name,images),artists(id,name))),next),external_urls`,
    ),
    fetcher<SpotifyPlaylistResponse>(
      `/playlists/${targetId}?fields=id,name,description,images,owner(display_name),tracks(total,items(track(id,uri,name,duration_ms,is_local,album(id,name,images),artists(id,name))),next),external_urls`,
    ),
  ]);

  const [sourceTracks, targetTracks] = await Promise.all([
    fetchAllPlaylistTracks(fetcher, sourceResponse),
    fetchAllPlaylistTracks(fetcher, targetResponse),
  ]);

  const sourcePlaylist: PlaylistWithTracks = {
    summary: toPlaylistSummary(sourceResponse),
    tracks: sourceTracks,
  };

  const targetPlaylist: PlaylistWithTracks = {
    summary: toPlaylistSummary(targetResponse),
    tracks: targetTracks,
  };

  const sourceUris = new Set(sourceTracks.map((track) => track.uri));
  const targetUris = new Set(targetTracks.map((track) => track.uri));

  return {
    source: sourcePlaylist,
    target: targetPlaylist,
    missingInTarget: sourceTracks.filter((track) => !targetUris.has(track.uri)),
    missingInSource: targetTracks.filter((track) => !sourceUris.has(track.uri)),
  };
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  return chunks;
}

export async function addTracksToPlaylist(fetcher: SpotifyFetcher, playlistId: string, uris: string[]): Promise<number> {
  let totalAdded = 0;

  for (const chunk of chunkArray(uris, 100)) {
    if (chunk.length === 0) {
      continue;
    }

    await fetcher<{ snapshot_id: string }>(`/playlists/${playlistId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ uris: chunk }),
    });

    totalAdded += chunk.length;
  }

  return totalAdded;
}

export async function syncPlaylistsWithFetcher(
  fetcher: SpotifyFetcher,
  sourceId: string,
  targetId: string,
  twoWay: boolean,
): Promise<{
  addedToTarget: number;
  addedToSource: number;
  comparison: PlaylistComparison;
}> {
  const comparison = await comparePlaylistsWithFetcher(fetcher, sourceId, targetId);

  const missingInTargetUris = comparison.missingInTarget.map((track) => track.uri);
  const missingInSourceUris = comparison.missingInSource.map((track) => track.uri);

  const addedToTarget = await addTracksToPlaylist(fetcher, targetId, missingInTargetUris);
  const addedToSource = twoWay ? await addTracksToPlaylist(fetcher, sourceId, missingInSourceUris) : 0;

  const updatedComparison = await comparePlaylistsWithFetcher(fetcher, sourceId, targetId);

  return {
    addedToTarget,
    addedToSource,
    comparison: updatedComparison,
  };
}
