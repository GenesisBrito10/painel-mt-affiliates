import { IsString, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterPushSubscriptionDto {
  @ApiProperty({ description: 'Push subscription endpoint URL from browser PushManager' })
  @IsString()
  @IsUrl()
  endpoint!: string;

  @ApiProperty({ description: 'P-256 DH public key (base64url)' })
  @IsString()
  p256dh!: string;

  @ApiProperty({ description: 'Auth secret (base64url)' })
  @IsString()
  auth!: string;
}
