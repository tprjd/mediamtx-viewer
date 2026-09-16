'use client'

// THROWAWAY controls for the selected Chat design. All actions use local sample state.
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Ban, Crown, Settings2, ShieldCheck, Timer, X } from 'lucide-react'
import { useRef, useState } from 'react'

import styles from './chat-design-prototype.module.css'

export type ModerationAction = 'remove' | 'timeout' | 'ban' | 'inspect'
export type ModerationDetails = { category: string; note: string; duration: number }
export type PrototypeRestriction = {
  name: string; tag: string; action: 'timeout' | 'ban'; category: string; note: string; duration: number
}
export type ModerationTarget = {
  action: ModerationAction
  message: { id: number; name: string; tag: string; text: string }
  trigger: HTMLButtonElement | null
}

export function PrototypeChatSettings({ timestamps, onTimestampsChange }: {
  timestamps: boolean; onTimestampsChange: (checked: boolean) => void
}) {
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button type="button" aria-label="Chat settings"><Settings2 size={17} /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className={`${styles.menu} ${styles.settingsMenu}`} sideOffset={8} align="end" collisionPadding={12}>
      <DropdownMenu.Label>Chat settings</DropdownMenu.Label>
      <DropdownMenu.CheckboxItem checked={timestamps} onCheckedChange={onTimestampsChange} onSelect={(event) => event.preventDefault()}>
        <span><strong>Show timestamps</strong><small>Show the time before each message</small></span>
        <span className={styles.checkBox} aria-hidden="true"><span /></span>
      </DropdownMenu.CheckboxItem>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>
}

export function PrototypeRoleBadge({ role }: { role: 'owner' | 'admin' }) {
  const [open, setOpen] = useState(false)
  const touchPointer = useRef(false)
  const openAtPointerDown = useRef(false)
  const label = role === 'owner' ? 'Channel owner' : 'Administrator'
  return <Tooltip.Root open={open} onOpenChange={setOpen}>
    <Tooltip.Trigger asChild>
      <button type="button" className={`${styles.badge} ${styles[role]}`} aria-label={label}
        onPointerDown={(event) => { touchPointer.current = event.pointerType === 'touch'; openAtPointerDown.current = open }}
        onClick={(event) => { if (touchPointer.current) { event.preventDefault(); setOpen(!openAtPointerDown.current) } }}>
        {role === 'owner' ? <Crown size={12} /> : <ShieldCheck size={12} />}
      </button>
    </Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className={`${styles.timestamp} ${styles.badgeTooltip}`} side="top" sideOffset={6} collisionPadding={10}>
      <strong>{label}</strong><span>{role === 'owner' ? 'Manages this channel and moderates its Chat.' : 'Moderates Chat across all channels.'}</span><Tooltip.Arrow />
    </Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root>
}

export function PrototypeModerationDialog({ target, onClose, onConfirm }: {
  target: ModerationTarget; onClose: () => void; onConfirm: (details: ModerationDetails) => void
}) {
  const [category, setCategory] = useState('Spam')
  const [note, setNote] = useState('')
  const [duration, setDuration] = useState(10)
  const title = target.action === 'remove' ? 'Remove message' : target.action === 'timeout' ? 'Apply Chat timeout' : target.action === 'ban' ? 'Apply Chat ban' : 'Removed message'
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
    <Dialog.Portal><Dialog.Overlay className={styles.dialogOverlay} /><Dialog.Content className={styles.moderationDialog} data-action={target.action}
      onCloseAutoFocus={(event) => { event.preventDefault(); target.trigger?.focus() }}>
      <div className={styles.dialogHeading}><span className={styles.dialogContext}><ShieldCheck size={14} />Moderation</span><Dialog.Close asChild><button aria-label="Close moderation dialog"><X size={18} /></button></Dialog.Close></div>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{target.action === 'inspect' ? 'Only Chat moderators can inspect removed content.' : target.action === 'remove' ? 'Replace this message with “Message removed” in the Chat room.' : 'Stop this participant from sending and remove their messages from the last ten minutes. They can still read Chat and watch the channel.'}</Dialog.Description>
      <div className={styles.targetMessage}><strong>{target.message.name} <span>#{target.message.tag}</span></strong><p>{target.message.text}</p></div>
      {target.action === 'inspect' ? <p className={styles.dialogHint}>Retained sample content. No action will be applied.</p> : <form onSubmit={(event) => { event.preventDefault(); onConfirm({ category, note, duration }) }}>
        <div className={styles.fieldRow}>
        {target.action === 'timeout' && <label>Duration<select aria-label="Duration" value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value={10}>10 minutes</option><option value={60}>1 hour</option><option value={1440}>24 hours</option></select></label>}
        <label>Category<select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)}><option>Spam</option><option>Harassment</option><option>Other</option></select></label>
        </div>
        <label><span className={styles.fieldLabel}>Private note <small>{category === 'Other' ? 'Required for Other' : 'Optional'}</small></span><textarea aria-label="Private note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} required={category === 'Other'} placeholder="Context for other moderators" /></label>
        <div className={styles.dialogButtons}><Dialog.Close asChild><button type="button">Cancel</button></Dialog.Close><button className={styles.confirmAction} disabled={category === 'Other' && !note.trim()}>{target.action === 'remove' ? 'Confirm removal' : target.action === 'timeout' ? 'Confirm timeout' : 'Confirm ban'}</button></div>
      </form>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
}

export function PrototypeRestrictionsDialog({ restrictions, onLift }: {
  restrictions: PrototypeRestriction[]; onLift: (tag: string) => void
}) {
  const [announcement, setAnnouncement] = useState('')
  return <Dialog.Root>
    <Dialog.Trigger asChild><button type="button" aria-label={`Active Chat restrictions (${restrictions.length})`}><ShieldCheck size={17} /><span className={styles.restrictionCount}>{restrictions.length}</span></button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className={styles.dialogOverlay} /><Dialog.Content className={styles.moderationDialog}>
      <div className={styles.dialogHeading}><span className={styles.dialogContext}><ShieldCheck size={14} />Moderation</span><Dialog.Close asChild><button aria-label="Close restrictions"><X size={18} /></button></Dialog.Close></div>
      <Dialog.Title>Active Chat restrictions</Dialog.Title><Dialog.Description>Manage who can send messages in this Chat room. Lifting a restriction keeps removed messages hidden.</Dialog.Description>
      <div className={styles.restrictionList}>
        {restrictions.length === 0 && <p className={styles.noRestrictions}><ShieldCheck size={24} />No active restrictions.</p>}
        {restrictions.map((restriction) => <div className={styles.restrictionItem} key={restriction.tag} data-action={restriction.action}>
          <div className={styles.restrictionBody}><div className={styles.restrictionIdentity}>{restriction.action === 'ban' ? <Ban size={17} /> : <Timer size={17} />}<strong>{restriction.name} <span>#{restriction.tag}</span></strong></div>
          <p>{restriction.action === 'ban' ? 'Chat ban · Indefinite' : `Chat timeout · ${restriction.duration === 1440 ? '24 hours' : restriction.duration === 60 ? '1 hour' : `${restriction.duration} minutes`}`}<span>{restriction.category}</span></p>
          {restriction.note && <small>{restriction.note}</small>}</div>
          <button onClick={() => { onLift(restriction.tag); setAnnouncement(`Restriction lifted for ${restriction.name} #${restriction.tag}.`) }}>Lift {restriction.action === 'ban' ? 'ban' : 'timeout'}</button>
        </div>)}
      </div>
      <p role="status" className={styles.dialogHint}>{announcement || 'Sample restrictions. Changes apply only to this preview.'}</p>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
}
