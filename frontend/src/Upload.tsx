import { useRef, useState, type FormEvent } from 'react'
import {
  CloudUpload,
  FileSpreadsheet,
  Images,
  Info,
  LoaderCircle,
  Upload,
  X,
} from 'lucide-react'
import { uploadBatch, message, type Batch } from './data'
import { Dialog, Fault } from './ui'
export function UploadDialog({
  close,
  created,
}: {
  close: () => void
  created: (b: Batch) => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const csvInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [csv, setCsv] = useState<File>()
  const [drag, setDrag] = useState(false)
  const [csvDrag, setCsvDrag] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(0)
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
    setError(duplicate ? '已跳过同名文件。每批次按文件名匹配标签。' : '')
  }
  function pickCsv(incoming: FileList | null) {
    const file = incoming?.[0]
    if (!file) return
    const valid = file.name.toLowerCase().endsWith('.csv')
    if (valid) setCsv(file)
    setError(valid ? '' : '标签文件须为 CSV。')
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !files.length) {
      setError('请填写批次名称并选择至少一张图片。')
      return
    }
    setBusy(true)
    setError('')
    setProgress(0)
    const form = new FormData()
    form.append('name', name.trim())
    files.forEach((file) => form.append('files', file, file.name))
    if (csv) form.append('labels', csv, csv.name)
    try {
      const batch = await uploadBatch(form, setProgress)
      created(batch)
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }
  return (
    <Dialog title="上传识别批次" onClose={close} locked={busy}>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="form-stack">
          <label>
            批次名称
            <input
              autoFocus
              required
              maxLength={200}
              placeholder="例如：园区东门早高峰"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
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
              <small>每批一份 CSV，按文件名匹配照片</small>
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
          </div>
        </fieldset>
        {busy && (
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
            {busy ? '正在上传' : '创建批次'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
