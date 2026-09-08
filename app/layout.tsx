import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'

import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'FrankerzSpam',
    template: '%s · FrankerzSpam',
  },
  description: 'Independent live video, streamed directly from home.',
  metadataBase: new URL('http://localhost:3000'),
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#09090b',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html data-scroll-behavior="smooth" lang="en">
      <body>
        <div className="app-shell">
          <SiteHeader />
          {children}
          <SiteFooter />
        </div>
      </body>
    </html>
  )
}
