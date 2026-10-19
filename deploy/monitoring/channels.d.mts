export function channelMonitor(): (
  read: (path: string) => Promise<unknown>,
  emit: (record: { event: string; level: string; message: string; channel: string; live: boolean }) => void,
  now?: number,
) => Promise<string[]>
