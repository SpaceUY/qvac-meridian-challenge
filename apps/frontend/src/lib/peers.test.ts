import { describe, expect, it } from 'vitest'
import { countAvailablePeers, classifyDelegationTransition, describePeers, describeProviderHealth } from '@/lib/peers'

describe('countAvailablePeers', () => {
  it('is 1 when delegated', () => {
    expect(countAvailablePeers({ isDelegated: true, providerPublicKey: 'pk-abc' })).toBe(1)
  })

  it('is 0 when not delegated or unknown', () => {
    expect(countAvailablePeers({ isDelegated: false })).toBe(0)
    expect(countAvailablePeers(undefined)).toBe(0)
  })
})

describe('classifyDelegationTransition', () => {
  it('is null when there is no previous snapshot to compare against', () => {
    expect(classifyDelegationTransition(undefined, { isDelegated: true, recovering: false })).toBeNull()
  })

  it('is null when nothing changed', () => {
    const snapshot = { isDelegated: true, recovering: false }
    expect(classifyDelegationTransition(snapshot, snapshot)).toBeNull()
  })

  it('reports "connected" when delegation turns on', () => {
    const previous = { isDelegated: false, recovering: false }
    const current = { isDelegated: true, recovering: false }
    expect(classifyDelegationTransition(previous, current)).toBe('connected')
  })

  it('reports "recovering-started" when recovery kicks in', () => {
    const previous = { isDelegated: true, recovering: false }
    const current = { isDelegated: true, recovering: true }
    expect(classifyDelegationTransition(previous, current)).toBe('recovering-started')
  })

  it('reports "reconnected" when recovery ends back on the peer', () => {
    const previous = { isDelegated: true, recovering: true }
    const current = { isDelegated: true, recovering: false }
    expect(classifyDelegationTransition(previous, current)).toBe('reconnected')
  })

  it('reports "fell-back-to-local" when recovery ends running locally', () => {
    const previous = { isDelegated: true, recovering: true }
    const current = { isDelegated: false, recovering: false }
    expect(classifyDelegationTransition(previous, current)).toBe('fell-back-to-local')
  })
})

describe('describePeers', () => {
  it('explains that everything runs locally when there are no peers', () => {
    expect(describePeers(undefined)).toEqual({ count: 0, title: 'No peers connected', detail: 'Running on this device only' })
    expect(describePeers({ isDelegated: false })).toEqual({ count: 0, title: 'No peers connected', detail: 'Running on this device only' })
  })

  it('says inference is delegated when a peer is connected', () => {
    expect(describePeers({ isDelegated: true, providerPublicKey: 'pk' })).toEqual({ count: 1, title: '1 peer connected', detail: 'Inference is delegated over P2P' })
  })
})

// Same copy PR #48 wrote inline in engine-panel.tsx - moved here unchanged so it can be tested.
describe('describeProviderHealth', () => {
  it('shows the latency when the provider is up', () => {
    const view = describeProviderHealth({ state: 'up', consecutiveFailures: 0, lastLatencyMs: 42 })
    expect(view).toEqual({ up: true, label: 'Healthy — 42ms', tooltip: 'Last heartbeat 42ms' })
  })

  it('falls back to "succeeded" when there is no latency, and adds the time when known', () => {
    expect(describeProviderHealth({ state: 'up', consecutiveFailures: 0 }).tooltip).toBe('Last heartbeat succeeded')
    const withTime = describeProviderHealth({ state: 'up', consecutiveFailures: 0, lastSuccessAt: '2026-09-30T15:00:00Z' })
    // The exact clock text depends on the machine's locale - only the shape is checked.
    expect(withTime.tooltip).toMatch(/^Last heartbeat succeeded at .+/)
  })

  it('counts consecutive failures when the provider is down, singular and plural', () => {
    expect(describeProviderHealth({ state: 'down', consecutiveFailures: 1 })).toEqual({ up: false, label: 'Down', tooltip: '1 consecutive failed heartbeat' })
    expect(describeProviderHealth({ state: 'down', consecutiveFailures: 3 }).tooltip).toBe('3 consecutive failed heartbeats')
  })
})
