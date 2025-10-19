import { Buffer } from "node:buffer";

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { fetchAction } from "convex/nextjs";

import { api } from "@/convex/_generated/api";

// Route handler used by both the Next.js app and the Chrome extension to enqueue captures.
type TextExtractionPayload = {
  strategy: "site_adapter" | "dom_tree_walker" | "inner_text" | "text_content";
  adapter?: string;
};

type SaveContextPayload = {
  type: "design" | "text";
  html?: string;
  textContent?: string;
  markdown?: string;
  textExtraction?: TextExtractionPayload;
  designDetails?: {
    bounds: { width: number; height: number; top: number; left: number };
    viewport: { scrollX: number; scrollY: number; width: number; height: number };
    colorPalette?: string[];
    fontFamilies?: string[];
    fontMetrics?: string[];
  };
  styles?: Record<string, string>;
  cssTokens?: Record<string, string>;
  selectionPath?: string;
  originUrl?: string;
  pageTitle?: string;
  screenshot?: string;
};

const isRecordOfStrings = (value: unknown): value is Record<string, string> => {
  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.entries(value).every(
    ([key, val]) => typeof key === "string" && typeof val === "string",
  );
};

const isValidPayload = (payload: unknown): payload is SaveContextPayload => {
  if (payload === null || typeof payload !== "object") {
    return false;
  }

  const isValidTextExtraction = (value: unknown): value is TextExtractionPayload => {
    if (!value || typeof value !== "object") {
      return false;
    }
    const { strategy, adapter } = value as Record<string, unknown>;
    const allowed = ["site_adapter", "dom_tree_walker", "inner_text", "text_content"];
    if (!allowed.includes(strategy as string)) {
      return false;
    }
    if (adapter !== undefined && typeof adapter !== "string") {
      return false;
    }
    return true;
  };

  const {
    type,
    html,
    textContent,
    markdown,
    textExtraction,
    designDetails,
    styles,
    cssTokens,
    selectionPath,
    originUrl,
    pageTitle,
    screenshot,
  } = payload as Record<string, unknown>;

  if (type !== "design" && type !== "text") {
    return false;
  }

  if (html !== undefined && typeof html !== "string") {
    return false;
  }

  if (textContent !== undefined && typeof textContent !== "string") {
    return false;
  }

  if (textExtraction !== undefined && !isValidTextExtraction(textExtraction)) {
    return false;
  }

  if (markdown !== undefined && typeof markdown !== "string") {
    return false;
  }

  const validateStringArray = (value: unknown) =>
    Array.isArray(value) ? value.every((item) => typeof item === "string") : false;

  if (designDetails !== undefined) {
    if (!designDetails || typeof designDetails !== "object") {
      return false;
    }

    const { bounds, viewport, colorPalette, fontFamilies, fontMetrics } =
      designDetails as SaveContextPayload["designDetails"];

    if (
      !bounds ||
      typeof bounds.width !== "number" ||
      typeof bounds.height !== "number" ||
      typeof bounds.top !== "number" ||
      typeof bounds.left !== "number"
    ) {
      return false;
    }

    if (
      !viewport ||
      typeof viewport.scrollX !== "number" ||
      typeof viewport.scrollY !== "number" ||
      typeof viewport.width !== "number" ||
      typeof viewport.height !== "number"
    ) {
      return false;
    }

    if (colorPalette && !validateStringArray(colorPalette)) {
      return false;
    }
    if (fontFamilies && !validateStringArray(fontFamilies)) {
      return false;
    }
    if (fontMetrics && !validateStringArray(fontMetrics)) {
      return false;
    }
  }

  if (styles !== undefined && !isRecordOfStrings(styles)) {
    return false;
  }

  if (cssTokens !== undefined && !isRecordOfStrings(cssTokens)) {
    return false;
  }

  if (selectionPath !== undefined && typeof selectionPath !== "string") {
    return false;
  }

  if (originUrl !== undefined && typeof originUrl !== "string") {
    return false;
  }

  if (pageTitle !== undefined && typeof pageTitle !== "string") {
    return false;
  }

  if (screenshot !== undefined && typeof screenshot !== "string") {
    return false;
  }

  if (!html && !textContent) {
    return false;
  }

  return true;
};

// CORS headers so the Chrome extension (running on a chrome-extension:// origin) can call
// this Next.js route without being blocked by the browser. Because the extension always
// passes the Convex bearer token, we can allow any origin while still enforcing auth.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Handle preflight requests from chrome-extension pages.
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

const decodeBase64DataUrl = (dataUrl: string): ArrayBuffer | null => {
  const match = /^data:(?<mime>image\/[a-zA-Z0-9.+-]+);base64,(?<data>[a-zA-Z0-9+/=]+)$/.exec(
    dataUrl,
  );

  if (!match || !match.groups) {
    return null;
  }

  const base64 = match.groups.data;
  const buffer = Buffer.from(base64, "base64");
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
  }

  if (!isValidPayload(payload)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400, headers: corsHeaders });
  }

  let screenshotBytes: ArrayBuffer | undefined;

  if (payload.screenshot) {
    screenshotBytes = decodeBase64DataUrl(payload.screenshot);

    if (!screenshotBytes) {
      return NextResponse.json({ error: "Invalid screenshot encoding" }, { status: 400, headers: corsHeaders });
    }
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }
    token = await getToken({ template: "convex" });
  }

  if (!token) {
    return NextResponse.json({ error: "Failed to mint Convex token" }, { status: 401, headers: corsHeaders });
  }

  try {
    const result = await fetchAction(
      api.contexts.saveContextDraftWithAssets,
      {
        type: payload.type,
        html: payload.html,
        textContent: payload.textContent,
        textExtraction: payload.textExtraction,
        markdown: payload.markdown,
        designDetails: payload.designDetails,
        styles: payload.styles,
        cssTokens: payload.cssTokens,
        selectionPath: payload.selectionPath,
        originUrl: payload.originUrl,
        pageTitle: payload.pageTitle,
        screenshot: screenshotBytes,
      },
      {
        token,
      },
    );

    return NextResponse.json({ contextId: result.contextId }, { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
