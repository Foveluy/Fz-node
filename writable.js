const Writable = require('stream').Writable

const writable = Writable()
// 实现`_write`方法
// 这是将数据写入底层的逻辑
writable._write = function(data, enc, next) {
    // 将流中的数据写入底层
    process.stdout.write(data.toString().toUpperCase())
    // 写入完成时，调用`next()`方法通知流传入下一个数据
    process.nextTick(next)
    // setTimeout(() => {
    //     next()
    // }, 1)
}

//数据源
const data = [1, 2, 3, 4, 5, 6, 7]
while (true) {
    // 将一个数据写入流中
    writable.write(data.shift() + '\n')
    //数据空的时候退出
    if (data.length === 0) break
}
// 再无数据写入流时，需要调用`end`方法
writable.end()

const timer = setInterval(() => {
    console.log('哈哈哈')
}, 0)

// 所有的数据都写完了
writable.on('finish', () => {
    process.stdout.write('DONE')
    clearInterval(timer)
})
