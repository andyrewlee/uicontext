import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";

import { api } from "@/convex/_generated/api";

// Allow chrome-extension:// origins to call this listing route directly.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type");
  const type = typeParam === "design" || typeParam === "text" ? typeParam : undefined;

  const authHeader = request.headers.get("authorization");
  let token: string | null = null;

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice("Bearer ".length).trim();
  }

  if (!token) {
    const { userId, sessionId, getToken } = auth();
    if (!userId || !sessionId || !getToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }
    token = await getToken({ template: "convex" });
  }

  if (!token) {
    return NextResponse.json({ error: "Failed to mint Convex token" }, { status: 401, headers: corsHeaders });
  }

  try {
    const contexts = await fetchQuery(
      api.contexts.listContexts,
      { type },
      { token },
    );
    return NextResponse.json({ contexts }, { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
