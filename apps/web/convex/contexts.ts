import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

import { action, mutation, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import type { Doc } from "./_generated/dataModel";
import { logError, logInfo } from "./logging";
import { safeStringify } from "./util";

// Insert a raw capture document. This mutation is invoked via the action below after
// any optional screenshot bytes are stored in Convex storage.
export const saveContextDraft = mutation({
  args: {
    type: v.union(v.literal("design"), v.literal("text")),
    html: v.optional(v.string()),
    textContent: v.optional(v.string()),
    markdown: v.optional(v.string()),
    textExtraction: v.optional(
      v.object({
        strategy: v.union(
          v.literal("dom_tree_walker"),
          v.literal("inner_text"),
          v.literal("text_content"),
        ),
        adapter: v.optional(v.string()),
      }),
    ),
    designDetails: v.optional(
      v.object({
        bounds: v.object({
          width: v.number(),
          height: v.number(),
          top: v.number(),
          left: v.number(),
        }),
        viewport: v.object({
          scrollX: v.number(),
          scrollY: v.number(),
          width: v.number(),
          height: v.number(),
        }),
        colorPalette: v.optional(v.array(v.string())),
        fontFamilies: v.optional(v.array(v.string())),
        fontMetrics: v.optional(v.array(v.string())),
      }),
    ),
    styles: v.optional(v.record(v.string(), v.string())),
    cssTokens: v.optional(v.record(v.string(), v.string())),
    selectionPath: v.optional(v.string()),
    originUrl: v.optional(v.string()),
    pageTitle: v.optional(v.string()),
    screenshotStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const now = Date.now();

    // Make sure the caller has a user document we can link the capture to.
    let user = await ctx.db
      .query("users")
      .withIndex("by_identityId", (q) => q.eq("identityId", identity.tokenIdentifier))
      .first();

    if (!user) {
      // First-time caller: create the user record from Clerk identity fields.
      const newUserId = await ctx.db.insert("users", {
        identityId: identity.tokenIdentifier,
        clerkUserId: identity.subject,
        email: identity.email ?? undefined,
        name: identity.name ?? undefined,
        imageUrl: identity.pictureUrl ?? undefined,
        lastSeenAt: now,
      });
      user = await ctx.db.get(newUserId);
    } else {
      // Keep a heartbeat timestamp for returning sessions.
      await ctx.db.patch(user._id, { lastSeenAt: now });
    }

    if (!user) {
      throw new Error("Failed to resolve user");
    }

    // Insert a queued context; later workflows will enrich it.
    const isDesignCapture = args.type === "design";

    const contextId = await ctx.db.insert("contexts", {
      userId: user._id,
      type: args.type,
      html: args.html,
      textContent: args.textContent,
      textExtraction: args.textExtraction ?? undefined,
      markdown: args.markdown ?? undefined,
      designDetails: args.designDetails ?? undefined,
      styles: args.styles,
      cssTokens: args.cssTokens,
      selectionPath: args.selectionPath,
      originUrl: args.originUrl ?? undefined,
      pageTitle: args.pageTitle ?? undefined,
      screenshotStorageId: args.screenshotStorageId ?? undefined,
      aiPrompt: undefined,
      aiResponse: undefined,
      aiModel: undefined,
      aiError: undefined,
      processedAt: isDesignCapture ? undefined : now,
      status: isDesignCapture ? "queued" : "completed",
      createdAt: now,
      updatedAt: now,
    });

    return { contextId };
  },
});

// Action wrapper that stores optional screenshot bytes before invoking the mutation.
export const saveContextDraftWithAssets = action({
  args: {
    type: v.union(v.literal("design"), v.literal("text")),
    html: v.optional(v.string()),
    textContent: v.optional(v.string()),
    markdown: v.optional(v.string()),
    textExtraction: v.optional(
      v.object({
        strategy: v.union(
          v.literal("dom_tree_walker"),
          v.literal("inner_text"),
          v.literal("text_content"),
        ),
        adapter: v.optional(v.string()),
      }),
    ),
    designDetails: v.optional(
      v.object({
        bounds: v.object({
          width: v.number(),
          height: v.number(),
          top: v.number(),
          left: v.number(),
        }),
        viewport: v.object({
          scrollX: v.number(),
          scrollY: v.number(),
          width: v.number(),
          height: v.number(),
        }),
        colorPalette: v.optional(v.array(v.string())),
        fontFamilies: v.optional(v.array(v.string())),
        fontMetrics: v.optional(v.array(v.string())),
      }),
    ),
    styles: v.optional(v.record(v.string(), v.string())),
    cssTokens: v.optional(v.record(v.string(), v.string())),
    selectionPath: v.optional(v.string()),
    originUrl: v.optional(v.string()),
    pageTitle: v.optional(v.string()),
    screenshot: v.optional(v.bytes()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ contextId: Id<"contexts"> }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    // Persist the screenshot first (if provided) so we can reference the storage id
    // from the mutation. Using an action grants access to ctx.storage.store.
    let screenshotStorageId: Id<"_storage"> | undefined;
    if (args.screenshot) {
      const blob = new Blob([args.screenshot], { type: "image/png" });
      screenshotStorageId = await ctx.storage.store(blob);
    }

    // Delegate the actual document insert to the mutation so schema validation remains in one place.
    const { contextId } = await ctx.runMutation(api.contexts.saveContextDraft, {
      type: args.type,
      html: args.html,
      textContent: args.textContent,
      textExtraction: args.textExtraction,
      markdown: args.markdown,
      designDetails: args.designDetails,
      styles: args.styles,
      cssTokens: args.cssTokens,
      selectionPath: args.selectionPath,
      originUrl: args.originUrl,
      pageTitle: args.pageTitle,
      screenshotStorageId,
    });

    if (args.type === "design") {
      // Kick off the design workflow so queued contexts become completed.
      await ctx.scheduler.runAfter(0, api.contexts.processDesignContext, { contextId });
    }

    return { contextId };
  },
});

export const listContexts = query({
  args: {
    type: v.optional(v.union(v.literal("design"), v.literal("text"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_identityId", (q) => q.eq("identityId", identity.tokenIdentifier))
      .first();

    if (!user) {
      return [];
    }

    const contexts = await ctx.db
      .query("contexts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const filtered = args.type
      ? contexts.filter((context) => context.type === args.type)
      : contexts;

    const sorted = filtered.sort((a, b) => b.createdAt - a.createdAt);

    const enriched = await Promise.all(
      sorted.map(async (context) => {
        const screenshotUrl = context.screenshotStorageId
          ? await ctx.storage.getUrl(context.screenshotStorageId)
          : null;

        return {
          _id: context._id,
          type: context.type,
          html: context.html,
          textContent: context.textContent,
          textExtraction: context.textExtraction,
          markdown: context.markdown,
          designDetails: context.designDetails,
          styles: context.styles,
          cssTokens: context.cssTokens,
          selectionPath: context.selectionPath,
          originUrl: context.originUrl,
          pageTitle: context.pageTitle,
          screenshotStorageId: context.screenshotStorageId,
          screenshotUrl,
          status: context.status,
          aiPrompt: context.aiPrompt ?? null,
          aiResponse: context.aiResponse ?? null,
          aiModel: context.aiModel ?? null,
          aiError: context.aiError ?? null,
          processedAt: context.processedAt ?? null,
          createdAt: context.createdAt,
          updatedAt: context.updatedAt,
        };
      }),
    );

    return enriched;
  },
});

export const getContextById = query({
  args: {
    contextId: v.id("contexts"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_identityId", (q) => q.eq("identityId", identity.tokenIdentifier))
      .first();

    if (!user) {
      return null;
    }

    const context = await ctx.db.get(args.contextId);
    if (!context || context.userId !== user._id) {
      return null;
    }

    const screenshotUrl = context.screenshotStorageId
      ? await ctx.storage.getUrl(context.screenshotStorageId)
      : null;

    return {
      _id: context._id,
      type: context.type,
      html: context.html,
      textContent: context.textContent,
      textExtraction: context.textExtraction,
      markdown: context.markdown,
      designDetails: context.designDetails,
      styles: context.styles,
      cssTokens: context.cssTokens,
      selectionPath: context.selectionPath,
      originUrl: context.originUrl,
      pageTitle: context.pageTitle,
      screenshotStorageId: context.screenshotStorageId,
      screenshotUrl,
      status: context.status,
      aiPrompt: context.aiPrompt ?? null,
      aiResponse: context.aiResponse ?? null,
      aiModel: context.aiModel ?? null,
      aiError: context.aiError ?? null,
      processedAt: context.processedAt ?? null,
      createdAt: context.createdAt,
      updatedAt: context.updatedAt,
    };
  },
});

export const getContextForProcessing = query({
  args: {
    contextId: v.id("contexts"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const context = await ctx.db.get(args.contextId);
    if (!context) {
      return null;
    }

    const owner = await ctx.db.get(context.userId);
    const ownerIdentityId = owner?.identityId ?? null;

    if (
      identity &&
      ownerIdentityId &&
      identity.tokenIdentifier !== ownerIdentityId
    ) {
      throw new Error("Forbidden");
    }

    if (identity && !ownerIdentityId) {
      throw new Error("Forbidden");
    }

    return {
      context,
      ownerIdentityId,
    };
  },
});

export const markContextProcessing = mutation({
  args: {
    contextId: v.id("contexts"),
  },
  handler: async (ctx, args) => {
    const context = await ctx.db.get(args.contextId);
    if (!context) {
      return;
    }

    const identity = await ctx.auth.getUserIdentity();
    if (identity) {
      const owner = await ctx.db.get(context.userId);
      if (!owner || owner.identityId !== identity.tokenIdentifier) {
        throw new Error("Forbidden");
      }
    }

    const now = Date.now();
    await ctx.db.patch(args.contextId, {
      status: "processing",
      aiError: undefined,
      updatedAt: now,
    });
  },
});

export const storeContextResult = mutation({
  args: {
    contextId: v.id("contexts"),
    prompt: v.string(),
    response: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const context = await ctx.db.get(args.contextId);
    if (!context) {
      return;
    }

    const identity = await ctx.auth.getUserIdentity();
    if (identity) {
      const owner = await ctx.db.get(context.userId);
      if (!owner || owner.identityId !== identity.tokenIdentifier) {
        throw new Error("Forbidden");
      }
    }

    const now = Date.now();
    await ctx.db.patch(args.contextId, {
      status: "completed",
      aiPrompt: args.prompt,
      aiResponse: args.response,
      aiModel: args.model,
      aiError: undefined,
      processedAt: now,
      updatedAt: now,
    });
  },
});

export const storeContextFailure = mutation({
  args: {
    contextId: v.id("contexts"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const context = await ctx.db.get(args.contextId);
    if (!context) {
      return;
    }

    const identity = await ctx.auth.getUserIdentity();
    if (identity) {
      const owner = await ctx.db.get(context.userId);
      if (!owner || owner.identityId !== identity.tokenIdentifier) {
        throw new Error("Forbidden");
      }
    }

    const now = Date.now();
    await ctx.db.patch(args.contextId, {
      status: "failed",
      aiError: args.error,
      processedAt: now,
      updatedAt: now,
    });
  },
});

const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_TEXT_LENGTH = 400;

const collectTextFromParts = (parts: unknown): string => {
  if (!Array.isArray(parts)) {
    return "";
  }

  const collected: string[] = [];

  const visit = (part: unknown) => {
    if (!part || typeof part !== "object") {
      return;
    }
    const candidate = part as { text?: unknown; content?: unknown };
    if (typeof candidate.text === "string" && candidate.text.trim().length > 0) {
      collected.push(candidate.text);
    }
    if (Array.isArray(candidate.content)) {
      candidate.content.forEach(visit);
    }
  };

  parts.forEach(visit);

  return collected.join(" ");
};

const deriveModelText = (result: Awaited<ReturnType<typeof generateText>>): {
  text: string;
  debug?: string;
} => {
  const direct = (result.text ?? "").trim();
  if (direct.length > 0) {
    return { text: direct };
  }

  const fromContent = collectTextFromParts(result.content).trim();
  if (fromContent.length > 0) {
    return { text: fromContent };
  }

  const responseMessages = (result.response as { messages?: unknown })?.messages;
  const fromMessages = collectTextFromParts(responseMessages).trim();
  if (fromMessages.length > 0) {
    return { text: fromMessages };
  }

  return {
    text: "",
    debug: safeStringify({
      content: result.content,
    response: result.response,
  }),
  };
};

const runGenerateText = async (
  model: ReturnType<ReturnType<typeof createGoogleGenerativeAI>>,
  prompt: string,
  options: { maxOutputTokens: number; temperature: number },
) => {
  const result = await generateText({
    model,
    prompt: [{ role: "system", content: "You are a concise UI design describer." },
      { role: "user", content: prompt }],
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature,
  });

  const derived = deriveModelText(result);

  return {
    text: derived.text,
    debug: derived.debug,
    modelId: result.response?.modelId ?? GEMINI_MODEL,
  };
};

// (removed legacy fallback helpers)

const truncate = (value: string | null | undefined, limit: number) => {
  if (!value) {
    return "";
  }

  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }

  const suffix = "…";
  if (limit <= suffix.length) {
    return suffix;
  }
  return `${trimmed.slice(0, limit - suffix.length)}${suffix}`;
};

const buildDesignPrompt = (context: Doc<"contexts">, screenshotUrl: string | null) => {
  const urlLine = screenshotUrl
    ? `Screenshot reference: ${screenshotUrl}`
    : "Screenshot reference: unavailable";

  return [
    "You are an expert front-end engineer describing a captured UI component so another agent can rebuild it without seeing the image directly.",
    urlLine,
    `Context: title="${context.pageTitle ?? "Untitled"}", origin=${context.originUrl ?? "unknown"}.`,
    "Respond with exactly one paragraph that begins with `Recreate this screenshot: <url>.` where <url> is the screenshot URL above (or the text `unavailable` if no screenshot is provided).",
    "After that leading clause, continue the same paragraph with a high-level narrative description that makes it clear the goal is to reproduce the captured interface pixel-for-pixel. Call out the layout, number of sections or rows, ordering of elements, key copy blocks, color palette, typography choices, and interaction affordances (icons, badges, hover/focus states).",
    "Explicitly instruct the implementer not to deviate from the captured visual design and to match spacing, borders, and alignment as closely as possible.",
    "Do not add extra lines, bullets, or code blocks.",
  ].join("\n\n");
};

const buildDeterministicDesignBrief = (
  context: Doc<"contexts">,
  screenshotUrl: string | null,
): string => {
  const bounds = context.designDetails?.bounds;
  const palette = context.designDetails?.colorPalette?.slice(0, 4) ?? [];
  const fonts = context.designDetails?.fontFamilies?.slice(0, 2) ?? [];
  const contentSummary = context.textContent?.trim()
    ? truncate(
        context.textContent
          .replace(/\s+/g, " ")
          .split(/(?<=[.!?])\s+/)
          .slice(0, 3)
          .join(" ")
          .replace(/"/g, ""),
        300,
      )
    : null;

  const pieces: string[] = [];

  const viewport = context.designDetails?.viewport;
  const baseDescription = `This component captures the "${context.pageTitle ?? "Untitled"}" UI`;
  pieces.push(
    bounds
      ? `${baseDescription} at roughly ${bounds.width}×${bounds.height}px near (${bounds.left}, ${bounds.top}) relative to the viewport.`
      : `${baseDescription}.`,
  );

  if (viewport) {
    pieces.push(
      `Viewport was approximately ${viewport.width}×${viewport.height}px with scroll offset (${viewport.scrollX}, ${viewport.scrollY}), so respect long vertical flow when rebuilding.`,
    );
  }

  if (palette.length > 0) {
    pieces.push(`Key colors include ${palette.join(", ")}.`);
  }

  if (fonts.length > 0) {
    pieces.push(`Typography leans on ${fonts.join(", ")} with consistent weights for headings and body copy.`);
  }

  if (contentSummary) {
    pieces.push(`Primary messaging surfaces content such as ${contentSummary}.`);
  }

  pieces.push(
    "Ensure the rebuilt UI mirrors the captured layout and hierarchy exactly — match spacing, alignment, border radius, and interactive affordances seen in the screenshot without introducing new visual treatments.",
  );

  const paragraph = pieces.join(" ").trim();

  return `Recreate this screenshot: ${screenshotUrl ?? "unavailable"}. ${paragraph}`;
};

const buildTextPrompt = (context: Doc<"contexts">) => {
  const htmlBlock = truncate(context.html ?? "", 2000);
  const visibleText = truncate(context.textContent ?? "", MAX_TEXT_LENGTH);

  return [
    "You are a senior product marketing copywriter. Analyze the captured copy and improve it for clarity and conversion.",
    `Context metadata:
- Page title: ${context.pageTitle ?? "Untitled"}
- Origin URL: ${context.originUrl ?? "Unknown"}
- Selection path: ${context.selectionPath ?? "N/A"}
- Captured at (ISO): ${new Date(context.createdAt).toISOString()}`,
    visibleText
      ? `Original copy:
"""
${visibleText}
"""`
      : "No text content was captured.",
    htmlBlock
      ? `Surrounding HTML (truncated):
\`\`\`html
${htmlBlock}
\`\`\``
      : "No HTML snippet was captured.",
    "Respond in Markdown with the following sections:\n1. **Summary** – what the current copy achieves.\n2. **Opportunities** – 3 bullet points describing clarity or persuasion improvements.\n3. **Suggested Rewrite** – a concise rewrite (≤3 sentences) that preserves intent but improves clarity.\n4. **CTA Ideas** – 2 short call-to-action phrases.",
  ].join("\n\n");
};

type ProcessingPayload = {
  context: Doc<"contexts">;
  ownerIdentityId: string | null;
};

const processDesignContextWithGemini = async (
  ctx: ActionCtx,
  contextId: Id<"contexts">,
) => {
  const payload = (await ctx.runQuery(api.contexts.getContextForProcessing, {
    contextId,
  })) as ProcessingPayload | null;

  if (!payload) {
    return { status: "not_found" as const };
  }

  const { context, ownerIdentityId } = payload;
  if (context.type !== "design") {
    return { status: "skipped" as const };
  }

  logInfo("Design workflow queued", {
    contextId: context._id,
    screenshotCaptured: Boolean(context.screenshotStorageId),
  });

  const identity = await ctx.auth.getUserIdentity();
  if (identity && ownerIdentityId && identity.tokenIdentifier !== ownerIdentityId) {
    throw new Error("Forbidden");
  }

  if (context.status === "completed" && context.aiResponse) {
    return { status: "already_completed" as const };
  }

  if (context.status === "processing") {
    return { status: "in_progress" as const };
  }

  await ctx.runMutation(api.contexts.markContextProcessing, { contextId });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    await ctx.runMutation(api.contexts.storeContextFailure, {
      contextId,
      error: "GEMINI_API_KEY is not configured.",
    });
    return { status: "failed" as const };
  }

  const google = createGoogleGenerativeAI({ apiKey });
  const model = google(GEMINI_MODEL);

  let screenshotUrl: string | null = null;
  if (context.screenshotStorageId) {
    screenshotUrl = await ctx.storage.getUrl(context.screenshotStorageId);
  }

  const prompt = buildDesignPrompt(context, screenshotUrl);

  try {
    const result = await runGenerateText(model, prompt, {
      maxOutputTokens: 512,
      temperature: 0.5,
    });

    const resolvedText =
      result.text && result.text.length > 0
        ? result.text
        : buildDeterministicDesignBrief(context, screenshotUrl);

    await ctx.runMutation(api.contexts.storeContextResult, {
      contextId,
      prompt,
      response: resolvedText,
      model: result.text ? result.modelId : "deterministic-fallback",
    });

    logInfo("Design workflow completed", {
      contextId: context._id,
      responseLength: resolvedText.length,
      responsePreview: resolvedText.slice(0, 160),
      usedDeterministicFallback: !result.text,
    });

    return { status: "completed" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Gemini error";
    logError("Design workflow failed", {
      contextId: context._id,
      error: message,
      promptLength: prompt.length,
      screenshotCaptured: Boolean(screenshotUrl),
    });
    await ctx.runMutation(api.contexts.storeContextFailure, {
      contextId,
      error: truncate(message, 500),
    });
    return { status: "failed" as const };
  }
};

export const processDesignContext = action({
  args: {
    contextId: v.id("contexts"),
  },
  handler: async (ctx, args) => {
    "use node";
    return processDesignContextWithGemini(ctx, args.contextId);
  },
});

const processTextContextWithGemini = async (
  ctx: ActionCtx,
  contextId: Id<"contexts">,
) => {
  const payload = (await ctx.runQuery(api.contexts.getContextForProcessing, {
    contextId,
  })) as ProcessingPayload | null;

  if (!payload) {
    return { status: "not_found" as const };
  }

  const { context, ownerIdentityId } = payload;
  if (context.type !== "text") {
    return { status: "skipped" as const };
  }

  logInfo("Text workflow queued", {
    contextId: context._id,
  });

  const identity = await ctx.auth.getUserIdentity();
  if (identity && ownerIdentityId && identity.tokenIdentifier !== ownerIdentityId) {
    throw new Error("Forbidden");
  }

  if (context.status === "completed" && context.aiResponse) {
    return { status: "already_completed" as const };
  }

  if (context.status === "processing") {
    return { status: "in_progress" as const };
  }

  await ctx.runMutation(api.contexts.markContextProcessing, { contextId });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    await ctx.runMutation(api.contexts.storeContextFailure, {
      contextId,
      error: "GEMINI_API_KEY is not configured.",
    });
    return { status: "failed" as const };
  }

  const google = createGoogleGenerativeAI({ apiKey });
  const model = google(GEMINI_MODEL);
  const prompt = buildTextPrompt(context);

  try {
    const result = await generateText({
      model,
      prompt,
      maxOutputTokens: 512,
      temperature: 0.55,
    });

    const { text, debug } = deriveModelText(result);
    if (!text) {
      throw new Error(
        `Gemini returned an empty response for the text brief.${debug ? ` Debug: ${debug}` : ""}`,
      );
    }

    const modelId = result.response?.modelId ?? GEMINI_MODEL;

    await ctx.runMutation(api.contexts.storeContextResult, {
      contextId,
      prompt,
      response: text,
      model: modelId,
    });

    logInfo("Text workflow completed", {
      contextId: context._id,
      responseLength: text.length,
      responsePreview: text.slice(0, 160),
    });

    return { status: "completed" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Gemini error";
    logError("Text workflow failed", {
      contextId: context._id,
      error: message,
      promptLength: prompt.length,
    });
    await ctx.runMutation(api.contexts.storeContextFailure, {
      contextId,
      error: truncate(message, 500),
    });
    return { status: "failed" as const };
  }
};

export const processTextContext = action({
  args: {
    contextId: v.id("contexts"),
  },
  handler: async (ctx, args) => {
    "use node";
    return processTextContextWithGemini(ctx, args.contextId);
  },
});

export const fetchScreenshot = action({
  args: {
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    "use node";
    const data = await ctx.storage.get(args.storageId);
    return data ?? null;
  },
});
