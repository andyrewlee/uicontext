"use client";

import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react";
import { useMemo, useState } from "react";
import { SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ContextCopyButtons } from "@/components/ContextCopyButtons";

type FilterValue = "all" | "design" | "text";

type ContextRecord = {
  _id: Id<"contexts">;
  type: "design" | "text";
  html?: string | null;
  textContent?: string | null;
  styles?: Record<string, string> | null;
  cssTokens?: Record<string, string> | null;
  selectionPath?: string | null;
  originUrl?: string | null;
  pageTitle?: string | null;
  screenshotStorageId?: Id<"_storage"> | null;
  screenshotUrl?: string | null;
  status: "queued" | "processing" | "completed" | "failed";
  aiPrompt?: string | null;
  aiResponse?: string | null;
  aiModel?: string | null;
  aiError?: string | null;
  processedAt?: number | null;
  createdAt: number;
  updatedAt: number;
};

const statusStyles: Record<string, string> = {
  queued: "bg-yellow-100 text-yellow-700 border-yellow-200",
  processing: "bg-amber-100 text-amber-700 border-amber-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  failed: "bg-rose-100 text-rose-700 border-rose-200",
};

const typeStyles: Record<string, string> = {
  design: "bg-indigo-100 text-indigo-700 border-indigo-200",
  text: "bg-sky-100 text-sky-700 border-sky-200",
};

const filterOptions: Array<{ label: string; value: FilterValue }> = [
  { label: "All contexts", value: "all" },
  { label: "Design", value: "design" },
  { label: "Text", value: "text" },
];

const StatusBadge = ({
  label,
  kind,
}: {
  label: string;
  kind: "status" | "type";
}) => {
  const styles = kind === "status" ? statusStyles[label] : typeStyles[label];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles ?? "bg-slate-100 text-slate-600 border-slate-200"}`}
    >
      {label}
    </span>
  );
};

const Header = () => (
  <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-background/95 px-6 py-4 backdrop-blur">
    <div className="flex flex-col">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Context dashboard
      </span>
      <h1 className="text-2xl font-bold text-slate-900">UI Context Library</h1>
    </div>
    <UserButton />
  </header>
);

const SignInPrompt = () => (
  <div className="flex h-full flex-col items-center justify-center gap-4 py-24">
    <h2 className="text-2xl font-semibold text-slate-900">Sign in to view captures</h2>
    <p className="max-w-sm text-center text-sm text-slate-500">
      Connect your Clerk account to explore saved design and text contexts, AI summaries, and
      screenshots captured from the extension.
    </p>
    <SignInButton mode="modal">
      <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
        Sign in with Clerk
      </button>
    </SignInButton>
  </div>
);

const LoadingState = () => (
  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-16 text-center text-sm text-slate-500">
    Loading captured contexts…
  </div>
);

const EmptyState = ({ filter }: { filter: FilterValue }) => (
  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
    <h3 className="text-lg font-semibold text-slate-800">No contexts yet</h3>
    <p className="mt-2 text-sm text-slate-500">
      {filter === "all"
        ? "Use the browser extension to capture a snippet, then refresh."
        : `No ${filter} captures yet — switch modes in the extension and try again.`}
    </p>
  </div>
);

const ContextSummary = ({ contexts }: { contexts: ContextRecord[] }) => {
  const counts = useMemo(() => {
    return contexts.reduce(
      (acc, context) => {
        acc.total += 1;
        acc[context.status] = (acc[context.status] ?? 0) + 1;
        return acc;
      },
      { total: 0 } as Record<string, number>,
    );
  }, [contexts]);

  const statusOrder: Array<keyof typeof statusStyles> = [
    "queued",
    "processing",
    "completed",
    "failed",
  ];

  return (
    <div className="grid gap-3 md:grid-cols-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total</p>
        <p className="mt-1 text-2xl font-bold text-slate-900">{counts.total}</p>
      </div>
      {statusOrder.map((status) => (
        <div key={status} className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {status}
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{counts[status] ?? 0}</p>
        </div>
      ))}
    </div>
  );
};

const ContextCard = ({ context }: { context: ContextRecord }) => {
  const createdAt = new Date(context.createdAt);
  const updatedAt = new Date(context.updatedAt);
  const showAiPreview = context.aiResponse && context.aiResponse.length > 0;
  const previewText = showAiPreview
    ? context.aiResponse.slice(0, 280)
    : context.textContent?.slice(0, 280) ?? "";

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={context.type} kind="type" />
            <StatusBadge label={context.status} kind="status" />
          </div>
          <Link
            href={`/context/${context._id}`}
            className="text-lg font-semibold text-slate-900 hover:text-slate-600"
          >
            {context.pageTitle ?? "Untitled capture"}
          </Link>
          <p className="text-xs text-slate-500">
            {context.originUrl ? (
              <a
                href={context.originUrl}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted"
              >
                {context.originUrl}
              </a>
            ) : (
              "Origin unknown"
            )}
          </p>
        </div>
        <div className="text-right text-xs text-slate-400">
          <p>Captured: {createdAt.toLocaleString()}</p>
          <p>Updated: {updatedAt.toLocaleString()}</p>
        </div>
      </div>
      {previewText && (
        <p className="text-sm leading-relaxed text-slate-600">
          {previewText}
          {previewText.length === 280 ? "…" : ""}
        </p>
      )}
      <ContextCopyButtons
        context={{
          type: context.type,
          aiPrompt: context.aiPrompt,
          aiResponse: context.aiResponse,
          html: context.html,
          styles: context.styles,
          cssTokens: context.cssTokens,
          textContent: context.textContent,
          screenshotUrl: context.screenshotUrl,
        }}
      />
    </article>
  );
};

const Dashboard = () => {
  const [filter, setFilter] = useState<FilterValue>("all");
  const queryArgs = filter === "all" ? {} : { type: filter };
  const contexts = useQuery(api.contexts.listContexts, queryArgs) as
    | ContextRecord[]
    | undefined;

  if (contexts === undefined) {
    return <LoadingState />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <ContextSummary contexts={contexts} />
        <div className="flex gap-2">
          {filterOptions.map((option) => {
            const isActive = option.value === filter;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                className={`rounded-full border px-4 py-2 text-xs font-medium transition ${
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-800"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {contexts.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="grid gap-4">
          {contexts.map((context) => (
            <ContextCard key={context._id} context={context} />
          ))}
        </div>
      )}
    </div>
  );
};

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Header />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
        <Authenticated>
          <Dashboard />
        </Authenticated>
        <AuthLoading>
          <LoadingState />
        </AuthLoading>
        <Unauthenticated>
          <SignInPrompt />
        </Unauthenticated>
      </main>
    </div>
  );
}
