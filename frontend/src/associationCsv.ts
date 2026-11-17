import type { EventRow } from './data'

export function violationType(row: EventRow) {
  return row.status === 'violation' ? '未佩戴头盔' : row.status === 'review' ? '戴盔情况待核' : '已排除违章'
}

export function associationMethod(row: EventRow) {
  if (row.identity?.status === 'conflict') return '资料冲突'
  if (row.identity?.status !== 'matched') return '未识别'
  return row.identity.method === 'demo' ? '演示配对' : row.identity.method === 'target' ? '按目标关联' : '按文件名关联'
}

// Keep CSV fields quoted, retain Chinese text in Excel, and treat imported
// spreadsheet expressions as text when the downloaded file is opened.
function csvCell(value: unknown) {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  const safe = /^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text
  return '"' + safe.replace(/"/g, '""') + '"'
}

function hasData(value: unknown) {
  return value != null && (typeof value !== 'string' || Boolean(value.trim()))
}

const excludedSourceColumns = new Set([
  '关联方式', '演示资料', '关联目标',
  '身份关系', 'relationship', 'relation', 'registered_relationship',
  '辖区', 'jurisdiction', 'area', 'areaName', 'region', 'regionName',
  '部门', 'department', 'departmentName',
  '手机号', '联系电话', 'phone', 'mobile', 'phoneNumber', 'ownerPhone', 'ownerMobile',
].map((field) => field.toLowerCase()))

const sourceColumnLabels: Record<string, string> = {
  file: '图片文件名', filename: '图片文件名', '照片文件名': '图片文件名', '文件名': '图片文件名',
  imagefield: '图片字段', sha256: '图片校验码', width: '图片宽度（像素）', height: '图片高度（像素）',
  id: '抓拍编号', capture_id: '抓拍编号',
  mbid: '人员记录编号', miid: '关联信息编号',
  rfidchip: '芯片编号', rfid_chip: '芯片编号',
  vehiclerecordid: '园区车辆记录编号', source_vehicle_id: '园区车辆记录编号',
  platenumber: '车牌号', plate_number: '车牌号', carno: '车辆编号', platecolor: '车牌颜色编码',
  vehicleillegatype: '违章类型编码', vehicleillegatypestr: '违章类型', violationdesc: '违章描述',
  datasource: '数据来源', alarmtime: '抓拍时间', captured_at: '抓拍时间',
  overspeedratio: '超速比例', speed: '行驶速度', limitspeed: '限速',
  address: '抓拍地点', campus: '所属园区',
  img1: '现场图片一', img2: '现场图片二', img3: '现场图片三',
  videochannel: '视频通道', camerachannelid: '摄像机通道编号',
  status: '原始审核状态', reviewer: '审核人', reviewtime: '审核时间',
  confirmedviolationid: '确认违章编号', deptid: '部门编号',
  createtime: '创建时间', createby: '创建人', updatetime: '更新时间', updateby: '更新人', remark: '备注',
  ownername: '人员姓名', name: '人员姓名', memberno: '人员编号', person_id: '人员编号',
  persondetail: '人员详情', target_vehicle_id: '目标车辆编号',
  relationship: '身份关系', relation: '身份关系', registered_relationship: '登记身份关系',
  jurisdiction: '辖区', area: '辖区', areaname: '辖区', region: '辖区', regionname: '辖区',
  department: '部门', departmentname: '部门',
  phone: '手机号', mobile: '手机号', phonenumber: '手机号', ownerphone: '手机号', ownermobile: '手机号',
}

function csvHeaders(columns: string[]) {
  const used = new Set<string>()
  return columns.map((field) => {
    const label = sourceColumnLabels[field.trim().toLowerCase()] || field
    let header = label
    let suffix = 2
    while (used.has(header)) header = `${label}（${suffix++}）`
    used.add(header)
    return header
  })
}

export function associationCsvData(rows: EventRow[]) {
  const sources: Record<string, unknown>[] = []
  const candidates = new Set<string>()
  for (const row of rows) {
    const source = row.identity?.source_record
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue
    sources.push(source)
    const order = [...(row.identity?.source_columns || []), ...Object.keys(source)]
    for (const field of order) {
      if (field.trim() && !excludedSourceColumns.has(field.trim().toLowerCase()) && Object.hasOwn(source, field)) candidates.add(field)
    }
  }
  // A column is included when at least one exported source row has a value.
  // Numeric zero and false are data; generated labels never fill empty fields.
  const columns = [...candidates].filter((field) => sources.some((source) => hasData(source[field])))
  const records = sources.map((source) => columns.map((field) => source[field]))
  return { columns, records, missing: rows.length - sources.length }
}

export function buildAssociationCsv(rows: EventRow[]) {
  const { columns, records } = associationCsvData(rows)
  if (!columns.length || !records.length) throw new Error('所选记录没有可导出的原始资料，请先上传或重新关联人员 CSV。')
  return '\uFEFF' + [csvHeaders(columns), ...records].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function exportAssociationCsv(rows: EventRow[], title = '违章关联') {
  if (!rows.length) return
  const content = buildAssociationCsv(rows)
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  link.download = title + '_' + date + '.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
