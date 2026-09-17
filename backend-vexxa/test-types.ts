import { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie';

function test(req: FastifyRequest, reply: FastifyReply) {
  const c = req.cookies;
  reply.setCookie('foo', 'bar');
}
