var tako = require('../index')
  , request = require('request')
  , assert = require('assert')
  , path = require('path')
  , fs = require('fs')
  , app = tako()
  , port = 8080
  , url = 'http://localhost:' + port + '/'
  , index = fs.readFileSync(path.join(__dirname, 'index.html')).toString()
  
app.route('/dir/*').files(__dirname)
app.httpServer.listen(8080, function () {
  // Test default 404
  request.get(url+'nope', function (e, resp, body) {
    if (e) throw e
    assert.equal(resp.statusCode, 404)
    assert.equal(body, 'Not Found')
    
    // Make sure file serving works
    request.get(url+'dir/index.html', function (e, resp, body) {
      if (e) throw e
      assert.equal(resp.statusCode, 200)
      assert.equal(resp.headers['content-type'], 'text/html')
      assert.equal(body, index)
      
      // Set default 404
      app.notfound(path.join(__dirname, 'index.html'))
      
      // Test unfound route returns new default 404
      request.get(url+'nope', function (e, resp, body) {
        if (e) throw e
        assert.equal(resp.statusCode, 404)
        assert.equal(body, index)
        
        // Test that unfound files return new default
        request.get(url+'dir/nothing.txt', function (e, resp, body) {
          if (e) throw e
          assert.equal(resp.statusCode, 404)
          assert.equal(body, index)
          
          // Test notfound JSON
          app.notfound({test:'asdf'})
          request.get(url+'nope', {json:true}, function (e, resp, body) {
            if (e) throw e
            assert.equal(resp.statusCode, 404)
            assert.equal(resp.headers['content-type'], 'application/json')
            assert.deepEqual(body, {test:'asdf'})
            
            // Test function handler
            app.notfound(function (req, resp) {resp.statusCode = 404; resp.end('asdf')})
            request.get(url+'nope', function (e, resp, body) {
              if (e) throw e
              assert.equal(resp.statusCode, 404)
              assert.equal(body, 'asdf')
              console.log('All tests passed')
              process.exit()
            })
          })
        })
      })
    })
  })
})