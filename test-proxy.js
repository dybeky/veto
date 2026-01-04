const net = require('net');

// Test SOCKS5 proxy connectivity
async function testProxy(host, port, username, password) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const hasAuth = !!(username && password);

    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ host, port, working: false, error: 'Timeout' });
    }, 5000);

    socket.connect(port, host, () => {
      // SOCKS5 handshake
      if (hasAuth) {
        socket.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
      } else {
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      }
    });

    let step = 0;
    socket.on('data', (data) => {
      if (step === 0) {
        if (data[0] === 0x05) {
          if (data[1] === 0x02 && hasAuth) {
            step = 1;
            const user = Buffer.from(username);
            const pass = Buffer.from(password);
            const authReq = Buffer.concat([
              Buffer.from([0x01, user.length]),
              user,
              Buffer.from([pass.length]),
              pass
            ]);
            socket.write(authReq);
          } else if (data[1] === 0x00) {
            clearTimeout(timeout);
            socket.destroy();
            resolve({ host, port, working: true });
          } else {
            clearTimeout(timeout);
            socket.destroy();
            resolve({ host, port, working: false, error: 'Auth method not supported' });
          }
        } else {
          clearTimeout(timeout);
          socket.destroy();
          resolve({ host, port, working: false, error: 'Not SOCKS5' });
        }
      } else if (step === 1) {
        clearTimeout(timeout);
        socket.destroy();
        if (data[0] === 0x01 && data[1] === 0x00) {
          resolve({ host, port, working: true });
        } else {
          resolve({ host, port, working: false, error: 'Auth failed' });
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      socket.destroy();
      resolve({ host, port, working: false, error: err.message });
    });
  });
}

async function main() {
  console.log('Testing proxies...\n');

  const proxies = [
    // Decodo
    { host: 'isp.decodo.com', port: 10001, user: 'DBmainlist', pass: 'vA1hO13Pvn_jl1mwTf' },
    { host: 'isp.decodo.com', port: 10002, user: 'DBmainlist', pass: 'vA1hO13Pvn_jl1mwTf' },
    { host: 'isp.decodo.com', port: 10003, user: 'DBmainlist', pass: 'vA1hO13Pvn_jl1mwTf' },
    // Public proxies
    { host: '45.140.143.77', port: 8080 },
    { host: '51.158.123.35', port: 8080 },
    { host: '138.201.125.229', port: 8118 },
    { host: '195.201.23.163', port: 1080 },
    { host: '95.216.164.27', port: 1080 },
    { host: '188.165.226.246', port: 1080 },
    { host: '163.172.168.221', port: 1080 },
    { host: '51.89.21.68', port: 1080 },
    { host: '198.55.125.130', port: 1080 },
    { host: '184.178.172.14', port: 4145 },
  ];

  for (const p of proxies) {
    const result = await testProxy(p.host, p.port, p.user, p.pass);
    const status = result.working ? '\x1b[32mOK\x1b[0m' : `\x1b[31mFAIL\x1b[0m (${result.error})`;
    console.log(`${p.host}:${p.port} - ${status}`);
  }
}

main();
