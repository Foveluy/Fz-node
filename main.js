const http = require('http') //同步任务
const port = 3000 //同步任务
http
.createServer()
.listen(port, () => console.log('我是第一轮事件循环')) //同步任务中的异步请求
console.log('准备进入循环')
