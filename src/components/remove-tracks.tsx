"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlaylistSummary } from "@/types/spotify";

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface SelectablePlaylistTrack {
  instanceId: string;
  uri: string;
  position: number;
  name: string;
  artists: string[];
  albumName: string;
  albumImageUrl: string | null;
  durationMs: number;
}

interface PlaylistTracksLoadState {
  playlistId: string | null;
  summary: PlaylistSummary | null;
  tracks: SelectablePlaylistTrack[];
  loadedCount: number;
  totalCount: number;
  isLoading: boolean;
  error: string | null;
}

interface RemovalActionMessage {
  type: "success" | "error";
  message: string;
}

interface PlaylistTracksPageResponse {
  summary: PlaylistSummary | null;
  tracks: {
    id: string | null;
    uri: string;
    name: string;
    duration_ms: number;
    artists: { name: string }[];
    album: { name: string; images: { url: string }[] };
  }[];
  offset: number;
  limit: number;
  total: number;
  loaded: number;
  nextOffset: number | null;
}

function createInitialLoadState(): PlaylistTracksLoadState {
  return {
    playlistId: null,
    summary: null,
    tracks: [],
    loadedCount: 0,
    totalCount: 0,
    isLoading: false,
    error: null,
  };
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatProgress(state: PlaylistTracksLoadState): string | null {
  if (!state.isLoading) {
    return null;
  }

  if (state.totalCount > 0) {
    return `Loading... ${state.loadedCount}/${state.totalCount}`;
  }

  return `Loading... ${state.loadedCount}+`;
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text();

  try {
    const data = JSON.parse(text) as { error?: unknown; details?: unknown; action?: unknown } | undefined;

    if (data) {
      if (typeof data.action === "string" && data.action.trim().length > 0) {
        return data.action;
      }

      if (typeof data.error === "string" && data.error.trim().length > 0) {
        return data.error;
      }

      if (typeof data.details === "string" && data.details.trim().length > 0) {
        return data.details;
      }
    }
  } catch {
    if (text.trim().length > 0) {
      return text;
    }
  }

  return fallback;
}

function toTrackInstance(track: PlaylistTracksPageResponse["tracks"][number], position: number): SelectablePlaylistTrack {
  const artists = Array.isArray(track.artists) ? track.artists.map((artist) => artist?.name ?? "Unknown artist") : [];
  const albumImages = Array.isArray(track.album?.images) ? track.album.images : [];

  return {
    instanceId: `${track.uri}-${position}`,
    uri: track.uri,
    position,
    name: track.name,
    artists,
    albumName: track.album?.name ?? "Unknown album",
    albumImageUrl: albumImages.at(0)?.url ?? null,
    durationMs: track.duration_ms,
  };
}

interface RemoveTrackRowProps {
  track: SelectablePlaylistTrack;
  isChecked: boolean;
  onToggle: (instanceId: string) => void;
}

function RemoveTrackRow({ track, isChecked, onToggle }: RemoveTrackRowProps) {
  return (
    <label className="flex flex-col gap-3 rounded-2xl border border-muted/40 bg-card p-4 shadow-sm transition-colors sm:flex-row sm:items-center sm:gap-4">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          className="h-6 w-6 flex-shrink-0 rounded-md border-2 border-primary text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          checked={isChecked}
          onChange={() => onToggle(track.instanceId)}
        />
        <div className="h-16 w-16 overflow-hidden rounded-xl bg-muted">
          {track.albumImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={track.albumImageUrl} alt={`${track.albumName} cover`} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">No art</div>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex flex-1 flex-col gap-1">
          <p className="text-sm font-medium text-foreground sm:text-base">{track.name}</p>
          <p className="text-xs text-muted-foreground sm:text-sm">{track.artists.join(", ")}</p>
          <p className="text-xs text-muted-foreground">Album: {track.albumName}</p>
        </div>
        <span className="text-xs font-medium text-muted-foreground sm:self-start">{formatDuration(track.durationMs)}</span>
      </div>
    </label>
  );
}

export function RemoveTracks() {
  const [playlistsState, setPlaylistsState] = useState<FetchState<PlaylistSummary[]>>({
    data: null,
    loading: true,
    error: null,
  });
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>("");
  const [tracksState, setTracksState] = useState<PlaylistTracksLoadState>(createInitialLoadState);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [actionMessage, setActionMessage] = useState<RemovalActionMessage | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const requestTokenRef = useRef(0);

  const editablePlaylists = useMemo(
    () => playlistsState.data?.filter((playlist) => playlist.isEditable) ?? [],
    [playlistsState.data],
  );

  const playlistOptionsAvailable = editablePlaylists.length > 0;

  const tracksMap = useMemo(() => {
    return new Map(tracksState.tracks.map((track) => [track.instanceId, track]));
  }, [tracksState.tracks]);

  const selectedCount = selectedTrackIds.size;
  const allSelected = tracksState.tracks.length > 0 && selectedCount === tracksState.tracks.length;
  const progressText = formatProgress(tracksState);

  const fetchPlaylists = useCallback(async () => {
    setPlaylistsState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fetch("/api/spotify/playlists", { credentials: "include" });

      if (response.status === 401) {
        throw new Error("Your session has expired. Please log in again.");
      }

      if (!response.ok) {
        const message = await parseErrorMessage(response, "Failed to load playlists.");
        throw new Error(message);
      }

      const payload = (await response.json()) as { playlists: PlaylistSummary[] };
      setPlaylistsState({ data: payload.playlists, loading: false, error: null });
    } catch (error) {
      console.error(error);
      setPlaylistsState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load playlists.",
      });
    }
  }, []);

  useEffect(() => {
    void fetchPlaylists();
  }, [fetchPlaylists]);

  const loadPlaylistTracks = useCallback(
    async (playlistId: string) => {
      requestTokenRef.current += 1;
      const token = requestTokenRef.current;

      setTracksState((prev) => ({
        playlistId,
        summary: prev.playlistId === playlistId ? prev.summary : null,
        tracks: [],
        loadedCount: 0,
        totalCount: 0,
        isLoading: true,
        error: null,
      }));

      const aggregated: SelectablePlaylistTrack[] = [];
      let summary: PlaylistSummary | null = null;
      let total = 0;
      let nextOffset: number | null = 0;
      let currentOffset = 0;

      try {
        do {
          const response = await fetch(
            `/api/spotify/playlists/${playlistId}/tracks?offset=${currentOffset}&limit=100`,
            { credentials: "include" },
          );

          if (response.status === 401) {
            throw new Error("Your session has expired. Please log in again.");
          }

          if (!response.ok) {
            const message = await parseErrorMessage(response, "Failed to load playlist tracks.");
            throw new Error(message);
          }

          const payload = (await response.json()) as PlaylistTracksPageResponse;
          const pageOffset = typeof payload.offset === "number" ? payload.offset : currentOffset;

          if (!summary && payload.summary) {
            summary = payload.summary;
          }

          total = typeof payload.total === "number" ? payload.total : total;

          const pageTracks = Array.isArray(payload.tracks) ? payload.tracks : [];

          pageTracks.forEach((track, index) => {
            aggregated.push(toTrackInstance(track, pageOffset + index));
          });

          nextOffset = payload.nextOffset;
          currentOffset = typeof payload.nextOffset === "number" ? payload.nextOffset : pageOffset + pageTracks.length;

          setTracksState((prev) => {
            if (requestTokenRef.current !== token) {
              return prev;
            }

            return {
              playlistId,
              summary: summary ?? prev.summary,
              tracks: [...aggregated],
              loadedCount: aggregated.length,
              totalCount: total,
              isLoading: typeof nextOffset === "number",
              error: null,
            };
          });
        } while (typeof nextOffset === "number");

        if (requestTokenRef.current !== token) {
          return;
        }

        if (!summary) {
          throw new Error("Failed to load playlist details.");
        }

        setTracksState({
          playlistId,
          summary,
          tracks: [...aggregated],
          loadedCount: aggregated.length,
          totalCount: total,
          isLoading: false,
          error: null,
        });
      } catch (error) {
        if (requestTokenRef.current !== token) {
          return;
        }

        const message = error instanceof Error ? error.message : "Failed to load playlist tracks.";

        setTracksState((prev) => ({
          ...prev,
          playlistId,
          isLoading: false,
          error: message,
        }));

        throw error;
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectedPlaylistId) {
      setTracksState(createInitialLoadState());
      setSelectedTrackIds(new Set());
      return;
    }

    setSelectedTrackIds(new Set());
    setActionMessage(null);

    void (async () => {
      try {
        await loadPlaylistTracks(selectedPlaylistId);
      } catch (error) {
        console.error(error);
      }
    })();
  }, [loadPlaylistTracks, selectedPlaylistId]);

  const handleToggleTrack = useCallback((instanceId: string) => {
    setSelectedTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    if (tracksState.tracks.length === 0) {
      return;
    }

    if (allSelected) {
      setSelectedTrackIds(new Set());
    } else {
      setSelectedTrackIds(new Set(tracksState.tracks.map((track) => track.instanceId)));
    }
  }, [allSelected, tracksState.tracks]);

  const handleRemoveSelected = useCallback(async () => {
    if (!selectedPlaylistId) {
      setActionMessage({ type: "error", message: "Choose a playlist first." });
      return;
    }

    if (selectedTrackIds.size === 0) {
      setActionMessage({ type: "error", message: "Select at least one track to remove." });
      return;
    }

    const entries = Array.from(selectedTrackIds)
      .map((instanceId) => tracksMap.get(instanceId))
      .filter((track): track is SelectablePlaylistTrack => Boolean(track))
      .map((track) => ({ uri: track.uri, position: track.position }));

    if (entries.length === 0) {
      setActionMessage({ type: "error", message: "Unable to resolve the selected tracks." });
      return;
    }

    const shouldRemove = window.confirm(`Remove ${entries.length} track${entries.length === 1 ? "" : "s"} from this playlist?`);

    if (!shouldRemove) {
      return;
    }

    setIsRemoving(true);
    setActionMessage(null);

    try {
      const response = await fetch("/api/spotify/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ playlistId: selectedPlaylistId, entries }),
      });

      if (response.status === 401) {
        throw new Error("Your session has expired. Please log in again.");
      }

      if (!response.ok) {
        const message = await parseErrorMessage(response, "Failed to remove tracks.");
        throw new Error(message);
      }

      const payload = (await response.json()) as { removedCount: number; removedUris: string[] };
      const removedCount = payload.removedCount ?? entries.length;

      setActionMessage({
        type: "success",
        message: `Removed ${removedCount} track${removedCount === 1 ? "" : "s"} from the playlist.`,
      });

      setSelectedTrackIds(new Set());
      await loadPlaylistTracks(selectedPlaylistId);
    } catch (error) {
      console.error(error);
      setActionMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to remove tracks.",
      });
    } finally {
      setIsRemoving(false);
    }
  }, [loadPlaylistTracks, selectedPlaylistId, selectedTrackIds, tracksMap]);

  return (
    <section className="flex flex-col gap-6 pb-24">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold text-foreground">Manage playlist tracks</h1>
        <p className="text-sm text-muted-foreground">
          Remove songs from your playlists with quick bulk actions. Pick a playlist, select the tracks you no longer need, and remove
          them in one tap.
        </p>
        <Button asChild variant="ghost" className="w-full sm:w-auto">
          <Link href="/">Back to compare</Link>
        </Button>
      </header>

      {playlistsState.error ? (
        <Alert variant="destructive">
          <AlertTitle>We couldn&rsquo;t load playlists</AlertTitle>
          <AlertDescription>{playlistsState.error}</AlertDescription>
        </Alert>
      ) : null}

      {actionMessage ? (
        <Alert variant={actionMessage.type === "error" ? "destructive" : "default"}>
          <AlertTitle>{actionMessage.type === "error" ? "Something went wrong" : "All set"}</AlertTitle>
          <AlertDescription>{actionMessage.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>Select a playlist</CardTitle>
          <CardDescription>
            {playlistsState.loading
              ? "Loading your playlists..."
              : playlistOptionsAvailable
                ? "Choose a playlist you own or can edit."
                : "No editable playlists available. Create one or ask the owner to grant edit access."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {playlistsState.loading ? (
            <Skeleton className="h-11 w-full rounded-xl" />
          ) : playlistOptionsAvailable ? (
            <Select value={selectedPlaylistId} onValueChange={setSelectedPlaylistId}>
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue placeholder="Choose a playlist" />
              </SelectTrigger>
              <SelectContent>
                {editablePlaylists.map((playlist) => (
                  <SelectItem key={playlist.id} value={playlist.id}>
                    {playlist.name} ({playlist.trackCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </CardContent>
      </Card>

      {selectedPlaylistId ? (
        <Card className="border">
          <CardHeader className="gap-2">
            <CardTitle>{tracksState.summary?.name ?? "Playlist tracks"}</CardTitle>
            <CardDescription>
              {tracksState.summary ? (
                <span className="flex flex-col gap-1">
                  <span className="font-medium text-foreground">{tracksState.summary.trackCount} tracks</span>
                  {progressText ? <span className="text-xs text-muted-foreground">{progressText}</span> : null}
                </span>
              ) : progressText ? (
                <span className="text-xs text-muted-foreground">{progressText}</span>
              ) : (
                <span className="text-xs text-muted-foreground">Tracks will appear here once loaded.</span>
              )}
              {tracksState.error ? (
                <span className="mt-1 block text-xs text-destructive">{tracksState.error}</span>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <Button
                type="button"
                variant="outline"
                className="h-12 flex-1 text-sm sm:text-base"
                onClick={handleToggleSelectAll}
                disabled={tracksState.tracks.length === 0 || tracksState.isLoading}
              >
                {allSelected ? "Deselect All" : "Select All"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="h-12 flex-1 text-sm sm:text-base"
                onClick={handleRemoveSelected}
                disabled={selectedCount === 0 || isRemoving || tracksState.isLoading}
              >
                {isRemoving ? "Removing..." : `Remove Selected (${selectedCount})`}
              </Button>
            </div>

            <div className="rounded-2xl border bg-muted/20 p-3">
              <ScrollArea className="h-[460px] pr-3">
                <div className="flex flex-col gap-3">
                  {tracksState.isLoading && tracksState.tracks.length === 0 ? (
                    Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-24 w-full rounded-2xl" />)
                  ) : tracksState.tracks.length > 0 ? (
                    tracksState.tracks.map((track) => (
                      <RemoveTrackRow
                        key={track.instanceId}
                        track={track}
                        isChecked={selectedTrackIds.has(track.instanceId)}
                        onToggle={handleToggleTrack}
                      />
                    ))
                  ) : (
                    <p className="text-center text-xs text-muted-foreground">
                      {tracksState.error ? "We couldn\'t load tracks for this playlist." : "No tracks available."}
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
