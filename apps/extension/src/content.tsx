import type { PlasmoCSConfig } from "plasmo"
import { useEffect } from "react"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
}

const STORAGE_KEY = "uicontext:selector-active"
const CAPTURE_STORAGE_KEY = "uicontext:last-capture"
const HIGHLIGHT_ID = "uicontext-element-highlight"
const CAPTURE_MESSAGE = "UICON_CAPTURE_RESULT"

// Build a rough CSS selector path to help the backend reference the element later.
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

// Gather the raw HTML/text plus useful metadata about the selected element.
const captureElementSnapshot = (element: Element) => {
  const html = "outerHTML" in element ? (element as HTMLElement).outerHTML : element.outerHTML ?? ""
  const textContent = element.textContent ?? ""

  return {
    html,
    textContent,
    originUrl: window.location.href,
    pageTitle: document.title,
    selectionPath: buildDomPath(element),
    capturedAt: Date.now(),
  }
}

// Avoid highlighting the extension UI itself (popups, overlays).
const isExtensionElement = (element: Element) => {
  if (element.id === HIGHLIGHT_ID) {
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

const useElementHighlighter = () => {
  useEffect(() => {
    // Create a visual highlight overlay that follows the pointer.
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

    let activeElement: Element | null = null
    let enabled = false

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

    const handleClick = (event: MouseEvent) => {
      if (!enabled || event.button !== 0) {
        return
      }

      const target = resolveTarget(event.target)
      if (!target) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const snapshot = captureElementSnapshot(target)
      // Persist the snapshot so the popup can reload it after Chrome closes the popup window.
      try {
        chrome.storage?.local?.set({ [CAPTURE_STORAGE_KEY]: snapshot }, () => void chrome.runtime.lastError)
      } catch {
        /* ignored */
      }
      chrome.runtime.sendMessage(
        { type: CAPTURE_MESSAGE, payload: snapshot },
        () => void chrome.runtime.lastError,
      )
      activeElement = target
      updateHighlight(target)
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
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        (message as { type: string }).type === "UICON_HIGHLIGHT_TOGGLE"
      ) {
        const enabledValue = Boolean((message as { enabled?: boolean }).enabled)
        setEnabled(enabledValue)
        if (!enabledValue) {
          updateHighlight(null)
        }
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)

    const storage = chrome.storage?.local
    storage?.get([STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        return
      }
      const initial = Boolean(result?.[STORAGE_KEY])
      if (initial) {
        setEnabled(true)
      }
    })

    return () => {
      detachListeners()
      chrome.runtime.onMessage.removeListener(handleMessage)
      highlight.remove()
    }
  }, [])
}

const ElementHighlighter = () => {
  useElementHighlighter()
  return null
}

export default ElementHighlighter
