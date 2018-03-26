# Node.js模块化 （一）

模块化对于一门语言来说是属于架构层面的。我们将代码拆分成小Function，小类，但实际上我们还需要一种模块化机制去使得我们更大粒度的控制代码。这一种机制可以叫做：命名空间（namespace，包，模块化）。


# 没有模块化会怎样？

有同学非常的疑惑，老子的代码自己写的我当然知道，我只要保证我的函数名不重复不就可以了？很可惜，这么思考的同学还是```图样图森破```了。在实际工程中我们有以下痛点：
- 部门A开发一个包
- 部门B开发了一个包
- 如果没有模块化机制，部门A的同学必须大量与部门B的同学进行沟通，以防止函数名、函数变量、全局变量的不重复。

任何一个大工程都是多人开发的模式进行，没有一个良好的模块化机制，那么这无疑就增添了巨大的沟通成本。试想，1000个部门合作，1000个部门开发各自的包，然后1000个部门每天就在讨论```这个变量名和那个变量名不能用```，那谁都别想完成一个工程了。

在这种致命的痛点之下，模块化应运而生。


# JavaScript 模块化

玩具语言js并没有原生的模块化机制，在```node.js```诞生初期，也并没有模块化机制，包括最新的ES6中的```import xxoo```也只是一种语法糖。庆幸的是，在JavaScript中并不需要语言上的支持，完全用一种Hack的方式就能实现模块化。

可能我这么表达，大家还是不能理解什么是模块化的思想，接下来，当我一步一步带你实现模块化并且解析```Node.js```的模块化实现。

# 简单实现一个模块化

想要理解Node.js模块化如何做的，那我们要先来使用 JavaScript 实现模块化。

### 一个简单的函数
```js
function Add(a, b) {
    return a + b
}
```
我们有一个简单的Add函数，想要将这个Add函数进行模块化，我们就得使用```闭包```。

```js
function FzModule(module) {
    function Add(a, b) {
        return a + b
    }
    
}
```
代码修改一下，我们用一个FzModule来包住我们的Add函数，这个FzModule的参数是一个叫做Module的玩意。

### 一个叫Modules的类
```js
function Modules() {
    this.exports = {}
}

const newModule = new Modules()
```

### 组合Modules和我们的FzModule
```js
function FzModule(modules) {
    function Add(a, b) {
        return a + b
    }
    modules.exports = Add
    return modules
}

function Modules() {
    this.exports = {}
}

const newModule = new Modules()

const fz = FzModule(newModule)

console.log('5+6=', fz.exports(5, 6))
```

毫无意外，当我们运行代码的时候，我们已经会获得```5+6= 11```

### 把FzModule移出去

我们将FzModule移动到fz.js中
```js
//fz.js
;(function FzModule(modules) {
    function Add(a, b) {
        return a + b
    }
    modules.exports = Add
    return modules
})
```
在这里有必要解释一下，我特意在function外面包着一个(),这个叫做```立即执行```函数，意思就是只要你执行这个文件，这个函数就会自动执行。

我们回到刚刚的```main.js```
```js
//main.js
const vm = require('vm')
const fs = require('fs')

const source = fs.readFileSync('./fz.js','utf-8') //我们读取fz.js中的源码字符串
const fn = vm.runInThisContext(source)//注意,这一行代码是编译我们fz.js中的字符串

function Modules() {//不用多说，我们自己创建的module对象
    this.exports = {}
}

const newModule = new Modules()//构建module对象

const fz = fn(newModule)//传递modules对象

console.log('5+6=', fz.exports(5, 6))//使用modules

```

稍微解释一下 ```const fn = vm.runInThisContext(source)```这行代码是最重要的一个环节，```vm.runInThisContext```函数会将javascript代码传递到V8中去跑，并且因为我们刚刚使用了```立即执行```函数，因此，返回的就是我们刚刚的

```js
//fz.js
;(function FzModule(modules) {
    function Add(a, b) {
        return a + b
    }
    modules.exports = Add
    return modules
})
```
我们将```const fz = fn(newModule)//传递modules对象```丢进去，就获得了我们的模块

### 再简单一点
```js
//fz.js
;(function FzModule(modules) {
    function Add(a, b) {
        return a + b
    }
    modules.exports = Add
    return modules
})
```
我们再回头看看我们的模块化，这一部分代码有重复的地方
1. 我们每写一个模块，就要用一个```function```和```立即执行函数```去包裹住我们的函数
2. 每次都要返回
3. 饮用的时候，我们必须``` fs.readFileSync('./fz.js','utf-8')```读取一下源码，再使用```const fn = vm.runInThisContext(source)```跑一遍，
4. 最后，再通过构建一个```module```对象，传递构建出```const fz = fn(newModule)```
5. 浪费时间和精力

根据DRY原则，这一部分我们进行封装，使得我们使用模块更加简单。

### 最后的封装！

我们简化我们的```fz.js```
```js
function Add(a, b) {
    return a + b
}

modules.exports = Add
```
注意，```modules```是我自己构建的，和```nodejs```中的```module.exports```不同！

改造一下```main.js```
```js
const vm = require('vm')//引入vm
const fs = require('fs')

function Modules() {
    //不用多说，我们自己创建的module对象
    this.exports = {}
}

Modules.prototype._compile = function(src) {
    
    const wrap = source => {
        return `(function(modules){${source}\nreturn modules})` //一个包囊函数，纯粹就把字符串封装进来
    }

    const source = fs.readFileSync(src, 'utf-8') //我们读取fz.js中的源码字符串
    const moduleWrap = wrap(source)
    const fn = vm.runInThisContext(moduleWrap) //注意,这一行代码是编译我们fz.js中的字符串
    return fn
}

function _Require(src) {
    const newModule = new Modules() //构建module对象

    const fn = newModule._compile(src) //编译源码
    return fn(newModule).exports//返回
}

```

最后，见证奇迹的时刻！！！
```js
const fz = _Require('./fz.js') //使用我们的_Require函数

console.log('5+6=', fz(5, 6)) //使用modules

//输出  5+6 = 11
```

- 30不到的代码，我们就实现了一个高可复用性的模块化_Require
- 是不是非常像我们的nodejs了？？？？？？？
- 现在能分清楚module.exports和exports的区别了吗？

你没理解错，这就是Node.js的模块机制做法，当然这么个模块机制还是会有很多的bug
- 循环引用问题
- 重复引用导致内存过大

那么Node.js是如何解决这一块内容的，在下一节内容中我们将揭开这个秘密！

