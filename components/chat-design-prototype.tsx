'use client'

// THROWAWAY: three Chat designs on /watch/[slug]?variant=A|B|C.
// Question: which message hierarchy and panel layout works beside video on desktop and mobile?
// Messages and moderation are in-memory fixtures. No Chat API is called.

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import { ArrowDown, Ban, Check, ChevronDown, Eye, History, Maximize2, MessageSquare, Minimize2, MoreHorizontal, Send, Timer, Trash2, Users, X } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { ChannelNavigation } from '@/components/channel-navigation'
import { PrototypeSwitcher } from '@/components/prototype-switcher'
import { PrototypeChatSettings, PrototypeModerationDialog, PrototypeRestrictionsDialog, PrototypeRoleBadge, type ModerationAction, type ModerationDetails, type ModerationTarget, type PrototypeRestriction } from '@/components/chat-design-prototype-controls'
import { useLiveRailPreference } from '@/components/use-live-rail-preference'
import type { PublicChannel } from '@/lib/types'
import styles from './chat-design-prototype.module.css'

type Message = { id: number; name: string; tag: string; text: string; time: string; role?: 'owner' | 'admin'; removed?: boolean }
type Scenario = 'conversation' | 'empty' | 'reconnecting' | 'failed' | 'timeout' | 'ban' | 'unavailable' | 'limited'
const samples: Message[] = [
  { id: 1, name: 'David', tag: 'a7k2', role: 'owner', text: 'Evening everyone! One more run?', time: '21:04' },
  { id: 2, name: 'mira', tag: 'c3p8', text: 'made it just in time', time: '21:04' },
  { id: 3, name: 'pixelpilot', tag: 'm9v1', text: 'of course. the last one never counts', time: '21:04' },
  { id: 4, name: 'Alex', tag: 'f4q6', text: 'audio sounds good now', time: '21:05' },
  { id: 5, name: 'nori', tag: 'n2b5', text: 'that shortcut on the left 👀', time: '21:05' },
  { id: 6, name: 'Alex', tag: 'u8r3', text: 'different Alex, same opinion', time: '21:05' },
  { id: 7, name: 'mira', tag: 'c3p8', text: 'wait HOW did that hit', time: '21:05' },
  { id: 8, name: 'orbit', tag: 'h6d4', role: 'admin', text: 'Keep it friendly, everyone.', time: '21:06' },
  { id: 9, name: 'pixelpilot', tag: 'm9v1', text: 'I tried this route yesterday. If you wait for the second platform, you can get all the way across without taking damage.', time: '21:06' },
  { id: 10, name: 'someone_with_a_very_long_display_name', tag: 's3e7', text: 'checking in from my phone', time: '21:06' },
  { id: 11, name: 'nori', tag: 'n2b5', text: 'Repeated promotional message.', time: '21:06', removed: true },
  { id: 12, name: 'David', tag: 'a7k2', role: 'owner', text: 'okay, I see it now', time: '21:07' },
  { id: 13, name: 'mira', tag: 'c3p8', text: 'this is the run', time: '21:07' },
  { id: 14, name: 'Alex', tag: 'f4q6', text: 'no pressure 😂', time: '21:07' },
  { id: 15, name: 'pixelpilot', tag: 'm9v1', text: 'NICE', time: '21:07' },
  { id: 16, name: 'nori', tag: 'n2b5', text: 'gg!', time: '21:07' },
  { id: 17, name: 'Alex', tag: 'u8r3', text: 'that was so close', time: '21:08' },
  { id: 18, name: 'mira', tag: 'c3p8', text: 'one more?', time: '21:08' },
]
const colors = ['#a5b4fc', '#f9a8d4', '#67e8f9', '#fde68a', '#86efac', '#fdba74']
function authorColor(tag: string) { return colors[Array.from(tag).reduce((sum, c) => sum + c.charCodeAt(0), 0) % colors.length] }

function MessageRow({ message, moderator, timestamps, onModerate }: {
  message: Message; moderator: boolean; timestamps: boolean; onModerate: (target: ModerationTarget) => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const openingDialog = useRef(false)
  const openAction = (action: ModerationAction) => {
    openingDialog.current = true
    onModerate({ action, message, trigger: triggerRef.current })
  }
  return <div className={styles.message} data-message-id={message.id}>
    {timestamps && <time className={styles.inlineTimestamp} dateTime={message.time}>{message.time}</time>}
    {message.removed ? <span className={styles.removed}>Message removed</span> : <>
      {message.role && <PrototypeRoleBadge role={message.role} />}
      <strong className={styles.author} style={{ color: authorColor(message.tag) }}>{message.name}</strong>
      <span className={styles.tag}> #{message.tag}</span><span className={styles.colon}>: </span>
      <span>{message.text}</span>
    </>}
    {moderator && <DropdownMenu.Root onOpenChange={(open) => { if (open) openingDialog.current = false }}>
      <DropdownMenu.Trigger asChild><button ref={triggerRef} className={styles.messageActions} aria-label={`Actions for message ${message.id}`}><MoreHorizontal size={16} /></button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content className={`${styles.menu} ${styles.actionMenu}`} sideOffset={4} align="end" collisionPadding={10}
        onCloseAutoFocus={(event) => { if (openingDialog.current) event.preventDefault() }}>
        <DropdownMenu.Label>{message.name} <span>#{message.tag}</span></DropdownMenu.Label>
        {message.removed && <DropdownMenu.Item onSelect={() => openAction('inspect')}><Eye size={15} />Inspect removed message</DropdownMenu.Item>}
        {message.role === 'admin' ? <div className={styles.menuHint}>Only administrators can moderate this participant.</div> : <>
          {!message.removed && <DropdownMenu.Item onSelect={() => openAction('remove')}><Trash2 size={15} />Remove message</DropdownMenu.Item>}
          <DropdownMenu.Item onSelect={() => openAction('timeout')}><Timer size={15} />Apply timeout…</DropdownMenu.Item>
          <DropdownMenu.Separator className={styles.menuSeparator} />
          <DropdownMenu.Item className={styles.dangerItem} onSelect={() => openAction('ban')}><Ban size={15} />Ban from Chat…</DropdownMenu.Item>
        </>}
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>}
  </div>
}

type PanelParts = { transcript: ReactNode; composer: ReactNode; notice: ReactNode; onClose: () => void; onHistory: () => void; moderator: boolean; settings: ReactNode; moderationControl: ReactNode }

export function VariantA({ transcript, composer, notice, onClose, settings, moderationControl }: PanelParts) {
  return <aside className={`${styles.chat} ${styles.variantA}`} aria-label="Chat preview">
    <header className={styles.chatHeader}><span className={styles.headerTitle}><MessageSquare size={17} /><strong>Channel chat</strong></span><div className={styles.headerControls}>{moderationControl}{settings}<button onClick={onClose} aria-label="Hide Chat"><X size={17} /></button></div></header>
    {transcript}{notice}{composer}
  </aside>
}

export function VariantB({ transcript, composer, notice, onClose, moderator, settings, moderationControl }: PanelParts) {
  return <aside className={`${styles.chat} ${styles.variantB}`} aria-label="Chat preview">
    <header className={styles.roomSummary}><div><span className={styles.eyebrow}>THE CONVERSATION</span><h2>Channel chat<span className={styles.liveDot} /></h2><span className={styles.roomSubtitle}><Users size={13} /> {moderator ? 'Moderator preview' : 'Make yourself at home'}</span></div><div className={styles.headerControls}>{moderationControl}{settings}<button onClick={onClose} aria-label="Hide Chat"><X size={17} /></button></div></header>
    {transcript}{notice}{composer}
  </aside>
}

export function VariantC({ transcript, composer, notice, onClose, onHistory, settings, moderationControl }: PanelParts) {
  return <aside className={`${styles.chat} ${styles.variantC}`} aria-label="Chat preview">
    <div className={styles.toolsRail}><MessageSquare size={18} /><button onClick={onHistory} aria-label="Load older messages"><History size={18} /></button><span className={styles.railSpacer} />{moderationControl}{settings}<button onClick={onClose} aria-label="Hide Chat"><X size={18} /></button></div>
    <div className={styles.railBody}>{transcript}{notice}<footer className={styles.bottomRoomBar}><span className={styles.liveDot} /><strong>Channel chat</strong><span>Live conversation</span></footer>{composer}</div>
  </aside>
}

export function ChatDesignPrototype({ channel, channels }: { channel: PublicChannel; channels: PublicChannel[] }) {
  const query = useSearchParams()
  const variant = query.get('variant') ?? 'A'
  const { effectivePreference } = useLiveRailPreference()
  const [scenario, setScenario] = useState<Scenario>('conversation')
  const [messages, setMessages] = useState(samples)
  const [draft, setDraft] = useState('')
  const [moderator, setModerator] = useState(false)
  const [timestamps, setTimestamps] = useState(false)
  const [moderationTarget, setModerationTarget] = useState<ModerationTarget | null>(null)
  const [restrictions, setRestrictions] = useState<PrototypeRestriction[]>([
    { name: 'quietfox', tag: 'q2f8', action: 'timeout', category: 'Spam', note: 'Repeated the same message.', duration: 10 },
    { name: 'nightowl', tag: 'n7w3', action: 'ban', category: 'Harassment', note: '', duration: 0 },
  ])
  const [chatOpen, setChatOpen] = useState(true)
  const [theater, setTheater] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [olderLoaded, setOlderLoaded] = useState(false)
  const [moderationNotice, setModerationNotice] = useState('')
  const [retried, setRetried] = useState(false)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLInputElement>(null)
  const restoreRef = useRef<HTMLButtonElement>(null)
  const sequence = useRef(100)
  const blocked = ['timeout', 'ban', 'unavailable', 'limited'].includes(scenario)
  const shownMessages = scenario === 'empty' ? [] : messages

  useEffect(() => {
    if (atBottom) transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [messages, scenario, variant, chatOpen, atBottom, timestamps])

  const loadOlder = () => {
    if (olderLoaded) { transcriptRef.current?.scrollTo({ top: 0 }); return }
    setOlderLoaded(true)
    setAtBottom(false)
    setMessages((current) => [{ id: 0, name: 'mira', tag: 'c3p8', text: 'hey everyone, how is your evening going?', time: '21:03' }, ...current])
    requestAnimationFrame(() => transcriptRef.current?.scrollTo({ top: 0 }))
  }
  const closeChat = () => { setChatOpen(false); requestAnimationFrame(() => restoreRef.current?.focus()) }
  const applyModeration = (details: ModerationDetails) => {
    if (!moderationTarget) return
    const { action, message: target } = moderationTarget
    if (action === 'inspect') return
    setMessages((current) => current.map((message) =>
      (action === 'remove' ? message.id === target.id : message.tag === target.tag)
        ? { ...message, removed: true } : message))
    if (action !== 'remove') {
      setRestrictions((current) => [...current.filter(({ tag }) => tag !== target.tag), {
        name: target.name, tag: target.tag, action, ...details,
      }])
    }
    setModerationNotice(action === 'remove' ? 'Message removed.' : `${target.name} #${target.tag}: Chat ${action} applied.`)
    setModerationTarget(null)
  }

  const transcript = <div className={styles.transcriptWrap}>
    <div className={styles.transcript} ref={transcriptRef} aria-label="Sample Chat messages" onScroll={(event) => {
      const node = event.currentTarget
      setAtBottom(node.scrollHeight - node.clientHeight - node.scrollTop < 24)
    }}>
      {shownMessages.length > 0 ? <>
        <button className={styles.history} onClick={loadOlder}>{olderLoaded ? 'Beginning of sample history' : 'Load older messages'}</button>
        <div className={styles.dayDivider}><span>Today</span></div>
        {shownMessages.map((message, index) => <div key={message.id}>
          {variant === 'B' && shownMessages[index - 1]?.time !== message.time && <div className={styles.timeGroup}><span>{message.time}</span><i /></div>}
          <MessageRow message={message} moderator={moderator} timestamps={timestamps} onModerate={setModerationTarget} />
        </div>)}
        {scenario === 'failed' && <div className={styles.failedMessage}><span>{timestamps && <time className={styles.inlineTimestamp} dateTime="21:09">21:09</time>}<strong>You:</strong> that was a great run</span><small>{retried ? <><Check size={12} /> Sent in preview</> : <>Not sent <button onClick={() => setRetried(true)}>Retry</button></>}</small></div>}
      </> : <div className={styles.empty}><MessageSquare size={28} /><strong>A quiet moment.</strong><p>Be the first to say hello.</p></div>}
    </div>
    {!atBottom && shownMessages.length > 0 && <button className={styles.jump} onClick={() => setAtBottom(true)}><ArrowDown size={14} /> Back to latest messages</button>}
  </div>

  const noticeText = scenario === 'reconnecting' ? 'Reconnecting… Your messages are still here.'
    : scenario === 'timeout' ? 'Chat timeout · 04:32 remaining'
    : scenario === 'ban' ? 'Chat ban · Sending is unavailable until a moderator lifts it.'
    : scenario === 'unavailable' ? 'Chat is unavailable. Please try again later.'
    : scenario === 'limited' ? 'Chat storage limit reached. Sending is paused.'
    : moderationNotice
  const notice = noticeText ? <div className={styles.notice} role="status"><span className={styles.noticeDot} />{noticeText}</div> : null
  const composer = <form className={styles.composer} onSubmit={(event) => {
    event.preventDefault()
    if (blocked || !draft.trim()) return
    const message = { id: sequence.current++, name: 'You', tag: 'y4t9', text: draft.trim(), time: '21:09' }
    setMessages((current) => scenario === 'empty' ? [message] : [...current, message])
    if (scenario === 'empty') setScenario('conversation')
    setDraft('')
    setAtBottom(true)
  }}>
    {variant === 'B' && <label className={styles.composerLabel} htmlFor="prototype-chat-message">Join the conversation</label>}
    <div className={styles.inputRow}><input id="prototype-chat-message" ref={composerRef} aria-label="Chat message" placeholder={blocked ? 'Sending is unavailable' : 'Send a message'} value={draft} disabled={blocked} autoComplete="off" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} />
      {variant !== 'B' && <button className={styles.send} aria-label="Send message" disabled={blocked || !draft.trim()}><Send size={16} /></button>}
    </div>
    {variant === 'B' && <div className={styles.composerFooter}><span>Be kind. Enjoy the channel.</span><button className={styles.send} disabled={blocked || !draft.trim()}>Chat <Send size={14} /></button></div>}
  </form>
  const settings = <PrototypeChatSettings timestamps={timestamps} onTimestampsChange={setTimestamps} />
  const moderationControl = moderator ? <PrototypeRestrictionsDialog restrictions={restrictions} onLift={(tag) => {
    setRestrictions((current) => current.filter((restriction) => restriction.tag !== tag))
    setModerationNotice(`Chat restriction lifted for #${tag}.`)
  }} /> : null
  const parts: PanelParts = { transcript, composer, notice, onClose: closeChat, onHistory: loadOlder, moderator, settings, moderationControl }

  return <Tooltip.Provider delayDuration={300}>
    <main className={`${styles.prototype} ${theater ? styles.theater : ''}`} data-chat-design-prototype>
      <div className={`${styles.stage} ${effectivePreference === 'collapsed' ? styles.collapsedRail : ''} ${!chatOpen ? styles.chatHidden : ''}`}>
        <div className={styles.navigation}><ChannelNavigation channels={channels} watchedSlug={channel.slug} /></div>
        <section className={styles.watchColumn} aria-label="Channel preview">
          <div className={styles.videoPreview}>
            <div className={styles.previewTop}><span className={styles.livePill}>LIVE</span><span>Sample video frame</span></div>
            <div className={styles.scene} aria-hidden="true"><div className={styles.moon} /><div className={styles.mountainBack} /><div className={styles.mountainFront} /><div className={styles.sceneGrid} /></div>
            <div className={styles.videoCaption}><span>THE LAST RUN</span><strong>One more try.</strong></div>
            <div className={styles.videoControls}><span className={styles.liveDot} /><span>Live</span><span className={styles.videoSpacer} /><button onClick={() => setTheater((value) => !value)} aria-label={theater ? 'Exit theater mode' : 'Enter theater mode'}>{theater ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</button></div>
          </div>
          <div className={styles.channelDetails}><div className={styles.ownerAvatar}>{channel.ownerName.slice(0, 1)}</div><div><h1>{channel.title}</h1><p>{channel.ownerName} <span>·</span> {channel.status.viewerCount ?? 0} viewers</p><small>{channel.description}</small></div>
            {!chatOpen && <button className={styles.restore} ref={restoreRef} onClick={() => { setChatOpen(true); requestAnimationFrame(() => composerRef.current?.focus()) }}><MessageSquare size={16} /> Show Chat</button>}
          </div>
          <div className={styles.previewNote}>Chat design preview. Sample messages and actions stay in this tab.</div>
        </section>
        {chatOpen && (variant === 'B' ? <VariantB {...parts} /> : variant === 'C' ? <VariantC {...parts} /> : <VariantA {...parts} />)}
      </div>
      {moderationTarget && <PrototypeModerationDialog key={`${moderationTarget.message.id}-${moderationTarget.action}`} target={moderationTarget} onClose={() => setModerationTarget(null)} onConfirm={applyModeration} />}
      <PrototypeSwitcher>
        <label>State <select aria-label="Preview state" value={scenario} onChange={(event) => { setScenario(event.target.value as Scenario); setRetried(false); setModerationNotice(''); setAtBottom(true) }}>
          <option value="conversation">Conversation</option><option value="empty">Empty room</option><option value="reconnecting">Reconnecting</option><option value="failed">Failed send</option><option value="timeout">Chat timeout</option><option value="ban">Chat ban</option><option value="unavailable">Unavailable</option><option value="limited">Storage limit</option>
        </select><ChevronDown size={12} /></label>
        <label><input type="checkbox" checked={moderator} onChange={(event) => setModerator(event.target.checked)} /> Moderator</label>
        <button onClick={() => { setMessages((current) => [...current, { id: sequence.current++, name: 'mira', tag: 'c3p8', text: 'okay, one more!', time: '21:09' }]); if (scenario === 'empty') setScenario('conversation') }}>+ Message</button>
        <output>{timestamps ? 'Times on' : 'Times off'} · {moderator ? `${restrictions.length} restrictions` : `${shownMessages.length} messages`} · {chatOpen ? 'open' : 'hidden'}</output>
      </PrototypeSwitcher>
    </main>
  </Tooltip.Provider>
}
