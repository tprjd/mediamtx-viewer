import { APP_VERSION } from '@/lib/app-version'
import styles from './site-footer.module.css'

export function SiteFooter() {
  return (
    <footer className={styles.siteFooter}>
      <span>v{APP_VERSION}</span>
    </footer>
  )
}
