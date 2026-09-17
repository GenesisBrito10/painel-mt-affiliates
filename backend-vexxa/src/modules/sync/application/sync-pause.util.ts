import type { SettingsService } from '../../settings/index.js';

/** Global kill-switch for all sync jobs. Set setting `sync_paused` = 'true' to
 *  pause every metrics/betboard sync (used during data-reconciliation windows). */
export const SYNC_PAUSED_KEY = 'sync_paused';

export async function isSyncPaused(
  settings: SettingsService,
): Promise<boolean> {
  return (await settings.get(SYNC_PAUSED_KEY)) === 'true';
}
