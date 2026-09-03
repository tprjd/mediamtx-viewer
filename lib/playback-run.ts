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
