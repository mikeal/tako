var assert = require('assert')
  , request = require('request')
  , common = require('./common')
  , tako = require('../')
  , app = tako()

var URL = common.URL

app.route('/hello', function (req, res) {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('/hello')
})

app.route('/hello/:id', function (req, res) {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('/hello/' + req.params.id)
})

app.httpServer.listen(common.PORT, function () {
  common.all(
    [
      [ function (cb) {
          request(URL + '/hello', cb)
        }
      , function (err, res, body) {
          common.assertStatus(res, 200)
          assert.equal(body, '/hello')
        }
      ]
    , [ function (cb) {
          request(URL + '/nothing/here/dawg', cb)
        }
      , function (err, res, body) {
          common.assertStatus(res, 404)
        }
      ]
    , [ function (cb) {
          request(URL + '/hello/world', cb)
        }
      , function (err, res, body) {
          common.assertStatus(res, 200)
          assert.equal(body, '/hello/world')
        }
      ]
    ]
  , function () {app.close()})
})
