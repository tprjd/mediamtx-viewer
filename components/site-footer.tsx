import { APP_VERSION } from '@/lib/app-version'

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>Home Stream</p>
      <span>v{APP_VERSION}</span>
    </footer>
  )
}
