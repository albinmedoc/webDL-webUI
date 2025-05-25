import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { spawn } from 'child_process'
import path from 'path'
import cors from 'cors'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const server = createServer(app)
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
})

const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.static('dist'))

// Store active downloads
const activeDownloads = new Map()

// Function to sanitize command for logging (hide sensitive data)
const sanitizeCommandForLogging = (command, args) => {
  const sanitizedArgs = args.map((arg, index) => {
    // If previous arg was --token or -p (password), hide this arg
    if (index > 0 && (args[index - 1] === '--token' || args[index - 1] === '-p')) {
      return '***HIDDEN***'
    }
    return arg
  })
  return `${command} ${sanitizedArgs.join(' ')}`
}

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id)

  // Handle download request
  socket.on('start-download', async (data) => {
    try {
      const { url, args, downloadId } = data

      if (!url) {
        socket.emit('download-error', { 
          downloadId, 
          error: 'URL is required' 
        })
        return
      }

      // Validate URL to prevent command injection
      const urlRegex = /^https?:\/\/[^\s]+$/
      if (!urlRegex.test(url)) {
        socket.emit('download-error', { 
          downloadId, 
          error: 'Invalid URL format' 
        })
        return
      }

      // Construct the command
      const command = 'svtplay-dl'
      const commandArgs = [...args, url]

      console.log(`Executing: ${sanitizeCommandForLogging(command, commandArgs)}`)

      // Execute svtplay-dl
      const process = spawn(command, commandArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      // Store the process for potential cancellation
      activeDownloads.set(downloadId, process)

      // Emit download started
      socket.emit('download-started', {
        downloadId,
        command: sanitizeCommandForLogging(command, commandArgs),
        url
      })

      let output = ''
      let errorOutput = ''

      process.stdout.on('data', (data) => {
        const chunk = data.toString()
        output += chunk
        
        // Parse progress from svtplay-dl output
        let progress = null
        let eta = null
        let status = 'downloading'
        
        // Check for completion messages
        if (chunk.includes('Download completed successfully')) {
          progress = 100
          status = 'completed'
        }
        
        // svtplay-dl progress format: [current/total][progress_bar] ETA: time
        const progressMatch = chunk.match(/\[(\d+)\/(\d+)\]/)
        if (progressMatch) {
          const current = parseInt(progressMatch[1])
          const total = parseInt(progressMatch[2])
          progress = total > 0 ? Math.round((current / total) * 100 * 100) / 100 : 0
          
          // If current equals total, we're at 100%
          if (current === total) {
            progress = 100
          }
          

        }
        
        // Extract ETA
        const etaMatch = chunk.match(/ETA:\s*(\d+:\d+:\d+|\d+:\d+)/)
        if (etaMatch) {
          eta = etaMatch[1]
          // If ETA is 0:00:00, we're essentially done with download
          if (eta === '0:00:00') {
            progress = 100
          }
        }
        
        // Only emit if we have progress data or it's a significant chunk
        if (progress !== null || chunk.includes('INFO:') || chunk.includes('ERROR:') || chunk.includes('[')) {
          // Emit real-time progress updates
          socket.emit('download-progress', {
            downloadId,
            chunk: chunk.trim(),
            output: output.trim(),
            progress: progress,
            eta: eta,
            status: status
          })
        }
      })

      process.stderr.on('data', (data) => {
        const chunk = data.toString()
        
        // Check if this is actually progress data (svtplay-dl sends progress to stderr)
        const isProgressData = /\[\d+\/\d+\]/.test(chunk) || chunk.includes('ETA:')
        
        if (isProgressData) {
          // Treat stderr progress data the same as stdout progress data
          output += chunk
          
          // Parse progress from svtplay-dl output
          let progress = null
          let eta = null
          let status = 'downloading'
          
          // Check for completion messages
          if (chunk.includes('Download completed successfully')) {
            progress = 100
            status = 'completed'
          }
          
          // svtplay-dl progress format: [current/total][progress_bar] ETA: time
          const progressMatch = chunk.match(/\[(\d+)\/(\d+)\]/)
          if (progressMatch) {
            const current = parseInt(progressMatch[1])
            const total = parseInt(progressMatch[2])
            progress = total > 0 ? Math.round((current / total) * 100 * 100) / 100 : 0
            
            // If current equals total, we're at 100%
            if (current === total) {
              progress = 100
            }
            

          }
          
          // Extract ETA
          const etaMatch = chunk.match(/ETA:\s*(\d+:\d+:\d+|\d+:\d+)/)
          if (etaMatch) {
            eta = etaMatch[1]
            // If ETA is 0:00:00, we're essentially done with download
            if (eta === '0:00:00') {
              progress = 100
            }
          }
          
          // Only emit if we have progress data or it's a significant chunk
          if (progress !== null || chunk.includes('INFO:') || chunk.includes('[')) {
            // Emit real-time progress updates
            socket.emit('download-progress', {
              downloadId,
              chunk: chunk.trim(),
              output: output.trim(),
              progress: progress,
              eta: eta,
              status: status
            })
          }
        } else {
          // This is an actual error message
          errorOutput += chunk
          
          // Emit error progress only for real errors
          socket.emit('download-progress', {
            downloadId,
            chunk: chunk.trim(),
            error: true
          })
        }
      })

      process.on('close', (code) => {
        activeDownloads.delete(downloadId)
        
        if (code === 0) {
          socket.emit('download-completed', {
            downloadId,
            success: true,
            output: output.trim(),
            command: sanitizeCommandForLogging(command, commandArgs)
          })
        } else {
          socket.emit('download-completed', {
            downloadId,
            success: false,
            error: errorOutput || `Process exited with code ${code}`,
            output: output.trim()
          })
        }
      })

      process.on('error', (error) => {
        console.error('Process error:', error)
        activeDownloads.delete(downloadId)
        socket.emit('download-error', {
          downloadId,
          error: `Failed to start svtplay-dl: ${error.message}`
        })
      })

    } catch (error) {
      console.error('Download error:', error)
      socket.emit('download-error', {
        downloadId: data.downloadId,
        error: 'Internal server error'
      })
    }
  })

  // Handle download cancellation
  socket.on('cancel-download', (data) => {
    const { downloadId } = data
    const process = activeDownloads.get(downloadId)
    
    if (process) {
      process.kill('SIGTERM')
      activeDownloads.delete(downloadId)
      socket.emit('download-cancelled', { downloadId })
    }
  })

  // Handle sync request for download status
  socket.on('sync-downloads', (data) => {
    const { downloadIds } = data
    
    downloadIds.forEach(downloadId => {
      const process = activeDownloads.get(downloadId)
      
      if (process) {
        // Download is still active on server
        socket.emit('download-sync', {
          downloadId,
          status: 'downloading',
          progress: null // Will be updated by next progress event
        })
      } else {
        // Download not found on server
        socket.emit('download-not-found', { downloadId })
      }
    })
  })

  // Handle health check
  socket.on('health-check', () => {
    socket.emit('health-status', { 
      status: 'ok', 
      timestamp: new Date().toISOString() 
    })
  })

  // Handle svtplay-dl availability check
  socket.on('check-svtplay-dl', () => {
    const process = spawn('svtplay-dl', ['--version'], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let output = ''
    let errorOutput = ''

    process.stdout.on('data', (data) => {
      output += data.toString()
    })

    process.stderr.on('data', (data) => {
      errorOutput += data.toString()
    })

    process.on('close', (code) => {
      if (code === 0) {
        socket.emit('svtplay-dl-status', {
          available: true,
          version: output.trim()
        })
      } else {
        socket.emit('svtplay-dl-status', {
          available: false,
          error: errorOutput || 'svtplay-dl not found'
        })
      }
    })

    process.on('error', (error) => {
      socket.emit('svtplay-dl-status', {
        available: false,
        error: `svtplay-dl not found: ${error.message}`
      })
    })
  })

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id)
  })
})

// Serve the frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log('WebSocket server ready for connections')
})
