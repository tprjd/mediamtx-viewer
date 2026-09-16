import { expect, it } from 'vitest'
import { capacityFailures, percentile, storageFailures } from './report.mjs'

it('refuses incomplete, empty and non-finite capacity evidence', () => {
  expect(capacityFailures({}).length).toBeGreaterThan(8)
  expect(percentile([])).toBeNull()
  expect(percentile([1, NaN])).toBeNull()
  expect(percentile(Array.from({length: 100}, (_, i) => i + 1))).toBe(95)
})

it('requires the complete load and rejects missed recipients even with low latency', () => {
  const report = {durationSeconds: 900, connections: 100, accepted: 9000, rejected: 0,
    lateSubmissions: 0, deliveryCount: 900000, expectedDeliveryCount: 900000,
    submissionP95Ms: 500, deliveryP95Ms: 1000, historyPages: 90, historyP95Ms: 1000,
    reconnectMs: Array(100).fill(5000), playbackSamples: 900, playbackFailures: 0,
    statusSamples: 450, statusP95Ms: 100, statusMaxAgeMs: 2200, heartbeatMaxGapMs: 20100,
    heartbeats: 45, statusFailures: 0, hostSamples: 90, hostFailures: 0, steadyState: true, errors: []}
  expect(capacityFailures(report)).toEqual([])
  expect(capacityFailures({...report, deliveryCount: 899999})).toContain('complete-delivery')
  expect(capacityFailures({...report, accepted: 8999})).toContain('accepted-rate')
  expect(capacityFailures({...report, submissionP95Ms: null})).toContain('submission-latency')
  expect(capacityFailures({...report, reconnectMs: [1]})).toContain('reconnect-and-reconciliation')
})

it('reserves seven backup sets, replacement workspace and the free disk floor', () => {
  const budget = {dailyMessages: 100000, retainedMessages: 700000, databaseBytes: 100,
    requiredChatBytes: 1100}
  const host = {database: {authBytes: 10, databaseLimitBytes: 200, freeBytes: 2000, minimumFreeBytes: 600}}
  expect(storageFailures(budget, host)).toEqual(['disk-budget'])
  expect(storageFailures(budget, {...host, database: {...host.database, freeBytes: 2200}})).toEqual([])
  expect(storageFailures({}, host)).toEqual(['storage-evidence'])
})
