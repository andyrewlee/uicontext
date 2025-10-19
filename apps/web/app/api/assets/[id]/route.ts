import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";
import { fetchAction } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_request: Request, { params }: RouteContext) {
  const storageId = params.id;

  if (!storageId) {
    return NextResponse.json({ error: "Missing asset id" }, { status: 400 });
  }

  try {
    const bytes = await fetchAction(
      api.contexts.fetchScreenshot,
      {
        storageId: storageId as Id<"_storage">,
      },
    );

    if (!bytes) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    const body = Buffer.from(bytes);

    return new NextResponse(body, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": body.length.toString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
