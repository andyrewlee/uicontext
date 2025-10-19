import { ClerkProvider, SignedIn, SignedOut, UserButton } from '@clerk/chrome-extension'
import { Outlet, useNavigate } from 'react-router-dom'

import { BrowserAuthButton } from '../components/browser-auth-button'

const PUBLISHABLE_KEY = process.env.PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY
const SYNC_HOST = process.env.PLASMO_PUBLIC_CLERK_SYNC_HOST

if (!PUBLISHABLE_KEY || !SYNC_HOST) {
  throw new Error(
    'Please add the PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY and PLASMO_PUBLIC_CLERK_SYNC_HOST to the .env.development file',
  )
}

const getExtensionPopupUrl = () => {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL('popup.html')
  }
  return '/'
}

export const RootLayout = () => {
  const navigate = useNavigate()
  const popupUrl = getExtensionPopupUrl()

  return (
    <ClerkProvider
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl={popupUrl}
      afterSignInUrl={popupUrl}
      afterSignUpUrl={popupUrl}
      signInFallbackRedirectUrl={popupUrl}
      signUpFallbackRedirectUrl={popupUrl}
      syncHost={SYNC_HOST}
    >
      <div className="plasmo-flex plasmo-h-[600px] plasmo-w-[785px] plasmo-flex-col plasmo-bg-white">
        <SignedOut>
          <div className="plasmo-flex plasmo-h-full plasmo-w-full plasmo-items-center plasmo-justify-center plasmo-p-8">
            <BrowserAuthButton mode="sign-in" />
          </div>
        </SignedOut>

        <SignedIn>
          <header className="plasmo-flex plasmo-items-center plasmo-justify-end plasmo-border-b plasmo-border-gray-200 plasmo-px-4 plasmo-py-3">
            <UserButton />
          </header>
          <main className="plasmo-flex-1 plasmo-overflow-auto plasmo-p-6">
            <Outlet />
          </main>
        </SignedIn>
      </div>
    </ClerkProvider>
  )
}
