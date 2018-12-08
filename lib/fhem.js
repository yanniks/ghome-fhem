'use strict';

var util = require('util');
var events = require('events');

var version = require('./version');

var Characteristic = {};

module.exports = {
    FHEM: FHEM
};

function FHEM(log, config, api) {
    events.EventEmitter.call(this);

    this.log = log;
    this.config = config;

    if (api) {
        this.api = api;

        //this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
    }

    this.server = config['server'];
    this.port = config['port'];
    this.filter = config['filter'];
    this.jsFunctions = config['jsFunctions'];

    if (this.jsFunctions !== undefined) {
        try {
            var path = this.jsFunctions;
            if (path.substr(0, 1) != '/')
                path = User.storagePath() + '/' + this.jsFunctions;
            this.jsFunctions = require(path);
        } catch (err) {
            log.error('  jsFunctions: ' + err);
            delete this.jsFunctions;
        }
    }

    var base_url = 'http://';
    if (config.ssl) {
        if (typeof config.ssl !== 'boolean') {
            this.log.error('config: value for ssl has to be boolean.');
            process.exit(0);
        }
        base_url = 'https://';
    }
    base_url += this.server + ':' + this.port;

    if (config.webname) {
        base_url += '/' + config.webname;
    } else {
        base_url += '/fhem';
    }

    var request = require('request');
    var auth = config['auth'];
    if (auth) {
        if (auth.sendImmediately === undefined)
            auth.sendImmediately = false;

        request = request.defaults({auth: auth, rejectUnauthorized: false});
    }

    this.connection = {base_url: base_url, request: request, log: log, fhem: this};


    FHEM_startLongpoll(this.connection);
}

util.inherits(FHEM, events.EventEmitter);

// subscriptions to fhem longpoll evens
var FHEM_subscriptions = {};

function
FHEM_subscribe(accessory, informId, characteristic) {
    if (!FHEM_subscriptions[informId])
        FHEM_subscriptions[informId] = [];

    FHEM_subscriptions[informId].push({accessory: accessory, characteristic: characteristic});
}

function
FHEM_unsubscribe(accessory, informId, characteristic) {
    var subscriptions = FHEM_subscriptions[informId];
    if (subscriptions) {
        for (var i = 0; i < subscriptions.length; ++i) {
            var subscription = subscriptions[i];
            if (subscription.accessory !== accessory)
                continue;

            if (subscription.characteristic !== characteristic)
                continue;

            delete subscriptions[i];
        }

        FHEM_subscriptions[informId] = subscriptions.filter(function (n) {
            return n !== undefined
        });
        if (!FHEM_subscriptions[informId].length)
            delete FHEM_subscriptions[informId];
    }
}


function
FHEM_isPublished(device) {
    for (var inform_id in FHEM_subscriptions) {
        for (var subscription of FHEM_subscriptions[inform_id]) {
            var accessory = subscription.accessory;

            if (accessory.device === device)
                return accessory;
        }
    }

    return null;
}

var tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds

var FHEM_cached = {};
FHEM.prototype.cached = function (informId) {
    return FHEM_cached[informId];
}

FHEM.prototype.cached2Format = function (mapping) {
    var val = FHEM_cached[mapping.informId];
    return FHEM_reading2homekit(mapping, val);
}

function
FHEM_update(informId, orig, no_update) {
    if (orig === undefined
        || FHEM_cached[informId] === orig)
        return;

    FHEM_cached[informId] = orig;
    //FHEM_cached[informId] = { orig: orig, timestamp: Date.now() };
    var date = new Date(Date.now() - tzoffset).toISOString().replace(/T/, ' ').replace(/\..+/, '');
    console.log('  ' + date + ' caching: ' + informId + ': ' + orig);

    var subscriptions = FHEM_subscriptions[informId];
    if (subscriptions)
        subscriptions.forEach(function (subscription) {
            if (subscription.characteristic === undefined)
                return;

            var mapping = subscription.characteristic.FHEM_mapping;
            if (typeof mapping.characteristic !== 'object')
                return;

            var value = FHEM_reading2homekit(mapping, orig);
            if (value === undefined)
                return;

            //if( !no_update )
            //mapping.characteristic.setValue(value, undefined, 'fromFHEM');
        });
}

FHEM.prototype.reading2homekit = function (mapping, orig) {
    return FHEM_reading2homekit(mapping, orig);
}

function
FHEM_reading2homekit(mapping, orig) {
    var value = undefined;
    if (typeof mapping.reading2homekit === 'function') {

        try {
            value = mapping.reading2homekit(orig);
        } catch (err) {
            mapping.log.error(mapping.informId + ' reading2homekit: ' + err);
            return undefined;
        }
        if (typeof value === 'number' && isNaN(value)) {
            mapping.log.error(mapping.informId + ' not a number: ' + orig);
            return undefined;
        }

    } else {
        value = FHEM_reading2homekit_(mapping, orig);

    }

    if (value === undefined) {
        if (mapping.default !== undefined) {
            orig = 'mapping.default';
            value = mapping.default;
        } else
            return undefined;

    }

    if (0 && typeof value === 'string') { //FIXME: activate this ?
        if (Characteristic[mapping.characteristic_type] && Characteristic[mapping.characteristic_type][value] !== undefined) {
            if (mapping.homekit2name === undefined) mapping.homekit2name = {};
            mapping.homekit2name[Characteristic[mapping.characteristic_type][value]] = value;
            value = Characteristic[mapping.characteristic_type][value];
        }
    }

    var defined = undefined;
    if (mapping.homekit2name !== undefined) {
        defined = mapping.homekit2name[value];
        if (defined === undefined)
            defined = '???';
    }

    mapping.log.info('    caching: ' + (mapping.name ? 'Custom ' + mapping.name : mapping.characteristic_type) + (mapping.subtype ? ':' + mapping.subtype : '') + ': '
        + value + ' (' + 'as ' + typeof(value) + (defined ? '; means ' + defined : '') + '; from \'' + orig + '\')');
    mapping.cached = value;

    return value;
}

function
FHEM_reading2homekit_(mapping, orig) {
    var value = orig;
    if (value === undefined)
        return undefined;
    var reading = mapping.reading;

    if (reading == 'temperature'
        || reading == 'measured'
        || reading == 'measured-temp'
        || reading == 'desired-temp'
        || reading == 'desired'
        || reading == 'desiredTemperature') {
        if (value == 'on')
            value = 31.0;
        else if (value == 'off')
            value = 4.0;
        else
            value = parseFloat(value);

        if (mapping.minValue !== undefined && value < mapping.minValue)
            value = mapping.minValue;
        else if (mapping.maxValue !== undefined && value > mapping.maxValue)
            value = mapping.maxValue;

        if (mapping.minStep) {
            if (mapping.minValue)
                value -= mapping.minValue;
            value = parseFloat((Math.round(value / mapping.minStep) * mapping.minStep).toFixed(1));
            if (mapping.minValue)
                value += mapping.minValue;
        }

    } else if (reading == 'humidity') {
        value = parseInt(value);

    } else if (reading == 'onoff') {
        value = parseInt(value) ? true : false;

    } else if (reading == 'pct') {
        value = parseInt(value);

    } else if (reading == 'reachable') {
        value = parseInt(value);
        //value = parseInt( value ) == true;

    } else if (reading === 'state' && ( mapping.On
            && typeof mapping.values !== 'object'
            && mapping.reading2homekit === undefined
            && mapping.valueOn === undefined && mapping.valueOff === undefined)) {
        if (value.match(/^set-/))
            return undefined;
        if (value.match(/^set_/))
            return undefined;

        if (mapping.event_map !== undefined) {
            var mapped = mapping.event_map[value];
            if (mapped !== undefined)
                value = mapped;
        }

        if (value == 'off')
            value = 0;
        else if (value == '000000')
            value = 0;
        else if (value.match(/^[A-D]0$/))
            value = 0;
        else
            value = 1;

    } else {
        if (value.match(/^set-/))
            return undefined;
        else if (value.match(/^set_/))
            return undefined;

        var orig = value;

        var format = undefined;
        if (typeof mapping.characteristic === 'object')
            format = mapping.characteristic.props.format;
        else if (typeof mapping.characteristic === 'function') {
            var characteristic = new (Function.prototype.bind.apply(mapping.characteristic, arguments));

            format = characteristic.props.format;

            //delete characteristic;
        } else if (mapping.format) { // only for testing !
            format = mapping.format;

        }

        //if (format === undefined)
        //    return value;

        if (mapping.event_map !== undefined) {
            var mapped = mapping.event_map[value];
            if (mapped !== undefined) {
                mapping.log.debug(mapping.informId + ' eventMap: value ' + value + ' mapped to: ' + mapped);
                value = mapped;
            }
        }

        if (value !== undefined && mapping.part !== undefined) {
            var mapped = value.split(' ')[mapping.part];

            if (mapped === undefined) {
                mapping.log.error(mapping.informId + ' value ' + value + ' has no part ' + mapping.part);
                return value;
            }
            mapping.log.debug(mapping.informId + ' parts: using part ' + mapping.part + ' of: ' + value + ' results in: ' + mapped);
            value = mapped;
        }

        if (mapping.threshold) {
            //if( !format.match( /bool/i ) && mapping.threshold ) {
            var mapped;
            if (parseFloat(value) > mapping.threshold)
                mapped = 1;
            else
                mapped = 0;
            mapping.log.debug(mapping.informId + ' threshold: value ' + value + ' mapped to ' + mapped);
            value = mapped;
        }

        if (typeof mapping.value2homekit_re === 'object' || typeof mapping.value2homekit === 'object') {
            var mapped = undefined;
            if (typeof mapping.value2homekit_re === 'object')
                for (var entry of mapping.value2homekit_re) {
                    if (value.match(entry.re)) {
                        mapped = entry.to;
                        break;
                    }
                }

            if (mapped === '#')
                mapped = value;

            if (typeof mapping.value2homekit === 'object')
                if (mapping.value2homekit[value] !== undefined)
                    mapped = mapping.value2homekit[value];

            if (mapped === undefined)
                mapped = mapping.default;

            if (mapped === undefined) {
                mapping.log.error(mapping.informId + ' value ' + value + ' not handled in values');
                return undefined;
            }

            mapping.log.debug(mapping.informId + ' values: value ' + value + ' mapped to ' + mapped);
            value = mapped;
        }

        if (!format) {
            mapping.log.error(mapping.informId + ' empty format');
        } else if (format.match(/bool/i)) {
            var mapped = undefined;
            ;
            if (mapping.valueOn !== undefined) {
                var match = mapping.valueOn.match('^/(.*)/$');
                if (!match && value == mapping.valueOn)
                    mapped = 1;
                else if (match && value.toString().match(match[1]))
                    mapped = 1;
                else
                    mapped = 0;
            }
            if (mapping.valueOff !== undefined) {
                var match = mapping.valueOff.match('^/(.*)/$');
                if (!match && value == mapping.valueOff)
                    mapped = 0;
                else if (match && value.toString().match(match[1]))
                    mapped = 0;
                else if (mapped === undefined)
                    mapped = 1;
            }
            if (mapping.valueOn === undefined && mapping.valueOff === undefined) {
                if (value == 'on')
                    mapped = 1;
                else if (value == 'off')
                    mapped = 0;
                else
                    mapped = parseInt(value) ? 1 : 0;
            }
            if (mapped !== undefined) {
                mapping.log.debug(mapping.informId + ' valueOn/valueOff: value ' + value + ' mapped to ' + mapped);
                value = mapped;
            }

            if (mapping.factor) {
                mapping.log.debug(mapping.informId + ' factor: value ' + value + ' mapped to ' + value * mapping.factor);
                value *= mapping.factor;
            }

            if (mapping.invert) {
                mapping.minValue = 0;
                mapping.maxValue = 1;
            }

        } else if (format.match(/float/i)) {
            var mapped = parseFloat(value);

            if (typeof mapped !== 'number') {
                mapping.log.error(mapping.informId + ' is not a number: ' + value);
                return undefined;
            }
            value = mapped;

            if (mapping.factor) {
                mapping.log.debug(mapping.informId + ' factor: value ' + value + ' mapped to ' + value * mapping.factor);
                value *= mapping.factor;
            }

        } else if (format.match(/int/i)) {
            var mapped = parseFloat(value);

            if (typeof mapped !== 'number') {
                mapping.log.error(mapping.informId + ' not a number: ' + value);
                return undefined;
            }
            value = mapped;

            if (mapping.factor) {
                mapping.log.debug(mapping.informId + ' factor: value ' + value + ' mapped to ' + value * mapping.factor);
                value *= mapping.factor;
            }

            value = parseInt(value + 0.5);
        } else if (format.match(/string/i)) {
        }


        if (mapping.max && mapping.maxValue) {
            value = Math.round((value * mapping.maxValue / mapping.max)*100)/100;
            mapping.log.debug(mapping.informId + ' value ' + orig + ' scaled to: ' + value);
        }

        if (mapping.minValue !== undefined && value < mapping.minValue) {
            mapping.log.debug(mapping.informId + ' value ' + value + ' clipped to minValue: ' + mapping.minValue);
            value = mapping.minValue;
        } else if (mapping.maxValue !== undefined && value > mapping.maxValue) {
            mapping.log.debug(mapping.informId + ' value ' + value + ' clipped to maxValue: ' + mapping.maxValue);
            value = mapping.maxValue;
        }

        if (mapping.minStep) {
            if (mapping.minValue)
                value -= mapping.minValue;
            value = parseFloat((Math.round(value / mapping.minStep) * mapping.minStep).toFixed(1));
            if (mapping.minValue)
                value += mapping.minValue;
        }

        if (format && format.match(/int/i))
            value = parseInt(value);
        else if (format && format.match(/float/i))
            value = parseFloat(value);

        if (typeof value === 'number') {
            var mapped = value;
            if (isNaN(value)) {
                mapping.log.error(mapping.informId + ' not a number: ' + orig);
                return undefined;
            } else if (mapping.invert && mapping.minValue !== undefined && mapping.maxValue !== undefined) {
                mapped = mapping.maxValue - value + mapping.minValue;
            } else if (mapping.invert && mapping.maxValue !== undefined) {
                mapped = mapping.maxValue - value;
            } else if (mapping.invert) {
                mapped = 100 - value;
            }

            if (value !== mapped)
                mapping.log.debug(mapping.informId + ' value: ' + value + ' inverted to ' + mapped);
            value = mapped;
        }
        if (format && format.match(/bool/i)) {
            value = parseInt(value) ? true : false;
        }
    }

    return (value);
}


var FHEM_longpoll = {};
var FHEM_csrfToken = {};

//FIXME: add filter
function FHEM_startLongpoll(connection) {
    if (!FHEM_longpoll[connection.base_url]) {
        FHEM_longpoll[connection.base_url] = {};
        FHEM_longpoll[connection.base_url].connects = 0;
        FHEM_longpoll[connection.base_url].disconnects = 0;
        FHEM_longpoll[connection.base_url].received_total = 0;
    }
 
    if (FHEM_longpoll[connection.base_url].connected)
        return;
    FHEM_longpoll[connection.base_url].connects++;
    FHEM_longpoll[connection.base_url].received = 0;
    FHEM_longpoll[connection.base_url].connected = true;


    var filter = '.*';
    var since = 'null';
    if (FHEM_longpoll[connection.base_url].last_event_time)
        since = FHEM_longpoll[connection.base_url].last_event_time / 1000;
    var query = '?XHR=1'
        + '&inform=type=status;addglobal=1;filter=' + filter + ';since=' + since + ';fmt=JSON'
        + '&timestamp=' + Date.now();

    var url = encodeURI(connection.base_url + query);
    connection.log('starting longpoll: ' + url);

    var FHEM_longpollOffset = 0;
    var input = '';
    connection.request.get({url: url}).on('data', function (data) {
//console.log( 'data: ' + data );
        if (!data)
            return;

        var length = data.length;
        FHEM_longpoll[connection.base_url].received += length;
        FHEM_longpoll[connection.base_url].received_total += length;

        input += data;

        try {
            var lastEventTime = Date.now();
            for (; ;) {
                var nOff = input.indexOf('\n', FHEM_longpollOffset);
                if (nOff < 0)
                    break;
                var l = input.substr(FHEM_longpollOffset, nOff - FHEM_longpollOffset);
                FHEM_longpollOffset = nOff + 1;
//console.log( 'Rcvd: ' + (l.length>132 ? l.substring(0,132)+'...('+l.length+')':l) );

                if (!l.length)
                    continue;

                var d;
                if (l.substr(0, 1) == '[') {
                    try {
                        d = JSON.parse(l);
                    } catch (err) {
                        connection.log('  longpoll JSON.parse: ' + err);
                        continue;
                    }
                } else
                    d = l.split('<<', 3);
//console.log(d);

                if (d[0].match(/-ts$/))
                    continue;
                if (d[0].match(/^#FHEMWEB:/))
                    continue;

                var match = d[0].match(/([^-]*)-(.*)/);
                if (!match)
                    continue;
                var device = match[1];
                var reading = match[2];
//console.log( 'device: ' + device );
//console.log( 'reading: ' + reading );
                if (reading === undefined)
                    continue;

                var value = d[1];
//console.log( 'value: ' + value );
                if (value.match(/^set-/))
                    continue;

                var subscriptions = FHEM_subscriptions[d[0]];
                if (subscriptions) {
                    FHEM_update(d[0], value);
                    FHEM_longpoll[connection.base_url].last_event_time = lastEventTime;

                    subscriptions.forEach(function (subscription) {
                        var accessory = subscription.accessory;

                        if (accessory.mappings.colormode) {
                            if (reading == 'xy') {
                                var xy = value.split(',');
                                var rgb = FHEM_xyY2rgb(xy[0], xy[1], 1);
                                var hsv = FHEM_rgb2hsv(rgb);

                                FHEM_update(device + '-h', hsv[0]);
                                FHEM_update(device + '-s', hsv[1]);
                                FHEM_update(device + '-v', hsv[2]);

                                FHEM_update(device + '-' + reading, value, false);

                                return;

                            } else if (reading === 'ct') {
                                var rgb = FHEM_ct2rgb(value);
                                var hsv = FHEM_rgb2hsv(rgb);

                                FHEM_update(device + '-h', hsv[0]);
                                FHEM_update(device + '-s', hsv[1]);
                                FHEM_update(device + '-v', hsv[2]);

                                FHEM_update(device + '-' + reading, value, false);

                                return;
                            }

                        }
                    });

                }
            }

        } catch (err) {
            connection.log.error('  error in longpoll connection: ' + err);

        }

        input = input.substr(FHEM_longpollOffset);
        FHEM_longpollOffset = 0;

        FHEM_longpoll[connection.base_url].disconnects = 0;

    }).on('response', function (response) {
        if (response.headers && response.headers['x-fhem-csrftoken'])
            FHEM_csrfToken[connection.base_url] = response.headers['x-fhem-csrftoken'];
        else
            FHEM_csrfToken[connection.base_url] = '';

        connection.fhem.checkAndSetGenericDeviceType();

        connection.fhem.emit('LONGPOLL STARTED');

    }).on('end', function () {
        FHEM_longpoll[connection.base_url].connected = false;

        FHEM_longpoll[connection.base_url].disconnects++;
        var timeout = 500 * FHEM_longpoll[connection.base_url].disconnects - 300;
        if (timeout > 30000) timeout = 30000;

        connection.log('longpoll ended, reconnect in: ' + timeout + 'msec');
        setTimeout(function () {
            FHEM_startLongpoll(connection)
        }, timeout);

    }).on('error', function (err) {
        FHEM_longpoll[connection.base_url].connected = false;

        FHEM_longpoll[connection.base_url].disconnects++;
        var timeout = 5000 * FHEM_longpoll[connection.base_url].disconnects;
        if (timeout > 30000) timeout = 30000;

        connection.log('longpoll error: ' + err + ', retry in: ' + timeout + 'msec');
        setTimeout(function () {
            FHEM_startLongpoll(connection)
        }, timeout);

    });
}


function
FHEM_sortByKey(array, key) {
    return array.sort(function (a, b) {
        const x = a[key];
        const y = b[key];
        return ((x < y) ? -1 : ((x > y) ? 1 : 0));
    });
}


FHEM.prototype.execute = function (cmd, callback) {
    if (this.ghome_device)
    //FHEM_execute(this.log, this.connection, 'setreading '+ this.ghome_device.Name +'  active 1 ' );
        FHEM_execute(this.log, this.connection, '{$defs{' + this.ghome_device.Name + '}->{"active"} = 1}');
    FHEM_execute(this.log, this.connection, cmd, callback)
    if (this.ghome_device)
    //FHEM_execute(this.log, this.connection, 'setreading '+ this.ghome_device.Name +'  active 0 ' );
        FHEM_execute(this.log, this.connection, '{$defs{' + this.ghome_device.Name + '}->{"active"} = 0}');
};

FHEM.prototype.connect = function (callback, filter) {
    //this.checkAndSetGenericDeviceType();

    if (!filter) filter = this.filter;

    this.emit('DEFINED');

    this.log.info('Fetching FHEM devices...');

    this.devices = [];

    if (FHEM_csrfToken[this.connection.base_url] === undefined) {
        setTimeout(function () {
            this.connection.fhem.connect(callback, filter);
        }.bind(this), 500);
        return;
    }

    let cmd = 'jsonlist2';
    if (filter)
        cmd += ' ' + filter;
    if (FHEM_csrfToken[this.connection.base_url])
        cmd += '&fwcsrf=' + FHEM_csrfToken[this.connection.base_url];
    const url = encodeURI(this.connection.base_url + '?cmd=' + cmd + '&XHR=1');
    this.log.info('fetching: ' + url);

    this.connection.request.get({url: url, json: true, gzip: true},
        function (err, response, json) {
            if (!err && response.statusCode === 200 && json) {
                // console.log("got json: " + util.inspect(json));
                this.log.info('got: ' + json['totalResultsReturned'] + ' results');
                if (json['totalResultsReturned']) {
                    const sArray = FHEM_sortByKey(json['Results'], 'Name');
                    sArray.map(function (s) {

                        //FIXME: change to factory pattern
                        const device = new FHEMDevice(this, s);
                        if (device) {
                            device.fhem = this.connection.fhem;
                            this.devices.push(device);
                        } else {
                            this.log.info('no device created for ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ')');
                            return undefined;
                        }

                    }.bind(this));
                    
                    //try to get the real room if no realRoom is defined
                    let roomCheck = {};
                    let nrDevices = this.devices.length;
                    this.devices.forEach(function (d) {
                        if (d.room) {
                            let roomArr = d.room.split(',');
                            roomArr.forEach(function (r) {
                                if (roomCheck[r]) {
                                    roomCheck[r] = roomCheck[r] + 1;
                                } else {
                                    roomCheck[r] = 1;
                                }
                            });
                        } else {
                            this.log.error('Please add ' + d.name + ' to a room in FHEM.');
                        }
                    }.bind(this));
                    
                    this.devices.forEach(function (d) {
                        if (d.ghomeRoom)
                            return;

                        if (!d.room)
                            return;

                        let roomFound = false;
                        let roomArr = d.room.split(',');
                        d.ghomeRoom = roomArr[0];
                        roomArr.forEach(function (r) {
                            if (roomCheck[r] < nrDevices && roomCheck[r] < roomCheck[d.ghomeRoom]) {
                                d.ghomeRoom = r;
                                roomFound = true;
                            }
                        });

                        //no room found
                        if (!roomFound)
                            d.ghomeRoom = undefined;
                    });
                }

                if (callback)
                    callback(this.devices);

            } else {
                this.log.error('There was a problem connecting to FHEM');
                if (response)
                    this.log.error('  ' + response.statusCode + ': ' + response.statusMessage);

            }

        }.bind(this));
}

FHEMDevice.prototype.subscribe = function (mapping, characteristic) {
    if (typeof mapping === 'object') {
        mapping.characteristic = characteristic;

        if (characteristic)
            characteristic.FHEM_mapping = mapping;

        FHEM_subscribe(this, mapping.informId, characteristic);

    } else {
        FHEM_subscribe(this, mapping, characteristic);

    }
}
FHEMDevice.prototype.unsubscribe = function (mapping, characteristic) {
    if (mapping === undefined) {
        for (var characteristic_type in this.mappings) {
            var mapping = this.mappings[characteristic_type];
            FHEM_unsubscribe(this, mapping.informId, characteristic);
        }

    } else if (typeof mapping === 'object') {
        mapping.characteristic = characteristic;

        if (characteristic)
            characteristic.FHEM_mapping = mapping;

        FHEM_unsubscribe(this, mapping.informId, characteristic);

    } else {
        FHEM_unsubscribe(this, mapping, characteristic);

    }
}

FHEMDevice.prototype.fromHomebridgeMapping = function (homebridgeMapping) {
    if (!homebridgeMapping)
        return;

    this.log.info('homebridgeMapping: ' + homebridgeMapping);

    if (homebridgeMapping.match(/^{.*}$/)) {
        try {
            homebridgeMapping = JSON.parse(homebridgeMapping);
        } catch (err) {
            this.log.error('  fromHomebridgeMapping JSON.parse: ' + err);
            return;
        }

        //FIXME: handle multiple identical characteristics in this.mappings and in homebridgeMapping ?
        if (1)
            this.mappings = homebridgeMapping;
        else
            for (var characteristic in homebridgeMapping) {
                if (!this.mappings[characteristic])
                    this.mappings[characteristic] = {};
                for (var attrname in homebridgeMapping[characteristic])
                    this.mappings[characteristic][attrname] = homebridgeMapping[characteristic][attrname];
            }

        return;
    }

    var seen = {};
    for (var mapping of homebridgeMapping.split(/ |\n/)) {
        if (!mapping)
            continue;

        if (mapping.match(/^#/))
            continue;

        if (mapping == 'clear') {
            this.mappings = {};
            continue;
        }

        var match = mapping.match(/(^.*?)(:|=)(.*)/);
        if (match === undefined || match.length < 4 || !match[3]) {
            this.log.error('  wrong syntax: ' + mapping);
            continue;
        }

        var characteristic = match[1];
        var params = match[3];

        var mapping;
        if (!seen[characteristic] && this.mappings[characteristic] !== undefined)
            mapping = this.mappings[characteristic];
        else {
            mapping = {};
            if (this.mappings[characteristic]) {
                if (this.mappings[characteristic].length == undefined)
                    this.mappings[characteristic] = [this.mappings[characteristic]];
                this.mappings[characteristic].push(mapping);
            } else
                this.mappings[characteristic] = mapping;
        }
        seen[characteristic] = true;

        for (var param of params.split(',')) {
            if (param == 'clear') {
                mapping = {};
                delete this.mappings[characteristic];
                continue;
            } else if (!this.mappings[characteristic])
                this.mappings[characteristic] = mapping

            var p = param.split('=');
            if (p.length == 2)
                if (p[0] == 'values')
                    mapping[p[0]] = p[1].split(';');
                else if (p[0] == 'valid')
                    mapping[p[0]] = p[1].split(';');
                else if (p[0] == 'cmds')
                    mapping[p[0]] = p[1].split(';');
                else if (p[0] == 'delay') {
                    mapping[p[0]] = parseInt(p[1]);
                    if (isNaN(mapping[p[0]])) mapping[p[0]] = true;
                } else if (p[0] === 'minValue' || p[0] === 'maxValue' || p[0] === 'minStep'
                    || p[0] === 'min' || p[0] === 'max'
                    || p[0] === 'default') {
                    mapping[p[0]] = parseFloat(p[1]);
                    if (isNaN(mapping[p[0]]))
                        mapping[p[0]] = p[1];
                } else
                    mapping[p[0]] = p[1].replace(/\+/g, ' ');

            else if (p.length == 1) {
                if (this.mappings[param] !== undefined) {
                    try {
                        mapping = Object.assign({}, this.mappings[param]);
                    } catch (err) {
                        console.log(this.mappings[param]);
                        for (var x in this.mappings[param]) {
                            mapping[x] = this.mappings[param][x]
                        }
                    }
                    this.mappings[characteristic] = mapping;

                } else if (p === 'invert') {
                    mapping[p] = 1;

                } else {
                    var p = param.split(':');

                    var reading = p[p.length - 1];
                    var device = p.length > 1 ? p[p.length - 2] : undefined;
                    var cmd = p.length > 2 ? p[p.length - 3] : undefined;

                    if (reading)
                        mapping.reading = reading;

                    if (device)
                        mapping.device = device;

                    if (cmd)
                        mapping.cmd = cmd;
                }

            } else {
                this.log.error('  wrong syntax: ' + param);

            }
        }
    }
}
FHEMDevice.prototype.prepare = function (mapping) {

    if (mapping.default !== undefined) {
        if (Characteristic[mapping.characteristic_type] && Characteristic[mapping.characteristic_type][mapping.default] !== undefined) {
            if (mapping.homekit2name === undefined) mapping.homekit2name = {};
            mapping.homekit2name[Characteristic[mapping.characteristic_type][mapping.default]] = mapping.default;
            mapping.default = Characteristic[mapping.characteristic_type][mapping.default];
        }
        this.log.debug('default: ' + mapping.default);
    }

    if (typeof mapping.values === 'object') {
        mapping.value2homekit = {};
        mapping.value2homekit_re = [];
        if (mapping.homekit2name === undefined) mapping.homekit2name = {};
        for (var entry of mapping.values) {
            var match = entry.match('^([^:]*)(:(.*))?$');
            if (!match) {
                this.log.error('values: format wrong for ' + entry);
                continue;
            }

            var from = match[1];
            var to = match[3] === undefined ? entry : match[3];
            to = to.replace(/\+/g, ' ');

            if (Characteristic[mapping.characteristic_type] && Characteristic[mapping.characteristic_type][to] !== undefined) {
                mapping.homekit2name[Characteristic[mapping.characteristic_type][to]] = to;
                to = Characteristic[mapping.characteristic_type][to];
            } else if (Characteristic[mapping.characteristic_type]) {
                for (var defined in Characteristic[mapping.characteristic_type]) {
                    if (to == Characteristic[mapping.characteristic_type][defined])
                        mapping.homekit2name[to] = defined;
                }
            }

            var match;
            if (match = from.match('^/(.*)/$'))
                mapping.value2homekit_re.push({re: match[1], to: to});
            else {
                from = from.replace(/\+/g, ' ');
                mapping.value2homekit[from] = to;
            }
        }
        if (mapping.value2homekit_re
            && mapping.value2homekit_re.length) this.log.debug('value2homekit_re: ' + util.inspect(mapping.value2homekit_re));
        if (mapping.value2homekit
            && Object.keys(mapping.value2homekit).length) this.log.debug('value2homekit: ' + util.inspect(mapping.value2homekit));
        if (mapping.homekit2name) {
            if (Object.keys(mapping.homekit2name).length)
                this.log.debug('homekit2name: ' + util.inspect(mapping.homekit2name));
            else
                delete mapping.homekit2name;
        }
    }

    if (typeof mapping.cmds === 'object') {
        mapping.homekit2cmd = {};
        mapping.homekit2cmd_re = [];
        for (var entry of mapping.cmds) {
            var match = entry.match('^([^:]*)(:(.*))?$');
            if (!match) {
                this.log.error('cmds: format wrong for ' + entry);
                continue;
            }

            var from = match[1];
            var to = match[2] !== undefined ? match[3] : match[1];
            to = to.replace(/\+/g, ' ');

            if (match = from.match('^/(.*)/$')) {
                mapping.homekit2cmd_re.push({re: match[1], to: to});
            } else {
                if (Characteristic[mapping.characteristic_type] && Characteristic[mapping.characteristic_type][from] !== undefined)
                    from = Characteristic[mapping.characteristic_type][from];
                else
                    from = from.replace(/\+/g, ' ');

                mapping.homekit2cmd[from] = to;
            }
        }
        if (mapping.homekit2cmd_re
            && mapping.homekit2cmd_re.length) this.log.debug('homekit2cmd_re: ' + util.inspect(mapping.homekit2cmd_re));
        if (mapping.homekit2cmd
            && Object.keys(mapping.homekit2cmd).length) this.log.debug('homekit2cmd: ' + util.inspect(mapping.homekit2cmd));
    }

    if (mapping.reading2homekit !== undefined && typeof mapping.reading2homekit !== 'function') {
        if (mapping.reading2homekit.match(/^{.*}$/)) {
            try {
                mapping.reading2homekit = new Function('mapping', 'orig', mapping.reading2homekit).bind(null, mapping);
            } catch (err) {
                this.log.error('  reading2homekit: ' + err);
                //delete mapping.reading2homekit;
            }
        } else if (typeof this.jsFunctions === 'object') {
            if (typeof this.jsFunctions[mapping.reading2homekit] === 'function')
                mapping.reading2homekit = this.jsFunctions[mapping.reading2homekit].bind(null, mapping);
            else
                this.log.error('  reading2homekit: no function named ' + mapping.reading2homekit + ' in ' + util.inspect(this.jsFunctions));
        }

        if (mapping.reading2homekit !== undefined && typeof mapping.reading2homekit !== 'function') {
            this.log.error('  reading2homekit disabled.');
            delete mapping.reading2homekit;
        }
    }

    if (mapping.homekit2reading !== undefined && typeof mapping.homekit2reading !== 'function') {
        if (mapping.homekit2reading.match(/^{.*}$/)) {
            try {
                mapping.homekit2reading = new Function('mapping', 'orig', mapping.homekit2reading).bind(null, mapping);
            } catch (err) {
                this.log.error('  homekit2reading: ' + err);
                //delete mapping.homekit2reading;
            }
        } else if (typeof this.jsFunctions === 'object') {
            if (typeof this.jsFunctions[mapping.homekit2reading] === 'function')
                mapping.homekit2reading = this.jsFunctions[mapping.homekit2reading].bind(null, mapping);
            else
                this.log.error('  homekit2reading: no function named ' + mapping.homekit2reading + ' in ' + util.inspect(this.jsFunctions));
        }

        if (mapping.homekit2reading !== undefined && typeof mapping.homekit2reading !== 'function') {
            this.log.error('  homekit2reading disabled.');
            delete mapping.homekit2reading;
        }
    }
};

FHEM.prototype.checkAndSetGenericDeviceType = function () {
    this.log('Checking devices and attributes...');

    var cmd = '{AttrVal("global","userattr","")}';
    this.execute(cmd,
        function (result) {
            //if( result === undefined )
            //result = '';

            if (!result.match(/(^| )homebridgeMapping\b/)) {
                this.execute('{ addToAttrList( "homebridgeMapping:textField-long" ) }');
                this.log.info('homebridgeMapping attribute created.');
            }
            
            if (!result.match(/(^| )realRoom\b/)) {
                this.execute('{ addToAttrList( "realRoom:textField" ) }');
                this.log.info('realRoom attribute created.');
            }

            if (!result.match(/(^| )genericDeviceType:security,ignore,switch,outlet,light,blind,thermometer,thermostat,contact,garage,window,lock,aircondition,airpurifier,camera,coffeemaker,dishwasher,dryer,fan,kettle,oven,refrigerator,scene,sprinkler,vacuum,washer\b/)) {
                let m;
                if (m = result.match(/(^| )genericDeviceType(\S*)/)) {
                    this.execute('{ delFromAttrList( "genericDeviceType' + m[2] + '") }');
                }
                var cmd = '{addToAttrList( "genericDeviceType:security,ignore,switch,outlet,light,blind,thermometer,thermostat,contact,garage,window,lock,aircondition,airpurifier,camera,coffeemaker,dishwasher,dryer,fan,kettle,oven,refrigerator,scene,sprinkler,vacuum,washer" ) }';
                this.execute(cmd,
                    function (result) {
                        this.log.warn('genericDeviceType attribute was not known. please restart.');
                        process.exit(0);
                    }.bind(this));
            }

        }.bind(this));
};


function
FHEM_rgb2hex(r, g, b) {
    if (g === undefined)
        return Number(0x1000000 + r[0] * 0x10000 + r[1] * 0x100 + r[2]).toString(16).substring(1);

    return Number(0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).substring(1);
}

function
FHEM_hsv2rgb(h, s, v) {
    var r = 0.0;
    var g = 0.0;
    var b = 0.0;

    if (s == 0) {
        r = v;
        g = v;
        b = v;

    } else {
        var i = Math.floor(h * 6.0);
        var f = ( h * 6.0 ) - i;
        var p = v * ( 1.0 - s );
        var q = v * ( 1.0 - s * f );
        var t = v * ( 1.0 - s * ( 1.0 - f ) );
        i = i % 6;

        if (i == 0) {
            r = v;
            g = t;
            b = p;
        } else if (i == 1) {
            r = q;
            g = v;
            b = p;
        } else if (i == 2) {
            r = p;
            g = v;
            b = t;
        } else if (i == 3) {
            r = p;
            g = q;
            b = v;
        } else if (i == 4) {
            r = t;
            g = p;
            b = v;
        } else if (i == 5) {
            r = v;
            g = p;
            b = q;
        }
    }

    return FHEM_rgb2hex(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
}

function
FHEM_ct2rgb(ct) {
    // calculation from http://www.tannerhelland.com/4435/convert-temperature-rgb-algorithm-code

    // kelvin -> mired
    if (ct > 1000)
        ct = 1000000 / ct;

    // adjusted by 1000K
    var temp = (1000000 / ct) / 100 + 10;

    var r = 0;
    var g = 0;
    var b = 0;

    r = 255;
    if (temp > 66)
        r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    if (r < 0)
        r = 0;
    if (r > 255)
        r = 255;

    if (temp <= 66)
        g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    else
        g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    if (g < 0)
        g = 0;
    if (g > 255) ;
    g = 255;

    b = 255;
    if (temp <= 19)
        b = 0;
    if (temp < 66)
        b = 138.5177312231 * log(temp - 10) - 305.0447927307;
    if (b < 0)
        b = 0;
    if (b > 255)
        b = 255;

    return FHEM_rgb2hex(Math.round(r), Math.round(g), Math.round(b));
}

function
FHEM_xyY2rgb(x, y, Y) {
    // calculation from http://www.brucelindbloom.com/index.html

    var r = 0;
    var g = 0;
    var b = 0;

    if (y > 0) {
        var X = x * Y / y;
        var Z = (1 - x - y) * Y / y;

        if (X > 1
            || Y > 1
            || Z > 1) {
            var f = Math.max(X, Y, Z);
            X /= f;
            Y /= f;
            Z /= f;
        }

        r = 0.7982 * X + 0.3389 * Y - 0.1371 * Z;
        g = -0.5918 * X + 1.5512 * Y + 0.0406 * Z;
        b = 0.0008 * X + 0.0239 * Y + 0.9753 * Z;

        if (r > 1
            || g > 1
            || b > 1) {
            var f = Math.max(r, g, b);
            r /= f;
            g /= f;
            b /= f;
        }

    }

    return FHEM_rgb2hex(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
}


function
FHEM_rgb2hsv(r, g, b) {
    if (r === undefined)
        return;

    if (g === undefined) {
        var str = r;
        r = parseInt(str.substr(0, 2), 16);
        g = parseInt(str.substr(2, 2), 16);
        b = parseInt(str.substr(4, 2), 16);

        r /= 255;
        g /= 255;
        b /= 255;
    }

    var M = Math.max(r, g, b);
    var m = Math.min(r, g, b);
    var c = M - m;

    var h, s, v;
    if (c == 0) {
        h = 0;
    } else if (M == r) {
        h = ( ( 360 + 60 * ( ( g - b ) / c ) ) % 360 ) / 360;
    } else if (M == g) {
        h = ( 60 * ( ( b - r ) / c ) + 120 ) / 360;
    } else if (M == b) {
        h = ( 60 * ( ( r - g ) / c ) + 240 ) / 360;
    }

    if (M == 0) {
        s = 0;
    } else {
        s = c / M;
    }

    v = M;

    return [h, s, v];
}


function
FHEM_execute(log, connection, cmd, callback) {
    if (FHEM_csrfToken[connection.base_url])
        cmd += '&fwcsrf=' + FHEM_csrfToken[connection.base_url];
    cmd += '&XHR=1';
    var url = encodeURI(connection.base_url + '?cmd=' + cmd);
    log.info('  executing: ' + url);

    connection.request
        .get({url: url, gzip: true},
            function (err, response, result) {
                if (!err && response.statusCode == 200) {
                    result = result.replace(/[\r\n]/g, '');
                    if (callback)
                        callback(result);

                } else {
                    log('There was a problem connecting to FHEM (' + url + ').');
                    if (response)
                        log('  ' + response.statusCode + ': ' + response.statusMessage);

                }

            })
        .on('error', function (err) {
            log('There was a problem connecting to FHEM (' + url + '):' + err);
        });
};

FHEMDevice.prototype.execute = function (cmd, callback) {
    FHEM_execute(this.log, this.connection, cmd, callback)
};

FHEMDevice.prototype.query = function (mapping, callback) {
    var device = this.device;
    var reading;

    if (typeof mapping === 'object') {
        if (mapping.device)
            device = mapping.device;
        if (mapping.reading)
            reading = mapping.reading;

    } else
        reading = mapping;

    if (reading === undefined && mapping.default === undefined) {
        if (callback !== undefined)
            callback(1);
        return;
    }

    this.log.info('query: ' + mapping.characteristic_type + ' for ' + mapping.informId);
    var value = mapping.cached;
    if (typeof mapping === 'object' && value !== undefined) {
        var defined = undefined;
        if (mapping.homekit2name !== undefined) {
            defined = mapping.homekit2name[value];
            if (defined === undefined)
                defined = '???';
        }

        mapping.log.info('  cached: ' + value + ' (as ' + typeof(value) + (defined ? '; means ' + defined : '') + ')');

        if (callback !== undefined)
            callback(undefined, value);
        return value;

    } else {
        /*this.log.info('not cached; query: ' + mapping.informId);

      var value = FHEM_cached[mapping.informId];
      value = FHEM_reading2homekit(mapping, value);

      if( value !== undefined ) {
        this.log.info('  cached: ' + value);
        if( callback !== undefined )
          callback( undefined, value );
        return value;

      } else*/
        this.log.info('  not cached');
    }

    var cmd = '{ReadingsVal("' + device + '","' + reading + '","")}';

    this.execute(cmd,
        function (result) {
            var value = result.replace(/[\r\n]/g, '');
            this.log.info('  value: ' + value);

            if (value === undefined)
                return value;

            FHEM_update(mapping.informId, value, true);

            if (callback !== undefined) {
                if (value === undefined)
                    callback(1);
                else {
                    value = FHEM_reading2homekit(mapping, value);
                    callback(undefined, value);
                }
            }

            return value;

        }.bind(this));
}

FHEMDevice.prototype.command = function (mapping, value, traitCommand) {
    var c = mapping;
    if (typeof mapping === 'object') {
        this.log.info('mapping: ' + JSON.stringify(mapping));
        c = mapping.cmd;
    } else
        this.log.info(this.name + ' sending command ' + c + ' with value ' + value);

    var command = undefined;
    if (c == 'identify') {
        if (this.type == 'HUEDevice')
            command = 'set ' + this.device + 'alert select';
        else
            command = 'set ' + this.device + ' toggle; sleep 1; set ' + this.device + ' toggle';

    } else if (c == 'xhue') {
        value = Math.round(value * this.mappings.Hue.max / this.mappings.Hue.maxValue);
        command = 'set ' + this.mappings.Hue.device + ' hue ' + value;

    } else if (c == 'xsat') {
        value = value / 100 * this.mappings.Saturation.max;
        command = 'set ' + this.mappings.Saturation.device + ' sat ' + value;

    } else {
        if (mapping.characteristic_type == 'On' && value) {
            if (this.delayed_timers && this.delayed_timers.length) {
                mapping.log.info(this.name + ': skipping set cmd for ' + mapping.characteristic_type + ' with value ' + value);
                return;
            }
        }

        mapping.log.info(this.name + ': executing set cmd for ' + mapping.characteristic_type + ' with value ' + value);

        if (typeof mapping.homekit2reading === 'function') {
            try {
                value = mapping.homekit2reading(value);
            } catch (err) {
                mapping.log.error(mapping.informId + ' homekit2reading: ' + err);
                return;
            }
            if (value === undefined) {
                mapping.log.info('  converted value is unchanged ');
                return;

            }

            mapping.log.info('  value converted to ' + value);

        } else {
            if (typeof value === 'number') {
                var mapped = value;
                if (mapping.invert && mapping.minValue !== undefined && mapping.maxValue !== undefined) {
                    mapped = mapping.maxValue - value + mapping.minValue;
                } else if (mapping.invert && mapping.maxValue !== undefined) {
                    mapped = mapping.maxValue - value;
                } else if (mapping.invert) {
                    mapped = 100 - value;
                }

                if (value !== mapped) {
                    mapping.log.debug('  value: ' + value + ' inverted to ' + mapped);
                    value = mapped;
                }

                if (mapping.factor) {
                    mapped /= mapping.factor;
                    mapping.log.debug('  value: ' + value + ' mapped to ' + mapped);
                    value = mapped;
                }


                if (mapping.max !== undefined && mapping.maxValue != undefined)
                    value = Math.round((value * mapping.max / mapping.maxValue)*100)/100;
            }

        }

        var cmd = mapping.cmd + ' ' + value;

        if (mapping.characteristic_type == 'StartStop' && traitCommand && traitCommand == 'PauseUnpause') {
            if (mapping.cmdPause !== undefined && value == 1)
                cmd = mapping.cmdPause;
            else if (mapping.cmdUnpause !== undefined && value == 0)
                cmd = mapping.cmdUnpause;
        } else {
            if (mapping.cmdOn !== undefined && value == 1)
                cmd = mapping.cmdOn
    
            else if (mapping.cmdOff !== undefined && value == 0)
                cmd = mapping.cmdOff
        
            else if (typeof mapping.homekit2cmd === 'object' && mapping.homekit2cmd[value] !== undefined)
                cmd = mapping.homekit2cmd[value];
    
            else if (typeof mapping.homekit2cmd_re === 'object') {
                for (var entry of mapping.homekit2cmd_re) {
                    if (value.toString().match(entry.re)) {
                        cmd = entry.to;
                        break;
                    }
                }
            }
        }

        if (cmd === undefined) {
            mapping.log.error(this.name + ' no cmd for ' + c + ', value ' + value);
            return;
        }

        command = 'set ' + mapping.device + ' ' + cmd;

    }

    if (command === undefined) {
        this.log.error(this.name + ' Unhandled command! cmd=' + c + ', value ' + value);
        return;
    }

    if (mapping.cmdSuffix !== undefined)
        command += ' ' + mapping.cmdSuffix;

    this.execute(command);
};

FHEMDevice.prototype.isInRoom = function (room) {
    if (!room) return false;
    if (!this.ghomeRoom) return false;
    if (this.ghomeRoom === room) return true;
    if (this.ghomeRoom.match('(^|,)(' + room + ')(,|\$)')) return true;
    return false;
}

function
FHEMDevice(platform, s) {
    let max;
    let homekit2reading;
    let mapping;
    let mappings;
    let characteristic_type;

    this.log = platform.log;
    this.connection = platform.connection;
    this.jsFunctions = platform.jsFunctions;

	  // GENERIC CHECKS
    if (FHEM_isPublished(s.Internals.NAME)) {
        this.log.warn(s.Internals.NAME + ' is already published');
        return;
    }

    if (!s.Readings) {
        this.log.error('ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without readings');
        return;
    }
    if (!s.Attributes) {
        this.log.error('ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without attributes');
        return;
    }

    if (s.Attributes.disable == 1) {
        this.log.info(s.Internals.NAME + ' is currently disabled');
    }
	
    var genericType = s.Attributes.genericDeviceType;
    if (!genericType === undefined)
        genericType = s.Attributes.genericDisplayType;

    if (genericType === 'ignore') {
        this.log.info('ignoring ' + s.Internals.NAME + ', genericDeviceType = ignore used');
        return;
    }
	
    if (s.Internals.TYPE === 'structure' && genericType === undefined) {
        this.log.info('ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without genericDeviceType');
        return;
    }
    if (s.Internals.TYPE === 'SVG' && genericType === undefined) {
        this.log.info('ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without genericDeviceType');
        return;
    }
    if (s.Internals.TYPE === 'THRESHOLD' && genericType === undefined) {
        this.log.info('ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without genericDeviceType');
        return;
    }

    //CREATE MAPPINGS
    this.service_name = genericType;

    this.mappings = {};

    var match;
    if (match = s.PossibleSets.match(/(^| )dim:slider,0,1,99/)) {
        // ZWave dimmer
        this.mappings.On = {reading: 'state', valueOff: '/^(dim )?0$/', cmdOn: 'on', cmdOff: 'off'};
        this.mappings.Brightness = {reading: 'state', cmd: 'dim', delay: true};

        this.mappings.Brightness.reading2homekit = function (mapping, orig) {
            var match;
            if (match = orig.match(/dim (\d+)/))
                return parseInt(match[1]);

            return 0;
        }.bind(null, this.mappings.Brightness);

    } else if (match = s.PossibleSets.match(/(^| )bri(:[^\b\s]*(,(\d+))+)?\b/)) {
        // Hue
        this.log.debug('detected HUEDevice');
        max = 100;
        if (match[4] !== undefined)
            max = match[4];
        this.mappings.On = {reading: 'onoff', valueOff: '0', cmdOn: 'on', cmdOff: 'off'};
        //FIXME: max & maxValue are not set. they would work in both directions. but we use pct for the set cmd. not bri!
        
        this.mappings.Brightness = {reading: 'pct', cmd: 'pct'};

    } else if (match = s.PossibleSets.match(/(^| )pct\b/)) {
        // HM dimmer
        this.mappings.On = {reading: 'pct', valueOff: '0', cmdOn: 'on', cmdOff: 'off'};
        this.mappings.Brightness = {reading: 'pct', cmd: 'pct', delay: true};

    } else if (match = s.PossibleSets.match(/(^| )dim\d+%/)) {
        // FS20 dimmer
        this.mappings.On = {reading: 'state', valueOff: 'off', cmdOn: 'on', cmdOff: 'off'};
        this.mappings.Brightness = {reading: 'state', cmd: ' ', delay: true};

        this.mappings.Brightness.reading2homekit = function (mapping, orig) {
            var match;
            if (orig === 'off')
                return 0;
            else if (match = orig.match(/dim(\d+)%?/))
                return parseInt(match[1]);

            return 100;
        }.bind(null, this.mappings.Brightness);

        this.mappings.Brightness.homekit2reading = function (mapping, orig) {
            var dim_values = ['dim06%', 'dim12%', 'dim18%', 'dim25%', 'dim31%', 'dim37%', 'dim43%',
                'dim50%', 'dim56%', 'dim62%', 'dim68%', 'dim75%', 'dim81%', 'dim87%', 'dim93%'];
            //if( value < 3 )
            //  value = 'off';
            //else
            if (orig > 97)
                return 'on';

            return dim_values[Math.round(orig / 625)];
        }.bind(null, this.mappings.Brightness);
    }

    if (match = s.PossibleSets.match(/(^| )rgb:colorpicker/)) {
        //Hue RGB mode
        this.mappings.On = {reading: 'onoff', valueOff: '0', cmdOn: 'on', cmdOff: 'off'};
        
        this.mappings.RGB = {reading: 'rgb', cmd: 'rgb'};
        this.mappings.RGB.reading2homekit = function (mapping, orig) {
            return parseInt(orig, 16);
        }.bind(null, this.mappings.RGB);
        this.mappings.RGB.homekit2reading = function (mapping, orig) {
            return ("000000" + orig.toString(16)).substr(-6);
        }.bind(null, this.mappings.RGB);
        
        this.mappings.ColorMode = {reading: 'colormode', valueCt: 'ct'};
        this.mappings.ColorTemperature = {reading: 'ct', cmd: 'ct'};
        this.mappings.ColorTemperature.reading2homekit = function (mapping, orig) {
            var match;
            if (match = orig.match(/^(\d+) \((\d+)K\)/)) {
                return parseInt(match[2]);
            }
            return 0;
        }.bind(null, this.mappings.ColorTemperature);
        this.mappings.ColorTemperature.homekit2reading = function (mapping, orig) {
            //kelvin to mired
            return parseInt(1000000/orig);
        }.bind(null, this.mappings.ColorTemperature);
    }
    
    if (match = s.PossibleSets.match(/(^| )hue(:[^\b\s]*(,(\d+))+)?\b/)) {
        max = 359;
        if (match[4] !== undefined)
            max = match[4];
        this.mappings.Hue = {reading: 'hue', cmd: 'hue', max: max, maxValue: 359};
    }

    if (match = s.PossibleSets.match(/(^| )sat(:[^\b\s]*(,(\d+))+)?\b/)) {
        max = 100;
        if (match[4] !== undefined)
            max = match[4];
        this.mappings.Saturation = {reading: 'sat', cmd: 'sat', max: max, maxValue: 1};
    }

    if (s.Internals.TYPE === 'MilightDevice'
        && s.PossibleSets.match(/(^| )dim\b/)) {
        // MilightDevice
        this.log.debug('detected MilightDevice');
        this.mappings.Brightness = {reading: 'brightness', cmd: 'dim', max: 100, maxValue: 100, delay: true};
        if (s.PossibleSets.match(/(^| )hue\b/) && s.PossibleSets.match(/(^| )saturation\b/)) {
            this.mappings.Hue = {reading: 'hue', cmd: 'hue', max: 359, maxValue: 359};
            this.mappings.Saturation = {reading: 'saturation', cmd: 'saturation', max: 100, maxValue: 1};
            this.mappings.HSVBrightness = {reading: 'brightness', cmd: 'dim', max: 100, maxValue: 1, delay: true};
        }

    } else if (s.Internals.TYPE === 'WifiLight' && s.PossibleSets.match(/(^| )HSV\b/)
        && s.Readings.hue !== undefined && s.Readings.saturation !== undefined && s.Readings.brightness !== undefined) {
        // WifiLight
        this.log.debug('detected WifiLight');
        this.mappings.Hue = {reading: 'hue', cmd: 'HSV', max: 359, maxValue: 359};
        this.mappings.Saturation = {reading: 'saturation', cmd: 'HSV', max: 100, maxValue: 1};
        this.mappings.Brightness = {reading: 'brightness', cmd: 'dim', max: 100, maxValue: 100, delay: true};
        this.mappings.HSVBrightness = {reading: 'brightness', cmd: 'HSV', max: 100, maxValue: 1, delay: true};

        homekit2reading = function (mapping, orig) {
            let h = FHEM_cached[mapping.device + '-hue'];
            let s = FHEM_cached[mapping.device + '-saturation'];
            let v = FHEM_cached[mapping.device + '-brightness'];
            //mapping.log( ' from cached : [' + h + ',' + s + ',' + v + ']' );

            if (h === undefined) h = 0;
            if (s === undefined) s = 100;
            if (v === undefined) v = 100;
            //mapping.log( ' old : [' + h + ',' + s + ',' + v + ']' );

            if (mapping.characteristic_type === 'Hue') {
                h = orig;

                //if( FHEM_cached[mapping.device + '-hue'] === orig ) return undefined;
                FHEM_cached[mapping.device + '-hue'] = orig;

            } else if (mapping.characteristic_type === 'Saturation') {
                s = orig;

                //if( FHEM_cached[mapping.device + '-saturation'] === orig ) return undefined;
                FHEM_cached[mapping.device + '-saturation'] = orig;

            } else if (mapping.characteristic_type === 'Brightness') {
                v = orig;

                //if( FHEM_cached[mapping.device + '-brightness'] === orig ) return undefined;
                FHEM_cached[mapping.device + '-brightness'] = orig;

            }
            //mapping.log( ' new : [' + h + ',' + s + ',' + v + ']' );

            return h + ',' + s + ',' + v;
        };

        this.mappings.Hue.homekit2reading = homekit2reading.bind(null, this.mappings.Hue);
        this.mappings.Saturation.homekit2reading = homekit2reading.bind(null, this.mappings.Saturation);
        this.mappings.HSVBrightness.homekit2reading = homekit2reading.bind(null, this.mappings.HSVBrightness);

    }

    if (!this.mappings.Hue || s.Internals.TYPE === 'SWAP_0000002200000003') {
        // rgb/RGB
        let reading = undefined;
        let cmd = undefined;
        if (s.PossibleSets.match(/(^| )rgb\b/)) {
            reading = 'rgb';
            cmd = 'rgb';
            if (s.Internals.TYPE === 'SWAP_0000002200000003')
                reading = '0B-RGBlevel';
        } else if (s.PossibleSets.match(/(^| )RGB\b/)) {
            reading = 'RGB';
            cmd = 'RGB';
        }

        if (reading && cmd) {
            this.mappings.Hue = {reading: reading, cmd: cmd, max: 359, maxValue: 359};
            this.mappings.Saturation = {reading: reading, cmd: cmd, max: 100, maxValue: 1};
            this.mappings.HSVBrightness = {reading: reading, cmd: cmd, max: 100, maxValue: 1, delay: true};
            this.mappings.Brightness = {reading: reading, cmd: 'pct', max: 100, maxValue: 100, delay: true};

            homekit2reading = function (mapping, orig) {
                let h = FHEM_cached[mapping.device + '-h'];
                let s = FHEM_cached[mapping.device + '-s'];
                let v = FHEM_cached[mapping.device + '-v'];
                //mapping.log( ' from cached : [' + h + ',' + s + ',' + v + ']' );

                if (h === undefined) h = 0.0;
                if (s === undefined) s = 1.0;
                if (v === undefined) v = 1.0;
                //mapping.log( ' old : [' + h + ',' + s + ',' + v + ']' );

                if (mapping.characteristic_type === 'Hue') {
                    h = orig / 360.0;
                    FHEM_cached[mapping.device + '-h'] = h;

                } else if (mapping.characteristic_type === 'Saturation') {
                    s = orig / 100.0;
                    FHEM_cached[mapping.device + '-s'] = s;

                } else if (mapping.characteristic_type === 'Brightness') {
                    v = orig / 100.0;
                    FHEM_cached[mapping.device + '-v'] = v;

                }
                //mapping.log( ' new : [' + h + ',' + s + ',' + v + ']' );

                const value = FHEM_hsv2rgb(h, s, v);
                if (value === FHEM_cached[mapping.informId])
                    return undefined;

                FHEM_update(mapping.informId, value, true);
                //mapping.log( ' rgb : [' + value + ']' );

                return value;
            };

            if (this.mappings.Hue) {
                this.mappings.Hue.reading2homekit = function (mapping, orig) {
                    var hsv = FHEM_rgb2hsv(orig);
                    var hue = parseInt(hsv[0] * mapping.maxValue);

                    FHEM_cached[mapping.device + '-h'] = hsv[0];

                    return hue;
                }.bind(null, this.mappings.Hue);
                this.mappings.Hue.homekit2reading = homekit2reading.bind(null, this.mappings.Hue);
            }
            if (this.mappings.Saturation) {
                this.mappings.Saturation.reading2homekit = function (mapping, orig) {
                    const hsv = FHEM_rgb2hsv(orig);
                    const sat = parseInt(hsv[1] * mapping.maxValue);

                    FHEM_cached[mapping.device + '-s'] = hsv[1];

                    return sat;
                }.bind(null, this.mappings.Saturation);
                this.mappings.Saturation.homekit2reading = homekit2reading.bind(null, this.mappings.Saturation);
            }
            if (this.mappings.HSVBrightness) {
                this.mappings.HSVBrightness.reading2homekit = function (mapping, orig) {
                    var hsv = FHEM_rgb2hsv(orig);
                    var bri = parseInt(hsv[2] * mapping.maxValue);

                    FHEM_cached[mapping.device + '-v'] = hsv[2];

                    return bri;
                }.bind(null, this.mappings.HSVBrightness);
                this.mappings.HSVBrightness.homekit2reading = homekit2reading.bind(null, this.mappings.HSVBrightness);
            }
        }
    }

    if (s.Readings.volume) {
        this.mappings.Volume = {
            reading: 'volume', cmd: 'volume', delay: true,
            name: 'Volume', format: 'UINT8', unit: 'PERCENTAGE',
            minValue: 0, maxValue: 100, minStep: 1
        };
    } else if (s.Readings.Volume) {
        this.mappings.Volume = {
            reading: 'Volume', cmd: 'Volume', delay: true, nocache: true,
            name: 'Volume', format: 'UINT8', unit: 'PERCENTAGE',
            minValue: 0, maxValue: 100, minStep: 1
        };
        if (s.Attributes.generateVolumeEvent == 1)
            delete this.mappings.Volume.nocache;
    }
    
    if (s.Internals.TYPE == 'BOSEST') {
        this.mappings.On = {reading: 'source', valueOff: 'STANDBY', cmdOn: 'on', cmdOff: 'off'};
    }
    
    if (s.Internals.TYPE == 'LightScene') {
        //name attribut ist der name der scene
        this.mappings.Scene = [];
        let m;
        if (m = s.PossibleSets.match(/(^| )scene:(\S+)\b/)) {
            let availableScenes = m[2].split(",");
            availableScenes.forEach(function(scene) {
                this.mappings.Scene.push({scenename: scene, cmdOn: 'scene ' + scene})
            }.bind(this));
        }
    }
    
    if (s.Attributes.subType == 'VacuumCleaner') {
        if (!this.service_name) this.service_name = 'vacuum';
        this.mappings.Dock = {reading: 'state', cmd: 'charge', values:['/^Docked/:true', '/^Charging/:true', '/.*/:false']};
        this.mappings.Locate = {cmd: 'locate'};
        //map Paused => paused, Cleaning => running
        this.mappings.StartStop = {reading: 'state', cmdPause: 'pause', cmdUnpause: 'on', cmdOn: 'on', cmdOff: 'off', values: ['/^Paused/:paused', '/^Cleaning/:running', '/.*/:other']};
        this.mappings.Toggles = [{reading: 'cleaning_mode', valueOn: 'turbo', cmdOn: 'cleaning_mode turbo', cmdOff: 'cleaning_mode balanced',
          toggle_attributes: {
              name: 'Turbo',
              name_values: [
                {
                  name_synonym: ['turbo', 'turbo-funktion', 'turbofunktion', 'turbo-modus', 'turbomodus'],
                  lang: 'de'
                }
              ]
          }
        }];
        //FIXME get Modes from cmdlist
        this.mappings.Modes = [{
            reading: 'cleaning_mode',
			      cmd: 'cleaning_mode',
			      mode_attributes: {
                name: 'suction',
                name_values: [{
                    name_synonym: ['saugkraft', 'saugstärke'],
                    lang: 'de'
                },
                {
                    name_synonym: ['suction'],
                    lang: 'en'
                }],
                settings: [{
                  setting_name: 'quiet',
                  setting_values: [{
                    setting_synonym: ['ruhe', 'ruhe-', 'ruhemodus', 'leise'],
                    lang: 'de'
                  }]
                },
                {
                  setting_name: 'balanced',
                  setting_values: [{
                    setting_synonym: ['balanced', 'normal'],
                    lang: 'de'
                  },
                  {
                    setting_synonym: ['balanced', 'normal'],
                    lang: 'en'
                  }]
                },
                {
                  setting_name: 'Turbo',
                  setting_values: [{
                    setting_synonym: ['turbo'],
                    lang: 'de'
                  }]
                },
                {
                  setting_name: 'maximum',
                  setting_values: [{
                    setting_synonym: ['maximum', 'max'],
                    lang: 'de'
                  }]
                }],
                ordered: true
            }
        }];
        this.mappings.Modes.reading2homekit = function (mapping, orig) {
            if (orig == 'turbo')
                return 'Turbo';
            else if (orig == 'max')
                return 'maximum';
            return orig;
        }.bind(null, this.mappings.Modes);
        
        this.mappings.Modes.homekit2reading = function (mapping, orig) {
            if (orig == 'Turbo') {
                return 'turbo';
            } else if (orig == 'maximum') {
                return 'max';
            }
            return orig;
        }.bind(null, this.mappings.Modes);
    }

    //!!!!!!CURRENTLY NOT IN USE!!!!!!
    if(0) {
    if (s.Readings.voltage)
        this.mappings.Voltage = {name: 'Voltage', reading: 'voltage', format: 'FLOAT', factor: 1};

    if (s.Readings.current) {
        this.mappings.Current = {name: 'Current', reading: 'current', format: 'FLOAT', factor: 1};
        if (s.Internals.TYPE === 'HM-ES-PMSw1-Pl')
            this.mappings.Current.factor = 0.001;
    }
	
    if (s.Readings.power)
        this.mappings.Power = {name: 'Power', reading: 'power', format: 'FLOAT', factor: 1};

    if (s.Readings.energy) {
        this.mappings.Energy = {name: 'Energy', reading: 'energy', format: 'FLOAT', factor: 1};
        if (s.Internals.TYPE === 'HM-ES-PMSw1-Pl')
            this.mappings.Energy.factor = 0.001;
        else if (s.Readings.energy.Value.match(/ Wh/))
            this.mappings.Energy.factor = 0.001;
    }
	
    if (s.Attributes.model === 'HM-Sen-LI-O') {
        this.service_name = 'LightSensor';
        this.mappings.CurrentAmbientLightLevel = {reading: 'brightness', minValue: 0};
    } else if (s.Readings.luminance) {
        if (!this.service_name) this.service_name = 'LightSensor';
        this.mappings.CurrentAmbientLightLevel = {reading: 'luminance', minValue: 0};
    } else if (s.Readings.illuminance) {
        if (!this.service_name) this.service_name = 'LightSensor';
        this.mappings.CurrentAmbientLightLevel = {reading: 'illuminance', minValue: 0};
    } else if (s.Readings.luminosity) {
        if (!this.service_name) this.service_name = 'LightSensor';
        this.mappings.CurrentAmbientLightLevel = {reading: 'luminosity', minValue: 0, factor: 1 / 0.265};
    }

    if (s.Readings.voc) {
        if (!this.service_name) this.service_name = 'AirQualitySensor';
        this.mappings.AirQuality = {reading: 'voc'};
    } else if (s.Readings.co2) {
        if (!this.service_name) this.service_name = 'AirQualitySensor';
        this.mappings.AirQuality = {reading: 'co2'};
        this.mappings.CarbonDioxideLevel = {reading: 'co2'};
    }

    if (this.mappings.AirQuality)
        this.mappings.AirQuality.reading2homekit = function (mapping, orig) {
            orig = parseInt(orig);
            if (orig > 1500)
                return Characteristic.AirQuality.POOR;
            else if (orig > 1000)
                return Characteristic.AirQuality.INFERIOR;
            else if (orig > 800)
                return Characteristic.AirQuality.FAIR;
            else if (orig > 600)
                return Characteristic.AirQuality.GOOD;
            else if (orig > 0)
                return Characteristic.AirQuality.EXCELLENT;
            else
                return Characteristic.AirQuality.UNKNOWN;
        }.bind(null, this.mappings.AirQuality);

    if (s.Readings.motor)
        this.mappings.PositionState = {
            reading: 'motor',
            values: ['/^up/:INCREASING', '/^down/:DECREASING', '/.*/:STOPPED']
        };

    if (s.Readings.moving)
        this.mappings.PositionState = {
            reading: 'moving',
            values: ['/^up/:INCREASING', '/^down/:DECREASING', '/.*/:STOPPED']
        };

    if (s.Readings.direction)
        this.mappings.PositionState = {
            reading: 'direction',
            values: ['/^opening/:INCREASING', '/^closing/:DECREASING', '/.*/:STOPPED']
        };

    if (s.Readings.doorState)
        this.mappings.CurrentDoorState = {
            reading: 'doorState',
            values: ['/^opening/:OPENING', '/^closing/:CLOSING',
                '/^open/:OPEN', '/^closed/:CLOSED', '/.*/:STOPPED']
        };

    if (s.Readings.battery) {
        var value = parseInt(s.Readings.battery.Value);

        if (isNaN(value))
            this.mappings.StatusLowBattery = {
                reading: 'battery',
                values: ['ok:BATTERY_LEVEL_NORMAL', '/.*/:BATTERY_LEVEL_LOW']
            };
        else {
            this.mappings.BatteryLevel = {reading: 'battery'};
            this.mappings.StatusLowBattery = {
                reading: 'battery',
                threshold: 20,
                values: ['0:BATTERY_LEVEL_LOW', '1:BATTERY_LEVEL_NORMAL']
            };
        }
    }

    if (s.Readings['D-firmware'])
        this.mappings.FirmwareRevision = {reading: 'D-firmware', _isInformation: true};
    else if (s.Readings.firmware)
        this.mappings.FirmwareRevision = {reading: 'firmware', _isInformation: true};
    //FIXME: add swversion internal for HUEDevices

    if (s.Readings.reachable)
        this.mappings.reachable = {reading: 'reachable'};
    else if (s.PossibleAttrs.match(/(^| )disable\b/))
        this.mappings.reachable = {reading: 'reachable'};
    }
    // END OF CURRENTLY NOT IN USE

    if (genericType == 'garage') {
        this.service_name = 'garage';
        if (s.PossibleAttrs.match(/(^| )setList\b/) && !s.Attributes.setList) s.Attributes.setList = 'on off';
        var parts = s.Attributes.setList.split(' ');
        if (parts.length == 2) {
            this.mappings.CurrentDoorState = {reading: 'state', values: [parts[0] + ':OPEN', parts[1] + ':CLOSED']};
            this.mappings.TargetDoorState = {
                reading: 'state', values: [parts[0] + ':OPEN', parts[1] + ':CLOSED'],
                cmds: ['OPEN:' + parts[0], 'CLOSED:' + parts[1]]
            };
        }

    } else if (genericType == 'blind'
        || s.Attributes.subType == 'blindActuator'
        || (s.PossibleSets.match(/(^| )closes\b/) && s.PossibleSets.match(/(^| )opens\b/))) {
        this.mappings.On = {reading: 'state', valueOff: 'closed', cmdOn: 'opens', cmdOff: 'closes'};
        delete this.mappings.Brightness;
        if (s.PossibleSets.match(/(^| )position\b/)) {
            this.mappings.CurrentPosition = {reading: 'position'};
            this.mappings.TargetPosition = {reading: 'position', cmd: 'position', delay: true};
            if (s.Internals.TYPE == 'SOMFY') {
                this.mappings.CurrentPosition.invert = true;
                this.mappings.TargetPosition.invert = true;
                this.mappings.TargetPosition.cmd = 'pos';
            }
        } else if (s.Internals.TYPE == 'ZWave' ) {
            this.mappings.On = {reading: 'state', valueOff: 'off', cmdOn: 'on', cmdOff: 'off', max: 99};
            if(s.Readings.position !== undefined) { 
                // FIBARO System FGRM222 Roller Shutter Controller 2
                // If the device is configured to use Fibaro command class instead of ZWave command class,
                // then there's a reading "position" present which must be used instead.
                this.mappings.CurrentPosition = {reading: 'position'};
                this.mappings.TargetPosition = {reading: 'position', cmd: 'dim', delay: true};
            } else {
                this.mappings.CurrentPosition = {reading: 'state'};
                this.mappings.TargetPosition = {reading: 'state', cmd: 'dim', delay: true};
            }
        } else {
            this.mappings.CurrentPosition = {reading: 'pct'};
            this.mappings.TargetPosition = {reading: 'pct', cmd: 'pct', delay: true};
            if (s.Attributes.param && s.Attributes.param.match(/levelInverse/i)) {
                this.mappings.CurrentPosition.invert = true;
                this.mappings.TargetPosition.invert = true;
            }
        }

    } else if (s.Attributes.model === 'HM-SEC-WIN') {
        if (!this.service_name) this.service_name = 'window';
        this.mappings.CurrentPosition = {reading: 'state'};
        this.mappings.TargetPosition = {reading: 'state', cmd: ' ', delay: true};

        var reading2homekit = function (mapping, orig) {
            var match;
            if (match = orig.match(/^(\d+)/))
                return parseInt(match[1]);
            else if (orig == 'locked')
                return 0;

            return 50;
        };
        this.mappings.CurrentPosition.reading2homekit = reading2homekit.bind(null, this.mappings.CurrentPosition);
        this.mappings.TargetPosition.reading2homekit = reading2homekit.bind(null, this.mappings.TargetPosition);

        this.mappings.TargetPosition.homekit2reading = function (mapping, orig) {
            if (orig == 0) return 'lock';
            return orig;
        }.bind(null, this.mappings.TargetPosition);

    } else if (s.Attributes.model && s.Attributes.model.match(/^HM-SEC-KEY/)) {
        if (!this.service_name) this.service_name = 'lock';
        this.mappings.TargetDoorState = {reading: '', default: 'CLOSED', timeout: 500, cmds: ['OPEN:open']};
        this.mappings.LockCurrentState = {
            reading: 'lock',
            values: ['/uncertain/:UNKNOWN', '/^locked/:SECURED', '/.*/:UNSECURED']
        };
        this.mappings.LockTargetState = {
            reading: 'lock',
            values: ['/^locked/:SECURED', '/.*/:UNSECURED'],
            cmds: ['SECURED:lock', 'UNSECURED:unlock'],
        };

    } else if (genericType == 'lock') {
        this.mappings.TargetDoorState = {reading: '', default: 'CLOSED', timeout: 500, cmds: ['OPEN:open']};
        this.mappings.LockCurrentState = {
            reading: 'state',
            values: ['/uncertain/:UNKNOWN', '/^locked/:SECURED', '/.*/:UNSECURED']
        };
        this.mappings.LockTargetState = {
            reading: 'state',
            values: ['/^locked/:SECURED', '/.*/:UNSECURED'],
            cmds: ['SECURED:lock+locked', 'UNSECURED:lock+unlocked']
        };

    } else if (s.Internals.TYPE === 'CUL_FHTTK') {
        this.service_name = 'ContactSensor';
        this.mappings.ContactSensorState = {
            reading: 'Window',
            values: ['/^Closed/:CONTACT_DETECTED', '/.*/:CONTACT_NOT_DETECTED']
        };
        this.mappings.CurrentDoorState = {reading: 'Window', values: ['/^Closed/:CLOSED', '/.*/:OPEN']};

    } else if (s.Internals.TYPE == 'MAX'
        && s.Internals.type == 'ShutterContact') {
        this.service_name = 'ContactSensor';
        this.mappings.ContactSensorState = {
            reading: 'state',
            values: ['closed:CONTACT_DETECTED', '/.*/:CONTACT_NOT_DETECTED']
        };
        this.mappings.CurrentDoorState = {reading: 'state', values: ['closed:CLOSED', '/.*/:OPEN']};

    } else if (s.Attributes.subType == 'threeStateSensor') {
        this.service_name = 'ContactSensor';
        this.mappings.ContactSensorState = {
            reading: 'contact',
            values: ['/^closed/:CONTACT_DETECTED', '/.*/:CONTACT_NOT_DETECTED']
        };
        this.mappings.CurrentDoorState = {reading: 'contact', values: ['/^closed/:CLOSED', '/.*/:OPEN']};

    } else if (s.Internals.TYPE == 'PRESENCE') {
        this.service_name = 'OccupancySensor';
        this.mappings.OccupancyDetected = {
            reading: 'state',
            values: ['present:OCCUPANCY_DETECTED', 'absent:OCCUPANCY_NOT_DETECTED']
        };

    } else if (s.Internals.TYPE == 'ROOMMATE' || s.Internals.TYPE == 'GUEST') {
        this.service_name = 'OccupancySensor';
        this.mappings.OccupancyDetected = {
            reading: 'presence',
            values: ['present:OCCUPANCY_DETECTED', '/.*/:OCCUPANCY_NOT_DETECTED']
        };

    } else if (s.Internals.TYPE == 'RESIDENTS') {
        this.service_name = 'security';
        this.mappings.SecuritySystemCurrentState = {
            reading: 'state',
            values: ['/^home/:DISARMED', '/^gotosleep/:NIGHT_ARM', '/^absent/:STAY_ARM', '/^gone/:AWAY_ARM']
        }
        this.mappings.SecuritySystemTargetState = {
            reading: 'state',
            values: ['/^home/:DISARMED', '/^gotosleep/:NIGHT_ARM', '/^absent/:STAY_ARM', '/^gone/:AWAY_ARM'],
            cmds: ['STAY_ARM:home', 'AWAY_ARM:absent', 'NIGHT_ARM:gotosleep', 'DISARM:home'],
            delay: true
        }
    }

    if (match = s.PossibleSets.match(/(^| )desired-temp(:[^\d]*([^\$ ]*))?/)) {
        //HM & Comet DECT
        this.mappings.TargetTemperature = {reading: 'desired-temp', cmd: 'desired-temp', delay: true};
        if (s.Readings['desired-temp'] === undefined) //Comet DECT
            this.mappings.TargetTemperature.reading = 'temperature';

        if (s.Readings.actuator)
            this.mappings.Actuation = {
                reading: 'actuator',
                name: 'Actuation', format: 'UINT8', unit: 'PERCENTAGE',
                maxValue: 100, minValue: 0, minStep: 1
            };
        else if (s.Readings.ValvePosition)
            this.mappings.Actuation = {
                reading: 'ValvePosition',
                name: 'Actuation', format: 'UINT8', unit: 'PERCENTAGE',
                maxValue: 100, minValue: 0, minStep: 1
            };
        else if (s.Readings.valvePosition)
            this.mappings.Actuation = {
                reading: 'valvePosition',
                name: 'Actuation', format: 'UINT8', unit: 'PERCENTAGE',
                maxValue: 100, minValue: 0, minStep: 1
            };

        if (match[3]) {
            var values = match[3].split(',');
            if (s.PossibleSets.match(/slider/)) {
                this.mappings.TargetTemperature.minValue = parseFloat(values[0]);
                this.mappings.TargetTemperature.maxValue = parseFloat(values[2]);
                this.mappings.TargetTemperature.minStep = values[1];
            } else {
                this.mappings.TargetTemperature.minValue = parseFloat(values[0]);
                this.mappings.TargetTemperature.maxValue = parseFloat(values[values.length - 1]);
                this.mappings.TargetTemperature.minStep = values[1] - values[0];
            }
        }

        if (match = s.PossibleSets.match(/(^| )mode($| )/)) {
            this.mappings.TargetHeatingCoolingState = {
                reading: 'mode',
                values: ['/^auto/:AUTO', '/^holiday_short/:OFF', '/.*/:HEAT'],
                cmds: ['OFF:mode holiday_short', 'HEAT:mode manual', 'COOL:mode manual', 'AUTO:mode auto'],
            };
        }

    } else if (match = s.PossibleSets.match(/(^| )desiredTemperature(:[^\d]*([^\$ ]*))?/)) {
        // MAX / EQ3BT
        this.mappings.TargetTemperature = {reading: 'desiredTemperature', cmd: 'desiredTemperature', delay: true};

        if (s.Readings.valveposition)
            this.mappings.Actuation = {
                reading: 'valveposition',
                name: 'Actuation', format: 'UINT8', unit: 'PERCENTAGE',
                maxValue: 100, minValue: 0, minStep: 1
            };
        else if (s.Readings.valvePosition)
            this.mappings.Actuation = {
                reading: 'valvePosition',
                name: 'Actuation', format: 'UINT8', unit: 'PERCENTAGE',
                maxValue: 100, minValue: 0, minStep: 1
            };

        if (match[3]) {
            var values = match[3].split(',');
            this.mappings.TargetTemperature.minValue = parseFloat(values[0]);
            this.mappings.TargetTemperature.maxValue = parseFloat(values[values.length - 2]);
            if (s.Readings.valvePosition)
                this.mappings.TargetTemperature.minStep = values[1];
            else
                this.mappings.TargetTemperature.minStep = values[1] - values[0];
        }

    } else if (match = s.PossibleSets.match(/(^| )desired(:[^\d]*([^\$ ]*))?/)) {
        //PID20
        this.mappings.TargetTemperature = {reading: 'desired', cmd: 'desired', delay: true};

        if (s.Readings.actuation)
            this.mappings.Actuation = {
                reading: 'actuation',
                name: 'Actuation', format: 'UINT8', unit: 'PERCENTAGE',
                maxValue: 100, minValue: 0, minStep: 1
            };

        if (s.Readings.measured)
            this.mappings.CurrentTemperature = {reading: 'measured'};

    }

    if (s.Internals.TYPE == 'SONOSPLAYER') { //FIXME: use sets [Pp]lay/[Pp]ause/[Ss]top
        this.mappings.On = {reading: 'transportState', valueOn: 'PLAYING', cmdOn: 'play', cmdOff: 'pause'};

    } else if (s.Internals.TYPE == 'harmony') {
        if (s.Internals.id !== undefined) {
            if (s.Attributes.genericDeviceType)
                this.mappings.On = {reading: 'power', cmdOn: 'on', cmdOff: 'off'};
            else
                return;

        } else if (!s.Attributes.homebridgeMapping) {
            if (!this.service_name) this.service_name = 'switch';

            var match;
            if (match = s.PossibleSets.match(/(^| )activity:([^\s]*)/)) {
                this.mappings.On = [];

                for (var activity of match[2].split(',')) {
                    this.mappings.On.push({
                        reading: 'activity',
                        subtype: activity,
                        valueOn: activity,
                        cmdOn: 'activity+' + activity,
                        cmdOff: 'off'
                    });
                }
            }
        }

    } else if (!this.mappings.On
        && s.PossibleSets.match(/(^| )on\b/)
        && s.PossibleSets.match(/(^| )off\b/)) {
        this.mappings.On = {reading: 'state', valueOff: '/off|A0|000000/', cmdOn: 'on', cmdOff: 'off'};
        if (!s.Readings.state)
            delete this.mappings.On.reading;

    } else if (!this.mappings.On
        && s.PossibleSets.match(/(^| )ON\b/)
        && s.PossibleSets.match(/(^| )OFF\b/)) {
        this.mappings.On = {reading: 'state', valueOff: '/OFF/off/', cmdOn: 'ON', cmdOff: 'OFF'};
        if (!s.Readings.state)
            delete this.mappings.On.reading;

    } else if (!this.service_name && s.Attributes.setList) {
        var parts = s.Attributes.setList.split(' ');
        if (parts.length == 2) {
            this.service_name = 'switch';
            this.mappings.On = {reading: 'state', valueOn: parts[0], cmdOn: parts[0], cmdOff: parts[1]};
        }

    }

    if (s.Readings['measured-temp']) {
        this.mappings.CurrentTemperature = {reading: 'measured-temp', minValue: -30};
    } else if (s.Readings.temperature) {
        this.mappings.CurrentTemperature = {reading: 'temperature', minValue: -30};
    }

    if (s.Readings.humidity) {
        this.mappings.CurrentRelativeHumidity = {reading: 'humidity'};
    }

    if (s.Readings.pressure)
        this.mappings.AirPressure = {
            name: 'AirPressure',
            reading: 'pressure',
            format: 'UINT16',
            factor: 1
        };


    if (this.service_name === 'thermostat')
        this.mappings.CurrentHeatingCoolingState = {default: 'HEAT'};

    this.fromHomebridgeMapping(s.Attributes.homebridgeMapping);
    this.log.debug('mappings for ' + s.Internals.NAME + ': ' + util.inspect(this.mappings));

    if (this.service_name !== undefined) {
        this.log.info(s.Internals.NAME + ' is ' + this.service_name);
    } else if (this.mappings.CurrentPosition)
        this.log.info(s.Internals.NAME + ' is blind [' + this.mappings.CurrentPosition.reading + ']');
    else if (this.mappings.TargetTemperature)
        this.log.info(s.Internals.NAME + ' is thermostat [' + this.mappings.TargetTemperature.reading
            + ';' + this.mappings.TargetTemperature.minValue + '-' + this.mappings.TargetTemperature.maxValue
            + ':' + this.mappings.TargetTemperature.minStep + ']');
    else if (this.mappings.ContactSensor)
        this.log.info(s.Internals.NAME + ' is contact sensor [' + this.mappings.ContactSensor.reading + ']');
    else if (this.mappings.OccupancyDetected)
        log(s.Internals.NAME + ' is occupancy sensor');
    else if (!this.mappings) {
        this.log.error(s.Internals.NAME + ': no service type detected');
        return;
    }

    if (this.service_name === 'lock' || this.service_name === 'garage' || this.service_name === 'window')
        delete this.mappings.On;

    this.log.info(s.Internals.NAME + ' has');
    for (characteristic_type in this.mappings) {
        mappings = this.mappings[characteristic_type];
        if (!Array.isArray(mappings))
            mappings = [mappings];

        for (mapping of mappings) {
            if (characteristic_type === 'On')
                this.log.info('  ' + characteristic_type + ' [' + (mapping.device ? mapping.device + '.' : '') + mapping.reading + ';' + mapping.cmdOn + ',' + mapping.cmdOff + ']');
            else if (characteristic_type === 'Hue' || characteristic_type === 'Saturation')
                this.log.info('  ' + characteristic_type + ' [' + (mapping.device ? mapping.device + '.' : '') + mapping.reading + ';' + mapping.cmd + ';0-' + mapping.max + ']');
            else if (mapping.name) {
                if (characteristic_type === 'Volume')
                    this.log.info('  Custom ' + mapping.name + ' [' + (mapping.device ? mapping.device + '.' : '') + mapping.reading + ';' + (mapping.nocache ? 'not cached' : 'cached' ) + ']');
                else
                    this.log.info('  Custom ' + mapping.name + ' [' + (mapping.device ? mapping.device + '.' : '') + mapping.reading + ']');
            } else
                this.log.info('  ' + characteristic_type + ' [' + (mapping.device ? mapping.device + '.' : '') + mapping.reading + ']');
        }
    }

    if (this.mappings.reachable)
        this.log.info(s.Internals.NAME + ' has reachability [' + this.mappings.reachable.reading + ']');

//log( util.inspect(s) );

    // device info
    this.name = s.Internals.NAME;
    this.alias = s.Attributes.alias ? s.Attributes.alias : s.Internals.NAME;
    this.ghomeName = this.alias;
    this.device = s.Internals.NAME;
    this.type = s.Internals.TYPE;
    this.model = s.Readings.model ? s.Readings.model.Value
        : (s.Attributes.model ? s.Attributes.model
            : ( s.Internals.model ? s.Internals.model : '<unknown>' ) );
    this.PossibleSets = s.PossibleSets;

    this.room = s.Attributes.room ? s.Attributes.room : '';
    this.ghomeRoom = s.Attributes.realRoom;

    if (this.type == 'CUL_HM') {
        this.serial = this.type + '.' + s.Internals.DEF;
        if (s.Attributes.serialNr)
            this.serial = s.Attributes.serialNr;
        else if (s.Readings['D-serialNr'] && s.Readings['D-serialNr'].Value)
            this.serial = s.Readings['D-serialNr'].Value;
    } else if (this.type == 'CUL_WS')
        this.serial = this.type + '.' + s.Internals.DEF;
    else if (this.type == 'FS20')
        this.serial = this.type + '.' + s.Internals.DEF;
    else if (this.type == 'IT')
        this.serial = this.type + '.' + s.Internals.DEF;
    else if (this.type == 'HUEDevice') {
        if (s.Internals.uniqueid && s.Internals.uniqueid != 'ff:ff:ff:ff:ff:ff:ff:ff-0b')
            this.serial = s.Internals.uniqueid;
    } else if (this.type == 'SONOSPLAYER')
        this.serial = s.Internals.UDN;
    else if (this.type == 'EnOcean')
        this.serial = this.type + '.' + s.Internals.DEF;
    else if (this.type == 'MAX') {
        this.model = s.Internals.type;
        this.serial = this.type + '.' + s.Internals.addr;
    } else if (this.type == 'DUOFERN') {
        this.model = s.Internals.SUBTYPE;
        this.serial = this.type + '.' + s.Internals.DEF;
    }

    this.uuid_base = this.serial || this.name;


    // prepare mapping internals
    for (characteristic_type in this.mappings) {
        mappings = this.mappings[characteristic_type];
		
        if (!Array.isArray(mappings))
            mappings = [mappings];

        let mappingRoot;
        for (mappingRoot in mappings) {
			      mappingRoot = mappings[mappingRoot];
			      if (!Array.isArray(mappingRoot))
				      mappingRoot = [mappingRoot];
			
			      for (mapping in mappingRoot) {
        				mapping = mappingRoot[mapping];
        				var device = this.device;
        				if (mapping.device === undefined)
        					mapping.device = device;
        				else
        					device = mapping.device;
        				
        				if (mapping.reading === undefined && mapping.default === undefined)
        					mapping.reading = 'state';
        
        				mapping.format = formatOfName(characteristic_type);
        				if (mapping.format === undefined)
                  delete mapping.format;
        				mapping.informId = device + '-' + mapping.reading;
        				mapping.characteristic_type = characteristic_type;
        				mapping.log = this.log;

        				//FIXME: better integrate eventMap
        				if (s.Attributes.eventMap) {
        					for (var part of s.Attributes.eventMap.split(' ')) {
        						var map = part.split(':');
        						if (map[1] == 'on'
        							|| map[1] == 'off') {
        							if (!mapping.event_map)
        								mapping.event_map = {}
        							mapping.event_map[map[0]] = map[1];
        						}
        					}
        					if (mapping.event_map && Object.keys(mapping.event_map).length) this.log.debug('event_map: ' + mapping.event_map);
        				}

        				this.prepare(mapping);
        
        				var orig = undefined;
        				if (device != this.device)
        					orig = this.query(mapping);
        				else if (s.Readings[mapping.reading] && s.Readings[mapping.reading].Value)
        					orig = s.Readings[mapping.reading].Value;
        
        				if (orig === undefined && device == this.device && mappings.default !== undefined) {
        					delete mapping.informId;
        
        				} else {
        					this.log.error(mapping);
        					if (!mapping.nocache && mapping.reading && FHEM_cached[mapping.informId] === undefined)
        						FHEM_update(mapping.informId, orig);
        
        					if (mapping.characteristic || mapping.name)
        					  FHEM_reading2homekit(mapping, orig);
        				}
			      }
        }
    }
}

function formatOfName(characteristic_type) {
    if (characteristic_type == 'On')
        return 'bool';
    else if (characteristic_type == 'Actuation')
        return 'int';
    else if (characteristic_type == 'Volume')
        return 'int';

    return undefined;
}
