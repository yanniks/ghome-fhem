// Copyright 2017, Google, Inc.
// Licensed under the Apache License, Version 2.0 (the 'License');
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an 'AS IS' BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Structure of Data
 * {
 *   <uid>: {
 *     <device id>: {
 *       properties: {
 *         <property name>: <property value>,
 *         <property name>: <property value>
 *       },
 *       states: {
 *         <state name>: <state value>,
 *         <state name>: <state value>
 *       }
 *     },
 *     <device id>: {...}
 *   },
 *   <uid>: {
 *     <device id>: {...},
 *     <device id>: {...},
 *     <device id>: {...}
 *   },
 *   ...
 * }
 */

const Data = {};

/**
 * Structure of Auth
 * {
 *   clients: {
 *      <client id>:
 *          clientSecret: <value>,
 *          uid: <value>
 *      }
 *   },
 *   users: {
 *      <username>: {
 *          password: <password>,
 *          authtoken: <token>
 *      }
 *   }
 * }
 * @type {{}}
 */

/*
 * This is a set of hardcoded Auth clients and users (and their access tokens)
 * for testing this mock OAuth server. These fake users can be used just to
 * test the service. This is not real user data.
 */
const Auth = {
    clients: {},
    users: {},
    authcodes: {}
};

Data.version = 0;

/**
 * get a full status for everything stored for a user
 *
 * @param uid
 * @returns
 * {
 *   uid: <uid>,
 *   devices: {
 *     <device id>: {
 *       properties: {
 *         <property name>: <property value>,
 *         <property name>: <property value>
 *       },
 *       states: {
 *         <state name>: <state value>,
 *         <state name>: <state value>
 *       }
 *     },
 *     <device id>: {...},
 *     ...
 *   }
 * }
 */
Data.getUid = function (uid) {
    // console.log('getUid', uid);
    return Data[uid];
};

/**
 * get current states for all devices stored for a user
 *
 * @param uid
 * @param deviceIds
 * @returns
 * {
 *   <device id>: {
 *     <state name>: <state value>,
 *     <state name>: <state value>
 *   },
 *   <device id>: {...},
 * }
 */
Data.getStates = function (uid, deviceIds = undefined) {
    // console.log('getStates', uid);
    let states = {};

    if (!deviceIds) {
        Object.keys(Data[uid]).forEach(function (deviceId) {
            if (Data[uid].hasOwnProperty(deviceId)) {
                states[deviceId] = Data[uid][deviceId].states;
            }
        });
    } else {
        for (let i = 0; i < deviceIds.length; i++) {
            let deviceId = deviceIds[i];
            if (Data[uid].hasOwnProperty(deviceId)) {
                states[deviceId] = Data[uid][deviceId].states;
            }
        }
    }

    return states;

};

/**
 * get current states for all devices stored for a user
 *
 * @param uid
 * @param deviceIds
 * @returns
 * {
 *   <device id>: {
 *     <property name>: <property value>,
 *     <property name>: <property value>
 *   },
 *   <device id>: {...},
 * }
 */
Data.getProperties = function (uid, deviceIds = undefined) {
    // console.log('getProperties', uid);
    let properties = {};

    if (!deviceIds) {
        Object.keys(Data[uid]).forEach(function (deviceId) {
            if (Data[uid].hasOwnProperty(deviceId)) {
                properties[deviceId] = Data[uid][deviceId].properties;
            }
        });
    } else {
        for (let i = 0; i < deviceIds.length; i++) {
            let deviceId = deviceIds[i];
            if (Data[uid].hasOwnProperty(deviceId)) {
                properties[deviceId] = Data[uid][deviceId].properties;
            }
        }
    }

    return properties;
};

/**
 * get a status for the passed in device ids, otherwise get a full status
 *
 * @param uid
 * @param deviceIds (optional)
 * @returns
 * {
 *   uid: <uid>,
 *   devices: {
 *     <device id>: {
 *       properties: {
 *         <property name>: <property value>,
 *         <property name>: <property value>
 *       },
 *       states: {
 *         <state name>: <state value>,
 *         <state name>: <state value>
 *       }
 *     },
 *     <device id>: {...},
 *     ...
 *   }
 * }
 */
Data.getStatus = function (uid, deviceIds = undefined) {
    // return Data.getUid(uid);
    if (!Data[uid]) {
        console.error("cannot getStatus of devices without first registering the user!");
        return;
    }

    // console.log('getStatus deviceIds', deviceIds);
    if (!deviceIds || deviceIds == {} ||
        (Object.keys(deviceIds).length === 0 && deviceIds.constructor === Object))
        return Data.getUid(uid);

    let devices = {};
    for (let i = 0; i < deviceIds.length; i++) {
        let curId = deviceIds[i];
        if (!Data[uid][curId])
            continue;
        devices[curId] = Data[uid][curId];
        // console.log('devices[curId]', devices[curId]);
    }
    // console.log('devices', devices);
    return devices;
};

/**
 * update a device
 *
 * @param uid
 * @param device
 * {
 *   states: {
 *     on: true,
 *     online: true
 *      ...
 *   },
 *   properties: {
 *     name: "smart home light 1",
 *     firmware: "1fzxa84232n4nb6478n8",
 *     traits: ["onoff"],
 *     nickname: "kitchen light",
 *     type: "light",
 *      ...
 *   }
 * }
 */
Data.execDevice = function (uid, device) {
    if (!Data[uid]) {
        console.error("cannot register a device without first registering the user!");
        return;
    }
    // console.log('execDevice', device);
    if (!Data[uid][device.id])
        Data[uid][device.id] = {
            states: {},
            properties: {}
        };
    if (device.hasOwnProperty('properties')) {
        // update properties
        Object.keys(device.properties).forEach(function (key) {
            if (device.properties.hasOwnProperty(key)) {
                // console.log('property ' + key, device.properties[key]);
                Data[uid][device.id].properties[key] = device.properties[key];
            }
        });
    }
    if (device.hasOwnProperty('states')) {
        // update states
        Object.keys(device.states).forEach(function (key) {
            if (device.states.hasOwnProperty(key)) {
                // console.log('state ' + key, device.states[key]);
                Data[uid][device.id].states[key] = device.states[key];
            }
        });
    }
    // console.log('execDevice after', Data[uid][device.id]);
    Data.version++;
};

/**
 * register or update a device
 *
 * @param uid
 * @param device
 */
Data.registerDevice = function (uid, device) {
    // wrapper for exec, since they do the same thing
    Data.execDevice(uid, device);
};

/**
 * removes a device from authstore
 *
 * @param uid
 * @param device
 */
Data.removeDevice = function (uid, device) {
    if (!Data[uid]) {
        console.error("cannot remove a device without first registering the user!");
        return;
    }
    delete Data[uid][device.id];
    Data.version++;
};

/**
 * checks if user and auth exist and match
 *
 * @param uid
 * @param authToken
 * @returns {boolean}
 */
Data.isValidAuth = function (authToken) {
    for (const user in Auth.users) {
        if (Auth.users[user].authtoken === authToken) {
            return true;
        }
    }
    return false;
};

exports.getUid = Data.getUid;
exports.getStatus = Data.getStatus;
exports.getStates = Data.getStates;
exports.getProperties = Data.getProperties;
exports.isValidAuth = Data.isValidAuth;
exports.registerUser = Data.registerUser;
exports.removeUser = Data.removeUser;
exports.execDevice = Data.execDevice;
exports.registerDevice = Data.registerDevice;
exports.removeDevice = Data.removeDevice;
exports.Auth = Auth;