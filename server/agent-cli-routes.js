// Agent CLI HTTP routes — mount on Express app
import { executeCommand } from './agent-cli.js'

export function mountAgentCliRoutes(app) {
  // Generic execute endpoint
  app.post('/api/agent-cli/execute', (req, res) => {
    const { command, args } = req.body || {}
    if (!command) return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'command is required' } })
    const result = executeCommand(command, args || {})
    res.status(result.ok ? 200 : (result.error?.code === 'NOT_FOUND' ? 404 : 400)).json(result)
  })

  // Individual GET routes (read-only)
  const getRoutes = [
    'customer-find',
    'customer-orders',
    'orders-find',
    'orders-list',
    'orders-summary',
    'orders-search',
  ]

  for (const cmd of getRoutes) {
    app.get(`/api/agent-cli/${cmd}`, (req, res) => {
      const result = executeCommand(cmd, req.query)
      res.status(result.ok ? 200 : (result.error?.code === 'NOT_FOUND' ? 404 : 400)).json(result)
    })
  }

  // POST route (write)
  app.post('/api/agent-cli/order-confirm', (req, res) => {
    const result = executeCommand('order-confirm', req.body || {})
    res.status(result.ok ? 200 : (result.error?.code === 'NOT_FOUND' ? 404 : 400)).json(result)
  })

  console.log('[agent-cli] HTTP routes mounted at /api/agent-cli/*')
}