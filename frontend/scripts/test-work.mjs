import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const cache = new Map()
function load(name) {
  const path = resolve(root, name + '.ts')
  if (cache.has(path)) return cache.get(path).exports
  const module = { exports: {} }
  cache.set(path, module)
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  new Function('require', 'module', 'exports', outputText)(load, module, module.exports)
  return module.exports
}
const { imageQueue, taskRows, initialQueue, filterTasks, taskRuns, normalizeTask, taskTime, taskProgress } = load('workTasks')
const image = (id, status = 'pending', extra = {}) => ({ id, batch_id: 'upload-a', filename: id + '.jpg', status, queued: 0, events: [], ...extra })
const event = (id, status, eligible = true) => ({ id, status, review_eligible: eligible, image_id: 'photo', filename: 'photo.jpg' })

test('five queues span all uploads, while queued photos remain in processing', () => {
  const images = [image('a'), image('b', 'pending', { queued: 1 }), image('c', 'running', { batch_id: 'upload-b' }), image('d', 'error'), image('e', 'done')]
  assert.deepEqual(images.map(imageQueue), ['pending', 'processing', 'processing', 'error', 'done'])
  assert.deepEqual(taskRows(images, 'processing').map(row => row.id), ['b', 'c'])
  assert.equal(initialQueue(images), 'pending')
  assert.equal(initialQueue([image('e', 'done')]), 'done')
})
test('the preserved progress bar uses actual processed photos, including photos awaiting review', () => {
  const images = [image('a'), image('b', 'pending', { queued: 1 }), image('c', 'running'), image('d', 'error'), image('e', 'done'), image('f', 'done', { events: [event('review', 'review')] })]
  const progress = taskProgress(images)
  assert.deepEqual(progress, { total: 6, done: 2, failed: 1, running: 1, queued: 1, pending: 1, handled: 3, percent: 50 })
  assert.equal(taskProgress([]).percent, 0)
  assert.equal(taskProgress([image('done', 'done')]).percent, 100)
})
test('review queue counts eligible events and completes the photo only after all reviews resolve', () => {
  const photo = image('p', 'done', { events: [event('r1', 'review'), event('r2', 'review'), event('not-eligible', 'review', false)] })
  assert.equal(initialQueue([photo]), 'reviews')
  assert.equal(taskRows([photo], 'reviews').length, 2)
  assert.equal(taskRows([photo], 'done').length, 0)
  photo.events[0].status = 'violation'
  assert.equal(taskRows([photo], 'reviews').length, 1)
  photo.events[1].status = 'clear'
  assert.equal(taskRows([photo], 'done').length, 1)
})
test('historical date filters never hide unfinished tasks, and use Beijing capture dates', () => {
  const photo = normalizeTask(image('p', 'pending', { events: [{ ...event('e', 'clear'), identity: { captured_at: '2026-11-01 08:00:00', address: '东门' } }] }))
  assert.equal(filterTasks(taskRows([photo], 'pending'), 'pending', '', '2026-11-17', '2026-11-17', '').length, 1)
  photo.status = 'done'
  assert.equal(filterTasks(taskRows([photo], 'done'), 'done', '', '2026-11-17', '2026-11-17', '').length, 0)
  assert.deepEqual(taskTime('2026-11-16T16:15:05Z'), ['2026-11-17', '00:15:05'])
})
test('partial identity matches remain visible in both associated and pending association lists', () => {
  const photo = image('p', 'done', { events: [event('one', 'violation'), { ...event('two', 'clear'), identity: { status: 'matched' } }] })
  const rows = taskRows([photo], 'done')
  assert.equal(filterTasks(rows, 'done', '', '', '', 'matched').length, 1)
  assert.equal(filterTasks(rows, 'done', '', '', '', 'unmatched').length, 1)
})
test('run requests contain only selected pending/error image ids, grouped and deduplicated safely', () => {
  const pending = image('one'), failed = image('two', 'error', { batch_id: 'upload-b' })
  assert.deepEqual(taskRuns([pending, pending, failed, image('queued', 'pending', { queued: true }), image('done', 'done'), image('running', 'running')]), [
    { batch: 'upload-a', ids: ['one'] }, { batch: 'upload-b', ids: ['two'] },
  ])
  assert.deepEqual(taskRuns([]), [])
  assert.deepEqual(taskRuns([image('done', 'done')]), [])
})
