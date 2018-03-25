var fork = require('child_process').fork
var server = require('net').createServer()
server.listen(8888, () => {
    console.log('master on :', 8888)
})


var workers = {}
for (var i = 0; i < 2; i++) {
    var worker = fork('./worker.js')

    //发送句柄
    worker.send('server', server)
    worker[worker.pid] = worker
    console.log('worker create pid:', worker.pid)
}
