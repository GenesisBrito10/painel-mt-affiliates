import {
  registerDecorator,
  type ValidationOptions,
  type ValidationArguments,
} from 'class-validator';
import { validatePixKey } from './pix-key.util.js';

/**
 * Valida a chave PIX (`pixKey`) contra o campo irmão de tipo (default `pixKeyType`).
 * Uso (em DTO):
 *   @IsValidPixKey('pixKeyType')
 *   pixKey?: string;
 *
 * Quando `pixKey` ou `pixKeyType` estiverem ausentes/vazios, NÃO valida — deixa
 * isso para `@IsOptional()`/`@IsNotEmpty()`. Só roda quando ambos vieram.
 */
export function IsValidPixKey(
  typeField = 'pixKeyType',
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidPixKey',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [typeField],
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (value === undefined || value === null || value === '')
            return true;
          const rawType = (args.object as Record<string, unknown>)[
            args.constraints[0]
          ];
          if (rawType === undefined || rawType === null || rawType === '') {
            return true;
          }
          return validatePixKey(rawType, value).ok;
        },
        defaultMessage(args: ValidationArguments): string {
          const rawType = (args.object as Record<string, unknown>)[
            args.constraints[0]
          ];
          const r = validatePixKey(rawType, args.value);
          return r.message ?? 'Chave PIX inválida.';
        },
      },
    });
  };
}
