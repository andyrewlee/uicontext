import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Upsert the calling user into the `users` table on every authenticated entrypoint.
// This keeps the Convex user document in sync with Clerk identity metadata.
export const ensureUser = mutation({
  args: {
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const now = Date.now();

    // Look up the current identity using the stable token identifier.
    const existing = await ctx.db
      .query("users")
      .withIndex("by_identityId", (q) => q.eq("identityId", identity.tokenIdentifier))
      .first();

    const email = args.email ?? identity.email ?? undefined;
    const name = args.name ?? identity.name ?? undefined;
    const imageUrl = args.imageUrl ?? identity.pictureUrl ?? undefined;

    if (existing) {
      const patch: Record<string, unknown> = {
        lastSeenAt: now,
      };

      // Only overwrite metadata when a value is provided.
      if (email !== undefined) {
        patch.email = email;
      }
      if (name !== undefined) {
        patch.name = name;
      }
      if (imageUrl !== undefined) {
        patch.imageUrl = imageUrl;
      }

      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    // Create a new user document if this identity has never been seen before.
    return ctx.db.insert("users", {
      identityId: identity.tokenIdentifier,
      clerkUserId: identity.subject,
      email,
      name,
      imageUrl,
      lastSeenAt: now,
    });
  },
});
