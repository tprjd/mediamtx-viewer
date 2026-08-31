import { z } from 'zod'

export const mediaPathSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/,
    'Media paths may only contain letters, numbers, dots, underscores, dashes, and slashes',
  )
  .refine(
    (path) =>
      !path.includes('..') &&
      !path.includes('//') &&
      !path.endsWith('/') &&
      !path.startsWith('/'),
    'Media paths must be normalized relative paths',
  )

export const channelSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Channel slugs must be kebab-case')

export const channelMetadataSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300),
})

export const channelSchema = z.object({
  slug: channelSlugSchema,
  mediaPath: mediaPathSchema,
  ownerName: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
  poster: z.string().min(1).optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Accent colors must be six-digit hex colors')
    .default('#8b5cf6'),
  preferredPlayback: z.enum(['hls', 'webrtc']).default('hls'),
  fallbackMediaPath: mediaPathSchema.optional(),
})

export const channelsSchema = z
  .array(channelSchema)
  .min(1)
  .superRefine((channels, context) => {
    const slugs = new Set<string>()
    const paths = new Set<string>()

    channels.forEach((channel, index) => {
      if (slugs.has(channel.slug)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate channel slug: ${channel.slug}`,
          path: [index, 'slug'],
        })
      }
      if (paths.has(channel.mediaPath)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate MediaMTX path: ${channel.mediaPath}`,
          path: [index, 'mediaPath'],
        })
      }
      slugs.add(channel.slug)
      paths.add(channel.mediaPath)
    })
  })

export type Channel = z.infer<typeof channelSchema>
export type ChannelMetadata = z.infer<typeof channelMetadataSchema>
