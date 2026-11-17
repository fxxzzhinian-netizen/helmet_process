import { useState } from 'react'
import { Download, RotateCcw } from 'lucide-react'
import { associationCsvData, exportAssociationCsv } from './associationCsv'
import { emptyExportFilters, filterExportRows, type ExportFilters } from './exportFilters'
import { message, type EventRow } from './data'
import { FilterSelect } from './FilterSelect'
import { Dialog, Fault } from './ui'

export function ExportCsvDialog({ rows, title, close, exported }: {
  rows: EventRow[]; title?: string; close: () => void; exported: () => void
}) {
  const [filters, setFilters] = useState(emptyExportFilters)
  const [error, setError] = useState('')
  const invalid = Boolean(filters.from && filters.to && filters.from > filters.to)
  const filtered = filterExportRows(rows, filters)
  const csv = associationCsvData(filtered)
  const batches = [...new Map(rows.map((row) => [row.batch_id, row.batch_name || row.batch_id])).entries()]
  const count = Object.entries(filters).filter(([key, value]) => key !== 'dateField' && value.trim()).length
  function change(key: keyof ExportFilters, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value }))
    setError('')
  }
  function download() {
    if (invalid || !csv.records.length || !csv.columns.length) return
    try { exportAssociationCsv(filtered, title); exported() }
    catch (failure) { setError(message(failure)) }
  }
  return (
    <Dialog title="导出 CSV" onClose={close} className="csv-export-dialog">
      <p className="csv-export-intro">在当前列表范围内组合筛选，导出所有匹配记录，包含其他分页。</p>
      <div className="csv-export-scope"><span>{title || '违章关联记录'}</span><small className="num">当前范围 {rows.length} 条</small></div>
      <div className="csv-export-fields">
        <label className="csv-export-wide"><span>关键词</span><input type="search" value={filters.query} placeholder="多个关键词用空格分隔，同时匹配" onChange={(event) => change('query', event.target.value)} /></label>
        {([
          ['name', '人员姓名', '输入姓名'], ['personId', '人员编号', '输入人员编号'],
          ['plate', '车牌号', '输入车牌号'], ['chip', '芯片编号', '输入芯片编号'],
        ] as const).map(([key, label, placeholder]) => <label key={key}><span>{label}</span>
          <input value={filters[key]} placeholder={placeholder} onChange={(event) => change(key, event.target.value)} />
        </label>)}
        <label className="csv-export-address"><span>违章地址</span><input value={filters.address} placeholder="输入道路、地点或抓拍点名称" onChange={(event) => change('address', event.target.value)} /></label>
        <div className="csv-export-selects csv-export-wide">
        <div className="csv-export-field"><span>来源批次</span><FilterSelect label="导出来源批次" value={filters.batch} onChange={(value) => change('batch', value)}
          options={[{ value: '', label: '全部批次' }, ...batches.map(([value, label]) => ({ value, label }))]} /></div>
        <div className="csv-export-field"><span>判定来源</span><FilterSelect label="导出判定来源" value={filters.source} onChange={(value) => change('source', value)} options={[
          { value: '', label: '全部来源' }, { value: 'model', label: '模型判定' }, { value: 'human', label: '人工复核' },
        ]} /></div>
        <div className="csv-export-field"><span>记录状态</span><FilterSelect label="导出记录状态" value={filters.status} onChange={(value) => change('status', value)} options={[
          { value: '', label: '全部状态' }, { value: 'violation', label: '确认违章' }, { value: 'review', label: '待人工复核' },
          { value: 'clear', label: '已排除' },
        ]} /></div>
        <div className="csv-export-field"><span>人员关联</span><FilterSelect label="导出人员关联状态" value={filters.identity} onChange={(value) => change('identity', value)} options={[
          { value: '', label: '全部人员' }, { value: 'matched', label: '已关联人员' }, { value: 'unrecognized', label: '未识别人员' }, { value: 'conflict', label: '资料冲突' },
        ]} /></div>
        </div>
      </div>
      <fieldset className="csv-export-date"><legend>日期范围</legend>
        <div className="csv-export-field"><span>时间依据</span><FilterSelect label="导出时间依据" value={filters.dateField} onChange={(value) => change('dateField', value)} options={[
          { value: 'captured', label: '抓拍时间' }, { value: 'recognized', label: '识别时间' }, { value: 'decision', label: '判定时间' },
        ]} /></div>
        <label><span>开始日期</span><input type="date" aria-label="导出开始日期" value={filters.from} max={filters.to || undefined} onChange={(event) => change('from', event.target.value)} /></label>
        <label><span>结束日期</span><input type="date" aria-label="导出结束日期" value={filters.to} min={filters.from || undefined} onChange={(event) => change('to', event.target.value)} /></label>
      </fieldset>
      {invalid && <p className="csv-export-date-error" role="alert">结束日期不能早于开始日期。</p>}
      {(filters.from || filters.to) && !invalid && <p className="csv-export-date-hint">按北京时间筛选，包含开始和结束当天；缺少所选时间的记录不计入。</p>}
      {error && <Fault text={error} />}
      <div className="csv-export-result" role="status" aria-live="polite"><span className="num">匹配 <b>{invalid ? '—' : filtered.length}</b> 条记录</span>
        <button className="link" disabled={!count && filters.dateField === 'captured'} onClick={() => { setFilters(emptyExportFilters()); setError('') }}><RotateCcw size={13} />重置条件{count ? ' · ' + count : ''}</button>
      </div>
      {csv.missing > 0 && <p className="csv-export-date-hint">{csv.missing} 条记录缺少原始资料，本次不导出。重新上传本批人员 CSV 可补齐。</p>}
      <div className="dialog-foot"><button className="secondary" onClick={close}>取消</button>
        <button className="primary" disabled={invalid || !csv.records.length || !csv.columns.length} onClick={download}><Download size={15} />导出 CSV{csv.records.length ? '（' + csv.records.length + ' 条）' : ''}</button>
      </div>
    </Dialog>
  )
}
