/**
 * Cpf — Domain Value Object
 *
 * Implements the Receita Federal CPF validation algorithm:
 * 1. Strips formatting (dots, dashes)
 * 2. Rejects known invalid patterns (all same digits)
 * 3. Validates both check digits (Módulo 11)
 *
 * Pure TS — zero external dependencies.
 */
export class Cpf {
  private readonly _digits: string;

  private constructor(digits: string) {
    this._digits = digits;
  }

  /** Returns the raw 11-digit string (no formatting) */
  get value(): string {
    return this._digits;
  }

  /** Returns the masked display format: ***.***.XXX-XX */
  get masked(): string {
    const d = this._digits;
    return `***.***.${ d[6]}${ d[7]}${ d[8]}-${ d[9]}${ d[10]}`;
  }

  /** Returns the formatted display: XXX.XXX.XXX-XX */
  get formatted(): string {
    const d = this._digits;
    return `${d[0]}${d[1]}${d[2]}.${d[3]}${d[4]}${d[5]}.${d[6]}${d[7]}${d[8]}-${d[9]}${d[10]}`;
  }

  /**
   * Attempts to parse and validate a CPF string.
   * @returns Cpf instance if valid, null otherwise.
   */
  static parse(raw: string): Cpf | null {
    // Strip all non-digit characters
    const digits = raw.replace(/\D/g, '');

    if (digits.length !== 11) return null;

    // Reject all-same-digit CPFs (e.g., 111.111.111-11)
    if (/^(\d)\1{10}$/.test(digits)) return null;

    // Validate first check digit
    if (!Cpf.validateDigit(digits, 9)) return null;

    // Validate second check digit
    if (!Cpf.validateDigit(digits, 10)) return null;

    return new Cpf(digits);
  }

  /** @throws {InvalidCpfException} via domain exception */
  static parseOrThrow(raw: string): Cpf {
    const cpf = Cpf.parse(raw);
    if (!cpf) {
      // Lazy import to avoid circular — only used if thrown
      const { InvalidCpfException } = require('../exceptions/user.exceptions.js');
      throw new InvalidCpfException();
    }
    return cpf;
  }

  /**
   * Módulo 11 check-digit validation.
   * @param digits - The 11-digit CPF string
   * @param position - The position to validate (9 = first digit, 10 = second digit)
   */
  private static validateDigit(digits: string, position: number): boolean {
    const multiplier = position + 1; // 10 for pos=9, 11 for pos=10
    let sum = 0;

    for (let i = 0; i < position; i++) {
      sum += parseInt(digits[i], 10) * (multiplier - i);
    }

    const remainder = (sum * 10) % 11;
    const checkDigit = remainder === 10 || remainder === 11 ? 0 : remainder;

    return checkDigit === parseInt(digits[position], 10);
  }
}
