// Health monitor - runs alongside backend, restarts services if down
const { spawn } = require('child_process')

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001'
const CHECK_INTERVAL = 30000 // 30s

let restartAttempts = 0
const MAX_RESTARTS = 3

async function checkHealth() {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { 
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    })
    if (res.ok) {
      restartAttempts = 0
      console.log(`[health] OK`)
    }
  } catch (err) {
    restartAttempts++
    console.error(`[health] FAIL: ${err.message} (attempt ${restartAttempts})`)
    
    if (restartAttempts >= 2) {
      console.log('[health] Restarting services...')
      try {
        const proc = spawn('bash', ['server/start-live.sh'], {
          cwd: '/Users/baoduong2/.openclaw/workspace',
          stdio: 'inherit'
        })
        proc.on('close', (code) => {
          console.log('[health] Restart done, waiting...')
          restartAttempts = 0
        })
      } catch (e) {
        console.error('[health] Restart failed:', e.message)
      }
    }
  }
}

console.log('[health] Starting health monitor...')
setInterval(checkHealth, CHECK_INTERVAL)
checkHealth() // initial check
