const net = require('net');

// Test if we can reach Discord through SOCKS5 proxy
async function testDiscordViaProxy() {
  const proxy = {
    host: 'isp.decodo.com',
    port: 10001,
    username: 'DBmainlist',
    password: 'vA1hO13Pvn_jl1mwTf'
  };

  const discordHost = 'discord.com';
  const discordPort = 443;

  console.log(`Testing connection to ${discordHost}:${discordPort} via ${proxy.host}:${proxy.port}...\n`);

  return new Promise((resolve) => {
    const socket = new net.Socket();

    const timeout = setTimeout(() => {
      console.log('\x1b[31mTIMEOUT: Connection took too long\x1b[0m');
      socket.destroy();
      resolve(false);
    }, 15000);

    socket.connect(proxy.port, proxy.host, () => {
      console.log('[1/5] Connected to proxy server');
      // SOCKS5 handshake with auth
      socket.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
    });

    let step = 0;
    socket.on('data', (data) => {
      if (step === 0) {
        if (data[0] === 0x05 && data[1] === 0x02) {
          console.log('[2/5] Proxy requires authentication, sending credentials...');
          step = 1;
          const user = Buffer.from(proxy.username);
          const pass = Buffer.from(proxy.password);
          const authReq = Buffer.concat([
            Buffer.from([0x01, user.length]),
            user,
            Buffer.from([pass.length]),
            pass
          ]);
          socket.write(authReq);
        } else if (data[0] === 0x05 && data[1] === 0x00) {
          console.log('[2/5] No auth required');
          step = 2;
          sendConnectRequest();
        } else {
          console.log('\x1b[31mProxy rejected auth methods\x1b[0m');
          clearTimeout(timeout);
          socket.destroy();
          resolve(false);
        }
      } else if (step === 1) {
        if (data[0] === 0x01 && data[1] === 0x00) {
          console.log('[3/5] Authentication successful');
          step = 2;
          sendConnectRequest();
        } else {
          console.log('\x1b[31mAuthentication FAILED\x1b[0m');
          clearTimeout(timeout);
          socket.destroy();
          resolve(false);
        }
      } else if (step === 2) {
        if (data[0] === 0x05 && data[1] === 0x00) {
          console.log('[4/5] CONNECT request successful - tunnel established!');
          console.log('[5/5] Sending HTTPS request to Discord...');

          // Send a simple HTTPS handshake (TLS Client Hello placeholder)
          // Actually let's just test if we can write/read
          socket.write('GET / HTTP/1.1\r\nHost: discord.com\r\n\r\n');
          step = 3;
        } else {
          const errors = {
            0x01: 'General failure',
            0x02: 'Connection not allowed',
            0x03: 'Network unreachable',
            0x04: 'Host unreachable',
            0x05: 'Connection refused',
            0x06: 'TTL expired',
            0x07: 'Command not supported',
            0x08: 'Address type not supported'
          };
          console.log(`\x1b[31mCONNECT failed: ${errors[data[1]] || 'Unknown error'}\x1b[0m`);
          clearTimeout(timeout);
          socket.destroy();
          resolve(false);
        }
      } else if (step === 3) {
        clearTimeout(timeout);
        console.log('\n\x1b[32mSUCCESS! Received response from Discord:\x1b[0m');
        console.log(data.toString().substring(0, 200) + '...');
        socket.destroy();
        resolve(true);
      }
    });

    function sendConnectRequest() {
      const hostBuf = Buffer.from(discordHost);
      const request = Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
        hostBuf,
        Buffer.from([discordPort >> 8, discordPort & 0xff])
      ]);
      console.log(`[3/5] Sending CONNECT request to ${discordHost}:${discordPort}...`);
      socket.write(request);
    }

    socket.on('error', (err) => {
      clearTimeout(timeout);
      console.log(`\x1b[31mError: ${err.message}\x1b[0m`);
      resolve(false);
    });
  });
}

testDiscordViaProxy().then(success => {
  console.log('\n' + '='.repeat(50));
  if (success) {
    console.log('\x1b[32mProxy can reach Discord successfully!\x1b[0m');
  } else {
    console.log('\x1b[31mProxy CANNOT reach Discord - try different proxy\x1b[0m');
  }
});
