'use strict';

const PUBLIC_PORT = 443;
const PORT = 3000;

const natpmp = require('nat-pmp');
const natupnp = require('nat-upnp');

const fs = require('fs');

const version = require('./version');

const User = require('./user').User;

const log = require("./logger")._system;
const Logger = require('./logger').Logger;

const FHEM = require('./fhem').FHEM;

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const authProvider = require('./auth-provider');
const datastore = require('./datastore');
const morgan = require("morgan");

authProvider.authstore = datastore;

module.exports = {
    Server: Server
}

function Server() {
    this._config = this._loadConfig();
    if (this._config.ghome.port === undefined)
        this._config.ghome.port = PORT;
}

Server.prototype._loadConfig = function () {


    // Load up the configuration file
    let config;
    // Look for the configuration file
    const configPath = User.configPath();
    log.info("using " + configPath);

    // Complain and exit if it doesn't exist yet
    if (!fs.existsSync(configPath)) {
        config = {};

        config.ghome = {
            name: 'GoogleAssistant',
        };

        //return config;
        log.error("Couldn't find a config.json file at '" + configPath + "'. Look at config-sample.json for an example.");
        process.exit(1);
    }
    try {
        config = JSON.parse(fs.readFileSync(configPath));
    }
    catch (err) {
        log.error("There was a problem reading your config.json file.");
        log.error("Please try pasting your config.json file here to validate it: http://jsonlint.com");
        log.error("");
        throw err;
    }

    if (typeof config.ghome.applicationId !== 'object')
        config.ghome.applicationId = [config.ghome.applicationId];

    log.info("---");

    return config;
}

Server.prototype.startServer = function () {
    function handleRequest(request, response) {
        let event;
        if (1) {
            try {
                event = request.body;
                console.log(event);
                verifyToken.bind(this)(request, function (ret, error) {
                    if (error)
                        log.error('ERROR: ' + error + ' from ' + request.connection.remoteAddress);

                    console.log('response :' + JSON.stringify(ret));
                    response.end(JSON.stringify(ret));
                });

            } catch (error) {
                //log2("Error", error);
                if (error)
                    log.error('ERROR: ' + error + ' from ' + request.connection.remoteAddress);

                response.status(404).end(JSON.stringify(createError(ERROR_UNSUPPORTED_OPERATION)));

            }// try-catch
        } else {
            event = request.body;
            //console.log(event);
            verifyToken.bind(this)(request, function (ret, error) {
                if (error)
                    log.error('ERROR: ' + error + ' from ' + request.connection.remoteAddress);

                console.log('response :' + JSON.stringify(ret));
                response.end(JSON.stringify(ret));
            });
        }
    }

    const app = express();
    app.use(morgan('dev'));
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({extended: true}));
    app.use(session({
        genid: function (req) {
            return authProvider.genRandomString();
        },
        secret: 'xyzsecret',
        resave: false,
        saveUninitialized: true,
        cookie: {secure: false}
    }));

    if (this._config.ghome.ssl === false) {
        this.server = require('http').createServer(app);
    } else {
        const options = {
            key: fs.readFileSync(this._config.ghome.keyFile || './key.pem'),
            cert: fs.readFileSync(this._config.ghome.certFile || './cert.pem'),
        };
        this.server = require('https').createServer(options, app);
    }

    authProvider.registerAuth(this._config, app);
    app.post('/', handleRequest.bind(this));
    app.post('/smart-home-api/auth', function (request, response) {
        let authToken = authProvider.getAccessToken(request);

        if (!authToken) {
            response.status(401).set({
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }).json({error: "missing auth headers"});
            return;
        }

        if (!datastore.isValidAuth(authToken)) {
            response.status(403).set({
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }).json({success: false, error: "failed auth"});
            return;
        }

        response.status(200)
            .set({
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            })
            .send({success: true});
    });

    this.server.listen(this._config.ghome.port, function () {
        log.info("Server listening on: http%s://%s:%s", this._config.ghome.ssl === false ? '' : 's',
            this.server.address().address, this.server.address().port);
    }.bind(this));
}

let pmp_client;

function open_pmp(ip) {
    if (ip) {
        log.info('Trying NAT-PMP ...');
        pmp_client = natpmp.connect(ip);
        pmp_client.externalIp(function (err, info) {
            if (err) throw err;
            log.info('Current external IP address: %s', info.ip.join('.'));
        });

        setInterval(open_pmp, 3500 * 1000);
    }

    pmp_client.portMapping({private: PORT, public: PUBLIC_PORT, ttl: 3600}, function (err, info) {
        if (err) throw err;
        log.debug(info);
    });
}

let upnp_client;

function open_upnp() {
    if (!upnp_client) {
        log.info('Trying NAT-UPNP ...');
        upnp_client = natupnp.createClient();
        upnp_client.externalIp(function (err, ip) {
            if (err) throw err;
            log.info('Current external IP address: %s', ip);
        });

        setInterval(open_upnp, 3500 * 1000);
    }

    upnp_client.portMapping({
        public: PUBLIC_PORT,
        private: PORT,
        ttl: 3600
    }, function (err) {
        if (err) {
            log.error('NAT-UPNP failed: ' + err)
        }
    });
}

Server.prototype.addDevice = function (device, fhem) {

    device.ghomeName = device.ghomeName.toLowerCase().replace(/\+/g, ' ');
    device.ghomeNames = device.ghomeName;
    device.ghomeName = device.ghomeName.replace(/,.*/g, '');
    device.hasName = function (name) {
        if (this.ghomeNames.match('(^|,)(' + name + ')(,|\$)')) return true;
        return this.ghomeName === name;
    }.bind(device);

    this.devices[device.device.toLowerCase()] = device;

    for (var characteristic_type in device.mappings)
        device.subscribe(device.mappings[characteristic_type]);

    if (device.ghomeRoom) {
        device.ghomeRoom = device.ghomeRoom.toLowerCase().replace(/\+/g, ' ');

        this.namesOfRoom = {};
        this.roomsOfName = {};

        for (var d in this.devices) {
            var device = this.devices[d];
            if (!device) continue;
            var room = device.ghomeRoom ? device.ghomeRoom : undefined;
            var name = device.ghomeName;

            if (room) {
                for (var r of room.split(',')) {
                    if (!this.namesOfRoom[r]) this.namesOfRoom[r] = [];
                    this.namesOfRoom[r].push(name);
                }
            }

            if (!this.roomsOfName[name]) this.roomsOfName[name] = [];
            this.roomsOfName[name].push(room);
        }
    }
}

Server.prototype.setreading = function (reading, value) {
    for (var fhem of this.connections) {
        if (!fhem.ghome_device) continue;

        fhem.execute('setreading ' + fhem.ghome_device.Name + ' ' + reading + ' ' + value);
    }
}

Server.prototype.run = function () {
    log.info('this is ghome-fhem ' + version);

    if (!this._config.connections) {
        log.error('no connections in config file');
        process.exit(-1);
    }

    if (this._config.ghome['nat-pmp'])
        open_pmp(this._config.ghome['nat-pmp']);

    if (this._config.ghome['nat-upnp'])
        open_upnp();

    this.startServer();

    this.roomOfIntent = {};

    log.info('Fetching FHEM devices...');

    this.devices = {};
    this.roomOfEcho = {};
    this.connections = [];
    this.namesOfRoom = {};
    this.roomsOfName = {};
    for (var connection of this._config.connections) {
        var fhem = new FHEM(Logger.withPrefix(connection.name), connection);
        //fhem.on( 'DEFINED', function() {log.error( 'DEFINED' )}.bind(this) );

        fhem.on('customSlotTypes', function (fhem, cl) {
            var ret = '';
            ret += 'Custom Slot Types:';
            ret += '\n  FHEM_Device';

            var seen = {};
            for (var d in this.devices) {
                var device = this.devices[d];
                for (var name of device.ghomeNames.split(',')) {
                    if (seen[name])
                        continue;
                    seen[name] = 1;
                    ret += '\n';
                    ret += '    ' + name;
                }
            }
            for (var c of this.connections) {
                if (!c.ghomeTypes) continue;
                for (var type in c.ghomeTypes) {
                    for (var name of c.ghomeTypes[type]) {
                        if (!seen[name])
                            ret += '\n    ' + name;
                        seen[name] = 1;
                    }
                }
            }

            if (!seen['lampe'])
                ret += '\n    lampe';
            if (!seen['licht'])
                ret += '\n    licht';
            if (!seen['lampen'])
                ret += '\n    lampen';
            if (!seen['rolläden'])
                ret += '\n    rolläden';
            if (!seen['jalousien'])
                ret += '\n    jalousien';
            if (!seen['rollos'])
                ret += '\n    rollos';

            ret += '\n  FHEM_Room';
            for (var room in this.namesOfRoom) {
                ret += '\n';
                ret += '    ' + room;
            }

            log.error(ret);
            if (cl) {
                fhem.execute('{asyncOutput($defs{"' + cl + '"}, "' + ret + '")}');
            }
        }.bind(this, fhem));

        fhem.on('RELOAD', function (fhem, n) {
            if (n)
                log.info('reloading ' + n + ' from ' + fhem.connection.base_url);
            else
                log.info('reloading ' + fhem.connection.base_url);

            for (var d in this.devices) {
                var device = this.devices[d];
                if (!device) continue;
                if (n && device.name !== n) continue;
                if (device.fhem.connection.base_url !== fhem.connection.base_url) continue;

                log.info('removing ' + device.name + ' from ' + device.fhem.connection.base_url);

                fhem = device.fhem;

                device.unsubscribe();

                delete this.devices[device.name];
            }

            if (n) {
                fhem.connect(function (fhem, devices) {
                    for (var device of devices) {
                        this.addDevice(device, fhem);
                    }
                }.bind(this, fhem), 'NAME=' + n);
            } else {
                for (var fhem of this.connections) {
                    fhem.connect(function (fhem, devices) {
                        for (var device of devices) {
                            this.addDevice(device, fhem);
                        }
                    }.bind(this, fhem));
                }
            }

        }.bind(this, fhem));

        fhem.on('LONGPOLL STARTED', function (fhem) {
            fhem.connect(function (fhem, devices) {
                for (var device of devices) {
                    this.addDevice(device, fhem);
                }
            }.bind(this, fhem))
        }.bind(this, fhem));

        this.connections.push(fhem);
    }
}

Server.prototype.shutdown = function () {
    if (pmp_client) {
        log.info('Stopping NAT-PMP ...');
        pmp_client.portUnmapping({public: PORT, private: PORT}, function (err, info) {
            if (err) throw err;
            log.debug('Port Unmapping:', info);
            pmp_client.close();
        });
    }

    if (upnp_client) {
        log.info('Stopping NAT-UPNP ...');
        upnp_client.portUnmapping({
            public: PORT
        });
    }
}


// namespaces
const NAMESPACE_DISCOVERY = "action.devices.SYNC";
const NAMESPACE_CONTROL = "action.devices.EXECUTE";
const NAMESPACE_QUERY = "action.devices.QUERY";

// trait commands => https://developers.google.com/actions/smarthome/traits/
const REQUEST_SET_BRIGHTNESSABSOLUTE = "action.devices.commands.BrightnessAbsolute";
const REQUEST_SET_COLOR_TEMPERATURE = "action.devices.commands.ColorAbsolute";
const REQUEST_SET_MODE = "action.devices.commands.SetModes";
const REQUEST_ON_OFF = "action.devices.commands.OnOff";
const REQUEST_SET_TARGET_TEMPERATURE = "action.devices.commands.ThermostatTemperatureSetpoint";

//NOT WORKING?
const REQUEST_INCREMENT_PERCENTAGE = "IncrementPercentageRequest";
const RESPONSE_INCREMENT_PERCENTAGE = "IncrementPercentageConfirmation";
const REQUEST_DECREMENT_PERCENTAGE = "DecrementPercentageRequest";
const RESPONSE_DECREMENT_PERCENTAGE = "DecrementPercentageConfirmation";
const RESPONSE_SET_TARGET_TEMPERATURE = "SetTargetTemperatureConfirmation";
const REQUEST_INCREMENT_TARGET_TEMPERATURE = "IncrementTargetTemperatureRequest";
const RESPONSE_INCREMENT_TARGET_TEMPERATURE = "IncrementTargetTemperatureConfirmation";
const REQUEST_DECREMENT_TARGET_TEMPERATURE = "DecrementTargetTemperatureRequest";
const RESPONSE_DECREMENT_TARGET_TEMPERATURE = "DecrementTargetTemperatureConfirmation";
const REQUEST_SET_COLOR = "SetColorRequest";
const RESPONSE_SET_COLOR = "SetColorConfirmation";
const REQUEST_INCREMENT_COLOR_TEMPERATURE = "IncrementColorTemperatureRequest";
const RESPONSE_INCREMENT_COLOR_TEMPERATURE = "IncrementColorTemperatureConfirmation";
const REQUEST_DECREMENT_COLOR_TEMPERATURE = "DecrementColorTemperatureRequest";
const RESPONSE_DECREMENT_COLOR_TEMPERATURE = "DecrementColorTemperatureConfirmation";

// errors
const ERROR_NO_SUCH_TARGET = "NoSuchTargetError";
const ERROR_VALUE_OUT_OF_RANGE = "ValueOutOfRangeError";
const ERROR_NOT_SUPPORTED_IN_CURRET_MODE = "NotSupportedInCurrentModeError";
const ERROR_UNSUPPORTED_OPERATION = "UnsupportedOperationError";
const ERROR_UNSUPPORTED_TARGET = "UnsupportedTargetError";
const ERROR_UNEXPECTED_INFO = "UnexpectedInformationReceivedError";
const ERROR_INVALID_ACCESS_TOKEN = "InvalidAccessTokenError";


let accepted_token;
let expires = 0;
var verifyToken = function (request, callback) {
    const event = request.body;
    let authToken = authProvider.getAccessToken(request);
    if (!datastore.isValidAuth(authToken)) {
        callback(createError(ERROR_INVALID_ACCESS_TOKEN), ERROR_INVALID_ACCESS_TOKEN);
        return;
    }
    handler.bind(this)(event, callback);
    return;
    let token;
    if (event.payload)
        token = event.payload.accessToken;
    else if (event.session)
        token = undefined;

    if (token === accepted_token && Date.now() < expires) {

    } else {
        log.error('event not supported');
        callback(createError(ERROR_UNSUPPORTED_OPERATION), ERROR_UNSUPPORTED_OPERATION);
    }

}

// entry
var handler = function (event, callback) {
    log2("Received Directive", event);

    let response = null;

    if (!event.requestId) {
        //handleCustom - used in alexa-fhem
        return;
    }

    const input = event.inputs[0];
    const requestedNamespace = input.intent;

    try {

        switch (requestedNamespace) {

            case NAMESPACE_DISCOVERY:
                response = handleDiscovery.bind(this)();
                break;

            case NAMESPACE_CONTROL:
                response = handleControl.bind(this)(event, input);
                break;

            case NAMESPACE_QUERY:
                response = handleQuery.bind(this)(input);
                break;

            default:
                log2("Error", "Unsupported namespace: " + requestedNamespace);

                response = handleUnexpectedInfo(requestedNamespace);

                break;

        }// switch

    } catch (error) {

        log2("Error", error);

    }// try-catch

    callback(createDirective(event, response));
    //return response;

}// exports.handler


var handleDiscovery = function () {
    const payload = {
        devices: []
    };

    for (let d in this.devices) {
        const device = this.devices[d];

        if (0 && !device.isOfType('light') && !device.isOfType('thermostat')) {
            log.info('ignoring ' + device.name + ' for alxea ha skill');
            continue;
        }

        //const room = this.roomOfIntent[oauthClientId];
        //if( room && room !== device.ghomeRoom ) {
        /*if (room && !device.ghomeRoom.match('(^|,)(' + room + ')(,|\$)')) {
            log.debug('ignoring ' + device.name + ' in room ' + device.ghomeRoom + ' for echo in room ' + room);
        }*/

        if (device.mappings.On
            || device.mappings.Brightness || device.mappings.TargetPosition
            || device.mappings.Hue || device.mappings.Modes
            || device.mappings['00001001-0000-1000-8000-135D67EC4377'] //Volume
            || device.mappings['4648454d-0301-686F-6D65-627269646765'] //ColorTemperature
            || device.mappings.CurrentTemperature
            || device.mappings.TargetTemperature) {
            //console.log(device);
            d = {
                id: device.uuid_base.replace(/[^\w_\-=#;:?@&]/g, '_'),
                deviceInfo: {
                    manufacturer: 'FHEM_' + device.type,
                    model: (device.model ? device.model : '<unknown>')
                },
                name: {
                    name: device.ghomeName
                },
                willReportState: true,
                traits: [],
                customData: {device: device.device},
            };

            if (device.mappings.On) {
                if (device.service_name === 'light' || device.service_name === 'blind') {
                    d.type = 'action.devices.types.LIGHT';
                } else {
                    d.type = 'action.devices.types.SWITCH';
                }
                d.traits.push("action.devices.traits.OnOff");
            }

            if (device.mappings.Brightness || device.mappings.TargetPosition || device.mappings['00001001-0000-1000-8000-135D67EC4377']) {
                d.traits.push("action.devices.traits.Brightness");
            }
            
			//console.log("add modes");
            //action.devices.traits.Modes
            if (device.mappings.Modes)
                addAttributesModes(device, d);
			//console.log("add modes FINISHED");

            if (device.mappings.TargetTemperature) {
                d.type = 'action.devices.types.THERMOSTAT';
                d.attributes = {
                    thermostatTemperatureUnit: 'C',
                    availableThermostatModes: 'off,heat,on'
                }
                d.traits.push("action.devices.traits.TemperatureSetting");
            }

            if (device.mappings.Hue) {
                d.traits.push("action.devices.traits.ColorSpectrum");
            }

            if (device.mappings['4648454d-0301-686F-6D65-627269646765']) {
                d.traits.push("action.devices.traits.ColorTemperature");
            }

            payload.devices.push(d);
        }
    }

    return payload;
}// handleDiscovery

//### action.devices.traits.Modes START ###
//action.devices.traits.Modes: ATTRIBUTES
var addAttributesModes = function (device, d) {
    if (device.service_name === 'vacuum') {
        d.type = 'action.devices.types.VACUUM';
		console.log("1: "+device.mappings.Modes[0].reading);
		let availableModesList = [];
		device.mappings.Modes.forEach(function(mode) {
			console.log("2");
			console.log(mode.mode_attributes);
			availableModesList.push(mode.mode_attributes);
			console.log("3");
		});
		console.log("4");
        d.attributes = {
            availableModes: availableModesList
        };
    }
    d.traits.push("action.devices.traits.Modes");
}

//action.devices.traits.Modes: STATES
var queryModes = function (devices, device, d) {
	devices[d.id].currentModeSettings = {};
    device.mappings.Modes.forEach(function(mode) {
        let currentMode = device.fhem.cached(mode.informId);
		devices[d.id].currentModeSettings[mode.mode_attributes.name] = currentMode;
    });
}

//action.devices.traits.Modes: COMMANDS
var handleControlSetMode = function (cmd, event) {

    let deviceIds = [];
    
    cmd.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
        if (!device)
            return handleUnsupportedOperation();

		log.info(event.params.updateModeSettings);
		for (let mode in Object.keys(event.params.updateModeSettings)) {
			value = event.params.updateModeSettings[mode];
			for (let mappingMode in device.mappings.Modes) {
				if (mappingMode.mode_attributes.name == mode) {
					device.command(mappingMode, value);
					
					ret = [{
						states: {
							currentModeSettings: {
							}
						},
						status: 'success',
						ids: deviceIds
					}];
					ret.states.currentModeSettings[mappingMode] = value;
					return ret;
				}
			}
		}
        deviceIds.push(d.id);
    });

    return handleUnsupportedOperation();
}//handleControlSetMode
//### action.devices.traits.Modes END ###

var handleControl = function (event, input) {

    let responses = [];

    input.payload.commands.forEach((cmd) => {
        cmd.execution.forEach((exec) => {

            const requestedName = exec.command;

            switch (requestedName) {

                case REQUEST_ON_OFF :
                    responses.push(...handleControlOnOff.bind(this)(cmd, exec.params.on ? 1 : 0));
                    break;

                case REQUEST_SET_BRIGHTNESSABSOLUTE :
                    responses.push(...handleControlSetPercentage.bind(this)(cmd, exec.params.brightness));
                    break;

                case REQUEST_INCREMENT_PERCENTAGE :
                    responses.push(...handleControlIncrementPercentage.bind(this)(event));
                    break;

                case REQUEST_DECREMENT_PERCENTAGE :
                    responses.push(...handleControlDecrementPercentage.bind(this)(event));
                    break;

                case REQUEST_SET_COLOR_TEMPERATURE:
                    responses.push(...handleControlSetColorTemperature.bind(this)(cmd, exec.params.color.temperature));
                    break;

                case REQUEST_SET_TARGET_TEMPERATURE :
                    responses.push(...handleControlSetTargetTemperature.bind(this)(cmd, exec.params.thermostatTemperatureSetpoint));
                    break;

                case REQUEST_INCREMENT_TARGET_TEMPERATURE :
                    responses.push(...handleControlIncrementTargetTemperature.bind(this)(event));
                    break;

                case REQUEST_DECREMENT_TARGET_TEMPERATURE :
                    responses.push(...handleControlDecrementTargetTemperature.bind(this)(event));
                    break;

                case REQUEST_INCREMENT_TARGET_TEMPERATURE :
                    responses.push(...handleControlIncrementTargetTemperature.bind(this)(event));
                    break;

                case REQUEST_DECREMENT_TARGET_TEMPERATURE :
                    responses.push(...handleControlDecrementTargetTemperature.bind(this)(event));
                    break;
                    
                //action.devices.traits.Modes: COMMANDS
                case REQUEST_SET_MODE:
                    responses.push(...handleControlSetMode.bind(this)(cmd, event));
                    break;
                    
                default:
                    log2("Error", "Unsupported operation" + requestedName);
                    break;

            }// switch
        })
    });

    //create response payload
    let res = {commands: responses};
    return res;

}; // handleControl

var handleQuery = function (input) {
    let response = null;

    let devices = {};

    input.payload.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
		
        // If there is a current or a target temperature, we probably have a thermostat
        if (device.mappings.CurrentTemperature || device.mappings.TargetTemperature) {
            const currentTemp = parseFloat(device.fhem.cached(device.mappings.CurrentTemperature.informId));
            const desiredTemp = parseFloat(device.fhem.cached(device.mappings.TargetTemperature.informId));
            devices[d.id] = {
                online: true,
                thermostatMode: 'heat',
                thermostatTemperatureSetpoint: desiredTemp
            };
			if (currentTemp) {
				devices[d.id].thermostatTemperatureAmbient = currentTemp
			}
            if (device.mappings.CurrentRelativeHumidity) {
                devices[d.id].thermostatHumidityAmbient = parseFloat(device.fhem.cached(device.mappings.CurrentRelativeHumidity.informId));
            }
        }
		
		if (device.mappings.On) {
            const turnedOn = device.fhem.cached(device.mappings.On.informId);
            devices[d.id] = {
                online: true,
                on: turnedOn === "on"
            }
        }
		
        //action.devices.traits.Modes: STATES
        if (device.mappings.Modes) {
            queryModes(devices, device, d);
        }

        if (device.mappings.Brightness) {
            // Brightness range is 0..254
            devices[d.id].brightness = (parseFloat(device.fhem.cached(device.mappings.Brightness.informId)) / 254) * 100
        }
    });

    return {devices: devices};
} //handleQuery


// TODO not yet supported
const handleControlSetColorTemperature = function (cmd, temperature) {
    let deviceIds = [];
    cmd.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
    });
}; // handleControlSetColorTemperature

var handleControlOnOff = function (cmd, state) {
    let successIds = [];
    let failedIds = [];

    cmd.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
        if (!device) {
            failedIds.push(d.id)
        } else {
            successIds.push(d.id)
            device.command(device.mappings.On, state);
        }
    });

    let res = [];

    if (successIds.length > 0) {
        res.push({
            ids: successIds,
            status: 'SUCCESS',
            states: {
                on: true,
                online: true
            }
        })
    }

    if (failedIds.length > 0) {
        res.push({
            ids: failedIds,
            status: 'ERROR',
            errorCode: 'deviceTurnedOff'
        })
    }

    return res;

}// handleControlTurnOff


var handleControlSetPercentage = function (cmd, brightness) {
    let deviceIds = [];

    cmd.devices.forEach((d) => {
        const device = this.devices[d.customData.device.toLowerCase()];
        if (!device)
            return [];

        let mapping;
        if (device.mappings.Brightness)
            mapping = device.mappings.Brightness;
        else if (device.mappings.TargetPosition)
            mapping = device.mappings.TargetPosition;
        else if (device.mappings['00001001-0000-1000-8000-135D67EC4377'])
            mapping = device.mappings['00001001-0000-1000-8000-135D67EC4377'];
        else
            return [];

        let target = brightness;
        if (mapping.minValue && target < mapping.minValue)
            target = mapping.minValue;
        else if (mapping.maxValue && target > mapping.maxValue)
            target = mapping.maxValue;

        device.command(mapping, parseInt(target));
        deviceIds.push(d.id);
    });

    return [{
        ids: deviceIds,
        status: 'SUCCESS',
        states: {
            brightness: brightness
        }
    }];

}// handleControlSetPercentage


var handleControlIncrementPercentage = function (event) {

    var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
    if (!device)
        return createError(ERROR_UNSUPPORTED_OPERATION);

    var mapping;
    if (device.mappings.Brightness)
        mapping = device.mappings.Brightness;
    else if (device.mappings.TargetPosition)
        mapping = device.mappings.TargetPosition;
    else if (device.mappings['00001001-0000-1000-8000-135D67EC4377'])
        mapping = device.mappings['00001001-0000-1000-8000-135D67EC4377'];
    else
        return createError(ERROR_UNSUPPORTED_OPERATION);
    var current = parseFloat(device.fhem.cached(mapping.informId));

    var target = current + event.payload.deltaPercentage.value;
    if (target < 0 || target > 100)
        return createError(ERROR_VALUE_OUT_OF_RANGE, {minimumValue: 0, maximumValue: 100});
    else if (mapping.minValue && target < mapping.minValue)
        target = mapping.minValue
    else if (mapping.maxValue && target > mapping.maxValue)
        target = mapping.maxValue

    device.command(mapping, target);


    var header = createHeader(NAMESPACE_CONTROL, RESPONSE_INCREMENT_PERCENTAGE);

    return createDirective(header, {});

}// handleControlIncrementPercentage


var handleControlDecrementPercentage = function (event) {

    var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
    if (!device)
        return createError(ERROR_UNSUPPORTED_OPERATION);

    var mapping;
    if (device.mappings.Brightness)
        mapping = device.mappings.Brightness;
    else if (device.mappings.TargetPosition)
        mapping = device.mappings.TargetPosition;
    else if (device.mappings['00001001-0000-1000-8000-135D67EC4377'])
        mapping = device.mappings['00001001-0000-1000-8000-135D67EC4377'];
    else
        return createError(ERROR_UNSUPPORTED_OPERATION);
    var current = parseFloat(device.fhem.cached(mapping.informId));

    var target = current - event.payload.deltaPercentage.value;
    if (target < 0 || target > 100)
        return createError(ERROR_VALUE_OUT_OF_RANGE, {minimumValue: 0, maximumValue: 100});
    else if (mapping.minValue && target < mapping.minValue)
        target = mapping.minValue
    else if (mapping.maxValue && target > mapping.maxValue)
        target = mapping.maxValue

    device.command(mapping, target);


    var header = createHeader(NAMESPACE_CONTROL, RESPONSE_DECREMENT_PERCENTAGE);

    return createDirective(header, {});

}// handleControlDecrementPercentage

var handleControlSetTargetTemperature = function (cmd, targetTemperature) {

    let deviceIds = [];
    let current = 0;
    let humidity = 0;

    cmd.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
        if (!device)
            return handleUnsupportedOperation();

        current = parseFloat(device.fhem.cached(device.mappings.TargetTemperature.informId));
        if (device.mappings.CurrentRelativeHumidity)
            humidity = parseFloat(device.fhem.cached(device.mappings.CurrentRelativeHumidity.informId));
        else
            humidity = 0

        let min = device.mappings.TargetTemperature.minValue;
        if (min === undefined) min = 15.0;
        let max = device.mappings.TargetTemperature.maxValue;
        if (max === undefined) max = 30.0;

        if (targetTemperature < min || targetTemperature > max)
            return createError(ERROR_VALUE_OUT_OF_RANGE, {minimumValue: min, maximumValue: max});

        device.command(device.mappings.TargetTemperature, targetTemperature);
        deviceIds.push(d.id);
    });

    return [{
        states: {
            thermostatMode: 'heat',
            thermostatTemperatureSetpoint: targetTemperature,
            thermostatTemperatureAmbient: current,
            thermostatHumidityAmbient: humidity
        },
        status: 'success',
        ids: deviceIds
    }];

}// handleControlSetTargetTemperature


var handleControlIncrementTargetTemperature = function (event) {

    var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
    if (!device)
        return handleUnsupportedOperation();

    var current = parseFloat(device.fhem.cached(device.mappings.TargetTemperature.informId));
    var target = current + event.payload.deltaTemperature.value;

    var min = device.mappings.TargetTemperature.minValue;
    if (min === undefined) min = 15.0;
    var max = device.mappings.TargetTemperature.maxValue;
    if (max === undefined) max = 30.0;

    if (target < min || target > max)
        return createError(ERROR_VALUE_OUT_OF_RANGE, {minimumValue: min, maximumValue: max});

    device.command(device.mappings.TargetTemperature, target);


    var header = createHeader(NAMESPACE_CONTROL, RESPONSE_INCREMENT_TARGET_TEMPERATURE);

    var payload = {
        targetTemperature: {value: target},
        //temperatureMode: { value: 'AUTO' },
        previousState: {
            targetTemperature: {value: current},
            //mode: { value: 'AUTO' },
        }
    };

    return createDirective(header, payload);

}// handleControlIncrementTargetTemperature


var handleControlDecrementTargetTemperature = function (event) {

    var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
    if (!device)
        return handleUnsupportedOperation();

    var current = parseFloat(device.fhem.cached(device.mappings.TargetTemperature.informId));
    var target = current - event.payload.deltaTemperature.value;

    var min = device.mappings.TargetTemperature.minValue;
    if (min === undefined) min = 15.0;
    var max = device.mappings.TargetTemperature.maxValue;
    if (max === undefined) max = 30.0;

    if (target < min || target > max)
        return createError(ERROR_VALUE_OUT_OF_RANGE, {minimumValue: min, maximumValue: max});

    device.command(device.mappings.TargetTemperature, target);


    var header = createHeader(NAMESPACE_CONTROL, RESPONSE_DECREMENT_TARGET_TEMPERATURE);

    var payload = {
        targetTemperature: {value: target},
        //temperatureMode: { value: 'AUTO' },
        previousState: {
            targetTemperature: {value: current},
            //mode: { value: 'AUTO' },
        }
    };

    return createDirective(header, payload);

}// handleControlDecrementTargetTemperature


var handleUnsupportedOperation = function () {

    var header = createHeader(NAMESPACE_CONTROL, ERROR_UNSUPPORTED_OPERATION);

    return createDirective(header, {});

}// handleUnsupportedOperation


var handleUnexpectedInfo = function (fault) {

    var header = createHeader(NAMESPACE_CONTROL, ERROR_UNEXPECTED_INFO);

    var payload = {
        faultingParameter: fault
    };

    return createDirective(header, payload);

}// handleUnexpectedInfo


// support functions

var createMessageId = function () {

    var d = new Date().getTime();

    var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {

        var r = (d + Math.random() * 16) % 16 | 0;

        d = Math.floor(d / 16);

        return (c == 'x' ? r : (r & 0x3 | 0x8)).toString(16);

    });

    return uuid;

}// createMessageId


var createHeader = function (namespace, name) {

    return {
        name: name,
        payloadVersion: '2',
        namespace: namespace,
        messageId: createMessageId(),
    };

}// createHeader


var createDirective = function (event, payload) {

    return {
        requestId: event.requestId,
        payload: payload
    };

}// createDirective

var createError = function (error, payload) {

    if (payload === undefined)
        payload = {};

    return {
        header: createHeader(NAMESPACE_CONTROL, error),
        payload: payload,
    };
}// createError


var log2 = function (title, msg) {

    console.log('**** ' + title + ': ' + JSON.stringify(msg));

}// log
