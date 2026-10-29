import {
  applyAction,
  emptyWorkspace,
  GenerationError,
  MAX_WORKSPACE_BYTES,
  parseWorkspace,
  SCHEMA_VERSION,
  type Action
} from './domain'
import type { Workspace } from './types'

export type CloudState = {
  workspace: Workspace
  generation: string
  revision: number
  appliedIds: string[]
}
export function parseCloud(data: Record<string, unknown>): CloudState {
  const allowed = [
    'models',
    'purchases',
    'sales',
    'writeOffs',
    'settings',
    'schemaVersion',
    'generation',
    'revision',
    'appliedIds',
    'updatedAt'
  ]
  if (
    Object.keys(data).some((key) => !allowed.includes(key)) ||
    !Array.isArray(data.writeOffs) ||
    !data.settings ||
    typeof data.settings !== 'object' ||
    Array.isArray(data.settings) ||
    data.schemaVersion !== SCHEMA_VERSION ||
    typeof data.generation !== 'string' ||
    !data.generation ||
    data.generation.length > 100 ||
    !Number.isSafeInteger(data.revision) ||
    Number(data.revision) < 1 ||
    !Array.isArray(data.appliedIds) ||
    data.appliedIds.length > 500 ||
    data.appliedIds.some(
      (value) => typeof value !== 'string' || value.length > 100
    )
  )
    throw new Error('Облако использует неизвестный формат. Обновите страницу.')
  return {
    workspace: parseWorkspace(data),
    generation: data.generation,
    revision: Number(data.revision),
    appliedIds: data.appliedIds as string[]
  }
}
export const toCloud = (state: CloudState) => {
  const data = {
    ...state.workspace,
    schemaVersion: SCHEMA_VERSION,
    generation: state.generation,
    revision: state.revision,
    appliedIds: state.appliedIds
  }
  // Include metadata and a conservative allowance for Firestore field overhead.
  if (
    new TextEncoder().encode(JSON.stringify(data)).length + 4096 >
    MAX_WORKSPACE_BYTES
  )
    throw new Error(
      'Учёт приблизился к лимиту облачного документа. Скачайте архив перед очисткой старых операций.'
    )
  return data
}
export const newCloud = (generation: string): CloudState => ({
  workspace: emptyWorkspace(),
  generation,
  revision: 1,
  appliedIds: []
})
export function mergeActions(
  remote: CloudState,
  generation: string,
  actions: Action[]
): CloudState {
  if (remote.generation !== generation) throw new GenerationError()
  let workspace = remote.workspace
  const appliedIds = [...remote.appliedIds]
  for (const action of actions) {
    if (appliedIds.includes(action.id)) continue
    workspace = applyAction(workspace, action)
    appliedIds.push(action.id)
  }
  return appliedIds.length === remote.appliedIds.length
    ? remote
    : {
        workspace,
        generation,
        revision: remote.revision + 1,
        appliedIds: appliedIds.slice(-500)
      }
}
export type CloudAdapter = {
  subscribe: (
    uid: string,
    data: (state: CloudState, cached: boolean) => void,
    error: (error: Error) => void
  ) => Promise<() => void>
  commit: (
    uid: string,
    generation: string,
    actions: Action[]
  ) => Promise<CloudState>
  replace: (
    uid: string,
    generation: string,
    workspace: Workspace
  ) => Promise<CloudState>
}
