export type SearchIdentifierKind =
  | 'email'
  | 'uuid'
  | 'cpf'
  | 'cnpj'
  | 'phone'
  | 'free';

export interface SearchIdentifierResult {
  kind: SearchIdentifierKind;
  normalized: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function detectSearchIdentifier(input: string): SearchIdentifierResult {
  const trimmed = input.trim();

  if (EMAIL_RE.test(trimmed)) {
    return { kind: 'email', normalized: trimmed.toLowerCase() };
  }

  if (UUID_RE.test(trimmed)) {
    return { kind: 'uuid', normalized: trimmed.toLowerCase() };
  }

  const digits = trimmed.replace(/\D/g, '');

  if (
    digits.length === trimmed.replace(/[\s.\-()]/g, '').length &&
    digits.length > 0
  ) {
    if (digits.length === 11) {
      return { kind: 'cpf', normalized: digits };
    }
    if (digits.length === 14) {
      return { kind: 'cnpj', normalized: digits };
    }
    if (digits.length >= 10 && digits.length <= 13) {
      return { kind: 'phone', normalized: digits };
    }
  }

  return { kind: 'free', normalized: trimmed };
}

/**
 * Builds a Prisma `where.user` fragment for a given search string.
 * Returns null when input is empty.
 */
export function buildUserSearchWhere(
  input: string,
): Record<string, unknown> | null {
  const s = input.trim();
  if (!s) return null;

  const { kind, normalized } = detectSearchIdentifier(s);

  switch (kind) {
    case 'email':
      // Match either the unique login e-mail OR the external sub-user's real
      // e-mail (externalEmail) — externals have a synthetic login e-mail.
      return {
        OR: [
          { email: { equals: normalized } },
          { externalEmail: { equals: normalized } },
        ],
      };
    case 'uuid':
      return { id: normalized };
    case 'cpf':
    case 'cnpj':
      return { cpf: { equals: normalized } };
    case 'phone':
      return { whatsapp: { equals: normalized } };
    case 'free':
    default:
      return {
        OR: [
          { name: { contains: s, mode: 'insensitive' } },
          { email: { contains: s, mode: 'insensitive' } },
          { externalEmail: { contains: s, mode: 'insensitive' } },
        ],
      };
  }
}
