import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probe } from '../scripts/probe-resend-smtp.mjs';

function fixture(authCode = 235, startTlsCode = 220) {
  const commands = [];
  const connections = [];
  function stream(options, secure) {
    const socket = new EventEmitter();
    socket.destroy = () => {};
    socket.write = (command) => {
      commands.push(command);
      let reply = command.startsWith('EHLO') ? '250-test\r\n250 AUTH PLAIN\r\n'
        : command.startsWith('STARTTLS') ? `${startTlsCode} ready\r\n`
        : command.startsWith('AUTH') ? `${authCode} result\r\n` : '221 bye\r\n';
      // Exercise fragmented TCP/multiline responses.
      process.nextTick(() => { socket.emit('data', reply.slice(0, 4)); socket.emit('data', reply.slice(4)); });
    };
    connections.push({ options, secure });
    process.nextTick(() => options.socket ? socket.emit('secureConnect') : socket.emit('data', '220 greeting\r\n'));
    return socket;
  }
  return { commands, connections, drivers: { tls: { connect: (o) => stream(o, true) }, net: { connect: (o) => stream(o, false) } } };
}

test('implicit TLS authenticates without sending mail', async () => {
  const f = fixture();
  assert.deepEqual(await probe({ password: 'dummy-key', port: 465 }, f.drivers), { status: 'authenticated' });
  assert.equal(f.connections[0].options.rejectUnauthorized, true);
  assert.equal(f.connections[0].options.servername, 'smtp.resend.com');
  assert.deepEqual(f.commands.map(x => x.split(' ')[0].trim()), ['EHLO', 'AUTH', 'QUIT']);
  assert.equal(f.commands.some(x => /^(MAIL|RCPT|DATA)/.test(x)), false);
});

test('STARTTLS must succeed before credentials are sent', async () => {
  const f = fixture();
  assert.deepEqual(await probe({ password: 'dummy-key', port: 587 }, f.drivers), { status: 'authenticated' });
  assert.deepEqual(f.commands.map(x => x.split(' ')[0].trim()), ['EHLO', 'STARTTLS', 'EHLO', 'AUTH', 'QUIT']);
  assert.equal(f.connections[1].options.rejectUnauthorized, true);
  const rejected = fixture(235, 454);
  assert.deepEqual(await probe({ password: 'dummy-key', port: 587 }, rejected.drivers), { status: 'tls_failed' });
  assert.equal(rejected.commands.some(x => x.startsWith('AUTH')), false);
});

test('SMTP rejection is a failure, never a delivery success', async () => {
  const f = fixture(535);
  assert.deepEqual(await probe({ password: 'dummy-key', port: 465 }, f.drivers), { status: 'authentication_rejected' });
});

test('malformed configuration cannot connect', async () => {
  for (const config of [{ password: '', port: 465 }, { password: true, port: 465 },
    { password: 'key', port: '465' }, { password: 'key', port: 25 }, { password: 'x'.repeat(1025), port: 465 }]) {
    const f = fixture();
    assert.deepEqual(await probe(config, f.drivers), { status: 'invalid_input' });
    assert.equal(f.connections.length, 0);
  }
});
