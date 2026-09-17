export function stableJson(value: unknown): string;
export function sha256(value: string): string;
export function validateBackup(
  backup: { tables: Record<string, unknown[]> },
  manifest: { backupSha256: string; counts: Record<string, number> },
): true;
export function assertRollbackState(
  current: Array<{ id: string; [key: string]: unknown }>,
  expected: Array<{ id: string; [key: string]: unknown }>,
): true;
export function summarizeMoney(
  rows: Array<Record<string, unknown>>,
  field: string,
): string;
