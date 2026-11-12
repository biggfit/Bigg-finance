import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.jsx'
import PantallaMonotributoCarga from './sueldos/PantallaMonotributoCarga.jsx'
import PantallaReintegroCarga from './sueldos/PantallaReintegroCarga.jsx'

// Links públicos, fuera del login:
//  ?monotributo → carga del monotributo (ver apps-script-monotributo.gs)
//  ?reintegro   → formulario de reintegro (ver apps-script-reintegro.gs)
const params = new URLSearchParams(window.location.search)
const esCargaMonotributo = params.has('monotributo')
const esCargaReintegro   = params.has('reintegro')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {esCargaMonotributo ? <PantallaMonotributoCarga />
      : esCargaReintegro ? <PantallaReintegroCarga />
      : <Root />}
  </StrictMode>,
)
