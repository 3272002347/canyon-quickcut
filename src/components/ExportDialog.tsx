import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  FolderOpen,
  LoaderCircle,
  ScanLine,
  X,
  Zap,
} from 'lucide-react'
import type { ExportMode, ExportProgress, ExportQuality, Project } from '../types'
import { clipDuration, formatDuration, getTotalDuration, resolutionSize } from '../lib/project'
import { Segmented, ToggleRow } from './FormControls'

interface ExportDialogProps {
  open: boolean
  project: Project
  onClose: () => void
  notify: (message: string, tone?: 'normal' | 'error') => void
}

function sourceAspect(project: Project) {
  if (!project.media?.width || !project.media?.height) return 0
  return project.media.width / project.media.height
}

function targetAspect(project: Project) {
  const ratios: Record<Project['aspectRatio'], number> = {
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '1:1': 1,
    '4:5': 4 / 5,
  }
  return ratios[project.aspectRatio]
}

export function ExportDialog({ open, project, onClose, notify }: ExportDialogProps) {
  const [mode, setMode] = useState<ExportMode>('precise')
  const [quality, setQuality] = useState<ExportQuality>('balanced')
  const [outputPath, setOutputPath] = useState('')
  const [openWhenDone, setOpenWhenDone] = useState(true)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [finishedPath, setFinishedPath] = useState('')
  const [error, setError] = useState('')
  const totalDuration = getTotalDuration(project)
  const output = resolutionSize(project.aspectRatio, project.resolution)
  const fastEligible = useMemo(() => {
    const single = project.clips.length === 1
    if (!single) return false
    const clip = project.clips[0]
    const ratioDifference = Math.abs(sourceAspect(project) - targetAspect(project))
    return Math.abs(clip.speed - 1) < 0.001
      && project.texts.length === 0
      && Math.abs(project.filters.brightness) < 0.001
      && Math.abs(project.filters.contrast) < 0.001
      && Math.abs(project.filters.saturation) < 0.001
      && !project.transform.flipX
      && !project.transform.flipY
      && ratioDifference < 0.01
  }, [project])

  useEffect(() => {
    if (!open) return
    setFinishedPath('')
    setError('')
    setProgress(null)
    setRunning(false)
    setJobId(null)
    setMode(fastEligible ? 'precise' : 'precise')
  }, [open, fastEligible])

  useEffect(() => {
    const off = window.quickCut.onExportProgress((next) => {
      setProgress(next)
      if (next.jobId) setJobId(next.jobId)
      if (next.status === 'done' && next.outputPath) {
        setRunning(false)
        setFinishedPath(next.outputPath)
        if (openWhenDone) window.quickCut.revealFile(next.outputPath)
      }
      if (next.status === 'error') {
        setRunning(false)
        setError(next.message || '导出失败')
      }
      if (next.status === 'cancelled') setRunning(false)
    })
    return off
  }, [openWhenDone])

  if (!open) return null

  const suggestedName = `${project.name || '峡谷快剪'}-成片`
  const choosePath = async () => {
    const selected = await window.quickCut.chooseExportPath(suggestedName)
    if (selected) setOutputPath(selected)
    return selected
  }

  const startExport = async () => {
    let target = outputPath
    if (!target) {
      target = (await choosePath()) || ''
      if (!target) return
    }
    setRunning(true)
    setError('')
    setFinishedPath('')
    setProgress({ jobId: '', percent: 0, time: 0, fps: 0, speed: '0x', status: 'running' })
    try {
      const result = await window.quickCut.startExport({
        project,
        settings: { outputPath: target, mode, quality, openWhenDone },
      })
      setJobId(result.jobId)
      setFinishedPath(result.outputPath)
    } catch (exportError) {
      const message = exportError instanceof Error ? exportError.message : String(exportError)
      setError(message)
      notify(`导出失败：${message}`, 'error')
    } finally {
      setRunning(false)
    }
  }

  const cancel = async () => {
    if (jobId) await window.quickCut.cancelExport(jobId)
    setRunning(false)
  }

  const percent = Math.max(0, Math.min(100, progress?.percent || (finishedPath ? 100 : 0)))

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !running) onClose()
    }}>
      <div className="export-dialog" role="dialog" aria-modal="true" aria-label="导出成片">
        <header className="export-dialog-header">
          <div>
            <span className="eyebrow">输出</span>
            <h2>导出剪映素材</h2>
          </div>
          <button className="icon-button" onClick={onClose} disabled={running} title="关闭"><X size={18} /></button>
        </header>

        <div className="export-dialog-body">
          <section className="export-section">
            <div className="export-section-title">
              <span>导出方式</span>
              <small>{mode === 'fast' ? '不重编码，速度快' : '逐帧准确处理全部效果'}</small>
            </div>
            <div className="export-mode-grid">
              <button className={mode === 'precise' ? 'is-selected' : ''} onClick={() => setMode('precise')} disabled={running}>
                <ScanLine size={21} />
                <strong>精准导出</strong>
                <span>应用裁剪、变速、画面、音量与文字</span>
                <b>推荐</b>
              </button>
              <button className={mode === 'fast' ? 'is-selected' : ''} onClick={() => setMode('fast')} disabled={running || !fastEligible}>
                <Zap size={21} />
                <strong>快速导出</strong>
                <span>{fastEligible ? '单片段原画流复制，按关键帧切点' : '仅单片段、无效果时可用'}</span>
              </button>
            </div>
          </section>

          <section className="export-section">
            <div className="export-section-title"><span>画质</span><small>H.264 · AAC</small></div>
            <Segmented<ExportQuality>
              value={quality}
              onChange={setQuality}
              options={[
                { value: 'draft', label: '快速草稿' },
                { value: 'balanced', label: '平衡' },
                { value: 'high', label: '高画质' },
              ]}
            />
            <div className="export-specs">
              <div><span>画布</span><strong>{project.aspectRatio} · {output.width} x {output.height}</strong></div>
              <div><span>帧率</span><strong>{project.fps} FPS</strong></div>
              <div><span>节目时长</span><strong>{formatDuration(totalDuration)}</strong></div>
              <div><span>片段</span><strong>{project.clips.length} 个</strong></div>
            </div>
          </section>

          <section className="export-section">
            <div className="export-section-title"><span>保存位置</span><small>MP4</small></div>
            <div className="export-path-row">
              <div className="export-path" title={outputPath}>{outputPath || '尚未选择'}</div>
              <button className="subtle-button" onClick={choosePath} disabled={running}><FolderOpen size={15} />选择</button>
            </div>
            <ToggleRow label="导出完成后打开文件夹" checked={openWhenDone} onChange={setOpenWhenDone} />
          </section>

          {(running || progress || finishedPath || error) && (
            <section className="export-progress-section">
              <div className="export-progress-heading">
                <div>
                  {running && <LoaderCircle size={16} className="spin" />}
                  {finishedPath && <CheckCircle2 size={17} />}
                  <span>{finishedPath ? '导出完成' : running ? '正在编码视频' : error ? '导出中断' : '准备导出'}</span>
                </div>
                <strong>{percent.toFixed(1)}%</strong>
              </div>
              <div className="export-progress-bar"><span style={{ width: `${percent}%` }} /></div>
              <div className="export-progress-meta">
                <span>{progress?.speed || '0x'}</span>
                <span>{progress?.fps ? `${progress.fps.toFixed(1)} FPS` : ''}</span>
                <span>{progress?.time ? formatDuration(progress.time) : ''}</span>
              </div>
              {finishedPath && <div className="export-finished-path">{finishedPath}</div>}
              {error && <div className="export-error">{error}</div>}
            </section>
          )}
        </div>

        <footer className="export-dialog-footer">
          <span className="export-footnote">素材全程在本机处理</span>
          <div>
            {finishedPath ? (
              <>
                <button className="subtle-button" onClick={() => window.quickCut.revealFile(finishedPath)}><FolderOpen size={15} />打开文件夹</button>
                <button className="primary-button" onClick={onClose}>完成</button>
              </>
            ) : running ? (
              <>
                <button className="subtle-button" onClick={cancel}>取消导出</button>
                <button className="primary-button" disabled><LoaderCircle size={16} className="spin" />导出中</button>
              </>
            ) : (
              <>
                <button className="subtle-button" onClick={onClose}>返回</button>
                <button className="primary-button" onClick={startExport} disabled={!project.media || !project.clips.length}>开始导出</button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
