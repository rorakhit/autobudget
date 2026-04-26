import { describe, it, expect } from 'vitest'
import { calculateSavingsRate, calculateMonthlyInterest, estimatePayoffMonths, getCreditUtilizationLevel } from '../src/reports/aggregate.js'

describe('calculateSavingsRate', () => {
  it('returns 0 when income is 0', () => {
    expect(calculateSavingsRate(0, 100)).toBe(0)
  })
  it('returns correct percentage', () => {
    expect(calculateSavingsRate(5200, 4000)).toBeCloseTo(23.08, 1)
  })
  it('returns 0 when spend exceeds income', () => {
    expect(calculateSavingsRate(1000, 1200)).toBe(0)
  })
})

describe('calculateMonthlyInterest', () => {
  it('computes monthly interest from APR and balance', () => {
    expect(calculateMonthlyInterest(1000, 24)).toBeCloseTo(20, 0)
  })
  it('returns 0 for zero balance', () => {
    expect(calculateMonthlyInterest(0, 24)).toBe(0)
  })
})

describe('estimatePayoffMonths', () => {
  it('returns 0 for zero balance', () => {
    expect(estimatePayoffMonths(0, 24)).toBe(0)
  })
  it('returns finite months for normal balance', () => {
    const months = estimatePayoffMonths(1000, 24)
    expect(months).toBeGreaterThan(0)
    expect(months).toBeLessThan(120)
  })
})

describe('getCreditUtilizationLevel', () => {
  it('returns ok under 30', () => expect(getCreditUtilizationLevel(25)).toBe('ok'))
  it('returns warning 30–50', () => expect(getCreditUtilizationLevel(40)).toBe('warning'))
  it('returns danger over 50', () => expect(getCreditUtilizationLevel(55)).toBe('danger'))
})
