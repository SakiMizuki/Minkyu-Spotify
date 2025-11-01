export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

export interface SpotifyArtist {
  id?: string | null;
  name: string;
}

export interface SpotifyAlbum {
  id?: string | null;
  name: string;
  images: SpotifyImage[];
}

export interface SpotifyTrack {
  id: string | null;
  uri: string;
  name: string;
  duration_ms: number;
  is_local: boolean;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  description?: string | null;
  images: SpotifyImage[];
  ownerName?: string | null;
  trackCount: number;
  externalUrl?: string;
}

export interface PlaylistWithTracks {
  summary: PlaylistSummary;
  tracks: SpotifyTrack[];
}
