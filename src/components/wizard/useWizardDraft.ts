import { useCallback, useEffect, useRef, useState } from 'react';
import type { WizardMode } from './types';

// localStorage-backed draft persistence for the create wizard. Keyed per
// user+type+mode+seed so two accounts, or a fresh create vs an edit/clone of the
// same type, never stomp each other. Cross-tab writes to the same key raise a
// conflict flag (last-write-wins is accepted; the warning prevents silent loss).

const PREFIX = 'mmp:wizard-draft:';

function draftKey(userId: string, type: string, mode: WizardMode, seedId?: string): string {
  return `${PREFIX}${userId}:${type}:${mode}:${seedId ?? 'none'}`;
}

interface StoredDraft {
  data: Record<string, unknown>;
  savedAt: number;
  tabId: string;
}

interface UseWizardDraftOpts {
  userId: string;
  poolType: string;
  mode: WizardMode;
  seedId?: string;
  enabled: boolean;
}

export interface WizardDraft {
  // A draft found on mount (offer Resume/Discard); null if none.
  existing: StoredDraft | null;
  // Another tab wrote this same draft after us.
  conflict: boolean;
  save: (data: Record<string, unknown>) => void;
  clear: () => void;
}

export function useWizardDraft(opts: UseWizardDraftOpts): WizardDraft {
  const { userId, poolType, mode, seedId, enabled } = opts;
  const key = draftKey(userId, poolType, mode, seedId);
  const tabId = useRef<string>(`${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const [existing, setExisting] = useState<StoredDraft | null>(null);
  const [conflict, setConflict] = useState(false);

  // Read any pre-existing draft once on mount.
  useEffect(() => {
    if (!enabled) return;
    try {
      const raw = localStorage.getItem(key);
      if (raw) setExisting(JSON.parse(raw) as StoredDraft);
    } catch {
      /* corrupt draft — ignore */
    }
  }, [key, enabled]);

  // A foreign tab writing the same key means our in-progress edits may be lost.
  useEffect(() => {
    if (!enabled) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || !e.newValue) return;
      try {
        const incoming = JSON.parse(e.newValue) as StoredDraft;
        if (incoming.tabId !== tabId.current) setConflict(true);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, enabled]);

  const save = useCallback(
    (data: Record<string, unknown>) => {
      if (!enabled) return;
      try {
        localStorage.setItem(
          key,
          JSON.stringify({ data, savedAt: Date.now(), tabId: tabId.current } satisfies StoredDraft),
        );
      } catch {
        /* quota / private mode — drafts are best-effort */
      }
    },
    [key, enabled],
  );

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    setExisting(null);
  }, [key]);

  return { existing, conflict, save, clear };
}
