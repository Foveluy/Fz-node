# Stream 模块解读前言
本章节网上已经出现很多的解析教程，无论是从源码还是从原理。我也是通过读源码与看别人教程去理解这一块代码是如何书写的，因此本文是对网上教程的一点补充说明，并且加入我的理解。Stream模块比较庞大，需要的知识可能包括：
1. 理解事件循环机制
2. 明白stream出现痛点
3. 流的使用场景

最后，本文是对以下三篇文章的补充，主要讲解了，读写流中，异步push和异步next的情况：
1. https://tech.meituan.com/stream-basics.html
2. https://tech.meituan.com/stream-internals.html
3. https://tech.meituan.com/stream-in-action.html 


# Stream 模块解读补充
想要看到```Stream```模块的解读，可能需要比较多的实践功底，因为里面其中很多的概念是需要**用过**才会明白的，如果大家没有好的练手方案我提供三个：

1. 日志系统：日志系统非常适合用流去做，比如，日志的流试输出，为了高性能需要每隔1s间隔才去写文件，日志的转换（切分，格式转换等等操作）
2. 反向代理：流试转发，后端数据流试拼接（省内存）等等

# 流的几种概念

Node 为我们提供了4种可读的流，分别是下面几种：

```js
var Stream = require('stream')

var Readable = Stream.Readable
var Writable = Stream.Writable
var Duplex = Stream.Duplex
var Transform = Stream.Transform
```

# Readable
这是一种可读流，可读流一般代表的是数据的来源，这个流指定了「如何去读取数据」，以下是简单的例子：
```js
const Readable = require('stream').Readable

class FzReadable extends Readable {
    constructor(iterator) {
        super()
        this.iterator = iterator
    }

    //子类必须实现的方法
    _read() {
        const res = this.iterator.next()
        if (res.done) {
            //当收到null的时候，流就停止了
            return this.push(null)
        }

        setTimeout(() => {
            this.push(`${res.value}\n`)
        }, 0)
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
readable.on('data', data => process.stdout.write(data))
readable.on('end', () => process.stdout.write('DONE'))
```

上述的代码会创建一个我们自己写的可读流，然后从迭代器```iterator```缓慢取出数据，输出到stdout上。

继承可读流，需要重写```_read()```方法，当流开始读取的时候，就会调用这个函数，去数据源中获取数据，```this.push()```方法就是会将数据源推入可读流中的缓存队列中，然后在输出数据时，再从缓存队列中取出流的```chunk(分片)```。

```_read()```函数是有大文章的函数，还有的是，我们看到```this.push()```是一个异步调用的方法，这么做的原因是：将数据推入缓存并且输出的过程加入事件循环队列中，使得事件循环不会阻塞。具体的，我们后文看源码进行分析。

# Writable
一个可写流，可写流的比较简单，我们来看看代码：
```js
const Writable = require('stream').Writable

const writable = Writable()
// 实现`_write`方法
// 这是将数据写入底层的逻辑
writable._write = function(data, enc, next) {
    
    // 将流中的数据写入底层
    process.stdout.write(data.toString().toUpperCase())
    // 写入完成时，调用`next()`方法通知流传入下一个数据
    process.nextTick(next)
}

// 所有的数据都写完了
writable.on('finish', () => process.stdout.write('DONE'))

//数据源
const data = [1, 2, 3, 4, 5, 6, 7]
while (true) {
    // 将一个数据写入流中
    writable.write(data.shift() + '\n')
    //数据空的时候退出
    if(data.length ===0)break;
}
// 再无数据写入流时，需要调用`end`方法
writable.end()
```
上面例子中，可写流需要实现```_write```方法制定写的方式，我们可以注意到这个函数有3个参数:

- ```data```:顾名思义，就是每次外部调用```write```时的方法
- ```enc```:数据类型，一般值是buffer
- ```next```:```next```除了是***通知流传入下一个数据***之外，还有另外一个作用就是冲刷内部缓存，这个函数是可以异步调用，也是同步调用的，异步调用是为了让读流能够加入事件循环，不会阻塞


# 异步读和异步写

在上面我们一直说到无论是读的```push```还是写的```next```，都提到了一个相当重要的概念：**这个函数是可以异步调用，也是同步调用的，异步调用是为了让读流能够加入事件循环，不会阻塞**，为了更好的理解其中的奥妙，我们用一段代码进行解释:
```js
const Readable = require('stream').Readable

class FzReadable extends Readable {
    constructor(iterator) {
        super()
        this.iterator = iterator
    }
    _read() {
        const res = this.iterator.next()
        if (res.done) {
            return this.push(null)
        }

        setTimeout(() => {
            this.push(`${res.value}\n`)
        }, 0)
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


readable.on('data', data => process.stdout.write(data))

const timer = setInterval(() => {
    console.log('哈哈哈')
}, 0)

readable.on('end', () => {
    process.stdout.write('DONE')
    clearInterval(timer)
})
```
在上述这个例子中，我们使用了异步的方式```push```缓存，然后我们在末尾加入一个定时器，在每个事件循环```timer```阶段，我们打印一个```哈哈哈```，我们看看效果:
```
哈哈哈
9.769079623794424
哈哈哈
8.078209992424412
哈哈哈
7.089890373541063
哈哈哈
6.2639577098912795
哈哈哈
5.512806573260017
哈哈哈
4.843215892958035
哈哈哈
3.3624366732744377
哈哈哈
2.074261391179594
哈哈哈
1.651073865927396
哈哈哈
0.9808023604686888
哈哈哈
DONE
```
这么做的优势可能还没现实出来，我们把代码改一下，改成同步push试试：
```js

setTimeout(() => {
     this.push(`${res.value}\n`)
}, 0)
/** 
 * |
 * |我们将this.push从中拿出来，看看结果
 * |
 * V
*/
this.push(`${res.value}\n`)
/**输出
 * 9.296256613905719
8.800861871409845
7.930317062766291
6.694684450371433
5.354302950365952
4.035660878052062
3.1199030341724496
2.8361767840214345
1.872803351560663
0.9070988743704766
DONE%
 * 
*/
```
我们实际上只改了一行代码，但是```哈哈哈```没了，要解释为什么造成这样差异的原因我们需要很多知识，但是总结来说就是：如果我们使用同步的读数据和写数据，不管你是不是```流```那都会阻塞事件循环，因此，不要以为使用流以后性能就好，我们还得将流的读写，安排到事件循环中去，形成了「绝对不阻塞事件循环」的作用。

# 双工流和转换流
在这里我们进行简单的介绍即可
- 双工流：代表可读可写，这种流可以作为读流，也可以作为写流，但是读和写是分裂开来的。
- 转换流：代表一种可读可写的流，但是他们的读和写并不分裂开，通过实现```_transform```方法，可以做到，读数据->转变数据->输出数据


# 可读流工作原理

我们在完成一个可读流，并且注入迭代器以后，调用```readable.on('data', data => process.stdout.write(data))```，方法就能**拉起流动**，内部的机制是一个大```while```循环调用```read```去读取数据，这也就是为什么同步会阻塞的**根本原因**，具体的代码：
```js
//_stream_readable.js
function flow(stream) {
  const state = stream._readableState;
  debug('flow', state.flowing);
  while (state.flowing && stream.read() !== null);
}
```
当我们异步调用```this.push```的时候，```stream.read()```永远会返回```null```。但是，在同步的情况下大循环```while```会不断的跑read函数，read函数会触发更底层用户定制的```_read()```函数，然后又会触发同步的```push```，这样就形成了一个持续产生数据的循环。

# 探究异步调用push
在介绍异步push的机制之前，我们需要搞清楚，流是有```流动模式```和```暂停模式```的。流动模式比较简单，就是我们上面一直在讲的。在流动模式下，调用```on('data')```，无论你的```push```是否异步，就会使得流自动的进入自动循环读取数据的模式，如果不做其他任何操作，异步和同步的如下：

- 无论是异步还是同步push，stream中均维持一个缓存队列，数据的大小超过缓存队列的大小（hightWaterMark）就会被自动切分
- 异步push能够加入事件循环，不会导致进程阻塞，但是不会进入缓存，而是直接输出到```on('data')```中
- 同步的push，会阻塞线程，但是会加入缓存中，使得缓存队列变长


具体看下面代码
```js
 if (state.flowing && state.length === 0 && !state.sync) {
    stream.emit('data', chunk);
    stream.read(0);
  } else {
    // update the buffer info.
    state.length += state.objectMode ? 1 : chunk.length;
    if (addToFront)
      state.buffer.unshift(chunk);
    else
      state.buffer.push(chunk);

    if (state.needReadable)
      emitReadable(stream);
  }
  maybeReadMore(stream, state);
```
这段代码就是主要的push函数分支，```state.flowing===true```的时候，就是流动模式，```!state.sync```判断是否异步，如果是流动模式而且又是异步，那么就会直接到```emit('data')```分支中，并不会加入到```state.buffer```这个缓存中去。

# readable 事件
当```push```是异步的时候，而又是暂停模式的时候，我们就会进入下面的分支，把数据加入缓存中，设置缓存长度。注意，如果此时读进来的```chunk```太大，缓存的长度已经满了，那么```read```的时候就会从缓存中读取数据而不会从原始数据区```_read()```取数据。具体的流程如下：
```js
// 读数据
// |
// |
// V
// 缓存池满了吗
// |        \
// 没有       \
// |         满了
// V           V
// _read()    从缓存state.buffer中读
// |
// |
// V
// 放入缓存state.buffer
```
可见，通过这么一来一回，我们的stream模块就具备了一个能自动切分读取数据+异步功能.


