import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const modules = new Map()
function load(name) {
  const path = resolve(root, name + '.ts')
  if (modules.has(path)) return modules.get(path).exports
  const module = { exports: {} }
  modules.set(path, module)
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  new Function('require', 'module', 'exports', outputText)(load, module, module.exports)
  return module.exports
}
const { parkTime, daysBetween, summarizeOverview, inRecordScope, readRecordScope, scopeParams, todayInPark, daysEnding } = load('overviewAnalytics')
const { withDisplayCapture } = load('demoCapture')
const row = (id, captured_at, address = '东门', source = 'model') => ({
  id, image_id: 'image-' + id, batch_id: 'batch', filename: id + '.jpg', status: 'violation', source,
  updated_at: '2026-11-17T04:00:00Z',
  identity: { captured_at, address, name: '登记车主', person_id: '001' },
})

test('capture dates and hours use Beijing time, including timezone day boundaries', () => {
  assert.equal(parkTime('2026-11-17T17:30:00Z').day, '2026-11-18')
  assert.equal(parkTime('2026-11-17T17:30:00Z').hour, 1)
  assert.equal(parkTime('2026/11/17 00:00:00').hour, 0)
  assert.equal(parkTime('2026-02-30 12:00:00'), undefined)
  assert.equal(parkTime('2026-11-17 24:00:00'), undefined)
  assert.equal(parkTime('2026-11-17').hour, undefined)
})
test('date filters include both whole days and retain exact location/hour conditions', () => {
  const scope = { from: '2026-11-17', to: '2026-11-17', address: '东门', hour: 0 }
  const restored = readRecordScope(new URLSearchParams(scopeParams(scope)))
  assert.ok(inRecordScope(row('a', '2026-11-16T16:00:00Z', ' 东门 '), restored))
  assert.ok(!inRecordScope(row('b', '2026-11-17 01:00:00'), restored))
  assert.ok(!inRecordScope(row('c', '2026-11-17 00:00:00', '西门'), restored))
  assert.ok(inRecordScope(row('d', '2026-11-17 23:59:59'), { from: scope.from, to: scope.to }))
  assert.ok(!inRecordScope(row('e', undefined), { from: scope.from, to: scope.to }))
})
test('trend, hourly bars, location ranking and drilldown lists count the same events', () => {
  const rows = [row('a', '2026-11-17 00:00:00'), row('b', '2026-11-17 23:59:59', '西门', 'human'), row('c', '2026-11-16 11:30:00'), row('d', '2026-11-15 10:00:00')]
  const summary = summarizeOverview(rows, '2026-11-16', '2026-11-17')
  assert.equal(summary.selected.length, 3)
  assert.deepEqual(summary.model, [1, 1])
  assert.deepEqual(summary.human, [0, 1])
  assert.equal(summary.hourly.reduce((a, b) => a + b), 3)
  for (const [address, count] of summary.locations) {
    assert.equal(rows.filter(r => inRecordScope(r, { from: '2026-11-16', to: '2026-11-17', address })).length, count)
  }
  for (let hour = 0; hour < 24; hour++) {
    assert.equal(rows.filter(r => inRecordScope(r, { from: '2026-11-16', to: '2026-11-17', hour })).length, summary.hourly[hour])
  }
})
test('demo gaps are stable per image, preserve supplied fields and never mutate stored objects', () => {
  const original = row('a', undefined, '')
  const snapshot = structuredClone(original)
  const a = withDisplayCapture(original), b = withDisplayCapture({ ...original, id: 'second-vehicle' })
  assert.deepEqual(original, snapshot)
  assert.equal(a.identity.captured_at, b.identity.captured_at)
  assert.equal(a.identity.address, b.identity.address)
  assert.equal(a.identity.person_id, original.identity.person_id)
  assert.ok(daysEnding(todayInPark(), 7).includes(parkTime(a.identity.captured_at).day))
  const supplied = row('b', '2026-11-17 12:00:00', '原始地点')
  assert.equal(withDisplayCapture(supplied).identity.captured_at, supplied.identity.captured_at)
  assert.equal(withDisplayCapture(supplied).identity.address, '原始地点')
})
test('invalid and oversized date ranges do not construct charts', () => {
  assert.deepEqual(daysBetween('2026-11-18', '2026-11-17'), [])
  assert.deepEqual(daysBetween('2025-01-01', '2026-11-17'), [])
  assert.equal(daysBetween('2026-11-17', '2026-11-17').length, 1)
})
