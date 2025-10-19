import React from 'react'

import '../style.css'

import { Navigate, createMemoryRouter, RouterProvider } from 'react-router'

import { RootLayout } from './layouts/root-layout'
import { Home } from './routes/home'
import { Settings } from './routes/settings'

const router = createMemoryRouter([
  {
    // Wraps the entire app in the root layout
    element: <RootLayout />,
    // Mounted where the <Outlet /> component is inside the root layout
    children: [
      { path: '/', element: <Home /> },
      { path: '/settings', element: <Settings /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function PopupIndex() {
  return <RouterProvider router={router} />
}
