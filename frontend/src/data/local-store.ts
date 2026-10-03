import { SEED_DC_REVIEWS, SEED_RESISTANCE_RULE, SEED_ROWS } from './seed'
import type { DcReviewItem, ResistanceRule } from './dc-domain'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'substation-protection:entries'
const RESISTANCE_RULE_KEY = 'substation-protection:dc-resistance-rule'
const DC_REVIEW_KEY = 'substation-protection:dc-reviews'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

// 内阻尺子与待复查清单各占一个独立存储位，不挤在业务条目桶里。
let resistanceRuleCache: ResistanceRule | null = null
let reviewCache: DcReviewItem[] | null = null

export function getResistanceRule(): ResistanceRule {
  if (resistanceRuleCache === null) {
    resistanceRuleCache = readJson<ResistanceRule>(RESISTANCE_RULE_KEY, SEED_RESISTANCE_RULE)
  }
  return resistanceRuleCache
}

export function saveResistanceRule(rule: ResistanceRule): void {
  resistanceRuleCache = rule
  writeJson(RESISTANCE_RULE_KEY, rule)
}

export function listDcReviews(): DcReviewItem[] {
  if (reviewCache === null) {
    reviewCache = readJson<DcReviewItem[]>(DC_REVIEW_KEY, SEED_DC_REVIEWS)
  }
  return reviewCache
}

export function saveDcReviews(items: DcReviewItem[]): void {
  reviewCache = items
  writeJson(DC_REVIEW_KEY, items)
}

export function resetDcReviews(): DcReviewItem[] {
  const seeded = clone(SEED_DC_REVIEWS)
  saveDcReviews(seeded)
  return seeded
}
