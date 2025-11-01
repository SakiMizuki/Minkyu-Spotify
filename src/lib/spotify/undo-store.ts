import crypto from "node:crypto";

import type { SpotifyAccessContext } from "@/lib/spotify/client";

interface UndoEntry {
  undoToken: string;
  playlistId: string;
  entries: { uri: string; position: number }[];
  snapshotId: string | null;
  createdAt: number;
}

const sessionUndoStore = new Map<string, UndoEntry>();

function getSessionKey(context: SpotifyAccessContext): string {
  return crypto.createHash("sha256").update(context.accessToken).digest("hex");
}

export function setUndoEntry(
  context: SpotifyAccessContext,
  playlistId: string,
  payload: { entries: { uri: string; position: number }[]; snapshotId: string | null },
): { undoToken: string } | null {
  const { entries, snapshotId } = payload;

  if (entries.length === 0) {
    return null;
  }

  const sessionKey = getSessionKey(context);
  const undoToken = crypto.randomUUID();

  sessionUndoStore.set(sessionKey, {
    undoToken,
    playlistId,
    entries,
    snapshotId,
    createdAt: Date.now(),
  });

  return { undoToken };
}

export function consumeUndoEntry(
  context: SpotifyAccessContext,
  playlistId: string,
  undoToken: string,
): { entries: { uri: string; position: number }[]; snapshotId: string | null } | null {
  const sessionKey = getSessionKey(context);
  const entry = sessionUndoStore.get(sessionKey);

  if (!entry) {
    return null;
  }

  if (entry.undoToken !== undoToken) {
    return null;
  }

  if (entry.playlistId !== playlistId) {
    return null;
  }

  sessionUndoStore.delete(sessionKey);
  return { entries: entry.entries, snapshotId: entry.snapshotId };
}
