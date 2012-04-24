var tako = require('../index')
  , request = require('request')
  , assert = require('assert')
  , fs = require('fs')
  , j = request.jar()
  ;

var t = tako({ keys: ["just testing"] })

t
  .route('/set')
    .json(function (req, resp) {
      resp.cookies.set("hello", "World", { signed: true })
      resp.end({text:'Hello, World'})
    })
    .html(function (req, resp) {
      resp.cookies.set("hello", "World", { signed: true })
      resp.end('<html><body>Hello, World</body></html>')
    })

t
  .route('/get')
    .json(function (req, resp) {
      assert(req.cookies.get("hello") === "World")
      resp.end({text: "ok"})
    })
    .html(function (req, resp) {
      assert(req.cookies.get("hello") === "World")
      resp.end('<html><body>ok</body></html>')
    })

t
  .route('/get-signed')
    .json(function (req, resp) {
      assert(req.cookies.get("hello", {signed: true}) === "World")
      resp.end({text: "ok"})
    })
    .html(function (req, resp) {
      assert(req.cookies.get("hello", {signed: true}) === "World")
      resp.end('<html><body>ok</body></html>')
    })


var url = 'http://localhost:8000'
var set = url + '/set'
var get = url + '/get'
var getSigned = url + '/get-signed'

counter = 0

function end (next) {
  counter--
  if (counter === 0) next ? next() : t.close()
}

t.httpServer.listen(8000, function () {
  counter++
  request({url:set,jar:j,headers:{'accept':'application/json'}}, function (e, resp, body) {
    if (e) throw e
    if (resp.statusCode !== 200) throw new Error('status code is not 200. '+resp.statusCode)
    assert.equal(resp.headers['content-type'], 'application/json')
    assert.equal(body, JSON.stringify({text:'Hello, World'}))
    console.log('Passed json /set')
    end(testGet)
  })

  counter++
  request({url:set,jar:j,headers:{'accept':'text/html'}}, function (e, resp, body) {
    if (e) throw e
    if (resp.statusCode !== 200) throw new Error('status code is not 200. '+resp.statusCode)
    assert.equal(resp.headers['content-type'], 'text/html')
    assert.equal(body, '<html><body>Hello, World</body></html>')
    console.log('Passed html /set')
    end(testGet)
  })

  function testGet () {
    counter++
    request({url:get,jar:j,headers:{'accept':'application/json'}}, function (e, resp, body) {
      if (e) throw e
      if (resp.statusCode !== 200) throw new Error('status code is not 200. '+resp.statusCode)
      assert.equal(resp.headers['content-type'], 'application/json')
      assert.equal(body, JSON.stringify({text:'ok'}))
      console.log('Passed json /get')
      end()
    })

    counter++
    request({url:get,jar:j,headers:{'accept':'text/html'}}, function (e, resp, body) {
      if (e) throw e
      if (resp.statusCode !== 200) throw new Error('status code is not 200. '+resp.statusCode)
      assert.equal(resp.headers['content-type'], 'text/html')
      console.log('Passed html /get')
      end()
    })

    counter++
    request({url:getSigned,jar:j,headers:{'accept':'application/json'}}, function (e, resp, body) {
      if (e) throw e
      if (resp.statusCode !== 200) throw new Error('status code is not 200. '+resp.statusCode)
      assert.equal(resp.headers['content-type'], 'application/json')
      assert.equal(body, JSON.stringify({text:'ok'}))
      console.log('Passed json /get-signed')
      end()
    })

    counter++
    request({url:getSigned,jar:j,headers:{'accept':'text/html'}}, function (e, resp, body) {
      if (e) throw e
      if (resp.statusCode !== 200) throw new Error('status code is not 200. '+resp.statusCode)
      assert.equal(resp.headers['content-type'], 'text/html')
      console.log('Passed html /get-signed')
      end()
    })
  }
})
