var tako = require('../index')

var t = tako()
console.error(t.route)
t.httpServer.listen(9999, function () {
  console.log('open http://localhost:9999')
})
t.route('/').file('./index.html')


t.sockets.on('connection', function (socket) {
  t.sockets.emit('news', { will: 'be received by everyone'});

  socket.on('disconnect', function () {
    t.sockets.emit('user disconnected');
  });
});

