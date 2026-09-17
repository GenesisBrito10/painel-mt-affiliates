import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class NetworkTreeQueryDto {
  /** Optional bettingHouse slug — filters tree to members with a link in that house */
  @IsOptional()
  @IsString()
  house?: string;

  /** Search by name or email (case-insensitive, partial match) */
  @IsOptional()
  @IsString()
  search?: string;

  /** Filter by member status */
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  /**
   * Limita a árvore aos membros até este nível (inclusive). Ex.: maxLevel=1 →
   * só convidados diretos (a aba "Árvore da rede" usa 1, pois o convidante só
   * aprova nível 1). Afeta total/summary/paginação de forma consistente.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxLevel?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  limit?: number = 20;
}

export class ReferralsQueryDto {
  /** Optional bettingHouse slug filter */
  @IsOptional()
  @IsString()
  house?: string;

  /**
   * Limita os convidados até este nível (inclusive). Ausente = todos os níveis
   * (BFS até a profundidade máxima). Ex.: maxLevel=1 → só convidados diretos.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxLevel?: number;
}
