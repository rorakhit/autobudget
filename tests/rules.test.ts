import { describe, it, expect } from 'vitest'
import { isLargePurchase, isDuplicateCharge, isDailySpendExceeded, getCreditUtilization } from '../src/alerts/rules.js'

describe('isLargePurchase', () => {
  it('returns true for amount > 200', () => {
    expect(isLargePurchase(250)).toBe(true)
  })
  it('returns false for amount <= 200', () => {
    expect(isLargePurchase(200)).toBe(false)
    expect(isLargePurchase(150)).toBe(false)
  })
})

describe('isDuplicateCharge', () => {
  const recent = [
    { merchant_name: 'Netflix', amount: 15.99, date: '2026-04-15', created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
  ]
  it('returns true when same merchant+amount within 24h', () => {
    expect(isDuplicateCharge('Netflix', 15.99, recent as any)).toBe(true)
  })
  it('returns false when amount differs', () => {
    expect(isDuplicateCharge('Netflix', 16.00, recent as any)).toBe(false)
  })
  it('returns false when merchant differs', () => {
    expect(isDuplicateCharge('Hulu', 15.99, recent as any)).toBe(false)
  })
})

describe('isDailySpendExceeded', () => {
  it('returns true when total > 300', () => {
    expect(isDailySpendExceeded(350)).toBe(true)
  })
  it('returns false when total <= 300', () => {
    expect(isDailySpendExceeded(300)).toBe(false)
  })
})

describe('getCreditUtilization', () => {
  it('calculates utilization percentage', () => {
    expect(getCreditUtilization(500, 1000)).toBe(50)
  })
  it('returns 0 for zero limit', () => {
    expect(getCreditUtilization(500, 0)).toBe(0)
  })
})
