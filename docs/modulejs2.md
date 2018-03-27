# Node.js模块化 （二）

上一节内容中我们讲到了Node.js的模块化机制采用的是闭包实现，我们也非常简洁的用```30行代码```实现了一个简陋版本的 Node.js 模块化，这一节，我们将深入到模块化的内部，一探究竟

# Node.js 模块分类

- ```文件模块```:用户编写的模块，包括npm包，本地文件等等.
- ```Native_module```:我们叫他们做```核心模块```，但是一般来说指的是由```JS``` + ```c/c++```混合编写的模块，如```http```,```fs```等
- ```内建模块```:一些纯粹的c++模块，毫无JS代码，已经编译好，启动时直接加载进内存，用户一般不直接调用。

# Native_module 模块的引入

想要搞明白```Native_module```模块的引入，我们还得从一个例子，开始走起：
```js
const http = require('http')
```
我们不妨思考一个问题，这个```require```哪里来的？跟着调试走，我们来到以下的代码：
```js
 (function (exports, require, module, __filename, __dirname) { 'use strict';

// Invoke with makeRequireFunction(module) where |module| is the Module object
// to use as the context for the require() function.
function makeRequireFunction(mod) {
  const Module = mod.constructor;

  function require(path) {
    try {
      exports.requireDepth += 1;
      return mod.require(path);
    } finally {
      exports.requireDepth -= 1;
    }
  }
.....
)
```
如果你还记得上一节我们讲述的代码，那你已经不会对这样的代码陌生。我们的Node.js在启动的时候，就已经为我们注入了一个```require函数```，在接下去的所有```module```中，都会传递```function (exports, require, module, __filename, __dirname)```这么一些参数进来。稍微有经验的同学已经发现，这些参数，我们都可以在任何一个```.js```文件中直接实用，究其原因就是因为Node.js帮我们做了一个注入。

往下走，我们来到require的定义:
```js
// Loads a module at the given file path. Returns that module's
// `exports` property.
Module.prototype.require = function(path) {
  assert(path, 'missing path');
  assert(typeof path === 'string', 'path must be a string');
  return Module._load(path, this, /* isMain */ false);
};
```
实际上调用require是为了引出```Module._load```这个方法，看名字我们就知道，是装载的模块的意思。

```js
Module._load = function(request, parent, isMain) {
///省略了一些废话....
  var filename = Module._resolveFilename(request, parent, isMain);
  //这一步非常的关键，如果模块已经被导入，那么就直接会被返回
  //这一招巧妙的解决了：重复引用，以及重复加载的问题
  //使得一个模块不会被加载多次，而且第二次加载的时候是从内存里直接拿的
  var cachedModule = Module._cache[filename];
  if (cachedModule) {
    updateChildren(parent, cachedModule, true);
    return cachedModule.exports;
  }

  if (NativeModule.nonInternalExists(filename)) {
    //如果在缓存中没有找到模块
    //那么则来到这个方法去加载
    return NativeModule.require(filename);
  }
///再次省略了一些无关代码...
};
```
在注释中我说得很明白，缓存机制在Node.js系统中大量运用，为的就是提速。使用空间换时间的做法在工业上非常常见而且有效，相比于性能来说，内存实在不贵。接下去我们看看，第一次加载核心模块时做了什么

```js
  NativeModule.require = function(id) {

    //去除了一些废话

    //这里的id='http'，也就是我们要引入的模块
    //这个NativeModule的构造函数我们放在下面
    //这里就理解为新建一个Native模块用于存储我们的http
    const nativeModule = new NativeModule(id);

    //创建以后，马上把这个已经加载的模块缓存起来
    //下次实用时，可以快速拿出来
    nativeModule.cache();
    
    //这一行，是核心模块的编译函数，也是整个模块导入的核心
    nativeModule.compile();
    //我们
    return nativeModule.exports;
  };

  //NativeModule 的构造函数
  function NativeModule(id) {
    this.filename = `${id}.js`;
    this.id = id;
    this.exports = {};
    this.loaded = false;
    this.loading = false;
  }

```
```nativeModule.compile();```这一行函数，是核心，我们追进去，看看到底做了什么。

```js
NativeModule.prototype.compile = function() {
    //这一行函数的意思是获取源码
    //注意并不是我们可执行的js，而是纯粹的字符串
    var source = NativeModule.getSource(this.id);
    //这个wrap函数也是非常经典了，我已经在上一章节中演示
    //作用就是把模块包装成一个函数表达式，提供V8编译
    source = NativeModule.wrap(source);
    try {
    //终于，我们看到了老朋友runInThisContext
      const fn = runInThisContext(source, {
        filename: this.filename,
        lineOffset: 0,
        displayErrors: true
      });
      //编译出来的function，调用，丢进去模块的exports,require,模块本身，以及_filename
      //注意，这里没有__dirname，因为这些模块本身就在nodejs控制范围内，无需知道路径了
      fn(this.exports, NativeModule.require, this, this.filename);
     //标记已经记载
      this.loaded = true;
    } finally {
      this.loading = false;
    }
  };
```
到此，JavaScript层的模块引入已经完毕，非常简单轻松。老朋友```runInThisContext```再次出现，毫无意外，这一部分的内容涉及到c++，会在之后的c++篇幅中讲解，其实这个函数也就是调用V8的一个函数编译并执行，就如```eval```类似。

# 文件 模块的引入

文件模块的引入非常的类似，值得注意的是，核心模块被存储在NativeModule._cache对象上，而Module._cache对象上存储的是文件模块.更有趣的事情是，文件模块会被缓存在```require```这个函数的cache属性上，通过操作```require.cache```属性，我们能够实现热加载配置等等方案。


但是```require.cache```并没有被官方所提及，人们发现这个api早在2015-2016年之间的一个issue中，之后就被大量实用...我觉得官方并没有提及这个api的原因```是不想被人所知道```，因为node.js模块加载机制的原因，操纵这个cache是非常危险的事情。一个不小心就会导致内存泄漏。最近看到一个团队，也因为这件事情栽了跟斗。具体地址贴一下，非常好的案例，提供大家学习：[一行 delete require.cache 引发的内存泄漏血案](https://zhuanlan.zhihu.com/p/34702356)

引以为戒:
```bash
特别提醒
delete require.cache 这个操作是许多希望做 Node.js 热更新的同学喜欢写的代码，根据上面的分析要完整这个模块引入缓存的完整去除需要所有引用到此模块的 parent.children 数组里面的引用。

遗憾的是，module.parent 只是保存了第一次引用该模块的父模块，而其它引用到此文件的父模块需要开发者自己去构建载入模块间的相互依赖关系，所以在 Node.js 下做热更新并不是一条传统意义上的生路
```



到此，JS层的已经讲得7788，剩下来的c++模块，之后到了c++时在进行讲解











