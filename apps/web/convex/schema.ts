import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Schema for element capture flow:
// - `users` stores one document per Clerk identity so captures can be joined.
// - `contexts` stores raw snippets captured from the extension before workflows run.
export default defineSchema({
  numbers: defineTable({
    value: v.number(),
  }),
  users: defineTable({
    identityId: v.string(),
    clerkUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    lastSeenAt: v.number(),
  }).index("by_identityId", ["identityId"]),
  contexts: defineTable({
    userId: v.id("users"),
    type: v.union(v.literal("design"), v.literal("text")),
    html: v.optional(v.string()),
    textContent: v.optional(v.string()),
    markdown: v.optional(v.string()),
    textExtraction: v.optional(
      v.object({
        strategy: v.union(
          v.literal("site_adapter"),
          v.literal("dom_tree_walker"),
          v.literal("inner_text"),
          v.literal("text_content"),
        ),
        adapter: v.optional(v.string()),
      }),
    ),
    // Additional design metadata captured by the extension.
    styles: v.optional(v.record(v.string(), v.string())),
    cssTokens: v.optional(v.record(v.string(), v.string())),
    screenshotStorageId: v.optional(v.id("_storage")),
    originUrl: v.optional(v.string()),
    pageTitle: v.optional(v.string()),
    selectionPath: v.optional(v.string()),
    aiPrompt: v.optional(v.string()),
    aiResponse: v.optional(v.string()),
    aiModel: v.optional(v.string()),
    aiError: v.optional(v.string()),
    processedAt: v.optional(v.number()),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId", "createdAt"]),
});
