import { useEffect, useState } from 'react'

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

  if (route === '/inputs') return <InputsPage navigate={navigate} />
  if (route === '/outputs') return <OutputsPage navigate={navigate} />
  return <LandingPage navigate={navigate} />
}

export default App
