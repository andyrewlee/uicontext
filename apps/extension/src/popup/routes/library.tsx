import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { getAppUrl, useConvexSession } from '../hooks/use-convex-session'

type CaptureMode = 'design' | 'text'

type WorkflowStatus = 'queued' | 'processing' | 'completed' | 'failed'

type RemoteContext = {
  _id: string
  type: CaptureMode
  status: WorkflowStatus
  pageTitle?: string | null
  originUrl?: string | null
  createdAt: number
  updatedAt: number
  aiPrompt?: string | null
  aiResponse?: string | null
  aiModel?: string | null
  aiError?: string | null
  html?: string | null
  textContent?: string | null
  markdown?: string | null
  textExtraction?: { strategy: string; adapter?: string | null } | null
  styles?: Record<string, string> | null
  cssTokens?: Record<string, string> | null
  screenshotUrl?: string | null
  designDetails?: {
    bounds: { width: number; height: number; top: number; left: number }
    viewport: { scrollX: number; scrollY: number; width: number; height: number }
    colorPalette?: string[] | null
    fontFamilies?: string[] | null
    fontMetrics?: string[] | null
  } | null
}

type CopyButtonProps = {
  label: string
  payload: string | null
  disabled?: boolean
}

const statusStyles: Record<WorkflowStatus, string> = {
  queued: 'plasmo-bg-yellow-100 plasmo-text-yellow-700 plasmo-border-yellow-200',
  processing: 'plasmo-bg-amber-100 plasmo-text-amber-700 plasmo-border-amber-200',
  completed: 'plasmo-bg-emerald-100 plasmo-text-emerald-700 plasmo-border-emerald-200',
  failed: 'plasmo-bg-rose-100 plasmo-text-rose-700 plasmo-border-rose-200',
}

const typeStyles: Record<CaptureMode, string> = {
  design: 'plasmo-bg-indigo-100 plasmo-text-indigo-700 plasmo-border-indigo-200',
  text: 'plasmo-bg-sky-100 plasmo-text-sky-700 plasmo-border-sky-200',
}

const createStylesBundle = (
  styles?: Record<string, string> | null,
  tokens?: Record<string, string> | null,
) => {
  const styleEntries = styles ? Object.entries(styles) : []
  const tokenEntries = tokens ? Object.entries(tokens) : []

  const styleSection =
    styleEntries.length > 0
      ? styleEntries.map(([key, value]) => `${key}: ${value};`).join('\n')
      : '/* no computed styles captured */'

  const tokenSection =
    tokenEntries.length > 0
      ? tokenEntries.map(([key, value]) => `${key}: ${value};`).join('\n')
      : '/* no CSS custom properties captured */'

  return `/* Computed styles */\n${styleSection}\n\n/* CSS custom properties */\n${tokenSection}\n`
}

const buildHtmlBundle = (context: RemoteContext) => {
  const snippet = context.html ?? '<!-- no HTML captured -->'
  const text = context.textContent ? `\n<!-- text content -->\n${context.textContent}\n` : ''
  const styles = createStylesBundle(context.styles, context.cssTokens)

  return `<!-- Captured HTML snippet -->\n${snippet}\n\n${styles}${text}`
}

const CopyButton = ({ label, payload, disabled }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false)
  const isDisabled = Boolean(disabled) || payload == null

  const handleCopy = useCallback(async () => {
    if (payload == null) {
      return
    }
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (error) {
      console.error('Failed to copy payload', error)
    }
  }, [payload])

  return (
    <button
      type="button"
      className="plasmo-rounded-md plasmo-border plasmo-border-slate-200 plasmo-bg-white plasmo-px-3 plasmo-py-1.5 plasmo-text-xs plasmo-font-medium plasmo-transition hover:plasmo-bg-slate-100 disabled:plasmo-cursor-not-allowed disabled:plasmo-opacity-60"
      onClick={() => void handleCopy()}
      disabled={isDisabled}
    >
      {copied ? 'Copied!' : label}
    </button>
  )
}

const StatusBadge = ({ label, variant }: { label: string; variant: 'status' | 'type' }) => {
  const style =
    variant === 'status'
      ? statusStyles[label as WorkflowStatus]
      : typeStyles[label as CaptureMode]

  return (
    <span
      className={`plasmo-inline-flex plasmo-items-center plasmo-rounded-full plasmo-border plasmo-px-2.5 plasmo-py-0.5 plasmo-text-[10px] plasmo-font-semibold plasmo-uppercase plasmo-tracking-wide ${style ?? 'plasmo-bg-slate-100 plasmo-text-slate-600 plasmo-border-slate-200'}`}
    >
      {label}
    </span>
  )
}

const statusOrder: WorkflowStatus[] = ['queued', 'processing', 'completed', 'failed']

export const Library = () => {
  const [filter, setFilter] = useState<'all' | CaptureMode>('all')
  const [contexts, setContexts] = useState<RemoteContext[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  const { refresh: ensureConvexToken, loading: sessionLoading, error: sessionError } =
    useConvexSession()

  const loadContexts = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true)
      }
      setError(null)

      try {
        const token = await ensureConvexToken()
        const url = new URL(`${getAppUrl()}/api/convex/contexts`)
        if (filter !== 'all') {
          url.searchParams.set('type', filter)
        }

        const response = await fetch(url.toString(), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })

        if (!response.ok) {
          const details = (await response.json().catch(() => null)) as { error?: string } | null
          throw new Error(details?.error ?? `Failed to load contexts (${response.status})`)
        }

        const body = (await response.json()) as { contexts: RemoteContext[] }
        setContexts(body.contexts ?? [])
        setLastUpdated(Date.now())
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setError(message)
        setContexts([])
      } finally {
        if (!options?.silent) {
          setLoading(false)
        }
      }
    },
    [ensureConvexToken, filter],
  )

  useEffect(() => {
    void loadContexts()
  }, [loadContexts])

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadContexts({ silent: true })
    }, 6000)

    return () => window.clearInterval(interval)
  }, [loadContexts])

  const statusCounts = useMemo(() => {
    return contexts.reduce(
      (acc, context) => {
        acc.total += 1
        acc[context.status] = (acc[context.status] ?? 0) + 1
        return acc
      },
      { total: 0 } as Record<string, number>,
    )
  }, [contexts])

  const summaryMessage = useMemo(() => {
    if (error) {
      return error
    }
    if (sessionError) {
      return sessionError
    }
    if (sessionLoading || loading) {
      return 'Refreshing contexts…'
    }
    if (lastUpdated) {
      const date = new Date(lastUpdated)
      return `Updated ${date.toLocaleTimeString()}`
    }
    return null
  }, [error, sessionError, sessionLoading, loading, lastUpdated])

  return (
    <div className="plasmo-flex plasmo-h-full plasmo-flex-col plasmo-gap-5">
      <header className="plasmo-flex plasmo-flex-col plasmo-gap-2">
        <div className="plasmo-flex plasmo-items-center plasmo-justify-between">
          <h1 className="plasmo-text-2xl plasmo-font-semibold plasmo-text-neutral-900">
            Context Library
          </h1>
          <Link
            to="/"
            className="plasmo-text-xs plasmo-font-medium plasmo-text-indigo-600 hover:plasmo-text-indigo-500"
          >
            ← Back to capture
          </Link>
        </div>
        <p className="plasmo-text-sm plasmo-text-neutral-500">
          Browse captured elements, review AI output, and copy artifacts for your workflow.
        </p>
      </header>

      <div className="plasmo-flex plasmo-flex-wrap plasmo-items-center plasmo-justify-between plasmo-gap-3">
        <div className="plasmo-flex plasmo-gap-2">
          {(['all', 'design', 'text'] as const).map((option) => {
            const isActive = option === filter
            return (
              <button
                key={option}
                type="button"
                className={`plasmo-rounded-full plasmo-border plasmo-px-4 plasmo-py-1.5 plasmo-text-xs plasmo-font-medium plasmo-transition ${
                  isActive
                    ? 'plasmo-border-neutral-900 plasmo-bg-neutral-900 plasmo-text-white'
                    : 'plasmo-border-neutral-300 plasmo-text-neutral-600 hover:plasmo-border-neutral-400'
                }`}
                onClick={() => setFilter(option)}
              >
                {option === 'all' ? 'All contexts' : `${option} only`}
              </button>
            )
          })}
        </div>
        {summaryMessage && (
          <span className="plasmo-text-xs plasmo-font-medium plasmo-text-neutral-400">
            {summaryMessage}
          </span>
        )}
      </div>

      <div className="plasmo-grid plasmo-gap-3 plasmo-rounded-2xl plasmo-border plasmo-border-neutral-200 plasmo-bg-white plasmo-p-4 plasmo-shadow-sm plasmo-sm:grid-cols-4">
        <div>
          <p className="plasmo-text-[11px] plasmo-font-semibold plasmo-uppercase plasmo-tracking-wide plasmo-text-neutral-500">
            Total
          </p>
          <p className="plasmo-mt-1 plasmo-text-xl plasmo-font-bold plasmo-text-neutral-900">
            {statusCounts.total}
          </p>
        </div>
        {statusOrder.map((status) => (
          <div key={status}>
            <p className="plasmo-text-[11px] plasmo-font-semibold plasmo-uppercase plasmo-tracking-wide plasmo-text-neutral-500">
              {status}
            </p>
            <p className="plasmo-mt-1 plasmo-text-xl plasmo-font-bold plasmo-text-neutral-900">
              {statusCounts[status] ?? 0}
            </p>
          </div>
        ))}
      </div>

      {contexts.length === 0 ? (
        <div className="plasmo-flex plasmo-flex-1 plasmo-items-center plasmo-justify-center plasmo-rounded-2xl plasmo-border plasmo-border-dashed plasmo-border-neutral-200 plasmo-bg-white plasmo-p-10">
          <p className="plasmo-text-sm plasmo-text-neutral-500">
            No contexts captured yet. Use the capture view to add one.
          </p>
        </div>
      ) : (
        <div className="plasmo-flex plasmo-flex-col plasmo-gap-4 plasmo-overflow-y-auto plasmo-pr-1">
          {contexts.map((context) => (
            <ContextCard key={context._id} context={context} />
          ))}
        </div>
      )}
    </div>
  )
}

const ContextCard = ({ context }: { context: RemoteContext }) => {
  const createdAt = new Date(context.createdAt)
  const updatedAt = new Date(context.updatedAt)
  const preview =
    context.aiResponse?.slice(0, 260) ??
    context.markdown?.slice(0, 260) ??
    context.textContent?.slice(0, 260) ??
    ''
  const extractionLabel =
    context.type === 'text' && context.textExtraction
      ? `Text via ${context.textExtraction.strategy}${context.textExtraction.adapter ? ` (${context.textExtraction.adapter})` : ''}`
      : null
  const layoutLabel =
    context.type === 'design' && context.designDetails
      ? `Bounds ${context.designDetails.bounds.width}×${context.designDetails.bounds.height}px`
      : null
  const promptSnippet =
    context.type === 'design' && context.aiPrompt ? context.aiPrompt.slice(0, 200) : null

  return (
    <article className="plasmo-flex plasmo-flex-col plasmo-gap-3 plasmo-rounded-2xl plasmo-border plasmo-border-neutral-200 plasmo-bg-white plasmo-p-4 plasmo-shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
      <div className="plasmo-flex plasmo-flex-wrap plasmo-items-start plasmo-justify-between plasmo-gap-2">
        <div className="plasmo-flex plasmo-flex-col plasmo-gap-1">
          <div className="plasmo-flex plasmo-gap-2">
            <StatusBadge label={context.type} variant="type" />
            <StatusBadge label={context.status} variant="status" />
          </div>
          <span className="plasmo-text-base plasmo-font-semibold plasmo-text-neutral-900">
            {context.pageTitle ?? 'Untitled capture'}
          </span>
          <span className="plasmo-text-[11px] plasmo-text-neutral-400">
            {context.originUrl ?? 'Unknown origin'}
          </span>
        </div>
        <div className="plasmo-text-right plasmo-text-[11px] plasmo-text-neutral-400">
          <p>Captured {createdAt.toLocaleString()}</p>
          <p>Updated {updatedAt.toLocaleString()}</p>
          {context.aiModel && <p>Model: {context.aiModel}</p>}
        </div>
      </div>

      {preview && (
        <p className="plasmo-text-sm plasmo-leading-relaxed plasmo-text-neutral-600">
          {preview}
          {preview.length === 260 ? '…' : ''}
        </p>
      )}

      {extractionLabel && (
        <p className="plasmo-text-[11px] plasmo-font-medium plasmo-uppercase plasmo-tracking-wide plasmo-text-neutral-400">
          {extractionLabel}
        </p>
      )}

      {layoutLabel && (
        <p className="plasmo-text-[11px] plasmo-font-medium plasmo-uppercase plasmo-tracking-wide plasmo-text-neutral-400">
          {layoutLabel}
        </p>
      )}

      {promptSnippet && (
        <pre className="plasmo-rounded-md plasmo-bg-slate-50 plasmo-p-3 plasmo-text-[11px] plasmo-leading-snug plasmo-text-slate-600">
          {promptSnippet}
          {promptSnippet.length === 200 ? '…' : ''}
        </pre>
      )}

      {context.aiError && (
        <p className="plasmo-rounded-md plasmo-border plasmo-border-rose-200 plasmo-bg-rose-50 plasmo-p-2 plasmo-text-[11px] plasmo-font-medium plasmo-text-rose-600">
          {context.aiError}
        </p>
      )}

      {context.type === 'text' ? (
        <div className="plasmo-flex plasmo-flex-wrap plasmo-gap-2">
          <CopyButton
            label="Copy Text"
            payload={context.markdown ?? context.textContent ?? null}
            disabled={(context.markdown ?? context.textContent ?? null) == null}
          />
        </div>
      ) : (
        <div className="plasmo-flex plasmo-flex-wrap plasmo-gap-2">
          <CopyButton
            label="Copy AI Prompt"
            payload={context.aiPrompt ?? null}
            disabled={context.aiPrompt == null}
          />
          <CopyButton
            label="Copy AI Output"
            payload={context.aiResponse ?? null}
            disabled={context.aiResponse == null}
          />
          <CopyButton label="Copy HTML + Styles" payload={buildHtmlBundle(context)} />
          <CopyButton
            label="Copy Screenshot URL"
            payload={context.screenshotUrl ?? null}
            disabled={context.screenshotUrl == null}
          />
        </div>
      )}
    </article>
  )
}
