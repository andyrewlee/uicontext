import type { PlasmoCSConfig } from "plasmo"
import { useEffect } from "react"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
}

type CaptureMode = "design" | "text"

type ToastVariant = "success" | "error" | "info"

const TOGGLE_STORAGE_KEY = "uicontext:selector-active"
const MODE_STORAGE_KEY = "uicontext:selector-mode"
const HIGHLIGHT_ID = "uicontext-element-highlight"
const TOAST_ID = "uicontext-toast"
const APP_URL = process.env.PLASMO_PUBLIC_APP_URL ?? "http://localhost:3000"

const buildDomPath = (element: Element) => {
  const segments: string[] = []
  let current: Element | null = element

  while (current && current.parentElement) {
    const tagName = current.tagName.toLowerCase()
    let index = 1
    let sibling = current.previousElementSibling

    while (sibling) {
      if (sibling.tagName === current.tagName) {
        index += 1
      }
      sibling = sibling.previousElementSibling
    }

    segments.unshift(index > 1 ? `${tagName}:nth-of-type(${index})` : tagName)
    current = current.parentElement
  }

  return segments.join(" > ")
}

const captureElementSnapshot = (element: Element) => {
  const html = "outerHTML" in element ? (element as HTMLElement).outerHTML : element.outerHTML ?? ""
  const textContent = element.textContent ?? ""

  return {
    html,
    textContent,
    originUrl: window.location.href,
    pageTitle: document.title,
    selectionPath: buildDomPath(element),
  }
}

const isExtensionElement = (element: Element) => {
  if (element.id === HIGHLIGHT_ID || element.id === TOAST_ID) {
    return true
  }

  if (element.closest("plasmo-csui") || element.closest("#plasmo-shadow-container")) {
    return true
  }

  const root = element.getRootNode()
  if (root instanceof ShadowRoot) {
    const host = root.host
    if (
      host instanceof HTMLElement &&
      (host.id === "plasmo-shadow-host" || host.tagName.toLowerCase() === "plasmo-csui")
    ) {
      return true
    }
  }

  return false
}

const ElementHighlighter = () => {
  useEffect(() => {
    // High-contrast outline that follows the pointer when selection is toggled on.
    const highlight = document.createElement("div")
    highlight.id = HIGHLIGHT_ID
    highlight.style.position = "fixed"
    highlight.style.pointerEvents = "none"
    highlight.style.zIndex = "2147483647"
    highlight.style.border = "2px solid #6366f1"
    highlight.style.borderRadius = "6px"
    highlight.style.boxShadow = "0 0 0 4px rgba(99, 102, 241, 0.25)"
    highlight.style.transition = "all 80ms ease-out"
    highlight.style.display = "none"

    document.documentElement.appendChild(highlight)

    // Lazily create a toast element for lightweight user feedback.
    const ensureToast = () => {
      let toast = document.getElementById(TOAST_ID) as HTMLDivElement | null
      if (!toast) {
        toast = document.createElement("div")
        toast.id = TOAST_ID
        toast.style.position = "fixed"
        toast.style.top = "16px"
        toast.style.right = "16px"
        toast.style.maxWidth = "280px"
        toast.style.padding = "12px 16px"
        toast.style.borderRadius = "10px"
        toast.style.fontSize = "13px"
        toast.style.fontWeight = "500"
        toast.style.color = "white"
        toast.style.zIndex = "2147483647"
        toast.style.boxShadow = "0 10px 30px rgba(15, 23, 42, 0.2)"
        toast.style.pointerEvents = "none"
        toast.style.display = "none"
        document.documentElement.appendChild(toast)
      }
      return toast
    }

    let toastTimeout: number | null = null

    const showToast = (message: string, variant: ToastVariant) => {
      const toast = ensureToast()
      toast.textContent = message
      toast.style.display = "block"
      toast.style.background =
        variant === "success"
          ? "rgba(16, 185, 129, 0.95)"
          : variant === "error"
          ? "rgba(239, 68, 68, 0.95)"
          : "rgba(79, 70, 229, 0.95)"

      if (toastTimeout) {
        window.clearTimeout(toastTimeout)
      }

      toastTimeout = window.setTimeout(() => {
        toast.style.display = "none"
      }, variant === "info" ? 1800 : 2600)
    }

    let activeElement: Element | null = null
    let enabled = false
    let currentMode: CaptureMode = "design"
    let requestPending = false

    const updateHighlight = (element: Element | null) => {
      if (!element) {
        highlight.style.display = "none"
        activeElement = null
        return
      }

      const rect = element.getBoundingClientRect()
      highlight.style.display = "block"
      highlight.style.top = `${rect.top}px`
      highlight.style.left = `${rect.left}px`
      highlight.style.width = `${rect.width}px`
      highlight.style.height = `${rect.height}px`
    }

    const resolveTarget = (target: EventTarget | null): Element | null => {
      if (!(target instanceof Element)) {
        return null
      }

      if (isExtensionElement(target)) {
        return null
      }

      return target
    }

    const collectComputedStyles = (element: Element): Record<string, string> => {
      const computed = getComputedStyle(element as HTMLElement)
      const styles: Record<string, string> = {}

      for (let index = 0; index < computed.length; index += 1) {
        const property = computed[index]
        styles[property] = computed.getPropertyValue(property)
      }

      return styles
    }

    const collectCssTokens = (styles: Record<string, string>) => {
      const tokens: Record<string, string> = {}

      Object.keys(styles).forEach((key) => {
        if (key.startsWith("--")) {
          tokens[key] = styles[key]
        }
      })

      return tokens
    }

    // Ask the background worker for a full-page screenshot. Content scripts can't use
    // chrome.tabs APIs directly, so this bridges the gap.
    const requestScreenshot = async (): Promise<string | null> => {
      if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
        return null
      }

      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: "UICON_CAPTURE_SCREENSHOT" }, (response) => {
            if (chrome.runtime.lastError) {
              resolve(null)
              return
            }

            if (!response || typeof response !== "object") {
              resolve(null)
              return
            }

            resolve(((response as { dataUrl?: string }).dataUrl) ?? null)
          })
        } catch {
          resolve(null)
        }
      })
    }

    const loadImage = (dataUrl: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = dataUrl
      })

    // Crop the screenshot to the element bounds so Convex only stores the area of interest.
    const cropScreenshot = async (dataUrl: string, rect: DOMRect): Promise<string | null> => {
      try {
        const image = await loadImage(dataUrl)
        const dpr = window.devicePixelRatio || 1

        const targetWidth = Math.max(1, Math.round(rect.width * dpr))
        const targetHeight = Math.max(1, Math.round(rect.height * dpr))

        const sourceX = Math.max(0, rect.left * dpr)
        const sourceY = Math.max(0, rect.top * dpr)
        const availableWidth = Math.max(0, image.width - sourceX)
        const availableHeight = Math.max(0, image.height - sourceY)

        const sourceWidth = Math.min(availableWidth, targetWidth)
        const sourceHeight = Math.min(availableHeight, targetHeight)

        if (sourceWidth <= 0 || sourceHeight <= 0) {
          return null
        }

        const canvas = document.createElement("canvas")
        canvas.width = Math.round(sourceWidth)
        canvas.height = Math.round(sourceHeight)

        const context = canvas.getContext("2d")
        if (!context) {
          return null
        }

        context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)

        return canvas.toDataURL("image/png")
      } catch {
        return null
      }
    }

    // Request the Convex JWT from the background service worker (which talks to Clerk).
    const getConvexToken = async () => {
      if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
        return null
      }

      return new Promise<string | null>((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: "GET_CLERK_TOKEN" }, (response) => {
            if (chrome.runtime.lastError) {
              resolve(null)
              return
            }

            if (!response || typeof response !== "object") {
              resolve(null)
              return
            }

            resolve(((response as { token?: string | null }).token) ?? null)
          })
        } catch {
          resolve(null)
        }
      })
    }

    const saveSelection = async (element: Element) => {
      if (requestPending) {
        showToast("Capture already in progress", "info")
        return
      }

      requestPending = true

      try {
        const snapshot = captureElementSnapshot(element)
        let styles: Record<string, string> | undefined
        let cssTokens: Record<string, string> | undefined
        let screenshot: string | null = null

        if (currentMode === "design") {
          styles = collectComputedStyles(element)
          cssTokens = collectCssTokens(styles)

          const toastElement = document.getElementById(TOAST_ID) as HTMLDivElement | null
          const previousToastVisibility = toastElement?.style.visibility ?? ""

          const previousVisibility = highlight.style.visibility
          const shouldRestoreHighlight = previousVisibility !== "hidden"
          highlight.style.visibility = "hidden"
          if (toastElement) {
            toastElement.style.visibility = "hidden"
          }

          try {
            const fullScreenshot = await requestScreenshot()
            if (fullScreenshot) {
              const rect = element.getBoundingClientRect()
              screenshot = await cropScreenshot(fullScreenshot, rect)
            }
          } finally {
            highlight.style.visibility = previousVisibility
            if (shouldRestoreHighlight && activeElement) {
              updateHighlight(activeElement)
            }
            if (toastElement) {
              toastElement.style.visibility = previousToastVisibility
            }
          }
        }

        showToast("Saving selection…", "info")

        const token = await getConvexToken()
        if (!token) {
          throw new Error("Missing Convex token. Please sign in again.")
        }

        const response = await fetch(`${APP_URL}/api/convex/save-context`, {
          method: "POST",
          credentials: "omit",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            type: currentMode,
            html: snapshot.html,
            textContent: snapshot.textContent,
            selectionPath: snapshot.selectionPath,
            originUrl: snapshot.originUrl,
            pageTitle: snapshot.pageTitle,
            styles,
            cssTokens,
            screenshot: screenshot ?? undefined,
          }),
        })

        if (!response.ok) {
          const details = (await response.json().catch(() => null)) as { error?: string } | null
          throw new Error(details?.error ?? `Failed (${response.status})`)
        }

        showToast("Selection saved to Convex", "success")
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error"
        showToast(`Failed to save: ${message}`, "error")
      } finally {
        requestPending = false
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!enabled) {
        return
      }

      const target = resolveTarget(event.target)

      if (!target) {
        updateHighlight(null)
        return
      }

      if (target === activeElement) {
        return
      }

      activeElement = target
      updateHighlight(target)
    }

    const handleClick = async (event: MouseEvent) => {
      if (!enabled || event.button !== 0) {
        return
      }

      const target = resolveTarget(event.target)
      if (!target) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      activeElement = target
      updateHighlight(target)

      await saveSelection(target)
    }

    const handlePointerLeave = () => {
      if (!enabled) {
        return
      }
      updateHighlight(null)
    }

    const handleScrollOrResize = () => {
      if (!enabled) {
        return
      }
      if (activeElement) {
        updateHighlight(activeElement)
      }
    }

    const attachListeners = () => {
      if (enabled) {
        return
      }
      enabled = true

      document.addEventListener("pointermove", handlePointerMove, true)
      document.addEventListener("click", handleClick, true)
      document.addEventListener("pointerleave", handlePointerLeave, true)
      window.addEventListener("blur", handlePointerLeave)
      window.addEventListener("scroll", handleScrollOrResize, true)
      window.addEventListener("resize", handleScrollOrResize)
    }

    const detachListeners = () => {
      if (!enabled) {
        return
      }
      enabled = false

      document.removeEventListener("pointermove", handlePointerMove, true)
      document.removeEventListener("click", handleClick, true)
      document.removeEventListener("pointerleave", handlePointerLeave, true)
      window.removeEventListener("blur", handlePointerLeave)
      window.removeEventListener("scroll", handleScrollOrResize, true)
      window.removeEventListener("resize", handleScrollOrResize)
      updateHighlight(null)
    }

    const setEnabled = (next: boolean) => {
      if (next) {
        attachListeners()
      } else {
        detachListeners()
      }
    }

    const handleMessage = (message: unknown) => {
      if (!message || typeof message !== "object" || !("type" in message)) {
        return
      }

      const typed = message as { type: string; enabled?: boolean; mode?: CaptureMode }

      if (typed.type === "UICON_HIGHLIGHT_TOGGLE") {
        const enabledValue = Boolean(typed.enabled)
        setEnabled(enabledValue)
        if (!enabledValue) {
          updateHighlight(null)
        }
        return
      }

      if (typed.type === "UICON_HIGHLIGHT_MODE" && (typed.mode === "design" || typed.mode === "text")) {
        currentMode = typed.mode
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)

    const storage = chrome.storage?.local
    storage?.get([TOGGLE_STORAGE_KEY, MODE_STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        return
      }

      const initialEnabled = Boolean(result?.[TOGGLE_STORAGE_KEY])
      const storedMode = result?.[MODE_STORAGE_KEY]

      if (storedMode === "design" || storedMode === "text") {
        currentMode = storedMode
      }

      if (initialEnabled) {
        setEnabled(true)
      }
    })

    return () => {
      detachListeners()
      chrome.runtime.onMessage.removeListener(handleMessage)
      highlight.remove()
      const toast = document.getElementById(TOAST_ID)
      toast?.remove()
      if (toastTimeout) {
        window.clearTimeout(toastTimeout)
      }
    }
  }, [])

  return null
}

export default ElementHighlighter
