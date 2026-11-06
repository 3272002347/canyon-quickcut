import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const QUALITY = {
  draft: { crf: '26', preset: 'veryfast', audio: '128k' },
  balanced: { crf: '21', preset: 'veryfast', audio: '192k' },
  high: { crf: '18', preset: 'medium', audio: '256k' },
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function outputSize(aspectRatio, preset) {
  if (aspectRatio === '9:16') {
    return preset === '2160p' ? [2160, 3840] : preset === '1080p' ? [1080, 1920] : [720, 1280]
  }
  if (aspectRatio === '1:1') {
    return preset === '2160p' ? [2160, 2160] : preset === '1080p' ? [1080, 1080] : [720, 720]
  }
  if (aspectRatio === '4:5') {
    return preset === '2160p' ? [2160, 2700] : preset === '1080p' ? [1080, 1350] : [720, 900]
  }
  return preset === '2160p' ? [3840, 2160] : preset === '1080p' ? [1920, 1080] : [1280, 720]
}

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clipOutputDuration(clip) {
  return Math.max(0.01, (number(clip.outPoint) - number(clip.inPoint)) / Math.max(0.05, number(clip.speed, 1)))
}

function atempo(speed) {
  let remaining = clamp(number(speed, 1), 0.25, 4)
  const filters = []
  while (remaining > 2.0001) {
    filters.push('atempo=2')
    remaining /= 2
  }
  while (remaining < 0.4999) {
    filters.push('atempo=0.5')
    remaining /= 0.5
  }
  if (Math.abs(remaining - 1) > 0.0001) filters.push(`atempo=${remaining.toFixed(6)}`)
  return filters.join(',')
}

function parseFfmpegTime(value) {
  if (!value) return 0
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value.trim())
  if (!match) return 0
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

function assTime(seconds) {
  const safe = Math.max(0, seconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = Math.floor(safe % 60)
  const centis = Math.floor((safe % 1) * 100)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}

function assColor(hex, opacity = 1) {
  const cleaned = String(hex || '#ffffff').replace('#', '').padEnd(6, 'f').slice(0, 6)
  const red = cleaned.slice(0, 2)
  const green = cleaned.slice(2, 4)
  const blue = cleaned.slice(4, 6)
  const alpha = Math.round((1 - clamp(opacity, 0, 1)) * 255).toString(16).padStart(2, '0').toUpperCase()
  return `&H${alpha}${blue}${green}${red}`.toUpperCase()
}

function escapeAssText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\r?\n/g, '\\N')
}

function escapeFilterPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

async function createAssFile(texts, width, height, totalDuration) {
  if (!texts.length) return null
  const filePath = path.join(os.tmpdir(), `canyon-quickcut-${randomUUID()}.ass`)
  const styles = []
  const dialogues = []
  texts.forEach((text, index) => {
    const styleName = `T${index}`
    const fontSize = Math.max(12, Math.round((number(text.fontSize, 4) / 100) * height))
    const opacity = clamp(number(text.opacity, 1), 0, 1)
    const primary = assColor(text.color || '#ffffff', opacity)
    const background = text.background || '#000000'
    const back = assColor(background, 0.72)
    const outline = Math.max(1, Math.round(fontSize * 0.055))
    styles.push(`Style: ${styleName},Microsoft YaHei,${fontSize},${primary},&H000000FF,${assColor('#000000', 0.8)},${back},${text.bold ? -1 : 0},0,0,0,100,100,0,0,3,${outline},0,5,20,20,20,1`)
    const start = clamp(number(text.start), 0, totalDuration)
    const end = clamp(number(text.end), start + 0.05, totalDuration)
    if (end <= start) return
    const x = Math.round(clamp(number(text.x, 50), 0, 100) / 100 * width)
    const y = Math.round(clamp(number(text.y, 82), 0, 100) / 100 * height)
    dialogues.push(`Dialogue: 0,${assTime(start)},${assTime(end)},${styleName},,0,0,0,,{\\pos(${x},${y})}${escapeAssText(text.text)}`)
  })
  const content = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles.join('\n')}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogues.join('\n')}
`
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

function buildPreciseGraph(project, width, height, assPath) {
  const clips = project.clips
  const count = clips.length
  const hasAudio = Boolean(project.media?.hasAudio)
  const fps = project.fps === 30 ? 30 : 60
  const graph = []

  if (count > 1) {
    graph.push(`[0:v]split=${count}${Array.from({ length: count }, (_, index) => `[vsrc${index}]`).join('')}`)
    if (hasAudio) {
      graph.push(`[0:a]asplit=${count}${Array.from({ length: count }, (_, index) => `[asrc${index}]`).join('')}`)
    }
  }

  clips.forEach((clip, index) => {
    const inputLabel = count > 1 ? `[vsrc${index}]` : '[0:v]'
    const start = Math.max(0, number(clip.inPoint))
    const end = Math.max(start + 0.01, number(clip.outPoint))
    const speed = clamp(number(clip.speed, 1), 0.25, 4)
    const duration = Math.max(0.01, (end - start) / speed)
    const filters = [
      `trim=start=${start.toFixed(6)}:end=${end.toFixed(6)}`,
      `setpts=(PTS-STARTPTS)/${speed.toFixed(6)}`,
    ]
    const fadeIn = clamp(number(clip.fadeIn), 0, duration)
    const fadeOut = clamp(number(clip.fadeOut), 0, duration)
    if (fadeIn > 0) filters.push(`fade=t=in:st=0:d=${fadeIn.toFixed(6)}`)
    if (fadeOut > 0) filters.push(`fade=t=out:st=${Math.max(0, duration - fadeOut).toFixed(6)}:d=${fadeOut.toFixed(6)}`)
    graph.push(`${inputLabel}${filters.join(',')}[v${index}]`)

    if (hasAudio) {
      const audioInput = count > 1 ? `[asrc${index}]` : '[0:a]'
      const audioFilters = [
        `atrim=start=${start.toFixed(6)}:end=${end.toFixed(6)}`,
        'asetpts=PTS-STARTPTS',
      ]
      const tempo = atempo(speed)
      if (tempo) audioFilters.push(tempo)
      const volume = clip.muted ? 0 : clamp(number(clip.volume, 1), 0, 3)
      audioFilters.push(`volume=${volume.toFixed(4)}`)
      if (fadeIn > 0) audioFilters.push(`afade=t=in:st=0:d=${fadeIn.toFixed(6)}`)
      if (fadeOut > 0) audioFilters.push(`afade=t=out:st=${Math.max(0, duration - fadeOut).toFixed(6)}:d=${fadeOut.toFixed(6)}`)
      graph.push(`${audioInput}${audioFilters.join(',')}[a${index}]`)
    }
  })

  if (count > 1) {
    const concatInputs = clips.map((_, index) => hasAudio ? `[v${index}][a${index}]` : `[v${index}]`).join('')
    graph.push(`${concatInputs}concat=n=${count}:v=1:a=${hasAudio ? 1 : 0}${hasAudio ? '[vc][ac]' : '[vc]'}`)
  }

  const videoBase = count > 1 ? '[vc]' : '[v0]'
  const finalFilters = []
  if (project.fitMode === 'fill') {
    finalFilters.push(`scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos`)
    finalFilters.push(`crop=${width}:${height}`)
  } else {
    finalFilters.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos`)
    finalFilters.push(`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`)
  }
  finalFilters.push('setsar=1')
  if (project.transform?.flipX) finalFilters.push('hflip')
  if (project.transform?.flipY) finalFilters.push('vflip')
  const brightness = clamp(number(project.filters?.brightness), -1, 1)
  const contrast = clamp(number(project.filters?.contrast) + 1, 0, 3)
  const saturation = clamp(number(project.filters?.saturation) + 1, 0, 3)
  if (Math.abs(brightness) > 0.001 || Math.abs(contrast - 1) > 0.001 || Math.abs(saturation - 1) > 0.001) {
    finalFilters.push(`eq=brightness=${brightness.toFixed(4)}:contrast=${contrast.toFixed(4)}:saturation=${saturation.toFixed(4)}`)
  }
  finalFilters.push(`fps=${fps}`)
  if (assPath) {
    finalFilters.push(`subtitles=filename='${escapeFilterPath(assPath)}':fontsdir='C\\:/Windows/Fonts'`)
  }
  graph.push(`${videoBase}${finalFilters.join(',')}[vout]`)

  if (hasAudio) {
    graph.push(`${count > 1 ? '[ac]' : '[a0]'}aformat=sample_rates=48000:channel_layouts=stereo,alimiter=limit=0.95[aout]`)
  }
  return { graph: graph.join(';'), hasAudio }
}

function spawnFfmpeg(ffmpegPath, args, totalDuration, jobId, onProgress) {
  const child = spawn(ffmpegPath, args, { windowsHide: true })
  let stderr = ''
  let stdoutBuffer = ''
  let cancelled = false
  const promise = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf8')
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() || ''
      const values = {}
      lines.forEach((line) => {
        const separator = line.indexOf('=')
        if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 1)
        if (line === 'progress=continue' || line === 'progress=end') {
          const seconds = parseFfmpegTime(values.out_time) || (Number(values.out_time_us || values.out_time_ms || 0) / 1_000_000)
          const percent = totalDuration > 0 ? clamp((seconds / totalDuration) * 100, 0, 99.5) : 0
          onProgress({
            percent,
            time: seconds,
            fps: Number(values.fps || 0),
            speed: values.speed || '0x',
            status: 'running',
          })
        }
      })
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 20000) stderr = stderr.slice(-20000)
    })
    child.on('error', (error) => reject(error))
    child.on('close', (code) => {
      if (code === 0 && !cancelled) resolve()
      else if (cancelled) reject(new Error('导出已取消'))
      else reject(new Error(`FFmpeg 导出失败：${stderr.trim().split(/\r?\n/).slice(-4).join(' ')}`))
    })
  })
  return {
    promise,
    get cancelled() { return cancelled },
    cancel() {
      if (!cancelled) {
        cancelled = true
        child.kill()
      }
    },
  }
}

export function runExport({ ffmpegPath, project, settings, jobId, onProgress }) {
  let cancelled = false
  let processRunner = null
  const promise = (async () => {
    if (!project?.media?.path) throw new Error('工程中没有视频素材')
    if (!Array.isArray(project.clips) || project.clips.length === 0) throw new Error('时间线上没有片段')
    if (!settings?.outputPath) throw new Error('没有选择导出位置')
    const totalDuration = project.clips.reduce((total, clip) => total + clipOutputDuration(clip), 0)
    const [width, height] = outputSize(project.aspectRatio, project.resolution)
    const fastEligible = project.clips.length === 1
      && Math.abs(number(project.clips[0].speed, 1) - 1) < 0.001
      && project.texts.length === 0
      && Math.abs(number(project.filters?.brightness)) < 0.001
      && Math.abs(number(project.filters?.contrast)) < 0.001
      && Math.abs(number(project.filters?.saturation)) < 0.001
      && !project.transform?.flipX
      && !project.transform?.flipY

    let args
    let assPath = null
    try {
      if (settings.mode === 'fast') {
        if (!fastEligible) throw new Error('快速导出只支持单片段且无变速、画面调整或文字')
        const clip = project.clips[0]
        args = [
          '-hide_banner', '-y', '-loglevel', 'error',
          '-progress', 'pipe:1', '-nostats',
          '-ss', String(number(clip.inPoint)),
          '-i', project.media.path,
          '-t', String(Math.max(0.01, number(clip.outPoint) - number(clip.inPoint))),
          '-map', '0:v:0',
          '-map', '0:a?',
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart',
          settings.outputPath,
        ]
      } else {
        assPath = await createAssFile(project.texts || [], width, height, totalDuration)
        const built = buildPreciseGraph(project, width, height, assPath)
        const quality = QUALITY[settings.quality] || QUALITY.balanced
        args = [
          '-hide_banner', '-y', '-loglevel', 'error',
          '-progress', 'pipe:1', '-nostats',
          '-i', project.media.path,
          '-filter_complex', built.graph,
          '-map', '[vout]',
          ...(built.hasAudio ? ['-map', '[aout]'] : []),
          '-c:v', 'libx264',
          '-preset', quality.preset,
          '-crf', quality.crf,
          '-pix_fmt', 'yuv420p',
          '-r', String(project.fps === 30 ? 30 : 60),
          '-g', String((project.fps === 30 ? 30 : 60) * 2),
          ...(built.hasAudio ? ['-c:a', 'aac', '-b:a', quality.audio, '-ar', '48000'] : []),
          '-max_muxing_queue_size', '2048',
          '-movflags', '+faststart',
          '-shortest',
          settings.outputPath,
        ]
      }
      processRunner = spawnFfmpeg(ffmpegPath, args, totalDuration, jobId, onProgress)
      await processRunner.promise
      return settings.outputPath
    } finally {
      if (assPath) await fs.unlink(assPath).catch(() => {})
    }
  })()

  return {
    promise,
    get cancelled() { return cancelled || Boolean(processRunner?.cancelled) },
    cancel() {
      cancelled = true
      processRunner?.cancel()
    },
  }
}

