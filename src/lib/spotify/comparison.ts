import type { PlaylistSummary, PlaylistWithTracks, SpotifyTrack } from "@/types/spotify";

export type TrackPresence = "uniqueToA" | "uniqueToB" | "common";

export interface ComparableTrack {
  instanceId: string;
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

export function toComparableTrack(track: SpotifyTrack, instanceId: string): ComparableTrack {
  return {
    instanceId,
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

export function buildPlaylistComparison(
  playlistA: PlaylistWithTracks,
  playlistB: PlaylistWithTracks,
): PlaylistComparisonPayload {
  const playlistATracks = playlistA.tracks.map((track, index) => toComparableTrack(track, `A-${index}`));
  const playlistBTracks = playlistB.tracks.map((track, index) => toComparableTrack(track, `B-${index}`));

  const playlistBRemainingCounts = new Map<string, number>();
  for (const track of playlistBTracks) {
    playlistBRemainingCounts.set(track.uri, (playlistBRemainingCounts.get(track.uri) ?? 0) + 1);
  }

  const matchedOccurrencesInB = new Map<string, number>();

  const inAOnly: ComparableTrack[] = [];
  const inBOnly: ComparableTrack[] = [];
  const inBoth: ComparableTrack[] = [];

  const playlistATracksWithPresence = playlistATracks.map((track) => {
    const remaining = playlistBRemainingCounts.get(track.uri) ?? 0;

    if (remaining > 0) {
      playlistBRemainingCounts.set(track.uri, remaining - 1);
      matchedOccurrencesInB.set(track.uri, (matchedOccurrencesInB.get(track.uri) ?? 0) + 1);
      inBoth.push(track);
      return createPresenceTrack(track, "common");
    }

    inAOnly.push(track);
    return createPresenceTrack(track, "uniqueToA");
  });

  const usedCommonInB = new Map<string, number>();

  const playlistBTracksWithPresence = playlistBTracks.map((track) => {
    const totalCommon = matchedOccurrencesInB.get(track.uri) ?? 0;
    const usedSoFar = usedCommonInB.get(track.uri) ?? 0;

    if (usedSoFar < totalCommon) {
      usedCommonInB.set(track.uri, usedSoFar + 1);
      return createPresenceTrack(track, "common");
    }

    inBOnly.push(track);
    return createPresenceTrack(track, "uniqueToB");
  });

  return {
    playlistA: {
      summary: playlistA.summary,
      tracks: playlistATracksWithPresence,
    },
    playlistB: {
      summary: playlistB.summary,
      tracks: playlistBTracksWithPresence,
    },
    inAOnly,
    inBOnly,
    inBoth,
  };
}
