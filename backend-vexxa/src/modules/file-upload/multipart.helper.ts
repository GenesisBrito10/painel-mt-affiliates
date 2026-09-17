import { BadRequestException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export interface MultipartFile {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export async function readMultipartFile(
  req: FastifyRequest,
): Promise<MultipartFile> {
  if (typeof (req as unknown as { file?: () => unknown }).file !== 'function') {
    throw new BadRequestException('Requisição multipart inválida.');
  }
  const part = await (
    req as unknown as {
      file: () => Promise<
        | {
            filename?: string;
            mimetype?: string;
            toBuffer: () => Promise<Buffer>;
          }
        | undefined
      >;
    }
  ).file();
  if (!part) throw new BadRequestException('Nenhum arquivo enviado.');
  const buffer = await part.toBuffer();
  return {
    buffer,
    mimeType: part.mimetype ?? 'application/octet-stream',
    filename: part.filename ?? 'arquivo',
  };
}
