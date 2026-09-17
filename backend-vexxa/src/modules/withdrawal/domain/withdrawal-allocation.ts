/**
 * Distribute a withdrawable total across houses proportionally to each house's
 * gross earnings.
 *
 * The historical per-house attribution of past withdrawals is unknowable (pre
 * per-casa they were global). So instead of tracking it, the current net total
 * (globalNet, which already nets out ALL withdrawals) is simply split across
 * houses by how much each house earned. The per-house breakdown always sums to
 * the total and never goes negative.
 *
 * @param grossByHouse  per-house gross earnings (own + network − fraud)
 * @param total         the withdrawable total to distribute (globalNet, minus
 *                      any bonus handled separately)
 * @returns             per-house available; sums to `total` when any gross > 0
 */
export function distributeProportional(
  grossByHouse: Map<string, number>,
  total: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const budget = Math.max(0, total);

  let weight = 0;
  for (const [slug, v] of grossByHouse) {
    if (slug === 'all') continue; // legacy sentinel, never withdrawable
    weight += Math.max(0, v);
  }

  for (const [slug, v] of grossByHouse) {
    if (slug === 'all') continue;
    const w = Math.max(0, v);
    out.set(slug, weight > 0 ? (w / weight) * budget : 0);
  }
  return out;
}
