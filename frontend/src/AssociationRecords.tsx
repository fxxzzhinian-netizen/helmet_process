import { useEffect, useId, useState } from 'react'
import {
  Check, ChevronLeft, ChevronRight, ClipboardCheck, Download, Eye, FileSearch,
  ImageOff, Link2, MapPin, Search, Upload, X, ZoomIn,
} from 'lucide-react'
import { api, canReview, eventScope, eventStatus, go, imgUrl, pathId, sourceName, useRemote, type AssociationState, type Batch, type EventRow } from './data'
import { associationMethod, violationType } from './associationCsv'
import { Empty, Fault } from './ui'
import { FilterSelect } from './FilterSelect'
import { ExportCsvDialog } from './ExportCsvDialog'

function PhotoThumbnail({ row, open }: { row: EventRow; open: () => void }) {
  const [failed, setFailed] = useState(false)
  return (
    <button className="association-photo" onClick={open} aria-label={'查看图片 ' + row.filename + ' · ' + eventScope(row)}>
      <span className="association-thumbnail">
        {failed ? <ImageOff size={20} aria-hidden="true" /> : <img src={imgUrl(row.image_id)} alt="" loading="lazy" onError={() => setFailed(true)} />}
        <span className="association-photo-zoom"><ZoomIn size={15} aria-hidden="true" /></span>
      </span>
      <span className="association-photo-meta">
        <span className="association-filename" title={row.filename}>{row.filename}</span>
        <small>查看原图</small>
      </span>
    </button>
  )
}

const clock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})
function recordTime(value?: string) {
  if (!value) return ['—', '']
  // Park timestamps without an offset already represent local capture time.
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  const date = zoned ? new Date(value) : null
  const text = date && !isNaN(date.getTime()) ? clock.format(date) : value.replace('T', ' ')
  const [day, ...hours] = text.split(' ')
  return [day, hours.join(' ')]
}

export function ExportAssociations({ rows, title, disabled = false }: { rows: EventRow[]; title?: string; disabled?: boolean }) {
  const [exported, setExported] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!exported) return
    const timer = setTimeout(() => setExported(false), 2500)
    return () => clearTimeout(timer)
  }, [exported])
  return (
    <>
    <button className="secondary association-export" disabled={disabled}
      title={rows.length ? `设置导出条件，当前范围共 ${rows.length} 条记录` : '设置导出条件，当前暂无记录'}
      onClick={() => { setExported(false); setOpen(true) }}>
      {exported ? <Check size={16} /> : <Download size={16} />}
      {exported ? '已导出' : '导出 CSV'}
    </button>
    {open && <ExportCsvDialog rows={rows} title={title} close={() => setOpen(false)} exported={() => { setOpen(false); setExported(true) }} />}
    </>
  )
}

export function AssociationTable({ rows, open, resetKey = '', label = '违章关联记录' }: {
  rows: EventRow[]; open: (row: EventRow) => void; resetKey?: string; label?: string
}) {
  const caption = useId()
  const [page, setPage] = useState(1)
  const pageSize = 20
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  const start = (current - 1) * pageSize
  useEffect(() => setPage(1), [resetKey])
  return (
    <div className="association-table-wrap">
      <div className="association-table-scroll" role="region" aria-label={label + '，可横向滚动'} tabIndex={0}>
        <table className="association-table" aria-labelledby={caption}>
          <caption className="sr-only" id={caption}>{label}</caption>
          <colgroup>
            {[176, 180, 110, 142, 188, 168, 164, 112].map((width, i) => <col key={i} style={{ width }} />)}
          </colgroup>
          <thead><tr>
            {['关联人员', '车牌号 / 芯片编号', '违章类型', '抓拍时间', '违章地址', '判定来源', '现场图片', '操作'].map((name) => <th scope="col" key={name}>{name}</th>)}
          </tr></thead>
          <tbody>
            {rows.slice(start, start + pageSize).map((row) => {
              const person = row.identity
              const matched = person?.status === 'matched'
              const [day, hour] = recordTime(person?.captured_at || row.recognized_at)
              return (
                <tr key={row.id + ':' + person?.status + ':' + person?.name} className="association-entry">
                  <td>
                    <div className={'association-person' + (matched ? '' : ' unmatched')}>
                      <div className="association-person-heading">
                        <b title={matched ? person.name : person?.reason}>{matched ? person.name : '未识别'}</b>
                        {/* 正常关联上的人员（按文件名、演示配对）不显示关联方式；只标出未识别、资料冲突和按目标关联 */}
                        {(!matched || person?.method === 'target') && <span className={'association-method' + (person?.status === 'conflict' ? ' conflict' : '')}
                          title={person?.reason}>{associationMethod(row)}</span>}
                      </div>
                      <small className="num" title={person?.person_id}>{person?.person_id || '未提供人员编号'}</small>
                    </div>
                  </td>
                  <td>
                    <div className="association-vehicle">
                      <b className={person?.plate_number ? 'association-plate' : 'association-missing'}>{person?.plate_number || '—'}</b>
                      <small className="association-chip" title={person?.rfid_chip}>{person?.rfid_chip || '芯片未提供'}</small>
                    </div>
                  </td>
                  <td><span className={'association-kind ' + row.status} title={row.reason}>{violationType(row)}</span></td>
                  <td><div className="association-cell-stack association-time num" title={person?.captured_at || '识别完成时间'}>
                    <span>{day}</span><small>{hour}{!person?.captured_at && hour ? ' · 识别' : ''}</small>
                  </div></td>
                  <td><div className="association-location" title={person?.address}>
                    {person?.address && <MapPin size={13} aria-hidden="true" />}<span>{person?.address || '—'}</span>
                  </div></td>
                  <td><div className="association-cell-stack">
                    <span className={'association-source-label ' + (row.source || '')}><i aria-hidden="true" />{sourceName(row.source)}</span>
                    <small className="association-source-meta" title={(row.batch_name || row.batch_id) + ' · ' + eventScope(row)}>
                      <span className="association-batch-name">{row.batch_name || row.batch_id}</span>
                      <span className="association-meta-dot" aria-hidden="true">·</span>
                      <span className="association-target-name">{eventScope(row)}</span>
                    </small>
                  </div></td>
                  <td><PhotoThumbnail row={row} open={() => open(row)} /></td>
                  <td className="association-row-action"><button type="button" className="association-detail-action" onClick={() => open(row)}
                    aria-label={(row.status === 'review' && canReview(row) ? '人工复核 ' : '查看详情 ') + row.filename + ' · ' + eventScope(row)}>
                    {row.status === 'review' && canReview(row) ? <ClipboardCheck size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                    <span>{row.status === 'review' && canReview(row) ? '人工复核' : '查看详情'}</span>
                  </button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="association-table-foot">
        <span className="num">共 <b>{rows.length}</b> 条<span className="association-range"> · 当前 {start + 1}–{Math.min(start + pageSize, rows.length)} 条</span></span>
        <div className="association-pagination" role="group" aria-label="关联记录分页">
          <span>每页 {pageSize} 条</span>
          <button className="icon-btn" aria-label="上一页" disabled={current === 1} onClick={() => setPage(current - 1)}><ChevronLeft size={16} /></button>
          <span className="num">{current} / {pages}</span>
          <button className="icon-btn" aria-label="下一页" disabled={current === pages} onClick={() => setPage(current + 1)}><ChevronRight size={16} /></button>
        </div>
      </div>
    </div>
  )
}

export function BatchAssociationRecords({ batch, onImport }: { batch: Batch; onImport: () => void }) {
  const [query, setQuery] = useState('')
  const [identity, setIdentity] = useState('')
  const [outcome, setOutcome] = useState('')
  const remote = useRemote(batch.id, () => api<AssociationState>('/batches/' + pathId(batch.id) + '/associations'), 2000)
  useEffect(() => { remote.refresh() }, [batch.processed, batch.association?.revision, remote.refresh])
  const all = [...(remote.data?.rows || [])].sort((a, b) => (b.recognized_at || '').localeCompare(a.recognized_at || ''))
  const matched = all.filter((row) => row.identity?.status === 'matched').length
  const term = query.trim().toLowerCase()
  const rows = all.filter((row) =>
    (!identity || (identity === 'demo' ? row.identity?.method === 'demo' : identity === 'unrecognized' ? row.identity?.status !== 'matched' : row.identity?.status === identity)) &&
    (!outcome || eventStatus(row) === outcome) &&
    [row.filename, row.id, row.identity?.name, row.identity?.person_id, row.identity?.plate_number,
      row.identity?.rfid_chip, row.identity?.phone, row.identity?.address].some((value) => value?.toLowerCase().includes(term))
  )
  const filtered = Boolean(term || identity || outcome)
  return (
    <section className="batch-association-ledger" id="batch-associations" aria-label="本批违章关联">
      <div className="association-ledger-head">
        <div>
          <div className="association-title-line"><h2><Link2 size={19} />违章关联</h2>
            <span className={'association-live' + (remote.error ? ' disconnected' : '')} role="status"><i />{remote.error ? '同步中断' : remote.data ? '实时更新' : '正在读取'}</span>
          </div>
          <p>图片与人员匹配后自动显示，点击图片查看现场证据。</p>
        </div>
        <div className="association-ledger-actions">
          <button className="link" onClick={onImport}><Upload size={15} />{batch.association ? '更换人员资料' : '上传人员资料'}</button>
          <ExportAssociations rows={rows} disabled={!!remote.error || !remote.data} />
        </div>
      </div>
      <div className="association-ledger-summary" role="status" aria-live="polite">
        <span>已匹配人员 <b className="num">{remote.data ? matched : '—'}</b></span>
        <span>待关联目标 <b className="num">{remote.data ? all.length - matched : '—'}</b></span>
        <span>已识别目标 <b className="num">{remote.data ? all.length : '—'}</b></span>
        {batch.association && <small title={batch.association.filename}><Link2 size={13} />{batch.association.filename}</small>}
      </div>
      <div className="filters association-ledger-filters">
        <label className="queue-search"><Search size={16} aria-hidden="true" />
          <input aria-label="搜索本批关联记录" placeholder="搜索姓名、车牌、芯片或文件名" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <FilterSelect label="本批关联状态" value={identity} onChange={setIdentity} options={[
          { value: '', label: '全部关联状态' }, { value: 'matched', label: '已匹配人员' },
          { value: 'unrecognized', label: '待关联人员' }, { value: 'conflict', label: '资料冲突' }, { value: 'demo', label: '演示配对' },
        ]} />
        <FilterSelect label="本批判定状态" value={outcome} onChange={setOutcome} options={[
          { value: '', label: '全部判定状态' }, { value: 'violation', label: '确认违章' },
          { value: 'review', label: '待人工复核' }, { value: 'clear', label: '已排除' },
        ]} />
        {filtered && <button className="link records-reset" onClick={() => { setQuery(''); setIdentity(''); setOutcome('') }}><X size={14} />重置</button>}
      </div>
      {remote.error && <Fault text={remote.error} retry={remote.refresh} />}
      {rows.length ? <AssociationTable rows={rows} resetKey={query + ':' + identity + ':' + outcome} open={(row) =>
        go('overview', { batch: batch.id, tab: row.status === 'review' && canReview(row) ? 'reviews' : 'violations', event: row.id })} /> :
        <Empty icon={FileSearch} title={!remote.data ? '正在读取关联结果' : filtered ? '没有匹配的关联记录' : '等待识别结果'}
          body={filtered ? '调整筛选条件或搜索其他姓名、车牌和文件名。' : '每完成一张图片识别，这里会自动显示目标及关联人员资料。'} />}
    </section>
  )
}
