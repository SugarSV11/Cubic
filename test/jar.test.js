// Lectura del identificador de un mod dentro de su jar
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { modIdOf } = require('../main/animated-logo-core');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubic-jar-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
function jar(name, entries, { comment, stored } = {}) {
  const zip = new AdmZip();
  for (const [n, body] of Object.entries(entries)) {
    zip.addFile(n, Buffer.from(body));
    if (stored) zip.getEntry(n).header.method = 0;
  }
  if (comment) zip.addZipComment(comment);
  const file = path.join(dir, name);
  zip.writeZip(file);
  return file;
}
const meta = id => JSON.stringify({ schemaVersion: 1, id, version: '1' });
const filler = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`com/x/Clase${i}.class`, 'x'.repeat(500)]));

test('encuentra el id en jars normales, grandes, sin comprimir y con comentario', () => {
  assert.strictEqual(modIdOf(jar('a.jar', { 'fabric.mod.json': meta('uno') })), 'uno');
  assert.strictEqual(modIdOf(jar('b.jar', { ...filler, 'fabric.mod.json': meta('dos') })), 'dos');
  assert.strictEqual(modIdOf(jar('c.jar', { 'fabric.mod.json': meta('tres') }, { stored: true })), 'tres');
  assert.strictEqual(modIdOf(jar('d.jar', { 'fabric.mod.json': meta('cuatro') }, { comment: 'x'.repeat(2000) })), 'cuatro');
  assert.strictEqual(modIdOf(jar('e.jar', { 'fabric.mod.json': '{"id":"cinco","description":"dos\nlíneas"}' })), 'cinco');
});

test('devuelve null si no es un mod de Fabric o el archivo está roto', () => {
  assert.strictEqual(modIdOf(jar('f.jar', { 'otro.txt': 'x' })), null);
  assert.strictEqual(modIdOf(jar('g.jar', { 'dentro/fabric.mod.json': meta('no') })), null);
  assert.strictEqual(modIdOf(jar('h.jar', { 'fabric.mod.json': '{roto' })), null);
  const bad = path.join(dir, 'i.jar');
  fs.writeFileSync(bad, 'esto no es un zip');
  assert.strictEqual(modIdOf(bad), null);
  fs.writeFileSync(bad, '');
  assert.strictEqual(modIdOf(bad), null);
  assert.strictEqual(modIdOf(path.join(dir, 'no-existe.jar')), null);
});
