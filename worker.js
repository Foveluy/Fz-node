var http = require('http')

var server = http
    .createServer((req, res) => {

        res.end('hahahaha')
    })

process.on('message', (msg, tcp) => {

    if (msg === 'server') {
        const worker = tcp
        worker.on('connection', socket => {//代表有链接
            server.emit('connection', socket)'触发server的socket'
        })
    }
})
