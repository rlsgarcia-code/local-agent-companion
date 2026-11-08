// Explicit read-only smoke of the Mac service profile. Does not install or launch the GUI.
const { createHash, randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const root = process.cwd();
const argument = (name) => process.argv.find(value => value.startsWith(name + '='))?.slice(name.length + 1);
const model = argument('--ollama-model');
if (!model || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model))
  throw new Error('Pass the exact configured local model with --ollama-model=<name>.');
const selectedBundle = argument('--bundle-dir');
const bundle = path.resolve(selectedBundle || 'engine-dist');
const sdk = path.resolve(argument('--sdk-dir') || 'release/sdk');
const { AgentClient } = require(path.join(sdk, 'typescript/client-ts/src/index.cjs'));
const { verifyBundle } = require(path.join(sdk, 'typescript/client-ts/src/bootstrap.cjs'));
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await verifyBundle(bundle, selectedBundle ? await readFile(path.join(root, 'release-keys/companion-ed25519.pub'), 'utf8') : undefined, !selectedBundle);
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-mac-acceptance-'));
  const workspace = path.join(directory, 'empty-workspace');
  await mkdir(workspace, { mode: 0o700 });
  const id = createHash('sha256').update(directory).digest('hex');
  const credential = { registration: { id, product: 'companion-mac', profile: 'read-only-mac-smoke', workspace, providers: ['ollama'], hostTools: [] }, token: randomBytes(32).toString('base64url') };
  await mkdir(path.join(directory, 'clients'), { mode: 0o700 });
  await writeFile(path.join(directory, 'clients', id + '.json'), JSON.stringify(credential), { mode: 0o600 });
  const hash = createHash('sha256').update(path.resolve(directory)).digest('hex').slice(0, 24);
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\companion-${hash}` : path.join(directory.length < 65 ? directory : path.join(tmpdir(), `companion-${process.getuid()}-${hash}`), 'agent.sock');
  let child, stopped, client;
  const start = () => {
    child = spawn(path.join(bundle, process.platform === 'win32' ? 'node.exe' : 'node'), [path.join(bundle, 'service.cjs'), directory], { stdio: 'ignore', windowsHide: true });
    stopped = new Promise(resolve => child.once('exit', resolve));
  };
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    try { await stopped; } finally { clearTimeout(timer); }
  };
  const connect = async () => {
    for (let i = 0; i < 100; i++) {
      try {
        const connected = new AgentClient({ address, certificate: await readFile(path.join(directory, 'server.crt'), 'utf8'), credential });
        await connected.connect(); return connected;
      } catch (error) { if (i === 99 || child.exitCode !== null) throw error; await pause(100); }
    }
  };
  try {
    start(); client = await connect();
    const engine = await client.call('engine.info'), results = [];
    for (const agentRuntime of ['standard', 'deep']) for (const recovery of ['client-disconnect-and-reattach', 'service-restart-and-explicit-resume']) {
      const session = await client.call('sessions.create', { title: `Mac ${agentRuntime} read-only recovery` });
      const messageId = `${agentRuntime}-${recovery}-assistant`;
      const spec = { thread: { id: `${agentRuntime}-thread`, title: 'Read-only test', messages: [], createdAt: Date.now(), updatedAt: Date.now() },
        request: 'Qual é o resultado de 2 + 2? Responda somente 4. Não use ferramentas nem leia arquivos.', workspacePath: workspace,
        modelRoles: { executor: model }, dockerSandboxEnabled: false, mode: 'plan', agentRuntime,
        assistantMessageId: messageId, userMessageId: `${agentRuntime}-user`, contextPages: [] };
      const run = await client.startRun(session.id, messageId, spec, 'desktop');
      client.close();
      if (recovery === 'service-restart-and-explicit-resume') { await stop(); start(); }
      client = await connect();
      const recovered = await client.call('runs.get', { id: run.id });
      if (recovered.state === 'awaiting_host' || recovered.state === 'awaiting_credentials') await client.call('runs.resume', { id: run.id });
      const final = await client.waitForRun(run.id, session.id, () => {}, undefined, AbortSignal.timeout(240_000));
      const message = final.result?.message;
      if (final.state !== 'completed' || message?.id !== messageId || message?.status !== 'complete' || message?.text?.trim() !== '4')
        throw new Error(`Mac profile did not satisfy the read-only check: ${JSON.stringify({ state: final.state, error: final.error, message })}`);
      const snapshot = await client.snapshotSession(session.id);
      const history = snapshot.domain;
      if (history.messages.filter(row => row.role === 'user').length !== 1 || history.messages.filter(row => row.role === 'assistant').length !== 1)
        throw new Error('Recovery duplicated public conversation history.');
      results.push({ runtime: agentRuntime, recovery, state: final.state, response: message.text.trim(), publicMessages: history.messages.length });
    }
    console.log(JSON.stringify({ version: engine.version, node: engine.node, build: engine.build, profile: 'desktop-service-not-gui', model, results }));
  } finally { client?.close(); await stop(); await rm(directory, { recursive: true, force: true }); if (process.platform !== 'win32' && path.dirname(address) !== directory) await rm(path.dirname(address), { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
