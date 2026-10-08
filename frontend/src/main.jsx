import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import AuthProvider from './context/AuthProvider'
import FavouritesProvider from './context/FavouritesProvider'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <FavouritesProvider>
          <App />
        </FavouritesProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
