import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  GripVertical,
  Magnet,
  Maximize2,
  Minus,
  Plus,
  Scissors,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { Clip, Project, TextOverlay, TimelineSegment } from '../types'
import { clamp, formatTime, getTimelineSegments, getTotalDuration } from '../lib/project'

interface TimelineProps {
  project: Project
  playhead: number
  setPlayhead: (time: number) => void
  isPlaying: boolean
  setIsPlaying: (playing: boolean) => void
  selectedClipId: string | null
  setSelectedClipId: (id: string | null) => void
  selectedTextId: string | null
  setSelectedTextId: (id: string | null) => void
  onUpdateProject: (updater: (project: Project) => Project, recordHistory?: boolean) => void
  onUpdateClip: (clipId: string, patch: Partial<Clip>, recordHistory?: boolean) => void
  onBeginInteraction: () => void
  onSplit: () => void
  onDeleteClip: () => void
  onDuplicateClip: () => void
  onAddText: () => void
  onDeleteText: (id: string) => void
}

const TRACK_HEIGHT = 76
const AUDIO_HEIGHT = 32
const TEXT_HEIGHT = 25

function chooseTickInterval(pxPerSecond: number) {
  const candidates = [0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  return candidates.find((value) => value * pxPerSecond >= 66) || 900
}

function markerText(seconds: number, interval: number) {
  if (interval < 1) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return minutes > 0 ? `${minutes}:${String(secs).padStart(2, '0')}` : `${secs}s`
}

function nearestSnap(value: number, candidates: number[], tolerance: number) {
  let result = value
  let best = tolerance
  candidates.forEach((candidate) => {
    const distance = Math.abs(candidate - value)
    if (distance < best) {
      best = distance
      result = candidate
    }
  })
  return result
}

export function Timeline({
  project,
  playhead,
  setPlayhead,
  isPlaying,
  setIsPlaying,
  selectedClipId,
  setSelectedClipId,
  selectedTextId,
  setSelectedTextId,
  onUpdateProject,
  onUpdateClip,
  onBeginInteraction,
  onSplit,
  onDeleteClip,
  onDuplicateClip,
  onAddText,
  onDeleteText,
}: TimelineProps) {
  const [pxPerSec, setPxPerSec] = useState(3)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [viewportWidth, setViewportWidth] = useState(900)
  const viewportRef = useRef<HTMLDivElement>(null)
  const initializedMedia = useRef('')
  const segments = useMemo(() => getTimelineSegments(project), [project])
  const totalDuration = useMemo(() => getTotalDuration(project), [project])
  const tickInterval = chooseTickInterval(pxPerSec)
  const ticks = useMemo(() => {
    const values: number[] = []
    for (let time = 0; time <= totalDuration + tickInterval * 0.5; time += tickInterval) values.push(time)
    return values
  }, [totalDuration, tickInterval])
  const canvasWidth = Math.max(viewportWidth, totalDuration * pxPerSec + 72)
  const playheadX = playhead * pxPerSec

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setViewportWidth(element.clientWidth))
    observer.observe(element)
    setViewportWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!project.media?.path || initializedMedia.current === project.media.path || !viewportWidth) return
    initializedMedia.current = project.media.path
    const fit = clamp((viewportWidth - 54) / Math.max(8, totalDuration), 0.08, 28)
    setPxPerSec(fit)
  }, [project.media?.path, totalDuration, viewportWidth])

  const timeFromPointer = (event: PointerEvent | React.PointerEvent, element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    return clamp((event.clientX - rect.left) / pxPerSec, 0, totalDuration)
  }

  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    setIsPlaying(false)
    const element = event.currentTarget
    setPlayhead(timeFromPointer(event, element))
    const move = (pointerEvent: PointerEvent) => setPlayhead(timeFromPointer(pointerEvent, element))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const updateClipDrag = (segment: TimelineSegment, side: 'left' | 'right', event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsPlaying(false)
    setSelectedClipId(segment.clip.id)
    onBeginInteraction()
    const startX = event.clientX
    const originalIn = segment.clip.inPoint
    const originalOut = segment.clip.outPoint
    const speed = segment.clip.speed
    const mediaDuration = project.media?.duration || originalOut
    const candidates = [0, mediaDuration, ...segments.map((item) => item.clip.inPoint), ...segments.map((item) => item.clip.outPoint)]
    if (playhead >= segment.start && playhead <= segment.end) {
      candidates.push(segment.clip.inPoint + (playhead - segment.start) * speed)
    }
    const move = (pointerEvent: PointerEvent) => {
      const secondsDelta = ((pointerEvent.clientX - startX) / pxPerSec) * speed
      const tolerance = (10 / pxPerSec) * speed
      if (side === 'left') {
        let nextIn = clamp(originalIn + secondsDelta, 0, originalOut - 0.05)
        if (snapEnabled) nextIn = nearestSnap(nextIn, candidates, tolerance)
        onUpdateClip(segment.clip.id, { inPoint: clamp(nextIn, 0, originalOut - 0.05) }, false)
      } else {
        let nextOut = clamp(originalOut + secondsDelta, originalIn + 0.05, mediaDuration)
        if (snapEnabled) nextOut = nearestSnap(nextOut, candidates, tolerance)
        onUpdateClip(segment.clip.id, { outPoint: clamp(nextOut, originalIn + 0.05, mediaDuration) }, false)
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const reorderClip = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return
    onBeginInteraction()
    onUpdateProject((current) => {
      const from = current.clips.findIndex((clip) => clip.id === draggedId)
      const to = current.clips.findIndex((clip) => clip.id === targetId)
      if (from < 0 || to < 0) return current
      const clips = [...current.clips]
      const [moved] = clips.splice(from, 1)
      clips.splice(to, 0, moved)
      return { ...current, clips }
    }, false)
  }

  const zoomBy = (factor: number) => setPxPerSec((value) => clamp(value * factor, 0.08, 40))

  return (
    <section className="timeline-panel">
      <div className="timeline-toolbar">
        <div className="timeline-tool-group">
          <button className="icon-button" title="在播放头处分割 (S)" onClick={onSplit} disabled={!project.clips.length}><Scissors size={16} /></button>
          <button className="icon-button" title="复制片段 (Ctrl+D)" onClick={onDuplicateClip} disabled={!selectedClipId}><Copy size={16} /></button>
          <button className="icon-button danger-hover" title="删除片段 (Delete)" onClick={onDeleteClip} disabled={!selectedClipId}><Trash2 size={16} /></button>
          <span className="toolbar-divider" />
          <button className={`icon-button${snapEnabled ? ' is-active' : ''}`} title="吸附" onClick={() => setSnapEnabled(!snapEnabled)}><Magnet size={16} /></button>
          <button className="text-tool-button" onClick={onAddText} title="添加文字 (T)"><Type size={15} />文字</button>
        </div>

        <div className="timeline-time-readout">
          <span>播放头</span>
          <strong>{formatTime(playhead)}</strong>
        </div>

        <div className="timeline-zoom">
          <button className="icon-button small" title="缩小时间线" onClick={() => zoomBy(0.72)}><ZoomOut size={15} /></button>
          <button className="icon-button small" title="缩小" onClick={() => zoomBy(0.82)}><Minus size={13} /></button>
          <input
            type="range"
            min="0.08"
            max="40"
            step="0.01"
            value={pxPerSec}
            onChange={(event) => setPxPerSec(Number(event.target.value))}
            aria-label="时间线缩放"
          />
          <button className="icon-button small" title="放大" onClick={() => zoomBy(1.22)}><Plus size={13} /></button>
          <button className="icon-button small" title="放大时间线" onClick={() => zoomBy(1.45)}><ZoomIn size={15} /></button>
          <button className="icon-button small" title="适应窗口" onClick={() => setPxPerSec(clamp((viewportWidth - 54) / Math.max(8, totalDuration), 0.08, 40))}><Maximize2 size={14} /></button>
        </div>
      </div>

      <div className="timeline-body">
        <div className="timeline-track-labels">
          <div className="ruler-spacer">时间</div>
          <div className="track-label video-label" style={{ height: TRACK_HEIGHT }}><span>V1</span><small>主视频</small></div>
          <div className="track-label audio-label" style={{ height: AUDIO_HEIGHT }}><span>A1</span><small>原声</small></div>
          <div className="track-label text-label" style={{ height: TEXT_HEIGHT }}><span>T1</span><small>文字</small></div>
        </div>

        <div className="timeline-scroll" ref={viewportRef}>
          <div
            className="timeline-canvas"
            style={{ width: canvasWidth }}
            onWheel={(event) => {
              if (!event.ctrlKey) return
              event.preventDefault()
              zoomBy(event.deltaY > 0 ? 0.9 : 1.1)
            }}
          >
            <div className="time-ruler" onPointerDown={seekFromPointer}>
              {ticks.map((tick) => (
                <div key={tick} className="ruler-tick" style={{ left: tick * pxPerSec }}>
                  <span>{markerText(tick, tickInterval)}</span>
                </div>
              ))}
            </div>

            <div className="video-track track" style={{ height: TRACK_HEIGHT }} onPointerDown={seekFromPointer}>
              {segments.map((segment) => {
                const width = Math.max(5, segment.duration * pxPerSec)
                const midpoint = segment.clip.inPoint + (segment.clip.outPoint - segment.clip.inPoint) / 2
                const selected = selectedClipId === segment.clip.id
                return (
                  <div
                    key={segment.clip.id}
                    className={`timeline-clip${selected ? ' is-selected' : ''}`}
                    style={{ left: segment.start * pxPerSec, width }}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', segment.clip.id)
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault()
                      const draggedId = event.dataTransfer.getData('text/plain')
                      if (draggedId) reorderClip(draggedId, segment.clip.id)
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      setSelectedClipId(segment.clip.id)
                      setSelectedTextId(null)
                    }}
                  >
                    {project.media && (
                      <img
                        className="clip-thumb"
                        src={`${project.media.thumbnailBase}?t=${midpoint}`}
                        alt=""
                        draggable={false}
                      />
                    )}
                    <div className="clip-scrim" />
                    <div className="clip-topline">
                      <GripVertical size={12} />
                      <strong>{segment.clip.label}</strong>
                      <span>{formatTime(segment.duration, false)}</span>
                    </div>
                    <div className="clip-meta">
                      <span>{formatTime(segment.clip.inPoint, false)} → {formatTime(segment.clip.outPoint, false)}</span>
                      {segment.clip.speed !== 1 && <b>{segment.clip.speed}x</b>}
                    </div>
                    <button
                      className="trim-handle left"
                      title="调整片段入点"
                      onPointerDown={(event) => updateClipDrag(segment, 'left', event)}
                    />
                    <button
                      className="trim-handle right"
                      title="调整片段出点"
                      onPointerDown={(event) => updateClipDrag(segment, 'right', event)}
                    />
                  </div>
                )
              })}
              {!segments.length && <div className="track-empty">分割后的片段会显示在这里</div>}
            </div>

            <div className="audio-track track" style={{ height: AUDIO_HEIGHT }}>
              {segments.map((segment) => (
                <div
                  key={segment.clip.id}
                  className={`audio-clip${segment.clip.muted ? ' is-muted' : ''}`}
                  style={{
                    left: segment.start * pxPerSec,
                    width: Math.max(5, segment.duration * pxPerSec),
                    backgroundImage: project.media?.hasAudio ? `url("${project.media.waveformUrl}")` : undefined,
                    backgroundSize: project.media?.hasAudio ? `${project.media.duration * pxPerSec}px 100%` : undefined,
                    backgroundPositionX: project.media?.hasAudio ? `${-segment.clip.inPoint * pxPerSec}px` : undefined,
                  }}
                  onClick={() => setSelectedClipId(segment.clip.id)}
                />
              ))}
            </div>

            <div className="text-track track" style={{ height: TEXT_HEIGHT }}>
              {project.texts.map((text) => (
                <button
                  key={text.id}
                  className={`text-clip${selectedTextId === text.id ? ' is-selected' : ''}`}
                  style={{
                    left: text.start * pxPerSec,
                    width: Math.max(20, (text.end - text.start) * pxPerSec),
                  }}
                  onClick={() => {
                    setSelectedTextId(text.id)
                    setSelectedClipId(null)
                    setPlayhead(text.start)
                  }}
                  onDoubleClick={() => onDeleteText(text.id)}
                  title={text.text}
                >
                  <Type size={11} />
                  <span>{text.text.replace(/\n/g, ' ')}</span>
                </button>
              ))}
            </div>

            <div className="playhead" style={{ left: playheadX }}>
              <span />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
