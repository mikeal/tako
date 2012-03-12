var tako = require('../index')
  , request = require('request')
  , assert = require('assert')
  , fs = require('fs')
  ;

var t = tako()
t
  .route('/')
    .json(function (req, resp) {
      resp.end({text:'hello world'})
    })
    .html(function (req, resp) {
      resp.end('<html><body>Hello World</body></html>')
    })
    .on('request', function (req, resp) {
      resp.statusCode = 200
      resp.setHeader('content-type', 'text/plain')
      resp.end('hello')
    })

t
  .route('/static')
    .json({text:'hello world'})
    .html('<html><body>Hello World</body></html>')

t
  .route('/puts')
    .json(function (req, resp) {
      req.on('json', function (obj) {
        resp.statusCode = 201
        resp.end(obj)
      })
    })

t
  .route('/file/js')
  .file(__filename)

t
  .route('/files/*')
  .files(__dirname)

t.route('/buffer').html(new Buffer('<html><body>Hello World</body></html>'))


var url = 'http://localhost:8000/'

counter = 0

function end () {
  counter--
  if (counter === 0) t.close()
}

t.httpServer.listen(8000, function () {
  counter++
  request({url:url,headers:{'accept':'application/json'}}, function (e, resp, body) {
    if (e) throw e
    if (resp.statusCode !== 200) throw new Error('status code is not 200. '+resp.statusCode)
    assert.equal(resp.headers['content-type'], 'application/json')
    assert.equal(body, JSON.stringify({text:'hello world'}))
    console.log('Passed json /')
    end()
  })

  counter++
  request({url:url,headers:{'accept':'text/html'}}, function (e, resp, body) {
    if (e) throw e
    if (resp.statusCode !== 200) throw new Error('status code is not 200. '+resp.statusCode)
    assert.equal(resp.headers['content-type'], 'text/html')
    assert.equal(body, '<html><body>Hello World</body></html>')
    console.log('Passed html /')
    end()
  })

  counter++
  request({url:url}, function (e, resp, body) {
    if (e) throw e
    if (resp.statusCode !== 200) throw new Error('status code is not 200. '+resp.statusCode)
    assert.equal(resp.headers['content-type'], 'application/json')
    assert.equal(body, JSON.stringify({"text":"hello world"}))
    console.log('Passed no headers /')
    end()
  })

  counter++
  request({url:url+'static',headers:{'accept':'application/json'}}, function (e, resp, body) {
    if (e) throw e
    if (resp.statusCode !== 200) throw new Error('status code is not 200. '+resp.statusCode)
    assert.equal(resp.headers['content-type'], 'application/json')
    assert.equal(body, JSON.stringify({text:'hello world'}))
    console.log('Passed json /static')
    end()
  })

  counter++
  request({url:url+'static'}, function (e, resp, body) {
    if (e) throw e
    if (resp.statusCode !== 200) throw new Error('status code is not 200. '+resp.statusCode)
    assert.equal(resp.headers['content-type'], 'application/json')
    console.log('Passed 406 /static')
    end()
  })

  counter++
  request({url:url+'static',headers:{'accept':'text/html'}}, function (e, resp, body) {
    if (e) throw e
    if (resp.statusCode !== 200) throw new Error('status code is not 200. '+resp.statusCode)
    assert.equal(resp.headers['content-type'], 'text/html')
    assert.equal(body, '<html><body>Hello World</body></html>')
    console.log('Passed html /static')
    end()
  })

  counter++
  request({url:url+'buffer',headers:{'accept':'text/html'}}, function (e, resp, body) {
    if (e) throw e
    if (resp.statusCode !== 200) throw new Error('status code is not 200. '+resp.statusCode)
    assert.equal(resp.headers['content-type'], 'text/html')
    assert.equal(body, '<html><body>Hello World</body></html>')
    console.log('Passed html /buffer')
    end()
  })

  counter++
  request({url:url+404, headers:{'accept':'text/html'}}, function (e, resp, body) {
    if (e) throw e
    if (resp.statusCode !== 404) throw new Error('status code is not 404. '+resp.statusCode)
    assert.equal(resp.headers['content-type'], 'text/html')
    assert.equal(body, '<html><body>Not Found</body></html>')
    console.log('Passed html /404')
    end()
  })

  counter++
  request({url:url+404, headers:{'accept':'application/json'}}, function (e, resp, body) {
    if (e) throw e
    if (resp.statusCode !== 404) throw new Error('status code is not 404. '+resp.statusCode)
    assert.equal(resp.headers['content-type'], 'application/json')
    assert.equal(body, "{\"status\":404,\"reason\":\"not found\",\"message\":\"not found\"}")
    console.log('Passed json /404')
    end()
  })

  counter++
  request({url:url+404}, function (e, resp, body) {
    if (e) throw e
    if (resp.statusCode !== 404) throw new Error('status code is not 404. '+resp.statusCode)
    assert.equal(resp.headers['content-type'], 'text/plain')
    assert.equal(body, "Not Found")
    console.log('Passed default text/plain /404')
    end()
  })

  counter++
  request.put(
    { url:url+'puts'
    , json: {code:200, test:'asdfasdf'}
    }
    ,
    function (e, resp, body) {
      if (e) throw e
      if (resp.statusCode !== 201) throw new Error('status code is not 201. '+resp.statusCode)
      assert.equal(resp.headers['content-type'], 'application/json')
      assert.deepEqual(body, {code:200, test:'asdfasdf'})
      console.log('Passed json /put')
      end()
    }
  )

  counter++
  request.get(url+'file/js', function (e, resp, body) {
    if (e) throw e
    if (resp.statusCode !== 200) throw new Error('status code is not 200. '+resp.statusCode)
    assert.equal(resp.headers['content-type'], 'text/javascript')
    assert.equal(body, fs.readFileSync(__filename).toString())
    console.log('Passed /file/js')
    end()
  })

  counter++
  request.get(url+'files/test-basic.js', function (e, resp, body) {
    if (e) throw e
    if (resp.statusCode !== 200) throw new Error('status code is not 200. '+resp.statusCode)
    assert.equal(resp.headers['content-type'], 'text/javascript')
    assert.equal(body, fs.readFileSync(__filename).toString())
    console.log('Passed /files/test-tako.js')
    end()
  })

})
