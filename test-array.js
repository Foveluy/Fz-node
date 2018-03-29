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

var list = new NextTickQueue()

const start = Date.now()

for (let i = 0; i < 1000000; i++) {
    list.push({ hello: 'world' })
}
list.clear()

const end = Date.now()

console.log('使用构造函数的array:', end - start)

var planlist = []

const pstart = Date.now()

for (let i = 0; i < 1000000; i++) {
    planlist.push({ hello: 'world' })
}

planlist = []
const pend = Date.now()

console.log('普通array:', pend - pstart)
