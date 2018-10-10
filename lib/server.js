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
                //console.log(event);
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
            log.error('NAT-UPNP failed: ' + err);
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
    this.connections = [];
    for (var connection of this._config.connections) {
        var fhem = new FHEM(Logger.withPrefix(connection.name), connection);
        //fhem.on( 'DEFINED', function() {log.error( 'DEFINED' )}.bind(this) );

        fhem.on('RELOAD', function (fhem, n, callback) {
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
                    if (callback)
                        callback();
                }.bind(this, fhem), 'NAME=' + n);
            } else {
                for (var fhem of this.connections) {
                    fhem.connect(function (fhem, devices) {
                        for (var device of devices) {
                            this.addDevice(device, fhem);
                        }
                        if (callback)
                            callback();
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
const NAMESPACE_SYNC = "action.devices.SYNC";
const NAMESPACE_EXECUTE = "action.devices.EXECUTE";
const NAMESPACE_QUERY = "action.devices.QUERY";

// trait commands => https://developers.google.com/actions/smarthome/traits/
const REQUEST_SET_BRIGHTNESSABSOLUTE = "action.devices.commands.BrightnessAbsolute";
const REQUEST_SET_COLOR_TEMPERATURE = "action.devices.commands.ColorAbsolute";
const REQUEST_SET_MODE = "action.devices.commands.SetModes";
const REQUEST_ON_OFF = "action.devices.commands.OnOff";
const REQUEST_SET_TARGET_TEMPERATURE = "action.devices.commands.ThermostatTemperatureSetpoint";
const REQUEST_SET_THERMOSTAT_MODE = "action.devices.commands.ThermostatSetMode";
const REQUEST_DOCK = "action.devices.commands.Dock";
const REQUEST_LOCATE = "action.devices.commands.Locate";
const REQUEST_STARTSTOP = "action.devices.commands.StartStop";
const REQUEST_PAUSEUNPAUSE = "action.devices.commands.PauseUnpause";
const REQUEST_FANSPEED = "action.devices.commands.SetFanSpeed";
const REQUEST_FANSPEEDREVERSE = "action.devices.commands.Reverse";

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

            case NAMESPACE_SYNC:
                //reload all devices and SYNC afterwards
                for (var fhem of this.connections) {
                    fhem.emit('RELOAD', undefined, function() {
                        response = handleSYNC.bind(this)();
                        callback(createDirective(event, response));
                    }.bind(this));
                }
                return;

            case NAMESPACE_EXECUTE:
                response = handleEXECUTE.bind(this)(event, input);
                break;

            case NAMESPACE_QUERY:
                response = handleQUERY.bind(this)(input);
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

var handleSYNC = function () {
    const payload = {
        devices: []
    };

    for (let d in this.devices) {
        const device = this.devices[d];

        if (device.mappings.On
            || device.mappings.Modes
            || device.mappings.Volumme
            || device.mappings.Brightness
            || device.mappings.TargetPosition
            || device.mappings.Hue
            || device.mappings.ColorTemperature
            || device.mappings.CurrentTemperature
            || device.mappings.TargetTemperature
            || device.mappings.StartStop
            || device.mappings.Dock
            || device.mappings.Locate) {
            //console.log(device);
            
            log2("Start handling ", device.ghomeName);
            
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
                attributes: {},
                customData: {device: device.device},
            };

            //roomHint
            if (device.ghomeRoom)
                d.roomHint = device.ghomeRoom;

            //DEVICE TYPE
            if (device.service_name) {
                if (device.service_name === 'vacuum') {
                    d.type = 'action.devices.types.VACUUM';
                } else if (device.service_name === 'light' || device.service_name === 'blind') {
                    d.type = 'action.devices.types.LIGHT';
                } else if (device.service_name === 'switch' || device.service_name === 'contact') {
                    d.type = 'action.devices.types.SWITCH';
                } else if (device.service_name === 'thermostat') {
                    d.type = 'action.devices.types.THERMOSTAT';
                } else {
                    log.error("genericDeviceType " + device.service_name + " not support in ghome-fhem");
                    continue;
                }
            } else {
                if (device.mappings.TargetTemperature) {
                    d.type = 'action.devices.types.THERMOSTAT';
                } else if (device.mappings.Brightness || device.mappings.Hue) {
                    d.type = 'action.devices.types.LIGHT';
                } else {
                    d.type = 'action.devices.types.SWITCH';
                }
            }

            //TRAITS
            if (device.mappings.On) {
                d.traits.push("action.devices.traits.OnOff");
            }

            if (device.mappings.Brightness || device.mappings.TargetPosition || device.mappings.Volume) {
                //FIXME Attributes?
                d.traits.push("action.devices.traits.Brightness");
            }

            //StartStop
            if (device.mappings.StartStop) {
                d.traits.push("action.devices.traits.StartStop");
                //Attributes
                d.attributes.pausable = true;
            }
            
            //FanSpeed
            if (device.mappings.FanSpeed) {
                d.traits.push("action.devices.traits.FanSpeed");
                //Attributes
                d.attributes.availableFanSpeed = device.mappings.FanSpeed.speed_attributes;
                d.attributes.reversible = device.mappings.FanSpeed.reversible;
            }

            if (device.service_name === 'vacuum') {
                d.traits.push("action.devices.traits.Dock");
                d.traits.push("action.devices.traits.Locator");
            }

            //Modes
            if (device.mappings.Modes) {
                d.traits.push("action.devices.traits.Modes");
                //Attributes
                addAttributesModes(device, d);
            }

            if (device.mappings.TargetTemperature) {
                d.attributes = {
                    thermostatTemperatureUnit: 'C',
                    availableThermostatModes: 'off,heat,on'
                }
                d.traits.push("action.devices.traits.TemperatureSetting");
            }

            if (device.mappings.Hue) {
                d.traits.push("action.devices.traits.ColorSpectrum");
            }

            if (device.mappings.ColorTemperature) {
                d.traits.push("action.devices.traits.ColorTemperature");
            }
            log2("End handling device: ", d);

            payload.devices.push(d);
        }
    }

    return payload;
}// handleSYNC

//### action.devices.traits.Modes START ###
//action.devices.traits.Modes: ATTRIBUTES
var addAttributesModes = function (device, d) {
		let availableModesList = [];
		device.mappings.Modes.forEach(function(mode) {
			availableModesList.push(mode.mode_attributes);
		});
		
    d.attributes.availableModes = availableModesList;
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
var handleEXECUTESetMode = function (cmd, event) {

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
}//handleEXECUTESetMode
//### action.devices.traits.Modes END ###

var handleEXECUTE = function (event, input) {

    let responses = [];

    input.payload.commands.forEach((cmd) => {
        cmd.execution.forEach((exec) => {

            const requestedName = exec.command;

            switch (requestedName) {

                case REQUEST_ON_OFF :
                    responses.push(...handleEXECUTEOnOff.bind(this)(cmd, exec.params.on ? 1 : 0));
                    break;

                case REQUEST_SET_BRIGHTNESSABSOLUTE :
                    responses.push(...handleEXECUTESetPercentage.bind(this)(cmd, exec.params.brightness));
                    break;

                case REQUEST_SET_COLOR_TEMPERATURE:
                    responses.push(...handleEXECUTESetColorTemperature.bind(this)(cmd, exec.params.color.temperature));
                    break;

                case REQUEST_SET_TARGET_TEMPERATURE:
                    responses.push(...handleEXECUTESetTargetTemperature.bind(this)(cmd, exec.params.thermostatTemperatureSetpoint));
                    break;

                case REQUEST_SET_THERMOSTAT_MODE:
                    responses.push(...handleEXECUTESetThermostatMode.bind(this)(cmd, exec.params.thermostatMode));
                    break;

                case REQUEST_DOCK:
                    responses.push(...handleEXECUTEDock.bind(this)(cmd));
                    break;
                    
                case REQUEST_LOCATE:
                    responses.push(...handleEXECUTELocate.bind(this)(cmd));
                    break;
                    
                case REQUEST_STARTSTOP:
                    responses.push(...handleEXECUTEStartStop.bind(this)(cmd, exec.params.start ? 1 : 0));
                    break;

                case REQUEST_PAUSEUNPAUSE:
                    responses.push(...handleEXECUTEPauseUnpause.bind(this)(cmd, exec.params.pause ? 1 : 0));
                    break;

                case REQUEST_FANSPEED:
                    responses.push(...handleEXECUTESetFanSpeed.bind(this)(cmd, exec.params.fanSpeed));
                    break;

                case REQUEST_FANSPEEDREVERSE:
                    //responses.push(...handleEXECUTEReverse.bind(this)(cmd, exec.params.reverse));
                    break;

                //action.devices.traits.Modes: COMMANDS
                case REQUEST_SET_MODE:
                    responses.push(...handleEXECUTESetMode.bind(this)(cmd, exec));
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

}; // handleEXECUTE

var handleQUERY = function (input) {
    let response = null;

    let devices = {};

    input.payload.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
        log2("QUERY", device.name);
		
        // If there is a current or a target temperature, we probably have a thermostat
        if (device.mappings.CurrentTemperature || device.mappings.TargetTemperature) {
            const desiredTemp = parseFloat(device.fhem.cached(device.mappings.TargetTemperature.informId));
            let thermostatMode = 'heat';
            if (desiredTemp == device.mappings.TargetTemperature.minValue) {
                thermostatMode = 'off';
            }
            devices[d.id] = {
                online: true,
                thermostatMode: thermostatMode,
                thermostatTemperatureSetpoint: desiredTemp
            };
      			
      			if (device.mappings.CurrentTemperature) {
                const currentTemp = parseFloat(device.fhem.cached(device.mappings.CurrentTemperature.informId));
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
        
        //action.devices.traits.FanSpeed
        if (device.mappings.FanSpeed) {
            //FIXME: Low and High are not allowed to be used here
            devices[d.id].currentFanSpeedSetting = device.fhem.cached(device.mappings.FanSpeed.informId);
        }
        
        if (device.mappings.Dock) {
            devices[d.id].isDocked = device.fhem.cached(device.mappings.Dock.informId) == 'Docked' ? true : false;
        }

        if (device.mappings.Brightness) {
            // Brightness range is 0..254
            devices[d.id].brightness = (parseFloat(device.fhem.cached(device.mappings.Brightness.informId)) / 254) * 100
        }
        
        if (device.mappings.StartStop) {
            devices[d.id].isPaused = device.fhem.cached(device.mappings.StartStop.informId) == 'Paused' ? true : false;
            devices[d.id].isRunning = device.fhem.cached(device.mappings.StartStop.informId) == 'Cleaning' ? true : false;
        }
    });

    return {devices: devices};
} //handleQUERY


// TODO not yet supported
const handleEXECUTESetColorTemperature = function (cmd, temperature) {
    let deviceIds = [];
    cmd.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
    });
}; // handleEXECUTESetColorTemperature

var handleEXECUTEPauseUnpause = function(cmd, pause) {
    let deviceIds = [];
    
    cmd.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
        if (!device)
          return handleUnsupportedOperation();

        device.command(device.mappings.StartStop, pause, 'PauseUnpause');
        deviceIds.push(d.id);
    });

    return [{
        states: {
            isPaused: pause
        },
        status: 'success',
        ids: deviceIds
    }];
}; //handleEXECUTEPauseUnpause

var handleEXECUTESetFanSpeed = function(cmd, speedname) {
    let deviceIds = [];
    
    cmd.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
        if (!device)
          return handleUnsupportedOperation();

        device.command(device.mappings.FanSpeed, speedname);
        deviceIds.push(d.id);
    });

    return [{
        states: {
            currentFanSpeedSetting: speedname
        },
        status: 'success',
        ids: deviceIds
    }];
}; //handleEXECUTEPauseUnpause

var handleEXECUTEStartStop = function(cmd, start) {
    let deviceIds = [];
    console.log('cmd: ' + cmd);
    console.log(JSON.stringify(cmd));
    cmd.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
        if (!device)
          return handleUnsupportedOperation();

        device.command(device.mappings.StartStop, start);
        deviceIds.push(d.id);
    });

    return [{
        states: {
            isRunning: start
        },
        status: 'success',
        ids: deviceIds
    }];
}; //handleEXECUTEStartStop

var handleEXECUTELocate = function(cmd) {
    let deviceIds = [];
    
    cmd.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
        if (!device)
          return handleUnsupportedOperation();

        device.command(device.mappings.Locate, '');
        deviceIds.push(d.id);
    });

    return [{
        states: {
            generatedAlert: true
        },
        status: 'success',
        ids: deviceIds
    }];
}; //handleEXECUTELocate

var handleEXECUTEDock = function(cmd) {
    let deviceIds = [];
    
    cmd.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
        if (!device)
          return handleUnsupportedOperation();

        device.command(device.mappings.Dock, '');
        deviceIds.push(d.id);
    });

    return [{
        states: {
            isDocked: true
        },
        status: 'success',
        ids: deviceIds
    }];
}; //handleEXECUTEDock

var handleEXECUTEOnOff = function (cmd, state) {
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

}// handleEXECUTETurnOff


var handleEXECUTESetPercentage = function (cmd, brightness) {
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
        else if (device.mappings.Volume)
            mapping = device.mappings.Volume;
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

}; // handleEXECUTESetPercentage

var handleEXECUTESetThermostatMode = function (cmd, thermostatMode) {
    let deviceIds = [];

    cmd.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
        if (!device)
            return handleUnsupportedOperation();

        let value = 21;
        if (thermostatMode == 'off') {
            if (device.mappings.TargetTemperature.minValue)
                value = device.mappings.TargetTemperature.minValue;
            else
                value = 4.5;
        }
        device.command(device.mappings.TargetTemperature, value);
        deviceIds.push(d.id);
    });

    return [{
        states: {
            thermostatMode: thermostatMode
        },
        status: 'success',
        ids: deviceIds
    }];
};

var handleEXECUTESetTargetTemperature = function (cmd, targetTemperature) {

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
            thermostatTemperatureSetpoint: targetTemperature
        },
        status: 'success',
        ids: deviceIds
    }];

}; // handleEXECUTESetTargetTemperature

var handleUnsupportedOperation = function () {

    var header = createHeader(NAMESPACE_EXECUTE, ERROR_UNSUPPORTED_OPERATION);

    return createDirective(header, {});

}// handleUnsupportedOperation


var handleUnexpectedInfo = function (fault) {

    var header = createHeader(NAMESPACE_EXECUTE, ERROR_UNEXPECTED_INFO);

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
        header: createHeader(NAMESPACE_EXECUTE, error),
        payload: payload,
    };
}// createError


var log2 = function (title, msg) {

    console.log('**** ' + title + ': ' + JSON.stringify(msg));

}// log
