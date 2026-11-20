import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

test("unit guard refuses live inference and external TCP while allowing a disposable loopback server", async () => {
  const script = `
    const net = require('node:net');
    for (const options of [{host:'127.0.0.1',port:11434},{host:'127.0.0.1',port:8788},{host:'api.openai.com',port:443}]) {
      try { net.connect(options); process.exit(2); }
      catch (error) { if(error.code !== 'UNIT_TEST_LIVE_NETWORK_BLOCKED') throw error; }
    }
    const server=net.createServer(socket=>socket.end());
    server.listen(0,'127.0.0.1',()=> {
      const client=net.connect({host:'127.0.0.1',port:server.address().port});
      client.on('end',()=>server.close(()=>console.log('TEMPORARY_NETWORK_ONLY')));
    });`;
  const { stdout } = await promisify(execFile)(process.execPath, ["--require", "./test/unit-network-guard.cjs", "-e", script], {
    timeout: 10_000, env: { PATH: process.env.PATH, LANG: "C" },
  });
  assert.equal(stdout.trim(), "TEMPORARY_NETWORK_ONLY");
});
