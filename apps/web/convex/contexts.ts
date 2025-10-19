import { action, mutation, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

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

    return filtered
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((context) => ({
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
        status: context.status,
        createdAt: context.createdAt,
        updatedAt: context.updatedAt,
      }));
  },
});

export const updateContextStatus = mutation({
  args: {
    contextId: v.id("contexts"),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const context = await ctx.db.get(args.contextId);
    if (!context) {
      throw new Error("Context not found");
    }

    const timestamp = args.updatedAt ?? Date.now();
    await ctx.db.patch(args.contextId, {
      status: args.status,
      updatedAt: timestamp,
    });

    return { status: args.status, updatedAt: timestamp };
  },
});

const runWorkflow = async (ctx: ActionCtx, contextId: Id<"contexts">) => {
  await ctx.runMutation(api.contexts.updateContextStatus, {
    contextId,
    status: "processing",
  });

  // Placeholder: later phases will invoke Gemini and enrich the document.
  const completedAt = Date.now();
  await ctx.runMutation(api.contexts.updateContextStatus, {
    contextId,
    status: "completed",
    updatedAt: completedAt,
  });

  return { status: "completed" as const, completedAt };
};

export const processDesignContext = action({
  args: {
    contextId: v.id("contexts"),
  },
  handler: async (ctx, args) => {
    try {
      return await runWorkflow(ctx, args.contextId);
    } catch (error) {
      await ctx.runMutation(api.contexts.updateContextStatus, {
        contextId: args.contextId,
        status: "failed",
      }).catch(() => undefined);
      throw error;
    }
  },
});

export const processTextContext = action({
  args: {
    contextId: v.id("contexts"),
  },
  handler: async (ctx, args) => {
    try {
      return await runWorkflow(ctx, args.contextId);
    } catch (error) {
      await ctx.runMutation(api.contexts.updateContextStatus, {
        contextId: args.contextId,
        status: "failed",
      }).catch(() => undefined);
      throw error;
    }
  },
});
