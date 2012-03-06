var assert = require('assert')

exports.PORT = 6000
exports.URL = 'http://localhost:' + exports.PORT

exports.all = function (functions, cb) {
  var done = functions.length
  functions.forEach(function (f) {
    f[0](function () {
      f[1].apply(this, arguments)
      if (--done === 0) return cb()
    })
  })
}

exports.assertJSON = function (res) {
  assert.equal(res.headers['content-type'], 'application/json')
}

exports.assertStatus = function (res, status) {
  assert.equal(res.statusCode, status)
}
