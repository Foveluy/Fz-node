const fs = require('fs')

fs.readFile('./fz.js',()=>{
    console.log('啊？')
    process.nextTick(() => console.log(3))
})






