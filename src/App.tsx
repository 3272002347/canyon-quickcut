import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, HardDrive, Info, RefreshCw, X } from 'lucide-react'
import type { Clip, MediaInfo, Project, TextOverlay, UpdateState } from './types'
import {
  clamp,
  createEmptyProject,
  createId,
  fileNameWithoutExtension,
  getTimelineSegments,
  getTotalDuration,
} from './lib/project'
import { TopBar } from './components/TopBar'
import { MediaPanel } from './components/MediaPanel'
import { Preview } from './components/Preview'
import { Inspector } from './components/Inspector'
import { Timeline } from './components/Timeline'
import { ExportDialog } from './components/ExportDialog'

interface ToastState {
  id: number
  message: string
  tone: 'normal' | 'error'
}

function createClipFromMedia(media: MediaInfo): Clip {
  return {
    id: createId('clip'),
    label: '全片',
    inPoint: 0,
    outPoint: media.duration,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
  }
}

function withTimestamp(project: Project): Project {
  return { ...project, updatedAt: new Date().toISOString() }
}

function updateLabel(state: UpdateState): string {
  if (state.status === 'checking') return '检查更新中'
  if (state.status === 'available') return '准备更新'
  if (state.status === 'downloading') return `下载更新 ${state.percent.toFixed(0)}%`
  if (state.status === 'downloaded') return `重启安装 v${state.version || ''}`
  if (state.status === 'not-available') return '已是最新版本'
  if (state.status === 'error') return '更新检查失败'
  if (state.status === 'disabled') return state.message?.includes('便携') ? '便携版' : '开发版'
  return '检查更新'
}

export default function App() {
  const [project, setProject] = useState<Project>(() => createEmptyProject())
  const projectRef = useRef(project)
  const [history, setHistory] = useState<Project[]>([])
  const [future, setFuture] = useState<Project[]>([])
  const [playhead, setPlayheadState] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null)
  const [projectPath, setProjectPath] = useState('')
  const [saved, setSaved] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [appInfo, setAppInfo] = useState({ version: '1.1.0', ffmpeg: '', platform: 'win32' })
  const [updateState, setUpdateState] = useState<UpdateState>({
    status: 'idle',
    currentVersion: '1.1.0',
    percent: 0,
    transferred: 0,
    total: 0,
    bytesPerSecond: 0,
  })
  const interactionSnapshotRef = useRef<Project | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const startupLoadedRef = useRef(false)
  const notifiedUpdateRef = useRef('')

  useEffect(() => { projectRef.current = project }, [project])

  useEffect(() => {
    window.quickCut.getAppInfo().then(setAppInfo).catch(() => {})
  }, [])

  useEffect(() => {
    if (startupLoadedRef.current) return
    startupLoadedRef.current = true
    window.quickCut.getStartupMedia().then((media) => {
      if (!media) return
      const clip = createClipFromMedia(media)
      const base = createEmptyProject()
      setProject({
        ...base,
        name: fileNameWithoutExtension(media.name),
        media,
        clips: [clip],
        fps: media.fps >= 50 ? 60 : 30,
      })
      setSelectedClipId(clip.id)
      setSaved(false)
    }).catch(() => {})
  }, [])

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
  }, [])

  const notify = useCallback((message: string, tone: 'normal' | 'error' = 'normal') => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    setToast({ id: Date.now(), message, tone })
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200)
  }, [])

  useEffect(() => {
    let active = true
    window.quickCut.getUpdateState().then((state) => {
      if (active) setUpdateState(state)
    }).catch(() => {})
    const unsubscribe = window.quickCut.onUpdateState((state) => {
      setUpdateState(state)
      if (state.status === 'downloaded' && state.version && notifiedUpdateRef.current !== state.version) {
        notifiedUpdateRef.current = state.version
        notify(`新版本 v${state.version} 已下载，点击底部状态可重启安装`)
      }
      if (state.status === 'error' && state.message) {
        console.warn('Update check failed:', state.message)
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [notify])

  const handleUpdateAction = useCallback(async () => {
    if (updateState.status === 'downloaded') {
      const installing = await window.quickCut.installUpdate()
      if (!installing) notify('更新尚未准备好，请稍后重试', 'error')
      return
    }
    if (updateState.status === 'checking' || updateState.status === 'downloading') return
    try {
      const next = await window.quickCut.checkForUpdates()
      setUpdateState(next)
      if (next.status === 'not-available') notify('当前已经是最新版本')
      if (next.status === 'error') notify(`检查更新失败：${next.message || '网络不可用'}`, 'error')
    } catch (error) {
      notify(`检查更新失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }, [notify, updateState.status])

  const setPlayhead = useCallback((time: number) => {
    const total = getTotalDuration(projectRef.current)
    setPlayheadState(clamp(Number.isFinite(time) ? time : 0, 0, total || 0))
  }, [])

  const pushSnapshot = useCallback((snapshot: Project) => {
    setHistory((items) => [...items.slice(-79), snapshot])
    setFuture([])
  }, [])

  const onBeginInteraction = useCallback(() => {
    const snapshot = projectRef.current
    if (interactionSnapshotRef.current === snapshot) return
    interactionSnapshotRef.current = snapshot
    pushSnapshot(snapshot)
    window.setTimeout(() => { interactionSnapshotRef.current = null }, 120)
  }, [pushSnapshot])

  const onUpdateProject = useCallback((updater: (current: Project) => Project, recordHistory = true) => {
    const current = projectRef.current
    const next = updater(current)
    if (next === current) return
    if (recordHistory) pushSnapshot(current)
    const stamped = withTimestamp(next)
    projectRef.current = stamped
    setProject(stamped)
    setSaved(false)
  }, [pushSnapshot])

  const onUpdateClip = useCallback((clipId: string, patch: Partial<Clip>, recordHistory = true) => {
    onUpdateProject((current) => ({
      ...current,
      clips: current.clips.map((clip) => clip.id === clipId
        ? {
            ...clip,
            ...patch,
            inPoint: patch.inPoint !== undefined ? clamp(patch.inPoint, 0, clip.outPoint - 0.03) : clip.inPoint,
            outPoint: patch.outPoint !== undefined ? clamp(patch.outPoint, clip.inPoint + 0.03, current.media?.duration || patch.outPoint) : clip.outPoint,
            fadeIn: patch.fadeIn !== undefined ? Math.max(0, patch.fadeIn) : clip.fadeIn,
            fadeOut: patch.fadeOut !== undefined ? Math.max(0, patch.fadeOut) : clip.fadeOut,
          }
        : clip),
    }), recordHistory)
  }, [onUpdateProject])

  const onUpdateText = useCallback((textId: string, patch: Partial<TextOverlay>, recordHistory = true) => {
    onUpdateProject((current) => ({
      ...current,
      texts: current.texts.map((text) => text.id === textId ? { ...text, ...patch } : text),
    }), recordHistory)
  }, [onUpdateProject])

  const undo = useCallback(() => {
    if (!history.length) return
    const previous = history[history.length - 1]
    setHistory((items) => items.slice(0, -1))
    setFuture((items) => [projectRef.current, ...items].slice(0, 80))
    setProject(previous)
    setSaved(false)
    setIsPlaying(false)
  }, [history])

  const redo = useCallback(() => {
    if (!future.length) return
    const next = future[0]
    setFuture((items) => items.slice(1))
    setHistory((items) => [...items, projectRef.current].slice(-80))
    setProject(next)
    setSaved(false)
    setIsPlaying(false)
  }, [future])

  const importVideo = useCallback(async () => {
    try {
      const media = await window.quickCut.chooseVideo()
      if (!media) return
      if (projectRef.current.clips.length > 0) {
        const confirmed = window.confirm('导入新视频会替换当前时间线。当前工程尚未另存时，建议先保存。继续吗？')
        if (!confirmed) return
      }
      const clip = createClipFromMedia(media)
      const base = createEmptyProject()
      const next: Project = {
        ...base,
        name: fileNameWithoutExtension(media.name),
        media,
        clips: [clip],
        fps: media.fps >= 50 ? 60 : 30,
      }
      pushSnapshot(projectRef.current)
      setProject(next)
      setProjectPath('')
      setSaved(false)
      setPlayheadState(0)
      setSelectedClipId(clip.id)
      setSelectedTextId(null)
      setIsPlaying(false)
      notify(`已导入 ${media.name}`)
    } catch (error) {
      notify(`导入失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }, [notify, pushSnapshot])

  const saveProject = useCallback(async () => {
    try {
      const result = await window.quickCut.saveProject(projectRef.current, projectPath)
      if (result.cancelled) return
      setProjectPath(result.path)
      setSaved(true)
      notify('工程已保存')
    } catch (error) {
      notify(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }, [notify, projectPath])

  const openProject = useCallback(async () => {
    if (projectRef.current.clips.length > 0 && !saved) {
      const confirmed = window.confirm('当前工程有未保存的更改。仍要打开其他工程吗？')
      if (!confirmed) return
    }
    try {
      const result = await window.quickCut.openProject()
      if (!result) return
      setProject(result.project)
      setProjectPath(result.path)
      setHistory([])
      setFuture([])
      setSaved(true)
      setPlayheadState(0)
      setSelectedClipId(result.project.clips[0]?.id || null)
      setSelectedTextId(null)
      setIsPlaying(false)
      notify('工程已打开')
    } catch (error) {
      notify(`打开失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }, [notify, saved])

  const renameProject = (name: string) => {
    onUpdateProject((current) => ({ ...current, name }), false)
  }

  const splitClip = useCallback(() => {
    const current = projectRef.current
    const segments = getTimelineSegments(current)
    const segment = segments.find((item) => playhead > item.start + 0.04 && playhead < item.end - 0.04)
    if (!segment) {
      notify('请把播放头放到片段内部再分割', 'error')
      return
    }
    const sourceCut = segment.clip.inPoint + (playhead - segment.start) * segment.clip.speed
    if (sourceCut <= segment.clip.inPoint + 0.03 || sourceCut >= segment.clip.outPoint - 0.03) {
      notify('切点距离片段边缘太近', 'error')
      return
    }
    const left: Clip = { ...segment.clip, outPoint: sourceCut }
    const right: Clip = { ...segment.clip, id: createId('clip'), inPoint: sourceCut }
    pushSnapshot(current)
    const splitClips = current.clips
      .flatMap((clip) => clip.id === segment.clip.id ? [left, right] : [clip])
      .map((clip, index) => ({ ...clip, label: `片段 ${index + 1}` }))
    const newProject = withTimestamp({ ...current, clips: splitClips })
    projectRef.current = newProject
    setProject(newProject)
    setSelectedClipId(right.id)
    setSelectedTextId(null)
    setSaved(false)
    setIsPlaying(false)
    notify('已在播放头处分割')
  }, [notify, playhead, pushSnapshot])

  const deleteClip = useCallback(() => {
    if (!selectedClipId) return
    const current = projectRef.current
    const index = current.clips.findIndex((clip) => clip.id === selectedClipId)
    if (index < 0) return
    const clips = current.clips.filter((clip) => clip.id !== selectedClipId)
    pushSnapshot(current)
    const next = withTimestamp({ ...current, clips })
    setProject(next)
    setSaved(false)
    setSelectedClipId(clips[Math.min(index, clips.length - 1)]?.id || null)
    setIsPlaying(false)
    setPlayheadState((time) => clamp(time, 0, getTotalDuration(next)))
    notify('片段已删除')
  }, [notify, pushSnapshot, selectedClipId])

  const duplicateClip = useCallback(() => {
    if (!selectedClipId) return
    const current = projectRef.current
    const index = current.clips.findIndex((clip) => clip.id === selectedClipId)
    if (index < 0) return
    const copy: Clip = { ...current.clips[index], id: createId('clip'), label: `${current.clips[index].label} 副本` }
    const clips = [...current.clips]
    clips.splice(index + 1, 0, copy)
    pushSnapshot(current)
    setProject(withTimestamp({ ...current, clips }))
    setSelectedClipId(copy.id)
    setSaved(false)
    notify('片段已复制')
  }, [notify, pushSnapshot, selectedClipId])

  const addText = useCallback(() => {
    const current = projectRef.current
    const total = getTotalDuration(current)
    if (total <= 0) {
      notify('请先导入视频', 'error')
      return
    }
    const start = clamp(playhead, 0, Math.max(0, total - 0.1))
    const end = Math.min(total, start + 3)
    const text: TextOverlay = {
      id: createId('text'),
      text: '输入文字',
      start,
      end: end > start ? end : total,
      x: 50,
      y: 82,
      fontSize: 5.5,
      color: '#ffffff',
      background: '#000000',
      opacity: 1,
      bold: true,
    }
    pushSnapshot(current)
    setProject(withTimestamp({ ...current, texts: [...current.texts, text] }))
    setSelectedTextId(text.id)
    setSelectedClipId(null)
    setSaved(false)
    notify('已添加文字图层')
  }, [notify, playhead, pushSnapshot])

  const deleteText = useCallback((id: string) => {
    const current = projectRef.current
    pushSnapshot(current)
    setProject(withTimestamp({ ...current, texts: current.texts.filter((text) => text.id !== id) }))
    setSelectedTextId(null)
    setSaved(false)
    notify('文字已删除')
  }, [notify, pushSnapshot])

  const setInAtPlayhead = useCallback(() => {
    if (!selectedClipId) return
    const segment = getTimelineSegments(projectRef.current).find((item) => item.clip.id === selectedClipId)
    if (!segment || playhead <= segment.start || playhead >= segment.end) return
    const sourceTime = segment.clip.inPoint + (playhead - segment.start) * segment.clip.speed
    onUpdateClip(selectedClipId, { inPoint: sourceTime })
  }, [onUpdateClip, playhead, selectedClipId])

  const setOutAtPlayhead = useCallback(() => {
    if (!selectedClipId) return
    const segment = getTimelineSegments(projectRef.current).find((item) => item.clip.id === selectedClipId)
    if (!segment || playhead <= segment.start || playhead >= segment.end) return
    const sourceTime = segment.clip.inPoint + (playhead - segment.start) * segment.clip.speed
    onUpdateClip(selectedClipId, { outPoint: sourceTime })
  }, [onUpdateClip, playhead, selectedClipId])

  const stepPlayhead = useCallback((seconds: number) => {
    setIsPlaying(false)
    setPlayhead(playhead + seconds)
  }, [playhead, setPlayhead])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      const command = event.ctrlKey || event.metaKey
      if (command && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveProject()
        return
      }
      if (typing) return
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (command && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (command && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateClip()
        return
      }
      if (command && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        openProject()
        return
      }
      if (event.code === 'Space') {
        event.preventDefault()
        setIsPlaying((playing) => !playing)
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        splitClip()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (selectedTextId) deleteText(selectedTextId)
        else deleteClip()
      } else if (event.key.toLowerCase() === 't') {
        event.preventDefault()
        addText()
      } else if (event.key.toLowerCase() === 'i') {
        event.preventDefault()
        setInAtPlayhead()
      } else if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        setOutAtPlayhead()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        stepPlayhead(event.shiftKey ? -1 : -1 / projectRef.current.fps)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        stepPlayhead(event.shiftKey ? 1 : 1 / projectRef.current.fps)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addText, deleteClip, deleteText, duplicateClip, openProject, redo, saveProject, selectedTextId, setInAtPlayhead, setOutAtPlayhead, splitClip, stepPlayhead, undo])

  const totalDuration = getTotalDuration(project)

  return (
    <div className="app-shell">
      <TopBar
        projectName={project.name}
        onRename={renameProject}
        onImport={importVideo}
        onOpen={openProject}
        onSave={saveProject}
        onExport={() => setExportOpen(true)}
        onUndo={undo}
        onRedo={redo}
        canUndo={history.length > 0}
        canRedo={future.length > 0}
        saved={saved}
        hasMedia={Boolean(project.media && project.clips.length)}
      />

      <main className="workspace">
        <MediaPanel media={project.media} clipCount={project.clips.length} totalDuration={totalDuration} onImport={importVideo} />
        <Preview
          project={project}
          playhead={playhead}
          setPlayhead={setPlayhead}
          isPlaying={isPlaying}
          setIsPlaying={setIsPlaying}
          onUpdateClip={onUpdateClip}
          onImport={importVideo}
          notify={notify}
        />
        <Inspector
          project={project}
          playhead={playhead}
          selectedClipId={selectedClipId}
          selectedTextId={selectedTextId}
          onUpdateProject={onUpdateProject}
          onUpdateClip={onUpdateClip}
          onUpdateText={onUpdateText}
          onSelectText={(id) => {
            setSelectedTextId(id)
            setSelectedClipId(null)
          }}
          onSetInAtPlayhead={setInAtPlayhead}
          onSetOutAtPlayhead={setOutAtPlayhead}
          onAddText={addText}
          onDeleteText={deleteText}
          onOpenExport={() => setExportOpen(true)}
        />
      </main>

      <Timeline
        project={project}
        playhead={playhead}
        setPlayhead={setPlayhead}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        selectedClipId={selectedClipId}
        setSelectedClipId={setSelectedClipId}
        selectedTextId={selectedTextId}
        setSelectedTextId={setSelectedTextId}
        onUpdateProject={onUpdateProject}
        onUpdateClip={onUpdateClip}
        onBeginInteraction={onBeginInteraction}
        onSplit={splitClip}
        onDeleteClip={deleteClip}
        onDuplicateClip={duplicateClip}
        onAddText={addText}
        onDeleteText={deleteText}
      />

      <footer className="statusbar">
        <span className="status-item"><span className="status-light" />本地处理</span>
        <span className="status-item"><HardDrive size={12} />{project.media ? `${project.media.width}×${project.media.height} · ${Math.round(project.media.fps)} FPS` : '未导入素材'}</span>
        <span className="status-item"><Info size={12} />FFmpeg 已就绪</span>
        <button
          className={`status-update is-${updateState.status}`}
          onClick={handleUpdateAction}
          title={updateState.message || (updateState.status === 'downloaded' ? '重启并安装新版本' : '检查 GitHub Releases 更新')}
          disabled={updateState.status === 'checking' || updateState.status === 'downloading' || updateState.status === 'available'}
        >
          {updateState.status === 'downloaded' ? <Download size={12} /> : <RefreshCw size={12} className={updateState.status === 'checking' || updateState.status === 'available' || updateState.status === 'downloading' ? 'spin' : ''} />}
          <span>{updateLabel(updateState)}</span>
        </button>
        <span className="status-version">v{appInfo.version} · {appInfo.platform}</span>
      </footer>

      <ExportDialog
        open={exportOpen}
        project={project}
        onClose={() => setExportOpen(false)}
        notify={notify}
      />

      {toast && (
        <div className={`toast ${toast.tone === 'error' ? 'is-error' : ''}`} key={toast.id}>
          {toast.tone === 'error' ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)}><X size={14} /></button>
        </div>
      )}
    </div>
  )
}



