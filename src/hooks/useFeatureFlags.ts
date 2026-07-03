import { useState, useEffect } from 'react';
import type { PoolType, SystemSettings } from '../types';
import { settingsService } from '../services/settingsService';
import { resolvePoolTypeFlags } from '../utils/featureFlags';

/**
 * Live feature-flag state for the pool-creation UI (T5). Subscribes to
 * system/config and resolves poolTypeFlags over the fail-open defaults.
 * Client-side gate is UX only; the server guard is authoritative.
 */
export function useFeatureFlags(): {
  poolTypeFlags: Record<PoolType, boolean>;
  maintenanceMode: boolean;
  loading: boolean;
} {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = settingsService.subscribe((s) => {
      setSettings(s);
      setLoading(false);
    });
    return unsub;
  }, []);

  return {
    poolTypeFlags: resolvePoolTypeFlags(settings),
    maintenanceMode: settings?.maintenanceMode === true,
    loading,
  };
}
