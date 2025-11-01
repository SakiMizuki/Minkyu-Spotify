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
import type {
  ComparableTrack,
  PlaylistComparisonPayload,
  PlaylistTrackWithPresence,
  TrackPresence,
} from "@/lib/spotify/playlists";
import type { PlaylistSummary } from "@/types/spotify";

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

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

interface PlaylistTrackRowProps {
  track: PlaylistTrackWithPresence;
  highlightPresence?: TrackPresence | null;
  selectablePresence: TrackPresence | null;
  selectedUris: Set<string>;
  onToggle: (uri: string) => void;
}

function PlaylistTrackRow({
  track,
  highlightPresence = null,
  selectablePresence,
  selectedUris,
  onToggle,
}: PlaylistTrackRowProps) {
  const isHighlight = highlightPresence ? track.presence === highlightPresence : false;
  const isSelectable = selectablePresence ? track.presence === selectablePresence : false;
  const isChecked = isSelectable ? selectedUris.has(track.uri) : false;

  return (
    <label
      className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-sm shadow-sm transition-colors ${
        isHighlight
          ? "border-amber-400/60 bg-amber-50"
          : track.presence === "common"
            ? "border-transparent bg-muted/30"
            : "border-sky-400/40 bg-sky-50"
      }`}
    >
      {isSelectable ? (
        <input
          type="checkbox"
          className="h-6 w-6 flex-shrink-0 rounded-md border-2 border-primary text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          checked={isChecked}
          onChange={() => onToggle(track.uri)}
        />
      ) : (
        <span className="h-6 w-6 flex-shrink-0" aria-hidden="true" />
      )}

      <div className="flex flex-1 flex-col gap-1">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
          <p className="font-medium text-foreground">{track.name}</p>
          <span className="text-xs text-muted-foreground">{formatDuration(track.durationMs)}</span>
        </div>
        <p className="text-xs text-muted-foreground">{track.artists.join(", ")}</p>
      </div>

      {isHighlight ? (
        <span className="whitespace-nowrap rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
          Missing
        </span>
      ) : track.presence !== "common" ? (
        <span className="whitespace-nowrap rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-900">
          Extra
        </span>
      ) : null}
    </label>
  );
}

interface PlaylistColumnProps {
  label: string;
  summary?: PlaylistSummary;
  tracks?: PlaylistTrackWithPresence[];
  loading: boolean;
  highlightPresence?: TrackPresence | null;
  selectablePresence: TrackPresence | null;
  selectedUris: Set<string>;
  onToggle: (uri: string) => void;
}

function PlaylistColumn({
  label,
  summary,
  tracks,
  loading,
  highlightPresence,
  selectablePresence,
  selectedUris,
  onToggle,
}: PlaylistColumnProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="gap-2">
        <CardTitle>{label}</CardTitle>
        <CardDescription>
          {loading && !summary ? (
            <Skeleton className="h-4 w-40" />
          ) : summary ? (
            <span className="flex flex-col gap-1">
              <span className="font-semibold text-foreground">{summary.name}</span>
              <span className="text-xs text-muted-foreground">{summary.trackCount} tracks</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Select a playlist to see details</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <ScrollArea className="h-[420px] rounded-xl border bg-muted/20 p-3">
          <div className="flex flex-col gap-3">
            {loading && !tracks ? (
              Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-20 w-full rounded-xl" />)
            ) : tracks && tracks.length > 0 ? (
              tracks.map((track) => (
                <PlaylistTrackRow
                  key={track.uri}
                  track={track}
                  highlightPresence={highlightPresence}
                  selectablePresence={selectablePresence}
                  selectedUris={selectedUris}
                  onToggle={onToggle}
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

interface PreviewModalProps {
  open: boolean;
  tracks: ComparableTrack[];
  onCancel: () => void;
  onConfirm: () => void;
  isSyncing: boolean;
}

function PreviewModal({ open, tracks, onCancel, onConfirm, isSyncing }: PreviewModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-6 pt-12 sm:items-center">
      <div className="w-full max-w-lg rounded-3xl bg-card p-6 shadow-2xl">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">Preview sync</h2>
          <p className="text-sm text-muted-foreground">Review the tracks that will be added before you continue.</p>
        </div>
        <div className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">
          {tracks.map((track) => (
            <div key={track.uri} className="rounded-2xl border border-muted-foreground/10 bg-muted/30 px-3 py-2 text-sm">
              <p className="font-medium text-foreground">{track.name}</p>
              <p className="text-xs text-muted-foreground">{track.artists.join(", ")}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={onCancel} disabled={isSyncing}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isSyncing}>
            {isSyncing ? "Syncing..." : `Confirm (${tracks.length})`}
          </Button>
        </div>
      </div>
    </div>
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
  const [playlistASelection, setPlaylistASelection] = useState<string>("");
  const [playlistBSelection, setPlaylistBSelection] = useState<string>("");
  const [playlistAInput, setPlaylistAInput] = useState<string>("");
  const [playlistBInput, setPlaylistBInput] = useState<string>("");
  const [comparison, setComparison] = useState<PlaylistComparisonPayload | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isSwapActive, setIsSwapActive] = useState(false);
  const [selectedUris, setSelectedUris] = useState<Set<string>>(new Set());
  const [lastPair, setLastPair] = useState<{ playlistAId: string; playlistBId: string } | null>(null);
  const [lastUndo, setLastUndo] = useState<{ targetPlaylistId: string; undoToken: string } | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const editablePlaylists = useMemo(
    () => playlistState.data?.filter((playlist) => playlist.isEditable) ?? [],
    [playlistState.data],
  );

  useEffect(() => {
    if (!playlistBSelection) {
      return;
    }

    const stillEditable = editablePlaylists.some((playlist) => playlist.id === playlistBSelection);

    if (!stillEditable) {
      setPlaylistBSelection("");
    }
  }, [editablePlaylists, playlistBSelection]);

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
      setProfileState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load profile.",
      });
      setPlaylistState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load playlists.",
      });
    }
  }, []);

  useEffect(() => {
    void fetchProfileAndPlaylists();
  }, [fetchProfileAndPlaylists]);

  const resolvePlaylistId = useCallback((selection: string, inputValue: string): PlaylistIdentifier => {
    if (selection) {
      return selection;
    }

    return extractPlaylistId(inputValue);
  }, []);

  const fetchComparison = useCallback(async (playlistAId: string, playlistBId: string) => {
    const response = await fetch("/api/spotify/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ sourcePlaylistId: playlistAId, targetPlaylistId: playlistBId }),
    });

    if (response.status === 401) {
      throw new Error("Your session has expired. Please log in again.");
    }

    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.error ?? "Failed to compare playlists.");
    }

    return (await response.json()) as PlaylistComparisonPayload;
  }, []);

  const applyComparison = useCallback((payload: PlaylistComparisonPayload) => {
    setComparison(payload);
    setSelectedUris(new Set(payload.inAOnly.map((track) => track.uri)));
  }, []);

  const handleCompare = useCallback(async () => {
    const playlistAId = resolvePlaylistId(playlistASelection, playlistAInput);
    const playlistBId = resolvePlaylistId(playlistBSelection, playlistBInput);

    if (!playlistAId || !playlistBId) {
      setActionMessage({ type: "error", message: "Please choose or paste valid playlist IDs for both playlists." });
      return;
    }

    setIsComparing(true);
    setActionMessage(null);

    try {
      const payload = await fetchComparison(playlistAId, playlistBId);
      applyComparison(payload);
      setLastPair({ playlistAId, playlistBId });
      setActionMessage({ type: "success", message: "Comparison complete." });
    } catch (error) {
      console.error(error);
      setActionMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to compare playlists." });
    } finally {
      setIsComparing(false);
    }
  }, [applyComparison, fetchComparison, playlistAInput, playlistASelection, playlistBInput, playlistBSelection, resolvePlaylistId]);

  const handleSwap = useCallback(
    async (checked: boolean) => {
      if (checked === isSwapActive) {
        return;
      }

      setIsSwapActive(checked);

      const nextASelection = playlistBSelection;
      const nextAInput = playlistBInput;
      const nextBSelection = playlistASelection;
      const nextBInput = playlistAInput;

      setPlaylistASelection(nextASelection);
      setPlaylistAInput(nextAInput);
      setPlaylistBSelection(nextBSelection);
      setPlaylistBInput(nextBInput);

      setSelectedUris(new Set());
      setComparison(null);
      setActionMessage(null);

      const playlistAId = resolvePlaylistId(nextASelection, nextAInput);
      const playlistBId = resolvePlaylistId(nextBSelection, nextBInput);

      if (!playlistAId || !playlistBId) {
        setLastPair(null);
        return;
      }

      setIsComparing(true);
      try {
        const payload = await fetchComparison(playlistAId, playlistBId);
        applyComparison(payload);
        setLastPair({ playlistAId, playlistBId });
      } catch (error) {
        console.error(error);
        setActionMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to compare playlists." });
      } finally {
        setIsComparing(false);
      }
    },
    [
      applyComparison,
      fetchComparison,
      isSwapActive,
      playlistAInput,
      playlistASelection,
      playlistBInput,
      playlistBSelection,
      resolvePlaylistId,
    ],
  );

  const missingTracks = useMemo(() => comparison?.inAOnly ?? [], [comparison]);

  useEffect(() => {
    if (!comparison) {
      setSelectedUris(new Set());
      return;
    }

    setSelectedUris(new Set(comparison.inAOnly.map((track) => track.uri)));
  }, [comparison]);

  const selectedTrackDetails = useMemo(
    () => missingTracks.filter((track) => selectedUris.has(track.uri)),
    [missingTracks, selectedUris],
  );

  const allSelected = selectedTrackDetails.length === missingTracks.length && missingTracks.length > 0;

  const handleToggleSelection = useCallback((uri: string) => {
    setSelectedUris((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) {
        next.delete(uri);
      } else {
        next.add(uri);
      }
      return next;
    });
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    if (!comparison) {
      return;
    }

    if (allSelected) {
      setSelectedUris(new Set());
    } else {
      setSelectedUris(new Set(comparison.inAOnly.map((track) => track.uri)));
    }
  }, [allSelected, comparison]);

  const handleOpenPreview = useCallback(() => {
    if (selectedTrackDetails.length === 0) {
      setActionMessage({ type: "error", message: "Select at least one track to sync." });
      return;
    }

    setIsPreviewOpen(true);
  }, [selectedTrackDetails.length]);

  const refreshComparison = useCallback(async () => {
    if (!lastPair) {
      return;
    }

    try {
      const payload = await fetchComparison(lastPair.playlistAId, lastPair.playlistBId);
      applyComparison(payload);
    } catch (error) {
      console.error(error);
      setActionMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to refresh playlists." });
    }
  }, [applyComparison, fetchComparison, lastPair]);

  const handleConfirmSync = useCallback(async () => {
    if (!lastPair) {
      setActionMessage({ type: "error", message: "Compare playlists before syncing." });
      return;
    }

    const targetPlaylistId = lastPair.playlistBId;
    const targetSummary = playlistState.data?.find((playlist) => playlist.id === targetPlaylistId);

    if (targetSummary && targetSummary.isEditable === false) {
      setActionMessage({ type: "error", message: "You can only sync into playlists you own or that are collaborative." });
      return;
    }

    setIsSyncing(true);
    setActionMessage(null);

    try {
      const response = await fetch("/api/spotify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetPlaylistId, trackUris: Array.from(selectedUris) }),
      });

      if (response.status === 401) {
        throw new Error("Your session has expired. Please log in again.");
      }

      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error ?? "Failed to sync playlists.");
      }

      const { addedUris, undoToken } = (await response.json()) as { addedUris: string[]; undoToken: string | null };

      if (addedUris.length === 0) {
        setActionMessage({ type: "error", message: "No new tracks were added. The target already has these songs." });
        setLastUndo(null);
        return;
      }

      if (undoToken) {
        setLastUndo({ targetPlaylistId, undoToken });
      } else {
        setLastUndo(null);
      }

      const addedTracks = selectedTrackDetails.filter((track) => addedUris.includes(track.uri));
      const previewNames = addedTracks.slice(0, 3).map((track) => track.name).join(", ");
      const summarySuffix = addedTracks.length > 3 ? ", ..." : "";
      const summary = `Added ${addedUris.length} track${addedUris.length === 1 ? "" : "s"}${
        previewNames ? `: ${previewNames}${summarySuffix}` : ""
      }`;
      setActionMessage({ type: "success", message: summary });

      await refreshComparison();
    } catch (error) {
      console.error(error);
      setActionMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to sync playlists." });
    } finally {
      setIsSyncing(false);
      setIsPreviewOpen(false);
    }
  }, [lastPair, playlistState.data, refreshComparison, selectedTrackDetails, selectedUris]);

  const handleUndo = useCallback(async () => {
    if (!lastUndo) {
      return;
    }

    setIsUndoing(true);
    setActionMessage(null);

    try {
      const response = await fetch("/api/spotify/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetPlaylistId: lastUndo.targetPlaylistId, undoToken: lastUndo.undoToken }),
      });

      if (response.status === 401) {
        throw new Error("Your session has expired. Please log in again.");
      }

      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error ?? "Failed to undo the last sync.");
      }

      const { removedUris } = (await response.json()) as { removedUris: string[] };
      setLastUndo(null);
      setActionMessage({
        type: "success",
        message: `Removed ${removedUris.length} track${removedUris.length === 1 ? "" : "s"} from the target playlist.`,
      });

      await refreshComparison();
    } catch (error) {
      console.error(error);
      setActionMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to undo the last sync." });
    } finally {
      setIsUndoing(false);
    }
  }, [lastUndo, refreshComparison]);

  const loadError = profileState.error ?? playlistState.error;

  return (
    <section className="relative flex flex-col gap-6 pb-32">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-foreground">Minkyu Spotify</h1>
        <p className="text-sm text-muted-foreground">
          Compare playlists side by side, pick the tracks you want, and sync them in one tap.
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

      <div className="grid gap-4 rounded-3xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Playlist A (source)</label>
            <Select value={playlistASelection} onValueChange={setPlaylistASelection}>
              <SelectTrigger>
                <SelectValue placeholder={playlistState.loading ? "Loading playlists..." : "Choose playlist A"} />
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
              value={playlistAInput}
              onChange={(event) => setPlaylistAInput(event.target.value)}
              inputMode="url"
              className="h-12 text-base"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Playlist B (target)</label>
            <Select value={playlistBSelection} onValueChange={setPlaylistBSelection}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    playlistState.loading
                      ? "Loading playlists..."
                      : editablePlaylists.length > 0
                        ? "Choose playlist B"
                        : "No editable playlists available"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {editablePlaylists.map((playlist) => (
                  <SelectItem key={playlist.id} value={playlist.id}>
                    {playlist.name} ({playlist.trackCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Or paste a playlist URL or ID"
              value={playlistBInput}
              onChange={(event) => setPlaylistBInput(event.target.value)}
              inputMode="url"
              className="h-12 text-base"
            />
            {playlistState.loading ? null : editablePlaylists.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Create a playlist you own or ask the owner to make it collaborative before syncing.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Only playlists you can edit appear here.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl bg-muted/50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Switch id="swap-toggle" checked={isSwapActive} onCheckedChange={handleSwap} />
            <label htmlFor="swap-toggle" className="text-sm text-foreground">
              Swap A/B (sync direction)
            </label>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={handleCompare} disabled={isComparing || playlistState.loading} className="h-12 text-base">
              {isComparing ? "Comparing..." : "Compare playlists"}
            </Button>
            <Button
              variant="secondary"
              onClick={handleOpenPreview}
              disabled={selectedTrackDetails.length === 0 || isSyncing || !comparison}
              className="h-12 text-base"
            >
              Preview sync
            </Button>
          </div>
        </div>
      </div>

      {comparison ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-lg">Comparison results</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              {comparison.inAOnly.length === 0 && comparison.inBOnly.length === 0
                ? "Playlists are already in sync."
                : `Missing ${comparison.inAOnly.length} track${comparison.inAOnly.length === 1 ? "" : "s"} in playlist B and ${comparison.inBOnly.length} in playlist A.`}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <PlaylistColumn
          label="Playlist A"
          summary={comparison?.playlistA.summary}
          tracks={comparison?.playlistA.tracks}
          loading={isComparing || playlistState.loading}
          highlightPresence="uniqueToA"
          selectablePresence="uniqueToA"
          selectedUris={selectedUris}
          onToggle={handleToggleSelection}
        />
        <PlaylistColumn
          label="Playlist B"
          summary={comparison?.playlistB.summary}
          tracks={comparison?.playlistB.tracks}
          loading={isComparing || playlistState.loading}
          highlightPresence={null}
          selectablePresence={null}
          selectedUris={selectedUris}
          onToggle={handleToggleSelection}
        />
      </div>

      <PreviewModal
        open={isPreviewOpen}
        tracks={selectedTrackDetails}
        onCancel={() => setIsPreviewOpen(false)}
        onConfirm={handleConfirmSync}
        isSyncing={isSyncing}
      />

      {comparison ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <Button onClick={handleToggleSelectAll} variant="outline" className="h-14 flex-1 text-base">
              {allSelected ? "Deselect All" : "Select All"}
            </Button>
            <Button
              onClick={() => {
                if (selectedTrackDetails.length === 0) {
                  setActionMessage({ type: "error", message: "Select at least one track first." });
                  return;
                }
                setIsPreviewOpen(true);
              }}
              disabled={selectedTrackDetails.length === 0 || isSyncing}
              className="h-14 flex-1 text-base"
            >
              {isSyncing ? "Syncing..." : `Sync Selected (${selectedTrackDetails.length})`}
            </Button>
            <Button
              variant="secondary"
              onClick={handleUndo}
              disabled={!lastUndo || isUndoing}
              className="h-14 flex-1 text-base"
            >
              {isUndoing ? "Undoing..." : "Undo"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
