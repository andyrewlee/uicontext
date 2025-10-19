import { useCallback, useEffect, useMemo, useState } from 'react'

import { getAppUrl, useConvexSession } from '../hooks/use-convex-session'

const STORAGE_KEY = 'uicontext:selector-active'
const CAPTURE_STORAGE_KEY = 'uicontext:last-capture'
const CAPTURE_MESSAGE = 'UICON_CAPTURE_RESULT'

type CapturedElement = {
  html: string
  textContent: string
  originUrl: string
  pageTitle: string
  selectionPath: string
  capturedAt: number
}

// Tell the content script to start/stop highlighting in the active tab.
const broadcastToggle = (enabled: boolean) => {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return
  }

  try {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        return
      }

      tabs.forEach((tab) => {
        if (tab.id == null) {
          return
        }

        chrome.tabs.sendMessage(
          tab.id,
          { type: 'UICON_HIGHLIGHT_TOGGLE', enabled },
          () => void chrome.runtime.lastError,
        )
      })
    })
  } catch {
    /* Ignore delivery errors; content script might not be injected yet. */
  }
}

// Persist the toggle so the popup remembers the selector state after close.
const persistToggleState = (enabled: boolean) => {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return
  }

  try {
    chrome.storage.local.set({ [STORAGE_KEY]: enabled }, () => void chrome.runtime.lastError)
  } catch {
    /* Ignore storage write errors; in-memory state still reflects toggle. */
  }
}

export const Home = () => {
  const [isActive, setIsActive] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [lastCapture, setLastCapture] = useState<CapturedElement | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const { refresh: ensureConvexToken, loading: sessionLoading, error: sessionError } = useConvexSession()

  // Restore the previous toggle state on mount so the selector auto-resumes.
  useEffect(() => {
    let cancelled = false

    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      setHydrated(true)
      return () => {
        /* no-op */
      }
    }

    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (cancelled) {
        return
      }

      if (chrome.runtime.lastError) {
        setHydrated(true)
        return
      }

      const initial = Boolean(result?.[STORAGE_KEY])
      setIsActive(initial)
      setHydrated(true)

      if (initial) {
        broadcastToggle(true)
      }
    })

    return () => {
      cancelled = true
      broadcastToggle(false)
      persistToggleState(false)
    }
  }, [])

  // Restore the last captured element if the popup was closed when it happened.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return
    }

    chrome.storage.local.get([CAPTURE_STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        return
      }
      const stored = result?.[CAPTURE_STORAGE_KEY] as CapturedElement | undefined
      if (stored) {
        setLastCapture(stored)
      }
    })
  }, [])

  const handleToggle = useCallback(() => {
    setIsActive((prev) => {
      const next = !prev
      persistToggleState(next)
      broadcastToggle(next)
      return next
    })
  }, [])

  // Listen for completed captures coming from the content script.
  useEffect(() => {
    const handleMessage = (message: unknown) => {
      if (!message || typeof message !== 'object') {
        return
      }

      const typed = message as { type?: string; payload?: CapturedElement }
      if (typed.type !== CAPTURE_MESSAGE || !typed.payload) {
        return
      }

      setLastCapture(typed.payload)
      setSaveState('idle')
      setSaveMessage(null)
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, [])

  // POST the selected snippet to the Next.js API, refreshing tokens if needed.
  const handleSave = useCallback(async () => {
    if (!lastCapture || saveState === 'saving') {
      return
    }

    setSaveState('saving')
    setSaveMessage(null)

    try {
      const appUrl = getAppUrl()
      const attemptSave = async (token: string | null) => {
        return fetch(`${appUrl}/api/convex/save-context`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            type: 'text',
            html: lastCapture.html,
            textContent: lastCapture.textContent,
          }),
        })
      }

      let convexToken = await ensureConvexToken()
      let response = await attemptSave(convexToken)

      if (response.status === 401) {
        convexToken = await ensureConvexToken(true)
        response = await attemptSave(convexToken)
      }

      if (!response.ok) {
        const details = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(details?.error ?? `Failed to save (${response.status})`)
      }

      setSaveState('success')
      setSaveMessage('Saved to Convex')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setSaveState('error')
      setSaveMessage(message)
    }
  }, [ensureConvexToken, lastCapture, saveState])

  // Show a short preview of the captured text block.
  const textPreview = useMemo(() => {
    if (!lastCapture?.textContent) {
      return ''
    }
    const trimmed = lastCapture.textContent.trim()
    if (trimmed.length <= 240) {
      return trimmed
    }
    return `${trimmed.slice(0, 237)}...`
  }, [lastCapture])

  const statusNote = sessionError ?? saveMessage

  return (
    <div className="plasmo-flex plasmo-h-full plasmo-flex-col plasmo-gap-6 plasmo-text-neutral-900">
      <header>
        <h1 className="plasmo-text-2xl plasmo-font-semibold">Element Capture</h1>
        <p className="plasmo-mt-1 plasmo-text-sm plasmo-text-neutral-500">
          Toggle selection to outline elements on the active page. Click a highlighted block to stage it for saving.
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
          <span className="plasmo-text-sm plasmo-font-medium">Last selection</span>
          {lastCapture && (
            <span className="plasmo-text-xs plasmo-text-neutral-400">
              {new Date(lastCapture.capturedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {lastCapture ? (
          <div className="plasmo-flex plasmo-flex-col plasmo-gap-2">
            <p className="plasmo-text-xs plasmo-text-neutral-500">
              {lastCapture.pageTitle} - {lastCapture.originUrl}
            </p>
            <p className="plasmo-rounded plasmo-bg-neutral-100 plasmo-p-3 plasmo-text-sm plasmo-text-neutral-700">
              {textPreview || 'No text content detected.'}
            </p>
            <button
              type="button"
              className="plasmo-inline-flex plasmo-items-center plasmo-justify-center plasmo-rounded-full plasmo-bg-indigo-600 plasmo-px-5 plasmo-py-2 plasmo-text-sm plasmo-font-medium plasmo-text-white hover:plasmo-bg-indigo-500 disabled:plasmo-bg-indigo-300"
              onClick={handleSave}
              disabled={saveState === 'saving' || sessionLoading}
            >
              {saveState === 'saving' ? 'Saving...' : 'Save Text to Convex'}
            </button>
          </div>
        ) : (
          <p className="plasmo-text-sm plasmo-text-neutral-400">Click an element to stage it for saving.</p>
        )}

        {statusNote && (
          <p
            className={`plasmo-text-xs ${
              saveState === 'error' || sessionError ? 'plasmo-text-red-500' : 'plasmo-text-emerald-600'
            }`}
          >
            {statusNote}
          </p>
        )}
      </div>
    </div>
  )
}
