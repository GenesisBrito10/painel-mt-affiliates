import { describe, expect, it, vi } from 'vitest';
import { LinkRequestService } from './link-request.service.js';

describe('LinkRequestService sportingbet-diario routing', () => {
  it('routes sportingbet-diario to its dedicated assignment service', () => {
    const dailyAssignment = { tryAssign: vi.fn() };
    const service = Object.create(LinkRequestService.prototype) as unknown as {
      sportingbetDiarioAssignment: typeof dailyAssignment;
      poolAssignmentFor: (houseSlug: string) => unknown;
    };
    service.sportingbetDiarioAssignment = dailyAssignment;

    expect(service.poolAssignmentFor('sportingbet-diario')).toBe(
      dailyAssignment,
    );
  });
});
