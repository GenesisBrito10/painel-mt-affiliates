import { randomBytes } from 'crypto';

// Value Object — imutável, validação na construção, igualdade por valor.
export class ReferralCode {
  private constructor(public readonly value: string) {}

  static generate(): ReferralCode {
    return new ReferralCode(randomBytes(4).toString('hex').toUpperCase());
  }

  static from(raw: string): ReferralCode {
    if (!raw || raw.trim().length < 6) {
      throw new Error('ReferralCode must be at least 6 characters');
    }
    return new ReferralCode(raw.toUpperCase());
  }

  equals(other: ReferralCode): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
