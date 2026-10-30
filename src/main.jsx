import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.jsx'
import PantallaMonotributoCarga from './sueldos/PantallaMonotributoCarga.jsx'

// Link del mail de monotributo: página pública, fuera del login (ver apps-script-monotributo.gs).
const esCargaMonotributo = new URLSearchParams(window.location.search).has('monotributo')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {esCargaMonotributo ? <PantallaMonotributoCarga /> : <Root />}
  </StrictMode>,
)
