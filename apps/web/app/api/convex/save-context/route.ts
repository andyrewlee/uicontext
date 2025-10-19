import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";

import { api } from "@/convex/_generated/api";

// Route handler used by both the Next.js app and the Chrome extension to enqueue captures.
type SaveContextPayload = {
  type: "design" | "text";
  html?: string;
  textContent?: string;
};

const isValidPayload = (payload: unknown): payload is SaveContextPayload => {
  if (payload === null || typeof payload !== "object") {
    return false;
  }

  const { type, html, textContent } = payload as Record<string, unknown>;

  if (type !== "design" && type !== "text") {
    return false;
  }

  if (html !== undefined && typeof html !== "string") {
    return false;
  }

  if (textContent !== undefined && typeof textContent !== "string") {
    return false;
  }

  if (!html && !textContent) {
    return false;
  }

  return true;
};

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidPayload(payload)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const authHeader = request.headers.get("authorization");
  let token: string | null = null;

  // If the extension passed a Convex token, accept it directly.
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice("Bearer ".length).trim();
  }

  if (!token) {
    // Fallback for calls originating from the Next.js app: mint a token from the current Clerk session.
    const { userId, sessionId, getToken } = auth();
    if (!userId || !sessionId || !getToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    token = await getToken({ template: "convex" });
  }

  if (!token) {
    return NextResponse.json({ error: "Failed to mint Convex token" }, { status: 401 });
  }

  try {
    const result = await fetchMutation(api.contexts.saveContextDraft, payload, {
      token,
    });

    return NextResponse.json({ contextId: result.contextId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
