import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Exchange the caller's Clerk session for a Convex auth token.
export async function GET() {
  const { userId, sessionId, getToken } = auth();

  if (!userId || !sessionId || !getToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await getToken({ template: "convex" });
  if (!token) {
    return NextResponse.json({ error: "Failed to mint Convex token" }, { status: 401 });
  }

  return NextResponse.json({ token });
}
