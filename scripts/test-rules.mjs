/**
 * EDX Digital - Runs tests that need the local Firebase emulators.
 *
 *   node scripts/test-rules.mjs                      the database rules (tests/rules)
 *   node scripts/test-rules.mjs tests/e2e/x.test.mjs any other test files, one at a time
 *
 * Starts the emulators, waits until they answer, runs the tests with this same Node and
 * shuts everything down. (The standalone Firebase CLI ships its own `node`, which cannot run
 * `node --test`, so `firebase emulators:exec "node --test ..."` is not reliable.)
 */

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

const PROJECT = 'demo-edx-digital';
const PORTS = [9099, 8080];
const windows = process.platform === 'win32';

function isOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

async function allOpen() {
  return (await Promise.all(PORTS.map(isOpen))).every(Boolean);
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  // the CLI starts Java underneath; the whole tree has to go
  if (windows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGINT');
}

let emulators = null;
if (await allOpen()) {
  console.log('Emuladores já estão no ar; usando os que estão rodando.');
} else {
  console.log('Subindo os emuladores do Firebase...');
  emulators = spawn('firebase', ['emulators:start', '--only', 'auth,firestore', '--project', PROJECT], { shell: true, stdio: 'ignore' });
  const deadline = Date.now() + 90000;
  while (!(await allOpen())) {
    if (emulators.exitCode !== null || Date.now() > deadline) {
      stop(emulators);
      console.error('Os emuladores não subiram. Confira se o Firebase CLI e o Java estão instalados.');
      process.exit(1);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

const given = process.argv.slice(2);
const files = given.length > 0 ? given : ['tests/rules/firestore-rules.test.mjs', 'tests/rules/lead-inbox.test.mjs'];
// files given by hand share accounts between their tests: they run in order
const tests = spawnSync(process.execPath, ['--test', ...(given.length > 0 ? ['--test-concurrency=1'] : []), ...files], { stdio: 'inherit' });
stop(emulators);
process.exit(tests.status === 0 ? 0 : 1);
