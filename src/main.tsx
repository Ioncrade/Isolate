import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import { App } from './App'
import { LandingPage } from './LandingPage'
import './styles.css'

function Root() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    const onClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/"]')
      if (!link || link.target || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      window.history.pushState({}, '', link.href)
      setPath(window.location.pathname)
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('popstate', onPopState)
    document.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('popstate', onPopState)
      document.removeEventListener('click', onClick)
    }
  }, [])

  const studio = path === '/studio' || path.startsWith('/studio/')
  useEffect(() => {
    document.title = studio ? 'Isolate — Local mask studio' : 'Isolate — Private browser rotoscoping'
  }, [studio])

  return (
    <>
      {studio ? <App /> : <LandingPage />}
      <Analytics />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Root />)

