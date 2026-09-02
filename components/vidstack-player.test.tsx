import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VidstackPlayer } from '@/components/vidstack-player'

const mocks = vi.hoisted(() => {
  class LocalHls {}

  return {
    LocalHls,
    hlsInstance: { name: 'hls instance' },
    provider: {
      config: undefined as unknown,
      kind: 'hls',
      library: undefined as unknown,
      onInstance: vi.fn(),
      video: undefined as unknown as HTMLVideoElement,
    },
  }
})

vi.mock('hls.js', () => ({ default: mocks.LocalHls }))

vi.mock('@vidstack/react', async () => {
  const React = await import('react')
  const button = ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  )

  return {
    Controls: {
      Group: ({ children, ...props }: React.ComponentProps<'div'>) => (
        <div {...props}>{children}</div>
      ),
      Root: ({ children, ...props }: React.ComponentProps<'div'>) => (
        <div {...props}>{children}</div>
      ),
    },
    FullscreenButton: button,
    isHLSProvider: (provider: { kind?: string }) => provider.kind === 'hls',
    isVideoProvider: (provider: { kind?: string }) =>
      provider.kind === 'hls' || provider.kind === 'native',
    LiveButton: button,
    MediaAnnouncer: () => null,
    MediaPlayer: ({
      children,
      onProviderChange,
    }: {
      children: React.ReactNode
      onProviderChange?: (provider: typeof mocks.provider) => void
    }) => {
      React.useEffect(() => {
        onProviderChange?.(mocks.provider)
        return () => onProviderChange?.(null as never)
      }, [onProviderChange])
      return <div>{children}</div>
    },
    MediaProvider: (props: React.ComponentProps<'div'>) => <div {...props} />,
    MuteButton: button,
    PIPButton: button,
    PlayButton: button,
    Poster: () => null,
    useMediaState: (state: string) => state !== 'fullscreen',
    VolumeSlider: {
      Root: ({ children, ...props }: React.ComponentProps<'div'>) => (
        <div {...props}>{children}</div>
      ),
      Thumb: (props: React.ComponentProps<'div'>) => <div {...props} />,
      Track: ({ children, ...props }: React.ComponentProps<'div'>) => (
        <div {...props}>{children}</div>
      ),
      TrackFill: (props: React.ComponentProps<'div'>) => <div {...props} />,
    },
  }
})

describe('VidstackPlayer', () => {
  beforeEach(() => {
    mocks.provider.config = undefined
    mocks.provider.kind = 'hls'
    mocks.provider.library = undefined
    mocks.provider.video = document.createElement('video')
    mocks.provider.onInstance.mockReset()
    mocks.provider.onInstance.mockImplementation((callback) => {
      callback(mocks.hlsInstance)
      return vi.fn()
    })
  })

  afterEach(cleanup)

  it('configures Vidstack to use the bundled hls.js instance', () => {
    const onHlsInstanceChange = vi.fn()
    const onProviderKindChange = vi.fn()
    const onVideoElementChange = vi.fn()
    const config = { liveSyncDuration: 1.2, liveMaxLatencyDuration: 2 }

    render(
      <VidstackPlayer
        ariaLabel="Live channel video"
        hlsConfig={config}
        onHlsInstanceChange={onHlsInstanceChange}
        onProviderKindChange={onProviderKindChange}
        onVideoElementChange={onVideoElementChange}
        seekableLive
      />,
    )

    expect(mocks.provider.library).toBe(mocks.LocalHls)
    expect(mocks.provider.config).toEqual(config)
    expect(onHlsInstanceChange).toHaveBeenCalledWith(mocks.hlsInstance)
    expect(onProviderKindChange).toHaveBeenCalledWith('hls')
    expect(onVideoElementChange).toHaveBeenCalledWith(mocks.provider.video)
    expect(screen.getByRole('button', { name: 'Play video' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Toggle picture in picture' }),
    ).toBeInTheDocument()
  })

  it('reports the native video provider without creating hls.js', () => {
    mocks.provider.kind = 'native'
    const onHlsInstanceChange = vi.fn()
    const onProviderKindChange = vi.fn()
    const onVideoElementChange = vi.fn()

    render(
      <VidstackPlayer
        ariaLabel="Live channel video"
        onHlsInstanceChange={onHlsInstanceChange}
        onProviderKindChange={onProviderKindChange}
        onVideoElementChange={onVideoElementChange}
      />,
    )

    expect(mocks.provider.onInstance).not.toHaveBeenCalled()
    expect(onHlsInstanceChange).toHaveBeenCalledWith(null)
    expect(onProviderKindChange).toHaveBeenCalledWith('native')
    expect(onVideoElementChange).toHaveBeenCalledWith(mocks.provider.video)
    expect(screen.getByText('Live')).toBeInTheDocument()
  })
})
