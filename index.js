var util = require('util')
  , events = require('events')
  , crypto = require('crypto')
  , path = require('path')
  , url = require('url')
  , fs = require('fs')
  , util = require('util')
  , stream = require('stream')
  , qs = require('querystring')
  , http = require('http')
  , https = require('https')
  // Dependencies
  , routes = require('routes')
  , io = require('socket.io')
  , filed = require('filed')
  // Local Imports
  , handlebars = require('./handlebars')
  , rfc822 = require('./rfc822')
  ;

var cap = function (stream, limit) {
  if (!limit) limit = Infinity
  stream.caplimit = limit
  stream.bufferedData = []
  stream.bufferedLength = 0

  stream._capemit = stream.emit
  stream.emit = function () {
    if (arguments[0] === 'data') {
      stream.bufferedData.push(arguments)
      stream.bufferedLength += arguments[1].length
      if (stream.bufferedLength > stream.caplimit) {
        stream.pause()
      }
    } else if (arguments[0] === 'end') {
      stream.ended = true
    } else {
      stream._capemit.apply(stream, arguments)
    }
  }

  stream.release = function () {
    stream.emit = stream._capemit
    while (stream.bufferedData.length) {
      stream.emit.apply(stream, stream.bufferedData.shift())
    }
    if (stream.ended) stream.emit('end')
    if (stream.readable) stream.resume()
  }

  return stream
}

module.exports = function (options) {
  return new Application(options)
}
exports.globalMiddles = {}

function BufferResponse (buffer, mimetype) {
  if (!Buffer.isBuffer(buffer)) this.body = new Buffer(buffer)
  else this.body = buffer
  this.timestamp = rfc822.getRFC822Date(new Date())
  this.etag = crypto.createHash('md5').update(buffer).digest("hex")
  this.mimetype = mimetype
}
BufferResponse.prototype.request = function (req, resp) {
  resp.setHeader('content-type', this.mimetype)
  resp.setHeader('last-modified',  this.timestamp)
  resp.setHeader('etag', this.etag)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    resp.statusCode = 405
    return resp.end()
  }
  if (req.headers['if-none-match'] === this.etag ||
      req.headers['if-modified-since'] === this.timestamp) {
    resp.statusCode = 304
    return resp.end()
  }
  resp.statusCode = 200
  return resp.end(this.body)
}

function Page (templatename) {
  var self = this
  self.promises = {}
  self.counter = 0
  self.results = {}
  self.dests = []
  self.on('pipe', function (src) {
    if (src.method && (src.method === 'PUT' || src.method == 'POST')) {
      var p = self.promise('body')
      src.on('error', function (e) {
        p(e)
      })
      src.on('body', function (body) {
        p(null, body)
      })
      if (src.json) {
        var jp = self.promise('json')
        src.on('json', function (obj) {
          jp(null, obj)
        })
      }
    }
  })
  process.nextTick(function () {
    if (self.listeners('error').length === 0) {
      self.on('error', function (err) {
        if (self.dests.length) {
          self.dests.forEach(function (resp) {
            if (resp.error) return resp.error(err)
          })
        } else {
          self.application.logger.error('Page::Uncaught Error:')
          self.application.logger.error(e)
        }
      })
    }
    
    if (templatename) {
      self.template(templatename)
    }
    if (self.counter === 0) self.emit('finish', self.results)
  })
}
util.inherits(Page, stream.Stream)
Page.prototype.promise = function (name, cb) {
  if (name === 'error') throw new Error("You cannot name a promise 'error'")
  if (name === 'finish') throw new Error("You cannot name a promise 'finish'")
  if (name === 'resolved') throw new Error("You cannot name a promise 'resolved'")
  var self = this;
  self.counter += 1
  self.promises[name] = function (e, result) {
    self.emit('resolved', name, e, result)
    if (e) {
      e.promise = name
      return self.emit('error', e, name)
    }
    self.emit(name, result)
    self.results[name] = result
    self.counter = self.counter - 1
    if (self.counter === 0) self.emit('finish', self.results)
  }
  if (cb) self.on(name, cb)
  return self.promises[name]
}
Page.prototype.pipe = function (dest) {
  this.dests.push(dest)
}
Page.prototype.write = function () {}
Page.prototype.end = function () {}
Page.prototype.destroy = function () {}

// Templates implementation
function Templates (app) {
  this.files = {}
  this.loaded = true
  this.after = {}
  this.app = app
  this.names = {}
  this.loading = 0
  this.tempcache = {}
  this.Template = function (text) {
    this.compiled = handlebars.compile(text)
  }
  this.Template.prototype.render = function (obj) {
    return new Buffer(this.compiled(obj))
  }
}
util.inherits(Templates, events.EventEmitter)
Templates.prototype.get = function (name, cb) {
  var self = this
  
  if (name.indexOf(' ') !== -1 || name[0] === '<') {
    process.nextTick(function () {
      if (!self.tempcache[name]) {
        self.tempcache[name] = new self.Template(name)
      }
      cb(null, self.tempcache[name])
    })
    return
  }
  
  function finish () {
    if (name in self.names) {
      cb(null, self.files[self.names[name]])
    } else {
      cb(new Error("Cannot find template"))
    }
  }
  if (this.loaded) {
    process.nextTick(finish)
  } else {
    self.once('loaded', finish)
  }
}
Templates.prototype.directory = function (dir) {
  var self = this
  this.loaded = false
  this.loading += 1
  loadfiles(dir, function (e, filemap) {
    if (e) return self.emit('error', e)
    for (i in filemap) {
      self.files[i] = new self.Template(filemap[i])
      self.names[path.basename(i)] = i
      self.names[path.basename(i, path.extname(i))] = i
    }
    self.loading -= 1
    self.loaded = true
    if (self.loading === 0) self.emit('loaded')
  })
} 

function loadfiles (f, cb) {
  var filesmap = {}
  fs.readdir(f, function (e, files) {
    if (e) return cb(e)
    var counter = 0
    files.forEach(function (filename) {
      counter += 1
      fs.stat(path.join(f, filename), function (e, stat) {
        if (stat.isDirectory()) {
          loadfiles(path.join(f, filename), function (e, files) {
            if (e) return cb(e)
            for (i in files) {
              filesmap[i] = files[i]
            }
            counter -= 1
            if (counter === 0) cb(null, filesmap)
          })
        } else {
          fs.readFile(path.join(f, filename), function (e, data) {
            filesmap[path.join(f, filename)] = data.toString()
            counter -= 1
            if (counter === 0) cb(null, filesmap)
          })
        }
      })
    })
  })
}

function Application (options) {
  var self = this
  if (!options) options = {}
  self.options = options
  self.middles = []
  self.addHeaders = {}
  if (self.options.logger) {
    self.logger = self.options.logger
  } 
  
  self.onRequest = function (req, resp) {
    if (self.logger.info) self.logger.info('Request', req.url, req.headers)
    // Opt out entirely if this is a socketio request
    if (req.url.slice(0, '/socket.io/'.length) === '/socket.io/') {
      return self._ioEmitter.emit('request', req, resp)
    }
    
    for (i in self.addHeaders) {
      resp.setHeader(i, self.addHeaders[i])
    }
    
    req.accept = function () {
      if (!req.headers.accept) return null
      var cc = null
      var pos = 99999999
      for (var i=arguments.length-1;i!==-1;i--) {
        var ipos = req.headers.accept.indexOf(arguments[i])
        if ( ipos !== -1 && ipos < pos ) cc = arguments[i]
      }
      return cc
    }

    resp.error = function (err) {
      if (typeof(err) === "string") err = {message: err}
      if (!err.statusCode) err.statusCode = 500
      resp.statusCode = err.statusCode || 500
      self.logger.log('error %statusCode "%message "', err)
      resp.end(err.message || err) // this should be better
    }

    // Get all the parsed url properties on the request
    // This is the same style express uses and it's quite nice
    var parsed = url.parse(req.url)
    for (i in parsed) {
      req[i] = parsed[i]
    }
    
    if (req.query) req.qs = qs.parse(req.query)

    req.route = self.router.match(req.pathname)

    if (!req.route) return self.notfound(req, resp)

    req.params = req.route.params

    var onWrites = []
    resp._write = resp.write
    resp.write = function () {
      if (onWrites.length === 0) return resp._write.apply(resp, arguments)
      var args = arguments
      onWrites.forEach(function (onWrite) {
        var c = onWrite.apply(resp, args)
        if (c !== undefined) args[0] = c
      })
      return resp._write.apply(resp, args)
    }

    // Fix for node's premature header check in end()
    resp._end = resp.end
    resp.end = function (chunk) {
      if (chunk) resp.write(chunk)
      resp._end()
      self.logger.info('Response', resp.statusCode, req.url, resp._headers)
    }

    self.emit('request', req, resp)

    self.middles.forEach(function (middle) {
      middle.emit('request', req, resp)
      if (resp.onWrite) {
        onWrites.push(resp.onWrite)
        resp.onWrite = null
      }
    })

    if (req.listeners('body').length) {
      var buffer = ''
      req.on('data', function (chunk) {
        buffer += chunk
      })
      req.on('end', function (chunk) {
        if (chunk) buffer += chunk
        req.emit('body', buffer)
      })
    }

    req.route.fn.call(req.route, req, resp, self.authHandler)
  }

  self.router = new routes.Router()
  self.on('newroute', function (route) {
    self.router.addRoute(route.path, function (req, resp, authHandler) {
      route.handler(req, resp, authHandler)
    })
  })
  
  self.templates = new Templates(self)
  
  // Default to having json enabled
  self.middle('json')
  
  // setup servers
  self.http = options.http || {}
  self.https = options.https || {}
  self.socketio = options.socketio || {}
  if (!self.socketio.logger && self.logger) {
    self.socketio.logger = self.logger
  }
  
  self._ioEmitter = new events.EventEmitter()
  
  self.httpServer = http.createServer()
  self.httpsServer = https.createServer(self.https)
  
  self.httpServer.on('request', self.onRequest)
  self.httpsServer.on('request', self.onRequest)
  self.httpServer.on('upgrade', function (request, socket, head) {
    self._ioEmitter.emit('upgrade', request, socket, head)
  })
  self.httpsServer.on('upgrade', function (request, socket, head) {
    self._ioEmitter.emit('upgrade', request, socket, head)
  })
  
  var _listenProxied = false
  var listenProxy = function () {
    if (!_listenProxied) self._ioEmitter.emit('listening')
    _listenProxied = true
  }
  
  self.httpServer.on('listening', listenProxy)
  self.httpsServer.on('listening', listenProxy)
  
  // setup socket.io
  self.socketioManager = new io.Manager(self._ioEmitter, self.socketio)
  self.sockets = self.socketioManager.sockets
  
  if (!self.logger) {
    self.logger = 
      { log: console.log
      , error: console.error
      , info: function () {}
      }
  }
}
util.inherits(Application, events.EventEmitter)

Application.prototype.addHeader = function (name, value) {
  this.addHeaders[name] = value
}

Application.prototype.route = function (path, cb) {
  var r = new Route(path, this)
  if (cb) r.on('request', cb)
  return r
}
Application.prototype.middle = function (mid) {
  if (typeof mid === 'string') {
    if (!exports.globalMiddles[mid]) throw new Error('No known global middleware of type "'+mid+'"')
    mid = exports.globalMiddles[mid]
  }
  this.middles.push(mid)
  return this
}

Application.prototype.listen = function (createServer, port, cb) {
  var self = this
  if (!cb) {
    cb = port
    port = createServer
  }
  self.server = createServer(function (req, resp) {
    self.onRequest(req, resp)
  })
  self.server.listen(port, cb)
  return this
}
Application.prototype.close = function () {
  this.server.close()
  return this
}
Application.prototype.notfound = function (req, resp) {
  var cc = req.accept('text/html', 'application/json', 'text/plain', '*/*') || 'text/plain'
  if (cc === '*/*') cc = 'text/plain'
  resp.statusCode = 404
  resp.setHeader('content-type', cc)
  if (cc === 'text/html') {
    body = '<html><body>Not Found</body></html>'
  } else if (cc === 'application/json') {
    body = JSON.stringify({status:404, reason:'not found', message:'not found'})
  } else {
    body = 'Not Found'
  }
  resp.end(body)
}
Application.prototype.auth = function (handler) {
  if (!handler) return this.authHandler
  this.authHandler = handler
}
Application.prototype.page = function () {
  var page = new Page()
    , self = this
    ;
  page.application = self
  page.template = function (name) {    
    var p = page.promise("template")
    self.templates.get(name, function (e, template) {
      if (e) return p(e)
      if (p.src) p.src.pipe(template)
      page.on('finish', function () {
        process.nextTick(function () {
          var text = template.render(page.results)
          page.dests.forEach(function (d) {
            if (d._header) return // Don't try to write to a response that's already finished
            if (d.writeHead) {
              d.statusCode = 200
              d.setHeader('content-type', page.mimetype || 'text/html')
              d.setHeader('content-length', text.length)
            }
            d.write(text)
            d.end()
          })
        })
      })
      p(null, template)
    })
  }
  return page
}

function JSONMiddleware () {
  this.on('request', function (req, resp) {
    resp.onWrite = function (chunk) {
      // bail fast for chunks to limit impact on streaming
      if (Buffer.isBuffer(chunk)) return chunk
      // if it's an object serialize it and set proper headers
      if (typeof chunk === 'object') {
        chunk = new Buffer(JSON.stringify(chunk))
        resp.setHeader('content-type', 'application/json')
        resp.setHeader('content-length', chunk.length)
        if (!resp.statusCode && (req.method === 'GET' || req.method === 'HEAD')) {
          resp.statusCode = 200
        }
        return chunk
      }
      return chunk
    }
    
    if (req.method === "PUT" || req.method === "POST") {
      if (req.headers['content-type'] === 'application/json') {
        req.on('body', function (body) {
          req.emit('json', JSON.parse(body))
        })
      }
    }
  })
}
util.inherits(JSONMiddleware, events.EventEmitter)
exports.globalMiddles['json'] = new JSONMiddleware()

function Route (path, application) {
  // This code got really crazy really fast.
  // There are a lot of different states that close out of other logic.
  // This could be refactored but it's hard because there is so much
  // cascading logic.
  var self = this
  self.path = path
  self.app = application
  self.byContentType = {}

  var returnEarly = function (req, resp, keys, authHandler) {
    if (self._events && self._events['request']) {
      if (authHandler) {
        cap(req)
        authHandler(req, resp, function (user) {
          req.user = user
          if (self._must && self._must.indexOf('auth') !== -1 && !req.user) {
            resp.statusCode = 403
            resp.setHeader('content-type', 'application/json')
            resp.end(JSON.stringify({error: 'This resource requires auth.'}))
            return
          }
          self.emit('request', req, resp)
          req.release()
        })
      } else {
        if (self._must && self._must.indexOf('auth') !== -1 && !req.user) {
          resp.statusCode = 403
          resp.setHeader('content-type', 'application/json')
          resp.end(JSON.stringify({error: 'This resource requires auth.'}))
          return
        }
        self.emit('request', req, resp)
      }
    } else {
      resp.statusCode = 406
      resp.setHeader('content-type', 'text/plain')
      resp.end('Request does not include a valid mime-type for this resource: '+keys.join(', '))
    }
  }

  self.handler = function (req, resp, authHandler) {
    if (self._methods && self._methods.indexOf(req.method) === -1) {
      resp.statusCode = 405
      resp.end('Method not Allowed.')
      return
    }
    
    self.emit('before', req, resp)
    if (self.authHandler) {
      authHandler = self.authHandler
    }

    var keys = Object.keys(self.byContentType).concat(['*/*'])
    if (keys.length) {
      if (req.method !== 'PUT' && req.method !== 'POST') {
        var cc = req.accept.apply(req, keys)
      } else {
        var cc = req.headers['content-type']
      }

      if (!cc) return returnEarly(req, resp, keys, authHandler)
      if (cc === '*/*') {
        var h = this.byContentType[Object.keys(this.byContentType)[0]]
      } else {
        var h = this.byContentType[cc]
      }
      if (!h) return returnEarly(req, resp, keys, authHandler)
      resp.setHeader('content-type', cc)

      var run = function () {
        if (h.request) {
          return h.request(req, resp)
        }
        if (h.pipe) {
          req.pipe(h)
          h.pipe(resp)
          return
        }
        h.call(req.route, req, resp)
      }

      if (authHandler) {
        cap(req)
        authHandler(req, resp, function (user) {
          req.user = user
          if (self._must && self._must.indexOf('auth') !== -1 && !req.user) {
            resp.statusCode = 403
            resp.setHeader('content-type', 'application/json')
            resp.end(JSON.stringify({error: 'This resource requires auth.'}))
            return
          }
          run()
          req.release()
        })
      } else {
        if (self._must && self._must.indexOf('auth') !== -1) {
          resp.statusCode = 403
          resp.setHeader('content-type', 'application/json')
          resp.end(JSON.stringify({error: 'This resource requires auth.'}))
          return
        }
        run()
      }

    } else {
      returnEarly(req, resp, keys, authHandler)
    }
  }
  application.emit('newroute', self)
}
util.inherits(Route, events.EventEmitter)
Route.prototype.json = function (cb) {
  if (Buffer.isBuffer(cb)) cb = new BufferResponse(cb, 'application/json')
  else if (typeof cb === 'object') cb = new BufferResponse(JSON.stringify(cb), 'application/json')
  else if (typeof cb === 'string') {
    if (cb[0] === '/') cb = filed(cb)
    else cb = new BufferResponse(cb, 'application/json')
  }
  this.byContentType['application/json'] = cb
  return this
}
Route.prototype.html = function (cb) {
  if (Buffer.isBuffer(cb)) cb = new BufferResponse(cb, 'text/html')
  else if (typeof cb === 'string') {
    if (cb[0] === '/') cb = filed(cb)
    else cb = new BufferResponse(cb, 'text/html')
  }
  this.byContentType['text/html'] = cb
  return this
}
Route.prototype.file = function (filepath) {
  this.on('request', function (req, resp) {
    var f = filed(filepath)
    req.pipe(f)
    f.pipe(resp)
  })
  return this
}
Route.prototype.files = function (filepath) {
  this.on('request', function (req, resp) {
    req.route.splats.unshift(filepath)
    var f = filed(path.join.apply(path.join, req.route.splats))
    req.pipe(f)
    f.pipe(resp)
  })
  return this
}
Route.prototype.auth = function (handler) {
  if (!handler) return this.authHandler
  this.authHandler = handler
  return this
}
Route.prototype.must = function () {
  this._must = Array.prototype.slice.call(arguments)
  return this
}
Route.prototype.methods = function () {
  this._methods = Array.prototype.slice.call(arguments)
  return this
}

function ServiceError(msg) {
  Error.apply(this, arguments)
  this.message = msg 
  this.stack = (new Error()).stack;
}
ServiceError.prototype = new Error()
ServiceError.prototype.constructor = ServiceError
ServiceError.prototype.name = 'ServiceError'
module.exports.ServiceError = ServiceError