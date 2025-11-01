import crypto from "node:crypto";

import type { SpotifyAccessContext } from "@/lib/spotify/client";

interface UndoEntry {
  undoToken: string;
  playlistId: string;
  uris: string[];
  createdAt: number;
}

const sessionUndoStore = new Map<string, UndoEntry>();

function getSessionKey(context: SpotifyAccessContext): string {
  return crypto.createHash("sha256").update(context.accessToken).digest("hex");
}

export function setUndoEntry(
  context: SpotifyAccessContext,
  playlistId: string,
  uris: string[],
): { undoToken: string } {
  const sessionKey = getSessionKey(context);
  const undoToken = crypto.randomUUID();

  sessionUndoStore.set(sessionKey, {
    undoToken,
    playlistId,
    uris,
    createdAt: Date.now(),
  });

  return { undoToken };
}

export function consumeUndoEntry(
  context: SpotifyAccessContext,
  playlistId: string,
  undoToken: string,
): string[] | null {
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
  return entry.uris;
}
