pi-sht1x
========

Node.js library for the SHT1x (SHT10, SHT11, SHT15) family of humidity/temperature sensors for Raspberry Pi, based on [John Burns' C library](http://www.john.geek.nz/2012/08/reading-data-from-a-sensirion-sht1x-with-a-raspberry-pi/).

The sensor is sold as a soil temperature/moisture sensor at many popular electronics outlets.

This library assumes that your sensor pins are hooked up as follows:

| SHT1x Pin | Connected to
| --------- | -------------------------
| GND       | Ground (Pin 6)
| DATA      | 3V3 Power (Pin 1) via 10k pullup resistor AND GPIO 24 (Pin 18)
| SCK       | GPIO 23 (Pin 16)
| VCC       | 3V3 Power (Pin 1)

If your `DATA` and `SCK` pins are hooked up to different GPIO ports, you can modify that atop `SHT1x.js`. Note that the `pi-gpio` library uses physical pin numbers to refer to the GPIO ports, and not the Broadcom chip pin numbers. For more information, see http://elinux.org/RPi_Low-level_peripherals.

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

The example above, when run, will output the current temperature, relative humidity, and dewpoint:

```
{ temperature: 21.210000000000008,
  humidity: 50.90574136050001,
  dewpoint: 10.637735199001309 }
```
