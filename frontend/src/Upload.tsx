import { useRef, useState, type FormEvent } from 'react'
import {
  CloudUpload,
  FileSpreadsheet,
  Images,
  Info,
  LoaderCircle,
  Upload,
  Users,
  X,
} from 'lucide-react'
import { api, uploadBatch, message, useRemote, type Batch, type SharedAssociation } from './data'
import { Dialog, Fault } from './ui'
export function UploadDialog({
  close,
  created,
  changed,
}: {
  close: () => void
  created: (b: Batch) => void
  changed: () => void // 只保存了人员信息、没有新图片时调用，弹窗不关闭
}) {
  const picker = useRef<HTMLInputElement>(null)
  const csvInput = useRef<HTMLInputElement>(null)
  const peopleInput = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [csv, setCsv] = useState<File>()
  const [people, setPeople] = useState<File>()
  const [drag, setDrag] = useState(false)
  const [csvDrag, setCsvDrag] = useState(false)
  const [peopleDrag, setPeopleDrag] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(0)
  // 当前对全部图片生效的人员信息，用来提示“已有资料，再传会替换”
  const shared = useRemote('shared-association', () => api<SharedAssociation>('/associations'))
  function add(incoming: FileList | null) {
    if (!incoming?.length) return
    const added = Array.from(incoming)
    const names = new Set(files.map((f) => f.name))
    let duplicate = false
    const unique = added.filter((f) => {
      if (names.has(f.name)) {
        duplicate = true
        return false
      }
      names.add(f.name)
      return true
    })
    setFiles([...files, ...unique])
    setError(duplicate ? '已跳过同名文件。' : '')
  }
  function pickCsv(incoming: FileList | null) {
    const file = incoming?.[0]
    if (!file) return
    const valid = file.name.toLowerCase().endsWith('.csv')
    if (valid) setCsv(file)
    setError(valid ? '' : '标签文件须为 CSV。')
  }
  function pickPeople(incoming: FileList | null) {
    const file = incoming?.[0]
    if (!file) return
    const valid = /\.(csv|jsonl|json)$/i.test(file.name) && file.size > 0 && file.size <= 20 * 1024 * 1024
    if (valid) setPeople(file)
    setNotice('')
    setError(valid ? '' : '人员信息须为不超过 20 MB 的 CSV、JSONL 或 JSON 文件。')
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!files.length && !people) {
      setError('请选择现场照片，或选择要更新的关联人员信息。')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    setProgress(0)
    try {
      // 先存人员信息：文件有问题时在传图片之前就报错；之后本次和以往的图片都按它关联
      if (people) {
        const form = new FormData()
        form.append('file', people, people.name)
        form.append('mode', 'demo')
        await api<SharedAssociation>('/associations', { method: 'POST', body: form })
        setPeople(undefined)
        shared.refresh()
        if (!files.length) {
          setNotice('人员信息已保存，全部图片都按这份资料关联。')
          setBusy(false)
          changed()
          return
        }
      }
      const form = new FormData()
      form.append('name', '抓拍导入 ' + new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date()))
      files.forEach((file) => form.append('files', file, file.name))
      if (csv) form.append('labels', csv, csv.name)
      const batch = await uploadBatch(form, setProgress)
      created(batch)
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }
  return (
    <Dialog title="上传图片" onClose={close} locked={busy}>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="form-stack">
          <div>
            <label htmlFor="photos">现场照片</label>
            <input
              className="native-hidden"
              tabIndex={-1}
              ref={picker}
              id="photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => {
                add(e.target.files)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className={'drop ' + (drag ? 'drag' : '')}
              onClick={() => picker.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDrag(true)
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDrag(false)
                add(e.dataTransfer.files)
              }}
            >
              <CloudUpload size={30} />
              <b>{files.length ? '继续添加照片' : '选择或拖入现场照片'}</b>
              <small>支持多选 JPEG、PNG、WebP，上传后可按图识别</small>
            </button>
            {files.length > 0 && (
              <details className="file-summary">
                <summary>
                  <Images size={15} /> 已选择 {files.length} 张照片
                </summary>
                <ul>
                  {files.map((f) => (
                    <li key={f.name}>
                      {f.name}
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={'移除 ' + f.name}
                        onClick={() => setFiles(files.filter((x) => x !== f))}
                      >
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <div>
            <div className="field-label">
              <label htmlFor="people">
                关联人员信息 <small>选填</small>
              </label>
              <a className="link upload-template" href="/api/association-template.csv" download>
                下载模板
              </a>
            </div>
            <input
              ref={peopleInput}
              id="people"
              className="native-hidden"
              tabIndex={-1}
              type="file"
              accept=".csv,.jsonl,.json"
              onChange={(e) => {
                pickPeople(e.target.files)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className={'drop ' + (peopleDrag ? 'drag' : '')}
              onClick={() => peopleInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setPeopleDrag(true)
              }}
              onDragLeave={() => setPeopleDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setPeopleDrag(false)
                pickPeople(e.dataTransfer.files)
              }}
            >
              <Users size={30} />
              <b>{people ? '更换人员信息文件' : shared.data?.imported ? '选择或拖入新的人员信息' : '选择或拖入关联人员信息'}</b>
              <small>CSV、JSONL 或 JSON，上传一次，全部图片识别后都按这份资料关联</small>
            </button>
            {people ? (
              <div className="file-summary file-line">
                <FileSpreadsheet size={15} />
                <span>{people.name}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="移除人员信息文件"
                  onClick={() => setPeople(undefined)}
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              shared.data?.imported && (
                <p className="upload-people-current">
                  当前资料：{shared.data.imported.filename} · {shared.data.imported.record_count} 条，重新上传将替换
                </p>
              )
            )}
          </div>
          <details className="upload-optional">
            <summary>人工标签（选填）</summary>
            <div className="field-label">
              <label htmlFor="labels">
                人工标签 <small>选填 · CSV</small>
              </label>
              {/* 格式说明平时收起，悬停、键盘聚焦或点按图标时显示（见 style.css 的 .tip） */}
              <span className="tip">
                <button
                  type="button"
                  aria-label="标签文件格式说明"
                  aria-describedby="labels-tip"
                >
                  <Info size={15} />
                </button>
                <span role="tooltip" id="labels-tip">
                  表头为 <code>filename,prediction</code>，已戴盔填{' '}
                  <code>helmet</code>，未戴盔填 <code>no_helmet</code>。
                </span>
              </span>
            </div>
            <input
              ref={csvInput}
              id="labels"
              className="native-hidden"
              tabIndex={-1}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                pickCsv(e.target.files)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className={'drop ' + (csvDrag ? 'drag' : '')}
              onClick={() => csvInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setCsvDrag(true)
              }}
              onDragLeave={() => setCsvDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setCsvDrag(false)
                pickCsv(e.dataTransfer.files)
              }}
            >
              <FileSpreadsheet size={30} />
              <b>{csv ? '更换标签文件' : '选择或拖入标签文件'}</b>
              <small>CSV，按文件名匹配照片</small>
            </button>
            {csv && (
              <div className="file-summary file-line">
                <FileSpreadsheet size={15} />
                <span>{csv.name}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="移除标签文件"
                  onClick={() => setCsv(undefined)}
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </details>
        </fieldset>
        {busy && !files.length && (
          <div className="upload-progress" role="status">
            <span>正在保存人员信息…</span>
          </div>
        )}
        {busy && files.length > 0 && (
          <div className="upload-progress" role="status">
            <span>
              {progress === 1
                ? '传输完成，服务器正在校验并保存图片…'
                : progress === null
                  ? '正在传输图片…'
                  : '正在传输 · ' + Math.floor(progress * 100) + '%'}
            </span>
            <progress
              aria-label="文件传输进度"
              value={progress ?? undefined}
              max={1}
            />
          </div>
        )}
        {error && <Fault text={error} />}
        {notice && !error && (
          <p className="feedback" role="status">
            {notice}
          </p>
        )}
        <div className="dialog-foot">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={close}
          >
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Upload size={16} />
            )}{' '}
            {/* 只选了人员信息时，这个按钮只保存资料 */}
            {files.length || !people ? (busy ? '正在上传' : '上传图片') : busy ? '正在保存' : '保存人员信息'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
