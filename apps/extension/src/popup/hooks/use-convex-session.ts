import { useCallback, useEffect, useMemo, useState } from 'react'

type StoredConvexToken = {
  token: string
  expiresAt: number
}

const STORAGE_KEY = 'uicontext:convex-auth-token'
const FALLBACK_APP_URL = 'http://localhost:3000'

// Allow pointing the extension at a different Next.js origin in development.
export const getAppUrl = () => process.env.PLASMO_PUBLIC_APP_URL ?? FALLBACK_APP_URL

const getStorage = () => (typeof chrome !== 'undefined' ? chrome.storage?.local : undefined)

// Read the cached Convex token (if any) from chrome.storage.
const readStoredToken = async (): Promise<StoredConvexToken | null> => {
  const storage = getStorage()
  if (!storage) {
    return null
  }

  return new Promise((resolve) => {
    try {
      storage.get([STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          resolve(null)
          return
        }

        resolve((result?.[STORAGE_KEY] as StoredConvexToken | undefined) ?? null)
      })
    } catch {
      resolve(null)
    }
  })
}

// Persist or clear the cached token in chrome.storage.
const writeStoredToken = async (value: StoredConvexToken | null) => {
  const storage = getStorage()
  if (!storage) {
    return
  }

  return new Promise<void>((resolve) => {
    try {
      if (value) {
        storage.set({ [STORAGE_KEY]: value }, () => void chrome.runtime.lastError)
      } else {
        storage.remove([STORAGE_KEY], () => void chrome.runtime.lastError)
      }
    } catch {
      /* no-op */
    } finally {
      resolve()
    }
	  })
}

// Decode the `exp` claim so we know when to refresh the token.
const decodeExpiry = (token: string): number | null => {
  const segments = token.split('.')
  if (segments.length < 2) {
    return null
  }

  try {
    const payload = JSON.parse(atob(segments[1]))
    if (typeof payload?.exp === 'number') {
      return payload.exp * 1000
    }
  } catch {
    return null
  }

  return null
}

// Ask the background service worker for a Clerk session token.
// Ask the background service worker for a Convex auth token (minted by Clerk).
const fetchConvexTokenFromBackground = async () => {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return null
  }

  return new Promise<string | null>((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_CLERK_TOKEN' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null)
          return
        }

        if (!response || typeof response !== 'object') {
          resolve(null)
          return
        }

        resolve((response.token as string | null | undefined) ?? null)
      })
    } catch {
      resolve(null)
    }
  })
}

// Hit the Next.js API route to exchange for a Convex auth token.
// Keep a Convex token available for authenticated API calls from the popup.
export const useConvexSession = () => {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ensureToken = useCallback(
    async (forceRefresh = false) => {
      setLoading(true)
      setError(null)

      try {
        if (!forceRefresh) {
          const cached = await readStoredToken()
          if (cached && cached.token && cached.expiresAt > Date.now() + 60_000) {
            setToken(cached.token)
            setLoading(false)
            return cached.token
          }
        }

        // Mint a fresh Convex token via the background worker.
        const convexToken = await fetchConvexTokenFromBackground()
        if (!convexToken) {
          throw new Error('Failed to retrieve Convex token. Please sign in again.')
        }

        const expiry = decodeExpiry(convexToken) ?? Date.now() + 5 * 60_000
        const stored: StoredConvexToken = {
          token: convexToken,
          expiresAt: expiry - 60_000, // Refresh one minute early.
        }

        await writeStoredToken(stored)
        setToken(convexToken)
        setLoading(false)
        return convexToken
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setError(message)
        setToken(null)
        setLoading(false)
        await writeStoredToken(null)
        throw err
      }
    },
    [setToken],
  )

  useEffect(() => {
    void ensureToken(false).catch(() => {
      /* handled via error state */
    })
  }, [ensureToken])

  const isReady = useMemo(() => Boolean(token) && !loading && !error, [token, loading, error])

  return {
    token,
    loading,
    error,
    isReady,
    refresh: ensureToken,
  }
}
