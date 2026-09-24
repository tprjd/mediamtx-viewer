import type { ViewingAccessResult } from '@/lib/auth/viewing-access-client'

export type PlaybackRunPhase =
  | 'loading'
  | 'playing'
  | 'reconnecting'
  | 'unauthorized'
  | 'unsupported'
  | 'error'

export type PlaybackRunState = PlaybackRunPhase | 'offline'

export interface PlaybackEnvironment {
  live: boolean
  online: boolean
  userPaused: boolean
  visible: boolean
}

export interface ProgressObservation {
  stable: boolean
  stalled: boolean
}

const STAGNANT_SAMPLE_LIMIT = 5
const STABLE_RECOVERY_RESET_MS = 60_000
const SESSION_CHECK_TIMEOUT_MS = 5_000

interface PlaybackRunOptions {
  environment: () => PlaybackEnvironment
  onPhaseChange: (phase: PlaybackRunPhase) => void
  checkSession: (signal: AbortSignal) => Promise<ViewingAccessResult>
  stop: () => void
  resume?: () => void
  progress: PlaybackProgressMonitor
}

/** Owns recovery work for one attached transport. Media actions stay in the adapter. */
export class PlaybackRun {
  private phase: PlaybackRunPhase = 'loading'
  private disposed = false
  private generation = 0
  private recovery: { action: () => void; dueAt: number } | undefined
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined
  private accessTimer: ReturnType<typeof setTimeout> | undefined
  private accessController: AbortController | undefined

  constructor(private readonly options: PlaybackRunOptions) {}

  acceptsEvents(): boolean {
    return !this.disposed && this.phase !== 'unauthorized' && this.phase !== 'unsupported'
  }

  canRecover(): boolean {
    return this.acceptsEvents() && playbackCanRecover(this.options.environment())
  }

  allowsAutomaticPlay(): boolean {
    const environment = this.options.environment()
    return this.acceptsEvents() && environment.live && !environment.userPaused
  }

  report(phase: PlaybackRunPhase): boolean {
    if (!this.acceptsEvents()) return false
    this.phase = phase
    if (phase === 'playing' || phase === 'unauthorized' || phase === 'unsupported') {
      this.cancelWork()
      this.options.progress.reset()
    }
    this.options.onPhaseChange(phase)
    if (phase === 'unauthorized' || phase === 'unsupported') this.options.stop()
    return true
  }

  recover(action: () => void, delayMs = 0): void {
    if (!this.report('reconnecting')) return
    this.cancelWork()
    if (delayMs === 0 && this.canRecover()) {
      action()
      return
    }
    this.recovery = { action, dueAt: Date.now() + delayMs }
    this.armRecovery()
  }

  checkAccess(recover: () => void): void {
    if (this.accessController) return
    if (!this.report('reconnecting')) return
    this.cancelWork()
    const generation = this.generation
    const controller = new AbortController()
    this.accessController = controller

    const finish = (result: ViewingAccessResult) => {
      if (!this.acceptsEvents() || generation !== this.generation) return
      // Invalidate the request before aborting it, including its rejection handler.
      this.generation += 1
      clearTimeout(this.accessTimer)
      this.accessTimer = undefined
      this.accessController = undefined
      controller.abort()
      if (result === 'unauthorized') {
        this.report('unauthorized')
      } else if (this.canRecover()) {
        recover()
      } else {
        this.recover(recover)
      }
    }

    this.accessTimer = setTimeout(() => finish('unavailable'), SESSION_CHECK_TIMEOUT_MS)
    void this.options.checkSession(controller.signal).then(finish, () => finish('unavailable'))
  }

  environmentChanged(): void {
    this.options.progress.reset()
    clearTimeout(this.recoveryTimer)
    this.recoveryTimer = undefined
    if (!this.canRecover()) return
    if (this.recovery) this.armRecovery()
    else if (this.phase === 'reconnecting' && !this.accessController) this.options.resume?.()
  }

  dispose(): void {
    this.disposed = true
    this.cancelWork()
    this.options.progress.reset()
  }

  private cancelWork(): void {
    this.generation += 1
    clearTimeout(this.recoveryTimer)
    clearTimeout(this.accessTimer)
    this.recoveryTimer = undefined
    this.accessTimer = undefined
    this.recovery = undefined
    this.accessController?.abort()
    this.accessController = undefined
  }

  private armRecovery(): void {
    const recovery = this.recovery
    if (!recovery || !this.canRecover()) return
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined
      if (this.recovery !== recovery || !this.canRecover()) return
      this.recovery = undefined
      recovery.action()
    }, Math.max(0, recovery.dueAt - Date.now()))
  }
}

export function visiblePlaybackState(
  live: boolean,
  phase: PlaybackRunPhase,
): PlaybackRunState {
  return live ? phase : 'offline'
}

export function playbackCanRecover(environment: PlaybackEnvironment): boolean {
  return (
    environment.live &&
    environment.online &&
    !environment.userPaused &&
    environment.visible
  )
}

export class PlaybackProgressMonitor {
  private continuousProgressSince: number | undefined
  private lastProgress: number | undefined
  private stagnantSamples = 0

  observe(progress: number | undefined, now: number): ProgressObservation {
    if (progress === undefined) {
      this.reset()
      return { stable: false, stalled: false }
    }

    if (this.lastProgress === undefined) {
      this.lastProgress = progress
      this.stagnantSamples = 1
      return { stable: false, stalled: false }
    }

    if (progress > this.lastProgress) {
      this.lastProgress = progress
      this.stagnantSamples = 0
      this.continuousProgressSince ??= now
      if (now - this.continuousProgressSince < STABLE_RECOVERY_RESET_MS) {
        return { stable: false, stalled: false }
      }
      this.continuousProgressSince = now
      return { stable: true, stalled: false }
    }

    this.lastProgress = progress
    this.continuousProgressSince = undefined
    this.stagnantSamples += 1
    if (this.stagnantSamples < STAGNANT_SAMPLE_LIMIT) {
      return { stable: false, stalled: false }
    }
    this.stagnantSamples = 0
    return { stable: false, stalled: true }
  }

  reset(): void {
    this.continuousProgressSince = undefined
    this.lastProgress = undefined
    this.stagnantSamples = 0
  }
}
