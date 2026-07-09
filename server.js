/**
 * LitigationSpace local preview
 * Serves compiled frontend and proxies API to live production.
 * Run: node server.js
 */

const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const url = require('url')

const PORT = 5173
const FRONTEND_DIR = path.join(__dirname, 'frontend')
const API_TARGET = 'litigationspace.com'

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
}

function proxyRequest(req, res, targetPath) {
  const chunks = []
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const headers = { ...req.headers }
    delete headers.host
    delete headers.connection
    delete headers['transfer-encoding']
    headers.host = API_TARGET

    const options = {
      hostname: API_TARGET,
      port: 443,
      path: targetPath,
      method: req.method,
      headers,
    }

    const proxy = https.request(options, proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers)
      proxyRes.pipe(res)
    })
    proxy.on('error', err => {
      res.writeHead(502)
      res.end('API proxy error: ' + err.message)
    })
    if (body.length) proxy.write(body)
    proxy.end()
  })
}

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      const fallback = path.join(FRONTEND_DIR, 'index.html')
      return fs.readFile(fallback, (e2, html) => {
        if (e2) {
          res.writeHead(404)
          return res.end('Not found')
        }
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html)
      })
    }
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  })
}

http.createServer((req, res) => {
  const parsed = url.parse(req.url)
  const pathname = parsed.pathname

  if (pathname.startsWith('/api/') || pathname === '/healthz') {
    proxyRequest(req, res, pathname + (parsed.search || ''))
    return
  }

  let filePath = path.join(FRONTEND_DIR, pathname)
  if (!path.extname(pathname)) {
    filePath = path.join(FRONTEND_DIR, 'index.html')
  }
  serveFile(filePath, res)
}).listen(PORT, () => {
  console.log('LitigationSpace local preview: http://localhost:' + PORT)
})