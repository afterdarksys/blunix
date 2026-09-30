import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildNode, shareableRecipe, PACKAGES } from '../../portal/lib.js';
const key = 'ssh-ed25519 ' + Buffer.concat([Buffer.from('0000000b7373682d6564323535313900000020','hex'), Buffer.alloc(32, 7)]).toString('base64');
const input = { label: 'myhost', hostname: 'myhost', disk: 'cloud-vm', access: 'regular', packages: ['git','curl'], target: 'disk-serial', install: { erase: true, reboot: false }, admin: { name: 'operator', sshPublicKey: key }, network: { mode: 'dhcp', match: 'en*, eth*' } };
test('composer emits a complete personal installation document', () => {
  const result = buildNode(input);
  assert.equal(result.errors, undefined);
  assert.match(result.yaml, /erase: true/);
  assert.match(result.yaml, /packages: \["git","curl"\]/);
  assert.match(result.yaml, /sshPublicKey:/);
});
test('requires an exact target, erase consent and valid admin key before publishing', () => {
  for (const change of [{ target: '' }, { install: { erase: false, reboot: false } }, { admin: { name: 'root', sshPublicKey: key } }, { admin: { name: 'operator', sshPublicKey: 'PRIVATE KEY' } }, { packages: ['curl;whoami'] }, { disk: 'metal-luks' }]) {
    assert.ok(buildNode({ ...input, ...change }).errors);
  }
});
test('sharing projects only reusable choices, excluding personal fields', () => {
  assert.deepEqual(shareableRecipe({ ...input, password: 'never share', network: { address: '10.1.2.3/24' } }), { access: 'regular', packages: ['curl','git'] });
  assert.throws(() => shareableRecipe({ access: 'regular', packages: ['evil'] }));
});
test('package catalogs agree across browser, backend, and installer', () => {
  const backend = readFileSync(new URL('../../platform/api/src/configurations.ts', import.meta.url), 'utf8');
  const python = readFileSync(new URL('../../lib/blunix/personal.py', import.meta.url), 'utf8');
  for (const p of PACKAGES) { assert.ok(backend.includes('"' + p + '"')); assert.ok(python.includes('"' + p + '"')); }
});
test('browser document passes the actual Python schema', () => {
  const r = spawnSync('python3', ['-c', 'import sys; from blunix.node import check_node; check_node(sys.stdin.buffer.read(), "models")'], { cwd: new URL('../../', import.meta.url), input: buildNode(input).yaml, env: { ...process.env, PYTHONPATH: 'lib' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
