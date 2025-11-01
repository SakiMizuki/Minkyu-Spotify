import type { PlaylistSummary, PlaylistWithTracks, SpotifyTrack } from "@/types/spotify";
import type { SpotifyFetcher } from "@/lib/spotify/client";

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

export interface SpotifyPlaylistResponse extends SpotifyPlaylistItem {
  tracks: {
    items: SpotifyPlaylistTrackItem[];
    next: string | null;
    total: number;
  };
}

export type TrackPresence = "uniqueToA" | "uniqueToB" | "common";

export interface ComparableTrack {
  uri: string;
  name: string;
  artists: string[];
  durationMs: number;
  imageUrl: string | null;
}

export interface PlaylistTrackWithPresence extends ComparableTrack {
  presence: TrackPresence;
}

export interface PlaylistComparisonPayload {
  playlistA: {
    summary: PlaylistSummary;
    tracks: PlaylistTrackWithPresence[];
  };
  playlistB: {
    summary: PlaylistSummary;
    tracks: PlaylistTrackWithPresence[];
  };
  inAOnly: ComparableTrack[];
  inBOnly: ComparableTrack[];
  inBoth: ComparableTrack[];
}

function toPlaylistSummary(playlist: SpotifyPlaylistItem, currentUserId?: string): PlaylistSummary {
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

function toSpotifyTrack(item: SpotifyPlaylistTrackItem): SpotifyTrack | undefined {
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

function toComparableTrack(track: SpotifyTrack): ComparableTrack {
  return {
    uri: track.uri,
    name: track.name,
    artists: track.artists.map((artist) => artist.name),
    durationMs: track.duration_ms,
    imageUrl: track.album.images.at(0)?.url ?? null,
  };
}

function createPresenceTrack(track: ComparableTrack, presence: TrackPresence): PlaylistTrackWithPresence {
  return {
    ...track,
    presence,
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

  const playlistATracks = playlistATracksRaw.map(toComparableTrack);
  const playlistBTracks = playlistBTracksRaw.map(toComparableTrack);

  const playlistBUriSet = new Set(playlistBTracks.map((track) => track.uri));
  const playlistAUriSet = new Set(playlistATracks.map((track) => track.uri));

  const inAOnly: ComparableTrack[] = [];
  const inBOnly: ComparableTrack[] = [];
  const inBoth: ComparableTrack[] = [];

  const seenUniqueA = new Set<string>();
  const seenUniqueB = new Set<string>();
  const seenCommon = new Set<string>();

  const playlistATracksWithPresence = playlistATracks.map((track) => {
    const presence: TrackPresence = playlistBUriSet.has(track.uri) ? "common" : "uniqueToA";

    if (presence === "common" && !seenCommon.has(track.uri)) {
      inBoth.push(track);
      seenCommon.add(track.uri);
    }

    if (presence === "uniqueToA" && !seenUniqueA.has(track.uri)) {
      inAOnly.push(track);
      seenUniqueA.add(track.uri);
    }

    return createPresenceTrack(track, presence);
  });

  const playlistBTracksWithPresence = playlistBTracks.map((track) => {
    const presence: TrackPresence = playlistAUriSet.has(track.uri) ? "common" : "uniqueToB";

    if (presence === "uniqueToB" && !seenUniqueB.has(track.uri)) {
      inBOnly.push(track);
      seenUniqueB.add(track.uri);
    }

    if (presence === "common" && !seenCommon.has(track.uri)) {
      inBoth.push(track);
      seenCommon.add(track.uri);
    }

    return createPresenceTrack(track, presence);
  });

  return {
    playlistA: {
      summary: toPlaylistSummary(playlistAResponse),
      tracks: playlistATracksWithPresence,
    },
    playlistB: {
      summary: toPlaylistSummary(playlistBResponse),
      tracks: playlistBTracksWithPresence,
    },
    inAOnly,
    inBOnly,
    inBoth,
  };
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
): Promise<{ addedCount: number; addedUris: string[] }> {
  const uniqueUris = Array.from(new Set(uris));

  if (uniqueUris.length === 0) {
    return { addedCount: 0, addedUris: [] };
  }

  const addedUris: string[] = [];

  for (const chunk of chunkArray(uniqueUris, 100)) {
    if (chunk.length === 0) {
      continue;
    }

    await fetcher<{ snapshot_id: string }>(`/playlists/${playlistId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ uris: chunk }),
    });

    addedUris.push(...chunk);
  }

  return { addedCount: addedUris.length, addedUris };
}

export async function removeTracksFromPlaylist(
  fetcher: SpotifyFetcher,
  playlistId: string,
  uris: string[],
): Promise<{ removedCount: number; removedUris: string[] }> {
  const uniqueUris = Array.from(new Set(uris));

  if (uniqueUris.length === 0) {
    return { removedCount: 0, removedUris: [] };
  }

  const removedUris: string[] = [];

  for (const chunk of chunkArray(uniqueUris, 100)) {
    if (chunk.length === 0) {
      continue;
    }

    await fetcher<{ snapshot_id: string }>(`/playlists/${playlistId}/tracks`, {
      method: "DELETE",
      body: JSON.stringify({
        tracks: chunk.map((uri) => ({ uri })),
      }),
    });

    removedUris.push(...chunk);
  }

  return { removedCount: removedUris.length, removedUris };
}

export async function getFilteredCandidateUris(
  fetcher: SpotifyFetcher,
  playlistId: string,
  candidateUris: string[],
  options?: { initialPlaylist?: SpotifyPlaylistResponse },
): Promise<string[]> {
  const uniqueCandidates = Array.from(new Set(candidateUris));

  if (uniqueCandidates.length === 0) {
    return [];
  }

  const playlistResponse =
    options?.initialPlaylist ??
    (await fetcher<SpotifyPlaylistResponse>(
      `/playlists/${playlistId}?fields=id,name,description,images,collaborative,owner(id,display_name),tracks(total,items(track(id,uri,name,duration_ms,is_local,album(id,name,images),artists(id,name))),next),external_urls`,
    ));

  const existingTracks = await fetchAllPlaylistTracks(fetcher, playlistResponse);
  const existingUris = new Set(existingTracks.map((track) => track.uri));

  return uniqueCandidates.filter((uri) => !existingUris.has(uri));
}
