import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

import { action, mutation, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import type { Doc } from "./_generated/dataModel";

// Insert a raw capture document. This mutation is invoked via the action below after
// any optional screenshot bytes are stored in Convex storage.
export const saveContextDraft = mutation({
  args: {
    type: v.union(v.literal("design"), v.literal("text")),
    html: v.optional(v.string()),
    textContent: v.optional(v.string()),
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
    const contextId = await ctx.db.insert("contexts", {
      userId: user._id,
      type: args.type,
      html: args.html,
      textContent: args.textContent,
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
      processedAt: undefined,
      status: "queued",
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
      styles: args.styles,
      cssTokens: args.cssTokens,
      selectionPath: args.selectionPath,
      originUrl: args.originUrl,
      pageTitle: args.pageTitle,
      screenshotStorageId,
    });

    // Kick off the appropriate workflow in the background so queued contexts become completed.
    const target =
      args.type === "design"
        ? api.contexts.processDesignContext
        : api.contexts.processTextContext;

    await ctx.scheduler.runAfter(0, target, { contextId });

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
const MAX_HTML_LENGTH = 6000;
const MAX_TEXT_LENGTH = 2500;
const MAX_STYLE_ENTRIES = 80;
const MAX_TOKEN_ENTRIES = 60;

const truncate = (value: string | null | undefined, limit: number) => {
  if (!value) {
    return "";
  }

  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }

  return `${trimmed.slice(0, limit)}…`;
};

const formatKeyValueList = (
  record: Record<string, string> | undefined,
  limit: number,
) => {
  if (!record || Object.keys(record).length === 0) {
    return "None captured.";
  }

  const entries = Object.entries(record);
  const lines = entries.slice(0, limit).map(([key, value]) => `${key}: ${truncate(value, 120)}`);

  if (entries.length > limit) {
    lines.push(`…and ${entries.length - limit} more properties`);
  }

  return lines.join("\n");
};

const buildDesignPrompt = (context: Doc<"contexts">) => {
  const htmlBlock = truncate(context.html ?? "", MAX_HTML_LENGTH);
  const visibleText = truncate(context.textContent ?? "", MAX_TEXT_LENGTH);
  const stylesBlock = formatKeyValueList(context.styles, MAX_STYLE_ENTRIES);
  const tokensBlock = formatKeyValueList(context.cssTokens, MAX_TOKEN_ENTRIES);

  return [
    "You are a senior product designer and front-end engineer. Evaluate the captured UI element and produce concrete feedback the builder can act on.",
    `Context metadata:
- Page title: ${context.pageTitle ?? "Untitled"}
- Origin URL: ${context.originUrl ?? "Unknown"}
- Selection path: ${context.selectionPath ?? "N/A"}
- Captured at (ISO): ${new Date(context.createdAt).toISOString()}`,
    htmlBlock
      ? `HTML snippet:
\`\`\`html
${htmlBlock}
\`\`\``
      : "No HTML snippet was captured.",
    visibleText
      ? `Visible text content:
\`\`\`
${visibleText}
\`\`\``
      : "No visible text content was captured.",
    `Computed CSS declarations (subset):
${stylesBlock}`,
    `CSS custom properties (subset):
${tokensBlock}`,
    "Respond in Markdown with the following sections:\n1. **At a Glance** – 2 short bullets summarizing what this component communicates.\n2. **Design Recommendations** – 3 to 5 numbered suggestions referencing specific visual details (colors, spacing, typography, accessibility).\n3. **Implementation Hints** – Bullet list of concrete CSS/HTML tweaks (selectors + values) to achieve the recommendations.\nKeep the response under 250 words.",
  ].join("\n\n");
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
"""` : "No text content was captured.",
    htmlBlock
      ? `Surrounding HTML (truncated):
\`\`\`html
${htmlBlock}
\`\`\``
      : "No HTML snippet was captured.",
    "Respond in Markdown with the following sections:\n1. **Summary** – What the current copy achieves.\n2. **Opportunities** – 3 bullet points describing clarity or persuasion improvements.\n3. **Suggested Rewrite** – Provide a concise rewrite (<= 3 sentences) that keeps intent but improves clarity.\n4. **CTA Ideas** – 2 short call-to-action phrases.",
  ].join("\n\n");
};

type ProcessingPayload = {
  context: Doc<"contexts">;
  ownerIdentityId: string | null;
};

const processContextWithGemini = async (
  ctx: ActionCtx,
  contextId: Id<"contexts">,
  variant: "design" | "text",
) => {
  const payload = (await ctx.runQuery(api.contexts.getContextForProcessing, {
    contextId,
  })) as ProcessingPayload | null;

  if (!payload) {
    return { status: "not_found" as const };
  }

  const { context, ownerIdentityId } = payload;
  if (context.type !== variant) {
    return { status: "skipped" as const };
  }

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
  const prompt = variant === "design" ? buildDesignPrompt(context) : buildTextPrompt(context);

  try {
    const result = await generateText({
      model,
      prompt,
      maxOutputTokens: 1024,
      temperature: variant === "design" ? 0.65 : 0.55,
    });

    const text = result.text.trim();
    const modelId = result.response?.modelId ?? GEMINI_MODEL;

    await ctx.runMutation(api.contexts.storeContextResult, {
      contextId,
      prompt,
      response: text,
      model: modelId,
    });

    return { status: "completed" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Gemini error";
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
    return processContextWithGemini(ctx, args.contextId, "design");
  },
});

export const processTextContext = action({
  args: {
    contextId: v.id("contexts"),
  },
  handler: async (ctx, args) => {
    "use node";
    return processContextWithGemini(ctx, args.contextId, "text");
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
