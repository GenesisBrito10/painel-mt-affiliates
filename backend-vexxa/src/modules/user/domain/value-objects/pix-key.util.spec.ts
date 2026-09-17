import { describe, it, expect } from 'vitest';
import {
  normalizePixKeyType,
  normalizePixKey,
  validatePixKey,
} from './pix-key.util.js';

describe('pix-key.util', () => {
  describe('normalizePixKeyType', () => {
    it('aceita canônicos', () => {
      for (const t of ['cpf', 'cnpj', 'email', 'phone', 'random']) {
        expect(normalizePixKeyType(t)).toBe(t);
      }
    });
    it('lowercase + trim', () => {
      expect(normalizePixKeyType(' CPF ')).toBe('cpf');
      expect(normalizePixKeyType('Email')).toBe('email');
    });
    it('aliases', () => {
      expect(normalizePixKeyType('EVP')).toBe('random');
      expect(normalizePixKeyType('aleatoria')).toBe('random');
      expect(normalizePixKeyType('telefone')).toBe('phone');
      expect(normalizePixKeyType('celular')).toBe('phone');
    });
    it('inválidos → null', () => {
      expect(normalizePixKeyType('')).toBeNull();
      expect(normalizePixKeyType('foo')).toBeNull();
    });
  });

  describe('validatePixKey — CPF', () => {
    it('formatado com pontos passa e normaliza', () => {
      const r = validatePixKey('cpf', '123.456.789-09');
      expect(r.ok).toBe(true);
      expect(r.normalized).toBe('12345678909');
    });
    it('CNPJ enviado como CPF é REJEITADO', () => {
      const r = validatePixKey('cpf', '12.345.678/0001-90');
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/CPF/);
    });
    it('menos de 11 dígitos rejeita', () => {
      expect(validatePixKey('cpf', '12345').ok).toBe(false);
    });
  });

  describe('validatePixKey — CNPJ', () => {
    it('14 dígitos passa', () => {
      const r = validatePixKey('cnpj', '12.345.678/0001-90');
      expect(r.ok).toBe(true);
      expect(r.normalized).toBe('12345678000190');
    });
    it('CPF enviado como CNPJ rejeita', () => {
      expect(validatePixKey('cnpj', '12345678909').ok).toBe(false);
    });
  });

  describe('validatePixKey — email', () => {
    it('e-mail válido passa e lower', () => {
      const r = validatePixKey('email', 'Foo@Bar.COM');
      expect(r.ok).toBe(true);
      expect(r.normalized).toBe('foo@bar.com');
    });
    it('sem @ rejeita', () => {
      expect(validatePixKey('email', 'foo.bar').ok).toBe(false);
    });
  });

  describe('validatePixKey — phone', () => {
    it('11 dígitos BR sem DDI normaliza p/ +55', () => {
      const r = validatePixKey('phone', '(11) 99999-9999');
      expect(r.ok).toBe(true);
      expect(r.normalized).toBe('+5511999999999');
    });
    it('com +55 mantém', () => {
      expect(validatePixKey('phone', '+5511999999999').normalized).toBe(
        '+5511999999999',
      );
    });
    it('curto rejeita', () => {
      expect(validatePixKey('phone', '1234').ok).toBe(false);
    });
  });

  describe('validatePixKey — random/EVP', () => {
    it('UUID passa', () => {
      const r = validatePixKey(
        'random',
        '123e4567-e89b-12d3-a456-426614174000',
      );
      expect(r.ok).toBe(true);
    });
    it('alias EVP no tipo passa', () => {
      expect(
        validatePixKey('EVP', '123e4567-e89b-12d3-a456-426614174000').ok,
      ).toBe(true);
    });
    it('string qualquer rejeita', () => {
      expect(validatePixKey('random', 'abc').ok).toBe(false);
    });
  });

  describe('tipo inválido', () => {
    it('rejeita com mensagem clara', () => {
      const r = validatePixKey('foo', '12345678909');
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/Tipo de chave PIX inválido/);
    });
  });

  describe('normalizePixKey direto', () => {
    it('cpf strip', () => {
      expect(normalizePixKey('cpf', '123.456.789-09')).toBe('12345678909');
    });
    it('phone BR adiciona +55', () => {
      expect(normalizePixKey('phone', '11999999999')).toBe('+5511999999999');
    });
  });
});
