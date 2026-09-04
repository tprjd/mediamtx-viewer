import { APP_VERSION } from '@/lib/app-version'

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>v{APP_VERSION}</span>
    </footer>
  )
}
