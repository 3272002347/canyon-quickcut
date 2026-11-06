import { FolderOpen, Redo2, Save, Scissors, Undo2, Upload } from 'lucide-react'

interface TopBarProps {
  projectName: string
  onRename: (name: string) => void
  onImport: () => void
  onOpen: () => void
  onSave: () => void
  onExport: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  saved: boolean
  hasMedia: boolean
}

export function TopBar({
  projectName,
  onRename,
  onImport,
  onOpen,
  onSave,
  onExport,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  saved,
  hasMedia,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark"><Scissors size={17} strokeWidth={2.3} /></div>
        <div className="brand-copy">
          <strong>峡谷快剪</strong>
          <span>LOCAL VIDEO CUTTER</span>
        </div>
      </div>

      <div className="topbar-divider" />

      <div className="project-title-wrap">
        <input
          className="project-title"
          value={projectName}
          onChange={(event) => onRename(event.target.value)}
          aria-label="工程名称"
        />
        <span className={`save-dot${saved ? '' : ' is-dirty'}`} title={saved ? '工程已保存' : '有未保存的更改'} />
      </div>

      <div className="topbar-actions">
        <button className="icon-button" title="撤销 (Ctrl+Z)" onClick={onUndo} disabled={!canUndo}><Undo2 size={17} /></button>
        <button className="icon-button" title="重做 (Ctrl+Shift+Z)" onClick={onRedo} disabled={!canRedo}><Redo2 size={17} /></button>
        <span className="topbar-divider short" />
        <button className="text-button" onClick={onOpen}><FolderOpen size={16} />打开</button>
        <button className="text-button" onClick={onSave}><Save size={16} />保存</button>
        <button className="text-button" onClick={onImport}><Upload size={16} />导入视频</button>
        <button className="primary-button" onClick={onExport} disabled={!hasMedia}>
          <Scissors size={16} />
          导出成片
        </button>
      </div>
    </header>
  )
}
