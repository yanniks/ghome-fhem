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

    device.ghomeName = device.ghomeName.replace(/\+/g, ' ');
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

                delete this.devices[d];
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
const REQUEST_SET_MODES = "action.devices.commands.SetModes";
const REQUEST_ON_OFF = "action.devices.commands.OnOff";
const REQUEST_SET_TARGET_TEMPERATURE = "action.devices.commands.ThermostatTemperatureSetpoint";
const REQUEST_SET_THERMOSTAT_MODE = "action.devices.commands.ThermostatSetMode";
const REQUEST_DOCK = "action.devices.commands.Dock";
const REQUEST_LOCATE = "action.devices.commands.Locate";
const REQUEST_STARTSTOP = "action.devices.commands.StartStop";
const REQUEST_PAUSEUNPAUSE = "action.devices.commands.PauseUnpause";
const REQUEST_FANSPEED = "action.devices.commands.SetFanSpeed";
const REQUEST_FANSPEEDREVERSE = "action.devices.commands.Reverse";
const REQUEST_COLORABSOLUTE = "action.devices.commands.ColorAbsolute";
const REQUEST_SET_TOGGLES = "action.devices.commands.SetToggles";
const REQUEST_ACTIVATE_SCENE = "action.devices.commands.ActivateScene";

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
    //get user id - decode JWT token and check group membership
    let userId = authToken;
    if (!datastore.isValidAuth(authToken)) {
        callback(createError(ERROR_INVALID_ACCESS_TOKEN), ERROR_INVALID_ACCESS_TOKEN);
        return;
    }
    handler.bind(this)(userId, event, callback);
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
var handler = function (userId, event, callback) {
    log2("User", userId);
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

    for (let di in this.devices) {
        const device = this.devices[di];

        if (device.mappings.On
            || device.mappings.Modes
            || device.mappings.Toggles
            || device.mappings.Volumme
            || device.mappings.Brightness
            || device.mappings.HSVBrightness
            || device.mappings.Hue
            || device.mappings.RGB
            || device.mappings.Scene
            || device.mappings.TargetPosition
            || device.mappings.CurrentTemperature
            || device.mappings.TargetTemperature
            || device.mappings.StartStop
            || device.mappings.Dock
            || device.mappings.Locate) {
            //console.log(device);

            log2("Start handling ", device.ghomeName);
            
            let d = {
                id: device.uuid_base.replace(/[^\w_\-=#;:?@&]/g, '_'),
                deviceInfo: {
                    manufacturer: 'FHEM_' + device.type,
                    model: (device.model ? device.model : '<unknown>')
                },
                name: {
                    name: device.ghomeName
                },
                traits: [],
                attributes: {},
                customData: {device: device.device},
            };
            
            d.willReportState = !device.mappings.Scene;

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
                } else if (device.service_name === 'outlet') {
                    d.type = 'action.devices.types.OUTLET';
                } else if (device.service_name === 'thermostat') {
                    d.type = 'action.devices.types.THERMOSTAT';
                } else if (device.service_name === 'coffeemaker') {
                    d.type = 'action.devices.types.COFFEE_MAKER';
                } else if (device.service_name === 'aircondition') {
                    d.type = 'action.devices.types.AC_UNIT';
                } else if (device.service_name === 'airpurifier') {
                    d.type = 'action.devices.types.AIRPURIFIER';
                } else if (device.service_name === 'camera') {
                    d.type = 'action.devices.types.CAMERA';
                } else if (device.service_name === 'dishwasher') {
                    d.type = 'action.devices.types.DISHWASHER';
                } else if (device.service_name === 'dryer') {
                    d.type = 'action.devices.types.DRYER';
                } else if (device.service_name === 'fan') {
                    d.type = 'action.devices.types.FAN';
                } else if (device.service_name === 'kettle') {
                    d.type = 'action.devices.types.KETTLE';
                } else if (device.service_name === 'oven') {
                    d.type = 'action.devices.types.OVEN';
                } else if (device.service_name === 'refrigerator') {
                    d.type = 'action.devices.types.REFRIGERATOR';
                } else if (device.service_name === 'scene') {
                    d.type = 'action.devices.types.SCENE';
                } else if (device.service_name === 'sprinkler') {
                    d.type = 'action.devices.types.SPRINKLER';
                } else if (device.service_name === 'washer') {
                    d.type = 'action.devices.types.WASHER';
                } else {
                    log.error("genericDeviceType " + device.service_name + " not supported in ghome-fhem");
                    continue;
                }
            } else {
                if (device.mappings.TargetTemperature || device.mappings.CurrentTemperature) {
                    d.type = 'action.devices.types.THERMOSTAT';
                } else if (device.mappings.Brightness || device.mappings.Hue ||
                           device.mappings.RGB || device.mappings.TargetPosition ||
                           device.mappings.HSVBrightness) {
                    d.type = 'action.devices.types.LIGHT';
                } else if (device.mappings.Scene) {
                    d.type = 'action.devices.types.SCENE';
                } else {
                    d.type = 'action.devices.types.SWITCH';
                }
            }

            //TRAITS
            if (device.mappings.On) {
                d.traits.push("action.devices.traits.OnOff");
            }

            //Toggles
            if (device.mappings.Toggles) {
                d.traits.push("action.devices.traits.Toggles");
                //Attributes
                let availableTogglesList = [];
            		device.mappings.Toggles.forEach(function(toggle) {
            			availableTogglesList.push(toggle.toggle_attributes);
            		});
            		
                d.attributes.availableToggles = availableTogglesList;
            }

            //Brightness
            if (device.mappings.Brightness || device.mappings.TargetPosition || device.mappings.Volume) {
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

            //Dock
            if (device.mappings.Dock) {
                d.traits.push("action.devices.traits.Dock");
            }
            
            //Locate
            if (device.mappings.Locate) {
                d.traits.push("action.devices.traits.Locator");
            }

            //Modes
            if (device.mappings.Modes) {
                d.traits.push("action.devices.traits.Modes");
                //Attributes
                addAttributesModes(device, d);
            }

            //TemperatureSetting
            if (device.mappings.TargetTemperature) {
                d.attributes = {
                    //FIXME: do not define anything in server.js
                    thermostatTemperatureUnit: 'C',
                    availableThermostatModes: 'off,heat,on'
                };
                d.traits.push("action.devices.traits.TemperatureSetting");
            } else if (device.mappings.CurrentTemperature) {
                d.attributes = {
                    //FIXME: do not define anything in server.js
                    thermostatTemperatureUnit: 'C',
                    availableThermostatModes: 'off'
                };
                d.traits.push("action.devices.traits.TemperatureSetting");
            }

            //ColorSetting / ColorTemperature
            if (device.mappings.RGB) {
                d.attributes.colorModel = 'rgb';
                if (device.mappings.ColorTemperature) {
                    d.attributes.colorTemperatureRange = {
                        //FIXME get values from device mapping
                        temperatureMinK: 2000,
                        temperatureMaxK: 9000
                    };
                }
                if (device.mappings.RGB.commandOnlyColorSetting)
                    d.attributes.commandOnlyColorSetting = true;
                d.traits.push("action.devices.traits.ColorSetting");
            } else if (device.mappings.Hue) {
                d.attributes.colorModel = 'hsv';
                if (device.mappings.ColorTemperature) {
                    d.attributes.colorTemperatureRange = {
                        //FIXME get values from device mapping
                        temperatureMinK: 2000,
                        temperatureMaxK: 9000
                    };
                }
                if (device.mappings.Hue.commandOnlyColorSetting)
                    d.attributes.commandOnlyColorSetting = true;
                d.traits.push("action.devices.traits.ColorSetting");
            }

            //Scene
            if (device.mappings.Scene) {
                d.traits.push("action.devices.traits.Scene");

                //create separate device for each scene
                if (Array.isArray(device.mappings.Scene)) {
                    device.mappings.Scene.forEach(function(scene) {
                        //Attributes
                        if (scene.cmdOff) {
                            d.attributes.sceneReversible = true;
                        } else {
                            d.attributes.sceneReversible = false;
                        }
                        let d2 = {
                            id: device.uuid_base.replace(/[^\w_\-=#;:?@&]/g, '_') + '-' + scene.scenename,
                            type: 'action.devices.types.SCENE',
                            deviceInfo: {
                                manufacturer: 'FHEM_' + device.type,
                                model: (device.model ? device.model : '<unknown>')
                            },
                            name: {
                                name: scene.scenename
                            },
                            traits: ['action.devices.traits.Scene'],
                            attributes: {
                                sceneReversible: false
                            },
                            customData: {
                              device: device.device,
                              scenename: scene.scenename
                            }
                        };
                        log2("End handling scene device: ", d2);
                        payload.devices.push(d2);
                    });
                }
            } else {
                log2("End handling device: ", d);
                payload.devices.push(d);
            }
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
        let currentMode = device.fhem.cached2Format(mode);
		    devices[d.id].currentModeSettings[mode.mode_attributes.name] = currentMode;
    });
}

//action.devices.traits.Modes: COMMANDS
var handleEXECUTESetModes = function (cmd, event) {

    let deviceIds = [];
    let retArr = [];
    
    cmd.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
        if (!device)
            return handleUnsupportedOperation();

    		log.info(event.params.updateModeSettings);
    		Object.keys(event.params.updateModeSettings).forEach((mode) => {
    			let value = event.params.updateModeSettings[mode];
    			device.mappings.Modes.forEach((mappingMode) => {
    				if (mappingMode.mode_attributes.name === mode) {
    					device.command(mappingMode, value);

    					let ret = {
    						states: {
    							currentModeSettings: {
    							}
    						},
    						status: 'SUCCESS',
    						ids: [d.id]
    					};
    					ret.states.currentModeSettings[mode] = value;
    					retArr.push(ret);
    				}
    			});
    		});
    });

    return retArr;
}//handleEXECUTESetModes
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
                    responses.push(...handleEXECUTEBrightnessAbsolute.bind(this)(cmd, exec.params.brightness));
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

                case REQUEST_COLORABSOLUTE:
                    responses.push(...handleEXECUTESetColorAbsolute.bind(this)(cmd, exec.params.color));
                    break;

                case REQUEST_SET_TOGGLES:
                    responses.push(...handleEXECUTESetToggles.bind(this)(cmd, exec.params.updateToggleSettings));
                    break;

                case REQUEST_ACTIVATE_SCENE:
                    responses.push(...handleEXECUTEActivateScene.bind(this)(cmd, exec.params.deactivate));
                    break;

                case REQUEST_FANSPEEDREVERSE:
                    //responses.push(...handleEXECUTEReverse.bind(this)(cmd, exec.params.reverse));
                    break;

                //action.devices.traits.Modes: COMMANDS
                case REQUEST_SET_MODES:
                    responses.push(...handleEXECUTESetModes.bind(this)(cmd, exec));
                    break;
                    
                default:
                    log2("Error", "Unsupported operation" + requestedName);
                    break;

            }// switch
        })
    });

    //create response payload
    return {commands: responses};

}; // handleEXECUTE

var handleQUERY = function (input) {
    let response = null;

    let devices = {};

    input.payload.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
        log2("QUERY", device.name);
		
        // If there is a current or a target temperature, we probably have a thermostat
        if (device.mappings.CurrentTemperature || device.mappings.TargetTemperature) {
            devices[d.id] = {
                online: true
            };
            if (device.mappings.TargetTemperature) {
                const desiredTemp = parseFloat(device.fhem.cached2Format(device.mappings.TargetTemperature));
                let thermostatMode = 'heat';
                if (desiredTemp == device.mappings.TargetTemperature.minValue) {
                    thermostatMode = 'off';
                }
                devices[d.id].thermostatMode = thermostatMode;
                devices[d.id].thermostatTemperatureSetpoint = desiredTemp;
            } else {
                devices[d.id].thermostatMode = 'off';
            }
      			
      			if (device.mappings.CurrentTemperature) {
                const currentTemp = parseFloat(device.fhem.cached2Format(device.mappings.CurrentTemperature));
                devices[d.id].thermostatTemperatureAmbient = currentTemp;
            }

            if (device.mappings.CurrentRelativeHumidity) {
                devices[d.id].thermostatHumidityAmbient = parseFloat(device.fhem.cached2Format(device.mappings.CurrentRelativeHumidity));
            }
        }
		
		    if (device.mappings.On) {
            const turnedOn = device.fhem.cached2Format(device.mappings.On);
            devices[d.id] = {
                online: true,
                on: turnedOn
            }
        }
		
        //action.devices.traits.Modes: STATES
        if (device.mappings.Modes) {
            queryModes(devices, device, d);
        }
        
        //action.devices.traits.Toggles
        if (device.mappings.Toggles) {
            devices[d.id].currentToggleSettings = {};
            device.mappings.Toggles.forEach(function(toggle) {
                let currentToggle = device.fhem.cached2Format(toggle);
                log.info("currentToggle: " + currentToggle);
        		    devices[d.id].currentToggleSettings[toggle.toggle_attributes.name] = currentToggle == toggle.valueOn;
            });
        }
        
        //action.devices.traits.FanSpeed
        if (device.mappings.FanSpeed) {
            devices[d.id].currentFanSpeedSetting = device.fhem.cached2Format(device.mappings.FanSpeed);
        }
        
        //action.devices.traits.Dock
        if (device.mappings.Dock) {
            devices[d.id].isDocked = device.fhem.cached2Format(device.mappings.Dock);
        }
        
        //action.devices.traits.ColorSetting
        if (device.mappings.RGB) {
            devices[d.id].color = {};
            const rgb = device.fhem.cached2Format(device.mappings.RGB);
            const colormode = device.fhem.cached2Format(device.mappings.ColorMode);
            if (colormode == device.mappings.ColorMode.valueCt) {
                //color temperature mode
                devices[d.id].color.temperatureK = device.fhem.cached2Format(device.mappings.ColorTemperature);
            } else {
                //RGB mode
                devices[d.id].color.spectrumRgb = device.fhem.cached2Format(device.mappings.RGB);
            }
        } else {
            if (device.mappings.Hue) {
                //TODO get current hue value
            }
            
            if (device.mappings.Saturation) {
                //TODO get current sat value
            }
        }

        //action.devices.traits.Brightness
        if (device.mappings.Brightness) {
            // Brightness range is 0..100
            devices[d.id].brightness = device.fhem.cached2Format(device.mappings.Brightness);
        }
        
        //action.devices.traits.StartStop
        if (device.mappings.StartStop) {
            devices[d.id].isPaused = device.fhem.cached2Format(device.mappings.StartStop) == 'paused' ? true : false;
            devices[d.id].isRunning = device.fhem.cached2Format(device.mappings.StartStop) == 'running' ? true : false;
        }
    });

    return {devices: devices};
} //handleQUERY

var handleEXECUTESetToggles = function (cmd, toggleSettings) {

    let deviceIds = [];
    let retArr = [];
    
    cmd.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
        if (!device)
            return handleUnsupportedOperation();

    		log.info(toggleSettings);
    		Object.keys(toggleSettings).forEach((toggle) => {
    			let value = toggleSettings[toggle];
    			device.mappings.Toggles.forEach((mappingToggle) => {
    				if (mappingToggle.toggle_attributes.name == toggle) {
    					device.command(mappingToggle, value);

    					let ret = {
    						states: {
    							currentToggleSettings: {
    							}
    						},
    						status: 'SUCCESS',
    						ids: [d.id]
    					};
    					ret.states.currentToggleSettings[toggle] = value;
    					retArr.push(ret);
    				}
    			});
    		});
    });

    return retArr;
}//handleEXECUTESetToggles

const handleEXECUTESetColorAbsolute = function (cmd, color) {
    let deviceIds = [];
    let ret = [];
    
    cmd.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
        if (!device)
          return handleUnsupportedOperation();

        if (color.spectrumRGB) {
            device.command(device.mappings.RGB, color.spectrumRGB);
            ret.push({
                states: {
                    color: {
                        spectrumRgb: color.spectrumRGB
                    }
                },
                ids: [d.id],
                status: "SUCCESS",
                online: "true"
            });
        } else if (color.spectrumHSV) {
            //Hue
            device.command(device.mappings.Hue, color.spectrumHSV.hue);
            //Brightness
            device.command(device.mappings.HSVBrightness, color.spectrumHSV.value);
            //Saturation
            device.command(device.mappings.Saturation, color.spectrumHSV.saturation);
            ret.push({
                states: {
                    color: {
                        spectrumHsv: {
                            hue: color.spectrumHSV.hue,
                            saturation: color.spectrumHSV.saturation,
                            value: color.spectrumHSV.value
                        }
                    }
                },
                ids: [d.id],
                status: "SUCCESS",
                online: "true"
            });
        } else if (color.temperature) {
            device.command(device.mappings.ColorTemperature, color.temperature);
            ret.push({
                states: {
                    color: {
                        temperatureK: color.temperature
                    }
                },
                ids: [d.id],
                status: "SUCCESS",
                online: "true"
            });
        }
    });

    return ret;
}; // handleEXECUTESetColorAbsolute

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

var handleEXECUTEActivateScene = function(cmd, deactivate) {
    let deviceIds = [];
    
    cmd.devices.forEach((d) => {
        let device = this.devices[d.customData.device.toLowerCase()];
        if (!device)
          return handleUnsupportedOperation();

        let scenename = d.customData.scenename;
        device.mappings.Scene.forEach(function(s) {
            if (s.scenename == scenename) {
                device.command(s, deactivate ? 0 : 1);
                deviceIds.push(d.id);
            }
        });
    });

    return [{
        states: {
        },
        status: 'success',
        ids: deviceIds
    }];
}; //handleEXECUTEActivateScene

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


var handleEXECUTEBrightnessAbsolute = function (cmd, brightness) {
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

}; // handleEXECUTEBrightnessAbsolute

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

        current = parseFloat(device.fhem.cached2Format(device.mappings.TargetTemperature));
        if (device.mappings.CurrentRelativeHumidity)
            humidity = parseFloat(device.fhem.cached2Format(device.mappings.CurrentRelativeHumidity));
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
