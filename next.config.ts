import type { NextConfig } from 'next'

const hlsOrigin = process.env.MEDIAMTX_HLS_URL ?? 'http://127.0.0.1:8888'
const webrtcOrigin =
  process.env.MEDIAMTX_WEBRTC_URL ?? 'http://127.0.0.1:8889'

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: '/media/hls/:path*',
        destination: `${hlsOrigin}/:path*`,
      },
      {
        source: '/media/whep/:path*',
        destination: `${webrtcOrigin}/:path*`,
      },
    ]
  },
}

export default nextConfig
