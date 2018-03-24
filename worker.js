var http = require('http')

var server = http
    .createServer((req, res) => {
        // console.log(`子进程${process.pid}`)
        res.end('hahahaha')
    })

process.on('message', (msg, tcp) => {
    // console.log('接受到句柄',tcp)
    if (msg === 'server') {
        const worker = tcp
        worker.on('connection', socket => {//代表有链接
            // console.log('由链接',socket)
            server.emit('connection', socket)'触发server的socket'
        })
    }
})
