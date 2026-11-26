const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { setup } = require('./helpers/env');

const env = setup();
const migrate = require('../main/migrate');
const old = path.join(env.root, 'Sugar Launcher');

test('migración desde «Sugar Launcher»: copia ajustes y mueve lo pesado, una sola vez', () => {
  assert.strictEqual(migrate.run(), null);
  fs.mkdirSync(path.join(old, 'instances', 'x'), { recursive: true });
  fs.writeFileSync(path.join(old, 'config.json'), '{"ram":3}');
  fs.writeFileSync(path.join(old, 'accounts.json'), '[]');
  const r = migrate.run();
  assert.deepStrictEqual(r.done, ['config.json', 'accounts.json', 'instances']);
  assert.ok(fs.existsSync(path.join(old, 'config.json')), 'queda respaldo');
  assert.ok(!fs.existsSync(path.join(old, 'instances')));
  assert.ok(fs.existsSync(path.join(env.data, 'instances', 'x')));
  assert.ok(fs.existsSync(path.join(env.data, '.migrated-from-sugar-launcher')));
  assert.strictEqual(migrate.run(), null);
});
