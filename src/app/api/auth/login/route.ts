import { handleLogin } from "@/lib/spotify/auth";

export async function GET() {
  return handleLogin();
}
