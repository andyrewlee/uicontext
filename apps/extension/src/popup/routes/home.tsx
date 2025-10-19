import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'uicontext:selector-active'

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
    // Ignore delivery errors; target pages might not have the content script loaded yet.
  }
}

const persistToggleState = (enabled: boolean) => {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return
  }

  try {
    chrome.storage.local.set({ [STORAGE_KEY]: enabled }, () => void chrome.runtime.lastError)
  } catch {
    // Ignore storage write errors; the toggle still reflects in-memory state.
  }
}

export const Home = () => {
  const [isActive, setIsActive] = useState(false)
  const [hydrated, setHydrated] = useState(false)

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

  const handleToggle = useCallback(() => {
    setIsActive((prev) => {
      const next = !prev
      persistToggleState(next)
      broadcastToggle(next)
      return next
    })
  }, [])

  return (
    <div className="plasmo-flex plasmo-h-full plasmo-flex-col plasmo-gap-6 plasmo-text-neutral-900">
      <header>
        <h1 className="plasmo-text-2xl plasmo-font-semibold">Element Capture</h1>
        <p className="plasmo-mt-1 plasmo-text-sm plasmo-text-neutral-500">
          Toggle selection to outline elements on the active page. Click any highlighted block to log it and its
          children to the console.
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
        <p className="plasmo-text-xs plasmo-text-neutral-400">
          Selection automatically pauses when you sign out.
        </p>
      </div>
    </div>
  )
}
