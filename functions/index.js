'use strict';

let createUser = (() => {
  var _ref = _asyncToGenerator(function* (data) {
    const userData = {
      email: data.email,
      displayName: data.firstName + ' ' + data.lastName
    };

    const metaData = {
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      refreshTime: new Date().getTime()
    };

    const user = yield admin.auth().createUser(userData);
    console.log('User created', user);

    if (data.customClaims) {
      console.log('Updating user ' + user.uid + ' with custom claims', data.customClaims);
      yield admin.auth().setCustomUserClaims(user.uid, data.customClaims);
    }

    const metadataRef = admin.database().ref("metadata/" + user.uid);
    metadataRef.set(metaData);

    return user;
  });

  return function createUser(_x) {
    return _ref.apply(this, arguments);
  };
})();

let emailIsValid = (() => {
  var _ref2 = _asyncToGenerator(function* (email, res) {
    try {
      yield admin.auth().getUserByEmail(email);
      res.status(400).send({ message: 'Email is already in use or has been invited' });
      return false;
    } catch (error) {
      // this should error
      return true;
    }
  });

  return function emailIsValid(_x2, _x3) {
    return _ref2.apply(this, arguments);
  };
})();

let checkIsAdmin = (() => {
  var _ref3 = _asyncToGenerator(function* (token, res) {
    const decodedToken = yield admin.auth().verifyIdToken(token);

    if (!decodedToken.uid) {
      res.status(400).send({ message: 'Invalid token' });
      return false;
    }

    const user = yield admin.auth().getUser(decodedToken.uid);

    if (!user) {
      res.status(400).send({ message: 'Invalid token' });
      return false;
    }

    if (!user.customClaims.isAdmin) {
      res.status(403).send({ message: 'You are not an admin' });
      return false;
    }

    return user;
  });

  return function checkIsAdmin(_x4, _x5) {
    return _ref3.apply(this, arguments);
  };
})();

/***
 * Process registered user
 */
/*
exports.processRegisterUser = functions.auth.user().onCreate(async (user) => {
  if (user.email && !user.isClient) {
    console.log('User before proccessing', user);
    await admin.auth().setCustomUserClaims(user.uid, {isProcessed: true});

    const metadataRef = admin.database().ref("metadata/" + user.uid);
    const timestamp = new Date().getTime();
    metadataRef.set({refreshTime: timestamp, email: user.email});
  }
});
*/

/***
 * Validate email
 */


function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const uid = require('rand-token').uid;
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors')({
  origin: true
});

admin.initializeApp(functions.config().firebase);

exports.validateEmail = functions.https.onRequest((req, res) => {
  return cors(req, res, _asyncToGenerator(function* () {
    if (yield emailIsValid(req.body.email, res)) {
      res.status(200).send({});
    }
  }));
});

/***
 * Invite user
 */
exports.inviteUser = functions.https.onRequest((req, res) => {
  return cors(req, res, _asyncToGenerator(function* () {
    // check to make sure requesting user is an admin
    const adminUser = yield checkIsAdmin(req.body.token, res);

    if (!adminUser) {
      return false;
    }

    // check to make sure this email has not already been invited
    if (!(yield emailIsValid(req.body.email, res))) {
      return false;
    }

    const inviteToken = uid(128);

    let customClaims;

    switch (req.body.role) {
      case 'manager':
        customClaims = { isManager: true };
        break;
      case 'client':
        customClaims = { isClient: true };
        break;
      case 'member':
        customClaims = { isMember: true };
        break;
    }

    const newUser = yield createUser({
      email: req.body.email,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      customClaims: Object.assign({}, customClaims, { inviteToken })
    });

    if (!newUser) {
      res.status(500).end();
      return false;
    }

    const invitesRef = admin.database().ref('invites/');
    const invite = invitesRef.push({
      token: inviteToken,
      inviter: adminUser.uid,
      email: req.body.email,
      firstName: req.body.firstName,
      lastName: req.body.lastName
    });

    console.log('Invite token', invite.key);

    // TODO: send email

    res.status(200).send({});
  }));
});

/***
 * Accept invite
 */
exports.acceptInvite = functions.https.onRequest((req, res) => {
  return cors(req, res, _asyncToGenerator(function* () {
    const { uid, token, email, password, firstName, lastName } = req.body;

    const snapshot = yield admin.database().ref('invites/' + uid).once('value');
    const invite = snapshot.val();

    // check to make sure invite exists
    if (!invite) {
      res.status(400).send('Could not find invitation');
      return false;
    }

    // check to make sure invite tokens match
    if (token !== invite.token) {
      res.status(400).send('Tokens do not match');
      return false;
    }

    // check to make sure a user was created with invite
    let user;

    try {
      user = yield admin.auth().getUserByEmail(invite.email);
    } catch (error) {
      res.status(500).send('No invited user found');
      return false;
    }

    // check to make sure the user has not already accepted invitation
    if (!user.customClaims.inviteToken) {
      res.status(409).send('User has already accepted invitation');
      return false;
    }

    // check to make sure the new email address is not in use already
    try {
      const invitedUser = yield admin.auth().getUserByEmail(email);

      if (!invitedUser.customClaims.inviteToken) {
        res.status(409).send('Email already in use');
        return false;
      }
    } catch (error) {
      // this should fail
    }

    yield admin.auth().updateUser(user.uid, {
      email,
      password,
      displayName: firstName + ' ' + lastName
    });

    yield admin.auth().setCustomUserClaims(user.uid, Object.assign(user.customClaims, { inviteToken: null }));

    yield admin.database().ref('metadata/' + user.uid).set({
      firstName,
      lastName,
      refreshTime: new Date().getTime()
    });

    yield admin.database().ref('invites/' + uid).remove();

    res.status(200).send();
  }));
});

/***
 * Create user
 */
exports.createUser = functions.https.onRequest((req, res) => {
  const user = createUser(req.body);
  res.status(200).end();
});

/***
 * Update with Admin role
 */
exports.addAdminRole = functions.https.onRequest((() => {
  var _ref7 = _asyncToGenerator(function* (req, res) {
    const user = yield admin.auth().getUserByEmail(req.body.email);

    // check to make sure requesting user is an admin
    const adminUser = yield checkIsAdmin(req.body.token, res);

    if (!adminUser) {
      return false;
    }

    yield admin.auth().setCustomUserClaims(user.uid, { isAdmin: true });
    const metadataRef = admin.database().ref("metadata/" + user.uid);
    metadataRef.set({ refreshTime: new Date().getTime() });
    res.status(200).end();
  });

  return function (_x6, _x7) {
    return _ref7.apply(this, arguments);
  };
})());