import type { PeriodAggregates } from '../types.js'

export async function writeNotionReport(
  _agg: PeriodAggregates,
  _narrative: string,
  _type: 'biweekly' | 'monthly' | 'yearly'
): Promise<string> {
  return ''
}

export async function updateNotionDashboards(_agg: PeriodAggregates): Promise<void> {}

export async function writeNotionHomepage(): Promise<void> {}
