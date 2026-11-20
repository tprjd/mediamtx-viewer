import { signalRelay } from '@/lib/relay-signaling'

export const dynamic = 'force-dynamic'
const signal = signalRelay.bind(null, 'hls')
export { signal as POST, signal as DELETE }
