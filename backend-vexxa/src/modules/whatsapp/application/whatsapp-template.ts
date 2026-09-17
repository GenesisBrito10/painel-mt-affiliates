import { BadRequestException } from '@nestjs/common';
import {
  MAX_TEMPLATE_LENGTH,
  TEMPLATE_VARIABLES,
  type TemplateVariable,
} from '../domain/types/whatsapp.types.js';

export type TemplateVars = Record<TemplateVariable, string>;

const VAR_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
// Caracteres de controle, exceto \t (\x09) e \n (\x0A).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Renderiza o template substituindo `{{var}}` pelos valores. Função única
 * compartilhada entre o worker (envio real) e o preview do admin para garantir
 * resultado idêntico. Sanitiza caracteres de controle.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const rendered = template.replace(VAR_PATTERN, (_m, name: string) => {
    const key = name as TemplateVariable;
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : '';
  });
  return rendered.replace(CONTROL_CHARS, '');
}

/**
 * Valida tamanho e somente variáveis conhecidas. Lança BadRequest com mensagem
 * clara ao admin se houver variável desconhecida.
 */
export function validateTemplate(template: string): void {
  if (!template || template.trim().length === 0) {
    throw new BadRequestException('O template não pode ser vazio.');
  }
  if (template.length > MAX_TEMPLATE_LENGTH) {
    throw new BadRequestException(
      `O template excede o tamanho máximo de ${MAX_TEMPLATE_LENGTH} caracteres.`,
    );
  }
  const known = new Set<string>(TEMPLATE_VARIABLES);
  const unknown = new Set<string>();
  let m: RegExpExecArray | null;
  VAR_PATTERN.lastIndex = 0;
  while ((m = VAR_PATTERN.exec(template)) !== null) {
    if (!known.has(m[1]!)) unknown.add(m[1]!);
  }
  if (unknown.size > 0) {
    throw new BadRequestException(
      `Variável(is) desconhecida(s) no template: ${[...unknown]
        .map((v) => `{{${v}}}`)
        .join(
          ', ',
        )}. Permitidas: ${TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(', ')}`,
    );
  }
}

// ─── Formatação ───────────────────────────────────────────────────────────────

export function formatAmountBRL(amount: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amount);
}

export function formatDateBR(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatTimeBR(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export interface BuildVarsInput {
  userName: string;
  userEmail: string;
  amount: number;
  withdrawalId: string;
  status: string;
  when?: Date;
}

export function buildTemplateVars(input: BuildVarsInput): TemplateVars {
  const when = input.when ?? new Date();
  return {
    userName: input.userName,
    userEmail: input.userEmail,
    amount: formatAmountBRL(input.amount),
    date: formatDateBR(when),
    time: formatTimeBR(when),
    withdrawalId: input.withdrawalId,
    status: input.status,
  };
}

/** Dados fake para preview / envio de teste (dry-run). */
export function sampleTemplateVars(): TemplateVars {
  return buildTemplateVars({
    userName: 'Ricardo Rocha de Almeida',
    userEmail: 'ricardo@example.com',
    amount: 413.6,
    withdrawalId: 'TESTE-0001',
    status: 'COMPLETED',
  });
}
