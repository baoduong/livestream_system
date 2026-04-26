// Facebook Live Comment Integration
// Polls Facebook Graph API for live video comments
// and broadcasts them via SSE to the UI

const POLL_INTERVAL = 3000  // 3 seconds

export class FacebookLivePoller {
  constructor({ pageAccessToken, pageId, onComment, onError }) {
    this.token = pageAccessToken
    this.pageId = pageId
    this.onComment = onComment
    this.onError = onError || console.error
    this.timer = null
    this.videoId = null
    this.lastCommentTime = null  // Track last seen comment to avoid duplicates
    this.seenIds = new Set()
  }

  // Find active live video on the page
  async findLiveVideo() {
    try {
      const url = `https://graph.facebook.com/v21.0/${this.pageId}/live_videos?status=LIVE_NOW&fields=id,title,status,live_views&access_token=${this.token}`
      const res = await fetch(url)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message || `HTTP ${res.status}`)
      }
      const data = await res.json()
      if (data.data && data.data.length > 0) {
        return data.data[0]  // Return first active live video
      }
      return null
    } catch (err) {
      this.onError(`[fb] Error finding live video: ${err.message}`)
      return null
    }
  }

  // Fetch comments for a live video
  async fetchComments() {
    if (!this.videoId) return []

    try {
      let url = `https://graph.facebook.com/v21.0/${this.videoId}/comments?fields=id,message,from{id,name,picture},created_time&order=reverse_chronological&limit=50&access_token=${this.token}`

      // If we have a last comment time, only fetch newer
      if (this.lastCommentTime) {
        url += `&since=${Math.floor(new Date(this.lastCommentTime).getTime() / 1000)}`
      }

      const res = await fetch(url)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message || `HTTP ${res.status}`)
      }

      const data = await res.json()
      return data.data || []
    } catch (err) {
      this.onError(`[fb] Error fetching comments: ${err.message}`)
      return []
    }
  }

  // Start polling for a specific video ID
  async startWithVideoId(videoId) {
    this.videoId = videoId
    this.seenIds.clear()
    this.lastCommentTime = null
    console.log(`[fb] Polling comments for video: ${videoId}`)
    this._startPolling()
  }

  // Auto-detect live video and start polling
  async startAutoDetect() {
    console.log(`[fb] Looking for active live video on page ${this.pageId}...`)
    const video = await this.findLiveVideo()
    if (!video) {
      console.log('[fb] No active live video found. Waiting...')
      // Keep checking every 10s for a live video to start
      this.timer = setInterval(async () => {
        const v = await this.findLiveVideo()
        if (v) {
          console.log(`[fb] Live video found: ${v.id} "${v.title || 'Untitled'}"`)
          clearInterval(this.timer)
          await this.startWithVideoId(v.id)
        }
      }, 10000)
      return null
    }

    console.log(`[fb] Live video found: ${video.id} "${video.title || 'Untitled'}" (${video.live_views || 0} viewers)`)
    await this.startWithVideoId(video.id)
    return video
  }

  _startPolling() {
    if (this.timer) clearInterval(this.timer)

    // Fetch immediately once
    this._poll()

    // Then poll every POLL_INTERVAL
    this.timer = setInterval(() => this._poll(), POLL_INTERVAL)
  }

  async _poll() {
    const comments = await this.fetchComments()
    if (!comments.length) return

    // Process in chronological order (API returns reverse_chronological)
    const sorted = [...comments].reverse()

    for (const comment of sorted) {
      if (this.seenIds.has(comment.id)) continue
      this.seenIds.add(comment.id)

      // Update last seen time
      this.lastCommentTime = comment.created_time

      // Build comment object matching our app format
      // Fetch avatar separately since Graph API restricts 'from.picture'
      let avatarUrl = comment.from?.picture?.data?.url || null
      const userId = comment.from?.id || null
      if (!avatarUrl && userId) {
        try {
          const picRes = await fetch(`https://graph.facebook.com/v21.0/${userId}/picture?type=large&redirect=false&access_token=${this.token}`)
          if (picRes.ok) {
            const picData = await picRes.json()
            avatarUrl = picData?.data?.url || null
          }
        } catch {}
      }

      const item = {
        fbCommentId: comment.id,
        customerName: comment.from?.name || 'Unknown',
        commentText: comment.message || '',
        avatarUrl,
        facebookUserId: userId,
        platform: 'facebook',
        createdAt: comment.created_time,
      }

      console.log(`[fb] Comment: ${item.customerName}: ${item.commentText}`)

      if (this.onComment) {
        this.onComment(item)
      }
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.videoId = null
    console.log('[fb] Polling stopped')
  }

  isRunning() {
    return this.timer !== null
  }

  getVideoId() {
    return this.videoId
  }
}