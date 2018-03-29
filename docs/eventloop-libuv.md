# 事件循环libuv入门

想要详细了解 node 中的事件循环是如何运作的，通过看网上的文章我依旧觉得不是很稳。究其原因就是我对libuv的不熟悉，不管是内部原理，还是外部API都是所知甚少。导致在看文章的时候，诸如```uv_loop_open()```等等API甚是陌生。这对于理解事件循环的本质并不是很有帮助，所以我打算花一点时间，对其进行入门。


幸亏当年写过一年多的c/c++程序，如今只是半吊子，还是能够快速入门libuv，熟悉API。


# 搭建libuv开发环境

- [libuv的仓库](https://github.com/libuv/libuv)

仓库里有很详细的各个平台的安装方法：
- [windows](https://github.com/libuv/libuv#windows)
- [*nix](https://github.com/libuv/libuv#unix)
- [mac](https://github.com/libuv/libuv#os-x)

# Hello world

安装完毕以后，引入头文件，最简单的hello world
```js
#include <stdio.h>
#include <stdlib.h>
#include <uv.h>

int main() {
    printf("Hello world.\n");
    uv_loop_t * loop = uv_default_loop();
    uv_run(loop, UV_RUN_DEFAULT);
    
    uv_loop_close(loop);
    return 0;
}
//output:Hello world.
```
以上的几行代码我们熟悉一下：
- ```v_loop_t * loop = uv_default_loop();```:初始化loop，使用默认loop来跑。node中也是使用默认的loop。
- ```uv_run(loop, UV_RUN_DEFAULT);```:跑loop。
- ``` uv_loop_close(loop);```:关闭loop和释放loop分配的内存

到此，我们对```libuv```有了第一认识。

# 尝试读取一下文件

读写文件使用的是```uv_fs_**```这种样式的函数

在libuv中，文件操作同时提供了```同步 synchronous``` 和 ```异步 asynchronous.```的接口，这和我们的node非常像，调用方式更加像。异步版本API的接口使用的是内部的线程池模型去驱动异步。废话不多说，我们来看看一个api

```js
int uv_fs_open(uv_loop_t* loop, uv_fs_t* req, const char* path, int flags, int mode, uv_fs_cb cb)
```
c语言的参数都很长，解释下参数
- ```loop```:loop变量
- ```req```:类型是```uv_fs_t```结构体实例的一个指针，这个参数会在完成io之后，往最后的```cb```中，传入
- ```path```:明显，就是文件的地址了
- ```flags```和```mode```：参数flags与mode和标准的 Unix flags 相同，具体可以查看unix read api 的flags和mode
- ```cb```:这个就是我们的callback函数了，这个函数必须是接受```uv_fs_t* ```为参数的一个函数

创建一个文件，```text.txt```
```js
i m file
```

我们快速使用一下这个api
```js
#include <stdio.h>
#include <uv.h>

uv_fs_t open_req;

void on_open(uv_fs_t *req) {
    printf("%zd\n",req->result);//输出10
}

int main() {
    const char* path = "/Users/zf/Desktop/Fz-node/libuv-simple/libuv-simple/text.txt";
    uv_fs_open(uv_default_loop(), &open_req,path, O_RDONLY, 0, on_open);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    uv_fs_req_cleanup(&open_req);
    return 0;
}
```
这么一来，我们的思路一目了然，填写path之后，调用```uv_fs_open```，然后跑loop，当打开文件结束之后，我们就会到达```on_open```这个callback中。值得注意的是，在c中，打开文件和读文件属于分开的逻辑，两步回调，也是够蛋疼的，但是为了获得极限的性能，异步进行到底。

我们得到的结果会存储在全局变量```open_req```中，实际上on_open中的```*req```就是指向这个全局变量。接下来我们要进行一下读操作：
```js
#include <stdio.h>
#include <uv.h>

uv_fs_t open_req;
uv_fs_t _read;

static char buffer[1024];
static uv_buf_t iov;

void on_read(uv_fs_t *req) {
    printf("%s\n",iov.base);
}
void on_open(uv_fs_t *req) {
    printf("%zd\n",req->result);
    iov = uv_buf_init(buffer, sizeof(buffer));
    uv_fs_read(uv_default_loop(), &_read, (int)req->result,
               &iov, 1, -1, on_read);
}
int main() {
    const char* path = "/Users/zf/Desktop/Fz-node/libuv-simple/libuv-simple/text.txt";
    uv_fs_open(uv_default_loop(), &open_req,path, O_RDONLY, 0, on_open);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    uv_fs_req_cleanup(&open_req);
    return 0;
}
```
通过两步callback，我们终于获得文件中的内容，打印出来```i m file```。在```on_open``中做了以下几个事：
- req->result 是用于判断读取成功与否的标志位，分别有三种值：大于0，小于0，以及等于0。大于0成功，小于0失败
- uv_buf_init 将一个全局变量```buffer```初始化成```uv_buf_t```的类型
- uv_fs_read 读取函数，跟open函数很类似，注意多了一个参数：iov，read函数会把读到的数据塞进iov中
- 读取完毕以后，来到```on_read```函数，结果放在```iov.base```中，我们就可以我们刚刚文件里写的东西了。


# 事件循环什么时候开始的？

这个问题，我相信很多人都没想过，甚至想过的人，可能也开始觉得纳闷：```理解事件循环什么时候开始的这对我们理解事件循环本身有什么帮助？```，这并不是我一人钻牛角尖，而是只有搞明白这些，才能真正理解事件循环。

```js
int main() {
    const char* path = "/Users/zf/Desktop/Fz-node/libuv-simple/libuv-simple/text.txt";
    uv_fs_open(uv_default_loop(), &open_req,path, O_RDONLY, 0, on_open);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    uv_fs_req_cleanup(&open_req);
    return 0;
}
```
回顾刚刚的```main```函数，我们发现，读取的操作```uv_fs_open```有两个特殊的地方：
1. 在```uv_run```之前
2. 竟然需要```uv_default_loop()```作为参数

其实从这里我们已经可以看出诡异之处，```事件循环是在所有的同步操作之前```。也就是说，无论是libuv还是node都是完成了以下步骤才会进入循环:
- 所有同步任务
- 同步任务中的异步操作发出请求
- 规划好同步任务中的定时器
- 最后process.nextTrick()等等

用js代码表明的话
```js
const http = require('http') //同步任务
const port = 3000 //同步任务
http
.createServer()
.listen(port, () => console.log('我是第一轮事件循环')) //同步任务中的异步请求
console.log('准备进入循环')
```
直到最后一行的```console.log('准备进入循环')```跑完，才会开始准备进入事件循环。

# 事件循环的7个主要阶段

- update_time
- timers
- I/O callbacks
- idle, prepare
- I/O poll
- check
- close callbacks

也就是说，事件循环必须跑完这6个阶段，才算一个轮回。这一点一定要深刻记住。

### 1.update_time
在事件循环的开头，这一步的作用实际上是为了获取一下系统事件，以保证之后的timer有个计时的标准。这个动作会在每次事件循环的时候都发生，确保了之后timer触发的准确性。（其实也不太准确....)

### 2. timers
事件循环跑到这个阶段的时候，要检查是否有```到期的timer```,其实也就是```setTimeout```和```setInterval```这种类型的timer，到期了，就会执行他们的回调。

### 3. I/O callbacks
处理异步事件的回调，比如网络I/O，比如文件读取I/O。当这些I/O动作都***结束***的时候，在这个阶段会触发它们的回调。我特别指出了结束这个限定语。

### 4. idle, prepare
这个阶段内部做一些动作，与理解事件循环没啥关系


### 5. I/O poll阶段
这个阶段相当有意思，也是事件循环设计的一个有趣的点。这个阶段是***选择运行***的。选择运行的意思就是不一定会运行。在这里，我先卖一个关子，后问详细深入讨论。

### 6. check
执行```setImmediate```操作

### 7. close callbacks
关闭I/O的动作，比如文件描述符的关闭，链接断开，等等等


# 核心函数uv_run

上述的七个阶段其实已经很明确，多看几遍就能记住，我们重点来分析一下，libuv源码是怎么写的。看看这个神奇的```uv_run```:

[源码](https://github.com/libuv/libuv/blob/v1.x/src/unix/core.c)
```js
int uv_run(uv_loop_t* loop, uv_run_mode mode) {
  int timeout;
  int r;
  int ran_pending;

//首先检查我们的loop还是否活着
//活着的意思代表loop中是否有异步任务
//如果没有直接就结束
  r = uv__loop_alive(loop);
  if (!r)
    uv__update_time(loop);

//传说中的事件循环，你没看错了啊！就是一个大while
  while (r != 0 && loop->stop_flag == 0) {
      //更新事件阶段
    uv__update_time(loop);

    //处理timer回调
    uv__run_timers(loop);

    //处理异步任务回调 
    ran_pending = uv__run_pending(loop);

    //没什么用的阶段
    uv__run_idle(loop);
    uv__run_prepare(loop);

    //这里值得注意了
    //从这里到后面的uv__io_poll都是非常的不好懂的
    //先记住timeout是一个时间
    //uv_backend_timeout计算完毕后，传递给uv__io_poll
    //如果timeout = 0,则uv__io_poll会直接跳过
    timeout = 0;
    if ((mode == UV_RUN_ONCE && !ran_pending) || mode == UV_RUN_DEFAULT)
      timeout = uv_backend_timeout(loop);

    uv__io_poll(loop, timeout);

    //就是跑setImmediate
    uv__run_check(loop);

    //关闭文件描述符等操作
    uv__run_closing_handles(loop);

    //再次检查是否活着
    //如果没有任何任务了，就推出
    r = uv__loop_alive(loop);
    if (mode == UV_RUN_ONCE || mode == UV_RUN_NOWAIT)
      break;
  }
  return r;
}
```
代码中我已经写得很详细了，相信不熟悉c代码的各位也能轻易搞懂，没错，事件循环就是一个大```while```而已！神秘的面纱就此揭开。

# poll阶段

这个阶段设计得非常巧妙，这个函数第二个参数是一个```timeout```参数，而这个```timeOut```由来自```uv_backend_timeout```函数，我们进去一探究竟！
[源码](https://github.com/libuv/libuv/blob/v1.x/src/unix/core.c)
```js
int uv_backend_timeout(const uv_loop_t* loop) {
  if (loop->stop_flag != 0)
    return 0;

  if (!uv__has_active_handles(loop) && !uv__has_active_reqs(loop))
    return 0;

  if (!QUEUE_EMPTY(&loop->idle_handles))
    return 0;

  if (!QUEUE_EMPTY(&loop->pending_queue))
    return 0;

  if (loop->closing_handles)
    return 0;

  return uv__next_timeout(loop);
}
```
原来是一个多步if函数，这代码写得真让人好懂！我们一个一个分析
1. ```stop_flag```:这个标记是 ```0```的时候，意味着事件循环跑完这一轮就退出了，返回的时间是0
2. ```!uv__has_active_handles```和```!uv__has_active_reqs```:看名字都知道，如果没有任何的异步任务（包括timer和异步I/O)，那```timeOut```时间一定就是0了    
3. ```QUEUE_EMPTY(idle_handles)```和```QUEUE_EMPTY(pending_queue)```:异步任务是通过注册的方式放进了```pending_queue```中，无论是否成功，都已经被注册，如果什么都没有，这两个队列就是空，所以没必要等了。
4. ```closing_handles```:我们的循环进入了关闭阶段，没必要等待了

以上所有条件啰啰嗦嗦，判断来判断去，为的就是等这句话```return uv__next_timeout(loop);```，这句话，告诉了```uv__io_poll```说：你到底停多久，接下来，我们继续看这个神奇的```uv__next_timeout```是怎么获取时间的。

```js
int uv__next_timeout(const uv_loop_t* loop) {
  const struct heap_node* heap_node;
  const uv_timer_t* handle;
  uint64_t diff;

  heap_node = heap_min((const struct heap*) &loop->timer_heap);
  if (heap_node == NULL)
    return -1; /* block indefinitely */

  handle = container_of(heap_node, uv_timer_t, heap_node);
  if (handle->timeout <= loop->time)
    return 0;

//这句代码给出了关键性的指导
  diff = handle->timeout - loop->time;

//不能大于最大的INT_MAX
  if (diff > INT_MAX)
    diff = INT_MAX;

  return diff;
}

```

上述函数做了一件非常简单的事情
1. 对比当前```loop```设置的时间，还记得一开头我们的```update_time```吗，这里用上了，保存在```loop->time```中
2. 获取到```距离此时此刻，loop中，最先到期的一个timer的时间```，不懂就多读几遍....

至此，我们就知道，这个```timeout```如果有值，那就一定是```距离此时此刻，loop中，最先到期的一个timer的时间```，如果这个timer时间太长，则以```INT_MAX``` 这个常数时间为基准。在(unix)c++头文件```#include <limits.h> ```中定义得到这个常量是：```32767```(不确定,单位应该是32.767毫秒).

# 得到Timeout以后poll做了什么？

```uv__io_poll```获得了一个最多是```32767```的一个等待时间，那么他等待什么呢？等等，你不觉得奇怪吗？事件循环竟然卡住了，再等等，node也会阻塞了？

不要担心，还记得我们刚刚一堆的判断吗？其实```只要有任务需要马上执行的时候```，这个函数是不会被调用的。那么被调用的时候则是：所有被注册的异步任务都没有完成（返回）的时候，这时候等一下其实没什么所谓，```等的就是这些异步任务会不会在这么极其短暂的时间内发生I/O完毕！```，至于等待的时间会根据每个系统的实现而不同，其实现原理就是epoll_wait函数做一个定时器..

等待结束以后，就会进入```check```阶段.


# nextTick去哪里了？

纵观整个事件循环，我们都没有发现，神秘的nextTick去哪里了。我们继续肛到nextTick中的源码中：
```js
startup.processNextTick = function() {
    var nextTickQueue = [];
    var pendingUnhandledRejections = [];
    var microtasksScheduled = false;

    // Used to run V8's micro task queue.
    var _runMicrotasks = {};

    // *Must* match Environment::TickInfo::Fields in src/env.h.
    var kIndex = 0;
    var kLength = 1;

    process.nextTick = nextTick;
    // Needs to be accessible from beyond this scope.
    process._tickCallback = _tickCallback;
    process._tickDomainCallback = _tickDomainCallback;

   //这里真正的调用了c++层的
    const tickInfo = process._setupNextTick(_tickCallback, _runMicrotasks);
    // 省略...
}
```
在胶水层```src/async_wrap.cc```中，我们可以看到:

```js
Local<Value> AsyncWrap::MakeCallback(const Local<Function> cb,
                                      int argc,
                                      Local<Value>* argv) {
  // ...
  Environment::TickInfo* tick_info = env()->tick_info();

  if (tick_info->in_tick()) {
    return ret;
  }

//如果没有的话直接执行promise这种微任务
  if (tick_info->length() == 0) {
    env()->isolate()->RunMicrotasks();
  }

  if (tick_info->length() == 0) {
    tick_info->set_index(0);
    return ret;
  }

  tick_info->set_in_tick(true);
//如果有nextTick，promise这种微任务会被放在nextTick之后，先执行nextTick
  env()->tick_callback_function()->Call(process, 0, nullptr);

  tick_info->set_in_tick(false);
```

我们写一段代码来看看
```js
//无论你怎么调整Promise和nextTick的顺序，永远输出的是1和2
Promise.resolve().then(() => console.log(2))
process.nextTick(() => console.log(1))
//Promise.resolve().then(() => console.log(2))放在这里也一样
```

Node 规定，```process.nextTick```和```Promise```的回调函数，追加在本轮循环，即同步任务一旦执行完成，就开始执行它们。而```setTimeout```、```setInterval```、```setImmediate```的回调函数，追加在次轮循环。

```js
// 下面两行，次轮循环执行
setTimeout(() => console.log(1));
setImmediate(() => console.log(2));
// 下面两行，本轮循环执行
process.nextTick(() => console.log(3));
Promise.resolve().then(() => console.log(4));
```

因为是源码解析，所以具体的我就不多说，大家只可以看文档：[node官方文档](https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick/)


# 总结

- 事件循环的开始，在所有同步代码第一次注册完以后开始（如果有异步任务的话）
- 事件循环分为7个阶段，其中```uv__io_poll```阶段最难懂。
- ```process.nextTick```的操作，会在每一轮事件循环的最后执行


















