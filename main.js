function Modules() {
    //不用多说，我们自己创建的module对象
    this.exports = {}
}

Modules.prototype._compile = function(src) {
    const vm = require('vm')
    const fs = require('fs')

    const wrap = source => {
        return `(function(modules){${source}\nreturn modules})`
    }

    const source = fs.readFileSync(src, 'utf-8') //我们读取fz.js中的源码字符串
    const moduleWrap = wrap(source)
    const fn = vm.runInThisContext(moduleWrap) //注意,这一行代码是编译我们fz.js中的字符串
    return fn
}

function _Require(src) {
    const newModule = new Modules() //构建module对象

    const fn = newModule._compile(src) //编译
    return fn(newModule).exports
}

const fz = _Require('./fz.js') //传递modules对象

console.log('5+6=', fz(5, 6)) //使用modules
