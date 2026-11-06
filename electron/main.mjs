import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { runExport } from './exporter.mjs'

const require = createRequire(import.meta.url)
const { autoUpdater } = require('electron-updater')
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const ffmpegPath = app.isPackaged
  ? path.join(process.resourcesPath, 'bin', 'ffmpeg.exe')
  : require('@ffmpeg-installer/ffmpeg').path
const ffprobePath = app.isPackaged
  ? path.join(process.resourcesPath, 'bin', 'ffprobe.exe')
  : require('@ffprobe-installer/ffprobe').path

const mediaTokens = new Map()
const waveformCache = new Map()
let mediaPort = 0
let mainWindow = null
let activeExport = null
const releasesUrl = 'https://github.com/3272002347/canyon-quickcut/releases/latest'
let updateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  version: '',
  percent: 0,
  transferred: 0,
  total: 0,
  bytesPerSecond: 0,
  message: '',
}
let updateCheckTimer = null
let updateInitialTimer = null

function isPortableBuild() {
  return Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR)
}

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:state', updateState)
  }
}

async function checkForUpdates() {
  if (isPortableBuild()) {
    setUpdateState({ status: 'disabled', message: '便携版请下载安装版以使用自动更新' })
    return updateState
  }
  if (!app.isPackaged) {
    setUpdateState({ status: 'disabled', message: '开发模式不检查更新' })
    return updateState
  }
  if (updateState.status === 'checking' || updateState.status === 'downloading') return updateState
  setUpdateState({ status: 'checking', percent: 0, message: '' })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    setUpdateState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
  }
  return updateState
}

function setupAutoUpdater() {
  if (isPortableBuild()) {
    setUpdateState({ status: 'disabled', message: '便携版请下载安装版以使用自动更新' })
    return
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({ status: 'checking', percent: 0, message: '' })
  })
  autoUpdater.on('update-available', (info) => {
    setUpdateState({ status: 'available', version: info.version, percent: 0, message: '发现新版本，正在下载' })
  })
  autoUpdater.on('update-not-available', (info) => {
    setUpdateState({ status: 'not-available', version: info.version, percent: 100, message: '已是最新版本' })
  })
  autoUpdater.on('download-progress', (progress) => {
    setUpdateState({
      status: 'downloading',
      percent: Math.round(progress.percent * 10) / 10,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
      message: '正在下载新版本',
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({ status: 'downloaded', version: info.version, percent: 100, message: '新版本已下载，重启即可安装' })
  })
  autoUpdater.on('error', (error) => {
    setUpdateState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
  })

  if (!app.isPackaged) {
    setUpdateState({ status: 'disabled', message: '开发模式不检查更新' })
    return
  }

  updateInitialTimer = setTimeout(() => { checkForUpdates() }, 8000)
  updateInitialTimer.unref?.()
  updateCheckTimer = setInterval(() => { checkForUpdates() }, 4 * 60 * 60 * 1000)
  updateCheckTimer.unref?.()
}

const videoExtensions = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.flv', '.ts', '.mts'])
const mimeTypes = new Map([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
  ['.mkv', 'video/x-matroska'],
  ['.avi', 'video/x-msvideo'],
  ['.flv', 'video/x-flv'],
  ['.ts', 'video/mp2t'],
  ['.mts', 'video/mp2t'],
])

function assertMediaPath(filePath) {
  if (!filePath || typeof filePath !== 'string') throw new Error('无效的视频路径')
  const extension = path.extname(filePath).toLowerCase()
  if (!videoExtensions.has(extension)) throw new Error('不支持这个视频格式')
}

function registerMedia(filePath) {
  const token = createHash('sha1').update(filePath).digest('hex').slice(0, 24)
  mediaTokens.set(token, filePath)
  const base = `http://127.0.0.1:${mediaPort}`
  return {
    token,
    mediaUrl: `${base}/media/${token}`,
    thumbnailBase: `${base}/thumb/${token}`,
    waveformUrl: `${base}/waveform/${token}`,
  }
}

function probe(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ], { windowsHide: true })
    const output = []
    const errors = []
    child.stdout.on('data', (chunk) => output.push(chunk))
    child.stderr.on('data', (chunk) => errors.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString('utf8') || '无法读取视频信息'))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(output).toString('utf8')))
      } catch {
        reject(new Error('视频信息格式异常'))
      }
    })
  })
}

function parseRate(rate) {
  if (!rate || typeof rate !== 'string') return 0
  const [numerator, denominator] = rate.split('/').map(Number)
  if (!numerator || !denominator) return Number(rate) || 0
  return numerator / denominator
}

async function inspectVideo(filePath) {
  assertMediaPath(filePath)
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error('选择的不是有效文件')
  const metadata = await probe(filePath)
  const streams = Array.isArray(metadata.streams) ? metadata.streams : []
  const video = streams.find((stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1)
  if (!video) throw new Error('文件中没有找到视频轨道')
  const audio = streams.find((stream) => stream.codec_type === 'audio')
  const duration = Number(metadata.format?.duration || video.duration || 0)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长')
  const urls = registerMedia(filePath)
  return {
    path: filePath,
    name: path.basename(filePath),
    size: stat.size,
    duration,
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    fps: parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 30,
    codec: String(video.codec_name || 'unknown'),
    bitRate: Number(metadata.format?.bit_rate || video.bit_rate || 0),
    hasAudio: Boolean(audio),
    mediaUrl: urls.mediaUrl,
    thumbnailBase: urls.thumbnailBase,
    waveformUrl: urls.waveformUrl,
  }
}

function serveThumbnail(filePath, timeSeconds, response) {
  const child = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(Math.max(0, timeSeconds)),
    '-i', filePath,
    '-frames:v', '1',
    '-vf', 'scale=420:-2',
    '-q:v', '4',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    'pipe:1',
  ], { windowsHide: true })
  const buffers = []
  child.stdout.on('data', (chunk) => buffers.push(chunk))
  child.on('error', () => {
    if (!response.headersSent) response.writeHead(500)
    response.end()
  })
  child.on('close', (code) => {
    if (response.destroyed) return
    if (code !== 0 || buffers.length === 0) {
      response.writeHead(404)
      response.end()
      return
    }
    const image = Buffer.concat(buffers)
    response.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': image.length,
      'Cache-Control': 'public, max-age=3600',
    })
    response.end(image)
  })
}

function serveWaveform(token, filePath, response) {
  const cached = waveformCache.get(token)
  if (cached) {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': cached.length, 'Cache-Control': 'public, max-age=3600' })
    response.end(cached)
    return
  }
  const child = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-i', filePath,
    '-filter_complex', '[0:a]aformat=channel_layouts=mono,showwavespic=s=3200x96:colors=0x63d9b2[w]',
    '-map', '[w]',
    '-frames:v', '1',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    'pipe:1',
  ], { windowsHide: true })
  const buffers = []
  child.stdout.on('data', (chunk) => buffers.push(chunk))
  child.on('error', () => {
    if (!response.headersSent) response.writeHead(500)
    response.end()
  })
  child.on('close', (code) => {
    if (response.destroyed) return
    if (code !== 0 || buffers.length === 0) {
      response.writeHead(404)
      response.end()
      return
    }
    const image = Buffer.concat(buffers)
    waveformCache.set(token, image)
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length, 'Cache-Control': 'public, max-age=3600' })
    response.end(image)
  })
}

function startMediaServer() {
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
    const parts = requestUrl.pathname.split('/').filter(Boolean)
    const route = parts[0]
    const token = parts[1]
    const filePath = token ? mediaTokens.get(token) : null

    if (requestUrl.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end('ok')
      return
    }
    if (!filePath) {
      response.writeHead(404)
      response.end('Not found')
      return
    }
    if (route === 'thumb') {
      const time = Number(requestUrl.searchParams.get('t') || 0)
      serveThumbnail(filePath, time, response)
      return
    }
    if (route === 'waveform') {
      serveWaveform(token, filePath, response)
      return
    }
    if (route !== 'media') {
      response.writeHead(404)
      response.end('Not found')
      return
    }

    const statSize = Number(request.headers['x-file-size'] || 0)
    fs.stat(filePath).then((stat) => {
      const total = stat.size || statSize
      const range = request.headers.range
      const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream'
      if (!range) {
        response.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': total,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        })
        if (request.method === 'HEAD') response.end()
        else createReadStream(filePath).pipe(response)
        return
      }
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match) {
        response.writeHead(416, { 'Content-Range': `bytes */${total}` })
        response.end()
        return
      }
      let start = match[1] ? Number(match[1]) : total - Number(match[2] || 0)
      let end = match[2] ? Number(match[2]) : total - 1
      if (!match[1]) {
        start = Math.max(0, total - Number(match[2] || 0))
        end = total - 1
      }
      start = Math.max(0, start)
      end = Math.min(total - 1, Math.max(start, end))
      response.writeHead(206, {
        'Content-Type': contentType,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
      })
      if (request.method === 'HEAD') response.end()
      else createReadStream(filePath, { start, end }).pipe(response)
    }).catch(() => {
      response.writeHead(404)
      response.end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      mediaPort = server.address().port
      resolve(server)
    })
  })
}

function projectForDisk(project) {
  const cloned = JSON.parse(JSON.stringify(project))
  if (cloned.media) {
    cloned.media.mediaUrl = ''
    cloned.media.thumbnailBase = ''
    cloned.media.waveformUrl = ''
  }
  return cloned
}

async function hydrateProject(project) {
  if (!project?.media?.path) return project
  const media = await inspectVideo(project.media.path)
  return { ...project, media }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#111210',
    autoHideMenuBar: true,
    title: '峡谷快剪',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  await startMediaServer()

  ipcMain.handle('media:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入全局对局视频',
      properties: ['openFile'],
      filters: [
        { name: '视频文件', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'flv', 'ts', 'mts'] },
      ],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return inspectVideo(result.filePaths[0])
  })

  ipcMain.handle('media:inspect', async (_event, filePath) => inspectVideo(filePath))

  ipcMain.handle('project:save', async (_event, project, knownPath) => {
    let targetPath = knownPath || ''
    if (!targetPath) {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '保存剪辑工程',
        defaultPath: path.join(app.getPath('documents'), `${project.name || '未命名工程'}.cqcut`),
        filters: [{ name: '峡谷快剪工程', extensions: ['cqcut'] }],
      })
      if (result.canceled || !result.filePath) return { path: '', cancelled: true }
      targetPath = result.filePath
    }
    await fs.writeFile(targetPath, JSON.stringify(projectForDisk(project), null, 2), 'utf8')
    return { path: targetPath, cancelled: false }
  })

  ipcMain.handle('project:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '打开剪辑工程',
      properties: ['openFile'],
      filters: [{ name: '峡谷快剪工程', extensions: ['cqcut', 'json'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    const project = JSON.parse(await fs.readFile(filePath, 'utf8'))
    if (!project || project.version !== 1) throw new Error('不是有效的工程文件')
    return { project: await hydrateProject(project), path: filePath }
  })

  ipcMain.handle('export:choose', async (_event, suggestedName) => {
    const safeName = String(suggestedName || '峡谷快剪成品').replace(/[<>:"/\\|?*]/g, '_')
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出剪映素材',
      defaultPath: path.join(app.getPath('videos'), `${safeName}.mp4`),
      filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('export:start', async (event, request) => {
    if (activeExport) {
      activeExport.cancel()
      activeExport = null
    }
    const jobId = randomUUID()
    const sendProgress = (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('export:progress', { jobId, ...progress })
    }
    const runner = runExport({
      ffmpegPath,
      ffprobePath,
      project: request.project,
      settings: request.settings,
      jobId,
      onProgress: sendProgress,
    })
    activeExport = runner
    try {
      const outputPath = await runner.promise
      sendProgress({ percent: 100, time: 0, fps: 0, speed: '1x', status: 'done', outputPath })
      return { jobId, outputPath }
    } catch (error) {
      if (runner.cancelled) {
        sendProgress({ percent: 0, time: 0, fps: 0, speed: '0x', status: 'cancelled', message: '导出已取消' })
      } else {
        sendProgress({ percent: 0, time: 0, fps: 0, speed: '0x', status: 'error', message: error.message })
      }
      throw error
    } finally {
      if (activeExport === runner) activeExport = null
    }
  })

  ipcMain.handle('export:cancel', async (_event, jobId) => {
    if (!activeExport) return false
    activeExport.cancel()
    return true
  })

  ipcMain.handle('shell:reveal', async (_event, filePath) => {
    if (!filePath) return
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('app:info', async () => ({
    version: app.getVersion(),
    ffmpeg: ffmpegPath,
    platform: `${os.platform()} ${os.arch()}`,
  }))

  ipcMain.handle('app:startup-media', async () => {
    const argument = process.argv.find((item) => item.startsWith('--demo-video='))
    if (!argument) return null
    return inspectVideo(argument.slice('--demo-video='.length))
  })

  ipcMain.handle('update:get-state', async () => updateState)
  ipcMain.handle('update:check', async () => checkForUpdates())
  ipcMain.handle('update:install', async () => {
    if (updateState.status !== 'downloaded') return false
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
    return true
  })
  ipcMain.handle('update:open-releases', async () => {
    await shell.openExternal(releasesUrl)
  })

  createWindow()
  setupAutoUpdater()

  const captureArgument = process.argv.find((argument) => argument.startsWith('--capture-ui='))
  if (captureArgument) {
    const outputPath = captureArgument.slice('--capture-ui='.length)
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage()
          await fs.writeFile(outputPath, image.toPNG())
        } finally {
          app.quit()
        }
      }, 1500)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (updateInitialTimer) clearTimeout(updateInitialTimer)
  if (updateCheckTimer) clearInterval(updateCheckTimer)
  if (process.platform !== 'darwin') app.quit()
})






