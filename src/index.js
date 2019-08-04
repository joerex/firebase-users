const uid = require('rand-token').uid;
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');
const nodemailer = require('nodemailer');
const cors = require('cors')({
  origin: true,
});
const config = functions.config()
const Rollbar = require('rollbar');
const rollbar = new Rollbar({accessToken: config.rollbar.token});
const SENDGRID = 'SENDGRID'
const GMAIL = 'GMAIL'

admin.initializeApp(functions.config().firebase);

async function createUser(data) {
  const userData = {
    email: data.email
  };

  const profile = {
    firstName: data.firstName,
    lastName: data.lastName,
    displayName: data.firstName + ' ' + data.lastName,
    refreshTime: new Date().getTime()
  }

  const user = await admin.auth().createUser(userData);
  console.log('User created', user);

  if (data.customClaims) {
    console.log('Updating user ' + user.uid + ' with custom claims', data.customClaims);
    await admin
        .auth()
        .setCustomUserClaims(user.uid, data.customClaims);
  }

  admin
      .database()
      .ref("users/" + user.uid)
      .set(profile);

  return user;
}

async function emailIsValid(email, res) {
  try {
     await admin.auth().getUserByEmail(email);
    res.status(400).send({message: 'Email is already in use or has been invited'});
    return false;
  }
  catch (error) {
    // this should error
    return true;
  }
}

async function checkIsAdmin(token, res) {
  const decodedToken = await admin.auth().verifyIdToken(token);

  if (!decodedToken.uid) {
    res.status(400).json({message: 'Invalid token'});
    return false;
  }

  const user = await admin.auth().getUser(decodedToken.uid);

  if (!user) {
    // invalid token
    res.status(400).json({message: 'Access denied'});
    return false;
  }

  if (!user.customClaims.isAdmin) {
    // not an admin
    res.status(403).json({message: 'Access denied'});
    return false;
  }

  return user;
}

async function mapUsers(action, nextPageToken) {
  try {
    const listUsersResult = await admin.auth().listUsers(1000, nextPageToken);
    const count = listUsersResult.users.length

      await Promise.all(listUsersResult.users.map(async (userRecord) => {
          await action(userRecord)
      }))

    if (listUsersResult.pageToken) {
      return await mapUsers(action, listUsersResult.pageToken);
    }
  }
  catch(e) {
    console.log('Error mapping users', e);
  }
}

/***
 * Process registered user
 */
exports.processRegisterUser = functions.auth.user().onCreate(async (user) => {
  try {
    const ref = admin.database().ref("users/" + user.uid)
    const snapshot = await ref.once('value')
    const { firstName, lastName } = snapshot.val()

    await ref.update({
      displayName: firstName + ' ' + lastName,
      refreshTime: new Date().getTime()
    });
    console.log('Processed user', user.uid)
  }
  catch (e) {
    console.log('Error processing user', e)
  }
});

exports.clearUsers = functions.https.onRequest( (req, res) => {
  return cors(req, res, async () => {
    try {
      const adminUser = await checkIsAdmin(req.body.token, res);

      if (!adminUser) {
        res.status(400).json({ message: 'Access denied' });
        return false;
      }

      async function deleteUser(user) {
        if (user.uid !== adminUser.uid) {
            await admin.auth().deleteUser(user.uid)
            await admin.database().ref('users/' + user.uid).remove()
            console.log('Deleted user', user.uid)
        }
      }

      await mapUsers(deleteUser)
      res.status(200).json({})
    }
    catch (e) {
      res.status(500).json({ message: 'Unexpected server error'})
      console.log('Error clearing users', e)
    }
  })
})

/***
 * Validate email
 */
exports.validateEmail = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
    if (await emailIsValid(req.body.email, res)) {
      res.status(200).json({});
    }
  });
});

/***
 * Invite user
 */
exports.inviteUser = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
    // check to make sure requesting user is an admin
    const adminUser = await checkIsAdmin(req.body.token, res);

    if (!adminUser) {
      // only admins can invite users
      res.status(400).json({ message: 'Access denied' });
      return false;
    }

    // check to make sure this email has not already been invited
    if (!await emailIsValid(req.body.email, res)) {
      res.status(400).json({ message: 'Invitation already sent' });
      return false;
    }

    const inviteToken = uid(128);
    const role = req.body.role ? req.body.role.value : ''

    const getCustomClaims = (role) => {
      switch (role) {
        case 'manager':
          return {isManager: true};
        case 'client':
          return {isClient: true};
        case 'member':
          return {isMember: true};
        default:
          return {isAnonymous: true}
      }
    }

    const newUser = await createUser({
      email: req.body.email,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      customClaims: Object.assign({}, getCustomClaims(role), {inviteToken})
    });

    if (!newUser) {
      res.status(500).end();
      return false;
    }

    console.log('New user', newUser);

    const invite = admin.database()
        .ref('invites/')
        .push({
          token: inviteToken,
          inviter: adminUser.uid,
          email: req.body.email,
          firstName: req.body.firstName,
          lastName: req.body.lastName
        });

    if (!invite) {
      res.status(500).end();
      return false;
    }

    console.log('Invitation', invite);

    if (!config.feature.sendinviteemail) {
      res.status(200).json({});
      return true
    }

    const link =
        `${config.client.url}/${config.client.acceptinvitepath}/${invite.key}/${inviteToken}`

    console.log('Invitation link', link)

    const msg = {
      to: newUser.email,
      from: config.gmail.email,
      subject: `You've been invited`,
      text: 'Click here to create your account: ' + link,
      html: '<strong>Click <a href="${link}">here</a> to create your account.</strong>',
    };

    if (config.mail.service === GMAIL) {
      return nodemailer
          .createTransport({
            service: 'gmail',
            auth: {
              user: config.gmail.email,
              pass: config.gmail.password
            }
          })
          .sendMail(msg, (error, info) => {
            if(error){
              res.status(500).end()
              return false
            }
            res.status(200).json({});
          });
    }
    else if (config.mail.service === SENDGRID) {
      try {
        sgMail.setApiKey(functions.config().sendgrid.key);
        const req = sgMail.send(msg);
        res.status(200).json({});
        return true
      }
      catch (error) {
        res.status(500).end()
        return false;
      }
    }
  });
});

/***
 * Accept invite
 */

exports.acceptInvite = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
      const {key, token, email, password, firstName, lastName} = req.body;

      const snapshot = await admin.database().ref('invites/' + key).once('value')
      const invite = snapshot.val()

      // invite exists and tokens match
      if (!invite || token !== invite.token) {
        return res.status(400).json({ message: 'Could not find invitation' })
      }

      const user = await admin.auth().getUserByEmail(invite.email)

      // user was created with invite
      if (!user) {
        return res.status(400).json({ message: 'No invited user found' })
      }

      // user has not already accepted invitation
      if (!user.customClaims.inviteToken) {
        return res.status(400).json({ message: 'User has already accepted invitation' })
      }

      const existingUser = await admin.auth().getUserByEmail(email)

      // new email address is not in use already
      if (existingUser.uid !== user.uid) {
        return res.status(400).json({ message: 'Email already in use' })
      }

      await admin.auth().updateUser(user.uid, {
        email,
        password,
      });

      await admin.auth().setCustomUserClaims(user.uid, Object.assign(user.customClaims, {inviteToken: null}));

      await admin.database().ref('users/' + user.uid).set({
        firstName,
        lastName,
        displayName: firstName + ' ' + lastName,
        refreshTime: new Date().getTime()
      });

      await admin.database().ref('invites/' + key).remove();

      return res.status(200).json({});
  });
});

/***
 * Create user
 */
exports.createUser = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
    try {
      console.log('Admin token', req.body.token);

      // check to make sure requesting user is an admin
      const adminUser = await checkIsAdmin(req.body.token, res);

      if (!adminUser) {
        return false;
      }

      // check to make sure this email has not already been invited
      if (!await emailIsValid(req.body.email, res)) {
        return false;
      }

      const user = createUser(req.body);
      res.status(200).json(user);
    }
    catch (error) {
      rollbar.error(error, req);
      //
    }
  });
});

/***
 * Update with Admin role
 */
exports.addAdminRole = functions.https.onRequest(async (req, res) => {

  try {
    const user =
        await admin
            .auth()
            .getUserByEmail(req.body.email);

    const isAdminUser =
        await checkIsAdmin(req.body.token, res);

    if (!isAdminUser) {
      return false;
    }

    await admin
        .auth()
        .setCustomUserClaims(user.uid, {isAdmin: true});

    await admin
          .database()
          .ref("users/" + user.uid)
          .set({refreshTime: new Date().getTime()});

    res.status(200).end();
  }
  catch (error) {
    rollbar.error(error, req);
    //
  }
});