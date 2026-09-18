import { afterEach, describe, expect, it, vi } from 'vitest';
import { MailService } from './mail.service.js';

describe('MailService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends text and html content to Resend', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('{"id":"email-001"}'),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', 'MT Affiliates <suporte@mtafiliates.com.br>');

    await new MailService().send({
      to: 'afiliado@vexxa.test',
      bcc: 'monitor@vexxa.test',
      subject: 'Teste',
      text: 'Conteudo em texto',
      html: '<p>Conteudo em HTML</p>',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer re_test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'MT Affiliates <suporte@mtafiliates.com.br>',
          to: 'afiliado@vexxa.test',
          bcc: 'monitor@vexxa.test',
          subject: 'Teste',
          text: 'Conteudo em texto',
          html: '<p>Conteudo em HTML</p>',
        }),
      }),
    );
  });
});
