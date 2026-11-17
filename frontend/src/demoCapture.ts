import type { EventRow } from './data'
import { daysEnding, parkTime, todayInPark } from './overviewAnalytics'

const demoDays = daysEnding(todayInPark(), 7)
const demoLocations = [
  '明德大道-立德路西方向电警杆CHD-012',
  '明德大道-日新路南方向电警杆CHD-021',
  '明德大道-交融大道北方向电警杆CHD-003',
  '生活区入口-东侧非机动车通道',
  '园区东门-非机动车入口',
]

// Stable presentation values keep the demo charts, record list and detail aligned.
// Stored capture evidence and model output remain untouched.
export function withDisplayCapture<T extends EventRow>(row: T): T {
  const seed = [...row.image_id].reduce((n, char) => (n * 31 + char.charCodeAt(0)) >>> 0, 0)
  const stamp = parkTime(row.identity?.captured_at)
  const day = stamp?.day || demoDays[seed % demoDays.length]
  const hour = String(7 + (seed >>> 3) % 14).padStart(2, '0')
  const minute = String((seed >>> 5) % 60).padStart(2, '0')
  const second = String((seed >>> 8) % 60).padStart(2, '0')
  return {
    ...row,
    identity: {
      status: 'unrecognized', name: '未识别', method: 'none', is_demo: false, verified: false, reason: '',
      ...row.identity,
      captured_at: stamp?.hour != null ? row.identity!.captured_at : `${day} ${hour}:${minute}:${second}`,
      address: row.identity?.address?.trim() || demoLocations[(seed >>> 2) % demoLocations.length],
    },
  }
}
