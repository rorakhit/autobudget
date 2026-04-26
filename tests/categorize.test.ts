import { describe, it, expect } from 'vitest'
import { buildCategorizationPrompt, parseCategorizationResponse } from '../src/categorize/categorize.js'

describe('buildCategorizationPrompt', () => {
  it('includes merchant name and amount', () => {
    const prompt = buildCategorizationPrompt({
      merchantName: 'Uber Eats',
      amount: 34.50,
      date: '2026-04-15',
      history: [],
    })
    expect(prompt).toContain('Uber Eats')
    expect(prompt).toContain('34.50')
  })

  it('includes merchant history when present', () => {
    const prompt = buildCategorizationPrompt({
      merchantName: 'Starbucks',
      amount: 6.75,
      date: '2026-04-15',
      history: [{ category: 'Dining', amount: 5.50, date: '2026-03-10' }],
    })
    expect(prompt).toContain('Dining')
  })
})

describe('parseCategorizationResponse', () => {
  it('parses valid JSON response', () => {
    const raw = JSON.stringify({
      category: 'Food Delivery',
      confidence: 92,
      is_recurring: false,
      reasoning: 'Uber Eats is a food delivery service',
    })
    const result = parseCategorizationResponse(raw)
    expect(result.category).toBe('Food Delivery')
    expect(result.confidence).toBe(92)
    expect(result.is_recurring).toBe(false)
  })

  it('defaults to Other with 0 confidence on invalid JSON', () => {
    const result = parseCategorizationResponse('not json')
    expect(result.category).toBe('Other')
    expect(result.confidence).toBe(0)
  })

  it('clamps confidence to 0–100', () => {
    const raw = JSON.stringify({ category: 'Groceries', confidence: 150, is_recurring: false, reasoning: '' })
    const result = parseCategorizationResponse(raw)
    expect(result.confidence).toBeLessThanOrEqual(100)
  })

  it('falls back to Other for unknown category', () => {
    const raw = JSON.stringify({ category: 'Unknown Category XYZ', confidence: 80, is_recurring: false, reasoning: '' })
    const result = parseCategorizationResponse(raw)
    expect(result.category).toBe('Other')
  })
})
