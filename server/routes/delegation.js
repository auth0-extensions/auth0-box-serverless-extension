import jwt from 'express-jwt';
import cors from 'cors';
import { Router as router } from 'express';
import { UnauthorizedError } from 'auth0-extension-tools';
import { expressJwtSecret, SigningKeyNotFoundError } from 'jwks-rsa';

import config from '../lib/config';
import { getAppUserToken } from '../lib/box';

export default () => {
  const authorize = jwt({
    secret: expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `https://${config('AUTH0_DOMAIN')}/.well-known/jwks.json`,
      handleSigningKeyError(err, cb) {
        if (err instanceof SigningKeyNotFoundError) {
          return cb(new UnauthorizedError('A token was provided with an invalid kid'));
        }

        return cb(err);
      }
    }),

    algorithms: [ 'RS256' ],

    // Validate the audience and the issuer.
    audience: process.env.API_AUDIENCE,
    issuer: `https://${config('AUTH0_DOMAIN')}/`,

    // Optionally require authentication
    credentialsRequired: true
  });

  const checkScope = scope =>
    (req, res, next) => {
      if (req.user.scope && req.user.scope.indexOf(scope) >= 0) {
        return next();
      }

      return next(new UnauthorizedError(`Insufficient scopes. Scope "${scope}" is required.`));
    };

  const whitelist = (config('CORS_WHITELIST') || '').split(',');
  const corsOptions = {
    origin(origin, callback) {
      if (!origin || origin.length === 0 || whitelist.indexOf(origin) !== -1 || (whitelist.length === 1 && whitelist[0] === '*')) {
        callback(null, true);
      } else {
        callback(new UnauthorizedError(`Origin "${origin}" is not allowed by CORS`));
      }
    }
  };

  const delegation = router();
  delegation.get('/', cors(corsOptions), authorize, checkScope('get:token'), (req, res, next) => {
    const token = req.headers.authorization.split(' ')[1];
    getAppUserToken(req.user, token)
      .then(boxToken => res.json(boxToken))
      .catch(next);
  });
  return delegation;
};
