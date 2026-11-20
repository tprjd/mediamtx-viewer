import { signalRelay } from '@/lib/relay-signaling'

export const dynamic = 'force-dynamic'
const signal = signalRelay.bind(null, 'whep')
export { signal as OPTIONS, signal as POST, signal as PATCH, signal as DELETE }
