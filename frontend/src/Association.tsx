import { useRef, useState } from 'react'
import { FileSpreadsheet, Link2, LoaderCircle, Upload, UserRound, UserRoundX } from 'lucide-react'
import { api, eventScope, eventStatus, message, pathId, useRemote, type AssociationState, type Batch, type EventRow, type Identity } from './data'
import { Badge, Dialog, Fault } from './ui'

function displayRelationship(identity?: Identity) {
  return identity?.relationship?.trim() === '演示关联人员' ? undefined : identity?.relationship
}

export function IdentityName({ identity }: { identity?: Identity }) {
  const matched = identity?.status === 'matched'
  const Icon = matched ? UserRound : UserRoundX
  return (
    <div className={'identity-name' + (matched ? '' : ' unrecognized')}>
      <div><Icon size={15} aria-hidden="true" /><b>{matched ? identity.name : '未识别'}</b>
        {identity?.status === 'conflict' && <span className="identity-conflict">资料冲突</span>}
      </div>
      <small>{matched ? [identity.person_id, displayRelationship(identity)].filter(Boolean).join(' · ') || '未提供人员编号' : identity?.reason || '尚未关联人员资料'}</small>
    </div>
  )
}

export function IdentityFacts({ identity }: { identity?: Identity }) {
  const relationship = displayRelationship(identity)
  const fields = [
    ['人员编号', identity?.person_id], ...(relationship ? [['身份关系', relationship]] : []),
    ['车牌号', identity?.plate_number], ['芯片编号', identity?.rfid_chip],
    ['辖区 / 部门', identity?.jurisdiction || identity?.department], ['手机号', identity?.phone],
    ['抓拍时间', identity?.captured_at], ['抓拍编号', identity?.capture_id],
    ['抓拍地点', identity?.address], ['园区车辆编号', identity?.source_vehicle_id],
  ]
  return (
    <section className="identity-facts" aria-label="关联人员与车辆资料">
      <IdentityName identity={identity} />
      {fields.some(([, value]) => value) && <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>}
    </section>
  )
}

export function ImageIdentities({ events, showHeading = true }: { events: EventRow[]; showHeading?: boolean }) {
  if (!events.length) return null
  return (
    <section className="image-identities" aria-label="本图目标关联">
      {showHeading && <div className="section-head"><h2><Link2 size={17} />违章关联</h2><small>按目标展示关联资料</small></div>}
      {events.map((event) => (
        <div key={event.id} className="image-identity-row">
          <div className="image-identity-target"><b>{eventScope(event)}</b><Badge value={eventStatus(event)} /></div>
          <IdentityFacts identity={event.identity} />
        </div>
      ))}
    </section>
  )
}

export function AssociationDialog({ batch, close, saved }: { batch: Batch; close: () => void; saved: (state: AssociationState) => void }) {
  const picker = useRef<HTMLInputElement>(null)
  const current = useRemote(batch.id, () => api<AssociationState>('/batches/' + pathId(batch.id) + '/associations'))
  const [file, setFile] = useState<File>()
  const [mode] = useState<'demo' | 'filename'>(batch.association?.mode || 'demo')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [drag, setDrag] = useState(false)
  function select(incoming?: File) {
    if (!incoming || busy) return
    setError('')
    if (!/\.(csv|jsonl|json)$/i.test(incoming.name) || incoming.size > 20 * 1024 * 1024 || !incoming.size) {
      setFile(undefined)
      setError('请选择不超过 20 MB 的 CSV、JSONL 或 JSON 人员资料。')
      return
    }
    setFile(incoming)
  }
  async function submit() {
    if (!file || busy || !current.data) return
    setBusy(true)
    setError('')
    const form = new FormData()
    form.append('file', file)
    form.append('mode', mode)
    form.append('revision', String(current.data.revision))
    try {
      const state = await api<AssociationState>('/batches/' + pathId(batch.id) + '/associations', { method: 'POST', body: form })
      saved(state)
    } catch (e) {
      setError(message(e))
      current.refresh()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title="关联违章" onClose={close} locked={busy}>
      <p className="association-intro"><b title={batch.name}>{batch.name}</b><span>上传本批人员与车辆资料，关联到具体识别目标。<a className="link" href="/api/association-template.csv" download>下载关联模板</a></span></p>
      <div className="association-upload">
        <input ref={picker} className="native-hidden" type="file" accept=".csv,.jsonl,.json" disabled={!!busy} aria-label="选择人员资料"
          onChange={(event) => { select(event.target.files?.[0]); event.target.value = '' }} />
        <button className={'association-drop' + (drag ? ' drag' : '')} disabled={!!busy} onClick={() => picker.current?.click()}
          onDragOver={(event) => { event.preventDefault(); if (!busy) setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={(event) => { event.preventDefault(); setDrag(false); select(event.dataTransfer.files[0]) }}>
          <span className="association-drop-icon">{file ? <FileSpreadsheet size={28} aria-hidden="true" /> : <Upload size={28} aria-hidden="true" />}</span>
          <span className="association-drop-text"><b>{file?.name || '点击选择或拖入人员资料'}</b><small>{file ? (file.size / 1024).toFixed(1) + ' KB · 点击可更换文件' : '支持 manifest.csv、records.jsonl 或模板 CSV，最大 20 MB'}</small></span>
        </button>
      </div>
      {(error || current.error) && <Fault text={error || current.error!} retry={!error ? current.refresh : undefined} />}
      <div className="dialog-foot association-actions">
        <button className="secondary" disabled={!!busy} onClick={close}>取消</button>
        <button className="primary" disabled={!file || !current.data || busy} onClick={submit}>{busy ? <LoaderCircle size={15} className="spin" /> : <Link2 size={15} />}保存关联</button>
      </div>
    </Dialog>
  )
}
