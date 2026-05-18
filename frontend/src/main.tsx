import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import { ThemeProvider } from "@/components/theme-provider"
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="meshcore-ui-theme">
      <App />
    </ThemeProvider>
  </StrictMode>,
)
