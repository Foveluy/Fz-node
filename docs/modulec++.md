# 深入底层：Node.js启动和模块加载

之前已经从js层面看了 nodejs 代码，那么今天不多说，直接来看深入至 c++底层的源码.

# 从大名鼎鼎的main开始

```js
//node_main.cc
int main(int argc, char *argv[]) {
  return node::Start(argc, argv);
}
```
除去一些平台判断代码，我们来到了最出名的c语言函数，这个函数其实只是为了引出```node::Start(argc, argv);```，我们继续深入进去看
```js
int Start(int argc, char** argv) {
  //...
  V8::Initialize();
  const int exit_code = Start(uv_default_loop(), argc, argv, exec_argc, exec_argv);
 //....
  V8::Dispose();

  v8_platform.Dispose();

  //....
  return exit_code;
}
```

```V8::Initialize();```是V8的初始化，然后获取到```libuv```的```uv_default_loop()```之后，又来到了一个```start```函数。
```js
//....
 LoadEnvironment(&env);

  {
//....
    do {
      //事件循环在这里才开始
      uv_run(env.event_loop(), UV_RUN_DEFAULT);

      more = uv_loop_alive(env.event_loop());
    } while (more == true);

```
在深度遍历了几个Start之后，我们来到第一个重要的函数。这个函数做的事情其实就是加载我们```node.js```的乱七八糟模块以及跑我们的一开始的代码了。什么意思呢？其实就是```node hello.js```，第一遍跑我们的代码没有进入事件循环时，就会跑这个代码，再一次证明了，我们的代码执行一开始，并不会进入事件循环，而是跑完所有同步代码以后，才会开始。

```js
  /*
  在最近的版本中，bootstrap.js被拆分成了loader.js和node.js
  再这里我们看到了v8加载javascript的方法
  */
  Local<String> loaders_name =
      FIXED_ONE_BYTE_STRING(env->isolate(), "internal/bootstrap/loaders.js");

  Local<Function> loaders_bootstrapper =
      GetBootstrapper(env, LoadersBootstrapperSource(env), loaders_name);

  Local<String> node_name =
      FIXED_ONE_BYTE_STRING(env->isolate(), "internal/bootstrap/node.js");

  Local<Function> node_bootstrapper =
      GetBootstrapper(env, NodeBootstrapperSource(env), node_name);

  // Add a reference to the global object
  Local<Object> global = env->context()->Global();

    // Bootstrap internal loaders
  Local<Value> bootstrapped_loaders;
  if (!ExecuteBootstrapper(env, loaders_bootstrapper,
                           arraysize(loaders_bootstrapper_args),
                           loaders_bootstrapper_args,
                           &bootstrapped_loaders)) {
    return;
  }

  // Bootstrap Node.js
  Local<Value> bootstrapped_node;
  Local<Value> node_bootstrapper_args[] = {
    env->process_object(),
    bootstrapped_loaders
  };
  if (!ExecuteBootstrapper(env, node_bootstrapper,
                           arraysize(node_bootstrapper_args),
                           node_bootstrapper_args,
                           &bootstrapped_node)) {
```
以上代码其实就是做了几件事情：
1. 初始化global对象
2. 加载bootstrap中的两个模块
3. 挂载bootstrap初始化之后的东西到global对象中

那么，神秘的bootstrap两个模块到底是什么呢？让我们一探究竟

# bootstrap/loader.js

```js
(function bootstrapInternalLoaders(process, getBinding, getLinkedBinding,
                                   getInternalBinding) {
});
```
loader是一个函数表达式，注意这里使用了```(function(){})```的方式将源码包住，究其原因是为了让V8解析的时候，告诉V8把这段代码解析成一个c++的函数表达式,具体映射到c++，代码主要是
```js
//加载源码字符串，你看这是String类型
Local<String> loaders_name =
      FIXED_ONE_BYTE_STRING(env->isolate(), "internal/bootstrap/loaders.js");
//这一步使用v8的函数，获取一个function类型
//说明loaders_bootstrapper就是一个函数
  Local<Function> loaders_bootstrapper =
      GetBootstrapper(env, LoadersBootstrapperSource(env), loaders_name);

//注意看，这里是的参数其实就是对应了bootstrapInternalLoaders中的4个参数
Local<Value> loaders_bootstrapper_args[] = {
  env->process_object(),
  get_binding_fn,
  get_linked_binding_fn,
  get_internal_binding_fn
};

//执行ExecuteBootstrapper
  Local<Value> bootstrapped_loaders;
  if (!ExecuteBootstrapper(env, loaders_bootstrapper,
                           arraysize(loaders_bootstrapper_args),
                           loaders_bootstrapper_args,
                           &bootstrapped_loaders)) {
```
思路很简单，就是代码一大坨而已，接下来我们看看bootstrapInternalLoaders中四个重要的参数是什么
```js
(function bootstrapInternalLoaders(process, getBinding, getLinkedBinding,
                                   getInternalBinding) {
});
//process你没看错，就是我们所用的全局process对象
//getBinding其实就是之后的process.binding
//getLinkedBinding用于绑定在process._getLinkedBinding上用于载入c++模块，比如用户写的c++ addon
//getInternalBinding用于获取nodejs c++的内置模块
```
我们往下遍历代码就会看到我们的老朋友
```js


  // Set up NativeModule
  function NativeModule(id) {
    this.filename = `${id}.js`;
    this.id = id;
    this.exports = {};
    this.loaded = false;
    this.loading = false;
  }
  //构造一个loader，之后用于导出
    const loaderExports = { internalBinding, NativeModule };
    NativeModule.require = function(id) {
      const nativeModule = new NativeModule(id);

    nativeModule.cache();
    nativeModule.compile();

    return nativeModule.exports;
    }

    return loaderExports;
```
NativeModule模块。这个模块其实就是我们用在Node.js中的```module```定义了，可以看见，里面的```this.exports```.我们往下看，终于见到了我们的老朋友```require```，所以在我们一开始调用```node hello.js```时的require是在这里被创建的，也就是Node.js启动的时候。而require之后的结果，永远是```被编译过后的eports对象```.

在最后，导出这个loader，还给c++层，然后将loader和process，传递给```bootstrap/node.js```.

# bootstrap/node.js

```js
(function bootstrapNodeJSCore(process, { internalBinding, NativeModule }){
      NativeModule.require('internal/process/warning').setup();
    NativeModule.require('internal/process/next_tick').setup();
    NativeModule.require('internal/process/stdio').setup();
    //.....
    evalScript(xxx)//执行我们的代码
}
```
```bootstrapNodeJSCore```就是我们的启动函数了，这个脚本跑完，所有的同步代码会被执行完毕我，我们看到这里传递进来了```process```和我们需要的第一个```NativeModule```

在这段函数中，其实做的就是初始化，比如加载console,记载next_tick等等...我们用户指定的代码由```evalScript``进行调用
```js
  function evalScript(name) {
    const CJSModule = NativeModule.require('internal/modules/cjs/loader');
    const path = NativeModule.require('path');
    const cwd = tryGetCwd(path);

    const module = new CJSModule(name);
    module.filename = path.join(cwd, name);
    module.paths = CJSModule._nodeModulePaths(cwd);
    const body = wrapForBreakOnFirstLine(process._eval);
    const script = `global.__filename = ${JSON.stringify(name)};\n` +
                   'global.exports = exports;\n' +
                   'global.module = module;\n' +
                   'global.__dirname = __dirname;\n' +
                   'global.require = require;\n' +
                   'return require("vm").runInThisContext(' +
                   `${JSON.stringify(body)}, { filename: ` +
                   `${JSON.stringify(name)}, displayErrors: true });\n`;
    const result = module._compile(script, `${name}-wrapper`);
    if (process._print_eval) console.log(result);
    // Handle any nextTicks added in the first tick of the program.
    process._tickCallback();
  }
```
至此，我们揭开了所有谜团，在v8编译这段代码运行的时候，就会被```evalScript```，以字符串拼接的方式，将我们的代码拼接到这里，然后使用```vm.runInThisContext()```的办法去跑我们的code，那么我们的第一次跑就会执行了。在这里值得注意的是，在初始化的时候就会调用，```_tickCallback```方法。


# 从头梳理

- node.js启动的时候，会从c++层面先启动，然后走到bootstrap里面初始化
- 流程是```初始化global对象```->```加载编译内置模块(process,c++等等)```->```运行用户指定脚本```->跑一次```nextTick```->进入事件循环

本章内容最好和之前的一起看
1. [模块化js层：实现一个简单模块加载](https://215566435.github.io/Fz-node/#/home)
2. [模块化js层2：模块加载之谜](https://215566435.github.io/Fz-node/#/home)
