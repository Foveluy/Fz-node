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

# 进程间通信







