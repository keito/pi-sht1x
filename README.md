pi-sht1x
========

Node.js library for the SHT1x (SHT10, SHT11, SHT15) family of humidity/temperature sensors on Raspberry Pi.

The sensor is sold as a soil temperature/moisture sensor at many popular electronics outlets.

Simple example:

```JavaScript
var async = require('async');
var SHT1x = require('pi-sht1x');

async.series([
  SHT1x.init,
  SHT1x.reset,
  function(callback) {
    SHT1x.getSensorValues(function(error, values) {
      console.log(values);
      callback(error);
    });
  }
], function(error) {
  SHT1x.shutdown();
  if (error) {
    console.error(error);
  }
});
```
