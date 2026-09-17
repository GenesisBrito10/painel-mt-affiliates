import { createHash } from 'node:crypto';

const canonicalize = (value) => {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    if (
      typeof value.toJSON === 'function' &&
      value.constructor !== Object
    ) {
      return canonicalize(value.toJSON());
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

export const stableJson = (value) =>
  JSON.stringify(canonicalize(value), null, 2);

export const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');

const assertUniqueIds = (rows, label) => {
  const ids = rows.map((row) => row.id).filter((id) => id !== undefined);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`IDs duplicados em ${label}`);
  }
};

export function validateBackup(backup, manifest) {
  const actualHash = sha256(stableJson(backup));
  if (actualHash !== manifest.backupSha256) {
    throw new Error('Hash do backup divergente');
  }
  for (const [label, expectedCount] of Object.entries(manifest.counts)) {
    const rows = backup.tables[label];
    if (!Array.isArray(rows) || rows.length !== expectedCount) {
      throw new Error(`Contagem divergente em ${label}`);
    }
    assertUniqueIds(rows, label);
  }
  return true;
}

export function assertRollbackState(current, expected) {
  const currentMap = new Map(current.map((row) => [row.id, row]));
  if (currentMap.size !== expected.length) {
    throw new Error('Contagem divergente no rollback');
  }
  for (const row of expected) {
    const found = currentMap.get(row.id);
    if (!found || stableJson(found) !== stableJson(row)) {
      throw new Error(`Estado divergente no rollback para ${row.id}`);
    }
  }
  return true;
}

export const summarizeMoney = (rows, field) =>
  rows
    .reduce((sum, row) => sum + Number(row[field] ?? 0), 0)
    .toFixed(2);
