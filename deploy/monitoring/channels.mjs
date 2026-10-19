import { countViewers, isThumbnailSession, readViewerId } from '../../lib/media-readers.ts'
import { hlsDerivativePath } from '../../lib/whip-pilot.ts'

const channelPath = /^(?:live|channels\/[a-z0-9]+(?:-[a-z0-9]+)*)$/
const publicProtocols = { hlsSession: 'hls', webRTCSession: 'webrtc' }
const counter = value => Number.isSafeInteger(value) && value >= 0
const text = value => typeof value === 'string' && value.length <= 4096

// Session IDs stay in memory to detect counter resets. They never enter exported labels or logs.
export function channelMonitor() {
  const known = new Map()
  let previous = new Map(), lastPoll = 0, initialized = false
  return async (read, emit, now = Date.now()) => {
    try {
      const [paths, hls, webRtc] = await Promise.all(['paths', 'hlssessions', 'webrtcsessions'].map(async resource => {
        const data = await read(`/v3/${resource}/list?itemsPerPage=1000`)
        if (!Array.isArray(data.items) || data.items.length > 1000 || !Number.isInteger(data.pageCount) || data.pageCount > 1 || data.itemCount !== data.items.length) throw new Error('media-list-incomplete')
        return data.items
      }))
      for (const path of paths) {
        if (!text(path.name) || typeof path.ready !== 'boolean' || !Array.isArray(path.readers) || path.readers.length > 1000 ||
          path.readers.some(reader => !text(reader.id) || !text(reader.type)) ||
          (path.ready && (!text(path.source?.id) || !text(path.source?.type))) ||
          (path.tracks !== undefined && (!Array.isArray(path.tracks) || path.tracks.some(track => !text(track))))) throw new Error('media-path-invalid')
      }
      for (const session of [...hls, ...webRtc]) {
        if (!text(session.id) || !text(session.path) || (session.query !== undefined && !text(session.query)) ||
          (session.userAgent !== undefined && !text(session.userAgent))) throw new Error('media-session-invalid')
      }
      const current = new Map(paths.map(path => [path.name, path]))
      const mappings = new Map()
      let overflow = false
      for (const path of paths) {
        if (path.name.length > 73 || !channelPath.test(path.name)) continue
        if (!known.has(path.name)) {
          if (known.size >= 100) { overflow = true; continue }
          known.set(path.name, undefined)
        }
        mappings.set(path.name, path.name)
        const derived = hlsDerivativePath(path)
        if (derived && current.get(derived)?.ready) mappings.set(derived, path.name)
      }
      const sessions = new Map(), thumbnails = new Set(), identities = new Map()
      let unassigned = 0
      for (const [protocol, entries] of [['hls', hls], ['webrtc', webRtc]]) {
        for (const session of entries) {
          if (protocol === 'webrtc' && session.state !== 'read') continue
          if (isThumbnailSession(session.query, session.userAgent)) { thumbnails.add(session.id); continue }
          sessions.set(`${protocol}:${session.id}`, session)
          const identity = readViewerId(session.query)
          if (identity) identities.set(session.id, identity)
          if (!mappings.has(session.path)) unassigned++
        }
      }
      const output = [], next = new Map()
      const sample = (name, value, labels = '') => output.push(`monitoring_channel_${name}${labels} ${value}`)
      const elapsed = (now - lastPoll) / 1000
      for (const [channel, before] of known) {
        const path = current.get(channel), live = path?.ready === true
        const labels = `{channel="${channel}"}`
        sample('live', Number(live), labels)
        const publisherProtocol = path?.source?.type === 'webRTCSession' ? 'whip' : path?.source?.type === 'rtmpConn' ? 'rtmp' : 'other'
        for (const protocol of ['whip', 'rtmp', 'other']) sample('publishers', Number(live && publisherProtocol === protocol), `{channel="${channel}",protocol="${protocol}"}`)
        if (before === undefined || before !== live) {
          emit({ event: before === undefined && (!initialized || !live) ? 'channel_observed' : live ? 'channel_started' : 'channel_stopped', level: 'info', message: 'Channel state observed', channel, live })
        }
        known.set(channel, live)
        const derived = live ? current.get(hlsDerivativePath(path)) : undefined
        const readers = live ? [...path.readers, ...(derived?.ready ? derived.readers : [])] : []
        const groups = new Map([['publisher:media', new Map()], ['viewer:hls', new Map()], ['viewer:webrtc', new Map()]])
        const groupComplete = new Map([...groups.keys()].map(key => [key, true]))
        if (live) groups.get('publisher:media').set(`${path.source.type}:${path.source.id}:${path.readyTime ?? ''}`, path.inboundBytes)
        for (const protocol of ['hls', 'webrtc']) {
          let connections = 0
          const seen = new Set()
          for (const reader of readers) {
            if (publicProtocols[reader.type] !== protocol || thumbnails.has(reader.id) || seen.has(reader.id)) continue
            seen.add(reader.id)
            const session = sessions.get(`${protocol}:${reader.id}`)
            if (!session || mappings.get(session.path) !== channel) { groupComplete.set(`viewer:${protocol}`, false); continue }
            connections++
            groups.get(`viewer:${protocol}`).set(session.id, session.outboundBytes)
          }
          sample('connections', connections, `{channel="${channel}",protocol="${protocol}"}`)
        }
        // A session can join between the path and session list requests; don't present that race as exact.
        for (const [key, session] of sessions) {
          const group = `viewer:${key.split(':')[0]}`
          if (mappings.get(session.path) === channel && !groups.get(group).has(session.id)) groupComplete.set(group, false)
        }
        const complete = [...groupComplete.values()].every(Boolean)
        sample('connections_complete', Number(complete), labels)
        if (complete) sample('viewers', countViewers(readers, thumbnails, identities), labels)
        let ratesComplete = complete
        for (const [group, values] of groups) {
          const key = `${channel}:${group}`, old = previous.get(key)
          const valid = groupComplete.get(group) && elapsed > 0 && elapsed <= 45 && old?.size === values.size && [...values].every(([id, bytes]) => counter(bytes) && counter(old.get(id)) && bytes >= old.get(id))
          const [direction, protocol] = group.split(':')
          sample('rate_complete', Number(Boolean(valid)), `{channel="${channel}",direction="${direction}",protocol="${protocol}"}`)
          if (valid) {
            const bytes = [...values].reduce((sum, [id, value]) => sum + value - old.get(id), 0)
            sample('bytes_per_second', bytes / elapsed, `{channel="${channel}",direction="${direction}",protocol="${protocol}"}`)
          } else ratesComplete = false
          if (groupComplete.get(group)) next.set(key, values)
        }
        sample('rates_complete', Number(ratesComplete), labels)
      }
      sample('collection_success', 1)
      sample('last_success_seconds', now / 1000)
      sample('capacity_exceeded', Number(overflow))
      sample('unassigned_paths', paths.filter(path => !mappings.has(path.name)).length)
      sample('unassigned_connections', unassigned)
      previous = next; lastPoll = now; initialized = true
      return output
    } catch {
      previous.clear(); lastPoll = 0
      return ['monitoring_channel_collection_success 0']
    }
  }
}
