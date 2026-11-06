import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Expand,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react'
import type { Clip, Project } from '../types'
import { clamp, formatTime, getTimelineSegments, getTotalDuration } from '../lib/project'

interface PreviewProps {
  project: Project
  playhead: number
  setPlayhead: (time: number) => void
  isPlaying: boolean
  setIsPlaying: (playing: boolean) => void
  onUpdateClip: (clipId: string, patch: Partial<Clip>, recordHistory?: boolean) => void
  onImport: () => void
  notify: (message: string, tone?: 'normal' | 'error') => void
}

function ratioCss(ratio: Project['aspectRatio']) {
  return ratio.replace(':', ' / ')
}

function rgba(hex: string, alpha: number) {
  const value = hex.replace('#', '')
  if (value.length !== 6) return `rgba(0,0,0,${alpha})`
  const [red, green, blue] = [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)].map((part) => parseInt(part, 16))
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function Preview({
  project,
  playhead,
  setPlayhead,
  isPlaying,
  setIsPlaying,
  onUpdateClip,
  onImport,
  notify,
}: PreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef(playhead)
  const [videoError, setVideoError] = useState(false)
  const segments = useMemo(() => getTimelineSegments(project), [project])
  const totalDuration = useMemo(() => getTotalDuration(project), [project])
  const currentSegment = useMemo(() => {
    if (!segments.length) return null
    return segments.find((segment) => playhead >= segment.start && playhead < segment.end)
      || (playhead >= totalDuration ? segments[segments.length - 1] : segments[0])
  }, [segments, playhead, totalDuration])
  const currentClip = currentSegment?.clip || null
  const activeTexts = project.texts.filter((text) => playhead >= text.start && playhead <= text.end)

  useEffect(() => {
    playheadRef.current = playhead
  }, [playhead])

  const seekVideo = (time: number) => {
    const video = videoRef.current
    if (!video || !project.media) return
    const target = clamp(time, 0, Math.max(0, project.media.duration - 0.03))
    if (Number.isFinite(target) && Math.abs(video.currentTime - target) > 0.01) {
      try { video.currentTime = target } catch { /* media may not be ready yet */ }
    }
  }

  useEffect(() => {
    if (!currentSegment || !project.media) return
    const desired = currentSegment.clip.inPoint + (playhead - currentSegment.start) * currentSegment.clip.speed
    const video = videoRef.current
    if (!video) return
    if (!isPlaying || Math.abs(video.currentTime - desired) > 0.35) seekVideo(desired)
  }, [playhead, currentSegment?.clip.id, currentSegment?.start, project.media?.mediaUrl, isPlaying])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!isPlaying || !currentClip) {
      video.pause()
      return
    }
    video.playbackRate = clamp(currentClip.speed, 0.25, 4)
    video.volume = currentClip.muted ? 0 : clamp(currentClip.volume, 0, 1)
    video.play().catch(() => {
      setIsPlaying(false)
      notify('当前视频无法预览播放，可以继续剪辑并直接导出', 'error')
    })
  }, [isPlaying, currentClip?.id, currentClip?.speed, currentClip?.volume, currentClip?.muted, project.media?.mediaUrl])

  useEffect(() => {
    if (!isPlaying || !segments.length) return
    let frame = 0
    const tick = () => {
      const video = videoRef.current
      if (!video) return
      const liveSegments = getTimelineSegments(project)
      const seg = liveSegments.find((item) => playheadRef.current >= item.start && playheadRef.current < item.end)
      if (!seg) {
        setIsPlaying(false)
        return
      }
      if (video.currentTime >= seg.clip.outPoint - 0.025) {
        const next = liveSegments[seg.index + 1]
        if (next) {
          playheadRef.current = next.start
          setPlayhead(next.start)
          video.currentTime = next.clip.inPoint
          video.playbackRate = clamp(next.clip.speed, 0.25, 4)
          video.volume = next.clip.muted ? 0 : clamp(next.clip.volume, 0, 1)
          video.play().catch(() => setIsPlaying(false))
        } else {
          video.pause()
          playheadRef.current = totalDuration
          setPlayhead(totalDuration)
          setIsPlaying(false)
          return
        }
      } else {
        const nextTime = clamp(
          seg.start + (video.currentTime - seg.clip.inPoint) / Math.max(0.25, seg.clip.speed),
          seg.start,
          seg.end,
        )
        playheadRef.current = nextTime
        setPlayhead(nextTime)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying, project, segments.length, totalDuration, setPlayhead, setIsPlaying])

  const togglePlay = () => {
    if (!segments.length) return
    if (playhead >= totalDuration - 0.02) {
      setPlayhead(segments[0].start)
      seekVideo(segments[0].clip.inPoint)
    }
    setIsPlaying(!isPlaying)
  }

  const step = (seconds: number) => {
    if (!segments.length) return
    setIsPlaying(false)
    const next = clamp(playhead + seconds, 0, totalDuration)
    setPlayhead(next)
    const seg = segments.find((item) => next >= item.start && next < item.end) || segments[segments.length - 1]
    seekVideo(seg.clip.inPoint + (next - seg.start) * seg.clip.speed)
  }

  const changeVolume = (value: number) => {
    if (!currentClip) return
    onUpdateClip(currentClip.id, { volume: value, muted: value <= 0.001 }, false)
  }

  const handleSeekBar = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!totalDuration) return
    const rect = event.currentTarget.getBoundingClientRect()
    const next = clamp((event.clientX - rect.left) / rect.width, 0, 1) * totalDuration
    setIsPlaying(false)
    setPlayhead(next)
    const seg = segments.find((item) => next >= item.start && next < item.end) || segments[segments.length - 1]
    if (seg) seekVideo(seg.clip.inPoint + (next - seg.start) * seg.clip.speed)
  }

  const enterFullscreen = () => stageRef.current?.requestFullscreen?.()

  return (
    <section className="preview-panel">
      <div className="preview-heading">
        <div>
          <span className="eyebrow">节目监视器</span>
          <h2>{currentClip?.label || '视频预览'}</h2>
        </div>
        <div className="preview-heading-right">
          <span className="format-chip">{project.resolution} · {project.aspectRatio}</span>
          <button className="icon-button" onClick={enterFullscreen} title="全屏预览"><Expand size={16} /></button>
        </div>
      </div>

      <div className="preview-stage" ref={stageRef}>
        {project.media ? (
          <div
            className="video-frame"
            style={{
              aspectRatio: ratioCss(project.aspectRatio),
              background: '#080907',
            }}
          >
            <video
              ref={videoRef}
              src={project.media.mediaUrl}
              preload="auto"
              playsInline
              style={{
                objectFit: project.fitMode === 'fill' ? 'cover' : 'contain',
                filter: `brightness(${1 + project.filters.brightness}) contrast(${1 + project.filters.contrast}) saturate(${1 + project.filters.saturation})`,
                transform: `scaleX(${project.transform.flipX ? -1 : 1}) scaleY(${project.transform.flipY ? -1 : 1})`,
              }}
              onLoadedMetadata={() => {
                setVideoError(false)
                if (currentSegment) {
                  seekVideo(currentSegment.clip.inPoint + (playhead - currentSegment.start) * currentSegment.clip.speed)
                }
              }}
              onError={() => setVideoError(true)}
            />
            {activeTexts.map((text) => (
              <div
                key={text.id}
                className="preview-text-overlay"
                style={{
                  left: `${text.x}%`,
                  top: `${text.y}%`,
                  color: text.color,
                  background: rgba(text.background, 0.72),
                  opacity: text.opacity,
                  fontSize: `${text.fontSize}cqh`,
                  fontWeight: text.bold ? 800 : 500,
                }}
              >
                {text.text}
              </div>
            ))}
            {videoError && (
              <div className="video-error">
                <strong>此编码暂不支持浏览器预览</strong>
                <span>仍可正常裁剪和导出，建议素材使用 H.264 MP4。</span>
              </div>
            )}
          </div>
        ) : (
          <div className="preview-empty">
            <div className="preview-empty-icon"><Play size={30} /></div>
            <button className="primary-button" onClick={onImport}><Upload size={16} />导入全局对局</button>
          </div>
        )}
      </div>

      <div className="transport">
        <div className="seek-track" onClick={handleSeekBar}>
          <span style={{ width: totalDuration ? `${clamp(playhead / totalDuration, 0, 1) * 100}%` : '0%' }} />
        </div>
        <div className="transport-row">
          <div className="transport-time">
            <strong>{formatTime(playhead)}</strong>
            <span>/ {formatTime(totalDuration)}</span>
          </div>
          <div className="transport-center">
            <button className="icon-button" title="上一段" onClick={() => {
              const previous = [...segments].reverse().find((segment) => segment.start < playhead - 0.15)
              if (previous) { setIsPlaying(false); setPlayhead(previous.start); seekVideo(previous.clip.inPoint) }
            }} disabled={!segments.length}><SkipBack size={18} /></button>
            <button className="icon-button" title="后退一帧" onClick={() => step(-1 / project.fps)} disabled={!segments.length}><ChevronLeft size={18} /></button>
            <button className="play-button" onClick={togglePlay} disabled={!segments.length} title={isPlaying ? '暂停 (Space)' : '播放 (Space)'}>
              {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </button>
            <button className="icon-button" title="前进一帧" onClick={() => step(1 / project.fps)} disabled={!segments.length}><ChevronRight size={18} /></button>
            <button className="icon-button" title="下一段" onClick={() => {
              const next = segments.find((segment) => segment.start > playhead + 0.01)
              if (next) { setIsPlaying(false); setPlayhead(next.start); seekVideo(next.clip.inPoint) }
            }} disabled={!segments.length}><SkipForward size={18} /></button>
          </div>
          <div className="transport-volume">
            <button
              className="icon-button"
              title={currentClip?.muted ? '取消静音' : '静音'}
              onClick={() => currentClip && onUpdateClip(currentClip.id, { muted: !currentClip.muted })}
              disabled={!currentClip}
            >
              {currentClip?.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={currentClip?.muted ? 0 : currentClip?.volume || 0}
              onChange={(event) => changeVolume(Number(event.target.value))}
              disabled={!currentClip}
              aria-label="预览音量"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
