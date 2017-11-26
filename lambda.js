
const PORT=3000;
const HOST='mein.host.name';


// entry
exports.handler = function(event, context, callback) {

  console.log(`EVENT: ${event}`);
  console.log(`CONTEXT: ${context}`);
  
  var post_data = JSON.stringify(event);
  
  var options = {
    hostname: HOST,
    port: PORT,
    //family: 6,
    //path: '/',
    method: 'POST',
    rejectUnauthorized: false, // accept self-signed
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(post_data)
    }
  };

  var request = require('https').request(options, (result) => {
    console.log(`STATUS: ${result.statusCode}`);
    console.log(`HEADERS: ${JSON.stringify(result.headers)}`);
    result.setEncoding('utf8');
    var body = '';
    result.on('data', (chunk) => body += chunk);
    result.on('end', () => {
      console.log(`BODY: ${JSON.stringify(body)}`);
      callback(null, JSON.parse(body) );
      return;
    });
  });

  request.on('error', (e) => {
    console.log(`problem with request: ${e.message}`);
    callback(null, createError(ERROR_TARGET_OFFLINE) );
    return;
  });

  request.write(post_data);
  request.end();

  return;
  
}// exports.handler
