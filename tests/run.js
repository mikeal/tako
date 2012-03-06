#!/usr/bin/env node
var fs = require('fs')
  , path = require('path')
  , spawn = require('child_process').spawn

var testTimeout = 8000
  , failed = []
  , success = []
  , pathPrefix = __dirname

function runTest(test, callback) {
  var child = spawn(process.execPath, [ path.join(__dirname, test) ])
    , stdout = ''
    , stderr = ''
    , killTimeout

  child.stdout.on('data', function (chunk) {
    stdout += chunk
  })

  child.stderr.on('data', function (chunk) {
    stderr += chunk
  })

  killTimeout = setTimeout(function () {
    child.kill()
    console.log('  ' + path.basename(test) + ' timed out')
    callback()
  }, testTimeout)

  child.on('exit', function (exitCode) {
    clearTimeout(killTimeout)

    console.log('  ' + (exitCode ? '✘' : '✔') + ' ' + path.basename(test))
    ;(exitCode ? failed : success).push(test)
    if (exitCode) {
      console.log('stdout:')
      process.stdout.write(stdout)

      console.log('stderr:')
      process.stdout.write(stderr)
    }
    callback()
  })
}

function runTests(tests) {
  var index = 0

  console.log('Running tests:')

  function next() {
    if (index === tests.length - 1) {
      console.log()
      console.log('Summary:')
      console.log('  ' + success.length + '\tpassed tests')
      console.log('  ' + failed.length + '\tfailed tests')
      process.exit(failed.length)
    }
    runTest(tests[++index], next)
  }
  runTest(tests[0], next)
}

runTests(fs.readdirSync(pathPrefix).filter(function (test) {
  return test.substr(0, 5) === 'test-'
}))

