/**
 * Validação canônica de chave PIX por tipo (Bacen).
 * Aceita aliases comuns: EVP → random, telefone → phone, aleatoria → random.
 */

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';

export const PIX_KEY_TYPES: readonly PixKeyType[] = [
  'cpf',
  'cnpj',
  'email',
  'phone',
  'random',
] as const;

const REGEX: Record<PixKeyType, RegExp> = {
  cpf: /^\d{11}$/,
  cnpj: /^\d{14}$/,
  // E-mail: até 77 chars (limite BCB). Regex prática.
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  // Telefone Bacen: +55 + DDD + número (10 a 11 dígitos pós-DDI).
  phone: /^\+55\d{10,11}$/,
  // EVP / aleatória: UUID v4 (8-4-4-4-12 hex, qualquer versão).
  random: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
};

const ALIASES: Record<string, PixKeyType> = {
  evp: 'random',
  aleatoria: 'random',
  aleatória: 'random',
  telefone: 'phone',
  celular: 'phone',
};

export function normalizePixKeyType(raw: unknown): PixKeyType | null {
  const t = String(raw ?? '')
    .toLowerCase()
    .trim();
  if (!t) return null;
  if (PIX_KEY_TYPES.includes(t as PixKeyType)) return t as PixKeyType;
  if (ALIASES[t]) return ALIASES[t];
  return null;
}

export function normalizePixKey(type: PixKeyType, raw: unknown): string {
  const v = String(raw ?? '').trim();
  if (type === 'cpf' || type === 'cnpj') return v.replace(/\D/g, '');
  if (type === 'email') return v.toLowerCase();
  if (type === 'phone') {
    const digits = v.replace(/\D/g, '');
    if (v.startsWith('+')) return '+' + digits;
    // BR sem DDI → prefixa +55
    if (digits.length === 10 || digits.length === 11) return '+55' + digits;
    if (
      digits.startsWith('55') &&
      (digits.length === 12 || digits.length === 13)
    ) {
      return '+' + digits;
    }
    return v; // deixa o regex falhar com clareza
  }
  // random / EVP
  return v.toLowerCase();
}

export interface PixKeyValidation {
  ok: boolean;
  /** Mensagem em PT-BR para retornar ao usuário. */
  message?: string;
  /** Valor normalizado pronto para persistir. */
  normalized?: string;
}

export function validatePixKey(
  rawType: unknown,
  rawKey: unknown,
): PixKeyValidation {
  const type = normalizePixKeyType(rawType);
  if (!type) {
    return {
      ok: false,
      message:
        'Tipo de chave PIX inválido. Use CPF, CNPJ, e-mail, telefone ou aleatória.',
    };
  }
  const normalized = normalizePixKey(type, rawKey);
  if (!REGEX[type].test(normalized)) {
    return { ok: false, message: invalidMessage(type) };
  }
  return { ok: true, normalized };
}

function invalidMessage(type: PixKeyType): string {
  switch (type) {
    case 'cpf':
      return 'Chave PIX inválida para CPF: informe 11 dígitos.';
    case 'cnpj':
      return 'Chave PIX inválida para CNPJ: informe 14 dígitos.';
    case 'email':
      return 'Chave PIX inválida para e-mail: informe um e-mail válido.';
    case 'phone':
      return 'Chave PIX inválida para telefone: use formato +55 DDD número.';
    case 'random':
      return 'Chave aleatória inválida: deve estar no formato UUID (ex.: 123e4567-e89b-12d3-a456-426614174000).';
  }
}
