import { useCallback, useState } from 'react'
import { useClerk } from '@clerk/chrome-extension'

const getPopupUrl = () => {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL('popup.html')
  }
  return '/'
}

const openInBrowser = (url: string) => {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url })
    return
  }

  window.open(url, '_blank', 'noopener')
}

export const BrowserAuthButton = ({ className }: { className?: string }) => {
  const clerk = useClerk()
  const [isOpening, setIsOpening] = useState(false)

  const handleClick = useCallback(async () => {
    if (!clerk) {
      console.error('Clerk is not ready yet')
      return
    }

    const builder = clerk.buildSignInUrl

    if (!builder) {
      console.error('Unable to build Clerk sign-in URL')
      return
    }

    setIsOpening(true)
    try {
      const redirectUrl = getPopupUrl()
      const targetUrl = await builder({ redirectUrl, afterSignInUrl: redirectUrl })

      if (!targetUrl) {
        console.error('Received empty URL from Clerk')
        return
      }

      openInBrowser(targetUrl)
    } catch (error) {
      console.error('Failed to open Clerk sign-in page', error)
    } finally {
      setIsOpening(false)
    }
  }, [clerk])

  const label = isOpening ? 'Opening...' : 'Sign In'

  return (
    <button
      type="button"
      className={`plasmo-inline-flex plasmo-w-full plasmo-max-w-[240px] plasmo-items-center plasmo-justify-center plasmo-rounded plasmo-bg-black plasmo-px-4 plasmo-py-2 plasmo-text-sm plasmo-font-medium plasmo-text-white ${className ?? ''}`}
      onClick={handleClick}
      disabled={isOpening}
    >
      {label}
    </button>
  )
}
