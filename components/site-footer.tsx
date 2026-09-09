import { APP_VERSION } from '@/lib/app-version'
import styles from './site-footer.module.css'

interface SiteFooterProps {
  placement?: 'global' | 'watch'
}

export function SiteFooter({ placement = 'global' }: SiteFooterProps) {
  return (
    <footer
      aria-label="Application version"
      className={`${styles.siteFooter}${placement === 'watch' ? ` ${styles.watchFooter}` : ''}`}
      data-watch-footer={placement === 'watch' ? '' : undefined}
    >
      <span>v{APP_VERSION}</span>
    </footer>
  )
}
