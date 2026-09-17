import { Injectable, Logger } from '@nestjs/common';

export interface SendMailInput {
  to: string;
  bcc?: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async send(input: SendMailInput): Promise<void> {
    const apiKey = process.env['RESEND_API_KEY'];
    const from = process.env['RESEND_FROM'];

    if (!apiKey || !from) {
      this.logger.warn(
        `Resend not configured. Skipping email "${input.subject}" to ${input.to}.`,
      );
      return;
    }

    const payload: Record<string, unknown> = {
      from,
      to: input.to,
    };

    if (input.bcc) payload['bcc'] = input.bcc;
    payload['subject'] = input.subject;
    payload['text'] = input.text;
    if (input.html) payload['html'] = input.html;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Resend email failed with ${response.status}: ${body || response.statusText}`,
      );
    }
  }

  async sendMail(input: SendMailInput): Promise<void> {
    return this.send(input);
  }
}
