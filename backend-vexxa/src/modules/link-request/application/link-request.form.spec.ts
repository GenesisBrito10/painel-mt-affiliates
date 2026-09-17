import { describe, it, expect, vi } from 'vitest';
import { LinkRequestService } from './link-request.service.js';

/**
 * Testes focados no fluxo de deals kind=FORM. Como os métodos tocam poucas
 * dependências, dirigimos um instance "cru" (Object.create) e injetamos só o
 * que cada caminho usa — mesmo padrão de link-request.list-referral.spec.ts.
 */
type Anyed = Record<string, unknown>;

function makeService(overrides: Anyed = {}) {
  const service = Object.create(
    LinkRequestService.prototype,
  ) as LinkRequestService;
  // Cripto fake determinístico (não é AES real, só marca ida/volta).
  (service as unknown as { crypto: unknown }).crypto = {
    encrypt: (s: string) => `enc:${s}`,
    decrypt: (s: string) => s.replace(/^enc:/, ''),
  };
  Object.assign(service as unknown as Anyed, overrides);
  return service;
}

const SCHEMA = [
  { key: 'credUsername', label: 'Usuário', type: 'text', required: true },
  {
    key: 'credPassword',
    label: 'Senha',
    type: 'password',
    required: true,
    secret: true,
  },
  { key: 'houses', label: 'Casas', type: 'multiselect', required: true },
  {
    key: 'agreement',
    label: 'Acordo',
    type: 'select',
    required: true,
    options: [
      {
        value: '30_30_20',
        label: 'CPA 30/30 + 20% REV',
        cpa: 30,
        revshare: 20,
      },
      {
        value: '50_50_20',
        label: 'CPA 50/50 + 20% REV',
        cpa: 50,
        revshare: 20,
      },
    ],
  },
];

describe('LinkRequestService — deals FORM', () => {
  it('encrypta apenas os campos secret e faz roundtrip no decrypt', () => {
    const service = makeService();
    const fields = (service as any).parseFormSchema(SCHEMA);
    const encrypted = (service as any).encryptFormSecrets(fields, {
      credUsername: 'joao',
      credPassword: 'segredo',
    });
    expect(encrypted.credUsername).toBe('joao'); // não-secreto: intacto
    expect(encrypted.credPassword).toBe('enc:segredo'); // secreto: cifrado

    const decrypted = (service as any).decryptFormData(SCHEMA, encrypted);
    expect(decrypted.credPassword).toBe('segredo');
  });

  it('resolveAgreementPreset mapeia o acordo escolhido para CPA/RevShare', () => {
    const service = makeService();
    const preset = (service as any).resolveAgreementPreset(SCHEMA, {
      agreement: '50_50_20',
    });
    expect(preset).toEqual({ cpa: 50, revshare: 20 });
  });

  it('resolveFormHouses usa o campo houses e cai na própria casa quando vazio', () => {
    const service = makeService();
    expect(
      (service as any).resolveFormHouses(
        { houses: ['zona-de-jogo', 'mega-aposta'] },
        'zona-de-jogo',
      ),
    ).toEqual(['zona-de-jogo', 'mega-aposta']);
    expect((service as any).resolveFormHouses({}, 'mega-aposta')).toEqual([
      'mega-aposta',
    ]);
  });

  it('createFormRequest cria 1 solicitação por casa com a senha cifrada', async () => {
    const create = vi.fn().mockImplementation(({ data }: any) => ({
      id: 'lr-1',
      userId: data.userId,
      dealId: data.dealId,
      bettingHouseSlug: data.bettingHouseSlug,
      message: data.message,
      status: 'PENDING',
      createdAt: new Date('2026-07-07T00:00:00Z'),
    }));
    const findFirst = vi.fn().mockResolvedValue(null); // sem pendente duplicado
    const dealFindFirst = vi.fn().mockResolvedValue({ id: 'deal-mega' });
    const service = makeService({
      prisma: {
        linkRequest: { create, findFirst },
        deal: { findFirst: dealFindFirst },
      },
    });

    const res = await (service as any).createFormRequest(
      'user-1',
      { id: 'deal-zona', bettingHouseSlug: 'zona-de-jogo', formSchema: SCHEMA },
      {
        formData: {
          credUsername: 'joao',
          credPassword: 'Segredo1',
          houses: ['zona-de-jogo', 'mega-aposta'],
          agreement: '50_50_20',
        },
      },
    );

    // Duas casas selecionadas → duas solicitações criadas.
    expect(create).toHaveBeenCalledTimes(2);
    // Senha gravada cifrada em ambas.
    for (const call of create.mock.calls) {
      expect(call[0].data.formData.credPassword).toBe('enc:Segredo1');
    }
    // Retorna a solicitação da casa do próprio deal.
    expect(res.bettingHouseSlug).toBe('zona-de-jogo');
  });

  it('createFormRequest rejeita quando falta campo obrigatório', async () => {
    const service = makeService({ prisma: { linkRequest: {}, deal: {} } });
    await expect(
      (service as any).createFormRequest(
        'user-1',
        {
          id: 'deal-zona',
          bettingHouseSlug: 'zona-de-jogo',
          formSchema: SCHEMA,
        },
        { formData: { credUsername: 'joao' } }, // faltam senha/casas/acordo
      ),
    ).rejects.toThrow(/obrigatório/i);
  });

  it('createFormRequest rejeita senha fraca (sem maiúscula/número/6 chars)', async () => {
    const service = makeService({ prisma: { linkRequest: {}, deal: {} } });
    await expect(
      (service as any).createFormRequest(
        'user-1',
        {
          id: 'deal-zona',
          bettingHouseSlug: 'zona-de-jogo',
          formSchema: SCHEMA,
        },
        {
          formData: {
            credUsername: 'joao',
            credPassword: 'segredo', // só minúsculas → inválida
            houses: ['zona-de-jogo'],
            agreement: '50_50_20',
          },
        },
      ),
    ).rejects.toThrow(/mínimo 6 caracteres/i);
  });

  it('finalizeFormRequest aprova: grava AffiliateLink com ID de afiliado + CPA/REV e notifica', async () => {
    const affCreate = vi.fn().mockResolvedValue({});
    const affFindFirst = vi.fn().mockResolvedValue(null);
    const lrUpdate = vi.fn().mockResolvedValue({
      id: 'lr-1',
      userId: 'user-1',
      dealId: 'deal-zona',
      bettingHouseSlug: 'zona-de-jogo',
      message: '',
      status: 'FULFILLED',
      links: [],
      adminNote: '',
      fulfilledAt: new Date('2026-07-07T00:00:00Z'),
      fulfilledByName: 'admin@x.com',
      createdAt: new Date('2026-07-07T00:00:00Z'),
      resolvedCpa: 50,
      resolvedRevshare: 20,
      formData: { credPassword: 'enc:segredo' },
      user: { name: 'Joao', email: 'joao@x.com', referredBy: null },
      deal: { name: 'Zona de Jogo', formSchema: SCHEMA },
    });
    const notifyCreate = vi.fn().mockResolvedValue({});
    const service = makeService({
      prisma: {
        affiliateLink: {
          findFirst: affFindFirst,
          create: affCreate,
          update: vi.fn(),
        },
        linkRequest: { update: lrUpdate },
        bettingHouse: {
          findUnique: vi.fn().mockResolvedValue({ name: 'Zona de Jogo' }),
        },
      },
      linkWebhook: { notifyApproved: vi.fn().mockResolvedValue(undefined) },
      notification: { create: notifyCreate },
    });

    const res = await (service as any).finalizeFormRequest(
      'lr-1',
      {
        userId: 'user-1',
        bettingHouseSlug: 'zona-de-jogo',
        formData: { agreement: '50_50_20' },
        deal: { name: 'Zona de Jogo', formSchema: SCHEMA },
      },
      { sub: 'admin-1', email: 'admin@x.com' },
      true,
      { action: 'approve', cpa: 50, revshare: 20, manualCampaignId: 'AFF-123' },
    );

    // AffiliateLink criado com o ID de afiliado (campaignId) + comissão.
    expect(affCreate).toHaveBeenCalledTimes(1);
    const affData = affCreate.mock.calls[0][0].data;
    expect(affData.campaignId).toBe('AFF-123');
    expect(Number(affData.cpa)).toBe(50);
    expect(Number(affData.revshare)).toBe(20);

    // Solicitação marcada FULFILLED.
    expect(lrUpdate.mock.calls[0][0].data.status).toBe('FULFILLED');

    // Afiliado notificado in-app.
    expect(notifyCreate).toHaveBeenCalledTimes(1);
    expect(notifyCreate.mock.calls[0][0].userId).toBe('user-1');

    // Item retornado traz o formData decifrado.
    expect(res.formData.credPassword).toBe('segredo');
    expect(res.status).toBe('FULFILLED');
  });

  it('finalizeFormRequest herda CPA/REV do acordo quando não vêm no input', async () => {
    const affCreate = vi.fn().mockResolvedValue({});
    const service = makeService({
      prisma: {
        affiliateLink: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: affCreate,
          update: vi.fn(),
        },
        linkRequest: {
          update: vi.fn().mockResolvedValue({
            id: 'lr-1',
            userId: 'user-1',
            dealId: 'd',
            bettingHouseSlug: 'zona-de-jogo',
            message: '',
            status: 'FULFILLED',
            links: [],
            adminNote: '',
            fulfilledAt: new Date('2026-07-07'),
            fulfilledByName: 'a',
            createdAt: new Date('2026-07-07'),
            resolvedCpa: 30,
            resolvedRevshare: 20,
            formData: {},
            user: { name: 'J', email: 'j@x', referredBy: null },
            deal: { name: 'Z', formSchema: SCHEMA },
          }),
        },
        bettingHouse: {
          findUnique: vi.fn().mockResolvedValue({ name: 'Zona de Jogo' }),
        },
      },
      linkWebhook: { notifyApproved: vi.fn().mockResolvedValue(undefined) },
      notification: { create: vi.fn().mockResolvedValue({}) },
    });

    await (service as any).finalizeFormRequest(
      'lr-1',
      {
        userId: 'user-1',
        bettingHouseSlug: 'zona-de-jogo',
        formData: { agreement: '30_30_20' },
        deal: { name: 'Z', formSchema: SCHEMA },
      },
      { sub: 'admin-1', email: 'a@x' },
      true,
      { action: 'approve' }, // sem cpa/revshare → herda do acordo 30_30_20
    );

    const affData = affCreate.mock.calls[0][0].data;
    expect(Number(affData.cpa)).toBe(30);
    expect(Number(affData.revshare)).toBe(20);
  });
});
