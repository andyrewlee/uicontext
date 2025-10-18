export const Home = () => {
  return (
    <>
      <h1>Clerk + Chrome Extension</h1>
      <button
        onClick={() => {
          chrome.tabs.create({
            url: './tabs/background-worker-demo.html',
          })
        }}
      >
        Open background worker demo in a new tab
      </button>
    </>
  )
}