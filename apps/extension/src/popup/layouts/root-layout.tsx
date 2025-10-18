import { ClerkProvider, SignedIn, SignedOut, UserButton } from '@clerk/chrome-extension'
import { Link, Outlet, useNavigate } from 'react-router-dom'

const PUBLISHABLE_KEY = process.env.PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY
const SYNC_HOST = process.env.PLASMO_PUBLIC_CLERK_SYNC_HOST

if (!PUBLISHABLE_KEY || !SYNC_HOST) {
  throw new Error(
    'Please add the PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY and PLASMO_PUBLIC_CLERK_SYNC_HOST to the .env.development file',
  )
}

export const RootLayout = () => {
  const navigate = useNavigate()

  return (
    <ClerkProvider
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      syncHost={SYNC_HOST}
    >
      <div className="plasmo-w-[785px] plasmo-h-[600px]">
        <main>
          <Outlet />
        </main>
        <footer>
          <SignedIn>
            <Link to="/settings">Settings</Link>
            <UserButton />
          </SignedIn>
          <SignedOut>
            <Link to="/">Home</Link>
            <Link to="/sign-in">Sign In</Link>
            <Link to="/sign-up">Sign Up</Link>
          </SignedOut>
        </footer>
      </div>
    </ClerkProvider>
  )
}
