
'use strict';

const PORT=3000;

var natpmp = require('nat-pmp');
var natupnp = require('nat-upnp');

var path = require('path');
var fs = require('fs');

var version = require('./version');

var User = require('./user').User;

var log = require("./logger")._system;
var Logger = require('./logger').Logger;

var FHEM = require('./fhem').FHEM;

module.exports = {
  Server: Server
}

function Server() {
  this._config = this._loadConfig();
  if( this._config.alexa.port === undefined )
    this._config.alexa.port = PORT;
}

Server.prototype._loadConfig = function() {

  // Look for the configuration file
  var configPath = User.configPath();
  log.info("using " + configPath );

  // Complain and exit if it doesn't exist yet
  if (!fs.existsSync(configPath)) {
    var config = {};

    config.alexa = {
      name: 'Alexa',
    };

    //return config;
      log.error("Couldn't find a config.json file at '"+configPath+"'. Look at config-sample.json for an example.");
      process.exit(1);
  }

  // Load up the configuration file
  var config;
  try {
    config = JSON.parse(fs.readFileSync(configPath));
  }
  catch (err) {
    log.error("There was a problem reading your config.json file.");
    log.error("Please try pasting your config.json file here to validate it: http://jsonlint.com");
    log.error("");
    throw err;
  }

  if( typeof config.alexa.applicationId !== 'object' )
    config.alexa.applicationId = [config.alexa.applicationId];

  if( typeof config.alexa.oauthClientID !== 'object' )
    config.alexa.oauthClientID = [config.alexa.oauthClientID];

  var username = config.alexa.username;

  log.info("---");

  return config;
}

Server.prototype.startServer = function() {
  function handleRequest(request, response){
    //console.log( request );

    var body = '';
    request.on('data', function(chunk){body += chunk});
    request.on('end', function() {
      if( 1 ) {
        try {
          var event = JSON.parse(body);
          //console.log(event);
          verifyToken.bind(this)(event, function(ret, error) {
            if( error )
              log.error( 'ERROR: ' + error + ' from ' + request.connection.remoteAddress );

            console.log('response :'+ JSON.stringify(ret));
            response.end(JSON.stringify(ret)); });

        } catch (error) {
          //log2("Error", error);
          if( error )
            log.error( 'ERROR: ' + error + ' from ' + request.connection.remoteAddress );

          response.end(JSON.stringify(createError(ERROR_UNSUPPORTED_OPERATION)));

        }// try-catch
      } else {
        var event = JSON.parse(body);
        //console.log(event);
        verifyToken.bind(this)(event, function(ret, error) {
          if( error )
            log.error( 'ERROR: ' + error + ' from ' + request.connection.remoteAddress );

          console.log('response :'+ JSON.stringify(ret));
          response.end(JSON.stringify(ret)); });
      }
    }.bind(this));
  }


  if( this._config.alexa.ssl === false ) {
    this.server = require('http').createServer(handleRequest.bind(this));
  } else {
    var options = {
      key: fs.readFileSync(this._config.alexa.keyFile || './key.pem'),
      cert: fs.readFileSync( this._config.alexa.certFile || './cert.pem'),
    };
    this.server = require('https').createServer(options,handleRequest.bind(this));
  }

  this.server.listen(this._config.alexa.port, function(){
    log.info("Server listening on: http%s://%s:%s", this._config.alexa.ssl === false?'':'s',
                                                    this.server.address().address, this.server.address().port);
  }.bind(this) );
}

var pmp_client;
function open_pmp(ip) {
  if( ip ) {
    log.info('Trying NAT-PMP ...');
    pmp_client = natpmp.connect(ip);
    pmp_client.externalIp(function (err, info) {
      if (err) throw err;
      log.info('Current external IP address: %s', info.ip.join('.'));
    });

    setInterval( open_pmp, 3500*1000 );
  }

  pmp_client.portMapping({ private: PORT, public: PORT, ttl: 3600 }, function (err, info) {
    if (err) throw err;
    log.debug(info);
  });
}

var upnp_client;
function open_upnp() {
  if( !upnp_client ) {
    log.info('Trying NAT-UPNP ...');
    upnp_client = natupnp.createClient();
    upnp_client.externalIp(function(err, ip) {
      if (err) throw err;
      log.info('Current external IP address: %s', ip);
    });

    setInterval( open_upnp, 3500*1000 );
  }

  upnp_client.portMapping({
    public: PORT,
    private: PORT,
    ttl: 3600
  }, function(err) {
    if( err ) {
      log.error('NAT-UPNP failed: '+ err)
    }
  });
}

Server.prototype.addDevice = function(device, fhem) {
  if( !device.isInScope('alexa.*') ) {
    log.info( 'ignoring '+ device.name +' for alexa' );
    return;
  }

  device.alexaName = device.alexaName.toLowerCase().replace( /\+/g, ' ' );
  device.alexaNames = device.alexaName;
  device.alexaName = device.alexaName.replace(/,.*/g,'');
  device.hasName = function(name) {
    if( this.alexaNames.match( '(^|,)('+name+')(,|\$)' ) ) return true;
    return  this.alexaName === name;
  }.bind(device);

  this.devices[device.device.toLowerCase()] = device;

  for( var characteristic_type in device.mappings )
    device.subscribe( device.mappings[characteristic_type] );

  if( device.alexaRoom ) {
    device.alexaRoom = device.alexaRoom.toLowerCase().replace( /\+/g, ' ' );

    this.namesOfRoom = {};
    this.roomsOfName = {};

    for( var d in this.devices ) {
      var device = this.devices[d];
      if( !device ) continue;
      var room = device.alexaRoom?device.alexaRoom:undefined;
      var name = device.alexaName;

      if( room ) {
        for( var r of room.split(',') ) {
          if( !this.namesOfRoom[r] ) this.namesOfRoom[r] = [];
          this.namesOfRoom[r].push( name );
        }
      }

      if( !this.roomsOfName[name] ) this.roomsOfName[name] = [];
      this.roomsOfName[name].push( room );
    }
  }
}

Server.prototype.setreading = function(reading, value) {
  for( var fhem of this.connections ) {
    if( !fhem.alexa_device ) continue;

    fhem.execute( 'setreading '+ fhem.alexa_device.Name +' '+ reading +' '+ value );
  }
}

Server.prototype.run = function() {
  log.info( 'this is alexa-fhem '+ version );

  if( !this._config.connections ) {
    log.error( 'no connections in config file' );
    process.exit( -1 );
  }

  if( this._config.alexa['nat-pmp'] )
    open_pmp(this._config.alexa['nat-pmp']);

  if( this._config.alexa['nat-upnp'] )
    open_upnp();

  this.startServer();

  this.roomOfIntent = {};
  if( this._config.alexa.applicationId )
    for( var i = 0; i < this._config.alexa.applicationId.length; ++i ) {
      var parts = this._config.alexa.applicationId[i].split( ':', 2 );
      if( parts.length == 2 ) {
        this.roomOfIntent[parts[0]] = parts[1].toLowerCase();
        this._config.alexa.applicationId[i] = parts[0];
      }
    }
  if( this._config.alexa.oauthClientID )
    for( var i = 0; i < this._config.alexa.oauthClientID.length; ++i ) {
      var parts = this._config.alexa.oauthClientID[i].split( ':', 2 );
      if( parts.length == 2 ) {
        this.roomOfIntent[parts[0]] = parts[1].toLowerCase();
        this._config.alexa.oauthClientID[i] = parts[0];
      }
    }

  log.info('Fetching FHEM devices...');

  this.devices = {};
  this.roomOfEcho = {};
  this.connections = [];
  this.namesOfRoom = {};
  this.roomsOfName = {};
  for( var connection of this._config.connections ) {
    var fhem = new FHEM(Logger.withPrefix(connection.name), connection);
    //fhem.on( 'DEFINED', function() {log.error( 'DEFINED' )}.bind(this) );

    fhem.on( 'customSlotTypes', function(fhem, cl) {
      var ret = '';
      ret += 'Custom Slot Types:';
      ret += '\n  FHEM_Device';

      var seen = {};
      for( var d in this.devices ) {
        var device = this.devices[d];
        for( var name of device.alexaNames.split(',') ) {
          if( seen[name] )
            continue;
          seen[name] = 1;
          ret +=  '\n';
          ret +=  '    ' + name;
        }
      }
      for( var c of this.connections ) {
        if( !c.alexaTypes ) continue;
        for( var type in c.alexaTypes ) {
          for( var name of c.alexaTypes[type] ) {
            if( !seen[name] )
              ret +='\n    '+ name;
              seen[name] = 1;
          }
        }
      }

      if( !seen['lampe'] )
        ret +='\n    lampe';
      if( !seen['licht'] )
        ret +='\n    licht';
      if( !seen['lampen'] )
        ret +='\n    lampen';
      if( !seen['rolläden'] )
        ret +='\n    rolläden';
      if( !seen['jalousien'] )
        ret +='\n    jalousien';
      if( !seen['rollos'] )
        ret +='\n    rollos';

      ret += '\n  FHEM_Room';
      for( var room in this.namesOfRoom ) {
        ret +=  '\n';
        ret += '    ' + room;
      }

      log.error( ret );
      if( cl ) {
        fhem.execute( '{asyncOutput($defs{"'+cl+'"}, "'+ ret +'")}' );
      }
    }.bind(this, fhem) );

    fhem.on( 'RELOAD', function(fhem, n) {
      if( n )
        log.info( 'reloading '+ n +' from '+ fhem.connection.base_url );
      else
        log.info( 'reloading '+ fhem.connection.base_url );

      for( var d in this.devices ) {
        var device = this.devices[d];
        if( !device ) continue;
        if( n && device.name !== n ) continue;
        if( device.fhem.connection.base_url !== fhem.connection.base_url ) continue;

        log.info( 'removing '+ device.name  +' from '+  device.fhem.connection.base_url );

        fhem = device.fhem;

        device.unsubscribe();

        delete this.devices[device.name];
      }

      if( n ) {
        fhem.connect( function(fhem, devices) {
          for( var device of devices ) {
            this.addDevice(device, fhem);
          }
        }.bind(this, fhem), 'NAME='+n );
      } else {
        for( var fhem of this.connections ) {
          fhem.connect( function(fhem,devices) {
            for( var device of devices ) {
              this.addDevice(device, fhem);
            }
          }.bind(this, fhem) );
       }
     }

    }.bind(this, fhem) );

    fhem.on( 'ALEXA DEVICE', function(fhem, n) {
      if( fhem.alexa_device ) {
        function lcfirst(str) {
          str += '';
          return str.charAt(0).toLowerCase() + str.substr(1);
        }
        function append(a,b,v) {
          if( a[b] === undefined )
            a[b] = {};
          a[b][v] = true;
        }

        fhem.perfectOfVerb = { 'stelle': 'gestellt', 'schalte': 'geschaltet', 'färbe': 'gefärbt', 'mach': 'gemacht' };
        fhem.verbsOfIntent = [];
        fhem.intentsOfVerb = {}
        fhem.valuesOfIntent = {}
        fhem.intentsOfCharacteristic = {}
        fhem.characteristicsOfIntent = {}
        fhem.prefixOfIntent = {}
        fhem.suffixOfIntent = {}
        for( var characteristic in fhem.alexaMapping ) {
          var mappings = fhem.alexaMapping[characteristic];
          if( !Array.isArray(mappings) )
             mappings = [mappings];

          var i = 0;
          for( var mapping of mappings ) {
            if( !mapping.verb ) continue;
            var intent = characteristic;
            if( mapping.valueSuffix ) intent = lcfirst( mapping.valueSuffix );
            intent += 'Intent';
            if( !mapping.valueSuffix )
              intent += i?String.fromCharCode(65+i):'';

            if( mapping.articles ) mapping.articles = mapping.articles.split(';');

            if( mapping.perfect )
              fhem.perfectOfVerb[mapping.verb] = mapping.perfect;
            //append(fhem.verbsOfIntent, intent, mapping.verb );
            if( fhem.verbsOfIntent[intent] === undefined ) {
              fhem.verbsOfIntent[intent] = [mapping.verb];
            } else if( fhem.verbsOfIntent[intent].indexOf(mapping.verb) == -1 ) {
              fhem.verbsOfIntent[intent].push( mapping.verb );
            }
            append(fhem.intentsOfVerb, mapping.verb, intent );
            //append(fhem.valuesOfIntent, intent, join( ',', @{$values} ) );
            append(fhem.intentsOfCharacteristic, characteristic, intent );
            //append(fhem.characteristicsOfIntent, intent, characteristic );
            if( fhem.characteristicsOfIntent[intent] === undefined ) {
              fhem.characteristicsOfIntent[intent] = [characteristic];
            } else if( fhem.characteristicsOfIntent[intent].indexOf(characteristic) == -1 ) {
              fhem.characteristicsOfIntent[intent].push( characteristic );
            }
            fhem.prefixOfIntent[intent] = mapping.valuePrefix;
            fhem.suffixOfIntent[intent] = mapping.valueSuffix;
            ++i;
          }
        }
log.error('perfectOfVerb:');
log.error(fhem.perfectOfVerb);
log.error('verbsOfIntent:');
log.error(fhem.verbsOfIntent);
//log.error(fhem.intentsOfVerb);
//log.error(fhem.valuesOfIntent);
//log.error(fhem.intentsOfCharacteristic);
log.error('characteristicsOfIntent:');
log.error(fhem.characteristicsOfIntent);
log.error('prefixOfIntent:');
log.error(fhem.prefixOfIntent);
log.error('suffixOfIntent:');
log.error(fhem.suffixOfIntent);
      }

      if( fhem.alexaTypes ) {
        var types = {};
        for( var type of fhem.alexaTypes.split(/ |\n/) ) {
          if( !type )
            continue;
          if( type.match(/^#/) )
            continue;

          var match = type.match(/(^.*?)(:|=)(.*)/);
          if( !match || match.length < 4 || !match[3] ) {
            log.error( '  wrong syntax: ' + type );
            continue;
          }
          var name = match[1];
          var aliases = match[3].split(/,|;/);

          types[name] = aliases;
        }
        fhem.alexaTypes = types;
log.error('alexaTypes:');
log.error(fhem.alexaTypes);
      }

      if( fhem.echoRooms ) {
        var echos = {};
        for( var line of fhem.echoRooms.split(/ |\n/) ) {
          if( !line )
            continue;
          if( line.match(/^#/) )
            continue;

          var match = line.match(/(^.*?)(:|=)(.*)/);
          if( !match || match.length < 4 || !match[3] ) {
            log.error( '  wrong syntax: ' + line );
            continue;
          }
          var echoId = match[1];
          var room = match[3];

          this.roomOfEcho[echoId] = room.toLowerCase();
        }
log.error('roomOfEcho:');
log.error(this.roomOfEcho);
      }

      if( fhem.fhemIntents ) {
        var intents = {}
        for( var intent of fhem.fhemIntents.split(/\n/) ) {
          if( !intent )
            continue;
          if( intent.match(/^#/) )
            continue;

          var match = intent.match(/(^.*?)(:|=)(.*)/);
          if( !match || match.length < 4 || !match[3] ) {
            this.log.error( '  wrong syntax: ' + intent );
            continue;
          }

          var name = match[1];
          var params = match[3];

          var intent_name = 'FHEM'+ name +'Intent';
          if( match = name.match( /^(set|get|attr)\s/ ) ) {
            intent_name = 'FHEM'+ match[1] +'Intent';
            var i = 1;
            while( intents[intent_name] !== undefined ) {
              intent_name = 'FHEM'+ match[1] +'Intent'+ String.fromCharCode(65+i);
              ++i;
            }
          } else if( name.match( /^{.*}$/ ) ) {
            intent_name = 'FHEMperlCodeIntent';
            var i = 1;
            while( intents[intent_name] !== undefined ) {
              if( i < 26 )
                intent_name = 'FHEMperlCodeIntent'+ String.fromCharCode(65+i);
              else
                intent_name = 'FHEMperlCodeIntent'+ String.fromCharCode(64+i/26)+String.fromCharCode(65+i%26);
              ++i;
            }
          }
          intent_name = intent_name.replace(/ /g,'');

          intents[intent_name] = name;

        }
        fhem.fhemIntents = intents;
log.error('fhemIntents:');
log.error(fhem.fhemIntents);
      }

      if( fhem.alexaConfirmationLevel === undefined )
        fhem.alexaConfirmationLevel = 2;

      if( fhem.alexaStatusLevel === undefined )
        fhem.alexaStatusLevel = 2;
    }.bind(this, fhem) );

    fhem.on( 'LONGPOLL STARTED', function(fhem) {
      fhem.connect( function(fhem, devices) {
        for( var device of devices ) {
          this.addDevice(device, fhem);
        }
      }.bind(this, fhem) )
    }.bind(this, fhem) );

    this.connections.push( fhem );
  }
}

Server.prototype.shutdown = function() {
  if( pmp_client ) {
    log.info('Stopping NAT-PMP ...');
    pmp_client.portUnmapping({ public: PORT, private: PORT }, function (err, info) {
    if (err) throw err;
    log.debug('Port Unmapping:', info);
    pmp_client.close();
    });
  }

  if( upnp_client ) {
    log.info('Stopping NAT-UPNP ...');
    upnp_client.portUnmapping({
      public: PORT
    });
  }
}




// namespaces
// https://developer.amazon.com/public/solutions/alexa/alexa-skills-kit/docs/smart-home-skill-api-reference#payload
const NAMESPACE_DISCOVERY = "Alexa.ConnectedHome.Discovery";
const NAMESPACE_SYSTEM = "Alexa.ConnectedHome.System";
const NAMESPACE_CONTROL = "Alexa.ConnectedHome.Control";
const NAMESPACE_QUERY = "Alexa.ConnectedHome.Query";

// discovery
const REQUEST_DISCOVER = "DiscoverAppliancesRequest";
const RESPONSE_DISCOVER = "DiscoverAppliancesResponse";

// system
const REQUEST_HEALTH_CHECK = "HealthCheckRequest";
const RESPONSE_HEALTH_CHECK = "HealthCheckResponse";

// control
const REQUEST_TURN_ON = "TurnOnRequest";
const RESPONSE_TURN_ON = "TurnOnConfirmation";

const REQUEST_TURN_OFF = "TurnOffRequest";
const RESPONSE_TURN_OFF = "TurnOffConfirmation";

const REQUEST_SET_PERCENTAGE = "SetPercentageRequest";
const RESPONSE_SET_PERCENTAGE = "SetPercentageConfirmation";

const REQUEST_INCREMENT_PERCENTAGE = "IncrementPercentageRequest";
const RESPONSE_INCREMENT_PERCENTAGE = "IncrementPercentageConfirmation";

const REQUEST_DECREMENT_PERCENTAGE = "DecrementPercentageRequest";
const RESPONSE_DECREMENT_PERCENTAGE = "DecrementPercentageConfirmation";


const REQUEST_SET_TARGET_TEMPERATURE = "SetTargetTemperatureRequest";
const RESPONSE_SET_TARGET_TEMPERATURE = "SetTargetTemperatureConfirmation";

const REQUEST_INCREMENT_TARGET_TEMPERATURE = "IncrementTargetTemperatureRequest";
const RESPONSE_INCREMENT_TARGET_TEMPERATURE = "IncrementTargetTemperatureConfirmation";

const REQUEST_DECREMENT_TARGET_TEMPERATURE = "DecrementTargetTemperatureRequest";
const RESPONSE_DECREMENT_TARGET_TEMPERATURE = "DecrementTargetTemperatureConfirmation";


//https://developer.amazon.com/public/solutions/alexa/alexa-skills-kit/docs/smart-home-skill-api-reference#tunable-lighting-control-messages
const REQUEST_SET_COLOR = "SetColorRequest";
const RESPONSE_SET_COLOR = "SetColorConfirmation";

const REQUEST_SET_COLOR_TEMPERATURE = "SetColorTemperatureRequest";
const RESPONSE_SET_COLOR_TEMPERATURE = "SetColorTemperatureConfirmation";

const REQUEST_INCREMENT_COLOR_TEMPERATURE = "IncrementColorTemperatureRequest";
const RESPONSE_INCREMENT_COLOR_TEMPERATURE = "IncrementColorTemperatureConfirmation";

const REQUEST_DECREMENT_COLOR_TEMPERATURE = "DecrementColorTemperatureRequest";
const RESPONSE_DECREMENT_COLOR_TEMPERATURE = "DecrementColorTemperatureConfirmation";


// query
const REQUEST_GET_TEMPERATURE_READING = "GetTemperatureReadingRequest";
const RESPONSE_GET_TEMPERATURE_READING = "GetTemperatureReadingResponse";

const REQUEST_GET_TARGET_TEMPERATURE = "GetTargetTemperatureRequest";
const RESPONSE_GET_TARGET_TEMPERATURE = "GetTargetTemperatureResponse";

const REQUEST_GET_LOCK_STATE = "GetLockStateRequest";
const RESPONSE_GET_LOCK_STATE = "GetLockStateResponse";


// errors
const ERROR_NO_SUCH_TARGET = "NoSuchTargetError";
const ERROR_VALUE_OUT_OF_RANGE = "ValueOutOfRangeError";
const ERROR_NOT_SUPPORTED_IN_CURRET_MODE = "NotSupportedInCurrentModeError";
const ERROR_UNSUPPORTED_OPERATION = "UnsupportedOperationError";
const ERROR_UNSUPPORTED_TARGET = "UnsupportedTargetError";
const ERROR_UNEXPECTED_INFO = "UnexpectedInformationReceivedError";
const ERROR_INVALID_ACCESS_TOKEN = "InvalidAccessTokenError";


var accepted_token;
var oauthClientID;
var expires = 0;
var verifyToken = function(event, callback) {
  var token;
  if( event.payload )
    token = event.payload.accessToken;
  else if( event.session )
    token = undefined;

  if( token === accepted_token && Date.now() < expires ) {
    handler.bind(this)( event, callback );

  } else if( token ) {
    var url = "https://api.amazon.com/auth/O2/tokeninfo?access_token="+token.replace('|', '%7C');
    require('https').get( url, function(result) {
      const statusCode = result.statusCode;
      const contentType = result.headers['content-type'];

      var error;
      if(statusCode !== 200 && statusCode !== 400) {
        error = new Error('Request Failed.\n'+
                          'Status Code: '+ statusCode);
      } else if(!/^application\/json/.test(contentType)) {
        error = new Error('Invalid content-type.\n'+
                          'Expected application/json but received '+ contentType);
      }
      if(error) {
        log.error(error.message);
        // consume response data to free up memory
        result.resume();
        callback( createError(ERROR_INVALID_ACCESS_TOKEN), ERROR_INVALID_ACCESS_TOKEN );
        return;
      }

      result.setEncoding('utf8');
      var body = '';
      result.on('data', function(chunk){body += chunk});
      result.on('end', function() {
        try {
          var parsedData = JSON.parse(body);
          if( parsedData.error ) {
            log.error( 'client not authorized: '+ body );

            callback( createError(ERROR_INVALID_ACCESS_TOKEN), ERROR_INVALID_ACCESS_TOKEN );

          } else if( !this._config.alexa.oauthClientID || this._config.alexa.oauthClientID.indexOf(parsedData.aud) >= 0 ) {
            log.info('accepted new token');
            //log.info('accepted new token for: '+ parsedData.aud);
            log.debug(parsedData);
            accepted_token = token;
            oauthClientID = parsedData.aud;
            expires = Date.now() + parsedData.exp;
            handler.bind(this)( event, callback );

          } else {
            log.error('clientID '+ parsedData.aud  +'not authorized');
            log.debug(parsedData);
            callback( createError(ERROR_INVALID_ACCESS_TOKEN), ERROR_INVALID_ACCESS_TOKEN );
          }
        } catch (e) {
          log.error(e.message);
          callback( createError(ERROR_INVALID_ACCESS_TOKEN), ERROR_INVALID_ACCESS_TOKEN );
        }
      }.bind(this));
    }.bind(this)).on('error', function(e){
      console.log('Got error: '+ e.message);
      callback( createError(ERROR_INVALID_ACCESS_TOKEN), ERROR_INVALID_ACCESS_TOKEN );
    });

  } else if( event.session ) {
    //console.log(event);
    if( event.session.application && event.session.application.applicationId
        && this._config.alexa.applicationId.indexOf(event.session.application.applicationId) >= 0  ) {
      handler.bind(this)( event, callback );

    } else if( event.session.application && event.session.application.applicationId ) {
log.error(this._config.alexa.applicationId);
      log.error( 'applicationId '+ event.session.application.applicationId +' not authorized' );
      callback( createError(ERROR_INVALID_ACCESS_TOKEN), ERROR_INVALID_ACCESS_TOKEN );

    } else {
      log.error( 'event not authorized' );
      callback( createError(ERROR_INVALID_ACCESS_TOKEN), ERROR_INVALID_ACCESS_TOKEN );
    }

  } else {
    log.error( 'event not supported' );
    callback( createError(ERROR_UNSUPPORTED_OPERATION), ERROR_UNSUPPORTED_OPERATION );
  }

}

var sessions = {};
var handleCustom = function(event, callback) {
    var session = event.session.sessionId;
    var in_session = false;
    if( sessions[session] )
      in_session = sessions[session].in_session;
    else
      sessions[session] = {};

    var echoId = 'unknown';
    if( event.context && event.context.System && event.context.System.device && event.context.System.device.deviceId )
      echoId = event.context.System.device.deviceId;
    var echoRoom = 'unknown';
    if( this.roomOfEcho[echoId] )
      echoRoom = this.roomOfEcho[echoId];

    var response = { version: '1.0',
                     sessionAttributes: {},
                     response: {
                       outputSpeech: {
                         type: 'PlainText',
                         text: 'Hallo.'
                       },
                       shouldEndSession: !in_session
                     }
                   };

    if( event.request.type === 'LaunchRequest' ) {
      in_session = true;
      response.response.outputSpeech.text = 'Hallo. Wie kann ich helfen?';
      if( fhem && fhem.alexaConfirmationLevel < 2 )
        response.response.outputSpeech.text = 'Hallo.';

      response.response.reprompt = { outputSpeech: {type: 'PlainText', text: 'Noch jemand da?' } };

      this.setreading( 'intent', event.request.type );
      this.setreading( 'echoId', echoId );
      this.setreading( 'echoRoom', echoRoom );

    } else if( event.request.type === 'SessionEndedRequest' ) {
      in_session = false;
      response.response.outputSpeech.text = 'Bye';

      this.setreading( 'intent', event.request.type );
      this.setreading( 'echoId', echoId );
      this.setreading( 'echoRoom', echoRoom );

    } else if( event.request.type === 'IntentRequest' ) {
      var intent_name = event.request.intent.name;
log.info( intent_name );

      var match = false;
      for( var fhem of this.connections ) {
        if( !fhem.fhemIntents ) continue;
        if( fhem.fhemIntents[intent_name] !== undefined ) {
          match = true;

          var name = fhem.fhemIntents[intent_name];

          var applicationId = '';
          if( this._config.alexa.applicationId.length > 1 && event.session.application && event.session.application.applicationId ) {
            applicationId = event.session.application.applicationId;
            //applicationId = this._config.alexa.applicationId.indexOf(event.session.application.applicationId);
            //if( applicationId < 0 ) applicationId = '';
          }

          if( name.match(/^(set|get|attr)\s/) ) {
            if( applicationId !== '' ) applicationId = ' :' +applicationId;
            //fhem.execute( 'setreading '+ fhem.alexa_device.Name +' fhemIntent '+ intent_name + applicationId );
            fhem.execute( 'setreading '+ fhem.alexa_device.Name +' fhemIntent '+ intent_name + applicationId + ';setreading '+ fhem.alexa_device.Name +' echoId '+ echoId + ';setreading '+ fhem.alexa_device.Name +' echoRoom '+ echoRoom +';'+ name, function(result) {
              response.response.outputSpeech.text = result;
              callback( response );
            } );
            return;

          } else if( name.match(/^{.*}$/) ) {
            if( applicationId !== '' ) applicationId = ' :' +applicationId;
            //fhem.execute( 'setreading '+ fhem.alexa_device.Name +' fhemIntent '+ intent_name + applicationId );

            var specials ='';
            if( event.request.intent.slots ) {
              for( var slot in event.request.intent.slots ) {
                slot = event.request.intent.slots[slot];
                var n = slot.name.replace( intent_name+'_', '' );
                var v = slot.value;
//console.log(n +': '+ v);
                if( v !== undefined )
                  specials += '"%'+ n +'" => "'+ v +'",';
                else
                  specials += '"%'+ n +'" => "",';
              }
              specials += '"%_echoId" => "'+ echoId +'",';
              if( echoRoom !== 'unknown' )
                specials += '"%_echoRoom" => "'+ echoRoom +'",';
            }
console.log(specials);

            name = '{my %specials=('+specials+');; my $exec = EvalSpecials(\''+name+'\', %specials);; return AnalyzePerlCommand($defs{"'+fhem.alexa_device.Name+'"}, $exec)}';
//console.log(name);

            fhem.execute( 'setreading '+ fhem.alexa_device.Name +' fhemIntent '+ intent_name + applicationId + ';setreading '+ fhem.alexa_device.Name +' echoId '+ echoId + ';setreading '+ fhem.alexa_device.Name +' echoRoom '+ echoRoom +';'+ name, function(result) {
              response.response.outputSpeech.text = result;
              callback( response );
            } );
            return;

          } else {
            if( applicationId !== '' ) applicationId = ' :' +applicationId;
            fhem.execute( 'setreading '+ fhem.alexa_device.Name +' echoId '+ echoId + ';setreading '+ fhem.alexa_device.Name +' echoRoom '+ echoRoom + ';' + 'setreading '+ fhem.alexa_device.Name +' fhemIntent '+ name + applicationId );
          }
        }
      }
      if( match ) {
        response.response.outputSpeech.text = 'OK.';
        callback( response );
        return;
      }

      var command;
      if( sessions[session] && intent_name == 'RoomAnswerIntent' ) {
        command = sessions[session].command;
        intent_name = command.intent_name;
        delete sessions[session].command;

      } else {
        delete sessions[session].command;
        command = { verb: undefined, article: '', device: undefined, preposition: undefined, room: undefined,
                    prefix: undefined, value: undefined, suffix: undefined,
                    characteristic: undefined, index: undefined };

      }

      this.setreading( 'intent', event.request.type +' '+ intent_name );
      this.setreading( 'echoId', echoId );
      this.setreading( 'echoRoom', echoRoom );

      var match;
      if( match = intent_name.match( /(.+)Intent([A-Z])?$/ ) ) {
        command.characteristic = match[1];
        command.index = match[2]?match[2].charCodeAt(0)-65:0;
log.debug('index: '+ command.index);
      }
log.debug( 'characteristic: ' + command.characteristic );
      if( command.characteristic ) {
        var c = intent_name.replace( /Intent.?$/, '' );
        function Value(c, slots) {
          if( typeof slots  !== 'object' ) return undefined;
          for( var slot in slots ) {
            if( slot.match('^'+c+'.?_') )
              return slots[slot].value;
          }
          return undefined;
        };
        var value = Value(c, event.request.intent.slots);
        if( value !== undefined )
          command.value = value;
      }
log.debug( 'value: ' + command.value );

      if( event.request.intent.slots && event.request.intent.slots.article && event.request.intent.slots.article.value )
        command.article = event.request.intent.slots.article.value.toLowerCase();

      if( event.request.intent.slots && event.request.intent.slots.Device && event.request.intent.slots.Device.value )
        command.device = event.request.intent.slots.Device.value.toLowerCase();

      if( event.request.intent.slots && event.request.intent.slots.preposition && event.request.intent.slots.preposition.value )
        command.preposition = event.request.intent.slots.preposition.value.toLowerCase();

      if( event.request.intent.slots && event.request.intent.slots.Room && event.request.intent.slots.Room.value )
        command.room = event.request.intent.slots.Room.value.toLowerCase();

      if( !command.room && echoRoom !== 'unknown' )
        command.room = echoRoom;
      else if( !command.room && event.session.application !== undefined )
        command.room = this.roomOfIntent[event.session.application.applicationId];

      var type;
      var device;
      if( command.device ) {
        device = this.devices[command.device];
        if( !device ) {
          for( var d in this.devices ) {
            var d = this.devices[d];
            if( !d ) continue;
            if( command.room && !d.isInRoom(command.room) ) continue;
            if( !d.isInScope('alexa') && !d.isInScope('alexa-custom') ) continue;
            if( d.hasName(command.device) ) {
              if( device ) {
                log.error(command.device +' -> '+ device.name +':'+ device.alexaName +'('+device.alexaRoom+'),'
                                                + d.name +':'+ d.alexaName +'('+d.alexaRoom+')' );
                if( command.room )
                  response.response.outputSpeech.text = 'Ich habe mehr als ein Gerät mit Namen '+ command.device +' im Raum '+ command.room +' gefunden.';
                else
                  response.response.outputSpeech.text = 'Ich habe mehr als ein Gerät mit Namen '+ command.device +' gefunden. In welchem Raum meinst du?';

                command.intent_name = intent_name;
                sessions[session].command = command;

                response.response.shouldEndSession = false;

                callback( response );
                return;
              }
              device = d;
            }
          }
        }
        if( !device ) {
          for( var c of this.connections ) {
            if( !c.alexaTypes ) continue;
            for( var t in c.alexaTypes ) {
              for( var name of c.alexaTypes[t] ) {
                if( name === command.device ) {
                  type = t;
                  break;
                }
              }
              if( type ) break;
            }
            if( type ) break;
          }
        }

        if( !device ) {
          if( command.device === 'licht' || command.device === 'lampe' || command.device === 'lampen' ) {
            type = 'light';
          } else if( command.device === 'rolladen' || command.device === 'jalousie' || command.device === 'rollo'
                     || command.device === 'rolläden' || command.device === 'jalousien' || command.device === 'rollos' ) {
            type = 'blind';
          }
        }
        if( type ) {
          command.type_name = command.device
          command.device = undefined;
          command.article = '';
        }
        if( !device && !type ) {
          if( command.room )
            response.response.outputSpeech.text = 'Ich habe kein Gerät mit Namen '+ command.device +' im Raum '+ command.room +' gefunden.';
          else
            response.response.outputSpeech.text = 'Ich habe kein Gerät mit Namen '+ command.device +' gefunden.';

          callback( response );
          return;
        }
      }

log.debug('type: '+ type );
log.debug('room: '+ command.room );
log.debug('name: '+ command.device );
log.debug('device: '+ device );

      if( event.request.intent.name === 'AMAZON.StopIntent' ) {
        in_session = false;
        response.response.outputSpeech.text = 'Bis bald.';

        this.setreading( 'intent', event.request.intent.name );
        this.setreading( 'echoId', echoId );
        this.setreading( 'echoRoom', echoRoom );

      } else if( event.request.intent.name === 'AMAZON.CancelIntent' ) {
        delete sessions[session].command;
        response.response.outputSpeech.text = 'OK.';

        this.setreading( 'intent', event.request.intent.name );
        this.setreading( 'echoId', echoId );
        this.setreading( 'echoRoom', echoRoom );

      } else if( event.request.intent.name === 'AMAZON.HelpIntent' ) {
        response.response.outputSpeech.text = 'HILFE';

      } else if( intent_name === 'StatusIntent' ) {
        response.response.outputSpeech.text = '';
        function status(device, room) {
          var state = '';
          //for( var characteristic_type in device.mappings ) {
          //  if( state ) { state.replace( ' und ', ', ' ); state += ' und ' };
          //  state += 'hat den status '+ device.fhem.cached(device.mappings[characteristic_type].informId);
          //}

          if( device.mappings.On ) {
            //var current = device.fhem.reading2homekit(device.mappings.On, device.query(device.mappings.On));
            var current = device.fhem.reading2homekit(device.mappings.On, device.fhem.cached(device.mappings.On.informId));
            if( current === 'off' )
              current = false;
            else if( !isNaN(current) )
              current = parseInt(current);
            state = 'ist '+ (current?'an':'aus');
          }
          if( device.mappings.CurrentTemperature ) {
            if( state ) { state.replace( ' und ', ', ' ); state += ' und ' };
            state += ' misst '+ device.fhem.cached(device.mappings.CurrentTemperature.informId).replace('.',',') +' Grad';
          }
          if( device.mappings.TargetTemperature ) {
            if( state ) { state.replace( ' und ', ', ' ); state += ' und ' };
            state += 'steht auf '+ device.fhem.cached(device.mappings.TargetTemperature.informId).replace('.',',') +' Grad';
          }
          if( device.mappings.TargetPosition ) {
            if( state ) { state.replace( ' und ', ', ' ); state += ' und ' };
            state += 'steht auf '+ device.fhem.cached(device.mappings.TargetPosition.informId) +' Prozent';
          }
          if( device.mappings.CurrentAmbientLightLevel ) {
            if( state ) { state.replace( ' und ', ', ' ); state += ' und ' };
            state += 'misst '+ device.fhem.cached(device.mappings.CurrentAmbientLightLevel.informId) +' Lux';
          }
          if( device.mappings.AirQuality ) {
            if( state ) { state.replace( ' und ', ', ' ); state += ' und ' };
            state += device.fhem.cached(device.mappings.AirQuality.informId) +' misst xxx luftqualität';
          }
          if( device.mappings.CarbonDioxideLevel ) {
            if( state ) { state.replace( ' und ', ', ' ); state += ' und ' };
            state += 'misst '+ device.fhem.cached(device.mappings.CarbonDioxideLevel.informId) +' ppm co2';
          }
          if( device.mappings.BatteryLevel ) {
            if( state ) { state.replace( ' und ', ', ' ); state += ' und ' };
            state += 'der Batteriestand ist '+ device.fhem.cached(device.mappings.BatteryLevel.informId).replace('.',',');
          } else if( device.mappings.StatusLowBattery ) {
            if( state ) { state.replace( ' und ', ', ' ); state += ' und ' };
            //state += 'der Batteriestand ist '+ (device.fhem.cached(device.mappings.StatusLowBattery.informId)?'niedrig':'in ordnung');
            state += 'der Batteriestand ist '+ ((device.fhem.cached(device.mappings.StatusLowBattery.informId)==='ok')?'in ordnung':'niedrig');

          }
	  if( device.mappings.CurrentDoorState ) {
	    if( state ) { state.replace( ' und ', ', ' ); state += ' und ' };
	    state += 'ist '+ ((device.fhem.cached(device.mappings.CurrentDoorState.informId)==='open')?'geöffnet':'geschlossen');
          } else if( device.mappings.ContactSensorState ) {
	    if( state ) { state.replace( ' und ', ', ' ); state += ' und ' };
	    state += 'ist '+ ((device.fhem.cached(device.mappings.ContactSensorState.informId)==='open')?'geöffnet':'geschlossen');
          }
          if( device.mappings['00001001-0000-1000-8000-135D67EC4377'] ) {
            if( state ) { state.replace( ' und ', ', ' ); state += ' und ' };
            state += 'steht auf '+ device.fhem.cached(device.mappings['00001001-0000-1000-8000-135D67EC4377'].informId) +' Prozent';
          }

          if( !state ) {
            for( var characteristic_type in device.mappings ) {
              if( state ) { state.replace( ' und ', ', ' ); state += ' und ' };
              state += 'hat den status '+ device.fhem.cached(device.mappings[characteristic_type].informId);
            }
          }

          if( !state )
            return 'Ich kann das Gerät mit Namen '+ device.alexaName +' nicht abfragen.';

          var name = device.alexaName;
          if( room )
            return name +' im Raum '+ room +' '+ state;

          if( !room && device.alexaRoom && this.roomsOfName &&  this.roomsOfName[name] && this.roomsOfName[name].length > 1 )
            return name +' im Raum '+ device.alexaRoom +' '+ state;

          return name +' '+ state;
        }
        if( device ) {
          response.response.outputSpeech.text = status.bind(this)(device, command.room);

        } else if( command.room || type ) {
          for( var d in this.devices ) {
            var device = this.devices[d];
            if( !device ) continue;
            if( type && !device.isOfType(type) ) continue;
            if( command.room && !device.isInRoom(command.room) ) continue;
            if( !device.isInScope('alexa') && !device.isInScope('alexa-custom') ) continue;


            if( response.response.outputSpeech.text ) response.response.outputSpeech.text += ', ';
            response.response.outputSpeech.text += status.bind(this)(device, command.room);
          }
          if( command.room && response.response.outputSpeech.text === '' )
            response.response.outputSpeech.text = 'Ich habe keinen Raum '+ command.room +' mit Geräten '+ (type?'vom Typ '+command.type_name:'') +' gefunden.';
          else if( type && response.response.outputSpeech.text === '' )
            response.response.outputSpeech.text = 'Ich habe keine Geräte vom Typ '+ command.type_name +' gefunden.';
          else {
            response.response.card = { type: 'Simple',
                                       title: (command.room?command.room:'') +'status',
                                       content: response.response.outputSpeech.text.replace( /, /g, '\n' ) };
          }

        } else {
          response.response.outputSpeech.text = 'Das habe ich leider nicht verstanden.';
        }

      } else if( command.characteristic == 'On' ) {
        function SwitchOnOff(device,value,ok) {
          if( !device.mappings.On ) {
            return 'Ich kann das Gerät mit Namen '+ command.device +' nicht schalten.';

          } else if( value === 'aus' ) {
            device.command( device.mappings.On, 0 );
            return ok;

          } else if( value === 'an' || value === 'ein' ) {
            device.command( device.mappings.On, 1 );
            return ok;

          } else if( value === 'um' ) {
            var current = device.fhem.reading2homekit(device.mappings.On, device.fhem.cached(device.mappings.On.informId))
            device.command( device.mappings.On, current?0:1 );
            return ok.replace( 'umgeschaltet', (current?'ausgeschaltet':'eingeschaltet') );

          } else
            return 'Ich kann das Gerät mit Namen '+ command.device +' nicht '+ value +'schalten.';
        }

        if( (command.room || type) && !device ) {
          response.response.outputSpeech.text = '';
          for( var d in this.devices ) {
            var device = this.devices[d];
            if( !device ) continue;
            if( command.device && !device.hasName(command.device) ) continue;
            if( type && !device.isOfType(type) ) continue;
            if( command.room && !device.isInRoom(command.room) ) continue;
            if( !device.isInScope('alexa') && !device.isInScope('alexa-custom') ) continue;

            response.response.outputSpeech.text = response.response.outputSpeech.text.replace( ' und ', ', ' );
            if( response.response.outputSpeech.text ) response.response.outputSpeech.text += ' und ';
            response.response.outputSpeech.text += SwitchOnOff( device, command.value, command.article +' '+ device.alexaName );
            var name = device.alexaName;
            if( !command.room && device.alexaRoom && this.roomsOfName &&  this.roomsOfName[name] && this.roomsOfName[name].length > 1 )
              response.response.outputSpeech.text += ' im Raum '+ device.alexaRoom;
          }
          if( command.room && response.response.outputSpeech.text === '' )
            response.response.outputSpeech.text = 'Ich habe keinen Raum '+ command.room +' mit Geräten '+ (type?'vom Typ '+command.type_name:'') +' gefunden.';
          else if( type && response.response.outputSpeech.text === '' )
            response.response.outputSpeech.text = 'Ich habe keine Geräte vom Typ '+ command.type_name +' gefunden.';
          else {
            response.response.outputSpeech.text += ' '+ command.value +'geschaltet.';
            response.response.card = { type: 'Simple',
                                       title: 'On',
                                       content: response.response.outputSpeech.text };
            response.response.outputSpeech.text = 'Ich habe '+ response.response.outputSpeech.text;
            if( !in_session && fhem && fhem.alexaConfirmationLevel < 1 )
              response.response.outputSpeech.text = '';
            else if( fhem && fhem.alexaConfirmationLevel < 2 )
              response.response.outputSpeech.text = 'OK.';
          }

        } else if( device ) {
          response.response.outputSpeech.text = 'OK.';
          if( command.room && command.device )
            response.response.outputSpeech.text = 'Ich habe '+ command.article +' '+ command.device +' im Raum '+ command.room +' '+ command.value +'geschaltet.';
          else if( command.device )
            response.response.outputSpeech.text = 'Ich habe '+ command.article +' '+ command.device +' '+ command.value +'geschaltet.';

          if( !in_session && fhem && fhem.alexaConfirmationLevel < 1 )
            response.response.outputSpeech.text = '';
          else if( fhem && fhem.alexaConfirmationLevel < 2 )
            response.response.outputSpeech.text = 'OK.';

          response.response.outputSpeech.text = SwitchOnOff( device, command.value, response.response.outputSpeech.text );

        } else
          response.response.outputSpeech.text = 'Ich habe kein Gerät gefunden.';

      } else if( intent_name === 'DeviceListIntent' ) {
        response.response.outputSpeech.text = '';
        for( var d in this.devices ) {
          var device = this.devices[d];
          if( !device ) continue;
          if( command.room && !device.isInRoom(command.room) ) continue;
          response.response.outputSpeech.text = response.response.outputSpeech.text.replace( ' und ', ', ' );
          if( response.response.outputSpeech.text ) response.response.outputSpeech.text += ' und ';
          response.response.outputSpeech.text += device.alexaName;
          var name = device.alexaName;
          if( !command.room && device.alexaRoom && this.roomsOfName &&  this.roomsOfName[name] && this.roomsOfName[name].length > 1 )
            response.response.outputSpeech.text += ' im Raum '+ device.alexaRoom;
        }
        response.response.card = { type: 'Simple',
                                   title: 'Geräteliste',
                                   content: response.response.outputSpeech.text.replace( ', ', '\n' ).replace( ' und ', '\n' ) };
        response.response.outputSpeech.text = 'Ich kenne: '+response.response.outputSpeech.text;

      } else if( intent_name === 'RoomListIntent' ) {
        response.response.outputSpeech.text = '';
        var rooms = {};
        for( var d in this.devices ) {
          var device = this.devices[d];
          if( !device.alexaRoom ) continue;
          var room = device.alexaRoom;
          rooms[room] = room;
        }
        for( var room in rooms ) {
          response.response.outputSpeech.text = response.response.outputSpeech.text.replace( ' und ', ', ' );
          if( response.response.outputSpeech.text ) response.response.outputSpeech.text += ' und ';
          response.response.outputSpeech.text += room;
        }
        response.response.card = { type: 'Simple',
                                   title: 'Raumliste',
                                   content: response.response.outputSpeech.text.replace( ', ', '\n' ).replace( ' und ', '\n' ) };
        response.response.outputSpeech.text = 'Ich kenne: '+response.response.outputSpeech.text;

      } else if( command.characteristic ) {
        var fhem;
        function Switch(device,command,value) {
          var characteristic = command.characteristic;
          var orig = value;

log.error(characteristic);
log.error(intent_name);
          if( device && !device.mappings[characteristic] ) {
log.error(device.fhem.characteristicsOfIntent[intent_name]);
            if( device.fhem.characteristicsOfIntent[intent_name] !== undefined ) {
              for( c of device.fhem.characteristicsOfIntent[intent_name] ) {
log.error(c);
                if( device.mappings[c] ) {
                  characteristic =  c;
                  break;
                }
              }
          }
log.info( intent_name +' -> '+ characteristic );
          }

          if( device && !device.mappings[characteristic] )
            return 'Ich kann '+ command.device +' nicht auf '+ value +' schalten.';

          var mapping = device.mappings[characteristic];

          if( device && device.fhem.alexaMapping && device.fhem.alexaMapping[characteristic] ) {
            var alexaMapping;
            if( command.index !== undefined && device.fhem.alexaMapping[characteristic][command.index] )
              alexaMapping = device.fhem.alexaMapping[characteristic][command.index];
            else if( device.fhem.alexaMapping[characteristic].values )
              alexaMapping = device.fhem.alexaMapping[characteristic];
            //else
              //return 'Ich kann '+ command.device +' nicht auf '+ value +' schalten.';

            if( alexaMapping ) {
              if( !command.type_name && !command.article && alexaMapping.articles )
                command.article = alexaMapping.articles[0];

              var mapped = value;
              if( typeof alexaMapping.value2homekit === 'object' )
                if( alexaMapping.value2homekit[value] !== undefined )
                  mapped = alexaMapping.value2homekit[value];

              if( value !== mapped )
                alexaMapping.log.debug(mapping.informId + ' values: value ' + value + ' mapped to ' + mapped);
              value = mapped;
              if( !isNaN(value) ) {
                value = parseFloat(value);
                if( alexaMapping.minValue !== undefined && value < alexaMapping.minValue )
                  value = alexaMapping.minValue;
                else if( alexaMapping.maxValue !== undefined && value > alexaMapping.maxValue )
                  value = mapping.maxValue;
                if( mapping.minValue !== undefined && value < mapping.minValue )
                  value = mapping.minValue;
                else if( mapping.maxValue !== undefined && value > mapping.maxValue )
                  value = mapping.maxValue;
              }
            }
            if( !fhem )
              fhem = device.fhem;

            device.command( mapping, value );

            var name = device.alexaName;
            if( device.alexaRoom && this.roomsOfName &&  this.roomsOfName[name] && this.roomsOfName[name].length > 1 )
              return command.article +' '+ device.alexaName +' im Raum '+ device.alexaRoom;
            else
              return command.article +' '+ device.alexaName;

          } else {
            return 'Ich kann nicht auf '+ value +'schalten.';
          }
        }

log.debug( event.request.intent.slots );
log.debug( command.value );

        response.response.outputSpeech.text = '';
        for( var d in this.devices ) {
          var device = this.devices[d];
          if( !device ) continue;
          if( command.device && !device.hasName(command.device) ) continue;
          if( type && !device.isOfType(type) ) continue;
          if( command.room && !device.isInRoom(command.room) ) continue;
          if( !device.isInScope('alexa') && !device.isInScope('alexa-custom') ) continue;

          response.response.outputSpeech.text = response.response.outputSpeech.text.replace( ' und ', ', ' );
          if( response.response.outputSpeech.text ) response.response.outputSpeech.text += ' und ';
          response.response.outputSpeech.text += Switch.bind(this)(device,command,command.value);
        }

        if( command.room && response.response.outputSpeech.text === '' )
          response.response.outputSpeech.text = 'Ich habe keinen Raum '+ command.room +' mit Geräten '+ (type?'vom Typ '+command.type_name:'') +' gefunden.';

        else if( type && response.response.outputSpeech.text === '' )
          response.response.outputSpeech.text = 'Ich habe keine Geräte vom Typ '+ command.type_name +' gefunden.';

        else if( command.device && command.room &&  response.response.outputSpeech.text === '' )
          response.response.outputSpeech.text = 'Ich habe kein Gerät mit Namen '+ command.device +' im Raum '+ command.room +' gefunden.';

        else if( command.device && response.response.outputSpeech.text === '' )
          response.response.outputSpeech.text = 'Ich habe kein Gerät mit Namen '+ command.device +' gefunden.';

        else {
          if( fhem )
            command.verb = fhem.verbsOfIntent[intent_name];
          if( fhem && fhem.prefixOfIntent[intent_name] !== undefined )
            response.response.outputSpeech.text += ' '+ fhem.prefixOfIntent[intent_name].replace( /;.*/g, '' );
          response.response.outputSpeech.text += ' '+ command.value;
          if( fhem && fhem.suffixOfIntent[intent_name] !== undefined )
            response.response.outputSpeech.text += ' '+ fhem.suffixOfIntent[intent_name].replace( /;.*/g, '' );
          if( fhem && fhem.perfectOfVerb[command.verb] !== undefined )
            response.response.outputSpeech.text += ' '+ fhem.perfectOfVerb[command.verb]
          else
            response.response.outputSpeech.text += ' gestellt';

          response.response.card = { type: 'Simple',
                                     title: intent_name,
                                     content: response.response.outputSpeech.text };
          response.response.outputSpeech.text = 'Ich habe '+ response.response.outputSpeech.text;
          if( !in_session && fhem && fhem.alexaConfirmationLevel < 1 )
            response.response.outputSpeech.text = '';
          else if( fhem && fhem.alexaConfirmationLevel < 2 )
            response.response.outputSpeech.text = 'OK.';
        }

      } else {
        response.response.outputSpeech.text = 'Das habe ich leider nicht verstanden';

      }
    }

    if( in_session ) {
      if( !sessions[session] )
        sessions[session] = {};
        sessions[session].in_session = true;

    } else
      delete sessions[session];

    response.response.shouldEndSession = !in_session;

    callback( response );
}

// entry
var handler = function(event, callback) {
  log2("Received Directive", event);

  var response = null;

  if( event.request ) {
    response = handleCustom.bind(this)(event, callback);
    return;
  }

  var requestedNamespace = event.header.namespace;

  try {

    switch (requestedNamespace) {

      case NAMESPACE_DISCOVERY:
        response = handleDiscovery.bind(this)(event);
        break;

      case NAMESPACE_CONTROL:
        response = handleControl.bind(this)(event);
        break;

      case NAMESPACE_SYSTEM:
        response = handleSystem.bind(this)(event);
        break;

      case NAMESPACE_QUERY:
        response = handleQuery.bind(this)(event);
        break;

      default:
        log2("Error", "Unsupported namespace: " + requestedNamespace);

        response = handleUnexpectedInfo(requestedNamespace);

        break;

    }// switch

  } catch (error) {

    log2("Error", error);

  }// try-catch

  callback( response );
  //return response;

}// exports.handler


var handleDiscovery = function(event) {
  var response = null;

  var requestedName = event.header.name;

  switch (requestedName) {
    case REQUEST_DISCOVER :
      var header = createHeader(NAMESPACE_DISCOVERY, RESPONSE_DISCOVER);

      var payload = {
        discoveredAppliances: []
      };

      for( var d in this.devices ) {
        var device = this.devices[d];

        if( 0 && !device.isOfType('light') && !device.isOfType('thermostat') ) {
          log.info( 'ignoring '+ device.name +' for alxea ha skill' );
          continue;
        }

        if( !device.isInScope('alexa') && !device.isInScope('alexa-ha') ) {
          log.debug( 'ignoring '+ device.name +' for alxea ha skill' );
          continue;
        }

        var room = this.roomOfIntent[oauthClientID];
        //if( room && room !== device.alexaRoom ) {
        if( room && !device.alexaRoom.match( '(^|,)('+room+')(,|\$)' ) ) {
          log.debug( 'ignoring '+ device.name +' in room '+ device.alexaRoom +' for echo in room '+ room );
        }

        if( device.mappings.On
            || device.mappings.Brightness || device.mappings.TargetPosition
            || device.mappings.Hue
            || device.mappings['00001001-0000-1000-8000-135D67EC4377']
            || device.mappings['4648454d-0301-686F-6D65-627269646765']
            || device.mappings.CurrentTemperature
            || device.mappings.TargetTemperature ) {
          //console.log(device);
          var d = { applianceId: device.uuid_base.replace( /[^\w_\-=#;:?@&]/g, '_' ),
                    manufacturerName: 'FHEM'+device.type,
                    modelName: 'FHEM'+ (device.model ? device.model : '<unknown>'),
                    version: '<unknown>',
                    friendlyName: device.alexaName,
                    friendlyDescription: 'n: '+ device.name + (device.alexaRoom?', r: '+ device.alexaRoom:''),
                    isReachable: true,
                    actions: [],
                    additionalApplianceDetails: { device: device.device },
                  };

          if( device.mappings.On ) {
            d.actions.push( "turnOn" );
            d.actions.push( "turnOff" );
          }

          if( device.mappings.Brightness || device.mappings.TargetPosition || device.mappings['00001001-0000-1000-8000-135D67EC4377'] ) {
            d.actions.push( "setPercentage" );
            d.actions.push( "incrementPercentage" );
            d.actions.push( "decrementPercentage" );
          }

          if( device.mappings.TargetTemperature  ) {
            d.actions.push( "setTargetTemperature" );
            d.actions.push( "incrementTargetTemperature" );
            d.actions.push( "decrementTargetTemperature" );
            d.actions.push( "getTargetTemperature" );
          }

          if( device.mappings.CurrentTemperature  ) {
            d.actions.push( "getTemperatureReading" );
          }

          if( device.mappings.Hue  ) {
            d.actions.push( "setColor" );
          }

          if( device.mappings['4648454d-0301-686F-6D65-627269646765'] ) {
            d.actions.push( "setColorTemperature" );
            d.actions.push( "incrementColorTemperature" );
            d.actions.push( "decrementColorTemperature" );
          }

          if( device.mappings.CurrentDoorState  ) {
            d.actions.push( "getLockState" );
          }

          payload.discoveredAppliances.push( d );
        }
      }

      response = createDirective(header, payload);
      break;

    default:
      log2("Error", "Unsupported operation" + requestedName);
      response = handleUnsupportedOperation();

      break;

  }// switch

  return response;

}// handleDiscovery

var handleSystem = function(event) {
  var response = null;

  var requestedName = event.header.name;

  switch (requestedName) {
    case REQUEST_HEALTH_CHECK :
      var header = createHeader(NAMESPACE_SYSTEM,RESPONSE_HEALTH_CHECK)
      var payload = { description: "The system is currently healthy",
                      isHealthy: true,
                    };

      response = createDirective(header, payload);
      break;

    default:
      log2("Error", "Unsupported operation" + requestedName);
      response = handleUnsupportedOperation();

      break;

  }// switch

  return response;

} //handleSystem

var handleControl = function(event) {

  var response = null;

  var requestedName = event.header.name;

  switch (requestedName) {

    case REQUEST_TURN_ON :
      response = handleControlTurnOn.bind(this)(event);
      break;

    case REQUEST_TURN_OFF :
      response = handleControlTurnOff.bind(this)(event);
      break;

    case REQUEST_SET_PERCENTAGE :
      response = handleControlSetPercentage.bind(this)(event);
      break;

    case REQUEST_INCREMENT_PERCENTAGE :
      response = handleControlIncrementPercentage.bind(this)(event);
      break;

    case REQUEST_DECREMENT_PERCENTAGE :
      response = handleControlDecrementPercentage.bind(this)(event);
      break;

    case REQUEST_SET_TARGET_TEMPERATURE :
      response = handleControlSetTargetTemperature.bind(this)(event);
      break;

    case REQUEST_INCREMENT_TARGET_TEMPERATURE :
      response = handleControlIncrementTargetTemperature.bind(this)(event);
      break;

    case REQUEST_DECREMENT_TARGET_TEMPERATURE :
      response = handleControlDecrementTargetTemperature.bind(this)(event);
      break;

    case REQUEST_SET_TARGET_TEMPERATURE :
      response = handleControlSetTargetTemperature.bind(this)(event);
      break;

    case REQUEST_INCREMENT_TARGET_TEMPERATURE :
      response = handleControlIncrementTargetTemperature.bind(this)(event);
      break;

    case REQUEST_DECREMENT_TARGET_TEMPERATURE :
      response = handleControlDecrementTargetTemperature.bind(this)(event);
      break;
    default:
      log2("Error", "Unsupported operation" + requestedName);
      response = handleUnsupportedOperation();

      break;

  }// switch

  return response;

}// handleControl

var handleQuery = function(event) {
  var response = null;

  var requestedName = event.header.name;

  switch (requestedName) {
    default:
      log2("Error", "Unsupported operation" + requestedName);
      response = handleUnsupportedOperation();

      break;

  }// switch

  return response;

} //handleQuery

var handleControlTurnOn = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return createError(ERROR_UNSUPPORTED_TARGET);

  device.command( device.mappings.On, 1 );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_TURN_ON);

  return createDirective(header, {});

}// handleControlTurnOn


var handleControlTurnOff = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return handleUnsupportedOperation();

  device.command( device.mappings.On, 0 );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_TURN_OFF);

  return createDirective(header, {});

}// handleControlTurnOff


var handleControlSetPercentage = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return createError(ERROR_UNSUPPORTED_OPERATION);

  var mapping;
  if( device.mappings.Brightness )
    mapping = device.mappings.Brightness;
  else if( device.mappings.TargetPosition )
    mapping = device.mappings.TargetPosition;
  else if( device.mappings['00001001-0000-1000-8000-135D67EC4377'] )
    mapping = device.mappings['00001001-0000-1000-8000-135D67EC4377'];
  else
    return createError(ERROR_UNSUPPORTED_OPERATION);
  var current = parseFloat( device.fhem.cached(mapping.informId) );

  var target = event.payload.percentageState.value;
  if( mapping.minValue && target < mapping.minValue )
    target = mapping.minValue
  else if( mapping.maxValue && target > mapping.maxValue )
    target = mapping.maxValue

  device.command( mapping, target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_SET_PERCENTAGE);

  return createDirective(header, {});

}// handleControlSetPercentage


var handleControlIncrementPercentage = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return createError(ERROR_UNSUPPORTED_OPERATION);

  var mapping;
  if( device.mappings.Brightness )
    mapping = device.mappings.Brightness;
  else if( device.mappings.TargetPosition )
    mapping = device.mappings.TargetPosition;
  else if( device.mappings['00001001-0000-1000-8000-135D67EC4377'] )
    mapping = device.mappings['00001001-0000-1000-8000-135D67EC4377'];
  else
    return createError(ERROR_UNSUPPORTED_OPERATION);
  var current = parseFloat( device.fhem.cached(mapping.informId) );

  var target = current + event.payload.deltaPercentage.value;
  if( target < 0 || target > 100 )
    return createError(ERROR_VALUE_OUT_OF_RANGE, {minimumValue: 0, maximumValue: 100});
  else if( mapping.minValue && target < mapping.minValue )
    target = mapping.minValue
  else if( mapping.maxValue && target > mapping.maxValue )
    target = mapping.maxValue

  device.command( mapping, target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_INCREMENT_PERCENTAGE);

  return createDirective(header, {});

}// handleControlIncrementPercentage


var handleControlDecrementPercentage = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return createError(ERROR_UNSUPPORTED_OPERATION);

  var mapping;
  if( device.mappings.Brightness )
    mapping = device.mappings.Brightness;
  else if( device.mappings.TargetPosition )
    mapping = device.mappings.TargetPosition;
  else if( device.mappings['00001001-0000-1000-8000-135D67EC4377'] )
    mapping = device.mappings['00001001-0000-1000-8000-135D67EC4377'];
  else
    return createError(ERROR_UNSUPPORTED_OPERATION);
  var current = parseFloat( device.fhem.cached(mapping.informId) );

  var target = current - event.payload.deltaPercentage.value;
  if( target < 0 || target > 100 )
    return createError(ERROR_VALUE_OUT_OF_RANGE, {minimumValue: 0, maximumValue: 100});
  else if( mapping.minValue && target < mapping.minValue )
    target = mapping.minValue
  else if( mapping.maxValue && target > mapping.maxValue )
    target = mapping.maxValue

  device.command( mapping, target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_DECREMENT_PERCENTAGE);

  return createDirective(header, {});

}// handleControlDecrementPercentage


var handleControlSetTargetTemperature = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return handleUnsupportedOperation();

  var current = parseFloat(device.fhem.cached(device.mappings.TargetTemperature.informId));
  var target = event.payload.targetTemperature.value;

  var min = device.mappings.TargetTemperature.minValue;
  if( min === undefined ) min = 15.0;
  var max = device.mappings.TargetTemperature.maxValue;
  if( max === undefined ) max = 30.0;

  if( target < min || target > max )
    return createError(ERROR_VALUE_OUT_OF_RANGE, {minimumValue: min, maximumValue: max});

  device.command( device.mappings.TargetTemperature, target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_SET_TARGET_TEMPERATURE);

  var payload = { targetTemperature: { value: target },
                  //temperatureMode: { value: 'AUTO' },
                  previousState: { targetTemperature: { value: current },
                                   //mode: { value: 'AUTO' },
                                 }
                };

  return createDirective(header, payload);

}// handleControlSetTargetTemperature


var handleControlIncrementTargetTemperature = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return handleUnsupportedOperation();

  var current = parseFloat(device.fhem.cached(device.mappings.TargetTemperature.informId));
  var target = current + event.payload.deltaTemperature.value;

  var min = device.mappings.TargetTemperature.minValue;
  if( min === undefined ) min = 15.0;
  var max = device.mappings.TargetTemperature.maxValue;
  if( max === undefined ) max = 30.0;

  if( target < min || target > max )
    return createError(ERROR_VALUE_OUT_OF_RANGE, {minimumValue: min, maximumValue: max});

  device.command( device.mappings.TargetTemperature, target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_INCREMENT_TARGET_TEMPERATURE);

  var payload = { targetTemperature: { value: target },
                  //temperatureMode: { value: 'AUTO' },
                  previousState: { targetTemperature: { value: current },
                                   //mode: { value: 'AUTO' },
                                 }
                };

  return createDirective(header, payload);

}// handleControlIncrementTargetTemperature


var handleControlDecrementTargetTemperature = function(event) {

  var device = this.devices[event.payload.appliance.additionalApplianceDetails.device.toLowerCase()];
  if( !device )
    return handleUnsupportedOperation();

  var current = parseFloat(device.fhem.cached(device.mappings.TargetTemperature.informId));
  var target = current - event.payload.deltaTemperature.value;

  var min = device.mappings.TargetTemperature.minValue;
  if( min === undefined ) min = 15.0;
  var max = device.mappings.TargetTemperature.maxValue;
  if( max === undefined ) max = 30.0;

  if( target < min || target > max )
    return createError(ERROR_VALUE_OUT_OF_RANGE, {minimumValue: min, maximumValue: max});

  device.command( device.mappings.TargetTemperature, target );


  var header = createHeader(NAMESPACE_CONTROL,RESPONSE_DECREMENT_TARGET_TEMPERATURE);

  var payload = { targetTemperature: { value: target },
                  //temperatureMode: { value: 'AUTO' },
                  previousState: { targetTemperature: { value: current },
                                   //mode: { value: 'AUTO' },
                                 }
                };

  return createDirective(header, payload);

}// handleControlDecrementTargetTemperature


var handleUnsupportedOperation = function() {

  var header = createHeader(NAMESPACE_CONTROL,ERROR_UNSUPPORTED_OPERATION);

  return createDirective(header, {});

}// handleUnsupportedOperation


var handleUnexpectedInfo = function(fault) {

  var header = createHeader(NAMESPACE_CONTROL,ERROR_UNEXPECTED_INFO);

  var payload = {
    faultingParameter: fault
  };

  return createDirective(header, payload);

}// handleUnexpectedInfo


// support functions

var createMessageId = function() {

  var d = new Date().getTime();

  var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {

    var r = (d + Math.random()*16)%16 | 0;

    d = Math.floor(d/16);

    return (c=='x' ? r : (r&0x3|0x8)).toString(16);

  });

  return uuid;

}// createMessageId


var createHeader = function(namespace, name) {

  return {
    name: name,
    payloadVersion: '2',
    namespace: namespace,
    messageId: createMessageId(),
  };

}// createHeader


var createDirective = function(header, payload) {

  return {
    header: header,
    payload: payload
  };

}// createDirective

var createError = function(error, payload) {

  if( payload === undefined )
    payload = {};

  return {
    header: createHeader(NAMESPACE_CONTROL, error),
    payload: payload,
  };
}// createError


var log2 = function(title, msg) {

  console.log('**** '+ title +': '+ JSON.stringify(msg));

}// log
