import { describe, expect, it, vi } from 'vitest';
import type { SheetRow } from '../domain/sportingbet.types.js';
import { SportingbetAdminController } from './sportingbet-admin.controller.js';

describe('SportingbetAdminController', () => {
  it('does not count rows after an invalid sequential row', async () => {
    const rows: SheetRow[] = [
      {
        rowIndex: 2,
        affiliate: 'Caio Fernandes Rocha Souza',
        linkType: 'Telegram',
        link: 'https://example.com/telegram',
        status: '',
        email: '',
      },
      {
        rowIndex: 3,
        affiliate: 'Caio Fernandes Rocha Souza',
        linkType: 'Instagram',
        link: 'https://example.com/instagram',
        status: 'marcado',
        email: 'used@example.com',
      },
      {
        rowIndex: 4,
        affiliate: 'Sem Tipo',
        linkType: '',
        link: 'https://example.com/invalid',
        status: '',
        email: '',
      },
      {
        rowIndex: 5,
        affiliate: 'Ana Ribeiro Dias',
        linkType: 'Cadastro',
        link: 'https://example.com/cadastro',
        status: '',
        email: '',
      },
    ];
    const findFirst = vi.fn();
    const controller = new SportingbetAdminController(
      { affiliateLink: { findFirst } } as never,
      { readPool: vi.fn().mockResolvedValue(rows) } as never,
      {} as never,
    );

    await expect(controller.poolStatus()).resolves.toEqual({
      total: 4,
      available: 0,
      used: 1,
      inconsistencies: 0,
    });
    expect(findFirst).not.toHaveBeenCalled();
  });
});
