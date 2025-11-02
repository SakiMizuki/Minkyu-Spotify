import { cookies } from "next/headers";
import Link from "next/link";

import { PlaylistSync } from "@/components/playlist-sync";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCESS_TOKEN_COOKIE } from "@/lib/spotify/constants";

interface HomeProps {
  searchParams?: { [key: string]: string | string[] | undefined };
}

export default async function Home({ searchParams }: HomeProps) {
  const cookieStore = await cookies();
  const isAuthenticated = Boolean(cookieStore.get(ACCESS_TOKEN_COOKIE));
  const errorParam = searchParams?.error;
  const rawError = Array.isArray(errorParam) ? errorParam[0] : errorParam;

  const errorMessage = rawError
    ? {
        state_mismatch: "The login attempt was interrupted. Please try again.",
        missing_code: "We couldn't complete the login flow. Please start again.",
        token_exchange_failed: "Spotify didn't authorize the app. Please try again.",
      }[rawError] ?? rawError
    : undefined;

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-background to-background px-4 py-16">
        <Card className="w-full max-w-xl rounded-3xl border-0 bg-card shadow-xl fade-in">
          <CardHeader className="space-y-4 pb-6">
            <CardTitle className="text-4xl font-serif font-semibold text-foreground">Minkyu Spotify</CardTitle>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Connect your Spotify account to browse playlists, compare track lists, and sync missing songs in a single click.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {errorMessage ? (
              <Alert variant="destructive" className="rounded-2xl">
                <AlertTitle>Authentication error</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}
            <Button
              asChild
              className="w-full h-12 rounded-2xl bg-primary text-primary-foreground shadow-md transition-all hover:bg-accent hover:shadow-lg"
            >
              <Link href="/api/auth/login">Log in with Spotify</Link>
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              By continuing you agree to connect your Spotify account using the Authorization Code Flow with PKCE.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 fade-in">
        <PlaylistSync />
      </div>
    </main>
  );
}
