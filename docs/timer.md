# Timer模块

在我们的概念中，Timer一词很容易让我们想到Javascript中的几个全局API

```javascript
setTimeout()//一定时间过期
setInterval()：//无限循环，直到停止
```

大家或多或少的都已经使用过这两个API，也不陌生，也很直观。

# 使用场景1:HTTP返回头

我在知乎的一个问题中([方正知乎回答](https://www.zhihu.com/question/266029860/answer/348784731))提问到：**HTTP RFC中，明确要求response Header定义Date字段，Nodejs 如何高效的获取时间戳而不影响性能的？**

看一个HTTP返回头:
```javascript
Response Headers
Connection: keep-alive
Content-Length: 577
Content-Type: text/html
Date: Sat, 24 Mar 2018 00:19:46 GMT //注意这里
Server: openresty/1.9.15.1
```
我们每次发起HTTP请求时，服务器端都会生成这么一个时间戳返回。大家觉得：切，这个有什么，老夫```Date.now()```，转换一下，马上给你搞出来。

我只能说，你太肤浅了。这么说的原因是因为```任何一个底层时间获取函数都是一次严重的系统调用```，熟悉系统调用这个词的同学一定知道，每一个System Call的消耗都是非常巨大的。

假设，我们请求成千成万，你每次都去调用System Call你的系统并发量会下降大约30-40%左右！

或许你会想，那老子不提供了，怎么样？当然不行，规范是这么写的，如果你按规范走，那你就时邪教了。

>题外话：这数据不是我凭空想象出来的，而是我半年前造的一个Python写的Async/await服务器时，发现的。
>[show me the code：luya服务器](https://github.com/215566435/LuyWeb/blob/master/luya/response.py#L116)

# 使用场景2:HTTP Request header Keep-Alive

在蛮荒的http 1.0时代，人们并不关心什么并发，当时并发也少。所以"应答"模式的HTTP协议，采用的流程
```js
request->服务器开启socket迎接->处理request，拼装回复->response->关闭socket
```
这样的一个流程看起来很舒坦，但实际上隐含着巨大的性能问题。每次开启和关闭socket的操作，属于System Call，非常的重，就跟妈妈用锤子锤了你电脑一样重。

大量请求到来时，开开关关，性能下降20-30%，非常巨大。
>我又怎么懂那么精确的，依旧是我之前造轮子的时候碰上的.....
>[show me the code：luya服务器](https://github.com/215566435/LuyWeb)

为了解决这个问题，人们在HTTP中加入了Keep-Alive字段，在1.0时代，默认关闭，开启的时候需要"Connection: Keep-Alive"。而HTTP 1.1以后，则是默认就开启，关闭："Connection: close".

当然了，一个socket不能一直开着，会消耗内存（linux下每个网络socket消耗大约3-4kb的内存).因此，在一段时间（默认120s）内客户端没有什么新的请求，这个socket就会关闭了。

由此我们可以看到，我们必须引入某种计时器机制，去应对这种情况。Node.js的HTTP模块对于每一个新的连接创建一个 socket 对象，调用socket.setTimeout设置一个定时器用于超时后自动断开连接。


# Timer模块的引入和问题

## 模块
Timer模块也是一个c++和javascript集合模块，具体具体调用可以这么玩.
模块源码[timer_wrap](https://github.com/nodejs/node/blob/master/src/timer_wrap.cc)

```javascript
const Timer = process.binding('timer_wrap').Timer;//引入c++模块
const kOnTimeout = Timer.kOnTimeout | 0;

function DIYsetTimeout(fn, ms) {
    var timer  = new Timer();  // 创建计时器对象
    timer.start(ms, 0);        // 触发时间
    timer[kOnTimeout] = fn;    // 设置回调函数
    return timer;              // 返回定时器
}

// 使用我们自己的DIYsetTimeout
DIYsetTimeout(() => console.log('DIYsetTimeout timeout!'), 1000);
```

如果我们使用这样的一个DIYsetTimeout去实现我刚刚说的HTTP，那就会有新的问题

## 问题
```javascript
var timer  = new Timer();  // 创建计时器对象，用于计时
```
这句话就是问题的所在，当我们创建N条链接的时候，就会创建N个Timer对象，构建对象同样是Javascript中比较重的事情，多了性能就差。


# Node.js内部优化思路:分级时间轮

在正常的HTTP请求中，每一个请求都是120s之后关闭，在这种情况下**我们完全没必要创建多个Timer去跑**，而是只用一个timer就可以完成计时的工作。

而这样的一个问题，抽象出来就是：
- 以触发时间作为key，存在哈希表中，每一个key，我们叫时间槽
- 同一个时间槽内，将所有任务安排在一条直线上(链表)
- 每个任务记录一个 startTime 和 endTime,
- 在新增任务的同时记录下startTime和endTime
- 在endTime时触发回调
- 删除任务，回到最开始的Timer中，计算下一个任务的触发时间


这就是一个时间轮的算法，说起来贼特么难懂，但是做起来却很简单.

# 伪代码设计一个Timer时间轮


首先我们准备一个对象，用于按key存储Timer:
```javascript
const timerWheel = {};
```

搞定了，我们注册几个任务
```javascript
const timer1 = setTimeout(() => {}, 120*1000);//任务1
//中间干了什么事等了10s
const timer2 = setTimeout(() => {}, 120*1000);//任务2
//中间干了什么事等了10s
const timer3 = setTimeout(() => {}, 120*1000);//任务3
```

```javascript
//底层会这么做
var L = timerWheel[120*1000]
if(!L) L = new TimersList(xxx)
L.push(任务1)
L.push(任务2)
L.push(任务3)
```
[时间轮的图](https://github.com/215566435/Fz-node/blob/master/docs/assets/time-wheel.png)

# 依次触发同为key120*1000的Timer

同为```120*1000```的Timer一共有三个，插入的时间分别不同，为了方便，我们可以进行假设，第一个Timer启动的时间是

```javascript
timer1._idleStart === 0
timer2._idleStart === 10000
timer3._idleStart === 20000
```

1. 首先```_idleStart为0的timer```进入TimersList中（里面有一个C实现的timer计时器），计时结束后，进行回调，然后删除```_idleStart为0的timer```
2. 然后```_idleStart为10000的timer```进入TimersList中（里面有一个C实现的timer计时器），计时结束后，进行回调，然后删除```_idleStart为10000的timer```
3. ....

由此可见，我们三个都是120秒的定时器，依次触发，通过这种巧妙的设计，使得一个Timer对象得到了最大的复用，从而极大的提升了timer模块的性能。


# 回到最初的使用场景：HTTP Date 返回头

- 使用缓存配合我们刚刚的Timer，实现高性能的获取HTTP Date返回头

```javascript 
 31 var dateCache;
 32 function utcDate() {
 33   if (!dateCache) {
 34     var d = new Date();
 35     dateCache = d.toUTCString();
 36     timers.enroll(utcDate, 1000 - d.getMilliseconds());
 37     timers._unrefActive(utcDate);
 38   }
 39   return dateCache;
 40 }
 41 utcDate._onTimeout = function() {
 42   dateCache = undefined;
 43 };

228   // Date header
229   if (this.sendDate === true && state.sentDateHeader === false) {
230     state.messageHeader += 'Date: ' + utcDate() + CRLF;
231   }
```

- L230，每次构造 Date 字段值都会去获取系统时间，但精度要求不高，只需要秒级就够了，所以在1S 的连接请求可以复用 dateCache 的值，超时后重置为undefined.

- L34-L35,下次获取会重启生成。

- L36-L37,重新设置超时时间以便更新。


# 回到最初的使用场景：HTTP Request header Keep-Alive

```javascript
303   if (self.timeout)
304     socket.setTimeout(self.timeout);
305   socket.on('timeout', function() {
306     var req = socket.parser && socket.parser.incoming;
307     var reqTimeout = req && !req.complete && req.emit('timeout', socket);
308     var res = socket._httpMessage;
309     var resTimeout = res && res.emit('timeout', socket);
310     var serverTimeout = self.emit('timeout', socket);
311 
312     if (!reqTimeout && !resTimeout && !serverTimeout)
313       socket.destroy();
314   });
```

- 默认的 timeout 为this.timeout = 2 * 60 * 1000; 也就是 120s。 
- L313，超时则销毁 socket。

# 参考文档
1. https://yjhjstz.gitbooks.io/deep-into-node/content/chapter3/chapter3-1.html
2. https://zhuanlan.zhihu.com/p/30763470
3. https://link.zhihu.com/?target=http%3A//www.cnblogs.com/hust/p/4809208.html


