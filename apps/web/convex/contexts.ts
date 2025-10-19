import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Store a raw capture on behalf of the authenticated user.
export const saveContextDraft = mutation({
  args: {
    type: v.union(v.literal("design"), v.literal("text")),
    html: v.optional(v.string()),
    textContent: v.optional(v.string()),
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
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });

    return { contextId };
  },
});
