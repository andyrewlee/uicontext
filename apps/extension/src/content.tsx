import type { PlasmoCSConfig } from "plasmo"
import { useEffect } from "react"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
}

const STORAGE_KEY = "uicontext:selector-active"
const HIGHLIGHT_ID = "uicontext-element-highlight"

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

    const logElementWithChildren = (element: Element) => {
      const descendants = element.querySelectorAll("*")

      console.group("[uicontext] Selected element")
      console.log("Element:", element)

      if (descendants.length === 0) {
        console.log("No child elements")
      } else {
        descendants.forEach((child, index) => {
          console.log(`Child ${index}:`, child)
        })
      }

      console.groupEnd()
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

      logElementWithChildren(target)
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
