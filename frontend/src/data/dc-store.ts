import { buildDcSeedGroups } from './dc-seed'
import { DEFAULT_RESISTANCE_LIMIT } from './dc-types'
import type { DcGroup, ResistanceRuler } from './dc-types'

/**
 * 直流监测独立持久化：按蓄电池组分档存放，与通用台账的 localStorage 键分开。
 * 内阻尺（直流专责设定）也放在这里。
 */

const GROUPS_KEY = 'substation-protection:dc-groups'
const RULER_KEY = 'substation-protection:dc-resistance-ruler'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedGroups(): DcGroup[] {
  return clone(buildDcSeedGroups())
}

let groupCache: DcGroup[] | null = null

export function listDcGroups(): DcGroup[] {
  if (groupCache !== null) {
    return groupCache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    groupCache = seedGroups()
    return groupCache
  }
  const raw = window.localStorage.getItem(GROUPS_KEY)
  if (!raw) {
    groupCache = seedGroups()
    saveDcGroups(groupCache)
    return groupCache
  }
  try {
    groupCache = JSON.parse(raw) as DcGroup[]
  } catch {
    groupCache = seedGroups()
    saveDcGroups(groupCache)
  }
  return groupCache as DcGroup[]
}

export function saveDcGroups(groups: DcGroup[]): void {
  groupCache = groups
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(GROUPS_KEY, JSON.stringify(groups))
  }
}

export function resetDcGroups(): DcGroup[] {
  const fresh = seedGroups()
  saveDcGroups(fresh)
  return fresh
}

function defaultRuler(): ResistanceRuler {
  return { limit: DEFAULT_RESISTANCE_LIMIT, owner: '', updatedAt: '' }
}

export function loadResistanceRuler(): ResistanceRuler {
  if (typeof window === 'undefined' || !window.localStorage) {
    return defaultRuler()
  }
  const raw = window.localStorage.getItem(RULER_KEY)
  if (!raw) {
    return defaultRuler()
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ResistanceRuler>
    return {
      limit: typeof parsed.limit === 'number' && parsed.limit > 0 ? parsed.limit : DEFAULT_RESISTANCE_LIMIT,
      owner: typeof parsed.owner === 'string' ? parsed.owner : '',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    }
  } catch {
    return defaultRuler()
  }
}

export function saveResistanceRuler(ruler: ResistanceRuler): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(RULER_KEY, JSON.stringify(ruler))
  }
}
