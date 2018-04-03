const Readable = require('stream').Readable

class FzReadable extends Readable {
    constructor(iterator) {
        super({
            highWaterMark: 0
        })
        this.iterator = iterator
    }

    //子类必须实现的方法
    _read() {
        const res = this.iterator.next()
        if (res.done) {
            //当收到null的时候，流就停止了
            return this.push(null)
        }
        const needMoreData = this.push(`${res.value}`)
        // setTimeout(() => {
           
        // }, 0)
    }
}

const iterator = (function(limit) {
    return {
        next: function() {
            if (limit--) {
                return { done: false, value: limit + Math.random() }
            }
            return { done: true }
        }
    }
})(10)

const readable = new FzReadable(iterator)

//调用on('data')就会进入流动模式，数据会自发地通过data事件输出，不需要消耗方反复调用read(n)。
//调用on('data')会在nexttick中使用read(0)方法去请求数据

readable.on('data', data =>{
    console.log(data.toString())
})

readable.on('readable', (chunk) => {
    // console.log('readable')
    // while (null !== readable.read());
})

// const timer = setInterval(() => {
//     console.log('哈哈哈')
// }, 0)

readable.on('end', () => {
    process.stdout.write('DONE')
    // clearInterval(timer)
})

//doRead
//当缓存中的数据足够多时,即不需要向底层请求数据。用doRead来表示read(n)是否需要向底层取数据

//state.length 缓存数据
