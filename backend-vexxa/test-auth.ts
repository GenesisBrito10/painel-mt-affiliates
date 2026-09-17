import type { FastifyRequest, FastifyReply } from 'fastify';
import type { CookieSerializeOptions } from '@fastify/cookie';

const COOKIE_OPTIONS: CookieSerializeOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: 3600, // seconds
};

function test(req: FastifyRequest, reply: FastifyReply) {
  const c = req.cookies?.['foo'];
  reply.setCookie('foo', 'bar', COOKIE_OPTIONS);
}
