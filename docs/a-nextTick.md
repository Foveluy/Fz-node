# 深入nextTick源码：使用ES6优化数组操作

```nextTick```是 node 中非常出名的一个函数，其运行周期在微任务之前，又在一次事件循环末尾。这个函数在工业中被大量使用，今天我们就深度剖析一下这个函数的实现极其node开发者为其做的优化.

# 最开始

在比较早的版本中，nexTick回调函数会被，在本轮事件循环末尾，Promise（微任务）之前推进一个队列，我们叫这个队列:
```js
var nexTickCallback = [];
```

早期实现中，这并没有什么问题，直到后来这个pr的出现:[#13446](https://github.com/nodejs/node/pull/13446)，这个哥们发现了一个神奇的现象：使用```es6```构造一个数组，手动添加clear,push,shift等方法，比原生的```[]```要快接近```20%```.以下是结果:
```js
                                               improvement confidence      p.value
 process/next-tick-breadth-args.js millions=2     27.75 %        *** 1.271176e-20
 process/next-tick-breadth.js millions=2           7.71 %        *** 4.155765e-13
 process/next-tick-depth-args.js millions=12      47.78 %        *** 4.150674e-52
 process/next-tick-depth.js millions=12           47.32 %        *** 7.742778e-31

```
那么他给nextTick添加了一个什么代码呢？没有错，他只是简单的使用es6的class自己写了一个function.
```js
class NextTickQueue {
    constructor() {
        this.head = null
        this.tail = null
        this.length = 0
    }

    push(v) {
        const entry = { data: v, next: null }
        if (this.length > 0) this.tail.next = entry
        else this.head = entry
        this.tail = entry
        ++this.length
    }

    shift() {
        if (this.length === 0) return
        const ret = this.head.data
        if (this.length === 1) this.head = this.tail = null
        else this.head = this.head.next
        --this.length
        return ret
    }

    clear() {
        this.head = null
        this.tail = null
        this.length = 0
    }
}
```
这个函数是有通用性的，也就是说我们可以运用到现实生活中去优化我们队列的大量操作。为此，我特地写了一份测试函数。得到的结果真实让人有点兴奋，哈哈.
```
➜ 
使用构造函数的array: 192
普通array: 196
➜ 
使用构造函数的array: 186
普通array: 185
➜ 
使用构造函数的array: 161
普通array: 188
➜ 
使用构造函数的array: 162
普通array: 189
➜ 
使用构造函数的array: 152
普通array: 188
➜ 
使用构造函数的array: 169
普通array: 185
➜ 
使用构造函数的array: 163
普通array: 191
➜ 
使用构造函数的array: 162
普通array: 186
➜ 
使用构造函数的array: 225
普通array: 208
➜ 
使用构造函数的array: 201
普通array: 205
➜ 
使用构造函数的array: 186
普通array: 189
➜ 
使用构造函数的array: 165
普通array: 191
➜ 
使用构造函数的array: 153
普通array: 182
➜ 
使用构造函数的array: 212
普通array: 196
➜ 
使用构造函数的array: 184
普通array: 257
➜ 
使用构造函数的array: 174
普通array: 207
➜ 
使用构造函数的array: 167
普通array: 187
➜ 
使用构造函数的array: 157
普通array: 193
➜ 
使用构造函数的array: 228
普通array: 192
➜ 
使用构造函数的array: 178
普通array: 218
➜ 
使用构造函数的array: 163
普通array: 215
➜ 
使用构造函数的array: 157
普通array: 181
➜ 
使用构造函数的array: 158
普通array: 183
➜ 
使用构造函数的array: 237
普通array: 197
➜ 
使用构造函数的array: 209
普通array: 192
➜  
使用构造函数的array: 163
普通array: 189
➜  
使用构造函数的array: 169
普通array: 210
```
在上述的测试中，我们可以发现，大部分情况下，使用es6构造的数组，要比普通的```[]```要快上很多，最大的差距到达了50ms.

# 使用一个特殊的可重用单向链表去优化速度

又过了一段时间，nextTick的实现再次被踢翻，具体的pr再这里:[pr:#18617](https://github.com/nodejs/node/pull/18617),这位哥们的做法更加变态：他的思路其实很简单，我们```push```操作的时候，系统都会申请一块新的空间来存储，清理的时候会将一大块内存都清理掉，那么这样实在是有点浪费，不如一次性申请好一堆内存，push的时候按位置放进去不就完了？于是有了现在的实现：
```js
// 现在的设计变成了这样子：是一个单项链表，每个链表中的元素，都有一个固定为2048长度的数组
  // 如果单次注册回调的次数少于2048次，那么只会一次性分出2048个长度的array提供使用
  //这2048长度的数组中的内存是可以重复使用的
  //
  //  head                                                       tail
  //    |                                                          |
  //    v                                                          v
  // +-----------+ <-----\       +-----------+ <------\         +-----------+
  // |  [null]   |        \----- |   next    |         \------- |   next    |
  // +-----------+               +-----------+                  +-----------+
  // |   tick    | <-- bottom    |   tick    | <-- bottom       |  [empty]  |
  // |   tick    |               |   tick    |                  |  [empty]  |
  // |   tick    |               |   tick    |                  |  [empty]  |
  // |   tick    |               |   tick    |                  |  [empty]  |
  // |   tick    |               |   tick    |       bottom --> |   tick    |
  // |   tick    |               |   tick    |                  |   tick    |
  // |    ...    |               |    ...    |                  |    ...    |
  // |   tick    |               |   tick    |                  |   tick    |
  // |   tick    |               |   tick    |                  |   tick    |
  // |  [empty]  | <-- top       |   tick    |                  |   tick    |
  // |  [empty]  |               |   tick    |                  |   tick    |
  // |  [empty]  |               |   tick    |                  |   tick    |
  // +-----------+               +-----------+ <-- top  top --> +-----------+
  //
  //回调比较少的情况
  //  head   tail                                 head   tail
  //    |     |                                     |     |
  //    v     v                                     v     v
  // +-----------+                               +-----------+
  // |  [null]   |                               |  [null]   |
  // +-----------+                               +-----------+
  // |  [empty]  |                               |   tick    |
  // |  [empty]  |                               |   tick    |
  // |   tick    | <-- bottom            top --> |  [empty]  |
  // |   tick    |                               |  [empty]  |
  // |  [empty]  | <-- top            bottom --> |   tick    |
  // |  [empty]  |                               |   tick    |
  // +-----------+                               +-----------+
  //
  //当往队列中插入一个callback的时候，top就会往下走一个格子
  //当从中取出的时候，bottom也会从中取出一个，如果不为空，则直接返回，调整bottom的位置往下走
  //
  //
  //判断一个表是否满了或者全空非常简单(2048)，当top===bottom的时候，list[top] !== undefine 那就是满了
  //会重新生成一个表
  //如果top===bottom && list[top] === void 666
  //那就证明，这个表已经空了
```
经过测试，总体性能又拔高了```40%```.

```bash
                                             confidence improvement accuracy (*)   (**)  (***)
 process/next-tick-breadth-args.js millions=4        ***     40.11 %       ±1.23% ±1.64% ±2.14%
 process/next-tick-breadth.js millions=4             ***      7.16 %       ±3.50% ±4.67% ±6.11%
 process/next-tick-depth-args.js millions=12         ***      5.46 %       ±0.91% ±1.22% ±1.59%
 process/next-tick-depth.js millions=12              ***     23.26 %       ±2.51% ±3.36% ±4.40%
 process/next-tick-exec-args.js millions=5           ***     38.64 %       ±1.16% ±1.55% ±2.01%
 process/next-tick-exec.js millions=5                ***     77.20 %       ±1.63% ±2.18% ±2.88%

Be aware that when doing many comparisions the risk of a false-positive
result increases. In this case there are 6 comparisions, you can thus
expect the following amount of false-positive results:
  0.30 false positives, when considering a   5% risk acceptance (*, **, ***),
  0.06 false positives, when considering a   1% risk acceptance (**, ***),
  0.01 false positives, when considering a 0.1% risk acceptance (***)
```

# 总结
实际上，这个nextTick依旧有优化的空间可以发挥：使用类似 node.js bufferlist，不过很容易导致内存泄漏。

- 如果有大量操作列表的操作，我们可以使用以上的优化方法
- 本篇作为nextTrick队列实现的附录，并不涉及事件循环等要素

更多章节可以在：[不伤眼的版本](https://github.com/215566435/Fz-node)中找到。

