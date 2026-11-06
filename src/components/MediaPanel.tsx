import { Film, FolderPlus, HardDrive, Plus, Timer, Video } from 'lucide-react'
import type { MediaInfo } from '../types'
import { formatBytes, formatDuration } from '../lib/project'

interface MediaPanelProps {
  media: MediaInfo | null
  clipCount: number
  totalDuration: number
  onImport: () => void
}

export function MediaPanel({ media, clipCount, totalDuration, onImport }: MediaPanelProps) {
  return (
    <aside className="media-panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">素材</span>
          <h2>视频库</h2>
        </div>
        <button className="icon-button small" title="导入视频" onClick={onImport}><Plus size={16} /></button>
      </div>

      {media ? (
        <div className="media-item">
          <div className="media-thumb-wrap">
            <img
              src={`${media.thumbnailBase}?t=${Math.max(1, media.duration * 0.22)}`}
              alt=""
              draggable={false}
            />
            <span className="media-duration">{formatDuration(media.duration)}</span>
            <button className="thumb-play" onClick={onImport} title="更换视频"><Film size={19} /></button>
          </div>
          <div className="media-name" title={media.name}>{media.name}</div>
          <div className="media-meta-grid">
            <span><Video size={13} />{media.width} x {media.height}</span>
            <span>{Math.round(media.fps)} FPS</span>
            <span><HardDrive size={13} />{formatBytes(media.size)}</span>
            <span>{media.codec.toUpperCase()}</span>
          </div>
          <div className="media-summary">
            <span><Timer size={13} />工程时长</span>
            <strong>{formatDuration(totalDuration || media.duration)}</strong>
          </div>
          <div className="media-summary muted">
            <span>时间线片段</span>
            <strong>{clipCount || 1}</strong>
          </div>
        </div>
      ) : (
        <button className="media-empty" onClick={onImport}>
          <span className="empty-icon"><FolderPlus size={25} /></span>
          <strong>导入对局视频</strong>
          <span>MP4 / MOV / MKV</span>
        </button>
      )}

      <div className="media-panel-footer">
        <span className="status-light" />
        <span>本地处理</span>
        <small>素材不会上传</small>
      </div>
    </aside>
  )
}
