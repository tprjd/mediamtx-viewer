const MAX_CHAT_GRAPHEMES = 500
const graphemeSegmenter = new Intl.Segmenter('und', {
  granularity: 'grapheme',
})

export class ChatMessageValidationError extends Error {}

export function normalizeChatMessage(rawContent: string): string {
  const content = rawContent
    .normalize('NFC')
    .replace(/\r\n|[\n\r\u2028\u2029]/gu, ' ')
    .trim()

  if (!content || !content.replace(/[\p{C}\s]/gu, '')) {
    throw new ChatMessageValidationError('Enter a message.')
  }

  const graphemeCount = [...graphemeSegmenter.segment(content)].length
  if (graphemeCount > MAX_CHAT_GRAPHEMES) {
    throw new ChatMessageValidationError(
      `Messages can contain at most ${MAX_CHAT_GRAPHEMES} characters.`,
    )
  }

  return content
}

export function allocateChatAuthorTag(
  tagSource: string,
  existingTags: ReadonlySet<string>,
): string {
  for (let length = 4; length <= tagSource.length; length += 1) {
    const candidate = tagSource.slice(0, length)
    if (!existingTags.has(candidate)) return candidate
  }

  throw new Error('Could not allocate a unique Chat author tag.')
}
