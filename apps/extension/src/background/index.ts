import { createClerkClient } from '@clerk/chrome-extension/background'

const publishableKey = process.env.PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY

if (!publishableKey) {
  throw new Error('Please add the PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY to the .env.development file')
}

// Lazily ask Clerk for the latest session token whenever the popup/content code needs it.
async function getToken() {
  const clerk = await createClerkClient({
    publishableKey,
  })

  if (!clerk.session) {
    return null
  }

  return await clerk.session.getToken({ template: 'convex' })
}

// Respond to messages from other extension contexts (popup/content scripts).
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || typeof request !== 'object') {
    return undefined
  }

  // Content scripts ask for a Convex auth token by sending GET_CLERK_TOKEN.
  // This stays in the background script so Clerk dependencies never bundle into the content layer.
  if ('type' in request && request.type === 'GET_CLERK_TOKEN') {
    getToken()
      .then((token) => sendResponse({ token }))
      .catch((error) => {
        console.error('[Background service worker] Error:', JSON.stringify(error))
        sendResponse({ token: null, error: String(error) })
      })

    return true
  }

  // Design captures request a full-page screenshot, which we obtain from the background
  // because content scripts do not have access to chrome.tabs APIs.
  if ('type' in request && request.type === 'UICON_CAPTURE_SCREENSHOT') {
    const targetWindow = sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT

    chrome.tabs.captureVisibleTab(targetWindow, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ dataUrl: null, error: chrome.runtime.lastError.message })
        return
      }

      sendResponse({ dataUrl: dataUrl ?? null })
    })

    return true
  }

  return undefined
})
