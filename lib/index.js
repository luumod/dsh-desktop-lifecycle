import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'desktop-lifecycle'
export const inject = ['webServer']

const API_PATH = '/desktop-lifecycle/v1/action'
const DESKTOP_PROCESS_NAME = 'DeepSeek Harness.exe'
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const HELPER_PATH = join(MODULE_DIR, '..', 'lifecycle-helper.ps1')
const LAUNCHER_PATH = join(MODULE_DIR, '..', 'launch-helper.ps1')
const LOG_PATH = join(process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? dirname(process.execPath), '.dsh'), 'desktop-lifecycle.log')
let actionStarted = false

function sendJson(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(json)
}

function desktopParent() {
  if (process.env.DSH_DESKTOP !== '1' || process.platform !== 'win32') return undefined
  const pid = process.ppid
  if (!Number.isInteger(pid) || pid < 1) return undefined
  return {
    pid,
    executable: join(dirname(process.execPath), DESKTOP_PROCESS_NAME),
  }
}

function webProcess() {
  if (process.env.DSH_DESKTOP === '1' || process.platform !== 'win32') return undefined
  return {
    executable: process.execPath,
    arguments: process.argv.slice(1),
  }
}

function launchWebReplacement(web) {
  // 替代进程必须等待当前 Web Server 释放端口后再启动，否则会因 EADDRINUSE 失败。
  const helper = spawn(process.execPath, [
    '-e',
    'const { spawn } = require("node:child_process"); const [executable, serializedArguments] = process.argv.slice(1); setTimeout(() => { const child = spawn(executable, JSON.parse(serializedArguments), { detached: true, stdio: "ignore", windowsHide: true }); child.unref() }, 700)',
    web.executable,
    JSON.stringify(web.arguments),
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  helper.unref()
}

function scheduleWebExit() {
  // 让 202 JSON 响应和 TCP 写入先完成，再退出当前 dsh web 进程。
  setTimeout(() => process.exit(0), 350).unref()
}

function launchHelper(action, desktop) {
  if (!existsSync(LAUNCHER_PATH) || !existsSync(HELPER_PATH)) {
    throw new Error('桌面生命周期辅助脚本不存在')
  }
  if (!existsSync(desktop.executable)) throw new Error('无法定位 DeepSeek Harness 桌面程序')

  const result = spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    LAUNCHER_PATH,
    '-Action',
    action,
    '-DesktopPid',
    String(desktop.pid),
    '-DesktopExecutable',
    desktop.executable,
    '-HelperPath',
    HELPER_PATH,
    '-LogPath',
    LOG_PATH,
  ], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || '无法创建独立的桌面生命周期辅助进程')
  }
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const octets = hostname.split('.')
  return octets.length === 4
    && octets[0] === '127'
    && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
}

function sameOrigin(req) {
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  try {
    const authority = new URL(`http://${host}`)
    const parsedOrigin = new URL(origin)
    return isLoopbackHostname(authority.hostname)
      && parsedOrigin.protocol === 'http:'
      && parsedOrigin.host === authority.host
  } catch {
    return false
  }
}

export function apply(ctx) {
  const desktop = desktopParent()
  const web = webProcess()
  if (desktop === undefined && web === undefined) return

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: API_PATH,
    handler(req, res) {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' })
        res.end()
        return
      }
      if (!sameOrigin(req)) {
        sendJson(res, 403, { ok: false, error: '拒绝非同源请求' })
        return
      }
      if (actionStarted) {
        sendJson(res, 409, { ok: false, error: '关闭或重启已在执行' })
        return
      }

      const action = new URL(req.url ?? '/', 'http://localhost').searchParams.get('action')
      if (action !== 'close' && action !== 'restart') {
        sendJson(res, 400, { ok: false, error: '无效的生命周期操作' })
        return
      }

      try {
        if (desktop !== undefined) {
          launchHelper(action, desktop)
        } else if (action === 'restart') {
          launchWebReplacement(web)
        }
        actionStarted = true
        sendJson(res, 202, { ok: true })
        if (desktop === undefined) scheduleWebExit()
      } catch (error) {
        ctx.logger.error(error)
        sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : '无法启动生命周期操作',
        })
      }
    },
  }), 'desktop-lifecycle: same-origin lifecycle endpoint')
}
