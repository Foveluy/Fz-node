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

//自己退出时，字进程优雅推出
process.on('exit', function() {
    for (var pid in workers) {
        workers[pid].kill()
        console.log('worker get kill:', workers[pid])
    }
})
