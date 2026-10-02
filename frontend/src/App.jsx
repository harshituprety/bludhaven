import { lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import AuthLayout from './layouts/AuthLayout'
import AdminLayout from './layouts/AdminLayout'

// Route-level code splitting: each page loads on demand (see Suspense in layouts).
const Home = lazy(() => import('./pages/Home'))
const Listings = lazy(() => import('./pages/Listings'))
const Destinations = lazy(() => import('./pages/Destinations'))
const PropertyDetails = lazy(() => import('./pages/PropertyDetails'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const NotFound = lazy(() => import('./pages/NotFound'))

export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<Home />} />
        <Route path="destinations" element={<Destinations />} />
        <Route path="properties" element={<Listings />} />
        <Route path="properties/:id" element={<PropertyDetails />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route element={<AuthLayout />}>
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
      </Route>

      {/* Admin-only once role-based access control exists. */}
      <Route path="admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
      </Route>
    </Routes>
  )
}
