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
  , filed = require('filed')
  // Local Imports
  , handlebars = require('./handlebars')
  , rfc822 = require('./rfc822')
  , io = null
  , Cookies = require('cookies')
  , Keygrip = require('keygrip')
  ;

try {
  io = require('socket.io')
} catch (er) {
  // oh well, no socket.io.
}

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

function BufferResponse (buffer, mimetype) {
  if (!Buffer.isBuffer(buffer)) this.body = new Buffer(buffer)
  else this.body = buffer
  this.timestamp = rfc822.getRFC822Date(new Date())
  this.etag = crypto.createHash('md5').update(buffer).digest("hex")
  this.mimetype = mimetype
  this.cache = true
}
BufferResponse.prototype.request = function (req, resp) {
  if (resp._headerSent) return // This response already started
  if (this.mimetype) resp.setHeader('content-type', this.mimetype)
  if (this.cache) {
    resp.setHeader('last-modified',  this.timestamp)
    resp.setHeader('etag', this.etag)
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    resp.statusCode = 405
    return (resp._end ? resp._end : resp.end).call(resp)
  }
  if (this.cache &&
      req.headers['if-none-match'] === this.etag ||
      req.headers['if-modified-since'] === this.timestamp
      ) {
    resp.statusCode = 304
    return (resp._end ? resp._end : resp.end).call(resp)
  }
  resp.statusCode = this.statusCode || 200
  ;(resp._write ? resp._write : resp.write).call(resp, this.body)
  return (resp._end ? resp._end : resp.end).call(resp)
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
Page.prototype.event = function (name, cb) {
  var p = this.promise(name, cb)
    , r = function (r) { p(null, r) }
    ;
  return r
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

// interpret cb as some sort of handler.
//
// route.json(function (req, res) { ... }) // you handle the json
// route.json(404) // couldn't find your json.
// route.json(410) // json is gone.  stop asking.
// route.json({ok: true}) // jsonify
// route.json('{"ok":true}') // return this exact json string
// route.json(new Buffer('{"ok":true}')) // return this exact json
// route.json('/path/to/foo.json') // send this file
// If none of these match, returns null, which means 'no handler'
function makeHandler (cb) {
  if (typeof cb === 'function' || (cb instanceof BufferResponse)) {
    // already a valid handler
    return cb
  }

  if (typeof cb === 'number') {
    return function (req, res) {
      return res.error(cb)
    }
  }
  if (Buffer.isBuffer(cb)) {
    return new BufferResponse(cb)
  }
  if (typeof cb === 'object') {
    return new BufferResponse(JSON.stringify(cb), 'application/json')
  }
  if (typeof cb === 'string') {
    if (cb[0] === '/') return filed(cb)
    return new BufferResponse(cb)
  }
  return null
}

function Application (options) {
  var self = this
  if (!options) options = {}
  self.options = options
  self.addHeaders = {}
  if (self.options.logger) {
    self.logger = self.options.logger
  }

  if (options.keys) {
    self.keygrip = new Keygrip(options.keys)
  }

  self._plugins = {}

  self.router = new routes.Router()
  self.on('newroute', function (route) {
    self.router.addRoute(route.path, function (req, resp) {
      req.route = route
    })
  })

  self.templates = new Templates(self)

  // Default to having json enabled
  self.on('request', JSONRequestHandler)

  // setup servers
  self.http = options.http || {}
  self.https = options.https || {}
  if (io) {
    self.socketio = options.socketio === undefined ? {} : options.socketio
    if (!self.socketio.logger && self.logger) {
      self.socketio.logger = self.logger
    }
  } else if (options.socketio) {
    throw new Error('socket.io is not available');
  }

  self.httpServer = http.createServer()
  self.httpsServer = https.createServer(self.https)

  self.httpServer.on('request', self._onRequest.bind(self))
  self.httpsServer.on('request', self._onRequest.bind(self))

  var _listenProxied = false
  var listenProxy = function () {
    if (!_listenProxied && self._ioEmitter) self._ioEmitter.emit('listening')
    _listenProxied = true
  }

  self.httpServer.on('listening', listenProxy)
  self.httpsServer.on('listening', listenProxy)

  if (io && self.socketio) {
    // setup socket.io
    self._ioEmitter = new events.EventEmitter()

    self.httpServer.on('upgrade', function (request, socket, head) {
      self._ioEmitter.emit('upgrade', request, socket, head)
    })
    self.httpsServer.on('upgrade', function (request, socket, head) {
      self._ioEmitter.emit('upgrade', request, socket, head)
    })

    self.socketioManager = new io.Manager(self._ioEmitter, self.socketio)
    self.sockets = self.socketioManager.sockets
  }

  if (!self.logger) {
    self.logger =
      { log: console.log
      , error: console.error
      , info: function () {}
      }
  }
}
util.inherits(Application, events.EventEmitter)

Application.prototype._onRequest = function (req, resp) {
  var self = this
  if (self.logger.info) self.logger.info('Request', req.url, req.headers)
  // Opt out entirely if this is a socketio request
  if (self.socketio && req.url.slice(0, '/socket.io/'.length) === '/socket.io/') {
    return self._ioEmitter.emit('request', req, resp)
  }

  self._decorate(req, resp)

  if (!req.match) return self.notfound(req, resp)

  // attach the route handler
  req.match.fn(req, resp)

  // like doing self.emit('request', req, resp)
  // except that we abort if anyone takes over and starts
  // sending the response.
  var listeners = self.listeners('request')
  for (var i = 0; i < listeners.length; i ++) {
    listeners[i].call(self, req, resp)
    if (resp._headerSent) return
  }
  var listeners = req.route.listeners('request')
  for (var i = 0; i < listeners.length; i ++) {
    listeners[i].call(req.route, req, resp)
    if (resp._headerSent) return
  }

  // all the 'request' event handlers fired, and none
  // of them sent a response.  Apply plugins, and then
  // let the route handle it.
  cap(req)
  self._plug(req, resp, function () {
    // if any of those functions (plugins or event handlers)
    // attached a 'body' listener, then set that up.
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

    req.release()
    // now do the handler dance
    self._applyHandler(req, resp)
  })
}

// apply the handler that is attached to the request.
Application.prototype._applyHandler = function (req, resp) {
  var h = req.handler || req.route.handler
  if (!h) return this.notfound(req, resp)
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

Application.prototype.plugin = function (name, fn) {
  if (this._plugins[name]) {
    throw new Error('Plugin '+name+' already added')
  }
  this._plugins[name] = fn
}

Application.prototype._plug = function (req, resp, cb) {
  var plugins = Object.keys(this._plugins)
  var len = plugins.length
  var self = this
  if (!len) return cb()

  plugins.forEach(function (p) {
    self._plugins[p].call(self, req, resp, next(p))
  })

  function next (p) { return function (er) {
    if (er) req.pluginErrors[p] = er
    else req[p] = req[p] || true
    req.emit('plugin:' + p)
    if (-- len === 0) req.emit('pluginsDone')
  }}
}

Application.prototype._decorate = function (req, resp) {
  var self = this

  for (i in self.addHeaders) {
    resp.setHeader(i, self.addHeaders[i])
  }

  req.cookies = resp.cookies = new Cookies(req, resp, self.keygrip)

  req.accept = function () {
    if (!req.headers.accept) return '*/*'
    var cc = null
    var pos = 99999999
    if (Array.isArray(arguments[0])) arguments = arguments[0]
    for (var i=arguments.length-1;i!==-1;i--) {
      var ipos = req.headers.accept.indexOf(arguments[i])
      if ( ipos !== -1 && ipos < pos ) cc = arguments[i]
    }
    return cc
  }

  resp.error = function (err) {
    if (typeof(err) === "number") {
      err = {statusCode:err, message: http.STATUS_CODES[err]}
    }
    if (typeof(err) === "string") err = {message: err}
    if (!err.statusCode) err.statusCode = 500
    resp.statusCode = err.statusCode || 500
    self.logger.log('error %statusCode "%message "', err)
    resp.end(err.message || err) // this should be better
  }

  resp.notfound = function (log) {
    if (log) self.logger.log(log)
    self.notfound(req, resp)
  }

  // Get all the parsed url properties on the request
  // This is the same style express uses and it's quite nice
  var parsed = url.parse(req.url)
  for (i in parsed) if (i !== 'auth') {
    req[i] = parsed[i]
  }

  if (req.query) req.qs = qs.parse(req.query)

  // warning: this is not a Route object!
  // TODO: req.route should be a link to the actual Route object
  // that the user has added musts and such to.  If it doesn't match
  // any routes, then the default handler should just attach a
  // 'resp.error(404)' handler to it.
  req.match = self.router.match(req.pathname)
  req.route = req.match
  if (!req.match) return

  req.params = req.match.params
  req.splats = req.match.splats
  req.src = req.match.route

  // Fix for node's premature header check in end()
  resp._end = resp.end
  resp.end = function (chunk) {
    if (resp.statusCode === 404 && self._notfound) {
      return self._notfound.request(req, resp)
    }
    if (chunk) resp.write(chunk)
    resp._end()
    self.logger.info('Response', resp.statusCode, req.url, resp._headerSent)
  }
}



Application.prototype.addHeader = function (name, value) {
  this.addHeaders[name] = value
}

Application.prototype.route = function (path, cb) {
  var r = new Route(path, this)
  if (cb) r.on('request', cb)
  return r
}
Application.prototype.middle = function (mid) {
  throw new Error('Middleware is dumb. Just listen to the app "request" event.')
}

Application.prototype.listen = function (createServer, port, cb) {
  var self = this
  if (!cb) {
    cb = port
    port = createServer
  }
  self.server = createServer(function (req, resp) {
    self._onRequest(req, resp)
  })
  self.server.listen(port, cb)
  return this
}

Application.prototype.close = function (cb) {
  var counter = 1
    , self = this
    ;
  function end () {
    counter = counter - 1
    self.emit('close')
    if (io && self.socketio) {
      self._ioEmitter.emit('close')
    }
    if (counter === 0 && cb) cb()
  }
  if (self.httpServer._handle) {
    counter++
    self.httpServer.once('close', end)
    self.httpServer.close()
  }
  if (self.httpsServer._handle) {
    counter++
    self.httpsServer.once('close', end)
    self.httpsServer.close()
  }
  end()
  return self
}

Application.prototype.notfound = function (req, resp) {
  if (!resp) {
    if (typeof req === "string") {
      if (req[0] === '/') req = new BufferResponse(fs.readFileSync(req), 'text/html')
      else req = new BufferResponse(req, 'text/html')
    } else if (typeof req === "function") {
      this._notfound = {}
      this._notfound.request = function (r, resp) {
        if (resp._write) resp.write = resp._write
        if (resp._end) resp.end = resp._end
        req(r, resp)
      }
      return
    } else if (typeof req === 'object') {
      req = new BufferResponse(JSON.stringify(req), 'application/json')
    }
    req.statusCode = 404
    req.cache = false
    this._notfound = req
    return
  }

  if (resp._headerSent) return // This response already started

  if (this._notfound) return this._notfound.request(req, resp)

  var cc = req.accept('text/html', 'application/json', 'text/plain', '*/*') || 'text/plain'
  if (cc === '*/*') {
    cc = 'text/plain'
  }
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
            if (d._headerSent) return // Don't try to write to a response that's already finished
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

module.exports.JSONRequestHandler = JSONRequestHandler
function JSONRequestHandler (req, resp) {
  var orig = resp.write
  resp.write = function (chunk) {
    if (resp._headerSent) return orig.call(this, chunk) // This response already started
    // bail fast for chunks to limit impact on streaming
    if (Buffer.isBuffer(chunk)) return orig.call(this, chunk)
    // if it's an object serialize it and set proper headers
    if (typeof chunk === 'object') {
      chunk = new Buffer(JSON.stringify(chunk))
      resp.setHeader('content-type', 'application/json')
      resp.setHeader('content-length', chunk.length)
      if (!resp.statusCode && (req.method === 'GET' || req.method === 'HEAD')) {
        resp.statusCode = 200
      }
    }
    return orig.call(resp, chunk)
  }
  if (req.method === "PUT" || req.method === "POST") {
    if (req.headers['content-type'] === 'application/json') {
      req.on('body', function (body) {
        req.emit('json', JSON.parse(body))
      })
    }
  }
}


function Route (path, application) {
  // This code got really crazy really fast.
  // There are a lot of different states that close out of other logic.
  // This could be refactored but it's hard because there is so much
  // cascading logic.
  var self = this
  self.path = path
  self.app = application
  self.byContentType = {}

  self.handler = function (req, resp) {
    // the default handler is just a 404
    application.notfound(req, resp)
  }

  application.emit('newroute', self)
}

util.inherits(Route, events.EventEmitter)

Route.prototype.default = function (cb) {
  this.handler = makeHandler(cb)
}

// r.methods('POST', 'PUT', uploadHandler).methods('GET', showIt)
Route.prototype.methods = function () {
  var methods = new Array(arguments.length)
  for (var i = 0; i < methods.length; i ++) {
    methods[i] = arguments[i]
  }
  if (typeof methods[methods.length-1] !== 'string') {
    var handler = makeHandler(methods.pop())
  }

  this._methods = this._methods || []
  this._methods = this._methods.concat(methods)

  var self = this
  return this.on('request', function (req, res) {
    var method = req.method

    // HEAD is just a bodiless GET
    if (method === 'HEAD') method = 'GET'

    if (self._methods.indexOf(req.method) === -1) {
      res.error(405)
    }
    if (handler && !req.handler && methods.indexOf(req.method) !== -1) {
      // first hit!  assign the desired handler.
      // because of the !req.handler check, only the first one
      // will take control.
      req.handler = handler
    }
  })
}

Route.prototype.del = function (cb) {
  return this.methods('DELETE', makeHandler(cb))
}

Route.prototype.get = function (cb) {
  return this.methods('GET', makeHandler(cb))
}

Route.prototype.put = function (cb) {
  return this.methods('PUT', makeHandler(cb))
}

Route.prototype.post = function (cb) {
  return this.methods('POST', makeHandler(cb))
}


// r.accepts('application/json', sendJson).accepts('text/html', sendHTML)
Route.prototype.accepts = function () {
  var accepts = new Array(arguments.length)
  for (var i = 0; i < accepts.length; i ++) {
    accepts[i] = arguments[i]
  }
  if (typeof accepts[accepts.length-1] !== 'string') {
    var handler = makeHandler(accepts.pop())
  }


  this._accepts = this._accepts || []
  this._accepts = this._accepts.concat(accepts)

  var self = this
  return this.on('request', function (req, res) {
    var acc = req.accept(self._accepts.concat('*/*'))
    if (!acc) {
      res.error(406)
    }
    if (handler && !req.handler &&
        (acc === '*/*' || accepts.indexOf(acc) !== -1)) {
      // first hit!  assign the desired handler.
      // because of the !req.handler check, only the first one
      // will take control.
      res.setHeader('content-type', acc)
      req.handler = handler
    }
  })
}


Route.prototype.json = function (cb) {
  return this.accepts('application/json', 'text/json', 'application/x-json', makeHandler(cb))
}

Route.prototype.html = function (cb) {
  return this.accepts('text/html', makeHandler(cb))
}

Route.prototype.text = function (cb) {
  return this.accepts('text/plain', makeHandler(cb))
}


Route.prototype.file = function (filepath) {
  this.on('request', function (req, resp) {
    req.handler = filed(filepath)
  })
  return this
}

Route.prototype.files = function (filepath) {
  this.on('request', function (req, resp) {
    req.match.splats.unshift(filepath)
    var p = path.join.apply(path.join, req.match.splats)
    if (p.slice(0, filepath.length) !== filepath) {
      resp.statusCode = 403
      return resp.end('Naughty Naughty!')
    }
    req.handler = filed(p)
  })
  return this
}

Route.prototype.auth = function () {
  return this.must('auth', 401)
}

// must have auth, or else send a 401:
// app.plugin('auth', authHandler)
// app.route('/x').must('auth', 401)
Route.prototype.must = function (thing, orelse) {
  orelse = makeHandler(orelse)
  return this.on('request', function (req, res) {
    var when = req.app._plugins[thing] ? 'plugin:'+thing : 'pluginsDone'
    req.on(when, function () {
      if (!req[thing]) req.handler = orelse
    })
  })
  return this
}


function ServiceError(msg) {
  this.message = msg
  Error.captureStackTrace(this, ServiceError);
}
util.inherits(ServiceError, Error)
ServiceError.prototype.name = 'ServiceError'
module.exports.ServiceError = ServiceError





// XXX Used by tako.router(), but other instances of
// 'Router' are from routes.Router.  Can we get rid of
// this somehow?
function Router (hosts, options) {
  var self = this
  self.hosts = hosts || {}
  self.options = options || {}

  function makeHandler (type) {
    var handler = function (req, resp) {
      var host = req.headers.host
      if (!host || !self.hosts[host]) {
        if (!self._default) {
          resp.writeHead(404, {'content-type':'text/plain'})
          resp.end('No host header.')
        } else {
          self._default.httpServer.emit(type, req, resp)
        }
        return
      }
      self.hosts[host].httpServer.emit(type, req, resp)
    }
    return handler
  }

  self.httpServer = http.createServer()
  self.httpsServer = https.createServer(self.options.ssl || {})

  self.httpServer.on('request', makeHandler('request'))
  self.httpsServer.on('request', makeHandler('request'))

  self.httpServer.on('upgrade', makeHandler('upgrade'))
  self.httpsServer.on('upgrade', makeHandler('upgrade'))
}

Router.prototype.host = function (host, app) {
  this.hosts[host] = app
}

Router.prototype.default = function (app) {
  this._default = app
}

Router.prototype.close = function (cb) {
  var counter = 1
    , self = this
    ;
  function end () {
    counter = counter - 1
    if (counter === 0 && cb) cb()
  }
  if (self.httpServer._handle) {
    counter++
    self.httpServer.once('close', end)
    self.httpServer.close()
  }
  if (self.httpsServer._handle) {
    counter++
    self.httpsServer.once('close', end)
    self.httpsServer.close()
  }

  for (i in self.hosts) {
    counter++
    process.nextTick(function () {
      self.hosts[i].close(end)
    })

  }
  end()
}

module.exports.router = function (hosts) {return new Router(hosts)}

