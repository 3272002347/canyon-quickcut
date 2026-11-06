import type { Project, TimelineSegment } from '../types'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clipDuration(clip: { inPoint: number; outPoint: number; speed: number }): number {
  return Math.max(0, (clip.outPoint - clip.inPoint) / clip.speed)
}

export function getTimelineSegments(project: Project): TimelineSegment[] {
  let cursor = 0
  return project.clips.map((clip, index) => {
    const duration = clipDuration(clip)
    const segment = { clip, index, start: cursor, end: cursor + duration, duration }
    cursor += duration
    return segment
  })
}

export function getTotalDuration(project: Project): number {
  return project.clips.reduce((total, clip) => total + clipDuration(clip), 0)
}

export function formatTime(seconds: number, withMs = true): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = Math.floor(safe % 60)
  const millis = Math.floor((safe % 1) * 1000)
  const base = hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return withMs ? `${base}.${String(millis).padStart(3, '0')}` : base
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, seconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = Math.round(safe % 60)
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  if (minutes > 0) return `${minutes} 分 ${secs} 秒`
  return `${secs} 秒`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index >= 3 ? 2 : 1)} ${units[index]}`
}

export function parseTimecode(input: string): number | null {
  const value = input.trim().replace(',', '.')
  if (!value) return null
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value)
  const parts = value.split(':').map(Number)
  if (parts.some((part) => Number.isNaN(part))) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function fileNameWithoutExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

export function resolutionSize(aspectRatio: Project['aspectRatio'], preset: Project['resolution']): { width: number; height: number } {
  const longEdge = preset === '2160p' ? 3840 : preset === '1080p' ? 1920 : 1280
  if (aspectRatio === '16:9') {
    return preset === '2160p' ? { width: 3840, height: 2160 } : preset === '1080p' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 }
  }
  if (aspectRatio === '9:16') {
    return preset === '2160p' ? { width: 2160, height: 3840 } : preset === '1080p' ? { width: 1080, height: 1920 } : { width: 720, height: 1280 }
  }
  if (aspectRatio === '1:1') {
    return preset === '2160p' ? { width: 2160, height: 2160 } : preset === '1080p' ? { width: 1080, height: 1080 } : { width: 720, height: 720 }
  }
  return preset === '2160p' ? { width: 2160, height: 2700 } : preset === '1080p' ? { width: 1080, height: 1350 } : { width: 720, height: 900 }
}

export function createEmptyProject(): Project {
  const now = new Date().toISOString()
  return {
    version: 1,
    id: createId('project'),
    name: '未命名工程',
    media: null,
    clips: [],
    texts: [],
    aspectRatio: '16:9',
    fitMode: 'fit',
    resolution: '1080p',
    fps: 60,
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    transform: { flipX: false, flipY: false },
    createdAt: now,
    updatedAt: now,
  }
}
