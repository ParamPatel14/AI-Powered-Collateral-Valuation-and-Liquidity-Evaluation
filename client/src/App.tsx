import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import {
  InputsPage,
  LandingPage,
  OutputsPage,
} from './pages/PropertyEvaluationPage'

type Route = '/' | '/inputs' | '/outputs'

function normalizeRoute(raw: string): Route {
  if (raw === '/inputs') return '/inputs'
  if (raw === '/outputs') return '/outputs'
  return '/'
}

function getRouteFromLocation(): Route {
  const hash = window.location.hash || '#/'
  const path = hash.startsWith('#') ? hash.slice(1) : hash
  return normalizeRoute(path)
}

function App() {
  const [route, setRoute] = useState<Route>(() => getRouteFromLocation())

  useEffect(() => {
    const onHashChange = () => setRoute(getRouteFromLocation())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = (to: Route) => {
    if (to === route) return
    window.location.hash = to === '/' ? '/' : to
    setRoute(to)
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={route}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18 }}
      >
        {route === '/inputs' && <InputsPage navigate={navigate} />}
        {route === '/outputs' && <OutputsPage navigate={navigate} />}
        {route === '/' && <LandingPage navigate={navigate} />}
      </motion.div>
    </AnimatePresence>
  )
}

export default App
