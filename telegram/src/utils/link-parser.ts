export interface ParsedLinkRef {
  /** Ex: 32666-VALLEXBR55 */
  campaignId: string;
  siteid: string;
  code: string;
  bettingHouse: string;
  raw: string;
}

const DEFAULT_SUPERBET_SITEID = '32666';

/**
 * Superbet: siteid + c → campaignId "{siteid}-{c}"
 * @see backend-vexxa/src/modules/superbet-link-pool/domain/superbet.types.ts
 */
export function parseLinkInput(input: string): ParsedLinkRef | null {
  const raw = input.trim();
  if (!raw) return null;

  // URL completa ou parcial com query string
  if (/https?:\/\/|siteid=|[?&]c=/i.test(raw)) {
    try {
      const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      const siteid = url.searchParams.get('siteid');
      const c = url.searchParams.get('c');
      if (siteid && c) {
        return {
          campaignId: `${siteid}-${c}`,
          siteid,
          code: c,
          bettingHouse: detectHouseFromUrl(url.hostname),
          raw,
        };
      }
    } catch {
      // fallthrough
    }
  }

  // campaignId completo: 32666-VALLEXBR55
  const fullMatch = raw.match(/^(\d+)-([A-Za-z0-9]+)$/);
  if (fullMatch) {
    const [, siteid, code] = fullMatch;
    return {
      campaignId: `${siteid}-${code}`,
      siteid: siteid!,
      code: code!,
      bettingHouse: 'superbet',
      raw,
    };
  }

  // Só o código: VALLEXBR55
  const codeOnly = raw.match(/^([A-Za-z0-9]{3,})$/);
  if (codeOnly) {
    const code = codeOnly[1]!;
    return {
      campaignId: `${DEFAULT_SUPERBET_SITEID}-${code}`,
      siteid: DEFAULT_SUPERBET_SITEID,
      code,
      bettingHouse: 'superbet',
      raw,
    };
  }

  return null;
}

function detectHouseFromUrl(hostname: string): string {
  const h = hostname.toLowerCase();
  if (h.includes('superbet')) return 'superbet';
  if (h.includes('betano')) return 'betano';
  return 'superbet';
}

export function isLikelyLinkQuery(text: string): boolean {
  if (parseLinkInput(text)) return true;
  if (/https?:\/\//i.test(text)) return true;
  if (/siteid=/i.test(text) || /[?&]c=[A-Za-z0-9]+/i.test(text)) return true;
  if (/^\d+-[A-Za-z0-9]+$/i.test(text.trim())) return true;
  // Código tipo VALLEXBR55 (letras+números, sem @)
  if (/^[A-Z][A-Z0-9]{2,}$/i.test(text.trim()) && !text.includes('@')) return true;
  return false;
}

export function extractLinkToken(text: string): string | null {
  // URL na mensagem
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) return urlMatch[0]!;

  const trimmed = text
    .replace(/^\/link(?:@\w+)?\s*/i, '')
    .replace(/^link\s+/i, '')
    .trim();

  if (!trimmed) return null;

  // campaignId ou código solto
  const tokenMatch = trimmed.match(/(?:^|\s)(\d+-[A-Za-z0-9]+|[A-Z][A-Za-z0-9]{2,})(?:\s|$)/i);
  if (tokenMatch) return tokenMatch[1]!;

  return trimmed.split(/\s+/)[0] ?? null;
}
