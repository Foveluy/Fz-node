# Node.js源码阅读：多进程架构的演进之路2

在讲cluster之前，我们要明白我们所遇到的困境还有哪些。上一节我们讲到了：
1. 单进程不稳，我们就多进程
2. 多进程我们碰到了端口被多个worker占据报错
3. 代理模式，但是会导致文件描述符消耗翻倍
4. 通过发送句柄的方式，我们轻松的解决了以上所有问题

看似非常完美的解决方案，实际上我们的服务器依旧是脆弱不堪的。

1. 性能问题：到底开几个worker
2. 管理多个工作进程状态
3. 平滑重启：用户无感知
4. 模块、配置、静态数据的热加载

针对上述的问题，我们想让我们 node.js 跑得更稳健，这些事情都是我们必须考虑的。

```js
//社区中有比较成熟的方案，如forever和pm2模块
//这些都是非常优秀的模块
//但是对于企业级解决方案来说，pm2和forever复杂度太高，不易于拓展，后文会以实例讲明
//因此，我们必须要熟悉cluster的一切，这样我们才能写出极易拓展，健壮的服务端程序
```

# 一段简单的cluster代码

之前我们process讲解中，讲述了各种情况，但是自从有了cluster模块以后，上述的一些神经病烧脑状态就不用我们费力去思考，我们的代码也变得极其简单
```javascript
const cluster = require('cluster');            // | | 
const http = require('http');                  // | | 
const numCPUs = require('os').cpus().length;   // | |    都执行了
                                               // | | 
if (cluster.isMaster) {                        // |-|-----------------
  // Fork workers.                             //   | 
  for (var i = 0; i < numCPUs; i++) {          //   | 
    cluster.fork();                            //   | 
  }                                            //   | 仅父进程执行 (a.js)
  cluster.on('exit', (worker) => {             //   | 
    console.log(`${worker.process.pid} died`); //   | 
  });                                          //   |
} else {                                       // |-------------------
  // Workers can share any TCP connection      // | 
  // In this case it is an HTTP server         // | 
  http.createServer((req, res) => {            // | 
    res.writeHead(200);                        // |   仅子进程执行 (b.js)
    res.end('hello world\n');                  // | 
  }).listen(8000);                             // | 
}                                              // |-------------------
                                               // | |
console.log('hello');                          // | |    都执行了
```
不再需要把句柄传递来传递去，在先有cluster方案中，我们的服务器代码「一行不用改」，这极其方便了我们部署程序。上述代码实现的效果，就跟我们在process里一样，根据cpu核心个数创建多个子进程，并且可以监听同一个端口，其内部的做法是差不多的，也是通过fork进程来做。但是，cluster厉害的地方就在于：无需修改任何代码就可以获得集群

# 一探究竟cluster源码

想要代码原封不动，最重要的是拦截,最后的这个listen调用，
```js
http.createServer((req, res) => {            // | 
    res.writeHead(200);                        // |   仅子进程执行 (b.js)
    res.end('hello world\n');                  // | 
  }).listen(8000);   

```
一般来说，http.createServer().listen() 就会创建一个socket，监听我们预设的端口，导致我们的监听失败。

具体在哪里做的呢，[cluster child](https://github.com/nodejs/node/blob/master/lib/internal/cluster/child.js)
```javascript
  function listen(backlog) {
    // TODO(bnoordhuis) Send a message to the master that tells it to
    // update the backlog size. The actual backlog should probably be
    // the largest requested size by any worker.
    return 0;
  }
```
这是一个hack函数，当cluster fork出来子进程只要调用listen方法，他就给你屏蔽掉了.

cluster为我们做了这件事:
- 端口仅由master进程中的内部TCP服务器监听了一次。
- 不会出现端口被重复监听报错，是由于，worker进程中，最后执行监听端口操作的方法，已被cluster模块主动覆盖。

# 重启不稳定的worker

由于某种原因，我们的进程发生了严重的bug，但是开发者并不知道，甚至都没捕捉到。这时候，这个worker就进入了不稳定的状态。对于这种不稳定状态的worker，我们应该将其杀死，然后用cluster重启。

想要做到平滑重启，我们需要捕获 ```uncaughtException```，意思是 没有捕获的错误。代码很简单：

```js

  // Workers can share any TCP connection      // | 
  // In this case it is an HTTP server         // | 
  const server = http.createServer((req, res) => {            // | 
    res.writeHead(200);                        // |   仅子进程执行 (b.js)
    res.end('hello world\n');                  // | 
  }).listen(8000);                             // | 

 process.on('uncaughtException',(err)=>{
     log(err)//记录致命原因
     //#最好再写几行代码，通过进程通信，通知cluster，这个进程马上要自杀了
     server.close(()=>{//调用close方法，停止接收所有新的链接
        //当已有链接全部断开后，退出进程
        process.exit(1);
     })
 }) 
```

# egg.js Agent机制

在这里，阿里的egg.js文档中已经解释得非常清除了。在这里，我就稍微引用，以做标记，作为我学习的笔记.


说到这里，Node.js 多进程方案貌似已经成型，这也是我们早期线上使用的方案。但后来我们发现有些工作其实不需要每个 Worker 都去做，如果都做，一来是浪费资源，更重要的是可能会导致多进程间资源访问冲突。举个例子：生产环境的日志文件我们一般会按照日期进行归档，在单进程模型下这再简单不过了：

每天凌晨 0 点，将当前日志文件按照日期进行重命名
销毁以前的文件句柄，并创建新的日志文件继续写入
试想如果现在是 4 个进程来做同样的事情，是不是就乱套了。所以，对于这一类后台运行的逻辑，我们希望将它们放到一个单独的进程上去执行，这个进程就叫 Agent Worker，简称 Agent。Agent 好比是 Master 给其他 Worker 请的一个『秘书』，它不对外提供服务，只给 App Worker 打工，专门处理一些公共事务。现在我们的多进程模型就变成下面这个样子了

```javascript

                +--------+          +-------+
                | Master |<-------->| Agent |
                +--------+          +-------+
                ^   ^    ^
               /    |     \
             /      |       \
           /        |         \
         v          v          v
+----------+   +----------+   +----------+
| Worker 1 |   | Worker 2 |   | Worker 3 |
+----------+   +----------+   +----------+
那我们框架的启动时序如下：

+---------+           +---------+          +---------+
|  Master |           |  Agent  |          |  Worker |
+---------+           +----+----+          +----+----+
     |      fork agent     |                    |
     +-------------------->|                    |
     |      agent ready    |                    |
     |<--------------------+                    |
     |                     |     fork worker    |
     +----------------------------------------->|
     |     worker ready    |                    |
     |<-----------------------------------------+
     |      Egg ready      |                    |
     +-------------------->|                    |
     |      Egg ready      |                    |
     +----------------------------------------->|

```

- Master 启动后先 fork Agent 进程
- Agent 初始化成功后，通过 IPC 通道通知 Master
- Master 再 fork 多个 App Worker
- App Worker 初始化成功，通知 Master
- 所有的进程初始化成功后，Master 通知 Agent 和 Worker 应用启动成功

# egg.js的集群方案

[egg.js集群方案](https://eggjs.org/zh-cn/core/cluster-and-ipc.html)

egg.js集群方案已经囊括上面我说的所有点，以及对其进行了完整的封装

1. 完善的cluster模块(egg-cluster)
2. agent机制，处理一些杂碎
3. 封装好的IPC接口，方便开发者调用
4. IPC实战演练
5. [IPC的高级应用](https://eggjs.org/zh-cn/advanced/cluster-client.html)