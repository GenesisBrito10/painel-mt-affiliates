import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvolutionApiError } from '../../domain/exceptions/whatsapp.exceptions.js';
import {
  type EvolutionGroup,
  type EvolutionQr,
  type EvolutionSendResult,
  type WhatsappConnectionStatus,
} from '../../domain/types/whatsapp.types.js';

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Token da instância (header auth). Cai para a key global se ausente. */
  instanceToken?: string;
  timeoutMs?: number;
}

/**
 * Cliente HTTP da Evolution GO (whatsmeow). Swagger 2.0, respostas `gin.H`
 * (não tipadas) — parsing defensivo. Auth via header `apikey` (configurável
 * por `EVOLUTION_AUTH_HEADER`). Endpoints instance-scoped não recebem o
 * instanceId na URL: a instância é resolvida pelo token no header.
 *
 * ⚠️ A divisão exata entre key global (management) e token de instância é o
 * único ponto a confirmar contra a API real — ver verificação do plano.
 */
@Injectable()
export class EvolutionClient {
  private readonly logger = new Logger(EvolutionClient.name);
  private readonly baseUrl: string;
  private readonly globalKey: string;
  private readonly authHeader: string;
  private readonly defaultTimeoutMs = 20_000;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (this.config.get<string>('EVOLUTION_API_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    this.globalKey = this.config.get<string>('EVOLUTION_API_KEY') ?? '';
    this.authHeader =
      this.config.get<string>('EVOLUTION_AUTH_HEADER') ?? 'apikey';
  }

  get instanceName(): string {
    return this.config.get<string>('EVOLUTION_INSTANCE_NAME') ?? '';
  }

  // ─── Low-level request ──────────────────────────────────────────────────────

  private async request<T = unknown>(
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new EvolutionApiError('EVOLUTION_API_URL não configurada', null);
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      opts.timeoutMs ?? this.defaultTimeoutMs,
    );
    const token = opts.instanceToken || this.globalKey;
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: opts.method ?? 'GET',
        headers: {
          [this.authHeader]: token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      const json = text ? safeJsonParse(text) : undefined;

      if (!res.ok) {
        // Mensagem clara, sem vazar headers/token.
        const apiMsg =
          (json && typeof json === 'object' && 'error' in json
            ? String((json as Record<string, unknown>)['error'])
            : undefined) ?? `HTTP ${res.status}`;
        throw new EvolutionApiError(apiMsg, res.status);
      }
      return json as T;
    } catch (err) {
      if (err instanceof EvolutionApiError) throw err;
      // timeout/rede = recuperável (definitiveMedia=false)
      const msg = err instanceof Error ? err.message : String(err);
      throw new EvolutionApiError(`Falha ao chamar Evolution: ${msg}`, null);
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Instância ────────────────────────────────────────────────────────────

  /** Cria a instância (idempotente do nosso lado: ignora "já existe"). */
  async createInstance(name: string): Promise<Record<string, unknown>> {
    return this.request('/instance/create', {
      method: 'POST',
      body: { name, instanceId: name },
    });
  }

  /** Conecta a instância e registra webhook + eventos. */
  async connect(params: {
    instanceToken?: string;
    webhookUrl?: string;
    subscribe?: string[];
  }): Promise<Record<string, unknown>> {
    return this.request('/instance/connect', {
      method: 'POST',
      instanceToken: params.instanceToken,
      body: {
        immediate: true,
        ...(params.webhookUrl ? { webhookUrl: params.webhookUrl } : {}),
        ...(params.subscribe ? { subscribe: params.subscribe } : {}),
      },
    });
  }

  async reconnect(instanceToken?: string): Promise<Record<string, unknown>> {
    return this.request('/instance/reconnect', {
      method: 'POST',
      instanceToken,
      body: {},
    });
  }

  async disconnect(instanceToken?: string): Promise<Record<string, unknown>> {
    return this.request('/instance/disconnect', {
      method: 'POST',
      instanceToken,
      body: {},
    });
  }

  /** QR code para parear o número. */
  async getQr(instanceToken?: string): Promise<EvolutionQr> {
    const raw = await this.request<Record<string, unknown>>('/instance/qr', {
      instanceToken,
    });
    return {
      qrcode: pickString(raw, ['qrcode', 'qr', 'code', 'base64']),
      pairingCode: pickString(raw, ['pairingCode', 'pairing_code']),
      connected: pickBool(raw, ['connected']),
    };
  }

  /** Estado da conexão, normalizado. */
  async getStatus(instanceToken?: string): Promise<{
    status: WhatsappConnectionStatus;
    phoneNumber: string | null;
    raw: unknown;
  }> {
    const raw = await this.request<Record<string, unknown>>(
      '/instance/status',
      { instanceToken },
    );
    return {
      status: normalizeStatus(raw),
      phoneNumber: extractPhone(raw),
      raw,
    };
  }

  // ─── Grupos ───────────────────────────────────────────────────────────────

  async listGroups(instanceToken?: string): Promise<EvolutionGroup[]> {
    const raw = await this.request<unknown>('/group/list', { instanceToken });
    return normalizeGroups(raw);
  }

  /**
   * Foto do grupo. Tenta /group/info (traz subject + foto) e, se não vier URL,
   * cai p/ /group/photo. Resposta gin.H não tipada → parsing defensivo. Retorna
   * null se nenhuma URL for encontrada (admin mostra avatar com iniciais).
   */
  async getGroupPhoto(
    groupJid: string,
    instanceToken?: string,
  ): Promise<string | null> {
    const PIC_KEYS = [
      'pictureUrl',
      'profilePicUrl',
      'picture',
      'image',
      'photo',
      'imgUrl',
      'url',
      'profilePictureUrl',
    ];
    try {
      const info = await this.request<Record<string, unknown>>('/group/info', {
        method: 'POST',
        instanceToken,
        body: { groupJid },
      });
      const fromInfo = pickString(info, PIC_KEYS);
      if (fromInfo) return fromInfo;
    } catch {
      // ignora — tenta /group/photo
    }
    try {
      const photo = await this.request<Record<string, unknown>>(
        '/group/photo',
        { method: 'POST', instanceToken, body: { groupJid } },
      );
      return pickString(photo, PIC_KEYS) ?? null;
    } catch {
      return null;
    }
  }

  // ─── Envio ──────────────────────────────────────────────────────────────────

  async sendText(params: {
    number: string;
    text: string;
    instanceToken?: string;
  }): Promise<EvolutionSendResult> {
    const raw = await this.request<Record<string, unknown>>('/send/text', {
      method: 'POST',
      instanceToken: params.instanceToken,
      body: { number: params.number, text: params.text },
    });
    return { ok: true, messageId: extractMessageId(raw), raw };
  }

  /** Envia mídia por URL (estratégia oficial — nunca base64/data-URI). */
  async sendMedia(params: {
    number: string;
    url: string;
    caption: string;
    instanceToken?: string;
  }): Promise<EvolutionSendResult> {
    const raw = await this.request<Record<string, unknown>>('/send/media', {
      method: 'POST',
      instanceToken: params.instanceToken,
      body: {
        number: params.number,
        url: params.url,
        type: 'image',
        caption: params.caption,
      },
    });
    return { ok: true, messageId: extractMessageId(raw), raw };
  }

  // ─── Usuário (validação de número) ────────────────────────────────────────

  /**
   * Verifica se números existem no WhatsApp via POST /user/check
   * (CheckUserStruct: `{ number: string[], formatJid }`). Resposta gin.H não
   * tipada — parsing defensivo. Retorna um item por número informado; quando a
   * API não devolve o status de um número, `exists` fica `false`.
   */
  async checkNumbers(
    numbers: string[],
    instanceToken?: string,
  ): Promise<{ number: string; exists: boolean }[]> {
    const raw = await this.request<unknown>('/user/check', {
      method: 'POST',
      instanceToken,
      body: { number: numbers, formatJid: true },
    });
    return numbers.map((n) => ({ number: n, exists: extractExists(raw, n) }));
  }

  /**
   * Resolve a forma "enviável" de um número BR. Lida com o quirk do 9º dígito:
   * o WhatsApp registra alguns celulares SEM o 9 (55+DDD+8 dígitos) mesmo quando
   * o número "oficial" tem o 9 (55+DDD+9 dígitos). Gera as variantes (com/sem 9,
   * sempre com DDI 55), checa todas via /user/check e retorna a que EXISTE — a
   * mesma forma deve ser usada no /message/sendText. Retorna null se nenhuma
   * existe no WhatsApp.
   */
  async resolveBrNumber(
    raw: string,
    instanceToken?: string,
  ): Promise<string | null> {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (!digits) return null;
    const withCc = digits.startsWith('55') ? digits : `55${digits}`;
    const candidates = new Set<string>([withCc]);
    const ddd = withCc.slice(2, 4);
    const rest = withCc.slice(4);
    if (rest.length === 9 && rest.startsWith('9'))
      candidates.add(`55${ddd}${rest.slice(1)}`); // remove o 9
    if (rest.length === 8) candidates.add(`55${ddd}9${rest}`); // adiciona o 9
    const list = [...candidates];
    const checks = await this.checkNumbers(list, instanceToken);
    return checks.find((c) => c.exists)?.number ?? null;
  }

  // ─── Management (global apikey) ──────────────────────────────────────────

  /**
   * Localiza a instância por nome via /instance/all (usa a key GLOBAL).
   * Endpoints instance-scoped (/status, /qr, /group/list, /send/*) exigem o
   * `token` retornado aqui no header — a key global recebe 401 neles.
   */
  async findInstance(name: string): Promise<{
    token: string | null;
    connected: boolean;
    phone: string | null;
    name: string;
  } | null> {
    const raw = await this.request<Record<string, unknown>>('/instance/all');
    const list = Array.isArray(raw)
      ? raw
      : ((raw?.['data'] as unknown[]) ?? []);
    const found = (list as Record<string, unknown>[]).find(
      (i) => pickString(i, ['name']) === name,
    );
    if (!found) return null;
    return {
      token: pickString(found, ['token']) ?? null,
      connected: pickBool(found, ['connected']) === true,
      phone: extractPhone(found),
      name: pickString(found, ['name']) ?? name,
    };
  }
}

// ─── Defensive parsing helpers (gin.H) ────────────────────────────────────────

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

// A Evolution GO usa chaves PascalCase (JID, Name, Connected, LoggedIn) e
// envelopa em { data: ... }. Todos os helpers são CASE-INSENSITIVE e descem
// nos envelopes comuns.

const WRAP_KEYS = ['data', 'instance', 'result', 'response'];

function ciGet(obj: Record<string, unknown>, key: string): unknown {
  const lk = key.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lk) return obj[k];
  }
  return undefined;
}

function pickString(
  obj: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = ciGet(obj, k);
    if (typeof v === 'string' && v.length > 0) return v;
  }
  for (const wrap of WRAP_KEYS) {
    const inner = ciGet(obj, wrap);
    if (inner && typeof inner === 'object') {
      const found = pickString(inner as Record<string, unknown>, keys);
      if (found) return found;
    }
  }
  return undefined;
}

function pickBool(
  obj: Record<string, unknown> | undefined,
  keys: string[],
): boolean | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = ciGet(obj, k);
    if (typeof v === 'boolean') return v;
  }
  for (const wrap of WRAP_KEYS) {
    const inner = ciGet(obj, wrap);
    if (inner && typeof inner === 'object') {
      const found = pickBool(inner as Record<string, unknown>, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function normalizeStatus(
  raw: Record<string, unknown>,
): WhatsappConnectionStatus {
  // Forma confirmada: { data: { Connected: bool, LoggedIn: bool, Name } }.
  const connected = pickBool(raw, ['connected']);
  const loggedIn = pickBool(raw, ['loggedin']);
  if (connected === true && loggedIn !== false) return 'open';
  const s = (
    pickString(raw, ['status', 'state', 'connection', 'connectionStatus']) ?? ''
  ).toLowerCase();
  if (['open', 'connected', 'online'].includes(s)) return 'open';
  if (['connecting', 'pairing', 'qr', 'starting'].includes(s))
    return 'connecting';
  if (['close', 'closed', 'disconnected', 'offline', 'logout'].includes(s))
    return 'close';
  if (connected === false) return 'close';
  return 'close';
}

function extractPhone(raw: Record<string, unknown>): string | null {
  const jid = pickString(raw, ['phone', 'phoneNumber', 'number', 'wid', 'jid']);
  if (!jid) return null;
  // "5512982508333:1@s.whatsapp.net" → "5512982508333"
  return jid.replace(/[:@].*$/, '');
}

function extractMessageId(raw: Record<string, unknown>): string | undefined {
  return pickString(raw, ['messageId', 'id', 'key', 'message_id']);
}

const EXISTS_KEYS = [
  'exists',
  'exist',
  'isInWhatsapp',
  'isinwhatsapp',
  'isregistered',
  'registered',
  'valid',
];

/** Só os dígitos do número (ignora +, espaços, :, @s.whatsapp.net). */
function digits(s: string): string {
  return s.replace(/\D/g, '');
}

/**
 * Resposta do /user/check é gin.H não tipada. Pode vir como array de objetos
 * ({ jid/number/wid, exists/isInWhatsapp/... }), objeto envelopado em
 * data/result, ou array simples de JIDs válidos. Procura a entrada do número e
 * lê o booleano de existência; default `false` se não achar.
 */
function extractExists(raw: unknown, number: string): boolean {
  const target = digits(number);
  if (!target) return false;

  const visit = (node: unknown, depth: number): boolean | undefined => {
    if (!node || depth > 5) return undefined;
    if (typeof node === 'string') {
      return digits(node).endsWith(target) ? true : undefined;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const r = visit(item, depth + 1);
        if (r !== undefined) return r;
      }
      return undefined;
    }
    if (typeof node === 'object') {
      const o = node as Record<string, unknown>;
      const jid = pickString(o, ['jid', 'number', 'wid', 'remoteJid']);
      if (jid && digits(jid).endsWith(target)) {
        for (const k of Object.keys(o)) {
          if (EXISTS_KEYS.includes(k.toLowerCase())) {
            return o[k] === true || o[k] === 'true';
          }
        }
        // Entrada existe e a API não trouxe flag negativa → considera válido.
        return true;
      }
      for (const v of Object.values(o)) {
        const r = visit(v, depth + 1);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  };

  return visit(raw, 0) ?? false;
}

function normalizeGroups(raw: unknown): EvolutionGroup[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const k of ['data', 'groups', 'result', 'items']) {
      const v = ciGet(o, k);
      if (Array.isArray(v)) {
        arr = v;
        break;
      }
    }
  }
  return arr
    .map((g) => {
      if (!g || typeof g !== 'object') return null;
      const o = g as Record<string, unknown>;
      const id = pickString(o, ['jid', 'id', 'groupId', 'remoteJid', 'gid']);
      const name = pickString(o, ['name', 'subject', 'title']) ?? id ?? '';
      if (!id) return null;
      const pictureUrl = pickString(o, [
        'pictureUrl',
        'profilePicUrl',
        'picture',
        'image',
        'photo',
        'imgUrl',
        'profilePictureUrl',
      ]);
      return {
        id,
        name,
        ...(pictureUrl ? { pictureUrl } : {}),
      } as EvolutionGroup;
    })
    .filter((g): g is EvolutionGroup => g !== null);
}
