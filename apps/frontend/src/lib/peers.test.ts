import { describe, expect, it } from 'vitest'
import { countAvailablePeers, classifyDelegationTransition } from '@/lib/peers'

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
