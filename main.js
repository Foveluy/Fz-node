const EventEmitter = require('events');

let emitter = new EventEmitter();

emitter.on('myEvent', function sth () {
    console.log('进来')
//   emitter.on('myEvent', sth);
  console.log('hi');
});

emitter.emit('myEvent');