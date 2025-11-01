import type { PlaylistSummary, PlaylistWithTracks, SpotifyTrack } from "@/types/spotify";
import type { SpotifyFetcher } from "@/lib/spotify/client";
import type {
  ComparableTrack,
  PlaylistComparisonPayload,
  PlaylistTrackWithPresence,
  TrackPresence,
} from "@/lib/spotify/comparison";
import { buildPlaylistComparison } from "@/lib/spotify/comparison";

export type { TrackPresence, ComparableTrack, PlaylistTrackWithPresence, PlaylistComparisonPayload } from "@/lib/spotify/comparison";
export { buildPlaylistComparison } from "@/lib/spotify/comparison";

interface SpotifyImageResponse {
  url: string;
  height: number | null;
  width: number | null;
}

interface SpotifyPlaylistOwner {
  id?: string | null;
  display_name?: string | null;
}

interface SpotifyPlaylistItem {
  id: string;
  name: string;
  description?: string | null;
  images: SpotifyImageResponse[];
  owner: SpotifyPlaylistOwner;
  collaborative?: boolean;
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

export interface SpotifyPlaylistTrackItem {
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

export interface SpotifyPlaylistResponse extends SpotifyPlaylistItem {
  tracks: {
    items: SpotifyPlaylistTrackItem[];
    next: string | null;
    total: number;
  };
}

export function toPlaylistSummary(playlist: SpotifyPlaylistItem, currentUserId?: string): PlaylistSummary {
  const ownerId = playlist.owner?.id ?? null;
  const isCollaborative = playlist.collaborative ?? false;
  const isOwned = currentUserId ? ownerId === currentUserId : false;

  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description ?? null,
    images: playlist.images,
    ownerName: playlist.owner?.display_name ?? null,
    ownerId,
    trackCount: playlist.tracks.total,
    externalUrl: playlist.external_urls?.spotify,
    isCollaborative,
    isOwned,
    isEditable: isOwned || isCollaborative,
  };
}

export function toSpotifyTrack(item: SpotifyPlaylistTrackItem): SpotifyTrack | undefined {
  if (!item.track) {
    return undefined;
  }

  const album = item.track.album ?? { id: null, name: "Unknown album", images: [] };
  const artists = Array.isArray(item.track.artists) ? item.track.artists : [];

  return {
    id: item.track.id,
    uri: item.track.uri,
    name: item.track.name,
    duration_ms: item.track.duration_ms,
    is_local: item.track.is_local,
    artists: artists.map((artist) => ({ id: artist?.id ?? null, name: artist?.name ?? "Unknown artist" })),
    album: {
      id: album.id ?? null,
      name: album.name ?? "Unknown album",
      images: Array.isArray(album.images) ? album.images : [],
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

  let nextUrl: string | null = initial.tracks.next ?? null;

  while (typeof nextUrl === "string" && nextUrl.length > 0) {
    const page = await fetcher<{
      items?: SpotifyPlaylistTrackItem[];
      next?: string | null;
    }>(nextUrl);

    const items = Array.isArray(page.items) ? page.items : [];

    for (const item of items) {
      const track = toSpotifyTrack(item);
      if (track) {
        tracks.push(track);
      }
    }

    nextUrl = page.next ?? null;
  }

  return tracks;
}

export async function getUserPlaylists(fetcher: SpotifyFetcher): Promise<{ playlists: PlaylistSummary[]; total: number }> {
  const playlists: PlaylistSummary[] = [];
  let total = 0;
  let url: string | null = "/me/playlists?limit=50";
  const currentUser = await fetcher<{ id: string }>("/me");
  const currentUserId = currentUser.id;

  while (url !== null) {
    const page: SpotifyPlaylistPage = await fetcher(url);
    total = page.total;
    playlists.push(...page.items.map((playlist) => toPlaylistSummary(playlist, currentUserId)));
    url = page.next;
  }

  return { playlists, total };
}

export async function getPlaylistWithTracks(fetcher: SpotifyFetcher, playlistId: string): Promise<PlaylistWithTracks> {
  const playlist = await fetcher<SpotifyPlaylistResponse>(
    `/playlists/${playlistId}?fields=id,name,description,images,collaborative,owner(id,display_name),tracks(total,items(track(id,uri,name,duration_ms,is_local,album(id,name,images),artists(id,name))),next),external_urls`,
  );

  const tracks = await fetchAllPlaylistTracks(fetcher, playlist);

  return {
    summary: toPlaylistSummary(playlist),
    tracks,
  };
}

export async function comparePlaylistsWithFetcher(
  fetcher: SpotifyFetcher,
  playlistAId: string,
  playlistBId: string,
): Promise<PlaylistComparisonPayload> {
  const [playlistAResponse, playlistBResponse] = await Promise.all([
    fetcher<SpotifyPlaylistResponse>(
      `/playlists/${playlistAId}?fields=id,name,description,images,collaborative,owner(id,display_name),tracks(total,items(track(id,uri,name,duration_ms,is_local,album(id,name,images),artists(id,name))),next),external_urls`,
    ),
    fetcher<SpotifyPlaylistResponse>(
      `/playlists/${playlistBId}?fields=id,name,description,images,collaborative,owner(id,display_name),tracks(total,items(track(id,uri,name,duration_ms,is_local,album(id,name,images),artists(id,name))),next),external_urls`,
    ),
  ]);

  const [playlistATracksRaw, playlistBTracksRaw] = await Promise.all([
    fetchAllPlaylistTracks(fetcher, playlistAResponse),
    fetchAllPlaylistTracks(fetcher, playlistBResponse),
  ]);

  const playlistAData: PlaylistWithTracks = {
    summary: toPlaylistSummary(playlistAResponse),
    tracks: playlistATracksRaw,
  };

  const playlistBData: PlaylistWithTracks = {
    summary: toPlaylistSummary(playlistBResponse),
    tracks: playlistBTracksRaw,
  };

  return buildPlaylistComparison(playlistAData, playlistBData);
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  return chunks;
}

export async function addTracksToPlaylist(
  fetcher: SpotifyFetcher,
  playlistId: string,
  uris: string[],
  options?: { startingPosition?: number },
): Promise<{ addedCount: number; addedUris: string[]; addedEntries: { uri: string; position: number }[]; snapshotId: string | null }> {
  if (uris.length === 0) {
    return { addedCount: 0, addedUris: [], addedEntries: [], snapshotId: null };
  }

  const addedUris: string[] = [];
  const addedEntries: { uri: string; position: number }[] = [];
  let snapshotId: string | null = null;
  let nextPosition = typeof options?.startingPosition === "number" ? options.startingPosition : null;

  for (const chunk of chunkArray(uris, 100)) {
    if (chunk.length === 0) {
      continue;
    }

    const response = await fetcher<{ snapshot_id: string }>(`/playlists/${playlistId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ uris: chunk }),
    });

    snapshotId = response.snapshot_id;
    addedUris.push(...chunk);

    if (typeof nextPosition === "number") {
      chunk.forEach((uri, index) => {
        addedEntries.push({ uri, position: nextPosition! + index });
      });
      nextPosition += chunk.length;
    }
  }

  return { addedCount: addedUris.length, addedUris, addedEntries, snapshotId };
}

export async function removeTracksFromPlaylist(
  fetcher: SpotifyFetcher,
  playlistId: string,
  entries: { uri: string; position: number }[],
  options?: { snapshotId?: string },
): Promise<{ removedCount: number; removedUris: string[]; snapshotId: string | null }> {
  if (entries.length === 0) {
    return { removedCount: 0, removedUris: [], snapshotId: options?.snapshotId ?? null };
  }

  const sortedEntries = [...entries].sort((a, b) => a.position - b.position);
  const removedUris: string[] = [];
  let processed = 0;
  let currentSnapshotId = options?.snapshotId ?? null;

  while (processed < sortedEntries.length) {
    const batchEntries = sortedEntries.slice(processed, processed + 100);

    const tracksPayloadMap = new Map<string, number[]>();

    batchEntries.forEach((entry) => {
      const adjustedPosition = entry.position - processed;
      const positions = tracksPayloadMap.get(entry.uri) ?? [];
      positions.push(adjustedPosition);
      tracksPayloadMap.set(entry.uri, positions);
    });

    const tracksPayload = Array.from(tracksPayloadMap.entries()).map(([uri, positions]) => ({
      uri,
      positions: positions.sort((a, b) => a - b),
    }));

    const response = await fetcher<{ snapshot_id: string }>(`/playlists/${playlistId}/tracks`, {
      method: "DELETE",
      body: JSON.stringify({
        tracks: tracksPayload,
        ...(currentSnapshotId ? { snapshot_id: currentSnapshotId } : {}),
      }),
    });

    currentSnapshotId = response.snapshot_id;

    for (const { uri, positions } of tracksPayload) {
      removedUris.push(...Array(positions.length).fill(uri));
    }

    processed += batchEntries.length;
  }

  return { removedCount: removedUris.length, removedUris, snapshotId: currentSnapshotId };
}

export async function getFilteredCandidateUris(
  fetcher: SpotifyFetcher,
  playlistId: string,
  candidateUris: string[],
  options?: { initialPlaylist?: SpotifyPlaylistResponse },
): Promise<string[]> {
  if (candidateUris.length === 0) {
    return [];
  }

  const playlistResponse =
    options?.initialPlaylist ??
    (await fetcher<SpotifyPlaylistResponse>(
      `/playlists/${playlistId}?fields=id,name,description,images,collaborative,owner(id,display_name),tracks(total,items(track(id,uri,name,duration_ms,is_local,album(id,name,images),artists(id,name))),next),external_urls`,
    ));

  const existingTracks = await fetchAllPlaylistTracks(fetcher, playlistResponse);
  const remainingExistingCounts = new Map<string, number>();

  for (const track of existingTracks) {
    remainingExistingCounts.set(track.uri, (remainingExistingCounts.get(track.uri) ?? 0) + 1);
  }

  const filtered: string[] = [];

  for (const uri of candidateUris) {
    const remaining = remainingExistingCounts.get(uri) ?? 0;

    if (remaining > 0) {
      remainingExistingCounts.set(uri, remaining - 1);
      continue;
    }

    filtered.push(uri);
  }

  return filtered;
}
