/** The same two-note sound is used for incoming notifications and manual previews. */
export function playNotificationTone(context: AudioContext): Promise<void> {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  gain.gain.setValueAtTime(.04, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .4)
  oscillator.frequency.setValueAtTime(660, context.currentTime)
  oscillator.frequency.setValueAtTime(880, context.currentTime + .15)
  oscillator.connect(gain).connect(context.destination)
  return new Promise((resolve) => {
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
      resolve()
    }
    oscillator.start()
    oscillator.stop(context.currentTime + .4)
  })
}
