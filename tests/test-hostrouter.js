var tako = require('../index')
  , request = require('request')
  , assert = require('assert')
  , app1 = tako()
  , app2 = tako()
  , app3 = tako()
  , router = tako.router()
  , counter = 0
  ;
  
app1.route('/name').text('app1')
app2.route('/name').text('app2')
app3.route('/name').text('app3')

router.host('app1.localhost', app1)
router.host('app2.localhost', app2)
router.default(app3)



function end () {
  counter = counter - 1
  if (counter === 0) {
    console.log('all tests passed')
    router.close()
  }
}

router.httpServer.listen(8080, function () {
  counter++
  request('http://localhost:8080/name', {headers:{host:'app1.localhost'}}, function (e, resp) {
    assert.ok(!e)
    assert.equal(resp.statusCode, 200)
    assert.equal(resp.body, 'app1')
    end()
  })
  
  counter++
  request('http://localhost:8080/name', {headers:{host:'app2.localhost'}}, function (e, resp) {
    assert.ok(!e)
    assert.equal(resp.statusCode, 200)
    assert.equal(resp.body, 'app2')
    end()
  })
  
  counter++
  request('http://localhost:8080/name', {headers:{host:'unknown.localhost'}}, function (e, resp) {
    assert.ok(!e)
    assert.equal(resp.statusCode, 200)
    assert.equal(resp.body, 'app3')
    end()
  })
})