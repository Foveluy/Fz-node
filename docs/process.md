# Node.js源码阅读：多进程架构的演进之路

采用[事件循环](https://zhuanlan.zhihu.com/p/31410589)最大的毛病就是一个 Node.js进程实例，就是一个单线程、单进程的。在现代工业生产中，这会导致两个极其严重的问题：

- 单进程不稳，服务器脆弱不堪
- 无法利用多核CPU并行处理

从性能和稳定性来看，Node.js 如果不出现可行的解决方案，那Node.js终究是一个玩具。幸好，在社区中有很多强大的实现方案，今天就让我们来揭秘一下，Node.js多进程架构的演进之路吧。

# child_process 模块

child_process是最早的多进程架构解决方案之一，child_process.fork这个经典函数也给予了我们复制进程的能力。
```js
//它和POSIX标准的fork函数不同的是，POSIX-fork当复制出来的子进程挂掉之后
//我们手动的回收这个进程的尸体（waitpid).
//而child_process.fork则不需要
```

我们按照cpu个数，启动相应数量的worker进程
```js
//master
var fork = require('child_process').fork

var cpu = require('os').cpus()

for (var i = 0; i < cpu.length; i++) {
    fork('./worker.js')
}
```

每个worker进程再分别监听不同的端口
```js
//worker.js
var http = require('http')

const port = Math.round(1 + Math.random() * 10000)
http
    .createServer((req, res) => {
        res.end('hahahaha')
    })
    .listen(port, '127.0.0.1', () => {
        console.log(`我是pid:${process.pid},我监听:${port}`)
    })
```

这样我们就很轻松的获得了一组由master-worker组成的小集群。

# 简陋的child_process.fork会导致的问题

首先，最大的问题就是我们的字进程都分别监听不同的端口，我们一个网站对外都是统一的一个端口，这不太符合我们需求。其次就是如果我们让所有的子进程同时监听一个端口，就会报错。

我们来实验一下

```js
//master
var fork = require('child_process').fork
for (var i = 0; i < 2; i++) {//注意我们改为2
    fork('./worker.js')
}
```


```js
//worker.js
var http = require('http')

const port = 8080
http
    .createServer((req, res) => {
        res.end('hahahaha')
    })
    .listen(port, '127.0.0.1', () => {
        console.log(`我是pid:${process.pid},我监听:${port}`)
    })
```

恭喜，你获得了一个***Error: listen EADDRINUSE 127.0.0.1:8080**错误
```bash
我是pid:84555,我监听:8080
events.js:183
      throw er; // Unhandled 'error' event
      ^

Error: listen EADDRINUSE 127.0.0.1:8080
    at Object._errnoException (util.js:1024:11)
    at _exceptionWithHostPort (util.js:1046:20)
    at Server.setupListenHandle [as _listen2] (net.js:1351:14)
    at listenInCluster (net.js:1392:12)
    at doListen (net.js:1501:7)
    at _combinedTickCallback (internal/process/next_tick.js:141:11)
    at process._tickCallback (internal/process/next_tick.js:180:9)
    at Function.Module.runMain (module.js:678:11)
    at startup (bootstrap_node.js:187:16)
    at bootstrap_node.js:608:3
^C
```

虽然在Node.js底层已经设置了每个端口都设置了SO_REUSERADDR，但是依旧报错，原因是因为当我们每启动一个进程的时候，我们的HTTP都会重新开启一个socket套接字，其文件描述符各不相同，每个描述符都跑去监听同一个接口，那就悲剧了。

这里值得注意的一个细节就是，虽然我们同时监听了一个接口报错了，但是仍然有 **第一个服务器开启成功了**，这也印证了之前我们的想法：***我们的HTTP都会重新开启一个socket套接字，其文件描述符各不相同，每个描述符都跑去监听同一个接口，那就悲剧了。***

同图来表示
![](https://github.com/215566435/Fz-node/blob/master/docs/assets/diifer-socket.png?raw=true)

# 进程间通信:代理模式


通过进程间通信(IPC)的手段，我们可以用最简单的方式去解决同一个端口不能被多个描述符监听的问题。我们可以设计 master 进程接受请求，然后开启一个或者多个 socket 发送消息给 worker ，这种模式称为代理模式。具体如下：

```js
                |-------|
                |master |
                | 80    |
                |-------|
                /        \
               /          \ 转发消息
              /            \
             V               V
         |-------|         |-------|
         |worker |         |worker |
         | 8000  |         | 8001  |
         |-------|         |-------|

```
但是，这么做是有严重的性能问题的，在之后的高级应用中，我们也会见到这种一种蛋疼的代理模式如何去规避。这么做不好的地方就在于，用户来了一个请求，然后发送给其他的worker的同时，必须消耗 客户-master, master-worker 两倍的描述符。这样以来系统的文件描述符就很快被耗尽。

庆幸的是，Node.js社区都是老油条，在目前的版本中用直接发送句柄的办法解决了这个问题。

# 进程间通信:发送句柄

废话不多说，我们来看一个简单的例子
```js
//master
var fork = require('child_process').fork
var server = require('net').createServer()
server.listen(8888, () => {     //master监听8888
    console.log('master on :', 8888)
})


var workers = {}
for (var i = 0; i < 2; i++) {
    var worker = fork('./worker.js')
    worker.send('server', server)//发送句柄给worker
    worker[worker.pid] = worker
    console.log('worker create pid:', worker.pid)
}
```

```js
//worker
var http = require('http')

var server = http.createServer((req, res) => {
        res.end('hahahaha')
    })//不监听

process.on('message', (msg, handler) => {

    if (msg === 'server') {
        const handler = tcp
        handler.on('connection', socket => {//代表有链接
            server.emit('connection', socket)//emit方法触发 worker服务器的connection
        })
    }
})
```

上述两端代码其实做的就是

- master
1. master创建一个tcp服务器,监听端口
2. master fork worker
3. master 把句柄发送给子进程  **worker.send('server', server)//发送句柄给worker**

- worker
1. 创建一个http服务器，处理请求逻辑，不监听端口
2. process.on('message') 用于接收 master 的信息，回调函数的第一个参数就是信息，第二个参数就是所谓的句柄
3. 每个进程通过监听 handler 上的connection事件，通过emit触发 http 服务器的内部逻辑并且返回

# 句柄还原

什么是句柄？
```html
句柄是一种可以用来标示资源的引用，它的内部包含了指向对象的文件描述符。

比如句柄可以用来标示一个服务器socket对象等
```

那什么又是句柄还原呢？
```js
//master js 
var server = require('net').createServer()
server.listen(8888, () => {     //master监听8888
    console.log('master on :', 8888)
})
....

worker.send('server', server)//发送句柄给worker
```
这行代码中我们看到，我们的worker.send()函数发送了一个服务器server对象，在worker中会被收到，然后worker调用他的监听方法，就可以触发worker内部http服务器的逻辑

我们看一下worker.send()能填入的参数

- 参数1:字符串，标示事件名称

参数2:
- net.Socket对象: TCP套接字
- net.Server对象: TCP服务器
- net.Native: C++层面的TCP套接字和IPC管道
- dgram.Socket: UDP套接字
- dgram.Native: C++层面的UDP套接字

刚刚我们发送的就是 net.Server对象: TCP服务器

传递过程是这样：

master:
- 传递消息和句柄。（worker.send()...）
- 将消息包装成内部消息，使用 JSON.stringify 序列化为字符串。(send的内部做的事情)
- 通过对应的 handleConversion[message.type].send 方法序列化句柄。(用于告诉worker到底发送了什么类型的参数)
- 将序列化后的字符串和句柄发入 IPC channel 。(完成序列化，进入发送阶段)

worker:
- 使用 JSON.parse 反序列化消息字符串为消息对象。(刚刚序列化了，现在反序列化)
- 触发内部消息事件（internalMessage）监听器。
- 将传递来的句柄使用 handleConversion[message.type].got 方法反序列化为 JavaScript 对象。(获取到底是什么参数传过来)
- 带着消息对象中的具体消息内容和反序列化后的句柄对象，触发用户级别事件。

发送TCP服务器为例，worker是这样还原句柄的：

```js
Convertion(message,handle,emit)=>{
    var server = new handleConversion[message.type].got()//其实就是获取tcp服务器类型
    server.listen(handle,()=>{
        emit(server);
    })
}
```
# 总结
到此，通过种种手段我们已经构建出了一个多进程架构的Node.js服务器，重头看看我们到底解决了多少个问题：
1. 单进程不稳，我们就多进程
2. 多进程我们碰到了端口被多个worker占据报错
3. 代理模式，但是会导致文件描述符消耗翻倍
4. 通过发送句柄的方式，我们轻松的解决了以上所有问题


