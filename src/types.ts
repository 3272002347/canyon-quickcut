export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5'
export type FitMode = 'fit' | 'fill'
export type ResolutionPreset = '720p' | '1080p' | '2160p'
export type ExportMode = 'precise' | 'fast'
export type ExportQuality = 'draft' | 'balanced' | 'high'

export interface MediaInfo {
  path: string
  name: string
  size: number
  duration: number
  width: number
  height: number
  fps: number
  codec: string
  bitRate: number
  hasAudio: boolean
  mediaUrl: string
  thumbnailBase: string
  waveformUrl: string
}

export interface Clip {
  id: string
  label: string
  inPoint: number
  outPoint: number
  speed: number
  volume: number
  muted: boolean
  fadeIn: number
  fadeOut: number
}

export interface TextOverlay {
  id: string
  text: string
  start: number
  end: number
  x: number
  y: number
  fontSize: number
  color: string
  background: string
  opacity: number
  bold: boolean
}

export interface ColorFilters {
  brightness: number
  contrast: number
  saturation: number
}

export interface TransformSettings {
  flipX: boolean
  flipY: boolean
}

export interface Project {
  version: 1
  id: string
  name: string
  media: MediaInfo | null
  clips: Clip[]
  texts: TextOverlay[]
  aspectRatio: AspectRatio
  fitMode: FitMode
  resolution: ResolutionPreset
  fps: 30 | 60
  filters: ColorFilters
  transform: TransformSettings
  createdAt: string
  updatedAt: string
}

export interface ExportSettings {
  outputPath: string
  mode: ExportMode
  quality: ExportQuality
  openWhenDone: boolean
}

export interface ExportProgress {
  jobId: string
  percent: number
  time: number
  fps: number
  speed: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  message?: string
  outputPath?: string
}

export interface ExportResult {
  jobId: string
  outputPath: string
}

export interface ExportRequest {
  project: Project
  settings: ExportSettings
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  version?: string
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
  message?: string
}

export interface QuickCutApi {
  chooseVideo: () => Promise<MediaInfo | null>
  inspectVideo: (filePath: string) => Promise<MediaInfo>
  saveProject: (project: Project, knownPath?: string) => Promise<{ path: string; cancelled: boolean }>
  openProject: () => Promise<{ project: Project; path: string } | null>
  chooseExportPath: (suggestedName: string) => Promise<string | null>
  startExport: (request: ExportRequest) => Promise<ExportResult>
  cancelExport: (jobId: string) => Promise<boolean>
  revealFile: (filePath: string) => Promise<void>
  getAppInfo: () => Promise<{ version: string; ffmpeg: string; platform: string }>
  getStartupMedia: () => Promise<MediaInfo | null>
  getUpdateState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<UpdateState>
  installUpdate: () => Promise<boolean>
  openReleases: () => Promise<void>
  onUpdateState: (callback: (state: UpdateState) => void) => () => void
  onExportProgress: (callback: (progress: ExportProgress) => void) => () => void
}

export interface TimelineSegment {
  clip: Clip
  index: number
  start: number
  end: number
  duration: number
}


