import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ContextCopyButtons } from "@/components/ContextCopyButtons";

type ContextDetailProps = {
  params: {
    id: string;
  };
};

const badgeStyles: Record<string, string> = {
  design: "bg-indigo-100 text-indigo-700 border-indigo-200",
  text: "bg-sky-100 text-sky-700 border-sky-200",
  queued: "bg-yellow-100 text-yellow-700 border-yellow-200",
  processing: "bg-amber-100 text-amber-700 border-amber-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  failed: "bg-rose-100 text-rose-700 border-rose-200",
};

const Badge = ({ label }: { label: string }) => (
  <span
    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeStyles[label] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}
  >
    {label}
  </span>
);

export default async function ContextDetailPage({ params }: ContextDetailProps) {
  const { userId, sessionId, getToken } = auth();
  if (!userId || !sessionId || !getToken) {
    redirect("/");
  }

  const token = await getToken({ template: "convex" });
  if (!token) {
    redirect("/");
  }

  const contextId = params.id as Id<"contexts">;
  const context = await fetchQuery(
    api.contexts.getContextById,
    { contextId },
    { token },
  );

  if (!context) {
    notFound();
  }

  const createdAt = new Date(context.createdAt);
  const updatedAt = new Date(context.updatedAt);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 bg-slate-50 px-6 py-10">
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className="text-sm font-medium text-slate-500 transition hover:text-slate-900"
        >
          ← Back to dashboard
        </Link>
        <div className="flex items-center gap-2">
          <Badge label={context.type} />
          <Badge label={context.status} />
        </div>
      </header>

      <main className="flex flex-col gap-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-bold text-slate-900">
            {context.pageTitle ?? "Untitled capture"}
          </h1>
          {context.originUrl ? (
            <a
              href={context.originUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex text-sm text-slate-500 underline decoration-dotted"
            >
              {context.originUrl}
            </a>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Origin unknown</p>
          )}
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Captured
              </dt>
              <dd className="text-sm text-slate-700">{createdAt.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Updated
              </dt>
              <dd className="text-sm text-slate-700">{updatedAt.toLocaleString()}</dd>
            </div>
            {context.selectionPath && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Selection path
                </dt>
                <dd className="font-mono text-xs text-slate-600">{context.selectionPath}</dd>
              </div>
            )}
            {context.aiModel && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  AI model
                </dt>
                <dd className="text-sm text-slate-700">{context.aiModel}</dd>
              </div>
            )}
            {context.aiError && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-rose-500">
                  Workflow error
                </dt>
                <dd className="text-sm text-rose-600">{context.aiError}</dd>
              </div>
            )}
          </dl>
          <div className="mt-6">
            <ContextCopyButtons
              context={{
                type: context.type,
                aiPrompt: context.aiPrompt,
                aiResponse: context.aiResponse,
                html: context.html,
                styles: context.styles ?? null,
                cssTokens: context.cssTokens ?? null,
                textContent: context.textContent ?? null,
                markdown: context.markdown ?? null,
                screenshotUrl: context.screenshotUrl ?? null,
              }}
            />
          </div>
        </section>

        {context.screenshotUrl && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Screenshot preview</h2>
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={context.screenshotUrl}
                alt="Captured element screenshot"
                className="w-full bg-slate-100 object-contain"
              />
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">AI output</h2>
          {context.aiResponse ? (
            <article className="mt-4 whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
              {context.aiResponse}
            </article>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              Workflow output not ready yet. Status is {context.status}.
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Captured source</h2>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">HTML snippet</h3>
              <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-slate-100 p-3 text-xs text-slate-700">
                {context.html ?? "<!-- no HTML captured -->"}
              </pre>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700">
                {context.type === "text" ? "Markdown output" : "Text content"}
              </h3>
              <p className="mt-2 max-h-80 overflow-auto rounded-md bg-slate-100 p-3 text-sm text-slate-700 whitespace-pre-wrap">
                {context.type === "text"
                  ? context.markdown ?? "No markdown generated."
                  : context.textContent ?? "No text captured."}
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
