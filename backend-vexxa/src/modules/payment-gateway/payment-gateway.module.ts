import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentGatewayService } from './application/payment-gateway.service.js';
import { VorexyHttpClient } from './infrastructure/vorexy-http.client.js';
import { HeartPayHttpClient } from './infrastructure/heartpay-http.client.js';

@Module({
  imports: [ConfigModule],
  providers: [VorexyHttpClient, HeartPayHttpClient, PaymentGatewayService],
  exports: [PaymentGatewayService],
})
export class PaymentGatewayModule {}
