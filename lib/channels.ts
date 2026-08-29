import 'server-only'

import rawChannels from '@/config/channels.json'
import { channelsSchema, type Channel } from '@/lib/channel-schema'

const channels = channelsSchema.parse(rawChannels)

export function getChannels(): readonly Channel[] {
  return channels
}

export function getChannel(slug: string): Channel | undefined {
  return channels.find((channel) => channel.slug === slug)
}
