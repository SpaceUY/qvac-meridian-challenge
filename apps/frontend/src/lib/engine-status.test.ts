import { describe, expect, it } from 'vitest'
import { describeEngineStatus, formatProviderKey } from '@/lib/engine-status'

const base = { status: 'ready' as const, cancelled: false, serverUnreachable: false, recovering: false }

describe('describeEngineStatus', () => {
  it('says the server is unreachable, even though the status also reads error', () => {
    const view = describeEngineStatus({ ...base, status: 'error', serverUnreachable: true, statusError: 'could not reach the server' })
    expect(view).toEqual({ tone: 'error', label: 'Server unreachable', detail: 'Reconnecting automatically…' })
  })

  it('shows the server-side reason when the model failed to load', () => {
    const view = describeEngineStatus({ ...base, status: 'error', statusError: 'out of memory' })
    expect(view).toEqual({ tone: 'error', label: 'Load failed', detail: 'out of memory' })
  })

  it('offers Cancel while loading', () => {
    expect(describeEngineStatus({ ...base, status: 'loading' })).toEqual({ tone: 'working', label: 'Loading model…', action: 'cancel' })
  })

  it('tells the startup idle apart from a user-cancelled idle', () => {
    expect(describeEngineStatus({ ...base, status: 'idle' })).toEqual({ tone: 'working', label: 'Starting…' })
    expect(describeEngineStatus({ ...base, status: 'idle', cancelled: true })).toEqual({ tone: 'idle', label: 'Load cancelled', action: 'load' })
  })

  it('says "Reconnecting…" during a delegation recovery, over loading and ready - but not over a cancelled load', () => {
    expect(describeEngineStatus({ ...base, recovering: true })).toEqual({ tone: 'working', label: 'Reconnecting…' })
    expect(describeEngineStatus({ ...base, status: 'loading', recovering: true })).toEqual({ tone: 'working', label: 'Reconnecting…', action: 'cancel' })
    expect(describeEngineStatus({ ...base, status: 'idle', cancelled: true, recovering: true })).toEqual({ tone: 'idle', label: 'Load cancelled', action: 'load' })
  })

  it('reads "Running locally" when ready and not delegated (or delegation unknown)', () => {
    const expected = { tone: 'ready', label: 'Running locally', location: 'on-device' }
    expect(describeEngineStatus(base)).toEqual(expected)
    expect(describeEngineStatus({ ...base, delegation: { isDelegated: false } })).toEqual(expected)
  })

  it('names the provider when ready on a remote peer', () => {
    const view = describeEngineStatus({ ...base, delegation: { isDelegated: true, providerPublicKey: 'abcdef0123456789ffff' } })
    expect(view).toEqual({ tone: 'ready', label: 'Running on remote peer', location: 'remote peer', detail: 'Provider: abcdef0123456789…' })
  })
})

describe('formatProviderKey', () => {
  it('keeps the first 16 characters, like the backend logs', () => {
    expect(formatProviderKey('abcdef0123456789ffff')).toBe('abcdef0123456789…')
  })
})
