import type { NextConfig } from 'next'

const hlsOrigin = process.env.MEDIAMTX_HLS_URL ?? 'http://127.0.0.1:8888'
const webrtcOrigin =
  process.env.MEDIAMTX_WEBRTC_URL ?? 'http://127.0.0.1:8889'

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: [
    'oci-common',
    'oci-core',
    'oci-monitoring',
    'oci-usageapi',
  ],
  async headers() {
    return [
      {
        source: '/statistics',
        headers: [
          {
            key: 'Cache-Control',
            value: 'private, no-store, max-age=0',
          },
        ],
      },
    ]
  },
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
