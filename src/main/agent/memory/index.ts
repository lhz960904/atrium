export { runDream } from './dream';
export { acquireLock, releaseLock } from './lock';
export {
  encodeWorkspace,
  listMemoryDirs,
  MEMORY_INDEX,
  MEMORY_INDEX_BUDGET,
  MEMORY_SCOPES,
  type MemoryScope,
  memoryDir,
} from './paths';
export { type DreamScheduler, dreamSweep, startDreamScheduler } from './scheduler';
export {
  type MemoryState,
  markConsolidated,
  readState,
  recordSessionTouch,
  shouldConsolidate,
} from './state';
export {
  deleteMemory,
  fileName,
  MEMORY_TYPES,
  type MemoryInput,
  type MemoryType,
  parseTopic,
  readIndexClipped,
  regenerateIndex,
  renderTopic,
  writeMemory,
} from './store';
