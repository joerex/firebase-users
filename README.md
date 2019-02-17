# Firebase User Functions
This is a set of Firebase endpoints to provide applications with a reliable way to manage users. 

- Create user
- Validate email (check it doesn't exist and hasn't been invited)
- Invite user
- Accept invite
- Update user role to admin
  
## Setup

##### 1. Install dependencies
```
$ npm install -g firebase-tools
$ firebase login
$ firebase use --add <project-id>
$ npm install
```

##### 2. Build and deploy
```
// just build
$ npm run build

// build and deploy
$ npm run deploy
```
##### 3. Connect with an application

In order for your app to communicate with the HTTP functions you will need to create a firebase project and note the following information.

- Region where you deployed your project (eg `us-central1`)
- Your project ID (eg `handpan-36343`)  
  
API root endpoint:

```
https://<region>-<project-id>.cloudfunctions.net
```

## API
 


#### createUser
Creates a user given an `email`, `firstName`, `lastNmame`, and admin `token`. The token can be obtained from an admin (see [custom claims](https://firebase.google.com/docs/auth/admin/custom-claims)).
  
```
curl -X POST -H "Content-Type:application/json" https://<region>-<project-id>.cloudfunctions.net/createUser -d '{"email": "newuser@email.com", "firstName": "Firstname", "lastName": "Lastname"}'
```
```
User created UserRecord {
  uid: '0101010101010101010101010',
  email: 'newuser@email.com',
  emailVerified: false,
  displayName: 'Firstname Lastname',
  ...
}
```

#### validateEmail
Checks to make sure an `email` is not already in use and hasn't been invited.

```
curl -X POST -H "Content-Type:application/json" https://<region>-<project-id>.cloudfunctions.net/validateEmail -d '{"email": "example@email.com", "token": ""}'
```

#### inviteUser
Creates a user given an `email`, `firstName`, `lastName`, designated `role` and a id `token`.

Three roles are currently available to use: `'manager'`, `'client'`, `'member'`.

The token can be obtained from a logged in user with an admin role.

When a user is invited an invite token is created.

TODO: email token on invite.

```
curl -X POST -H "Content-Type:application/json" https://<region>-<project-id>.cloudfunctions.net/inviteUser -d '{"email": "", "firstName": "", "lastName": "", "role": "", "token": ""}'
```

#### acceptInvite
Accept an invite given an `email`, `password`, `firstName`, `lastName`, `key` and `token`. The key and token are created when `inviteUser` is called. 
```
curl -X POST -H "Content-Type:application/json" https://<region>-<project-id>.cloudfunctions.net/acceptInvite -d '{"uid": "", "email": "", "password": "", "firstName": "", "lastName": "", "token": ""}'
```

#### addAdminRole
Changes a user role to admin given an `email` and an admin `token`. The token can be obtained from an admin (see [custom claims](https://firebase.google.com/docs/auth/admin/custom-claims)).

```
curl -X POST -H "Content-Type:application/json" https://<region>-<project-id>.cloudfunctions.net/addAdminRole -d '{"email": "", token: ""}'
```