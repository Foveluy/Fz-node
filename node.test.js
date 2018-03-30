setImmediate(()=>{
    console.log('setImmediate')
})

process.nextTick(()=>{
    console.log('nextTick')
})