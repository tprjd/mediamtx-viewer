export function percentile(values, fraction = 0.95) {
  if (!values.length || values.some(value => !Number.isFinite(value))) return null
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]
}

export function capacityFailures(report) {
  const failures = []
  const require = (condition, name) => { if (!condition) failures.push(name) }
  const below = (value, limit) => Number.isFinite(value) && value >= 0 && value <= limit
  require(report.durationSeconds >= 900 && report.connections === 100, 'load-duration-and-connections')
  require(report.accepted === 9000 && report.rejected === 0 && report.lateSubmissions === 0, 'accepted-rate')
  require(report.deliveryCount === report.expectedDeliveryCount && report.deliveryCount >= 890000, 'complete-delivery')
  require(below(report.submissionP95Ms, 500), 'submission-latency')
  require(below(report.deliveryP95Ms, 1000), 'delivery-latency')
  require(report.historyPages >= 80 && below(report.historyP95Ms, 1000), 'history-latency')
  require(report.reconnectMs?.length === 100 && report.reconnectMs.every(ms => below(ms, 5000)), 'reconnect-and-reconciliation')
  require(report.playbackSamples >= 850 && report.playbackFailures === 0, 'playback')
  require(report.statusSamples >= 400 && below(report.statusP95Ms, 1000) &&
    below(report.statusMaxAgeMs, 5000) && below(report.heartbeatMaxGapMs, 22000) &&
    report.heartbeats >= 40 && report.statusFailures === 0, 'channel-status')
  require(report.hostSamples >= 90 && report.hostFailures === 0 && report.steadyState === true, 'host-health')
  require(report.errors?.length === 0, 'driver-errors')
  return failures
}

export function storageFailures(budget, host) {
  const db = host?.database
  if (!db || !budget || budget.dailyMessages !== 100000 || budget.retainedMessages !== 700000 ||
      !Number.isFinite(budget.requiredChatBytes) || budget.requiredChatBytes <= 0 ||
      !Number.isFinite(budget.databaseBytes) || budget.databaseBytes <= 0 ||
      !Number.isFinite(db.authBytes) || db.authBytes < 0 ||
      !Number.isFinite(db.freeBytes) || !Number.isFinite(db.minimumFreeBytes) ||
      !Number.isFinite(db.databaseLimitBytes)) return ['storage-evidence']
  const failures = []
  // Keep 25% margin for WAL, participants, restrictions and moderation records.
  if (budget.databaseBytes * 1.25 >= db.databaseLimitBytes) failures.push('database-budget')
  if (db.freeBytes - budget.requiredChatBytes * 1.25 - db.authBytes * 10 < db.minimumFreeBytes)
    failures.push('disk-budget')
  return failures
}
