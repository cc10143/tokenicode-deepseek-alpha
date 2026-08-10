import { useMemo, useState, useEffect } from 'react';
import { useTaskStore, isTaskRunning, isTaskDone, type TaskState } from '../../stores/taskStore';
import { useActiveTab } from '../../stores/chatStore';
import { bridge } from '../../lib/tauri-bridge';
import { useT } from '../../lib/i18n';

// --- Elapsed time display ---

function ElapsedTime({ startTime, endTime }: { startTime: number; endTime?: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (endTime) return; // no need to tick if already finished
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [endTime]);

  const elapsed = Math.floor(((endTime || now) - startTime) / 1000);
  if (elapsed < 60) return <span>{elapsed}s</span>;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return <span>{mins}m {secs}s</span>;
}

// --- Status dot ---

function StatusDot({ task }: { task: TaskState }) {
  const running = isTaskRunning(task);
  const color = task.status === 'failed' ? 'bg-red-500'
    : task.status === 'stopped' || task.status === 'killed' ? 'bg-text-tertiary'
    : task.status === 'completed' ? 'bg-green-500'
    : running ? 'bg-amber-400'
    : 'bg-text-tertiary';
  return (
    <span className="relative flex-shrink-0 w-2 h-2">
      {running && (
        <span className="absolute inset-0 rounded-full animate-ping bg-amber-400/40" />
      )}
      <span className={`relative block w-2 h-2 rounded-full ${color}`} />
    </span>
  );
}

// --- Task row ---

function TaskRow({ task, stdinId }: { task: TaskState; stdinId?: string }) {
  const t = useT();
  const running = isTaskRunning(task);
  const isBg = task.isBackgrounded || task.taskType === 'local_bash';
  const label = task.description || task.id;

  return (
    <div className="group flex items-center gap-2 py-1.5 px-2 rounded-lg
      hover:bg-bg-secondary/50 min-w-0">
      <StatusDot task={task} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-xs font-medium truncate
            ${running ? 'text-text-primary' : 'text-text-muted'}`}>
            {label}
          </span>
          {isBg && (
            <span className="text-[8px] px-1 py-px rounded bg-bg-tertiary
              text-text-tertiary flex-shrink-0">
              {t('tasks.backgroundTask')}
            </span>
          )}
          {task.subagentType && !isBg && (
            <span className="text-[8px] px-1 py-px rounded bg-accent/10
              text-accent flex-shrink-0">
              {task.subagentType}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-text-tertiary truncate">
          {running && task.lastToolName ? (
            <span className="font-mono">{task.lastToolName}</span>
          ) : (
            <span>{task.status}</span>
          )}
          {task.summary && <span className="truncate">· {task.summary}</span>}
        </div>
      </div>
      <span className="text-[10px] text-text-tertiary font-mono flex-shrink-0 tabular-nums">
        <ElapsedTime startTime={task.startTime} endTime={task.endTime} />
      </span>
      {running && stdinId && (
        <button
          onClick={() => { bridge.stopTask(stdinId, task.id).catch(() => {}); }}
          className="text-[9px] px-1.5 py-0.5 rounded bg-bg-tertiary
            text-text-muted hover:text-error hover:bg-error/10 flex-shrink-0
            opacity-0 group-hover:opacity-100 transition-smooth"
          title={t('tasks.stop')}>
          {t('tasks.stop')}
        </button>
      )}
    </div>
  );
}

// --- Main panel ---

export function TaskPanel() {
  const t = useT();
  const tasks = useTaskStore((s) => s.tasks);
  const sessionMeta = useActiveTab((t) => t.sessionMeta);
  const stdinId = sessionMeta.stdinId;

  const { running, background, done, activeCount } = useMemo(() => {
    const list = Array.from(tasks.values());
    const background: TaskState[] = [];
    const running: TaskState[] = [];
    const done: TaskState[] = [];
    for (const task of list) {
      if (isTaskDone(task)) {
        done.push(task);
      } else if (task.isBackgrounded || task.taskType === 'local_bash') {
        background.push(task);
      } else {
        running.push(task);
      }
    }
    const byNewest = (a: TaskState, b: TaskState) => b.startTime - a.startTime;
    running.sort(byNewest);
    background.sort(byNewest);
    done.sort((a, b) => (b.endTime || 0) - (a.endTime || 0)).slice(0, 50);
    return { running, background, done, activeCount: running.length + background.length };
  }, [tasks]);

  const stopAll = () => {
    const ids = useTaskStore.getState().getRunningIds();
    if (!stdinId || ids.length === 0) return;
    ids.forEach((id) => { bridge.stopTask(stdinId, id).catch(() => {}); });
  };

  const totalCount = tasks.size;

  // Empty state
  if (totalCount === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center px-3 py-2 border-b border-border-subtle">
          <span className="text-[11px] font-semibold text-text-tertiary
            uppercase tracking-wider">{t('tasks.title')}</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none"
            stroke="currentColor" strokeWidth="1.2"
            className="text-text-tertiary/40 mb-3">
            <rect x="5" y="8" width="22" height="18" rx="3" />
            <path d="M10 14h12M10 18h12M10 22h8" />
          </svg>
          <p className="text-xs text-text-tertiary leading-relaxed">
            {t('tasks.empty')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-text-tertiary
            uppercase tracking-wider">{t('tasks.title')}</span>
          {activeCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full
              bg-accent/15 text-accent font-medium">
              {activeCount} {t('tasks.active')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {activeCount > 0 && stdinId && (
            <button onClick={stopAll}
              className="text-[9px] px-1.5 py-0.5 rounded bg-error/10 text-error
                hover:bg-error/20 transition-smooth"
              title={t('tasks.stopAll')}>
              {t('tasks.stopAll')}
            </button>
          )}
          {done.length > 0 && (
            <button
              onClick={() => { useTaskStore.getState().clearCompleted(); }}
              className="text-[9px] px-1.5 py-0.5 rounded bg-bg-tertiary
                text-text-tertiary hover:text-text-primary transition-smooth"
              title={t('tasks.clearCompleted')}>
              {t('tasks.clearCompleted')}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-1 px-1">
        {running.length > 0 && (
          <div className="mb-1">
            <div className="px-2 pt-1 pb-0.5 text-[9px] font-semibold
              text-text-tertiary uppercase tracking-wider">
              {t('tasks.running')}
            </div>
            {running.map((task) => (
              <TaskRow key={task.id} task={task} stdinId={stdinId} />
            ))}
          </div>
        )}
        {background.length > 0 && (
          <div className="mb-1">
            <div className="px-2 pt-1 pb-0.5 text-[9px] font-semibold
              text-text-tertiary uppercase tracking-wider">
              {t('tasks.background')}
            </div>
            {background.map((task) => (
              <TaskRow key={task.id} task={task} stdinId={stdinId} />
            ))}
          </div>
        )}
        {done.length > 0 && (
          <div className="mb-1">
            <div className="px-2 pt-1 pb-0.5 text-[9px] font-semibold
              text-text-tertiary uppercase tracking-wider">
              {t('tasks.completed')} ({done.length})
            </div>
            {done.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
