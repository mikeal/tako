var assert = require('assert')
  , request = require('request')
  , common = require('./common')
  , tako = require('../')
  , app = tako()

var URL = common.URL
  , HTML = '<h1>Hello world</h1>'
  , getCalled = false
  , putCalled = false
  , postCalled = false

app.route('/')
  .get(function (req, res) {
    console.error('GET handler called')
    assert(!getCalled)
    getCalled = true
    res.end('ok')
  })
  .put(function (req, res) {
    console.error('PUT handler called')
    assert(!putCalled)
    putCalled = true
    res.end('ok')
  })
  .post(function (req, res) {
    console.error('POST handler called')
    assert(!postCalled)
    postCalled = true
    res.end('ok')
  })
  .default(function (req, res) {
    console.error('default handler', req.method)
    // should skip over this, because the 405 error took over.
    throw new Error('should not be called ever')
  })

app.httpServer.listen(common.PORT, function () {
  common.all(
    [
      [ function (cb) {
          request.get({ url: URL }, cb)
        }
      , function (err, res, body) {
          common.assertStatus(res, 200)
          assert(getCalled)
        }
      ]
    , [ function (cb) {
          request.put({ url: URL, body:'ok' }, cb)
        }
      , function (err, res, body) {
          common.assertStatus(res, 200)
          assert(putCalled)
        }
      ]
    , [ function (cb) {
          request.del(URL, cb)
        }
      , function (err, res, body) {
          // unsupported method
          common.assertStatus(res, 405)
        }
      ]
    , [ function (cb) {
          request.post({ url: URL, body:'ok' }, cb);
        }
      ,
        function (err, res, body) {
          common.assertStatus(res, 200)
          assert(postCalled)
        }
      ]
    ]
  , function () {app.close()})
})

