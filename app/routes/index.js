'use strict';

const yelp = require('yelp-fusion');
const jwt = require('jsonwebtoken');
const expressJwt = require('express-jwt');
const express = require("express");
const router = express.Router();
const request = require('request');
const configAuth = require("../config/auth.js");
const Users = require("../models/Users.js");

module.exports = function(app, passport) {
  const createToken = function(auth) {
    return jwt.sign({
      id: auth.id
    },
    'my-secret',
    {
      expiresIn: 60 * 60 * 24
    });
  };

  const generateToken = function (req, res, next) {
    req.token = createToken(req.auth);
    return next();
  };

  const sendToken = function (req, res) {
    res.setHeader('x-auth-token', req.token);
    return res.status(200).send(JSON.stringify(req.user));
  };  

  const isContentNotEmpty = function(req, res, next) {
    if (req.body !== undefined) {
      return next();
    }
  };

  const getResults = function(req, res) {
    let searchRequest = {
      term: "restaurant",
      location: req.params.place,
      limit: 10
    };
    let output = [];

    let client = yelp.client(process.env.YELP_KEY);
    client.search(searchRequest)
    .then(response => {   
      let firstResult = response.jsonBody.businesses;
      output = firstResult.slice(0);
      res.json(output);
    }).catch(e => {
      console.log(e);
    });
  };

  const authenticate = expressJwt({
    secret: 'my-secret',
    requestProperty: 'auth',
    getToken: function(req) {
      if (req.headers['x-auth-token']) {
        return req.headers['x-auth-token'];
      } else {
        console.log("No token");
      }
      return null;
    }
  });

  const getCurrentUser = function(req, res, next) {
    Users.findOne({
      "_id" : req.auth.id
    }, function(err, user) {
      if (err) {
        next(err);
      } else {
        req.user = user;
        next();
      }
    });
  };

  router.route('/auth/twitter/reverse')
    .post(function(req, res) {
      request.post({
        url: 'https://api.twitter.com/oauth/request_token',
        oauth: {
          oauth_callback: "https://eg-fcc-resto.herokuapp.com/twitter-callback",
          consumer_key: configAuth.twitterAuth.consumerKey,
          consumer_secret: configAuth.twitterAuth.consumerSecret
        }
      }, function (err, r, body) {
        if (err) {
          return res.status(500).send({ message: err.message });
        }

        let jsonStr = '{ "' + body.replace(/&/g, '", "').replace(/=/g, '": "') + '"}';
        res.send(JSON.parse(jsonStr));
      });
    });

  router.route('/auth/twitter')
    .post((req, res, next) => {
      request.post({
        url: 'https://api.twitter.com/oauth/access_token?oauth_verifier',
        oauth: {
          consumer_key: configAuth.twitterAuth.consumerKey,
          consumer_secret: configAuth.twitterAuth.consumerSecret,
          token: req.query.oauth_token
        },
        form: { oauth_verifier: req.query.oauth_verifier }
      }, function (err, r, body) {
        if (err) {
          return res.status(500).send({ message: err.message });
        }
        let bodyString = '{ "' + body.replace(/&/g, '", "').replace(/=/g, '": "') + '"}';
        let parsedBody = JSON.parse(bodyString);
        req.body['oauth_token'] = parsedBody.oauth_token;
        req.body['oauth_token_secret'] = parsedBody.oauth_token_secret;
        req.body['user_id'] = parsedBody.user_id;

        next();
      });
    }, passport.authenticate('twitter-token', {session: false}), function(req, res, next) {
        if (!req.user) {
          res.status(401).send("User Not Authenticated");    
        }

        // prepare token for API
        req.auth = {
          id: req.user.id
        };
        
        return next();
      }, generateToken, sendToken);


  app.route('/search/:place').get(getResults);

  app.route('/addingUserReservation')
  .post(authenticate, getCurrentUser,
    isContentNotEmpty,
    function(req, res) {
    let obj = {
      businessId: req.body.businessId
    };

    Users.update(
      {"_id": req.auth.id},
      {$push : { "reservations": obj } },
      {upsert: true, new: true},
      function(err) {
        if (err) console.log(err);
      }
    );
  });

  app.route('/removingUserReservation')
  .post(authenticate, getCurrentUser,
    isContentNotEmpty, function(req, res) {
      console.log("Id: " + req.body.identification);
    Users.findOneAndUpdate(
      {"_id": req.auth.id},
      {$pull : { "reservations" : { businessId : req.body.identification } } },
      function(err) {
        if (err) console.log(err);
      }
    );
  });

  app.route("/userReservations")
  .get(authenticate, getCurrentUser, function(req, res) {
    Users.findOne({
      "_id": req.auth.id
    }, function(err, data) {
      if (err) {
        console.log(err);
      }

      if(data) {
        res.json(data);
      }
    });
  });

  app.route("/savingSearchedPlace")
  .post(authenticate, getCurrentUser,
    isContentNotEmpty, function(req, res) {

    Users.findOneAndUpdate(
      {"_id": req.auth.id},
      {$set : { "searchedPlace" : req.body.place} },
      function(err) {
        if (err) console.log(err);
      }
    );

  });

  app.use('/api/v1', router);

};
