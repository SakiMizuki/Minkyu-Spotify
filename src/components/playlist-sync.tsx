"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";

import { Search, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  buildPlaylistComparison,
  type ComparableTrack,
  type PlaylistComparisonPayload,
  type PlaylistTrackWithPresence,
  type TrackPresence,
} from "@/lib/spotify/comparison";
import type { PlaylistSummary, PlaylistWithTracks, SpotifyTrack } from "@/types/spotify";

interface SpotifyUserProfile {
  display_name?: string | null;
  id: string;
  images?: { url: string }[];
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

type PlaylistSlotKey = "A" | "B";

interface PlaylistLoadState {
  playlistId: string | null;
  summary: PlaylistSummary | null;
  tracks: SpotifyTrack[];
  loadedCount: number;
  totalCount: number;
  isLoading: boolean;
  error: string | null;
}

function createInitialLoadState(): PlaylistLoadState {
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

function formatPlaylistProgress(state: PlaylistLoadState): string | null {
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

type PlaylistSortOption =
  | "original"
  | "name-asc"
  | "name-desc"
  | "duration-asc"
  | "duration-desc"
  | "artist-asc"
  | "artist-desc";

const PLAYLIST_SORT_OPTIONS: { value: PlaylistSortOption; label: string }[] = [
  { value: "original", label: "Original order" },
  { value: "name-asc", label: "Track (A-Z)" },
  { value: "name-desc", label: "Track (Z-A)" },
  { value: "duration-asc", label: "Duration (short -> long)" },
  { value: "duration-desc", label: "Duration (long -> short)" },
  { value: "artist-asc", label: "Artist (A-Z)" },
  { value: "artist-desc", label: "Artist (Z-A)" },
];

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function getPrimaryArtist(track: PlaylistTrackWithPresence): string {
  return track.artists[0] ?? "";
}

function compareTracksBySortOption(a: PlaylistTrackWithPresence, b: PlaylistTrackWithPresence, sortOption: PlaylistSortOption): number {
  switch (sortOption) {
    case "name-asc":
      return (
        compareStrings(a.name, b.name) ||
        compareStrings(getPrimaryArtist(a), getPrimaryArtist(b)) ||
        compareStrings(a.instanceId, b.instanceId)
      );
    case "name-desc":
      return (
        compareStrings(b.name, a.name) ||
        compareStrings(getPrimaryArtist(b), getPrimaryArtist(a)) ||
        compareStrings(b.instanceId, a.instanceId)
      );
    case "duration-asc":
      return (
        a.durationMs - b.durationMs ||
        compareStrings(a.name, b.name) ||
        compareStrings(a.instanceId, b.instanceId)
      );
    case "duration-desc":
      return (
        b.durationMs - a.durationMs ||
        compareStrings(a.name, b.name) ||
        compareStrings(a.instanceId, b.instanceId)
      );
    case "artist-asc":
      return (
        compareStrings(getPrimaryArtist(a), getPrimaryArtist(b)) ||
        compareStrings(a.name, b.name) ||
        compareStrings(a.instanceId, b.instanceId)
      );
    case "artist-desc":
      return (
        compareStrings(getPrimaryArtist(b), getPrimaryArtist(a)) ||
        compareStrings(b.name, a.name) ||
        compareStrings(b.instanceId, a.instanceId)
      );
    case "original":
    default:
      return 0;
  }
}

function applySearchAndSort(
  tracks: PlaylistTrackWithPresence[] | undefined,
  searchQuery: string,
  sortOption: PlaylistSortOption,
): PlaylistTrackWithPresence[] {
  if (!tracks) {
    return [];
  }

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filtered = normalizedQuery
    ? tracks.filter((track) => {
        if (track.name.toLowerCase().includes(normalizedQuery)) {
          return true;
        }

        return track.artists.some((artist) => artist.toLowerCase().includes(normalizedQuery));
      })
    : [...tracks];

  if (sortOption === "original") {
    return filtered;
  }

  return [...filtered].sort((a, b) => compareTracksBySortOption(a, b, sortOption));
}

interface PlaylistTrackRowProps {
  track: PlaylistTrackWithPresence;
  highlightPresence?: TrackPresence | null;
  selectablePresence: TrackPresence | null;
  selectedTrackIds: Set<string>;
  onToggle: (instanceId: string) => void;
}

function PlaylistTrackRow({
  track,
  highlightPresence = null,
  selectablePresence,
  selectedTrackIds,
  onToggle,
}: PlaylistTrackRowProps) {
  const isHighlight = highlightPresence ? track.presence === highlightPresence : false;
  const isSelectable = selectablePresence ? track.presence === selectablePresence : false;
  const instanceId = track.instanceId;
  const isChecked = isSelectable ? selectedTrackIds.has(instanceId) : false;

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
          onChange={() => onToggle(instanceId)}
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
  progressText?: string | null;
  error?: string | null;
  highlightPresence?: TrackPresence | null;
  selectablePresence: TrackPresence | null;
  selectedTrackIds: Set<string>;
  onToggle: (instanceId: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
  sortOption: PlaylistSortOption;
  onSortChange: (value: PlaylistSortOption) => void;
  isSearchActive: boolean;
}

function PlaylistColumn({
  label,
  summary,
  tracks,
  loading,
  progressText,
  error,
  highlightPresence,
  selectablePresence,
  selectedTrackIds,
  onToggle,
  searchValue,
  onSearchChange,
  onSearchClear,
  sortOption,
  onSortChange,
  isSearchActive,
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
          {progressText ? <span className="mt-1 block text-xs text-muted-foreground">{progressText}</span> : null}
          {error ? <span className="mt-1 block text-xs text-destructive">{error}</span> : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search tracks"
              className="h-11 w-full rounded-xl pl-10 pr-10 text-sm"
              aria-label={`Search ${label}`}
            />
            {searchValue ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={onSearchClear}
                aria-label={`Clear search for ${label}`}
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
          <Select value={sortOption} onValueChange={(value) => onSortChange(value as PlaylistSortOption)}>
            <SelectTrigger className="h-11 rounded-xl sm:w-56">
              <SelectValue placeholder="Sort tracks" />
            </SelectTrigger>
            <SelectContent>
              {PLAYLIST_SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ScrollArea className="h-[420px] rounded-xl border bg-muted/20 p-3">
          <div className="flex flex-col gap-3">
            {loading && (!tracks || tracks.length === 0) ? (
              Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-20 w-full rounded-xl" />)
            ) : tracks && tracks.length > 0 ? (
              tracks.map((track) => (
                <PlaylistTrackRow
                  key={track.instanceId}
                  track={track}
                  highlightPresence={highlightPresence}
                  selectablePresence={selectablePresence}
                  selectedTrackIds={selectedTrackIds}
                  onToggle={onToggle}
                />
              ))
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                {isSearchActive ? "No tracks match your search." : "No tracks to display."}
              </p>
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
            <div key={track.instanceId} className="rounded-2xl border border-muted-foreground/10 bg-muted/30 px-3 py-2 text-sm">
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
  const [playlistLoads, setPlaylistLoads] = useState<{ A: PlaylistLoadState; B: PlaylistLoadState }>(() => ({
    A: createInitialLoadState(),
    B: createInitialLoadState(),
  }));
  const playlistRequestTokens = useRef<{ A: number; B: number }>({ A: 0, B: 0 });
  const [comparison, setComparison] = useState<PlaylistComparisonPayload | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isSwapActive, setIsSwapActive] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [searchQueries, setSearchQueries] = useState<{ A: string; B: string }>({ A: "", B: "" });
  const [sortSelections, setSortSelections] = useState<{ A: PlaylistSortOption; B: PlaylistSortOption }>({
    A: "original",
    B: "original",
  });
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
        const message = await parseErrorMessage(profileRes, "Failed to fetch profile details.");
        throw new Error(message);
      }

      if (!playlistsRes.ok) {
        const message = await parseErrorMessage(playlistsRes, "Failed to fetch playlists.");
        throw new Error(message);
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

  const applyComparison = useCallback((payload: PlaylistComparisonPayload) => {
    setComparison(payload);
    setSelectedTrackIds(new Set(payload.inAOnly.map((track) => track.instanceId)));
  }, []);

  const loadPlaylistFully = useCallback(
    async (slot: PlaylistSlotKey, playlistId: string): Promise<PlaylistWithTracks> => {
      playlistRequestTokens.current[slot] += 1;
      const requestToken = playlistRequestTokens.current[slot];

      setPlaylistLoads((prev) => {
        const previous = prev[slot];
        const shouldPreserveSummary = previous.playlistId === playlistId ? previous.summary : null;

        return {
          ...prev,
          [slot]: {
            playlistId,
            summary: shouldPreserveSummary,
            tracks: [],
            loadedCount: 0,
            totalCount: 0,
            isLoading: true,
            error: null,
          },
        };
      });

      const aggregatedTracks: SpotifyTrack[] = [];
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

          summary = payload.summary ?? summary;
          total = typeof payload.total === "number" ? payload.total : total;
          aggregatedTracks.push(...payload.tracks);

          nextOffset = payload.nextOffset;
          currentOffset = typeof payload.nextOffset === "number" ? payload.nextOffset : payload.offset + payload.tracks.length;

          setPlaylistLoads((prev) => {
            if (playlistRequestTokens.current[slot] !== requestToken) {
              return prev;
            }

            const nextState: PlaylistLoadState = {
              playlistId,
              summary: summary ?? prev[slot].summary,
              tracks: [...aggregatedTracks],
              loadedCount: aggregatedTracks.length,
              totalCount: total,
              isLoading: typeof nextOffset === "number",
              error: null,
            };

            return { ...prev, [slot]: nextState };
          });
        } while (typeof nextOffset === "number");

        if (playlistRequestTokens.current[slot] !== requestToken) {
          throw new Error("playlist-load-cancelled");
        }

        if (!summary) {
          throw new Error("Failed to load playlist details.");
        }

        const finalSummary: PlaylistSummary = {
          ...summary,
          trackCount: total,
        };

        setPlaylistLoads((prev) => {
          if (playlistRequestTokens.current[slot] !== requestToken) {
            return prev;
          }

          return {
            ...prev,
            [slot]: {
              playlistId,
              summary: finalSummary,
              tracks: [...aggregatedTracks],
              loadedCount: aggregatedTracks.length,
              totalCount: total,
              isLoading: false,
              error: null,
            },
          };
        });

        return {
          summary: finalSummary,
          tracks: aggregatedTracks,
        };
      } catch (error) {
        const isCancelled = error instanceof Error && error.message === "playlist-load-cancelled";
        const message = error instanceof Error ? error.message : "Failed to load playlist.";

        if (!isCancelled) {
          setPlaylistLoads((prev) => {
            if (playlistRequestTokens.current[slot] !== requestToken) {
              return prev;
            }

            return {
              ...prev,
              [slot]: {
                ...prev[slot],
                playlistId,
                isLoading: false,
                error: message,
              },
            };
          });
        }

        throw error;
      }
    },
    [],
  );

  const handleCompare = useCallback(async () => {
    const playlistAId = resolvePlaylistId(playlistASelection, playlistAInput);
    const playlistBId = resolvePlaylistId(playlistBSelection, playlistBInput);

    if (!playlistAId || !playlistBId) {
      setActionMessage({ type: "error", message: "Please choose or paste valid playlist IDs for both playlists." });
      return;
    }

    setIsComparing(true);
    setActionMessage(null);
    setComparison(null);
    setSelectedTrackIds(new Set());

    try {
      const [playlistAData, playlistBData] = await Promise.all([
        loadPlaylistFully("A", playlistAId),
        loadPlaylistFully("B", playlistBId),
      ]);

      const payload = buildPlaylistComparison(playlistAData, playlistBData);
      applyComparison(payload);
      setLastPair({ playlistAId, playlistBId });
      setActionMessage({ type: "success", message: "Comparison complete." });
    } catch (error) {
      if (error instanceof Error && error.message === "playlist-load-cancelled") {
        return;
      }

      console.error(error);
      setActionMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to compare playlists." });
    } finally {
      setIsComparing(false);
    }
  }, [applyComparison, loadPlaylistFully, playlistAInput, playlistASelection, playlistBInput, playlistBSelection, resolvePlaylistId]);

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

      setSelectedTrackIds(new Set());
      setComparison(null);
      setActionMessage(null);

      const playlistAId = resolvePlaylistId(nextASelection, nextAInput);
      const playlistBId = resolvePlaylistId(nextBSelection, nextBInput);

      if (!playlistAId || !playlistBId) {
        setLastPair(null);
        setPlaylistLoads({ A: createInitialLoadState(), B: createInitialLoadState() });
        return;
      }

      setIsComparing(true);
      try {
        const [playlistAData, playlistBData] = await Promise.all([
          loadPlaylistFully("A", playlistAId),
          loadPlaylistFully("B", playlistBId),
        ]);
        const payload = buildPlaylistComparison(playlistAData, playlistBData);
        applyComparison(payload);
        setLastPair({ playlistAId, playlistBId });
      } catch (error) {
        if (error instanceof Error && error.message === "playlist-load-cancelled") {
          return;
        }
        console.error(error);
        setActionMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to compare playlists." });
      } finally {
        setIsComparing(false);
      }
    },
    [
      applyComparison,
      isSwapActive,
      loadPlaylistFully,
      playlistAInput,
      playlistASelection,
      playlistBInput,
      playlistBSelection,
      resolvePlaylistId,
    ],
  );

  const missingTracks = useMemo(
    () => comparison?.playlistA.tracks.filter((track) => track.presence === "uniqueToA") ?? [],
    [comparison],
  );

  const displayTracksA = useMemo(
    () => applySearchAndSort(comparison?.playlistA.tracks, searchQueries.A, sortSelections.A),
    [comparison?.playlistA.tracks, searchQueries.A, sortSelections.A],
  );

  const displayTracksB = useMemo(
    () => applySearchAndSort(comparison?.playlistB.tracks, searchQueries.B, sortSelections.B),
    [comparison?.playlistB.tracks, searchQueries.B, sortSelections.B],
  );

  const playlistALoadState = playlistLoads.A;
  const playlistBLoadState = playlistLoads.B;
  const playlistALoadingMessage = formatPlaylistProgress(playlistALoadState);
  const playlistBLoadingMessage = formatPlaylistProgress(playlistBLoadState);
  const targetPlaylistSummary =
    comparison?.playlistB.summary ??
    (lastPair ? playlistState.data?.find((playlist) => playlist.id === lastPair.playlistBId) ?? null : null) ??
    playlistBLoadState.summary ??
    null;

  const targetPlaylistId = targetPlaylistSummary?.id ?? null;

  const isTargetPlaylistLoading = playlistBLoadState.isLoading;

  const isTargetPlaylistReady =
    Boolean(targetPlaylistId) &&
    playlistBLoadState.playlistId === targetPlaylistId &&
    !playlistBLoadState.isLoading &&
    (playlistBLoadState.totalCount === 0 || playlistBLoadState.loadedCount >= playlistBLoadState.totalCount);

  const isTargetPlaylistWritable =
    targetPlaylistSummary !== null
      ? targetPlaylistSummary.isEditable ?? Boolean(targetPlaylistSummary.isOwned || targetPlaylistSummary.isCollaborative)
      : false;

  useEffect(() => {
    if (!comparison) {
      setSelectedTrackIds(new Set());
      return;
    }

    setSelectedTrackIds(
      new Set(comparison.playlistA.tracks.filter((track) => track.presence === "uniqueToA").map((track) => track.instanceId)),
    );
  }, [comparison]);

  const selectedTrackDetails = useMemo(
    () => missingTracks.filter((track) => selectedTrackIds.has(track.instanceId)),
    [missingTracks, selectedTrackIds],
  );

  const allSelected = selectedTrackDetails.length === missingTracks.length && missingTracks.length > 0;

  const handleToggleSelection = useCallback((instanceId: string) => {
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
    if (!comparison) {
      return;
    }

    if (allSelected) {
      setSelectedTrackIds(new Set());
    } else {
      setSelectedTrackIds(new Set(missingTracks.map((track) => track.instanceId)));
    }
  }, [allSelected, comparison, missingTracks]);

  const handleSearchChange = useCallback((slot: PlaylistSlotKey, value: string) => {
    setSearchQueries((prev) => ({ ...prev, [slot]: value }));
  }, []);

  const handleSearchClear = useCallback((slot: PlaylistSlotKey) => {
    setSearchQueries((prev) => ({ ...prev, [slot]: "" }));
  }, []);

  const handleSortChange = useCallback((slot: PlaylistSlotKey, value: PlaylistSortOption) => {
    setSortSelections((prev) => ({ ...prev, [slot]: value }));
  }, []);

  const handleOpenPreview = useCallback(() => {
    if (!isTargetPlaylistReady) {
      setActionMessage({ type: "error", message: "Still loading the target playlist - please wait." });
      return;
    }

    if (!isTargetPlaylistWritable) {
      setActionMessage({ type: "error", message: "You can only sync into playlists you own or that are collaborative." });
      return;
    }

    if (selectedTrackDetails.length === 0) {
      setActionMessage({ type: "error", message: "Select at least one track to sync." });
      return;
    }

    setIsPreviewOpen(true);
  }, [isTargetPlaylistReady, isTargetPlaylistWritable, selectedTrackDetails.length]);

  const refreshComparison = useCallback(async () => {
    if (!lastPair) {
      return;
    }

    try {
      const [playlistAData, playlistBData] = await Promise.all([
        loadPlaylistFully("A", lastPair.playlistAId),
        loadPlaylistFully("B", lastPair.playlistBId),
      ]);
      const payload = buildPlaylistComparison(playlistAData, playlistBData);
      applyComparison(payload);
    } catch (error) {
      if (error instanceof Error && error.message === "playlist-load-cancelled") {
        return;
      }

      console.error(error);
      setActionMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to refresh playlists." });
    }
  }, [applyComparison, lastPair, loadPlaylistFully]);

  const handleConfirmSync = useCallback(async () => {
    if (!lastPair) {
      setActionMessage({ type: "error", message: "Compare playlists before syncing." });
      return;
    }

    if (!isTargetPlaylistReady) {
      setActionMessage({ type: "error", message: "Still loading the target playlist - please wait." });
      return;
    }

    if (!isTargetPlaylistWritable) {
      setActionMessage({ type: "error", message: "You can only sync into playlists you own or that are collaborative." });
      return;
    }

    const targetPlaylistId = lastPair.playlistBId;

    setIsSyncing(true);
    setActionMessage(null);

    try {
      const trackUris = selectedTrackDetails.map((track) => track.uri);

      const response = await fetch("/api/spotify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetPlaylistId, trackUris }),
      });

      if (response.status === 401) {
        throw new Error("Your session has expired. Please log in again.");
      }

      if (!response.ok) {
        const message = await parseErrorMessage(response, "Failed to sync playlists.");
        throw new Error(message);
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
  }, [isTargetPlaylistReady, isTargetPlaylistWritable, lastPair, refreshComparison, selectedTrackDetails]);

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
        const message = await parseErrorMessage(response, "Failed to undo the last sync.");
        throw new Error(message);
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
        <Button asChild variant="outline" className="mt-2 w-full sm:w-auto">
          <Link href="/remove">Manage Playlists</Link>
        </Button>
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
              disabled={
                selectedTrackDetails.length === 0 ||
                isSyncing ||
                isUndoing ||
                isComparing ||
                !comparison ||
                !isTargetPlaylistReady ||
                !isTargetPlaylistWritable
              }
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
          summary={comparison?.playlistA.summary ?? playlistALoadState.summary ?? undefined}
          tracks={displayTracksA}
          loading={isComparing || playlistState.loading || playlistALoadState.isLoading}
          progressText={playlistALoadingMessage}
          error={playlistALoadState.error}
          highlightPresence="uniqueToA"
          selectablePresence="uniqueToA"
          selectedTrackIds={selectedTrackIds}
          onToggle={handleToggleSelection}
          searchValue={searchQueries.A}
          onSearchChange={(value) => handleSearchChange("A", value)}
          onSearchClear={() => handleSearchClear("A")}
          sortOption={sortSelections.A}
          onSortChange={(value) => handleSortChange("A", value)}
          isSearchActive={searchQueries.A.trim().length > 0}
        />
        <PlaylistColumn
          label="Playlist B"
          summary={comparison?.playlistB.summary ?? playlistBLoadState.summary ?? undefined}
          tracks={displayTracksB}
          loading={isComparing || playlistState.loading || playlistBLoadState.isLoading}
          progressText={playlistBLoadingMessage}
          error={playlistBLoadState.error}
          highlightPresence={null}
          selectablePresence={null}
          selectedTrackIds={selectedTrackIds}
          onToggle={handleToggleSelection}
          searchValue={searchQueries.B}
          onSearchChange={(value) => handleSearchChange("B", value)}
          onSearchClear={() => handleSearchClear("B")}
          sortOption={sortSelections.B}
          onSortChange={(value) => handleSortChange("B", value)}
          isSearchActive={searchQueries.B.trim().length > 0}
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
              onClick={handleOpenPreview}
              disabled={
                selectedTrackDetails.length === 0 ||
                isSyncing ||
                isUndoing ||
                isComparing ||
                isTargetPlaylistLoading ||
                !isTargetPlaylistReady ||
                !isTargetPlaylistWritable
              }
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
