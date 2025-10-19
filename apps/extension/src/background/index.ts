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
  const isTokenRequest =
    request &&
    typeof request === 'object' &&
    ('type' in request ? request.type === 'GET_CLERK_TOKEN' : request?.greeting === 'get-token')

  if (!isTokenRequest) {
    return undefined
  }

  getToken()
    .then((token) => sendResponse({ token }))
    .catch((error) => {
      console.error('[Background service worker] Error:', JSON.stringify(error))
      sendResponse({ token: null, error: String(error) })
    })

  return true
})
