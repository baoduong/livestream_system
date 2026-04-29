// Facebook Live Comment Integration
// Polls Facebook Graph API for live video comments
// Dev mode: `from` field may be missing → emits with customerName='Unknown'
// Enricher (fb-enricher.js) fills in user info later via Playwright

import EventEmitter from 'events'

const POLL_INTERVAL = 10000  // 10 seconds — backup for enricher (360 calls/hr)
const MAX_RETRY_INTERVAL = 60000  // Max backoff on errors/rate limits

export class FacebookLivePoller extends EventEmitter {
  constructor({ pageAccessToken, pageId, onComment, onError }) {
    super()
    this.token = pageAccessToken
    this.pageId = pageId
    this.onComment = onComment
    this.onError = onError || console.error
    this.timer = null
    this.videoId = null
    this.lastCommentTime = null
    this.seenIds = new Set()
    this.enrichQueue = []
    this.currentInterval = POLL_INTERVAL
    this.consecutiveErrors = 0
    this.callCount = 0
    this.callCountResetAt = Date.now() + 3600000
  }

  // Find active live video on the page
  async findLiveVideo() {
    try {
      const url = `https://graph.facebook.com/v21.0/${this.pageId}/live_videos?status=LIVE&fields=id,title,status,live_views&access_token=${this.token}`
      const res = await fetch(url)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message || `HTTP ${res.status}`)
      }
      const data = await res.json()
      if (data.data && data.data.length > 0) {
        return data.data[0]
      }
      return null
    } catch (err) {
      this.onError(`[fb-poller] Error finding live video: ${err.message}`)
      return null
    }
  }

  // Fetch comments for a live video
  async fetchComments() {
    if (!this.videoId) return []

    try {
      // Track hourly call count
      if (Date.now() > this.callCountResetAt) {
        console.log(`[fb-poller] Hourly stats: ${this.callCount} API calls`)
        this.callCount = 0
        this.callCountResetAt = Date.now() + 3600000
      }
      this.callCount++

      let url = `https://graph.facebook.com/v21.0/${this.videoId}/comments?fields=id,message,from{id,name,picture},created_time&order=reverse_chronological&limit=50&access_token=${this.token}`

      if (this.lastCommentTime) {
        url += `&since=${Math.floor(new Date(this.lastCommentTime).getTime() / 1000)}`
      }

      const res = await fetch(url)

      // Rate limit handling
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '60')
        console.warn(`[fb-poller] ⚠️ Rate limited! Backing off ${retryAfter}s`)
        this.consecutiveErrors++
        this._adjustInterval()
        return []
      }

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message || `HTTP ${res.status}`)
      }

      // Success — reset backoff
      if (this.consecutiveErrors > 0) {
        this.consecutiveErrors = 0
        this._adjustInterval()
      }

      const data = await res.json()
      return data.data || []
    } catch (err) {
      this.onError(`[fb-poller] Error fetching comments: ${err.message}`)
      this.consecutiveErrors++
      this._adjustInterval()
      return []
    }
  }

  // Adjust polling interval based on errors (exponential backoff)
  _adjustInterval() {
    if (this.consecutiveErrors === 0) {
      this.currentInterval = POLL_INTERVAL
    } else {
      // 15s → 30s → 60s max
      this.currentInterval = Math.min(POLL_INTERVAL * Math.pow(2, this.consecutiveErrors), MAX_RETRY_INTERVAL)
    }
    console.log(`[fb-poller] Interval: ${this.currentInterval / 1000}s (errors: ${this.consecutiveErrors})`)
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = setInterval(() => this._poll(), this.currentInterval)
    }
  }

  // Start polling for a specific video ID
  async startWithVideoId(videoId) {
    this.videoId = videoId
    this.seenIds.clear()
    this.lastCommentTime = null
    this.consecutiveErrors = 0
    this.currentInterval = POLL_INTERVAL
    console.log(`[fb-poller] Polling comments for video: ${videoId} (interval: ${POLL_INTERVAL / 1000}s)`)
    this._startPolling()
  }

  // Auto-detect live video and start polling
  async startAutoDetect() {
    console.log(`[fb-poller] Looking for active live video on page ${this.pageId}...`)
    const video = await this.findLiveVideo()
    if (!video) {
      console.log('[fb-poller] No active live video found. Waiting...')
      this.timer = setInterval(async () => {
        const v = await this.findLiveVideo()
        if (v) {
          console.log(`[fb-poller] Live video found: ${v.id} "${v.title || 'Untitled'}"`)
          clearInterval(this.timer)
          await this.startWithVideoId(v.id)
        }
      }, 10000)
      return null
    }

    console.log(`[fb-poller] Live video found: ${video.id} "${video.title || 'Untitled'}" (${video.live_views || 0} viewers)`)
    await this.startWithVideoId(video.id)
    return video
  }

  _startPolling() {
    if (this.timer) clearInterval(this.timer)
    this._poll()
    this.timer = setInterval(() => this._poll(), this.currentInterval)
  }

  async _poll() {
    const comments = await this.fetchComments()
    if (!comments.length) return

    const sorted = [...comments].reverse()

    for (const comment of sorted) {
      if (this.seenIds.has(comment.id)) continue
      this.seenIds.add(comment.id)

      this.lastCommentTime = comment.created_time

      const hasFrom = !!comment.from?.id
      let avatarUrl = comment.from?.picture?.data?.url || null
      const userId = comment.from?.id || null

      // Skip extra API call for avatar if we're trying to save calls
      // Only fetch if we have userId and no avatar from the main response
      if (!avatarUrl && userId) {
        try {
          const picRes = await fetch(`https://graph.facebook.com/v21.0/${userId}/picture?type=large&redirect=false&access_token=${this.token}`)
          this.callCount++ // count this too
          if (picRes.ok) {
            const picData = await picRes.json()
            avatarUrl = picData?.data?.url || null
          }
        } catch {}
      }

      const item = {
        fbCommentId: comment.id,
        customerName: comment.from?.name || null,
        commentText: comment.message || '',
        avatarUrl,
        facebookUserId: userId,
        platform: 'facebook',
        createdAt: comment.created_time,
        needsEnrichment: !hasFrom,
      }

      console.log(`[fb-poller] Comment ${comment.id}: ${item.customerName || '(unknown)'}: ${item.commentText}`)

      if (this.onComment) {
        this.onComment(item)
      }

      if (!hasFrom) {
        this.enrichQueue.push(comment.id)
        this.emit('needs-enrichment', comment.id)
      }
    }
  }

  drainEnrichQueue() {
    const queue = [...this.enrichQueue]
    this.enrichQueue = []
    return queue
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.videoId = null
    console.log(`[fb-poller] Stopped (total API calls this session: ${this.callCount})`)
  }

  isRunning() {
    return this.timer !== null
  }

  getVideoId() {
    return this.videoId
  }
}
