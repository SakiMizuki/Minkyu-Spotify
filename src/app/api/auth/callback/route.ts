import type { NextRequest } from "next/server";

import { handleCallback } from "@/lib/spotify/auth";

export async function GET(request: NextRequest) {
  return handleCallback(request);
}
