import { useChatStore } from '../stores/chatStore';
import { useSessionStore } from '../stores/sessionStore';
import { bridge } from './tauri-bridge';

/**
 * Gracefully interrupt the running turn (issue #19).
 *
 * Shared by the stop button and the global Esc handler. Sends the SDK `interrupt`
 * control_request instead of killing the process, so the CLI process survives and
 * its context is preserved for a same-session follow-up (stdinId is kept).
 *
 * The CLI emits a `result` with a non-success subtype for an interrupted turn —
 * `sessionMeta.interruptAt` tells useStreamProcessor to treat that as a clean stop
 * rather than an error state, then clears it. If the result never arrives (stdout
 * is block-buffered on Windows, see CLAUDE.md #8), fall back to killing the process
 * after 3s so the session never hangs.
 *
 * New-turn race: if the user sends a follow-up before the interrupt result arrives,
 * the send path bumps `turnStartTime`. The 3s fallback only kills when
 * `interruptAt >= turnStartTime` (no new turn started), and the re-entry guard
 * allows interrupting a new turn even while a stale interruptAt is still set.
 */
export async function interruptCurrentTurn(): Promise<void> {
  const tabId = useSessionStore.getState().selectedSessionId;
  const tab = tabId ? useChatStore.getState().getTab(tabId) : undefined;
  const sid = tab?.sessionMeta.stdinId;
  if (!tabId || !sid) return;
  if (tab.sessionStatus !== 'running') return;

  const meta = tab.sessionMeta;
  const turnStart = meta.turnStartTime ?? 0;
  // Re-entry guard: an interrupt for the CURRENT turn is already in flight. A
  // stale interruptAt (a new turn started since) doesn't block a fresh interrupt.
  if (meta.interruptAt !== undefined && meta.interruptAt >= turnStart) return;

  const interruptAt = Date.now();
  useChatStore.getState().setSessionMeta(tabId, { interruptAt });
  useChatStore.getState().setSessionStatus(tabId, 'completed');
  useChatStore.getState().setActivityStatus(tabId, { phase: 'completed' });

  await bridge.interruptSession(sid).catch(() => {});

  // Fallback: still unacknowledged AND no new turn started since the interrupt →
  // the interrupt was likely swallowed by stdout block-buffering; kill so the
  // session can be respawned.
  setTimeout(() => {
    const now = useChatStore.getState().getTab(tabId)?.sessionMeta;
    if (now?.interruptAt !== undefined && now.interruptAt >= (now.turnStartTime ?? 0)) {
      useChatStore.getState().setSessionMeta(tabId, {
        stdinId: undefined,
        interruptAt: undefined,
      });
      bridge.killSession(sid).catch(() => {});
    }
  }, 3000);
}
