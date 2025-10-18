import { SignIn } from '@clerk/chrome-extension'

export const SignInPage = () => {
  return (
    <>
      <p>Sign In</p>
      <SignIn
        appearance={{
          elements: {
            socialButtonsRoot: 'plasmo-hidden',
            dividerRow: 'plasmo-hidden',
          },
        }}
      />
    </>
  )
}
