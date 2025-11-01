<div align="center">

# Minkyu Spotify

Compare two Spotify playlists, highlight missing tracks, and sync them in one click.

</div>

## Features

- Spotify login using the Authorization Code Flow with PKCE and secure HTTP-only cookies
- Playlist browser with pagination support for large libraries
- Side-by-side playlist comparison with missing tracks highlighted
- One-way or two-way sync for missing songs
- Tailwind CSS styling with shadcn/ui components

## Tech Stack

- Next.js 14 App Router (TypeScript)
- Tailwind CSS v4 + shadcn/ui
- Spotify Web API

## Prerequisites

- Node.js 18+
- Spotify Developer account
- GitHub + Vercel account for deployment (optional but recommended)

## 1. Create a Spotify App

1. Visit the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/) and create a new application.
2. Add the redirect URI `http://localhost:3000/api/auth/callback` under *Settings ? Redirect URIs* (add the Vercel production URL later).
3. Copy the *Client ID* and *Client Secret*.

## 2. Configure Environment Variables

Duplicate `.env.example` and populate it:

```bash
cp .env.example .env.local
```

```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3000/api/auth/callback
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

When deploying, update `SPOTIFY_REDIRECT_URI` and `NEXT_PUBLIC_BASE_URL` to use the production domain (e.g. `https://minkyu-spotify.vercel.app`).

## 3. Install Dependencies & Run Locally

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` and click **Log in with Spotify**. After authorizing the app you can choose or paste playlist URLs, compare them, and sync missing tracks.

## 4. Deploying to Vercel

1. Push the repository to GitHub (e.g. `https://github.com/SakiMizuki/Minkyu-Spotify`).
2. Create a new Vercel project from that repository.
3. Add the four environment variables above in the Vercel dashboard (*Settings ? Environment Variables*).
4. Add the production redirect URI (e.g. `https://minkyu-spotify.vercel.app/api/auth/callback`) to your Spotify app settings.
5. Trigger a production deployment ? no extra build steps required.

## Useful Scripts

```bash
npm run dev        # start the development server
npm run build      # create a production build
npm run start      # run the production build locally
npm run lint       # run ESLint
```

## Project Structure Highlights

- `src/app/api/auth/*` ? authentication endpoints (login, callback, refresh)
- `src/app/api/spotify/*` ? playlist comparison and sync APIs
- `src/components/playlist-sync.tsx` ? main client dashboard
- `src/lib/spotify/*` ? helpers for PKCE, cookies, API calls, and playlist utilities

## Security Notes

- Access and refresh tokens are stored in secure HTTP-only cookies.
- PKCE (code verifier + challenge) protects the login flow.
- Tokens refresh automatically when close to expiration, and you can trigger manual refresh via `/api/auth/refresh`.

## License

MIT ? 2025 Minkyu Spotify
