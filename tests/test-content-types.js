var assert = require('assert')
  , request = require('request')
  , common = require('./common')
  , tako = require('../')
  , app = tako()

var URL = common.URL
  , HTML = '<h1>Hello world</h1>'

app.route('/hello').json(function (req, res) {
  res.end({ hello: 'world' })
})

app.route('/json').json({ hello: 'json' })

app.route('/html').html(function (req, res) {
  res.end(HTML)
})

app.httpServer.listen(common.PORT, function () {
  common.all(
    [
      [ function (cb) {
          request({ url: URL + '/hello', json: true }, cb)
        }
      , function (err, res, body) {
          common.assertStatus(res, 200)
          common.assertJSON(res)
          assert.deepEqual(body, { hello: 'world' })
        }
      ]
    , [ function (cb) {
          request({ url: URL + '/json', json: true }, cb)
        }
      , function (err, res, body) {
          common.assertStatus(res, 200)
          common.assertJSON(res)
          assert.deepEqual(body, { hello: 'json' })
        }
      ]
    , [ function (cb) {
          request(URL + '/json', cb)
        }
      , function (err, res, body) {
          common.assertStatus(res, 200)
        }
      ]
    , [ function (cb) {
          request(
            { url: URL + '/html'
            , headers: { 'accept': 'text/html' }
            }, cb);
        }
      ,
        function (err, res, body) {
          common.assertStatus(res, 200)
          assert.equal(body, HTML)
        }
      ]
    ]
  , function () {app.close()})
})

