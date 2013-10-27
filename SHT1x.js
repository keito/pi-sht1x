"use strict";

/**
 * Raspberry Pi SHT1x Communication Library for Node.js
 * Author:  Keito Uchiyama (keito.me)
 * Date:    October 2013
 * License: CC BY-SA v3.0 - http://creativecommons.org/licenses/by-sa/3.0/
 *
 * This work is based on the C library by John Burns:
 * Raspberry Pi SHT1x communication library.
 * By:      John Burns (www.john.geek.nz)
 * Date:    01 November 2012
 * License: CC BY-SA v3.0 - http://creativecommons.org/licenses/by-sa/3.0/
 */

var async = require('async');  // https://npmjs.org/package/async
var gpio = require('pi-gpio'); // https://npmjs.org/package/pi-gpio
var sleep = require('sleep');  // https://npmjs.org/package/sleep

// Set these to the physical Raspberry Pi pin numbers to which your SHT1x pins
// are connected.
var PIN_SCK  = 16; // GPIO 23
var PIN_DATA = 18; // GPIO 24

var BYTE_RESET = 0x1E;

// Coefficients per the datasheet
var C1 = -2.0468;
var C2 = 0.0367;
var C3 = -0.0000015955;
var T1 = 0.01;
var T2 = 0.00008;
var D1 = -39.66;
var D2 = 0.01;

// Global value containing the current checksum value
var CRCValue = 0;

var SHT1x = {

  /**
   * Initializes transmissions for the first time.
   */
  init: function(callback) {
    async.series([
      LongWait,
      SCKOutput,
      SCKLow,
      DataOutput,
      DataLow
    ], callback);
  },

  /**
   * Resets transmissions with the sensor.
   */
  reset: function(callback) {
    var sequence = [
      DataHigh, Wait
    ];
    for (var ii = 0; ii < 9; ii++) {
      sequence.push(
        SCKHigh, Wait,
        SCKLow,  Wait
      );
    }
    sequence.push(
      SHT1x._transmissionStart,
      function(callback) {
        SHT1x._sendByte(BYTE_RESET, callback);
      }
    );
    async.series(sequence, callback);
  },

  /**
   * Calls the transmission start sequence.
   */
  _transmissionStart: function(callback) {
    async.series([
      SCKHigh,  Wait,
      DataLow,  Wait,
      SCKLow,   Wait,
      SCKHigh,  Wait,
      DataHigh, Wait,
      SCKLow,   Wait
    ], function(error) {
      CRCValue = 0;
      callback(error);
    });
  },

  /**
   * Sends a byte to the sensor.
   */
  _sendByte: function(value, callback) {
    var sequence = [];
    for (var mask = 0x80; mask; mask >>= 1) {
      sequence.push(
        SCKLow, Wait,
        (value & mask) ? DataHigh : DataLow, Wait,
        SCKHigh, Wait
      );
    }
    sequence.push(
      SCKLow, Wait,

      // Release DATA line
      DataHigh, Wait,
      SCKHigh, Wait
    );

    async.series(sequence, function(error) {
      if (error) {
        callback(error);
        return;
      }
      DataRead(function(error, dataValue) {
        if (error) {
          callback(error);
          return;
        }
        if (dataValue) {
          callback("Send byte not acked");
          return;
        };
        SHT1x._mutateCRC(value);

        async.series([SCKLow, Wait], callback);
      });
    });
  },

  /**
   * Reads a byte from the sensor.
   *
   * @param {bool} sendACK Whether to send an ACK
   * @param {function} callback function(error, value)
   */
  _readByte: function(sendACK, callback) {
    var value = 0;
    var sequence = [];

    for (var mask = 0x80; mask; mask >>= 1) {
      sequence.push(
        SCKHigh, Wait,
        function(mask, callback) {
          DataRead(function(mask, error, dataValue) {
            if (error) {
              callback(error);
              return;
            }
            if (dataValue != 0) {
              value |= mask;
            }
            callback();
          }.bind(undefined, mask));
        }.bind(undefined, mask),
        SCKLow, Wait // Tell sensor to give us more data
      );
    }

    if (sendACK) {
      sequence.push(DataLow, Wait);
    }
    sequence.push(
      SCKHigh, Wait,
      SCKLow, Wait
    );
    if (sendACK) {
      sequence.push(DataHigh, Wait);
    }
    async.series(sequence, function(error) {
      callback(error, value);
    });
  },

  /**
   * Tells the sensor to start a particular type of measurement.
   */
  _startMeasurement: function(type, callback) {
    async.series([
      SHT1x._transmissionStart,
      function(callback) {
        SHT1x._sendByte(type, callback);
      }
    ], callback);
  },

  /**
   * Get a value currently stored in the sensor.
   *
   * @param {function} callback function(error, value)
   */
  _getValue: function(callback) {
    // Wait for measurement to complete (timeout after 250 ms = 210 ms + 15%)
    var continueWaiting = true;
    var delayCount = 62;
    async.whilst(
      function () { return continueWaiting; },
      function(callback) {
        DataRead(function(error, dataValue) {
          if (error) {
            callback(error);
            return;
          }
          // DATA pin will get low once we have data
          if (!dataValue) {
            continueWaiting = false;
          }

          delayCount = delayCount - 1;
          if (delayCount === 0) {
            continueWaiting = false;
            callback("Timed out waiting for data");
          }

          // Wait
          sleep.usleep(5000);
          callback();
        });
      },
      function(error) {
        if (error) {
          callback(error);
          return;
        }
        // A value is available for us
        var composedValue = 0;
        async.series([
          function(callback) {
            // Read High Byte
            SHT1x._readByte(true, function(error, dataValue) {
              composedValue = dataValue << 8;
              SHT1x._mutateCRC(dataValue);
              callback(error);
            });
          },
          function(callback) {
            // Read Low Byte
            SHT1x._readByte(true, function(error, dataValue) {
              composedValue += dataValue;
              SHT1x._mutateCRC(dataValue);
              callback(error);
            });
          },
          function(callback) {
            // Read checksum
            SHT1x._readByte(false, function(error, dataValue) {
              if (error) {
                callback(error);
              } else if (CRCValue !== mirrorByte(dataValue)) {
                callback('Checksum does not match');
              } else {
                callback();
              }
            });
          }
        ], function(error) {
          callback(error, composedValue);
        });
      }
    );
  },

  /**
   * Measures and retrieves a single sensor value.
   */
  _getSensorValue: function(type, valueCallback) {
    var rawValue;
    async.series([
      function(callback) {
        SHT1x._startMeasurement(type, callback);
      },
      function(callback) {
        SHT1x._getValue(function(error, value) {
          if (error) {
            callback(error);
            return;
          }
          rawValue = value;
          callback();
        });
      }
    ], function(error) {
      valueCallback(error, rawValue);
    });
  },

  /**
   * Measures and retrieves the main sensor values (temperature, relative
   * humidity, and estimated dewpoint) as a handy object.
   *
   * @param {function} valuesCallback function(error, object)
   */
  getSensorValues: function(valuesCallback) {
    var rawTemp, rawHumidity;
    async.series([
      function(callback) {
        SHT1x._getSensorValue(SHT1x.TYPE_TEMPERATURE, function(error, value) {
          rawTemp = value;
          callback(error);
        });
      },
      function(callback) {
        SHT1x._getSensorValue(SHT1x.TYPE_HUMIDITY, function(error, value) {
          rawHumidity = value;
          callback(error);
        });
      }
    ], function(error) {
      valuesCallback(error, calculateValues(rawTemp, rawHumidity));
    });
  },

  /**
   * Closes the pins that we opened.
   */
  shutdown: function(callback) {
    gpio.close(PIN_SCK);
    gpio.close(PIN_DATA);
    callback && callback();
  },

  _mutateCRC: function(value) {
    for (var ii = 8; ii; ii--) {
      if ((CRCValue ^ value) & 0x80) {
        CRCValue <<= 1;
        CRCValue ^= 0x31;
      } else {
        CRCValue <<= 1;
      }
      value <<= 1;
    }
    CRCValue &= 0xFF;
  }
}

SHT1x.TYPE_TEMPERATURE = 0x03;
SHT1x.TYPE_HUMIDITY = 0x05;

module.exports = SHT1x;

function SCKOutput(callback) {
  gpio.open(PIN_SCK, "output", callback);
}

function SCKLow(callback) {
  gpio.write(PIN_SCK, 0, callback);
}

function SCKHigh(callback) {
  gpio.write(PIN_SCK, 1, callback);
}

function DataOutput(callback) {
  gpio.open(PIN_DATA, "output", callback);
}

function DataLow(callback) {
  gpio.setDirection(PIN_DATA, "output", callback);

  /*
  gpio.write(PIN_DATA, 0, function(error) {
    if (error) {
      callback(error);
      return;
    }
    gpio.setDirection(PIN_DATA, "output", callback);
  });
  */
}

function DataHigh(callback) {
  gpio.setDirection(PIN_DATA, "input", callback);
}

function DataRead(callback) {
  gpio.read(PIN_DATA, callback);
}

function Wait(callback) {
  sleep.usleep(2);
  callback();
}

function LongWait(callback) {
  sleep.usleep(20000); // 20 ms
  callback();
}

function calculateValues(rawTemp, rawHumidity) {
  // Temperature in Celcius
  var trueTemp = D1 + (D2 * rawTemp);
  // Humidity
  var rhLinear = C1 + (C2 * rawHumidity) + (C3 * rawHumidity * rawHumidity);
  // Humidity compensated for temperature
  var trueHumidity = (trueTemp - 25) * (T1 + (T2 * rawHumidity)) + rhLinear;
  trueHumidity = Math.max(Math.min(trueHumidity, 100), 0.1);
  return {
    temperature: trueTemp,
    humidity: trueHumidity,
    dewpoint: calculateDewpoint(trueTemp, trueHumidity)
  };
}

function calculateDewpoint(temp, humidity) {
  var Tn = 243.12;
  var m = 17.62;
  if (temp < 0) {
    Tn = 272.62;
    m = 22.46;
  }
  var lnRH = Math.log(humidity / 100);
  var mTTnT = (m * temp) / (Tn + temp);
  return Tn * ((lnRH + mTTnT) / (m - lnRH - mTTnT));
}

function mirrorByte(value) {
  var ret = 0;
  for (var ii = 0x80; ii; ii >>= 1) {
    if (value & 0x01) {
      ret |= ii;
    }
    value >>= 1;
  }
  return ret;
}
