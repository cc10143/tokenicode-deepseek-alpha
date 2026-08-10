import { create } from 'zustand';

// --- Types ---

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed'
  | 'paused'
  | 'stopped';

export interface TaskUsage {
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
}

/** A live task tracked from CLI `task_*` system messages.
 *  Covers Task-tool subagents (local_agent) and background bash (local_bash). */
export interface TaskState {
  id: string;
  toolUseId?: string;
  description: string;
  /** subagent_type from CLI, e.g. "Explore" / "General" */
  subagentType?: string;
  /** task_type: local_agent | local_bash | workflow */
  taskType?: string;
  workflowName?: string;
  prompt?: string;
  status: TaskStatus;
  isBackgrounded?: boolean;
  usage?: TaskUsage;
  lastToolName?: string;
  summary?: string;
  outputFile?: string;
  error?: string;
  startTime: number;
  endTime?: number;
}

interface TaskStoreState {
  tasks: Map<string, TaskState>;
  /** Per-session task cache for tab switching */
  taskCache: Map<string, Map<string, TaskState>>;

  upsert: (task: Partial<TaskState> & { id: string }) => void;
  complete: (id: string, status: TaskStatus, extra?: Partial<TaskState>) => void;
  /** Collect ids of all running/pending tasks (for Ctrl+X Ctrl+K stop-all). */
  getRunningIds: () => string[];
  clearCompleted: () => void;
  clearAll: () => void;
  saveToCache: (tabId: string) => void;
  restoreFromCache: (tabId: string) => boolean;
}

// --- Store ---

export const useTaskStore = create<TaskStoreState>()((set, get) => ({
  tasks: new Map(),
  taskCache: new Map(),

  upsert: (task) => {
    const next = new Map(get().tasks);
    const existing = next.get(task.id);
    // First time we see a task_id — record startTime. task_started carries it.
    const startTime = existing?.startTime ?? Date.now();
    next.set(task.id, { ...existing, ...task, startTime } as TaskState);
    set({ tasks: next });
  },

  complete: (id, status, extra) => {
    const next = new Map(get().tasks);
    const existing = next.get(id);
    if (!existing) return; // notification for unknown task — ignore
    next.set(id, {
      ...existing,
      ...extra,
      status,
      endTime: Date.now(),
    });
    set({ tasks: next });
  },

  getRunningIds: () => {
    const running: string[] = [];
    for (const [id, task] of get().tasks) {
      if (task.status === 'running' || task.status === 'pending') running.push(id);
    }
    return running;
  },

  clearCompleted: () => {
    const next = new Map(get().tasks);
    for (const [id, task] of next) {
      const done = task.status === 'completed' || task.status === 'failed'
        || task.status === 'stopped' || task.status === 'killed';
      if (done) next.delete(id);
    }
    set({ tasks: next });
  },

  clearAll: () => set({ tasks: new Map() }),

  saveToCache: (tabId) => {
    const next = new Map(get().taskCache);
    next.set(tabId, new Map(get().tasks));
    set({ taskCache: next });
  },

  restoreFromCache: (tabId) => {
    const cached = get().taskCache.get(tabId);
    if (!cached) {
      set({ tasks: new Map() });
      return false;
    }
    set({ tasks: new Map(cached) });
    return true;
  },
}));

// --- Helpers ---

export function isTaskRunning(task: TaskState): boolean {
  return task.status === 'running' || task.status === 'pending';
}

export function isTaskDone(task: TaskState): boolean {
  return task.status === 'completed' || task.status === 'failed'
    || task.status === 'stopped' || task.status === 'killed';
}
