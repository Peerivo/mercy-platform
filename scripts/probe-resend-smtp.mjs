// JSON credentials arrive only on stdin. No MAIL/RCPT/DATA commands are sent.
import tls from 'node:tls';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

export async function probe({ password, port }, drivers = { tls, net }) {
  if (typeof password !== 'string' || !password || password.length > 1024 ||
      ![465, 587, 2465, 2587].includes(port)) return { status: 'invalid_input' };
  let socket;
  let pending;
  let buffer = '';
  let responseCode;
  let deadline;
  let failed;
  function abort(status) {
    failed = status;
    if (pending) { const current = pending; pending = undefined; current.reject(new Error(status)); }
    socket?.destroy();
  }
  function onData(data) {
    buffer += data.toString();
    if (buffer.length > 16384) return abort('protocol_error');
    while (buffer.includes('\r\n')) {
      const end = buffer.indexOf('\r\n');
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const match = /^(\d{3})([ -])/.exec(line);
      if (!match || !pending) return abort('protocol_error');
      if (responseCode && responseCode !== Number(match[1])) return abort('protocol_error');
      responseCode = Number(match[1]);
      if (match[2] === ' ') {
        const current = pending;
        pending = undefined;
        const code = responseCode;
        responseCode = undefined;
        current.resolve(code);
      }
    }
  }
  function attach(stream) {
    socket = stream;
    socket.on('data', onData);
    socket.on('error', (error) => {
      const code = String(error.code || '');
      const tlsFailure = /^(ERR_TLS_|ERR_SSL_|CERT_|DEPTH_ZERO_|SELF_SIGNED_|UNABLE_TO_(?:GET_ISSUER|VERIFY_LEAF))/.test(code);
      abort(tlsFailure ? 'tls_failed' : 'network_failed');
    });
    socket.on('end', () => { if (pending) abort('protocol_error'); });
  }
  function reply(command) {
    if (failed) return Promise.reject(new Error(failed));
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      if (command) socket.write(command + '\r\n');
    });
  }
  const options = { host: 'smtp.resend.com', port, servername: 'smtp.resend.com',
                    rejectUnauthorized: true, minVersion: 'TLSv1.2' };
  try {
    deadline = setTimeout(() => abort('timeout'), 20000);
    // Register the response waiter before connecting, avoiding a greeting race.
    const greeting = reply();
    const implicitTls = [465, 2465].includes(port);
    attach(
      implicitTls ? drivers.tls.connect(options) : drivers.net.connect({ host: options.host, port }),
      implicitTls ? 'tls_failed' : 'network_failed',
    );
    if (await greeting !== 220) throw new Error('protocol_error');
    if (await reply('EHLO mercy.peerivo.net') !== 250) throw new Error('protocol_error');
    if ([587, 2587].includes(port)) {
      if (await reply('STARTTLS') !== 220) throw new Error('tls_failed');
      socket.removeListener('data', onData);
      const secure = drivers.tls.connect({ ...options, socket });
      await new Promise((resolve, reject) => {
        secure.once('secureConnect', resolve);
        secure.once('error', () => reject(new Error('tls_failed')));
        secure.once('close', () => reject(new Error('tls_failed')));
      });
      attach(secure, 'tls_failed');
      if (await reply('EHLO mercy.peerivo.net') !== 250) throw new Error('protocol_error');
    }
    const auth = await reply('AUTH PLAIN ' + Buffer.from('\0resend\0' + password).toString('base64'));
    if (auth !== 235) return { status: 'authentication_rejected' };
    // Authentication checks transport and key, not sender authorization or delivery.
    await reply('QUIT');
    return { status: 'authenticated' };
  } catch (error) {
    const status = ['timeout', 'tls_failed', 'network_failed', 'protocol_error'].includes(error.message)
      ? error.message : 'protocol_error';
    return { status };
  } finally {
    clearTimeout(deadline);
    socket?.destroy();
  }
}

if (!process.argv[1] || import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  process.stdin.on('data', (chunk) => { input += chunk; if (input.length > 8192) process.exit(1); });
  process.stdin.on('end', async () => {
    try { console.log(JSON.stringify(await probe(JSON.parse(input)))); }
    catch { console.log(JSON.stringify({ status: 'invalid_input' })); }
  });
}
