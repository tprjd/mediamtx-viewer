'use client'

import * as Collapsible from '@radix-ui/react-collapsible'
import { ChevronDown, ChevronLeft, ChevronRight, Monitor, MonitorSmartphone, Search, Smartphone, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useFormStatus } from 'react-dom'

import { updateProfileNameAction } from './actions'
import type { AuthSessionView } from '@/lib/auth/types'
import styles from './account.module.css'

function SaveName({ changed }: { changed: boolean }) {
  const { pending } = useFormStatus()
  return <button className={styles.primaryButton} disabled={!changed || pending}>{pending ? 'Saving…' : 'Save name'}</button>
}

export function ProfileNameForm({ name }: { name: string }) {
  const [value, setValue] = useState(name)
  const changed = value.trim() !== name
  return (
    <section className={styles.card}>
      <h2><UserRound aria-hidden="true" /> Profile name</h2>
      <p>This name appears below your stream across the site.</p>
      <form action={updateProfileNameAction} className={styles.form}>
        <label htmlFor="profile-name">Name <small aria-hidden="true">{value.length} / 80</small></label>
        <input id="profile-name" autoComplete="name" value={value} onChange={(event) => setValue(event.target.value)} maxLength={80} minLength={2} name="name" required />
        <div className={styles.formFooter}>
          <SaveName changed={changed} />
          <span>{changed ? 'Unsaved changes' : 'No changes'}</span>
        </div>
      </form>
    </section>
  )
}

function describeDevice(userAgent: string | null) {
  const ua = userAgent ?? ''
  // ponytail: user-agent hints cannot identify disguised browsers; retain raw details.
  const browser = ua.match(/(EdgA?|EdgiOS|OPR)\/([\d.]+)/) ?? ua.match(/(Firefox|FxiOS|Chrome|CriOS)\/([\d.]+)/)
  const safari = /Safari\//.test(ua) && ua.match(/Version\/([\d.]+)/)
  const names: Record<string, string> = { Edg: 'Edge', EdgA: 'Edge', EdgiOS: 'Edge', OPR: 'Opera', FxiOS: 'Firefox', CriOS: 'Chrome' }
  const name = browser ? `${names[browser[1]] ?? browser[1]} ${browser[2].split('.')[0]}` : safari ? `Safari ${safari[1]}` : 'Other client'
  const platform = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown device'
  return { name, platform, browser: Boolean(browser || safari), mobile: /iPhone|iPad|Android/.test(ua) }
}

export function AccountSessions({ sessions }: { sessions: AuthSessionView[] }) {
  const [filter, setFilter] = useState('All')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const rows = sessions.map((session) => ({ ...session, device: describeDevice(session.userAgent) }))
  const browserCount = rows.filter((row) => row.device.browser).length
  const filters = [{ name: 'All', count: rows.length }, { name: 'Browsers', count: browserCount }, { name: 'Other clients', count: rows.length - browserCount }]
  const filtered = rows.filter((row) => (filter === 'All' || row.device.browser === (filter === 'Browsers')) && `${row.device.name} ${row.device.platform} ${row.userAgent ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const pages = Math.max(1, Math.ceil(filtered.length / 8))
  const currentPage = Math.min(page, pages - 1)
  const start = currentPage * 8

  return (
    <section className={`${styles.card} ${styles.sessions}`} aria-labelledby="sessions-heading">
      <div className={styles.sessionsHeading}>
        <h2 id="sessions-heading"><MonitorSmartphone aria-hidden="true" /> Sessions <span className={styles.count}>{sessions.length}</span></h2>
        <p>Browser and client sessions associated with this account.</p>
        <div className={styles.sessionTools}>
          <div className={styles.filters} aria-label="Filter sessions" role="group">
            {filters.map((item) => <button key={item.name} type="button" aria-pressed={filter === item.name} onClick={() => { setFilter(item.name); setPage(0) }}>{item.name} <span>{item.count}</span></button>)}
          </div>
          <label className={styles.search}><Search aria-hidden="true" /><input aria-label="Search sessions" type="search" placeholder="Search sessions" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} /></label>
        </div>
      </div>
      <div className={styles.sessionLabels} aria-hidden="true"><span>Browser / device</span><span>Expires</span></div>
      <ul className={styles.sessionList}>
        {filtered.slice(start, start + 8).map((row) => (
          <li key={row.id}>
            <Collapsible.Root>
              <div className={styles.sessionRow}>
                <div className={styles.device}>
                  <span className={styles.deviceIcon}>{row.device.mobile ? <Smartphone aria-hidden="true" /> : <Monitor aria-hidden="true" />}</span>
                  <div><strong>{row.device.name}</strong><small>{row.device.platform}</small></div>
                </div>
                <time dateTime={row.expiresAt.toISOString()}><span className="sr-only">Expires </span>{row.expiresAt.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })}<small>{row.expiresAt.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' })} UTC</small></time>
                <Collapsible.Trigger className={styles.detailsButton}>Details <ChevronDown aria-hidden="true" /><span className="sr-only"> for {row.device.name}</span></Collapsible.Trigger>
              </div>
              <Collapsible.Content className={styles.sessionDetails}>{row.userAgent || 'No user-agent information available.'}</Collapsible.Content>
            </Collapsible.Root>
          </li>
        ))}
      </ul>
      {filtered.length === 0 && <p className={styles.empty}>No sessions found.</p>}
      <div className={styles.pagination}>
        <span role="status">{filtered.length ? start + 1 : 0}–{Math.min(start + 8, filtered.length)} of {filtered.length} sessions</span>
        <div>
          <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft aria-hidden="true" /> Previous</button>
          <span>{currentPage + 1} / {pages}</span>
          <button type="button" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>Next <ChevronRight aria-hidden="true" /></button>
        </div>
      </div>
      <p className={styles.sessionNote}>Expiration times are shown in UTC. Sessions may include expired entries.</p>
    </section>
  )
}
