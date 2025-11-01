export const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SPOTIFY_API_URL = "https://api.spotify.com/v1";

export const ACCESS_TOKEN_COOKIE = "spotify_access_token";
export const REFRESH_TOKEN_COOKIE = "spotify_refresh_token";
export const EXPIRES_AT_COOKIE = "spotify_token_expires_at";
export const SCOPE_COOKIE = "spotify_token_scope";
export const TOKEN_TYPE_COOKIE = "spotify_token_type";

export const CODE_VERIFIER_COOKIE = "spotify_code_verifier";
export const STATE_COOKIE = "spotify_auth_state";

export const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-read-private",
];

export const TOKEN_REFRESH_THRESHOLD_MS = 60_000; // 1 minute
