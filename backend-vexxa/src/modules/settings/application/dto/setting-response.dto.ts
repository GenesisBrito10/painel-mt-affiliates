import { ApiProperty } from '@nestjs/swagger';

// ─── Response DTO ─────────────────────────────────────────────────────────────

export class SettingResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() value!: string;
  @ApiProperty() label!: string;
  @ApiProperty() updatedAt!: Date;
}
