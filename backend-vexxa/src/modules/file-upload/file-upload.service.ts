import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const;

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export interface UploadObjectResult {
  url: string;
  key: string;
  mimeType: string;
  size: number;
  name: string;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

@Injectable()
export class FileUploadService {
  private clientCache: {
    client: S3Client;
    bucket: string;
    publicUrlBase: string;
  } | null = null;

  constructor(private readonly config: ConfigService) {}

  get publicUrlPrefix(): string {
    return this.resolveClient().publicUrlBase;
  }

  private resolveClient(): {
    client: S3Client;
    bucket: string;
    publicUrlBase: string;
  } {
    if (this.clientCache) return this.clientCache;
    const accountId = this.required('R2_ACCOUNT_ID');
    const accessKeyId = this.required('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.required('R2_SECRET_ACCESS_KEY');
    const bucket = this.required('R2_BUCKET');
    const publicUrlBase = this.required('R2_PUBLIC_URL').replace(/\/+$/, '');
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    this.clientCache = { client, bucket, publicUrlBase };
    return this.clientCache;
  }

  async uploadObject(params: {
    buffer: Buffer;
    mimeType: string;
    scopePrefix: string;
    filename: string;
  }): Promise<UploadObjectResult> {
    const { buffer, mimeType, scopePrefix, filename } = params;
    const size = buffer.byteLength;

    if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(mimeType as never)) {
      throw new BadRequestException(
        `Tipo de arquivo não suportado. Permitidos: ${ALLOWED_ATTACHMENT_MIME_TYPES.join(', ')}.`,
      );
    }
    if (size < 1) {
      throw new BadRequestException('Arquivo vazio.');
    }
    if (size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `Arquivo excede o limite de ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB.`,
      );
    }

    const { client, bucket, publicUrlBase } = this.resolveClient();
    const extension =
      EXTENSION_BY_MIME[mimeType] ?? this.safeExtension(filename);
    const key = `${this.normalizePrefix(scopePrefix)}/${randomUUID()}.${extension}`;

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
          ContentLength: size,
        }),
      );
      return {
        url: `${publicUrlBase}/${key}`,
        key,
        mimeType,
        size,
        name: filename,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `Falha ao enviar arquivo para R2: ${(error as Error).message}`,
      );
    }
  }

  private required(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new InternalServerErrorException(
        `Variável de ambiente ${key} não configurada.`,
      );
    }
    return value;
  }

  private normalizePrefix(prefix: string): string {
    return prefix.replace(/^\/+|\/+$/g, '').replace(/\.\.+/g, '');
  }

  private safeExtension(filename: string): string {
    const match = /\.([a-zA-Z0-9]{1,8})$/.exec(filename);
    return match ? match[1].toLowerCase() : 'bin';
  }

  async *listObjects(
    prefix: string,
  ): AsyncGenerator<{ key: string; lastModified: Date | null; size: number }> {
    const { client, bucket } = this.resolveClient();
    const normalized = this.normalizePrefix(prefix);
    let continuationToken: string | undefined;
    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: `${normalized}/`,
          ContinuationToken: continuationToken,
        }),
      );
      for (const entry of response.Contents ?? []) {
        if (!entry.Key) continue;
        yield {
          key: entry.Key,
          lastModified: entry.LastModified ?? null,
          size: entry.Size ?? 0,
        };
      }
      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const { client, bucket } = this.resolveClient();
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }

  buildPublicUrl(key: string): string {
    return `${this.resolveClient().publicUrlBase}/${key}`;
  }
}
