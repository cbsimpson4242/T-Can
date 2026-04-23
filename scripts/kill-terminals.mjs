#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

function candidateRegistryPaths() {
  const candidates = []
  if (process.env.TCAN_TERMINAL_REGISTRY) {
    candidates.push(process.env.TCAN_TERMINAL_REGISTRY)
  }

  candidates.push(path.join(process.cwd(), '.tcan-terminal-pids.json'))

  if (process.platform === 'win32' && process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 't-can', 'terminal-pids.json'))
    candidates.push(path.join(process.env.APPDATA, 'T-CAN', 'terminal-pids.json'))
  }

  if (process.platform === 'darwin') {
    candidates.push(path.join(os.homedir(), 'Library', 'Application Support', 't-can', 'terminal-pids.json'))
    candidates.push(path.join(os.homedir(), 'Library', 'Application Support', 'T-CAN', 'terminal-pids.json'))
  }

  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')
  candidates.push(path.join(configHome, 't-can', 'terminal-pids.json'))
  candidates.push(path.join(configHome, 'T-CAN', 'terminal-pids.json'))

  return [...new Set(candidates)]
}

function readRegistry() {
  for (const registryPath of candidateRegistryPaths()) {
    if (!fs.existsSync(registryPath)) {
      continue
    }

    const raw = fs.readFileSync(registryPath, 'utf8')
    const parsed = JSON.parse(raw)
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : []
    return { path: registryPath, sessions }
  }

  return null
}

const registry = readRegistry()
if (!registry) {
  console.log('No T-CAN terminal registry found. If needed, set TCAN_TERMINAL_REGISTRY to terminal-pids.json.')
  process.exit(0)
}

const pids = registry.sessions.map((session) => session.pid).filter((pid) => Number.isInteger(pid) && pid > 0)
if (pids.length === 0) {
  console.log(`No live terminal PIDs listed in ${registry.path}.`)
  process.exit(0)
}

let failures = 0
for (const pid of pids) {
  try {
    process.kill(pid, process.platform === 'win32' ? undefined : 'SIGTERM')
    console.log(`Killed T-CAN terminal PID ${pid}`)
  } catch (error) {
    failures += 1
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Failed to kill PID ${pid}: ${message}`)
  }
}

process.exit(failures === 0 ? 0 : 1)
