"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { PlaylistComparison } from "@/lib/spotify/playlists";
import type { PlaylistSummary, SpotifyTrack } from "@/types/spotify";

interface SpotifyUserProfile {
  display_name?: string | null;
  id: string;
  images?: { url: string }[];
}

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

type PlaylistIdentifier = string | null;

function extractPlaylistId(value: string): PlaylistIdentifier {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const urlMatch = trimmed.match(/playlist\/(\w+)/i);

  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }

  const uriMatch = trimmed.match(/spotify:playlist:(\w+)/i);

  if (uriMatch && uriMatch[1]) {
    return uriMatch[1];
  }

  if (/^[a-zA-Z0-9]{16,}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function TrackRow({ track, highlight, badge }: { track: SpotifyTrack; highlight: boolean; badge?: string }) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-md border px-3 py-2 text-sm transition-colors ${
        highlight ? "border-amber-500/40 bg-amber-50" : "border-transparent bg-muted/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-foreground">{track.name}</p>
        {badge ? <span className="rounded bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900">{badge}</span> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {track.artists.map((artist) => artist.name).join(", ")} ? {track.album.name}
      </p>
    </div>
  );
}

interface PlaylistColumnProps {
  title: string;
  playlist?: PlaylistSummary;
  tracks?: SpotifyTrack[];
  missingUris: Set<string>;
  missingLabel: string;
  loading: boolean;
}

function PlaylistColumn({ title, playlist, tracks, missingUris, missingLabel, loading }: PlaylistColumnProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {loading && !playlist ? (
            <Skeleton className="h-4 w-40" />
          ) : playlist ? (
            <span className="flex flex-col gap-1">
              <span className="font-semibold text-foreground">{playlist.name}</span>
              <span className="text-xs text-muted-foreground">{playlist.trackCount} tracks</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Select a playlist to see details</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <ScrollArea className="h-[420px] rounded-md border bg-muted/30 p-3">
          <div className="grid gap-2">
            {loading && !tracks ? (
              Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-14 w-full rounded-md" />)
            ) : tracks && tracks.length > 0 ? (
              tracks.map((track) => (
                <TrackRow
                  key={track.uri}
                  track={track}
                  highlight={missingUris.has(track.uri)}
                  badge={missingUris.has(track.uri) ? missingLabel : undefined}
                />
              ))
            ) : (
              <p className="text-center text-xs text-muted-foreground">No tracks to display.</p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export function PlaylistSync() {
  const [profileState, setProfileState] = useState<FetchState<SpotifyUserProfile>>({
    data: null,
    loading: true,
    error: null,
  });
  const [playlistState, setPlaylistState] = useState<FetchState<PlaylistSummary[]>>({
    data: null,
    loading: true,
    error: null,
  });
  const [sourceSelection, setSourceSelection] = useState<string>("");
  const [targetSelection, setTargetSelection] = useState<string>("");
  const [sourceInput, setSourceInput] = useState<string>("");
  const [targetInput, setTargetInput] = useState<string>("");
  const [comparison, setComparison] = useState<PlaylistComparison | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [twoWaySync, setTwoWaySync] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const fetchProfileAndPlaylists = useCallback(async () => {
    setProfileState((prev) => ({ ...prev, loading: true, error: null }));
    setPlaylistState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const [profileRes, playlistsRes] = await Promise.all([
        fetch("/api/spotify/me", { credentials: "include" }),
        fetch("/api/spotify/playlists", { credentials: "include" }),
      ]);

      if (profileRes.status === 401 || playlistsRes.status === 401) {
        throw new Error("Your session has expired. Please log in again.");
      }

      if (!profileRes.ok) {
        throw new Error("Failed to fetch profile details.");
      }

      if (!playlistsRes.ok) {
        throw new Error("Failed to fetch playlists.");
      }

      const profileJson = (await profileRes.json()) as SpotifyUserProfile;
      const playlistsJson = (await playlistsRes.json()) as { playlists: PlaylistSummary[] };

      setProfileState({ data: profileJson, loading: false, error: null });
      setPlaylistState({ data: playlistsJson.playlists, loading: false, error: null });
    } catch (error) {
      console.error(error);
      setProfileState({ data: null, loading: false, error: error instanceof Error ? error.message : "Failed to load profile." });
      setPlaylistState({ data: null, loading: false, error: error instanceof Error ? error.message : "Failed to load playlists." });
    }
  }, []);

  useEffect(() => {
    void fetchProfileAndPlaylists();
  }, [fetchProfileAndPlaylists]);

  const resolvePlaylistId = useCallback(
    (selection: string, inputValue: string): PlaylistIdentifier => {
      if (selection) {
        return selection;
      }

      return extractPlaylistId(inputValue);
    },
    [],
  );

  const handleCompare = useCallback(async () => {
    const sourceId = resolvePlaylistId(sourceSelection, sourceInput);
    const targetId = resolvePlaylistId(targetSelection, targetInput);

    if (!sourceId || !targetId) {
      setActionMessage({ type: "error", message: "Please choose or paste valid playlist IDs for both sides." });
      return;
    }

    setIsComparing(true);
    setActionMessage(null);

    try {
      const response = await fetch("/api/spotify/compare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ sourcePlaylistId: sourceId, targetPlaylistId: targetId }),
      });

      if (response.status === 401) {
        throw new Error("Your session has expired. Please log in again.");
      }

      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error ?? "Failed to compare playlists.");
      }

      const comparisonJson = (await response.json()) as PlaylistComparison;
      setComparison(comparisonJson);
      setActionMessage({ type: "success", message: "Comparison complete." });
    } catch (error) {
      console.error(error);
      setActionMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to compare playlists." });
    } finally {
      setIsComparing(false);
    }
  }, [resolvePlaylistId, sourceSelection, sourceInput, targetSelection, targetInput]);

  const handleSync = useCallback(async () => {
    if (!comparison) {
      setActionMessage({ type: "error", message: "Compare playlists before syncing." });
      return;
    }

    const sourceId = resolvePlaylistId(sourceSelection, sourceInput);
    const targetId = resolvePlaylistId(targetSelection, targetInput);

    if (!sourceId || !targetId) {
      setActionMessage({ type: "error", message: "Missing playlist IDs." });
      return;
    }

    setIsSyncing(true);
    setActionMessage(null);

    try {
      const response = await fetch("/api/spotify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sourcePlaylistId: sourceId, targetPlaylistId: targetId, twoWay: twoWaySync }),
      });

      if (response.status === 401) {
        throw new Error("Your session has expired. Please log in again.");
      }

      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error ?? "Failed to sync playlists.");
      }

      const result = await response.json();
      setComparison(result.comparison as PlaylistComparison);
      setActionMessage({
        type: "success",
        message: twoWaySync
          ? `Sync complete. Added ${result.addedToTarget} tracks to target and ${result.addedToSource} to source.`
          : `Sync complete. Added ${result.addedToTarget} tracks to target playlist.`,
      });
    } catch (error) {
      console.error(error);
      setActionMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to sync playlists." });
    } finally {
      setIsSyncing(false);
    }
  }, [comparison, resolvePlaylistId, sourceSelection, sourceInput, targetSelection, targetInput, twoWaySync]);

  const sourceMissingUris = useMemo(
    () => new Set(comparison?.missingInSource.map((track) => track.uri) ?? []),
    [comparison],
  );
  const targetMissingUris = useMemo(
    () => new Set(comparison?.missingInTarget.map((track) => track.uri) ?? []),
    [comparison],
  );

  const hasMissingTracks = (comparison?.missingInTarget.length ?? 0) > 0 || (comparison?.missingInSource.length ?? 0) > 0;

  const disableSyncButton = !comparison || (!twoWaySync && (comparison?.missingInTarget.length ?? 0) === 0) || (twoWaySync && !hasMissingTracks);
  const loadError = profileState.error ?? playlistState.error;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-foreground">Minkyu Spotify</h1>
        <p className="text-sm text-muted-foreground">
          Sync playlists effortlessly. Compare track lists, find missing records, and keep your collections aligned.
        </p>
        {profileState.data ? (
          <p className="text-sm text-muted-foreground">
            Logged in as <span className="font-medium text-foreground">{profileState.data.display_name ?? profileState.data.id}</span>
          </p>
        ) : null}
      </header>

      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>We hit a snag</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      {actionMessage ? (
        <Alert variant={actionMessage.type === "error" ? "destructive" : "default"}>
          <AlertTitle>{actionMessage.type === "error" ? "Something went wrong" : "All set"}</AlertTitle>
          <AlertDescription>{actionMessage.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 rounded-lg border bg-card p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Source playlist</label>
            <Select value={sourceSelection} onValueChange={setSourceSelection}>
              <SelectTrigger>
                <SelectValue placeholder={playlistState.loading ? "Loading playlists..." : "Choose source playlist"} />
              </SelectTrigger>
              <SelectContent>
                {playlistState.data?.map((playlist) => (
                  <SelectItem key={playlist.id} value={playlist.id}>
                    {playlist.name} ({playlist.trackCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Or paste a playlist URL or ID"
              value={sourceInput}
              onChange={(event) => setSourceInput(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Target playlist</label>
            <Select value={targetSelection} onValueChange={setTargetSelection}>
              <SelectTrigger>
                <SelectValue placeholder={playlistState.loading ? "Loading playlists..." : "Choose target playlist"} />
              </SelectTrigger>
              <SelectContent>
                {playlistState.data?.map((playlist) => (
                  <SelectItem key={playlist.id} value={playlist.id}>
                    {playlist.name} ({playlist.trackCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Or paste a playlist URL or ID"
              value={targetInput}
              onChange={(event) => setTargetInput(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-md bg-muted/50 p-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <Switch id="two-way-sync" checked={twoWaySync} onCheckedChange={setTwoWaySync} />
            <label htmlFor="two-way-sync" className="text-sm text-foreground">
              Two-way sync (add missing tracks to both playlists)
            </label>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={handleCompare} disabled={isComparing || playlistState.loading}>
              {isComparing ? "Comparing..." : "Compare playlists"}
            </Button>
            <Button variant="secondary" onClick={handleSync} disabled={disableSyncButton || isSyncing}>
              {isSyncing ? "Syncing..." : "Sync missing tracks"}
            </Button>
          </div>
        </div>
      </div>

      {comparison ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-lg">Comparison results</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              {comparison.missingInTarget.length === 0 && comparison.missingInSource.length === 0
                ? "Playlists are already in sync."
                : `Missing ${comparison.missingInTarget.length} track(s) in target and ${comparison.missingInSource.length} in source.`}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <PlaylistColumn
          title="Source playlist"
          playlist={comparison?.source.summary}
          tracks={comparison?.source.tracks}
          missingUris={targetMissingUris}
          missingLabel="Missing in target"
          loading={isComparing || playlistState.loading}
        />
        <PlaylistColumn
          title="Target playlist"
          playlist={comparison?.target.summary}
          tracks={comparison?.target.tracks}
          missingUris={sourceMissingUris}
          missingLabel="Missing in source"
          loading={isComparing || playlistState.loading}
        />
      </div>
    </section>
  );
}
