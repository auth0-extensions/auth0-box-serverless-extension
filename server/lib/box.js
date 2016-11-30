import uuid from 'uuid';
import auth0 from 'auth0';
import request from 'request';
import jwt from 'jsonwebtoken';
import { UnauthorizedError } from 'auth0-extension-tools';

import logger from './logger';
import config from './config';

const BoxConstants = {
  HEADERS: {
    V2_AUTH_ACCESS: 'Bearer'
  },
  DEFAULT_SETTINGS: {
    JWT_EXPIRATION: '10s',
    JWT_ALGORITHM: 'RS256',
    JWT_TYPE: 'JWT',
    JWT_GRANT_TYPE: 'urn:ietf:params:oauth:grant-type:jwt-bearer'
  },
  BASE_URL: 'https://api.box.com/oauth2/token',
  APP_USERS_URL: 'https://api.box.com/2.0/users',
  ENTERPRISE: 'enterprise',
  USER: 'user'
};

const issueAppUserToken = (publicKeyId, signingCert, boxClientId, boxId) => jwt.sign(
  {
    iss: boxClientId,
    aud: BoxConstants.BASE_URL,
    jti: uuid.v4(),
    sub: boxId,
    box_sub_type: BoxConstants.USER
  },
  signingCert,
  {
    header: {
      typ: BoxConstants.DEFAULT_SETTINGS.JWT_TYPE,
      kid: publicKeyId
    },
    expiresIn: BoxConstants.DEFAULT_SETTINGS.JWT_EXPIRATION,
    noTimestamp: true,
    algorithm: BoxConstants.DEFAULT_SETTINGS.JWT_ALGORITHM
  }
);

const getBoxId = (domain, user, token) => {
  const auth = new auth0.AuthenticationClient({
    clientId: user.azp || user.aud,
    domain
  });

  return auth.tokens.getInfo(token)
    .then(profile => profile && profile.app_metadata && profile.app_metadata.box_id);
};

const getSigningCert = (signingCert, password) => {
  if (password && password.length) {
    return {
      key: new Buffer(signingCert, 'base64').toString('ascii'),
      passphrase: password
    };
  }

  return new Buffer(signingCert, 'base64').toString('ascii');
};

export default (user, token) =>
  getBoxId(config('AUTH0_DOMAIN'), user, token)
    .then((boxId) => {
      if (!boxId || !boxId.length) {
        return Promise.reject(new UnauthorizedError('The current user does not have a boxId.'));
      }

      const signingCert = getSigningCert(config('BOX_SIGNING_CERT'), config('BOX_SIGNING_CERT_PASSWORD'));
      const appUserToken = issueAppUserToken(config('BOX_PUBLIC_KEY_ID'), signingCert, config('BOX_CLIENT_ID'), boxId);
      const formData = {
        grant_type: BoxConstants.DEFAULT_SETTINGS.JWT_GRANT_TYPE,
        client_id: config('BOX_CLIENT_ID'),
        client_secret: config('BOX_CLIENT_SECRET'),
        assertion: appUserToken
      };

      return new Promise((resolve, reject) => {
        request.post({ url: BoxConstants.BASE_URL, form: formData, json: true }, (err, res) => {
          if (err) {
            logger.error('Box Error:', JSON.stringify(err, null, 2));
            return reject(err);
          }

          if (res.statusCode !== 200 || !res.body) {
            logger.error('Box Error:', JSON.stringify(res, null, 2));

            const boxError = new Error(`${(res.body && res.body.error_description) || res.text || res.statusCode}`);
            boxError.name = 'box_error';
            boxError.status = res.statusCode;
            return reject(boxError);
          }

          const boxToken = res.body;
          boxToken.expires_at = Date.now() + 2700000;
          return resolve(boxToken);
        });
      });
    });
