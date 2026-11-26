const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { setup } = require('./helpers/env');

setup();
const instances = require('../main/instances');
const logo = require('../main/animated-logo');

test('sincronizar la intro solo escribe instance.json cuando algo cambia', async () => {
  instances.create({ name: 'q', version: '1.8.9', loader: 'vanilla' });
  const file = path.join(instances.dirOf('q'), 'instance.json');
  await logo.sync('q');
  const first = fs.readFileSync(file, 'utf8');
  assert.deepStrictEqual(JSON.parse(first).logoState, { files: [], on: false, removed: false, note: 'no-build' });
  const inode = fs.statSync(file).ino;
  await logo.sync('q');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), first);
  assert.strictEqual(fs.statSync(file).ino, inode, 'no se reescribió');
  logo.setOverride('q', false);
  await logo.sync('q');
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).logo, false);
});
