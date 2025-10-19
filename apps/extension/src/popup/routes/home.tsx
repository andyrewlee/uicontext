import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { getAppUrl, useConvexSession } from '../hooks/use-convex-session'

type CaptureMode = 'design' | 'text'

type RemoteContext = {
  _id: string
  type: CaptureMode
  status: 'queued' | 'processing' | 'completed' | 'failed'
  pageTitle?: string
  originUrl?: string
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
}

const TOGGLE_STORAGE_KEY = 'uicontext:selector-active'
const MODE_STORAGE_KEY = 'uicontext:selector-mode'

const forEachContentTab = (deliver: (tabId: number) => void) => {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return
  }

  try {
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime.lastError) {
        return
      }

      tabs.forEach((tab) => {
        if (tab.id == null) {
          return
        }

        deliver(tab.id)
      })
    })
  } catch {
    /* ignore delivery errors */
  }
}

// Toggle highlight listeners in every tab where the content script might be active.
const broadcastToggle = (enabled: boolean) => {
  forEachContentTab((tabId) =>
    chrome.tabs.sendMessage(
      tabId,
      { type: 'UICON_HIGHLIGHT_TOGGLE', enabled },
      () => void chrome.runtime.lastError,
    ),
  )
}

// Tell the content script which capture mode we are in so it can decide whether
// to collect screenshots + styles (design) or only text.
const broadcastMode = (mode: CaptureMode) => {
  forEachContentTab((tabId) =>
    chrome.tabs.sendMessage(
      tabId,
      { type: 'UICON_HIGHLIGHT_MODE', mode },
      () => void chrome.runtime.lastError,
    ),
  )
}

// Persist the selector toggle in chrome.storage so the popup remembers state
// across reloads/popups closing.
const persistToggleState = (enabled: boolean) => {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return
  }

  try {
    chrome.storage.local.set({ [TOGGLE_STORAGE_KEY]: enabled }, () => void chrome.runtime.lastError)
  } catch {
    /* ignore storage errors */
  }
}

// Persist the last capture mode so the popup can restore it on mount.
const persistModeState = (mode: CaptureMode) => {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return
  }

  try {
    chrome.storage.local.set({ [MODE_STORAGE_KEY]: mode }, () => void chrome.runtime.lastError)
  } catch {
    /* ignore storage errors */
  }
}

export const Home = () => {
  const [isActive, setIsActive] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [mode, setMode] = useState<CaptureMode>('design')
  const [contexts, setContexts] = useState<RemoteContext[]>([])
  const [contextsLoading, setContextsLoading] = useState(false)
  const [contextsError, setContextsError] = useState<string | null>(null)

  const { refresh: ensureConvexToken, loading: sessionLoading, error: sessionError } = useConvexSession()

  // Rehydrate selection + mode preferences.
  useEffect(() => {
    let cancelled = false

    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      setHydrated(true)
      return () => {
        /* no-op */
      }
    }

    chrome.storage.local.get([TOGGLE_STORAGE_KEY, MODE_STORAGE_KEY], (result) => {
      if (cancelled) {
        return
      }

      const storedToggle = Boolean(result?.[TOGGLE_STORAGE_KEY])
      const storedMode = result?.[MODE_STORAGE_KEY]

      setIsActive(storedToggle)
      setMode(storedMode === 'text' || storedMode === 'design' ? storedMode : 'design')
      setHydrated(true)

      if (storedToggle) {
        broadcastToggle(true)
      }

      const resolvedMode: CaptureMode = storedMode === 'text' || storedMode === 'design' ? storedMode : 'design'
      broadcastMode(resolvedMode)
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Load recent contexts for the active mode by calling the Next.js listing endpoint.
  const fetchContexts = useCallback(async () => {
    setContextsLoading(true)
    setContextsError(null)

    try {
      const token = await ensureConvexToken()
      const url = new URL(`${getAppUrl()}/api/convex/contexts`)
      url.searchParams.set('type', mode)

      const response = await fetch(url.toString(), {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })

      if (!response.ok) {
        const details = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(details?.error ?? `Failed to load contexts (${response.status})`)
      }

      const body = (await response.json()) as { contexts: RemoteContext[] }
      setContexts(body.contexts ?? [])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setContextsError(message)
      setContexts([])
    } finally {
      setContextsLoading(false)
    }
  }, [ensureConvexToken, mode])

  useEffect(() => {
    if (!hydrated) {
      return
    }
    void fetchContexts()
  }, [hydrated, fetchContexts])

  const handleToggle = useCallback(() => {
    setIsActive((prev) => {
      const next = !prev
      persistToggleState(next)
      broadcastToggle(next)
      if (next) {
        broadcastMode(mode)
      }
      return next
    })
  }, [mode])

  // Update local + persisted mode, then notify the content script so future captures use it.
  const handleModeChange = useCallback(
    (next: CaptureMode) => {
      setMode(next)
      persistModeState(next)
      broadcastMode(next)
    },
    [],
  )

  const statusMessage = useMemo(() => {
    if (sessionError) {
      return sessionError
    }
    if (contextsError) {
      return contextsError
    }
    return null
  }, [contextsError, sessionError])

  return (
    <div className="plasmo-flex plasmo-h-full plasmo-flex-col plasmo-gap-6 plasmo-text-neutral-900">
      <header>
        <h1 className="plasmo-text-2xl plasmo-font-semibold">Element Capture</h1>
        <p className="plasmo-mt-1 plasmo-text-sm plasmo-text-neutral-500">
          Choose a capture mode, enable selection, then click any outlined element to send it to Convex.
        </p>
      </header>

      <div className="plasmo-flex plasmo-flex-col plasmo-gap-3 plasmo-rounded-2xl plasmo-border plasmo-border-neutral-200 plasmo-bg-white plasmo-p-6 plasmo-shadow-sm">
        <div className="plasmo-flex plasmo-items-center plasmo-justify-between">
          <span className="plasmo-text-sm plasmo-font-medium">
            Status:{' '}
            <span className={isActive ? 'plasmo-text-emerald-600' : 'plasmo-text-neutral-500'}>
              {isActive ? 'Selecting' : 'Idle'}
            </span>
          </span>
        </div>
        <div className="plasmo-flex plasmo-items-center plasmo-gap-2">
          <button
            type="button"
            className={`plasmo-rounded-full plasmo-border plasmo-px-3 plasmo-py-1.5 plasmo-text-xs plasmo-font-medium ${
              mode === 'design'
                ? 'plasmo-border-neutral-900 plasmo-bg-neutral-900 plasmo-text-white'
                : 'plasmo-border-neutral-300 plasmo-text-neutral-600 hover:plasmo-border-neutral-400'
            }`}
            onClick={() => handleModeChange('design')}
          >
            Design mode
          </button>
          <button
            type="button"
            className={`plasmo-rounded-full plasmo-border plasmo-px-3 plasmo-py-1.5 plasmo-text-xs plasmo-font-medium ${
              mode === 'text'
                ? 'plasmo-border-neutral-900 plasmo-bg-neutral-900 plasmo-text-white'
                : 'plasmo-border-neutral-300 plasmo-text-neutral-600 hover:plasmo-border-neutral-400'
            }`}
            onClick={() => handleModeChange('text')}
          >
            Text mode
          </button>
        </div>
        <button
          type="button"
          className={`plasmo-inline-flex plasmo-w-max plasmo-items-center plasmo-justify-center plasmo-rounded-full plasmo-px-5 plasmo-py-2 plasmo-text-sm plasmo-font-medium plasmo-transition ${
            isActive
              ? 'plasmo-bg-neutral-900 plasmo-text-white hover:plasmo-bg-neutral-800'
              : 'plasmo-bg-emerald-500 plasmo-text-white hover:plasmo-bg-emerald-400'
          } ${hydrated ? '' : 'plasmo-opacity-60'}`}
          onClick={handleToggle}
          disabled={!hydrated}
        >
          {isActive ? 'Stop Selecting' : 'Start Selecting'}
        </button>
        <p className="plasmo-text-xs plasmo-text-neutral-400">Selection automatically pauses when you sign out.</p>
      </div>

      <div className="plasmo-flex plasmo-flex-col plasmo-gap-3 plasmo-rounded-2xl plasmo-border plasmo-border-neutral-200 plasmo-bg-white plasmo-p-6 plasmo-shadow-sm">
        <div className="plasmo-flex plasmo-items-center plasmo-justify-between">
          <span className="plasmo-text-sm plasmo-font-medium">Recent contexts ({mode})</span>
          <div className="plasmo-flex plasmo-items-center plasmo-gap-3">
            <Link
              to="/library"
              className="plasmo-text-xs plasmo-font-medium plasmo-text-neutral-500 hover:plasmo-text-neutral-800"
            >
              Open library →
            </Link>
            <button
              type="button"
              className="plasmo-text-xs plasmo-font-medium plasmo-text-indigo-600 hover:plasmo-text-indigo-500"
              onClick={() => void fetchContexts()}
              disabled={contextsLoading || sessionLoading}
            >
              Refresh
            </button>
          </div>
        </div>

        {contextsLoading ? (
          <p className="plasmo-text-sm plasmo-text-neutral-400">Loading contexts…</p>
        ) : contexts.length === 0 ? (
          <p className="plasmo-text-sm plasmo-text-neutral-400">No contexts captured yet.</p>
        ) : (
          <ul className="plasmo-flex plasmo-flex-col plasmo-gap-3">
            {contexts.slice(0, 5).map((context) => (
              <li key={context._id} className="plasmo-rounded-xl plasmo-border plasmo-border-neutral-200 plasmo-p-3">
                <div className="plasmo-flex plasmo-items-center plasmo-justify-between plasmo-text-xs plasmo-font-medium">
                  <span className="plasmo-uppercase plasmo-tracking-wide plasmo-text-neutral-500">
                    {context.type} · {context.status}
                  </span>
                  <span className="plasmo-text-[11px] plasmo-text-neutral-400">
                    {new Date(context.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <p className="plasmo-mt-1 plasmo-text-sm plasmo-text-neutral-600">
                  {context.pageTitle ?? 'Untitled page'}
                </p>
                <p className="plasmo-text-xs plasmo-text-neutral-400">
                  {context.originUrl ?? 'Unknown origin'}
                </p>
              </li>
            ))}
          </ul>
        )}

        {statusMessage && (
          <p className="plasmo-text-xs plasmo-text-red-500">{statusMessage}</p>
        )}
      </div>
    </div>
  )
}
