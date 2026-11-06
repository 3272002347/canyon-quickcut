import { useEffect, useState } from 'react'
import {
  Download,
  FlipHorizontal2,
  FlipVertical2,
  Gauge,
  MonitorPlay,
  Plus,
  RotateCcw,
  Scissors,
  SlidersHorizontal,
  Trash2,
  Type,
  Volume2,
  VolumeX,
} from 'lucide-react'
import type { AspectRatio, Clip, FitMode, Project, ResolutionPreset, TextOverlay } from '../types'
import { clamp, clipDuration, formatDuration, getTotalDuration, resolutionSize } from '../lib/project'
import { Segmented, SliderRow, TimecodeInput, ToggleRow } from './FormControls'

type InspectorTab = 'clip' | 'video' | 'text' | 'export'

interface InspectorProps {
  project: Project
  playhead: number
  selectedClipId: string | null
  selectedTextId: string | null
  onUpdateProject: (updater: (project: Project) => Project, recordHistory?: boolean) => void
  onUpdateClip: (clipId: string, patch: Partial<Clip>, recordHistory?: boolean) => void
  onUpdateText: (textId: string, patch: Partial<TextOverlay>, recordHistory?: boolean) => void
  onSelectText: (textId: string) => void
  onSetInAtPlayhead: () => void
  onSetOutAtPlayhead: () => void
  onAddText: () => void
  onDeleteText: (id: string) => void
  onOpenExport: () => void
}

export function Inspector({
  project,
  playhead,
  selectedClipId,
  selectedTextId,
  onUpdateProject,
  onUpdateClip,
  onUpdateText,
  onSelectText,
  onSetInAtPlayhead,
  onSetOutAtPlayhead,
  onAddText,
  onDeleteText,
  onOpenExport,
}: InspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('clip')
  const selectedClip = project.clips.find((clip) => clip.id === selectedClipId) || null
  const selectedText = project.texts.find((text) => text.id === selectedTextId) || null
  const totalDuration = getTotalDuration(project)
  const output = resolutionSize(project.aspectRatio, project.resolution)

  useEffect(() => {
    if (selectedTextId) setTab('text')
  }, [selectedTextId])

  const tabs: Array<{ id: InspectorTab; label: string; icon: React.ReactNode }> = [
    { id: 'clip', label: '片段', icon: <SlidersHorizontal size={15} /> },
    { id: 'video', label: '画面', icon: <MonitorPlay size={15} /> },
    { id: 'text', label: '文字', icon: <Type size={15} /> },
    { id: 'export', label: '导出', icon: <Download size={15} /> },
  ]

  return (
    <aside className="inspector panel">
      <div className="inspector-tabs">
        {tabs.map((item) => (
          <button key={item.id} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="inspector-content">
        {tab === 'clip' && (
          selectedClip ? (
            <ClipSettings
              clip={selectedClip}
              mediaDuration={project.media?.duration || selectedClip.outPoint}
              playhead={playhead}
              onUpdate={(patch, history) => onUpdateClip(selectedClip.id, patch, history)}
              onSetInAtPlayhead={onSetInAtPlayhead}
              onSetOutAtPlayhead={onSetOutAtPlayhead}
            />
          ) : (
            <div className="inspector-empty">
              <Scissors size={23} />
              <strong>选择一个片段</strong>
              <span>在时间线上点选片段后调整参数。</span>
            </div>
          )
        )}

        {tab === 'video' && (
          <div className="inspector-section-stack">
            <section className="inspector-section">
              <h3>画布</h3>
              <span className="section-label">画面比例</span>
              <Segmented<AspectRatio>
                value={project.aspectRatio}
                onChange={(aspectRatio) => onUpdateProject((current) => ({ ...current, aspectRatio }))}
                options={[
                  { value: '16:9', label: '16:9' },
                  { value: '9:16', label: '9:16' },
                  { value: '1:1', label: '1:1' },
                  { value: '4:5', label: '4:5' },
                ]}
              />
              <span className="section-label">填充方式</span>
              <Segmented<FitMode>
                value={project.fitMode}
                onChange={(fitMode) => onUpdateProject((current) => ({ ...current, fitMode }))}
                options={[
                  { value: 'fit', label: '完整显示' },
                  { value: 'fill', label: '填满裁切' },
                ]}
              />
              <span className="section-label">输出规格</span>
              <Segmented<ResolutionPreset>
                value={project.resolution}
                onChange={(resolution) => onUpdateProject((current) => ({ ...current, resolution }))}
                options={[
                  { value: '720p', label: '720P' },
                  { value: '1080p', label: '1080P' },
                  { value: '2160p', label: '4K' },
                ]}
              />
              <Segmented<30 | 60>
                value={project.fps}
                onChange={(fps) => onUpdateProject((current) => ({ ...current, fps }))}
                options={[
                  { value: 30, label: '30 FPS' },
                  { value: 60, label: '60 FPS' },
                ]}
              />
              <div className="readout-row"><span>实际尺寸</span><strong>{output.width} x {output.height}</strong></div>
            </section>

            <section className="inspector-section">
              <h3>色彩</h3>
              <SliderRow
                label="亮度"
                value={project.filters.brightness}
                min={-0.5}
                max={0.5}
                step={0.01}
                onChange={(brightness) => onUpdateProject((current) => ({ ...current, filters: { ...current.filters, brightness } }))}
                format={(value) => `${value > 0 ? '+' : ''}${Math.round(value * 100)}`}
              />
              <SliderRow
                label="对比度"
                value={project.filters.contrast}
                min={-0.5}
                max={0.5}
                step={0.01}
                onChange={(contrast) => onUpdateProject((current) => ({ ...current, filters: { ...current.filters, contrast } }))}
                format={(value) => `${value > 0 ? '+' : ''}${Math.round(value * 100)}`}
              />
              <SliderRow
                label="饱和度"
                value={project.filters.saturation}
                min={-1}
                max={1}
                step={0.01}
                onChange={(saturation) => onUpdateProject((current) => ({ ...current, filters: { ...current.filters, saturation } }))}
                format={(value) => `${value > 0 ? '+' : ''}${Math.round(value * 100)}`}
              />
            </section>

            <section className="inspector-section">
              <h3>变换</h3>
              <div className="two-control-buttons">
                <button className={project.transform.flipX ? 'is-active' : ''} onClick={() => onUpdateProject((current) => ({ ...current, transform: { ...current.transform, flipX: !current.transform.flipX } }))}>
                  <FlipHorizontal2 size={16} />水平翻转
                </button>
                <button className={project.transform.flipY ? 'is-active' : ''} onClick={() => onUpdateProject((current) => ({ ...current, transform: { ...current.transform, flipY: !current.transform.flipY } }))}>
                  <FlipVertical2 size={16} />垂直翻转
                </button>
              </div>
              <button
                className="subtle-button full-width"
                onClick={() => onUpdateProject((current) => ({
                  ...current,
                  filters: { brightness: 0, contrast: 0, saturation: 0 },
                  transform: { flipX: false, flipY: false },
                }))}
              >
                <RotateCcw size={14} />重置画面参数
              </button>
            </section>
          </div>
        )}

        {tab === 'text' && (
          <div className="inspector-section-stack">
            <div className="section-heading-row">
              <div><span className="eyebrow">字幕图层</span><h3>文字</h3></div>
              <button className="text-button small" onClick={onAddText}><Plus size={14} />新增</button>
            </div>
            {project.texts.length > 0 && (
              <div className="text-layer-list">
                {project.texts.map((text) => (
                  <button
                    key={text.id}
                    className={selectedTextId === text.id ? 'is-selected' : ''}
                    onClick={() => onSelectText(text.id)}
                  >
                    <Type size={13} />
                    <span>{text.text || '空文字'}</span>
                  </button>
                ))}
              </div>
            )}
            {selectedText ? (
              <section className="inspector-section">
                <label className="textarea-field">
                  <span className="field-label">文字内容</span>
                  <textarea
                    value={selectedText.text}
                    rows={3}
                    onChange={(event) => onUpdateText(selectedText.id, { text: event.target.value }, false)}
                  />
                </label>
                <div className="two-column-fields">
                  <TimecodeInput
                    label="开始"
                    value={selectedText.start}
                    max={totalDuration}
                    onCommit={(start) => onUpdateText(selectedText.id, { start, end: Math.max(start + 0.1, selectedText.end) })}
                  />
                  <TimecodeInput
                    label="结束"
                    value={selectedText.end}
                    max={totalDuration}
                    onCommit={(end) => onUpdateText(selectedText.id, { end: Math.max(selectedText.start + 0.05, end) })}
                  />
                </div>
                <div className="two-column-fields">
                  <label className="color-field"><span>文字颜色</span><input type="color" value={selectedText.color} onChange={(event) => onUpdateText(selectedText.id, { color: event.target.value })} /><b>{selectedText.color}</b></label>
                  <label className="color-field"><span>底色</span><input type="color" value={selectedText.background} onChange={(event) => onUpdateText(selectedText.id, { background: event.target.value })} /><b>{selectedText.background}</b></label>
                </div>
                <SliderRow label="水平位置" value={selectedText.x} min={0} max={100} step={1} onChange={(x) => onUpdateText(selectedText.id, { x }, false)} format={(value) => `${Math.round(value)}%`} />
                <SliderRow label="垂直位置" value={selectedText.y} min={0} max={100} step={1} onChange={(y) => onUpdateText(selectedText.id, { y }, false)} format={(value) => `${Math.round(value)}%`} />
                <SliderRow label="字号" value={selectedText.fontSize} min={1.5} max={18} step={0.1} onChange={(fontSize) => onUpdateText(selectedText.id, { fontSize }, false)} format={(value) => `${value.toFixed(1)}%`} />
                <SliderRow label="不透明度" value={selectedText.opacity} min={0.1} max={1} step={0.01} onChange={(opacity) => onUpdateText(selectedText.id, { opacity }, false)} format={(value) => `${Math.round(value * 100)}%`} />
                <ToggleRow label="粗体" checked={selectedText.bold} onChange={(bold) => onUpdateText(selectedText.id, { bold })} />
                <button className="danger-button full-width" onClick={() => onDeleteText(selectedText.id)}><Trash2 size={14} />删除文字</button>
              </section>
            ) : (
              <div className="inspector-empty compact">
                <Type size={22} />
                <strong>还没有文字图层</strong>
                <button className="subtle-button" onClick={onAddText}><Plus size={14} />在播放头处添加</button>
              </div>
            )}
          </div>
        )}

        {tab === 'export' && (
          <div className="inspector-section-stack">
            <section className="inspector-section export-summary">
              <span className="eyebrow">剪映素材</span>
              <h3>MP4 / H.264</h3>
              <div className="summary-metric"><span>画布</span><strong>{project.aspectRatio} · {output.width}x{output.height}</strong></div>
              <div className="summary-metric"><span>帧率</span><strong>{project.fps} FPS</strong></div>
              <div className="summary-metric"><span>时长</span><strong>{formatDuration(totalDuration)}</strong></div>
              <div className="summary-metric"><span>片段</span><strong>{project.clips.length} 个</strong></div>
              <p>输出使用 H.264 + AAC 编码，可以直接导入剪映继续加转场、音乐和包装。</p>
              <button className="primary-button full-width large" onClick={onOpenExport} disabled={!project.media || !project.clips.length}>
                <Download size={16} />打开导出面板
              </button>
            </section>
          </div>
        )}
      </div>
    </aside>
  )
}

interface ClipSettingsProps {
  clip: Clip
  mediaDuration: number
  playhead: number
  onUpdate: (patch: Partial<Clip>, recordHistory?: boolean) => void
  onSetInAtPlayhead: () => void
  onSetOutAtPlayhead: () => void
}

function ClipSettings({ clip, mediaDuration, playhead, onUpdate, onSetInAtPlayhead, onSetOutAtPlayhead }: ClipSettingsProps) {
  const duration = clipDuration(clip)
  const insideClip = playhead > clip.inPoint && playhead < clip.outPoint
  return (
    <div className="inspector-section-stack">
      <div className="section-heading-row compact">
        <div><span className="eyebrow">主视频 · V1</span><h3>{clip.label}</h3></div>
        <span className="duration-badge">{formatDuration(duration)}</span>
      </div>

      <section className="inspector-section">
        <h3>裁剪范围</h3>
        <div className="two-column-fields">
          <TimecodeInput
            label="入点"
            value={clip.inPoint}
            max={clip.outPoint - 0.05}
            onCommit={(inPoint) => onUpdate({ inPoint: clamp(inPoint, 0, clip.outPoint - 0.05) })}
          />
          <TimecodeInput
            label="出点"
            value={clip.outPoint}
            max={mediaDuration}
            onCommit={(outPoint) => onUpdate({ outPoint: clamp(outPoint, clip.inPoint + 0.05, mediaDuration) })}
          />
        </div>
        <div className="two-control-buttons">
          <button onClick={onSetInAtPlayhead} disabled={!insideClip} title="将片段入点移动到播放头 (I)"><Scissors size={14} />设为入点</button>
          <button onClick={onSetOutAtPlayhead} disabled={!insideClip} title="将片段出点移动到播放头 (O)"><Scissors size={14} />设出点</button>
        </div>
      </section>

      <section className="inspector-section">
        <h3><Gauge size={15} />速度</h3>
        <Segmented<number>
          value={clip.speed}
          onChange={(speed) => onUpdate({ speed })}
          options={[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((value) => ({ value, label: `${value}x` }))}
        />
        <div className="readout-row"><span>片段输出长度</span><strong>{formatDuration(duration)}</strong></div>
      </section>

      <section className="inspector-section">
        <h3>{clip.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}声音</h3>
        <ToggleRow label="静音" checked={clip.muted} onChange={(muted) => onUpdate({ muted })} />
        <SliderRow label="音量" value={clip.volume} min={0} max={2} step={0.01} onChange={(volume) => onUpdate({ volume }, false)} format={(value) => `${Math.round(value * 100)}%`} disabled={clip.muted} />
      </section>

      <section className="inspector-section">
        <h3>淡入淡出</h3>
        <SliderRow label="淡入" value={clip.fadeIn} min={0} max={Math.min(5, duration)} step={0.05} onChange={(fadeIn) => onUpdate({ fadeIn }, false)} format={(value) => `${value.toFixed(1)} 秒`} />
        <SliderRow label="淡出" value={clip.fadeOut} min={0} max={Math.min(5, duration)} step={0.05} onChange={(fadeOut) => onUpdate({ fadeOut }, false)} format={(value) => `${value.toFixed(1)} 秒`} />
      </section>
    </div>
  )
}


