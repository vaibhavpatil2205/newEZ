'use strict';

const userSchema = require('../schema/userSchema');
const mongoose = require('mongoose');
const responseFormatter = require('../utils/responseFormatter');
const commonFunctions = require('../utils/commonFunctions');
const codeSchema = require('../schema/codeSchema');
const logger = require('../utils/logger');
const conversationSchema = require('../schema/conversationSchema');
const tokenSchema = require('../schema/authToken');
const bcrypt = require('bcrypt');
const referralSchema = require('../schema/referralSchema');
const favouriteSchema = require('../schema/favouriteSchema');
const favouriteCandidateSchema = require('../schema/favouriteCandidateSchema');
const categorySchema = require('../schema/categorySchema');
const jobsSchema = require('../schema/jobSchema');
const moment = require('moment');
const momentTz = require('moment-timezone');
const searchSchema = require('../schema/searchSchema');
const searchSuggestionSchema = require('../schema/searchSuggestionSchema');
const weightSchema = require('../schema/weightageSchema');
const chatSuggestion = require('../schema/chatSuggestion');
const constantSchema = require('../schema/constantSchema');
const otpSchema = require('../schema/otpSchema');
const notificationSchema = require('../schema/notificationSchema');
const push = require('../utils/push');
const mandrill = require('../utils/mandrill');
const AWS = require('../config/awsCredentials');
const aes256 = require('aes256');
const key = require('../config/aesSecretKey').key;
const builder = require('xmlbuilder');
const googleAPIKey = require('../config/googleAPIKey');
const countryList = require('country-list');
const SALT_WORK_FACTOR = 12;
const pluralize = require('pluralize');
const rp = require('request-promise');
const minMaxSalarySchema = require('../schema/minMaxSalarySchema');
/*const googleTranslate = require('google-translate')(googleAPIKey.translationKey);*/
const languageSchema = require('../schema/languageSchema');
const packageSchema = require('../schema/packageSchema');
const subscriptionSchema = require('../schema/subscriptionSchema');
const ratingSchema = require('../schema/ratingSchema');
const groupSchema = require('../schema/groupSchema');
const pricingSchema = require('../schema/pricingSchema');
const blockUserSchema = require('../schema/blockSchema');
const reportUserSchema = require('../schema/reportUserSchema');
const reportJobSchema = require('../schema/reportJobSchema');
const chatRequestSchema = require('../schema/chatRequestSchema');
const verificationFieldSchema = require('../schema/verificationFields');
const pdf = require("pdf-creator-node");
const fs = require('fs');
const emailPreferenceUserSchema = require('../schema/emailPreferenceUser');
const emailPreferenceTypeSchema = require('../schema/emailPreferenceType');
const visitingCardSchema = require('../schema/visitingCardSchema');
const jobTitleSchema = require('../schema/jobTitleSchema');
const networkSchema = require('../schema/networkSchema');
const viewsSchema = require('../schema/viewsSchema');
const internalParameterSchema = require('../schema/internalParameterSchema');
const promoCodeSchema = require('../schema/promoCodeSchema');
const chatSchema = require('../schema/chatSchemaPA');
const resumeSchema = require("../schema/resumeSchema");
const rzrPay = require("../utils/paymentGatewayRzrpy");
const resumeOrderSchema = require("../schema/resumeOrderSchema");
const resumePricingSchema = require("../schema/resumePricingSchema");
const taskSchema = require("../schema/taskSchema");
const dynamicFieldsSchema = require("../schema/dynamicFieldsSchema");
const citySchema = require("../schema/citiesSchema");
const postSchema = require("../schema/postSchema");
const searchHistorySchema = require("../schema/searchHistorySchema");
const tagSchema = require("../schema/tagSchema");
const likeSchema = require("../schema/likeSchema");
const commentSchema = require("../schema/commentSchema");
const commentLikeSchema = require("../schema/commentLikeSchema");
const pollSchema = require("../schema/pollSchema");
const voteSchema = require("../schema/voteSchema");
const zoneSchema = require("../schema/zoneSchema");
const visitorSchema = require("../schema/visitorSchema");
const pageSchema = require("../schema/pageSchema");
const peopleSchema = require("../schema/peopleSchema");

let userHandler = {};
let baseUrl, emailVerificationUrl;

if (process.env.NODE_ENV === 'development') {
    baseUrl = 'https://dev.onata.com/OnataJobs';
    emailVerificationUrl = 'https://devapi.onata.com';
} else if (process.env.NODE_ENV === 'test') {
    baseUrl = 'https://test.ezjobs.io/OnataJobs/#';
    emailVerificationUrl = 'https://testapi.ezjobs.io';
} else if (process.env.NODE_ENV === 'production') {
    baseUrl = 'https://admin.ezjobs.io/#';
    emailVerificationUrl = 'https://api.ezjobs.io';
} else {
    baseUrl = 'http://localhost'
}

userHandler.validate = async (request, token, h) =>{
    let decoded;
    let isValid = false;
    const credentials = { token };
    const artifacts = { test: 'info' };
    let checkUser = async (userId, token) => {
        const check = await tokenSchema.authTokenSchema.findOne({userId: userId, authToken: token, isExpired: false}, {}, {lean: true});
        return !!check;
    };
    try {
        decoded = await commonFunctions.Handlers.decodeToken(token);
        if (decoded.role === 'Candidate' || decoded.role === 'PA') {
            try {
                isValid = await checkUser(decoded.userId, token);
            } catch (e) {
                logger.error('%s', JSON.stringify(e));
            }
        }
    } catch (e) {}
    return { isValid, credentials, artifacts };
};

userHandler.createUser = async (request, h) => {
    let searchCriteria = request.payload.email ? {email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')} : {
            phone: request.payload.phone,
            countryCode: request.payload.countryCode
        },
        isValidReferral, currency, constantData, userInfo, checkPackage, zone;

  try {
      userInfo = await userSchema.UserSchema.findOne(searchCriteria, {}, {lean: true});
  } catch (e) {
      logger.error('Error occurred in finding user in create user handler %s:', JSON.stringify(e));
      return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
  }
  if (userInfo) {
      return h.response(responseFormatter.responseFormatter({}, 'Account already exists', 'error', 409)).code(409);
  }

  /* Check whether referral code is valid or not*/
    if (request.payload.referralCode) {
        try {
            isValidReferral = await userSchema.UserSchema.findOne({referralCode: request.payload.referralCode}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding referral code in create user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!isValidReferral) {
            return h.response(responseFormatter.responseFormatter({}, 'Referral code is not valid', 'error', 400)).code(400);
        }
    }

    /* Check for free package */
    try {
        checkPackage = await packageSchema.packageSchema.findOne({isFree: true, country: request.payload.country, isActive: true}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding package in create user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Attach currency based on country at the time of login */
    try {
        currency = await codeSchema.CodeSchema.findOne({countryISOName: request.payload.country}, {currencyName: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding currency in create user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (currency) {
        request.payload.currency = currency.currencyName;
    }

    /* Fetch constant data */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding constant data in create user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

  /* Check if user exists. If not create new user in database */
      try {
          if (!userInfo) {
              const userData = new userSchema.UserSchema(request.payload);
              let data;
              if (request.payload.profilePhoto) {
                  userData.employeeInformation.profilePhoto = request.payload.profilePhoto;
                  userData.employerInformation.companyProfilePhoto = request.payload.profilePhoto;
              }
              if (request.payload.phone) {
                  userData.employeeInformation.phone = request.payload.phone;
                  userData.employeeInformation.countryCode = request.payload.countryCode;
                  userData.phoneVerified = true;
                  userData.employerInformation.companyPhone = request.payload.phone;
                  userData.employerInformation.countryCode = request.payload.countryCode;
                  userData.employerInformation.phoneVerified = true;
              }
              userData.employerInformation.country = request.payload.country;
              userData.employeeInformation.country = request.payload.country;
              userData.country = request.payload.country;
              userData.employeeInformation.location.coordinates = [Number(request.payload.locationLongitude), Number(request.payload.locationLatitude)];
              userData.employeeInformation.preferredLocations.coordinates = [[Number(request.payload.locationLongitude), Number(request.payload.locationLatitude)]];
              userData.employerInformation.companyLocation.coordinates = [Number(request.payload.locationLongitude), Number(request.payload.locationLatitude)];
              /* Update address data of the user company */
              try {
                  data = await commonFunctions.Handlers.reverseGeocode(userData.employerInformation.companyLocation.coordinates[1], userData.employerInformation.companyLocation.coordinates[0]);
              } catch (e) {
                  logger.error('Error occurred in reverse geocoding user address in create user handler %s:', JSON.stringify(e));
                  return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
              }

              if (data !== 'error') {
                  userData.employeeInformation.address.address1 = data.address1;
                  userData.employeeInformation.address.address2 = data.address2;
                  userData.employeeInformation.address.city = data.city;
                  userData.employeeInformation.address.state = data.state;
                  userData.employeeInformation.address.zipCode = data.zipCode;
                  userData.employeeInformation.address.subLocality = data.subLocality;

                  userData.employerInformation.companyAddress.address1 = data.address1;
                  userData.employerInformation.companyAddress.address2 = data.address2;
                  userData.employerInformation.companyAddress.city = data.city;
                  userData.employerInformation.companyAddress.state = data.state;
                  userData.employerInformation.companyAddress.zipCode = data.zipCode;
                  userData.employerInformation.companyAddress.subLocality = data.subLocality;

                  userData.employeeInformation.preferredLocationCities = [
                      {
                          city: data.city,
                          state: data.state,
                          country: request.payload.country,
                          latitude: Number(request.payload.locationLatitude),
                          longitude: Number(request.payload.locationLongitude)
                      }
                  ];
              }

              let language;
              try {
                  language = await languageSchema.languageSchema.findOne({country: request.payload.country, language: 'en'}, {_id: 1, name: 1}, {lean: true});
              } catch (e) {
                  logger.error('Error occurred in finding language data in create user handler %s:', JSON.stringify(e));
                  return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
              }
              if (language) {
                  userData.appLanguage = language._id;
                  userData.chatLanguage = language._id;
              }

              userData.roles = ['Candidate'];

              /* Get the visiting card details */
              let card;
              if (!userData.employeeInformation.card) {
                  try {
                      card = await visitingCardSchema.visitingCardSchema.findOne({}, {}, {lean: true});
                  } catch (e) {
                      logger.error('Error occurred getting visiting card in create user handler %s:', JSON.stringify(e));
                      return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                  }
                  if (card) {
                      userData.employeeInformation.card = card._id;
                  }

                  /* Generate deep link if it is not there */
                  if (!userData.employeeInformation.profileLink) {
                      let deepLink = await commonFunctions.Handlers.createFirebaseShortLink('', '', userData._id, '', '', '', '', '', '');
                      if (deepLink === 'error') {
                          console.log('Error occurred in creating deep link');
                      } else {
                          userData.employeeInformation.profileLink = deepLink.shortLink;
                      }
                  }
              }

              /* Get the zone information */
              try {
                  zone = await zoneSchema.zoneSchema.findOne({states: {$in: [userData.employeeInformation.address.state]}}, {
                      _id: 1,
                      abbreviation: 1
                  }, {lean: true});
              } catch (e) {
                  logger.error('Error occurred getting zone data in create user handler %s:', JSON.stringify(e));
              }
              if (zone) {
                  userData.zone = zone.abbreviation;
              }

              try {
                  const tempData = await userData.save();
                  const dataToSave = tempData.toObject();
                  if (card) {
                      dataToSave.employeeInformation.card = card;
                  }
                  const token = commonFunctions.Handlers.createAuthToken(dataToSave._id, 'Candidate');
                  const tokenWithExpiry = commonFunctions.Handlers.createAuthTokenWithExpiry(dataToSave._id, 'Candidate');
                  const tokenToSave = {
                      userId: dataToSave._id,
                      authToken: token,
                      isExpired: false
                  };

                  if (checkPackage) {
                      /* Create free subscription & Check whether plan exists */
                      let checkPlan, subscriptionData;
                      try {
                          checkPlan = await packageSchema.packageSchema.findOne({isFree: 1, country: request.payload.country, isActive: true}, {}, {lean: true});
                      } catch (e) {
                          logger.error('Error occurred finding packageF information in create subscription handler %s:', JSON.stringify(e));
                          return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                      }
                      if (checkPlan) {
                          /* Save subscription in database */
                          delete checkPlan._id;
                          let subscriptionToSave = new subscriptionSchema.subscriptionSchema(checkPlan);
                          delete subscriptionToSave.createdAt;
                          delete subscriptionToSave.updatedAt;
                          subscriptionToSave.isActive = false;
                          subscriptionToSave.userId = dataToSave._id;
                          subscriptionToSave.planType = 'monthly';
                          subscriptionToSave.packageId = checkPackage._id;
                          subscriptionToSave.numberOfJobs.count = checkPlan.numberOfJobs.monthlyCount;
                          subscriptionToSave.numberOfUsers.count = checkPlan.numberOfUsers.monthlyCount;
                          subscriptionToSave.numberOfViews.count = checkPlan.numberOfViews.monthlyCount;
                          subscriptionToSave.numberOfTextTranslations.count = checkPlan.numberOfTextTranslations.monthlyCount;
                          subscriptionToSave.numberOfJobTranslations.count = checkPlan.numberOfJobTranslations.monthlyCount;
                          subscriptionToSave.jobsInAllLocalities.count = checkPlan.jobsInAllLocalities.count;
                          subscriptionToSave.isEnded = false;
                          subscriptionToSave.isActive = true;
                          subscriptionToSave.isPaid = true;
                          subscriptionToSave.isFree = true;

                          try {
                              subscriptionData = await subscriptionToSave.save();
                          } catch (e) {
                              logger.error('Error occurred saving subscription information in create user handler %s:', JSON.stringify(e));
                              return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                          }
                          const dataToUpdate = {
                              subscriptionInfo: {
                                  packageId: checkPackage._id,
                                  subscriptionId: subscriptionData._id
                              }
                          };

                          /* Update user with data */
                          try {
                              await userSchema.UserSchema.findByIdAndUpdate({_id: dataToSave._id}, {$set: dataToUpdate}, {lean: true});
                          } catch (e) {
                              logger.error('Error occurred updating user information in create user handler %s:', JSON.stringify(e));
                              return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                          }
                      }
                  }

                  /* If referral code save it into the collection and update the referee count */
                  if (isValidReferral) {
                      try {
                          const referralData = {
                              referredBy: mongoose.Types.ObjectId(isValidReferral._id),
                              referredTo: mongoose.Types.ObjectId(dataToSave._id)
                          };
                          await new referralSchema.referralSchema(referralData).save();
                      } catch (e) {
                          logger.error('Error occurred in saving referral data in create user handler %s:', JSON.stringify(e));
                          return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                      }
                      try {
                          await userSchema.UserSchema.findByIdAndUpdate({_id: mongoose.Types.ObjectId(isValidReferral._id)}, {$inc: {referralCount: 1}}, {lean: true});
                      } catch (e) {
                          logger.error('Error occurred in updating referee referral count in create user handler %s:', JSON.stringify(e));
                          return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                      }
                  }

                  /* Save authorization token in token collection */
                  try {
                      await tokenSchema.authTokenSchema.findOneAndUpdate({userId: dataToSave._id}, tokenToSave, {lean: true, upsert: true});
                  } catch (e) {
                      logger.error('Error occurred in saving token in create user handler %s:', JSON.stringify(e));
                      return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                  }

                  /* Send verification email to user */
                  const verificationUrl = emailVerificationUrl + '/user/verify?token=' + tokenWithExpiry;
                  if (request.payload.email) {
                      try {
                          let email = {
                              to: [{
                                  email: request.payload.email,
                                  name: (request.payload.firstName + ' ' + request.payload.lastName).trim(),
                                  type: 'to'
                              }],
                              important: false,
                              merge: true,
                              inline_css: false,
                              merge_language: 'mailchimp',
                              merge_vars: [{
                                  rcpt: request.payload.email,
                                  vars: [{
                                      name: 'VERIFYEMAIL',
                                      content: verificationUrl
                                  }, {
                                      name: 'VERIFYEMAILURL',
                                      content: verificationUrl
                                  }]
                              }]
                          };
                          mandrill.Handlers.sendTemplate('ezjobs-email-verification', [], email, true)
                      } catch (e) {
                          logger.error('Error in sending verification link to user %s:', JSON.stringify(e));
                      }

                      /* Send welcome email */
                      try {
                          let email = {
                              to: [{
                                  email: request.payload.email,
                                  name: (request.payload.firstName + ' ' + request.payload.lastName).trim(),
                                  type: 'to'
                              }],
                              important: false,
                              merge: true,
                              merge_language: 'mailchimp',
                              merge_vars: [{
                                  rcpt: request.payload.email,
                                  vars: [{
                                      name: 'FNAME',
                                      content: request.payload.firstName
                                  }]
                              }]
                          };
                          mandrill.Handlers.sendTemplate('ezjobs-welcome', [], email, true)
                      } catch (e) {
                          logger.error('Error in sending verification link to user %s:', JSON.stringify(e));
                      }
                  }

                  dataToSave.unreadCount = 0;
                  dataToSave.totalChatUnreadCount = 0;

                  /* Remove device token of all other devices having same device token */
                  let bulk = userSchema.UserSchema.collection.initializeUnorderedBulkOp();
                  bulk
                      .find({_id: {$ne: userData._id}, deviceToken: userData.deviceToken})
                      .update({$set: {deviceToken: ''}});
                  try {
                      await bulk.execute();
                  } catch (e) {
                      logger.error('Error occurred while removing other device tokens in create user handler %s:', JSON.stringify(e));
                      return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                  }

                  /* Create contact into hub spot */
                  let contactSource;
                  if (process.env.NODE_ENV === 'production') {
                      if (userData.deviceType.toLowerCase() === 'android') {
                          contactSource = 'Android App';
                      } else if (userData.deviceType.toLowerCase() === 'ios') {
                          contactSource = 'IOS App';
                      }
                      let status = commonFunctions.Handlers.createHubSpotContact(userData.firstName, userData.lastName, userData.email, countryList.getName(userData.employeeInformation.country), contactSource, 'Email', 'customer', userData.employeeInformation.address.city, userData.employeeInformation.address.state);
                      if (status === 'error') {
                          logger.error('Error occurred while creating hub spot contact');
                      }
                  }

                  let emailPreferenceUser;
                  /* Check for email preference */
                  try {
                      emailPreferenceUser = await emailPreferenceUserSchema.emailPreferenceUserSchema.findOne({userId: dataToSave._id}, {}, {lean: true});
                  } catch (e) {
                      logger.error('Error occurred while finding user email preferences in create user handler %s:', JSON.stringify(e));
                      return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                  }
                  if (!emailPreferenceUser) {
                      let preferences = [], documentsToInsert = [];
                      /* Save all email preferences */
                      try {
                          preferences = await emailPreferenceTypeSchema.emailPreferenceTypeSchema.find({}, {}, {lean: true});
                      } catch (e) {
                          logger.error('Error occurred while finding email preferences in create user handler %s:', JSON.stringify(e));
                          return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                      }

                      for (let i = 0; i < preferences.length; i++) {
                          const prefToSave = {
                              userId: dataToSave._id,
                              categoryId: preferences[i]._id,
                              id: i + 1,
                              isSelected: true
                          };
                          documentsToInsert.push({insertOne: {'document': new emailPreferenceUserSchema.emailPreferenceUserSchema(prefToSave)}});
                      }
                      try {
                          await emailPreferenceUserSchema.emailPreferenceUserSchema.collection.bulkWrite(documentsToInsert);
                      } catch (e) {
                          logger.error('Error occurred while saving email preference data in create user handler %s:', JSON.stringify(e));
                          return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                      }
                  }

                  dataToSave.isSignup = true;

                  /* Success */
                  return h.response(responseFormatter.responseFormatter({
                      authToken: token,
                      userInfo: dataToSave,
                      constantInfo: constantData
                  }, 'User profile created successfully', 'success', 201)).code(201);
              } catch (e) {
                  logger.error('%s', JSON.stringify(e));
                  return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
              }
          }
      } catch (e) {
          logger.error('%s', JSON.stringify(e));
          return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
      }
};

userHandler.createUserWeb = async (request, h) => {
    let searchCriteria = request.payload.email ? {email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')} : {
            phone: request.payload.phone,
            countryCode: request.payload.countryCode
        },
        isValidReferral, currency, constantData, userInfo, imageName, checkPackage;

    try {
        userInfo = await userSchema.UserSchema.findOne(searchCriteria, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding user in create user web handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (userInfo) {
        return h.response(responseFormatter.responseFormatter({}, 'Account already exists', 'error', 409)).code(409);
    }

    /* Check whether referral code is valid or not*/
    if (request.payload.referralCode) {
        try {
            isValidReferral = await userSchema.UserSchema.findOne({referralCode: request.payload.referralCode}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding referral code in create user web handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!isValidReferral) {
            return h.response(responseFormatter.responseFormatter({}, 'Referral code is not valid', 'error', 400)).code(400);
        }
    }

    /* Check for free package */
    try {
        checkPackage = await packageSchema.packageSchema.findOne({isFree: true, country: request.payload.country, isActive: true}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding package in create user web handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (checkPackage) {
        request.payload.subscriptionInfo = {packageId: checkPackage._id};
    }

    /* Attach currency based on country at the time of login */
    try {
        currency = await codeSchema.CodeSchema.findOne({countryISOName: request.payload.country}, {currencyName: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding currency in create user web handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (currency) {
        request.payload.currency = currency.currencyName;
    }

    /* Fetch constant data */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding constant data in create user web handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check if user exists. If not create new user in database */
    try {
        if (!userInfo) {
            const userData = new userSchema.UserSchema(request.payload);
            let data;
            /* Check if user is uploading profile photo */
            if (request.payload.profilePhoto) {
                /* Upload image to s3 bucket */
                try {
                    imageName = await commonFunctions.Handlers.uploadImage(request.payload.profilePhoto.path, request.payload.profilePhoto.filename);
                } catch (e) {
                    logger.error('Error occurred while uploading user image in create user web handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                if (imageName) {
                    userData.employeeInformation.profilePhoto = imageName;
                    userData.employerInformation.companyProfilePhoto = imageName;
                }
            }

            if (request.payload.phone) {
                userData.employeeInformation.phone = request.payload.phone;
                userData.employeeInformation.countryCode = request.payload.countryCode;
                userData.phoneVerified = true;
                userData.employerInformation.companyPhone = request.payload.phone;
                userData.employerInformation.countryCode = request.payload.countryCode;
                userData.employerInformation.phoneVerified = true;
            }

            userData.employerInformation.country = request.payload.country;
            userData.employeeInformation.country = request.payload.country;
            userData.employeeInformation.location.coordinates = [Number(request.payload.locationLongitude), Number(request.payload.locationLatitude)];
            userData.employeeInformation.preferredLocations.coordinates = [[Number(request.payload.locationLongitude), Number(request.payload.locationLatitude)]];
            userData.employerInformation.companyLocation.coordinates = [Number(request.payload.locationLongitude), Number(request.payload.locationLatitude)];
            /* Update address data of the user company */
            try {
                data = await commonFunctions.Handlers.reverseGeocode(userData.employerInformation.companyLocation.coordinates[1], userData.employerInformation.companyLocation.coordinates[0]);
            } catch (e) {
                logger.error('Error occurred in reverse geocoding user address in create user web handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if (data !== 'error') {
                userData.employeeInformation.address.address1 = data.address1;
                userData.employeeInformation.address.address2 = data.address2;
                userData.employeeInformation.address.city = data.city;
                userData.employeeInformation.address.state = data.state;
                userData.employeeInformation.address.zipCode = data.zipCode;
                userData.employeeInformation.address.subLocality = data.subLocality;

                userData.employerInformation.companyAddress.address1 = data.address1;
                userData.employerInformation.companyAddress.address2 = data.address2;
                userData.employerInformation.companyAddress.city = data.city;
                userData.employerInformation.companyAddress.state = data.state;
                userData.employerInformation.companyAddress.zipCode = data.zipCode;
                userData.employerInformation.companyAddress.subLocality = data.subLocality;

                userData.employeeInformation.preferredLocationCities = [
                    {
                        city: data.city,
                        state: data.state,
                        country: request.payload.country,
                        latitude: Number(request.payload.locationLatitude),
                        longitude: Number(request.payload.locationLongitude)
                    }
                ];
            }

            const referrer = request.info.referrer;
            if (referrer.includes('employer')) {
                userData.roles = ['Employer'];
            } else if (referrer.includes('candidate')) {
                userData.roles = ['Candidate'];
            }

            /* Get the visiting card details */
            let card;
            if (!userData.employeeInformation.card) {
                try {
                    card = await visitingCardSchema.visitingCardSchema.findOne({}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred getting visiting card in create user handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (card) {
                    userData.employeeInformation.card = card._id;
                }

                /* Generate deep link if it is not there */
                if (!userData.employeeInformation.profileLink) {
                    let deepLink = await commonFunctions.Handlers.createFirebaseShortLink('', '', userData._id, '', '', '', '', '', '');
                    if (deepLink === 'error') {
                        console.log('Error occurred in creating deep link');
                    } else {
                        userData.employeeInformation.profileLink = deepLink.shortLink;
                    }
                }
            }

            let language;
            try {
                language = await languageSchema.languageSchema.findOne({country: request.payload.country, language: 'en'}, {_id: 1, name: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in finding language data in create user web handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (language) {
                userData.appLanguage = language._id;
                userData.chatLanguage = language._id;
            }

            try {
                const dataToSave = await userData.save();
                const token = commonFunctions.Handlers.createAuthToken(dataToSave._id, 'Candidate');
                const tokenWithExpiry = commonFunctions.Handlers.createAuthTokenWithExpiry(dataToSave._id, 'Candidate');
                const tokenToSave = {
                    userId: dataToSave._id,
                    authToken: token,
                    isExpired: false
                };

                if (checkPackage) {
                    /* Create free subscription & Check whether plan exists */
                    let checkPlan, planId, subscriptionData;
                    try {
                        checkPlan = await packageSchema.packageSchema.findOne({isFree: 1, country: request.payload.country, isActive: true}, {}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred finding packageF information in create subscription handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                    if (checkPlan) {
                        /* Save subscription in database */
                        delete checkPlan._id;
                        let subscriptionToSave = new subscriptionSchema.subscriptionSchema(checkPlan);
                        delete subscriptionToSave.createdAt;
                        delete subscriptionToSave.updatedAt;
                        subscriptionToSave.isActive = false;
                        subscriptionToSave.userId = dataToSave._id;
                        subscriptionToSave.planType = 'monthly';
                        subscriptionToSave.packageId = checkPackage._id;
                        subscriptionToSave.numberOfJobs.count = checkPlan.numberOfJobs.monthlyCount;
                        subscriptionToSave.numberOfUsers.count = checkPlan.numberOfUsers.monthlyCount;
                        subscriptionToSave.numberOfViews.count = checkPlan.numberOfViews.monthlyCount;
                        subscriptionToSave.numberOfTextTranslations.count = checkPlan.numberOfTextTranslations.monthlyCount;
                        subscriptionToSave.numberOfJobTranslations.count = checkPlan.numberOfJobTranslations.monthlyCount;
                        subscriptionToSave.jobsInAllLocalities.count = checkPlan.jobsInAllLocalities.count;
                        subscriptionToSave.isEnded = false;
                        subscriptionToSave.isActive = true;
                        subscriptionToSave.isPaid = true;
                        subscriptionToSave.isFree = true;

                        try {
                            subscriptionData = await subscriptionToSave.save();
                        } catch (e) {
                            logger.error('Error occurred saving subscription information in create user handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }
                        const dataToUpdate = {
                            subscriptionInfo: {
                                packageId: checkPackage._id,
                                subscriptionId: subscriptionData._id
                            }
                        };

                        /* Update user with data */
                        try {
                            await userSchema.UserSchema.findByIdAndUpdate({_id: dataToSave._id}, {$set: dataToUpdate}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred updating user information in create user handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }
                    }
                }

                /* If referral code save it into the collection and update the referee count */
                if (isValidReferral) {
                    try {
                        const referralData = {
                            referredBy: mongoose.Types.ObjectId(isValidReferral._id),
                            referredTo: mongoose.Types.ObjectId(dataToSave._id)
                        };
                        await new referralSchema.referralSchema(referralData).save();
                    } catch (e) {
                        logger.error('Error occurred in saving referral data in create user web handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                    try {
                        await userSchema.UserSchema.findByIdAndUpdate({_id: mongoose.Types.ObjectId(isValidReferral._id)}, {$inc: {referralCount: 1}}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred in updating referee referral count in create user web handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }

                /* Save authorization token in token collection */
                try {
                    await tokenSchema.authTokenSchema.findOneAndUpdate({userId: dataToSave._id}, tokenToSave, {lean: true, upsert: true});
                } catch (e) {
                    logger.error('Error occurred in saving token in create user web handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                /* Send verification email to user */
                const verificationUrl = emailVerificationUrl + '/user/verify?token=' + tokenWithExpiry;
                if (request.payload.email) {
                    try {
                        let email = {
                            to: [{
                                email: request.payload.email,
                                name: (request.payload.firstName + ' ' + request.payload.lastName).trim(),
                                type: 'to'
                            }],
                            important: false,
                            merge: true,
                            inline_css: false,
                            merge_language: 'mailchimp',
                            merge_vars: [{
                                rcpt: request.payload.email,
                                vars: [{
                                    name: 'VERIFYEMAIL',
                                    content: verificationUrl
                                }, {
                                    name: 'VERIFYEMAILURL',
                                    content: verificationUrl
                                }]
                            }]
                        };
                        await mandrill.Handlers.sendTemplate('ezjobs-email-verification', [], email, true)
                    } catch (e) {
                        logger.error('Error in sending verification link to user %s:', JSON.stringify(e));
                    }

                    /* Send welcome email */
                    try {
                        let email = {
                            to: [{
                                email: request.payload.email,
                                name: (request.payload.firstName + ' ' + request.payload.lastName).trim(),
                                type: 'to'
                            }],
                            important: false,
                            merge: true,
                            merge_language: 'mailchimp',
                            merge_vars: [{
                                rcpt: request.payload.email,
                                vars: [{
                                    name: 'FNAME',
                                    content: request.payload.firstName
                                }]
                            }]
                        };
                        await mandrill.Handlers.sendTemplate('ezjobs-welcome', [], email, true)
                    } catch (e) {
                        logger.error('Error in sending verification link to user %s:', JSON.stringify(e));
                    }
                }

                dataToSave.unreadCount = 0;
                dataToSave.totalChatUnreadCount = 0;

                /* Remove device token of all other devices having same device token */
                let bulk = userSchema.UserSchema.collection.initializeUnorderedBulkOp();
                bulk
                    .find({_id: {$ne: userData._id}, deviceToken: userData.deviceToken})
                    .update({$set: {deviceToken: ''}});
                try {
                    await bulk.execute();
                } catch (e) {
                    logger.error('Error occurred while removing other device tokens in create user web handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                /* Create contact into hub spot */
                let contactSource;
                if (process.env.NODE_ENV === 'production') {
                    if (userData.deviceType.toLowerCase() === 'android') {
                        contactSource = 'Android App';
                    } else if (userData.deviceType.toLowerCase() === 'ios') {
                        contactSource = 'IOS App';
                    } else {
                        contactSource = 'Web App';
                    }
                    let status = await commonFunctions.Handlers.createHubSpotContact(userData.firstName, userData.lastName, userData.email, countryList.getName(userData.employeeInformation.country), contactSource, 'Email', 'customer', userData.employeeInformation.address.city, userData.employeeInformation.address.state);
                    if (status === 'error') {
                        logger.error('Error occurred while creating hub spot contact');
                    }
                }

                dataToSave.language = 'en';

                let emailPreferenceUser;
                /* Check for email preference */
                try {
                    emailPreferenceUser = await emailPreferenceUserSchema.emailPreferenceUserSchema.findOne({userId: dataToSave._id}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding user email preferences in create user web handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (!emailPreferenceUser) {
                    let preferences = [], documentsToInsert = [];
                    /* Save all email preferences */
                    try {
                        preferences = await emailPreferenceTypeSchema.emailPreferenceTypeSchema.find({}, {}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while finding email preferences in create user web handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }

                    for (let i = 0; i < preferences.length; i++) {
                        const prefToSave = {
                            userId: dataToSave._id,
                            categoryId: preferences[i]._id,
                            id: i + 1,
                            isSelected: true
                        };
                        documentsToInsert.push({insertOne: {'document': new emailPreferenceUserSchema.emailPreferenceUserSchema(prefToSave)}});
                    }
                    try {
                        await emailPreferenceUserSchema.emailPreferenceUserSchema.collection.bulkWrite(documentsToInsert);
                    } catch (e) {
                        logger.error('Error occurred while saving email preference data in create user web handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }

                /* Success */
                return h.response(responseFormatter.responseFormatter({authToken: token, userInfo: dataToSave, constantInfo: constantData}, 'User profile created successfully', 'success', 201)).code(201);
            } catch (e) {
                logger.error('%s', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    } catch (e) {
        logger.error('%s', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
};

userHandler.logOutUser = async (request, h) => {
    let checkUser, decoded;

    /* Check if user is actually who is trying to login */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in logout handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user exists or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.userId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in logout handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Logout user and remove his device token */
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$set: {deviceToken: '', isOnline: false}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating user in logout handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Remove token from token collection of that user */
    try {
        await tokenSchema.authTokenSchema.findOneAndDelete({userId: request.payload.userId});
    } catch (e) {
        logger.error('Error occurred while removing token in logout handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'User logged out successfully', 'success', 200)).code(200);
};

userHandler.verifyEmail = async (request, h) => {
    let decoded;

    /* Decode token */
    try {
        decoded = commonFunctions.Handlers.decodeToken(request.query.token);
    } catch (e) {
        logger.error('Error occurred in decoding token %s:', JSON.stringify(e));
        if (e.message === 'jwt expired') {
            return h.file('../public/expired.html');
        }
        return h.file('../public/error.html');
    }

    /* Check if user exists and if exists check whether email is already verified or not */
    if (decoded && decoded.userId) {
        const userData = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(decoded.userId)}, {emailVerified: 1}, {lean: true});
        if (userData) {
            const verificationFlag = !!userData.emailVerified;
            if (!verificationFlag) {
                /*Not verified*/
                await userSchema.UserSchema.findByIdAndUpdate({_id: mongoose.Types.ObjectId(decoded.userId)}, {$set: {emailVerified: true}}, {lean: true});
                return h.file('../public/verified.html');
            } else {
                /*Already verified*/
                return h.file('../public/alreadyVerified.html');
            }
        }
    } else if (decoded && decoded.employerId) {
        let addedUsers = [];
        const employerData = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(decoded.employerId)}, {
            'employerInformation.companyEmailVerified': 1,
            isMaster: 1,
            slaveUsers: 1
        }, {lean: true});
        if (employerData) {
            employerData.slaveUsers.push(employerData._id);
            addedUsers = employerData.slaveUsers;
            const verificationFlag = !!employerData.employerInformation.companyEmailVerified;
            if (!verificationFlag) {
                /* Not verified */
                await userSchema.UserSchema.updateMany({_id: {$in: addedUsers}}, {
                    $set: {
                        'employerInformation.companyEmailVerified': true,
                        'employerInformation.companyEmail': decoded.email
                    }
                }, {lean: true});
                return h.file('../public/verified.html');
            } else {
                /*Already verified*/
                return h.file('../public/alreadyVerified.html');
            }
        }
    }

    /* Something went wrong */
    return h.file('../public/error.html');
};

userHandler.resendLink = async (request, h) => {

  /* Check if user exists */
  try {
      let userData = await userSchema.UserSchema.findOne({_id: mongoose.Types.ObjectId(request.payload._id)}, {email: 1, firstName: 1, lastName: 1}, {lean: true});
      if (!userData) {
          return h.response(responseFormatter.responseFormatter({}, 'User does not exist', 'error', 404)).code(404);
      }

      /* Create token and again send the verification email to user */
      const token = await commonFunctions.Handlers.createAuthTokenWithExpiry(userData._id, 'USER');
      const verificationUrl = emailVerificationUrl + '/user/verify?token=' + token;
      /* Send verification email to user */
      try {
          let email = {
              to: [{
                  email: userData.email,
                  name: (userData.firstName + ' ' + userData.lastName).trim(),
                  type: 'to'
              }],
              important: false,
              merge: true,
              inline_css: false,
              merge_language: 'mailchimp',
              merge_vars: [{
                  rcpt: userData.email,
                  vars: [{
                      name: 'VERIFYEMAIL',
                      content: verificationUrl
                  }, {
                      name: 'VERIFYEMAILURL',
                      content: verificationUrl
                  }]
              }]
          };
          await mandrill.Handlers.sendTemplate('ezjobs-email-verification', [], email, true)
      } catch (e) {
          logger.error('Error in sending verification link to user %s:', JSON.stringify(e));
      }

      /* Success */
      return h.response(responseFormatter.responseFormatter({}, 'Verification link sent successfully', 'success', 200)).code(200);
  } catch (e) {
      return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
  }
};

userHandler.authUser = async (request, h) => {
    let payload = request.payload, match = false, checkUser, token, dataToUpdate = {}, updatedUser, isValidReferral,
        dataToSave, currency, constantData,
        unreadCount = 0, candidateChatCount = 0, employerChatCount = 0, checkPackage, languageCode, leadFlag = false,
        source, contactSource, emailPreferenceUser, card, signupFlag = false, referrer, status, zone;
    /* Checking if user is logging in using email / Facebook / Google */
    try {
        checkUser = await userSchema.UserSchema.findOne({email: new RegExp('^' + payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while checking user in authuser handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (checkUser) {
        if (!checkUser.isActive && checkUser.isSlave) {
            return h.response(responseFormatter.responseFormatter({}, 'Your parent account has been blocked your account. Please contact parent account administrator for more information', 'error', 400)).code(400);
        } else if (!checkUser.isActive && !checkUser.isSlave) {
            return h.response(responseFormatter.responseFormatter({}, 'Your account has been blocked by EZJobs. Please contact support@ezjobs.io for more information', 'error', 400)).code(400);
        } else if (checkUser.isPaAdmin) {
            return h.response(responseFormatter.responseFormatter({}, 'You can not use this credentials to log in into EZJobs app.', 'error', 400)).code(400);
        }
        /* Check Role */
        const referrer = request.info.referrer;
        if (checkUser.roles[0].toLowerCase() === 'candidate' && referrer.includes('employer')) {
            return h.response(responseFormatter.responseFormatter({}, 'We do not have your account with the given credentials for Employer role.', 'error', 404)).code(404);
        } else if (checkUser.roles[0].toLowerCase() === 'employer' && referrer.includes('candidate')) {
            return h.response(responseFormatter.responseFormatter({}, 'We do not have your account with the given credentials for Candidate role.', 'error', 404)).code(404);
        }
        dataToUpdate = checkUser;

        /* Get the language code of user */
        if (checkUser.appLanguage) {
            let lang;
            try {
                lang = await languageSchema.languageSchema.findById({_id: checkUser.appLanguage}, {language: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding language in authuser handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (lang) {
                languageCode = lang.language;
            }
        } else {
            languageCode = 'en';
        }
    }

    /*if (checkUser) {
        const idx = checkUser.roles.findIndex(k => k.toLowerCase() === 'pa');
        if (idx !== -1) {
            return h.response(responseFormatter.responseFormatter({}, 'You can not use the credentials of EZJobs PA to login with the EZJobs', 'error', 400)).code(400);
        }
    }*/

    /* Check whether referral code is valid or not*/
    if (request.payload.referralCode && !checkUser) {
        try {
            isValidReferral = await userSchema.UserSchema.findOne({referralCode: request.payload.referralCode}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding referral code in auth user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!isValidReferral) {
            return h.response(responseFormatter.responseFormatter({}, 'Referral code is not valid', 'error', 400)).code(400);
        }
    }

    /* If signing with facebook check whether first name is coming or not */
    if (payload.facebookId && !payload.facebookId.id && payload.facebookId.token) {
        return h.response(responseFormatter.responseFormatter({}, 'We are having trouble connecting to Facebook. Please try again.', 'error', 400)).code(400);
    }

    if (payload.facebookId && payload.facebookId.id) {
        if (checkUser) {
            if (checkUser.facebookId.id !== payload.facebookId.id) {
                if (!checkUser.facebookId.id) {
                    dataToUpdate.facebookId = {
                        id: payload.facebookId.id,
                        token: payload.facebookId.token
                    };
                }
            }
        }
    } else if (payload.googleId && payload.googleId.id) {
        if (checkUser) {
            if (checkUser.googleId.id !== payload.googleId.id) {
                if (!checkUser.googleId.id) {
                    dataToUpdate.googleId = {
                        id: payload.googleId.id,
                        token: payload.googleId.token
                    };
                }
            } else {
                /* Commented for now */
                /*let userId;
                try {
                    userId = await commonFunctions.Handlers.verifyGoogleToken(payload.googleId.token, payload.deviceType);
                    if (userId === 'error' || (checkUser.googleId.id !== userId)) {
                        return h.response(responseFormatter.responseFormatter({}, 'Your google session is expired. Please login again.', 'error', 401)).code(401);
                    }
                } catch (e) {
                    return h.response(responseFormatter.responseFormatter({}, 'Your google session is expired. Please login again.', 'error', 401)).code(401);
                }*/
            }
        }
    } else if (payload.linkedInId && payload.linkedInId.id) {
        if (checkUser) {
            if (checkUser.linkedInId.id !== payload.linkedInId.id) {
                if (!checkUser.linkedInId.id) {
                    dataToUpdate.linkedInId = {
                        id: payload.linkedInId.id,
                        token: payload.linkedInId.token
                    };
                }
            }
        }
    } else if (payload.appleId && payload.appleId.id) {
        if (checkUser) {
            if (checkUser.appleId.id !== payload.appleId.id) {
                if (!checkUser.appleId.id) {
                    dataToUpdate.appleId = {
                        id: payload.appleId.id,
                        token: payload.appleId.token
                    };
                }
            }
        }
    } else if (!payload.password) {
        payload.password = '#@k32g8DRC%5ykCN';
    }

    /* Attach currency based on country at the time of login */
    try {
        currency = await codeSchema.CodeSchema.findOne({countryISOName: request.payload.country}, {currencyName: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding currency in auth user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (currency && !checkUser) {
        request.payload.currency = currency.currencyName;
    }
    if (currency && checkUser) {
        dataToUpdate.country = request.payload.country;
    }

    if (request.payload.firstName) {
        dataToUpdate.firstName = request.payload.firstName;
    }
    if (request.payload.lastName) {
        dataToUpdate.lastName = request.payload.lastName;
    }

    if (checkUser) {
        dataToUpdate.hasOwned = true;
    }

    /* Fetch constant data */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding constant data in auth user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check if user exists */
    if (!checkUser && (payload.facebookId || payload.googleId || payload.linkedInId || payload.appleId)) {
        let data;
        /* Check for free package */
        try {
            checkPackage = await packageSchema.packageSchema.findOne({isFree: true, country: request.payload.country, isActive: true}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding package in auth user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (checkPackage) {
            request.payload.subscriptionInfo = {packageId: checkPackage._id};
        }
        try {
            signupFlag = true;
            request.payload.emailVerified = true;
            request.payload.roles = ['Candidate'];
            dataToSave = new userSchema.UserSchema(request.payload);
            dataToSave.employerInformation.country = request.payload.country;
            dataToSave.employeeInformation.country = request.payload.country;
            dataToSave.employeeInformation.location = {
                type: 'Point',
                coordinates: [Number(payload.locationLongitude), Number(payload.locationLatitude)]
            };
            dataToSave.employerInformation.companyLocation = {
                type: 'Point',
                coordinates: [Number(payload.locationLongitude), Number(payload.locationLatitude)]
            };
            dataToSave.employeeInformation.preferredLocations = {
                type: 'MultiPoint',
                coordinates: [[Number(payload.locationLongitude), Number(payload.locationLatitude)]]
            };

            /* Update address data of the user company */
            try {
                data = await commonFunctions.Handlers.reverseGeocode(dataToSave.employerInformation.companyLocation.coordinates[1], dataToSave.employerInformation.companyLocation.coordinates[0]);
            } catch (e) {
                logger.error('Error occurred in reverse geocoding user address in auth user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if (data !== 'error') {
                dataToSave.employeeInformation.address.address1 = data.address1;
                dataToSave.employeeInformation.address.address2 = data.address2;
                dataToSave.employeeInformation.address.city = data.city;
                dataToSave.employeeInformation.address.state = data.state;
                dataToSave.employeeInformation.address.zipCode = data.zipCode;
                dataToSave.employeeInformation.address.subLocality = data.subLocality;

                dataToSave.employerInformation.companyAddress.address1 = data.address1;
                dataToSave.employerInformation.companyAddress.address2 = data.address2;
                dataToSave.employerInformation.companyAddress.city = data.city;
                dataToSave.employerInformation.companyAddress.state = data.state;
                dataToSave.employerInformation.companyAddress.zipCode = data.zipCode;
                dataToSave.employerInformation.companyAddress.subLocality = data.subLocality;

                dataToSave.employeeInformation.preferredLocationCities = [
                    {
                        city: data.city,
                        state: data.state,
                        country: request.payload.country,
                        latitude: Number(payload.locationLatitude),
                        longitude: Number(payload.locationLongitude)
                    }
                ];
            }
            let language;
            try {
                language = await languageSchema.languageSchema.findOne({country: request.payload.country, language: 'en'}, {_id: 1, name: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in finding language data in auth user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (language) {
                dataToSave.appLanguage = language._id;
                dataToSave.chatLanguage = language._id;
                languageCode = 'en';
            }

            let card;
            try {
                card = await visitingCardSchema.visitingCardSchema.findOne({}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred getting visiting card in auth user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (card) {
                dataToSave.employeeInformation.card = card._id;
            }

            /* Generate deep link if it is not there */
            if (!dataToSave.employeeInformation.profileLink) {
                let deepLink = await commonFunctions.Handlers.createFirebaseShortLink('', '', dataToSave._id, '', '', '', '', '', '');
                if (deepLink === 'error') {
                    console.log('Error occurred in creating deep link');
                } else {
                    dataToSave.employeeInformation.profileLink = deepLink.shortLink;
                }
            }

            /* Get the Zone information */
            try {
                zone = await zoneSchema.zoneSchema.findOne({states: {$in: [dataToSave.employeeInformation.address.state]}}, {
                    _id: 1,
                    abbreviation: 1
                }, {lean: true});
            } catch (e) {
                logger.error('Error occurred getting zone data in auth user handler %s:', JSON.stringify(e));
            }
            if (zone) {
                dataToSave.zone = zone.abbreviation;
            }

            checkUser = await dataToSave.save();
            dataToUpdate = checkUser.toObject();
            if (card) {
                dataToUpdate.employeeInformation.card = card;
            }
        } catch (e) {
            logger.error('Error occurred while creating user in authuser handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (checkPackage) {
            /* Create free subscription & Check whether plan exists */
            let subscriptionData, packageId;

            try {
                packageId = await packageSchema.packageSchema.findOne({country: request.payload.country, isFree: true, isActive: true}, {_id: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while fetching package id in authuser handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            delete checkPackage._id;
            /* Save subscription in database */
            let subscriptionToSave = new subscriptionSchema.subscriptionSchema(checkPackage);
            delete subscriptionToSave.createdAt;
            delete subscriptionToSave.updatedAt;
            delete subscriptionToSave._id;
            subscriptionToSave.isActive = false;
            subscriptionToSave.userId = checkUser._id;
            subscriptionToSave.planType = 'monthly';
            subscriptionToSave.packageId = packageId._id;
            subscriptionToSave.numberOfJobs.count = checkPackage.numberOfJobs.monthlyCount;
            subscriptionToSave.numberOfUsers.count = checkPackage.numberOfUsers.monthlyCount;
            subscriptionToSave.numberOfViews.count = checkPackage.numberOfViews.monthlyCount;
            subscriptionToSave.numberOfTextTranslations.count = checkPackage.numberOfTextTranslations.monthlyCount;
            subscriptionToSave.numberOfJobTranslations.count = checkPackage.numberOfJobTranslations.monthlyCount;
            subscriptionToSave.jobsInAllLocalities.count = checkPackage.jobsInAllLocalities.count;
            subscriptionToSave.isEnded = false;
            subscriptionToSave.isActive = true;
            subscriptionToSave.isPaid = true;
            subscriptionToSave.isFree = true;

            try {
                subscriptionData = await subscriptionToSave.save();
            } catch (e) {
                logger.error('Error occurred saving subscription information in auth user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            const update = {
                subscriptionInfo: {
                    packageId: packageId._id,
                    subscriptionId: subscriptionData._id
                }
            };

            /* Update user with data */
            try {
                dataToUpdate = await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, {$set: update}, {lean: true, new: true});
            } catch (e) {
                logger.error('Error occurred updating user information in create user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }

        /* Send welcome email */
        try {
            let email = {
                to: [{
                    email: request.payload.email,
                    name: (request.payload.firstName + ' ' + request.payload.lastName).trim(),
                    type: 'to'
                }],
                important: false,
                merge: true,
                merge_language: 'mailchimp',
                merge_vars: [{
                    rcpt: request.payload.email,
                    vars: [{
                        name: 'FNAME',
                        content: request.payload.firstName
                    }]
                }]
            };
            mandrill.Handlers.sendTemplate('ezjobs-welcome', [], email, true)
        } catch (e) {
            logger.error('Error in sending verification link to user %s:', JSON.stringify(e));
        }

        /* Create contact into hub spot */
        if (process.env.NODE_ENV === 'production') {
            if (checkUser.facebookId.id) {
                source = 'Facebook';
            } else if (checkUser.googleId.id) {
                source = 'Google';
            } else if (checkUser.linkedInId.id) {
                source = 'Linkedin';
            } else {
                source = 'Email';
            }
            if (checkUser.deviceType.toLowerCase() === 'android') {
                contactSource = 'Android App';
            } else if (checkUser.deviceType.toLowerCase() === 'ios') {
                contactSource = 'IOS App';
            }
            status = commonFunctions.Handlers.createHubSpotContact(checkUser.firstName, checkUser.lastName, checkUser.email, countryList.getName(checkUser.employeeInformation.country), contactSource, source, 'customer', checkUser.employeeInformation.address.city, checkUser.employeeInformation.address.state);
            if (status === 'error') {
                logger.error('Error occurred while creating hub spot contact');
            }
        }
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    }

    /* Create contact in Mautic */
    if (process.env.NODE_ENV === 'production' && !leadFlag) {
        const dataToCreate = {
            firstName: checkUser.firstName,
            lastName: checkUser.lastName,
            email: checkUser.email,
            country: countryList.getName(checkUser.employeeInformation.country),
            contact_source: contactSource,
            email_source: source,
            address1: checkUser.employeeInformation.address.address1,
            address2: checkUser.employeeInformation.address.address2,
            city: checkUser.employeeInformation.address.city,
            state: checkUser.employeeInformation.address.state,
            zipCode: checkUser.employeeInformation.address.zipCode,
            timeZone: checkUser.timeZone ? checkUser.timeZone : 0
        };

       /* let mauticStatus = await commonFunctions.Handlers.createMauticLead(dataToCreate);
        if (mauticStatus === 'error') {
            logger.error('Error occurred while creating mautic contact');
        }

        if (mauticStatus) {
            try {
                await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, {$set: {leadId: mauticStatus.insertId}}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while updating user document');
            }
            leadFlag = true;
            const categoryIds = [5, 6, 7, 8, 9];
            for (let i = 0; i < categoryIds.length; i++) {
                await commonFunctions.Handlers.updateEmailPreference(mauticStatus.insertId, categoryIds[i], 'ADD');
            }
        }*/
    }

    /* Check if password is correct */
    if (payload.password) {
        try {
            match = await bcrypt.compare(payload.password, checkUser.password);
        } catch (e) {
            logger.error('Error occurred while comparing passwords in authuser handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!match) {
            return h.response(responseFormatter.responseFormatter({}, 'Email or password is incorrect', 'error', 400)).code(400);
        }
    }

    /* Check if user has assigned free package or not */
    if (!checkUser.subscriptionInfo) {
        let freePackage, checkPackage, numberOfJobsPosted = 0, subscriptionData;
        try {
            checkPackage = await packageSchema.packageSchema.findOne({country: request.payload.country, isFree: true, isActive: true}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding free package in create user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        try {
            freePackage = await packageSchema.packageSchema.findOne({country: request.payload.country, isFree: true, isActive: true}, {_id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding free package in create user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Get the number of jobs posted */
        try {
            numberOfJobsPosted = await jobsSchema.jobSchema.countDocuments({userId: mongoose.Types.ObjectId(request.payload.userId)});
        } catch (e) {
            logger.error('Error occurred counting number of jobs posted by user in create user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (freePackage) {
            dataToUpdate.subscriptionInfo = {
                packageId: freePackage._id
            };

            delete checkPackage._id;
            /* Save subscription in database */
            let subscriptionToSave = new subscriptionSchema.subscriptionSchema(checkPackage);
            delete subscriptionToSave.createdAt;
            delete subscriptionToSave.updatedAt;
            delete subscriptionToSave._id;
            subscriptionToSave.isActive = false;
            subscriptionToSave.userId = checkUser._id;
            subscriptionToSave.planType = 'monthly';
            subscriptionToSave.packageId = freePackage._id;
            subscriptionToSave.numberOfJobs.count = checkPackage.numberOfJobs.monthlyCount - numberOfJobsPosted;
            subscriptionToSave.numberOfUsers.count = checkPackage.numberOfUsers.monthlyCount;
            subscriptionToSave.numberOfViews.count = checkPackage.numberOfViews.monthlyCount;
            subscriptionToSave.numberOfTextTranslations.count = checkPackage.numberOfTextTranslations.monthlyCount;
            subscriptionToSave.numberOfJobTranslations.count = checkPackage.numberOfJobTranslations.monthlyCount;
            subscriptionToSave.jobsInAllLocalities.count = checkPackage.jobsInAllLocalities.count;
            subscriptionToSave.isEnded = false;
            subscriptionToSave.isActive = true;
            subscriptionToSave.isPaid = true;
            subscriptionToSave.isFree = true;

            try {
                subscriptionData = await subscriptionToSave.save();
            } catch (e) {
                logger.error('Error occurred saving subscription information in auth user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            dataToUpdate.subscriptionInfo['subscriptionId'] = subscriptionData._id;
        }
    }

    /* Update relative data of user in the database */
    if (payload.deviceToken) {
        dataToUpdate.deviceToken = payload.deviceToken;
    }
    if (payload.deviceType) {
        dataToUpdate.deviceType = payload.deviceType;
    }
    if (payload.timeZone) {
        dataToUpdate.timeZone = payload.timeZone;
    }

    if (payload.profilePhoto) {
        dataToUpdate.employeeInformation.profilePhoto = payload.profilePhoto;
    }

    /* Check if lead id is present */
    /*if (process.env.NODE_ENV === 'production' && !leadFlag) {
        const data = await commonFunctions.Handlers.getContactMautic(checkUser.email);
        if (data && data.length) {
            dataToUpdate.leadId = data[0].id;
        }
    }*/

    /* Check for email preference */
    try {
        emailPreferenceUser = await emailPreferenceUserSchema.emailPreferenceUserSchema.findOne({userId: checkUser._id}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user email preferences in authuser handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!emailPreferenceUser) {
        let preferences = [], documentsToInsert = [];
        /* Save all email preferences */
        try {
            preferences = await emailPreferenceTypeSchema.emailPreferenceTypeSchema.find({}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding email preferences in authuser handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        for (let i = 0; i < preferences.length; i++) {
            const dataToSave = {
                userId: checkUser._id,
                categoryId: preferences[i]._id,
                id: i + 1,
                isSelected: true
            };
            documentsToInsert.push({insertOne: {'document': new emailPreferenceUserSchema.emailPreferenceUserSchema(dataToSave)}});
        }
        try {
            await emailPreferenceUserSchema.emailPreferenceUserSchema.collection.bulkWrite(documentsToInsert);
        } catch (e) {
            logger.error('Error occurred while saving email preference data in authuser handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Set the default visiting card if user has not one */
    if (!checkUser.employeeInformation.card) {
        try {
            card = await visitingCardSchema.visitingCardSchema.findOne({}, {_id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding visiting card data in authuser handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (card) {
            dataToUpdate.employeeInformation.card = card._id;
        }
    }

    dataToUpdate.hasUninstalled = false;
    dataToUpdate.hasInstalled = true;

    try {
        updatedUser = await userSchema.UserSchema.findByIdAndUpdate({_id: mongoose.Types.ObjectId(checkUser._id)}, {$set: dataToUpdate}, {lean: true, new: true}).populate([{path: 'employerInformation.verificationData', select: 'status documentType documentNumber documents documentName'}]);
    } catch (e) {
        logger.error('Error occurred while updating user in authuser handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get document type object */
    if (updatedUser.employerInformation.verificationData && updatedUser.employerInformation.verificationData.documentType) {
        let document;
        try {
            document = await verificationFieldSchema.verificationFields.findById({_id: updatedUser.employerInformation.verificationData.documentType}, {type: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting verification in authuser handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (document) {
            updatedUser.employerInformation.verificationData.documentType = document;
        }
    }

    /* Remove device token of all other devices having same device token */
    let bulk = userSchema.UserSchema.collection.initializeUnorderedBulkOp();
    bulk.find({_id: {$ne: updatedUser._id}, deviceToken: updatedUser.deviceToken}).update({$set: {deviceToken: ''}});
    try {
        bulk.execute();
    } catch (e) {
        logger.error('Error occurred while removing other device tokens in auth user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }


    /* If referral code save it into the collection and update the referee count */
    if (isValidReferral) {
        try {
            const referralData = {
                referredBy: mongoose.Types.ObjectId(isValidReferral._id),
                referredTo: mongoose.Types.ObjectId(dataToSave._id)
            };
            await new referralSchema.referralSchema(referralData).save();
        } catch (e) {
            logger.error('Error occurred in saving referral data in create user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        try {
            await userSchema.UserSchema.findByIdAndUpdate({_id: mongoose.Types.ObjectId(isValidReferral._id)}, {$inc: {referralCount: 1}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in updating referee referral count in create user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Save token into the database */
    token = await commonFunctions.Handlers.createAuthToken(checkUser._id, 'Candidate');
    const tokenToSave = {
        userId: checkUser._id,
        authToken: token,
        isExpired: false
    };
    try {
        await tokenSchema.authTokenSchema.findOneAndUpdate({userId: checkUser._id}, tokenToSave, {lean: true, upsert: true});
    } catch (e) {
        logger.error('Error occurred while saving token in authuser handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    delete updatedUser.password;

    updatedUser.unreadCount = unreadCount;
    updatedUser.totalChatUnreadCount = candidateChatCount + employerChatCount;
    updatedUser.employerInformation.pan = updatedUser.employerInformation.pan ? aes256.decrypt(key, updatedUser.employerInformation.pan) : '';
    delete updatedUser['employerInformation.verification'];
    updatedUser.language = languageCode;

    /* Get the visiting card details */
    if (updatedUser.employeeInformation && updatedUser.employeeInformation.card) {
        let card;

        try {
            card = await visitingCardSchema.visitingCardSchema.findById({_id: updatedUser.employeeInformation.card}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred getting visiting auth user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (card) {
            updatedUser.employeeInformation.card = card;
        }
    }

    if (signupFlag) {
        updatedUser.isSignup = signupFlag;
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({authToken: token, userInfo: updatedUser, constantInfo: constantData}, 'LoggedIn successfully', 'success', 200)).code(200);
};

userHandler.forgotPassword = async (request, h) => {
    let checkUser, passwordResetToken, resetToken;

    /* Check whether user exists */
    try {
        checkUser = await userSchema.UserSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in forgotpassword handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'Looks like we do not have your account with us', 'error', 404)).code(404);
    }

    /* Check whether user has signed up using facebook or google */
    /*if (checkUser.facebookId.id) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not reset your password as you have signed up using Facebook', 'error', 400)).code(400);
    } else if (checkUser.googleId.id) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not reset your password as you have signed up using Google', 'error', 400)).code(400);
    } else if (checkUser.linkedInId.id) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not reset your password as you have signed up using Linked In', 'error', 400)).code(400);
    }*/

    /* Generate and assign password reset token to user*/
    resetToken = commonFunctions.Handlers.resetToken();
    passwordResetToken = commonFunctions.Handlers.resetTokenGenerator(request.payload.email, resetToken);
    try {
        await userSchema.UserSchema.findOneAndUpdate({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {$set: {passwordResetToken: resetToken}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating user in forgotpassword handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send change password link to user */
    let verificationUrl = baseUrl + '/forgotPassword?resetToken=' + passwordResetToken;

    /* Check if phone login */
    if (checkUser.phone) {
        verificationUrl += '&isPhone=true';
    }

    try {
        let email = {
            to: [{
                email: checkUser.email,
                name: (checkUser.firstName + ' ' + checkUser.lastName).trim(),
                type: 'to'
            }],
            important: false,
            merge: true,
            inline_css: false,
            merge_language: 'mailchimp',
            merge_vars: [{
                rcpt: checkUser.email,
                vars: [{
                    name: 'FORGETPASSWORD',
                    content: verificationUrl
                }]
            }]
        };
        await mandrill.Handlers.sendTemplate('ezjobs-forget-password', [], email, true)
    } catch (e) {
        logger.error('Error in sending verification link to user %s:', JSON.stringify(e));
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Password reset link has been successfully sent to ' + request.payload.email, 'success', 200)).code(200);
};

userHandler.resetPassword = async (request, h) => {
    let password, updatedUser, decodedToken, checkPassword;

    /* Check if password and confirm passwords are same or not*/
    if (request.payload.password !== request.payload.confirmPassword) {
        return h.response(responseFormatter.responseFormatter({}, 'Both passwords do not match', 'error', 400)).code(400);
    }

    /* Check if user has the same reset token stored with token from API*/
    try {
        decodedToken = await commonFunctions.Handlers.decodeToken(request.payload.resetToken);
    } catch (e) {
        logger.error('Error occurred while decoding token in resetpassword handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        updatedUser = await userSchema.UserSchema.findOne({email: decodedToken.email}, {passwordResetToken: 1, password: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in resetpassword handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!updatedUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists', 'error', 404)).code(404);
    }
    /* Check if old password and new password is same */
    try {
        checkPassword = await bcrypt.compare(request.payload.password, updatedUser.password);
    } catch (e) {
        logger.error('Error occurred while comparing passwords in resetpassword handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (checkPassword) {
        return h.response(responseFormatter.responseFormatter({}, 'You are trying to change your password to your current password', 'error', 400)).code(400);
    }

    if (updatedUser.passwordResetToken !== decodedToken.resetToken) {
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred. Please contact us', 'error', 400)).code(400);
    }

    /* Create a hash of new password and save it to user collection */
    password = await commonFunctions.Handlers.createPassword(request.payload.password);
    try {
        updatedUser = await userSchema.UserSchema.findOneAndUpdate({email: decodedToken.email}, {$set: {password: password, passwordResetToken: ''}}, {lean: true, new: true});
    } catch (e) {
        logger.error('Error occurred while updating user in resetpassword handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send email to user that his/her password has been changed */
    const mailOptions = {
        from: 'support@ezjobs.io',
        to: decodedToken.email,
        subject: 'Password changed',
        text: 'Your password has been changed successfully. If you haven\'t changed your password, call us immediately.'
    };
    try {
        await commonFunctions.Handlers.nodeMailerEZJobs('support@ezjobs.io', mailOptions.subject, mailOptions.text, mailOptions.to);
    } catch (e) {
        logger.error('Error in sending verification link to user %s:', JSON.stringify(e));
    }

    /* Remove token from the database */
    try {
        await tokenSchema.authTokenSchema.findOneAndUpdate({userId: updatedUser._id}, {$set: {isExpired: true}}, {lean: true})
    } catch (e) {
        logger.error('Error occurred while removing auth token in change password handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Password changed successfully', 'success', 204)).code(200);
};

userHandler.resetPhone = async (request, h) => {
    let updatedUser, decodedToken, checkPhone;

    /* Check if user has the same reset token stored with token from API*/
    try {
        decodedToken = await commonFunctions.Handlers.decodeToken(request.payload.resetToken);
    } catch (e) {
        logger.error('Error occurred while decoding token in reset phone handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        updatedUser = await userSchema.UserSchema.findOne({email: decodedToken.email}, {passwordResetToken: 1, countryCode: 1, phone: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in reset phone handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!updatedUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists', 'error', 404)).code(404);
    } else if (!updatedUser.phone) {
        return h.response(responseFormatter.responseFormatter({}, 'You have not used your phone as a login option.', 'error', 400)).code(400);
    }

    if (updatedUser.passwordResetToken !== decodedToken.resetToken) {
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred. Please contact support', 'error', 400)).code(400);
    }

    /* Check whether the phone is assigned to other user */
    try {
        checkPhone = await userSchema.UserSchema.findOne({countryCode: request.payload.countryCode, phone: request.payload.phone}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in reset phone handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (checkPhone) {
        return h.response(responseFormatter.responseFormatter({}, 'This phone is already registered with EZJobs.', 'error', 400)).code(400);
    }

    /* Create a hash of new password and save it to user collection */

    try {
        updatedUser = await userSchema.UserSchema.findOneAndUpdate({email: decodedToken.email}, {$set: {countryCode: request.payload.countryCode, phone: request.payload.phone, passwordResetToken: ''}}, {lean: true, new: true});
    } catch (e) {
        logger.error('Error occurred while updating user in reset phone handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send email to user that his/her password has been changed */
    const mailOptions = {
        from: 'support@ezjobs.io',
        to: decodedToken.email,
        subject: 'Password changed',
        text: 'Your password has been changed successfully. If you haven\'t changed your password, call us immediately.'
    };

    try {
        await commonFunctions.Handlers.nodeMailerEZJobs('EZJobs Support <' + mailOptions.from + '>', mailOptions.subject, mailOptions.text, mailOptions.to);
    } catch (e) {
        logger.error('Error in sending verification link to user %s:', JSON.stringify(e));
    }

    /* Remove token from the database */
    try {
        await tokenSchema.authTokenSchema.findOneAndUpdate({userId: updatedUser._id}, {$set: {isExpired: true}}, {lean: true})
    } catch (e) {
        logger.error('Error occurred while removing auth token in reset phone handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated', 'success', 204)).code(200);
};

userHandler.changePassword = async (request, h) => {
  let checkUser, isMatch = false, newPassword, decoded;

  /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in change password handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

  /* Check if new password is same as old password */
    if (request.payload.oldPassword === request.payload.password) {
        return h.response(responseFormatter.responseFormatter({}, 'You are trying to change your password to your current password', 'error', 400)).code(400);
    }

  /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {password: 1, facebookId: 1, googleId: 1, linkedInId: 1, email: 1, firstName: 1, lastName: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in change password handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists', 'error', 404)).code(404);
    }

    /* Check whether user has signed up using facebook or google */
    if (checkUser.facebookId.id) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not reset your password as you have signed up using Facebook', 'error', 400)).code(400);
    } else if (checkUser.googleId.id) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not reset your password as you have signed up using Google', 'error', 400)).code(400);
    } else if (checkUser.linkedInId.id) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not reset your password as you have signed up using Linked In', 'error', 400)).code(400);
    }

  /* Compare database password with the old password */
    try {
        isMatch = await bcrypt.compare(request.payload.oldPassword, checkUser.password);
    } catch (e) {
        logger.error('Error occurred while comparing password in change password handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!isMatch) {
        return h.response(responseFormatter.responseFormatter({}, 'Current password is incorrect', 'error', 400)).code(400);
    }

    /* Compare new password and confirm password */
    if (request.payload.password !== request.payload.confirmPassword) {
        return h.response(responseFormatter.responseFormatter({}, 'Both passwords do not match', 'error', 400)).code(400);
    }

    /* Create new password and store it in database */
    try {
        newPassword = await commonFunctions.Handlers.createPassword(request.payload.password);
    } catch (e) {
        logger.error('Error occurred while creating password in change password handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$set: {password: newPassword}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating password in user collection in change password handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send email to user that his/her password has been changed */
    let email = {
        to: [{
            email: checkUser.email,
            type: 'to'
        }],
        subject: checkUser.firstName + ' ' + checkUser.lastName + '. Your password changed',
        important: true,
        merge: true,
        inline_css: true,
        merge_language: 'mailchimp',
        merge_vars: [{
            rcpt: checkUser.email,
            vars: [
                {
                    name: 'name',
                    content: (checkUser.firstName + ' ' + checkUser.lastName).trim()
                },
                {
                    name: 'emailid',
                    content: checkUser.email
                },
                {
                    name: 'URL',
                    content: process.env.NODE_ENV === 'production' ? 'https://employer.ezjobs.io/#/forgetPassword' : 'https://employer-qa.ezjobs.io/#/forgetPassword'
                }
            ]
        }]
    };

    try {
        await mandrill.Handlers.sendTemplate('ezjobs-password-changed', [], email, true);
    } catch (e) {
        logger.error('Error occurred while sending email in add user handler %s:', JSON.stringify(e));
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Password changed successfully', 'success', 204)).code(200);
};

userHandler.tokenLoginUser = async (request, h) => {
    let decoded, checkUser, updatedUser, unreadCount = 0, candidateChatCount = 0, employerChatCount = 0, leadFlag = false;

    /* Check if user is actually who is trying to login */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in token login handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user exists or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.userId)}, {password: 0}, {lean: true}).populate([{path: 'employerInformation.verificationData', select: 'status documentType documentNumber documents documentName'}]);
    } catch (e) {
        logger.error('Error occurred while finding user in token login handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Update user information in the database */
    let dataToUpdate = {
        appVersion: request.query.appVersion,
        timeZone: request.query.timeZone,
        deviceType: request.query.deviceType,
        deviceId: request.query.deviceId ? request.query.deviceId : ''
    };
    if (request.query.deviceToken) {
        dataToUpdate.deviceToken = request.query.deviceToken;
    }

    dataToUpdate.hasUninstalled = false;
    dataToUpdate.hasInstalled = true;

    /* Get document type object */
    if (checkUser.employerInformation.verificationData && checkUser.employerInformation.verificationData.documentType) {
        let document;
        try {
            document = await verificationFieldSchema.verificationFields.findById({_id: checkUser.employerInformation.verificationData.documentType}, {type: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting verification in token login handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (document) {
            checkUser.employerInformation.verificationData.documentType = document;
        }
    }

    checkUser.unreadCount = unreadCount;
    checkUser.totalChatUnreadCount = candidateChatCount + employerChatCount;
    delete checkUser['employerInformation.verification'];

    /* Remove device token of all other devices having same device token */
    let bulk = userSchema.UserSchema.collection.initializeUnorderedBulkOp();
    bulk
        .find({_id: {$ne: checkUser._id}, deviceToken: checkUser.deviceToken})
        .update({$set: {deviceToken: ''}});
    try {
        bulk.execute();
    } catch (e) {
        logger.error('Error occurred while removing other device tokens in auth user handler %s:', JSON.stringify(e));
    }

    /* Get the language code from app language from user */
    if (checkUser.appLanguage) {
        let lang;
        try {
            lang = await languageSchema.languageSchema.findById({_id: checkUser.appLanguage}, {language: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting language in auth user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (lang) {
            checkUser.language = lang.language;
        }
    }

    let emailPreferenceUser;
    /* Check for email preference */
    try {
        emailPreferenceUser = await emailPreferenceUserSchema.emailPreferenceUserSchema.findOne({userId: checkUser._id}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user email preferences in token login user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!emailPreferenceUser) {
        let preferences = [], documentsToInsert = [];
        /* Save all email preferences */
        try {
            preferences = await emailPreferenceTypeSchema.emailPreferenceTypeSchema.find({}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding email preferences in token login user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        for (let i = 0; i < preferences.length; i++) {
            const dataToSave = {
                userId: checkUser._id,
                categoryId: preferences[i]._id,
                id: i + 1,
                isSelected: true
            };
            documentsToInsert.push({insertOne: {'document': new emailPreferenceUserSchema.emailPreferenceUserSchema(dataToSave)}});
        }
        try {
            await emailPreferenceUserSchema.emailPreferenceUserSchema.collection.bulkWrite(documentsToInsert);
        } catch (e) {
            logger.error('Error occurred while saving email preference data in token login user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    let card;
    /* Get the visiting card details */
    if (checkUser.employeeInformation && checkUser.employeeInformation.card) {
        try {
            card = await visitingCardSchema.visitingCardSchema.findById({_id: checkUser.employeeInformation.card}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred getting visiting token login handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Create visiting card if not exists */
    if (checkUser.employeeInformation && !checkUser.employeeInformation.card) {
        try {
            card = await visitingCardSchema.visitingCardSchema.findOne({}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred getting visiting token login handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (card) {
            dataToUpdate['employeeInformation.card'] = card._id;
        }
    }

    /* Generate deep link if it is not there */
    if (!checkUser.employeeInformation.profileLink) {
        let deepLink = await commonFunctions.Handlers.createFirebaseShortLink('', '', checkUser._id, '', '', '', '', '', '');
        if (deepLink === 'error') {
            console.log('Error occurred in creating deep link');
        } else {
            dataToUpdate['employeeInformation.profileLink'] = deepLink.shortLink;
        }
    }

    try {
        updatedUser = await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, {$set: dataToUpdate}, {lean: true, new: true});

        if (updatedUser) {
            delete updatedUser.password;
        }

        if (checkUser.employerInformation.verificationData) {
            updatedUser.employerInformation.verificationData = checkUser.employerInformation.verificationData;
        }

        if (card) {
            updatedUser.employeeInformation.card = card;
        }

    } catch (e) {
        logger.error('Error occurred while updating user in token login handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter(updatedUser, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getChats = async (request, h) => {
    let chats, decoded, searchCriteria, aggregationCriteria, filterCriteria, checkRequest;

    /* Check if user is authorized */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get chats handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check user chats in database */
    if (request.query.type.toLowerCase() === 'employer') {
        searchCriteria = {
            employerId: mongoose.Types.ObjectId(request.query.userId),
            hasEmployerDeleted: false
        };
        if (request.query.jobId) {
          searchCriteria.jobId = mongoose.Types.ObjectId(request.query.jobId)
        }
        filterCriteria = {$eq: ['$$this.isCandidateBlocked', false]};
    } else if (request.query.type.toLowerCase() === 'candidate') {
        searchCriteria = {
            candidateId: mongoose.Types.ObjectId(request.query.userId),
            hasCandidateDeleted: false
        };
        filterCriteria = {$eq: ['$$this.isEmployerBlocked', false]};
    }

    aggregationCriteria = [
        {
            $match: searchCriteria
        },
        {
            $lookup: {
                from: 'User',
                localField: 'employerId',
                foreignField: '_id',
                as: 'employer'
            }
        },
        {
            $unwind: '$employer'
        },
        {
            $lookup: {
                from: 'User',
                localField: 'candidateId',
                foreignField: '_id',
                as: 'candidate'
            }
        },
        {
            $unwind: '$candidate'
        },
        {
            $match: {
                'candidate.isActive': true
            }
        },
        {
            $lookup: {
                from: 'Job',
                localField: 'jobId',
                foreignField: '_id',
                as: 'job'
            }
        },
        {
            $unwind: '$job'
        }
    ];

    /* If category ID is given */
    if (request.query.categoryId && request.query.type.toLowerCase() === 'candidate') {
        aggregationCriteria.push({$match: {'job.categoryId': mongoose.Types.ObjectId(request.query.categoryId)}});
    }

    aggregationCriteria.push({
            $project: {
                candidateFirstName: '$candidate.firstName',
                candidateLastName: '$candidate.lastName',
                candidateFullName: {
                    $concat: ['$candidate.firstName', ' ', '$candidate.lastName']
                },
                candidateId: '$candidate._id',
                employerFirstName: '$employer.employerInformation.companyName',
                employerId: '$employer._id',
                candidatePhoto: '$candidate.employeeInformation.profilePhoto',
                employerPhoto: '$employer.employerInformation.companyProfilePhoto',
                jobTitle: '$job.jobTitle',
                subJobTitle: '$job.subJobTitle',
                jobId: '$job._id',
                payRate: '$job.payRate',
                jobType: '$job.jobType',
                lastMessage: {
                    $filter: {
                        input: '$chats',
                        cond: filterCriteria
                    }
                },
                unread: {
                    $size: {
                        $filter: {
                            input: '$chats',
                            cond: { $and: [{$eq: ['$$this.isRead', false]}, {$eq: ['$$this.to', mongoose.Types.ObjectId(request.query.userId)]}, {$eq: ['$$this.isCandidateBlocked', false]}, {$eq: ['$$this.isEmployerBlocked', false]}] }
                        }
                    }
                },
                updatedAt: 1,
                isCandidateOnline: '$candidate.isOnline',
                isEmployerOnline: '$employer.isOnline',
                phone: {
                    candidatePhone: {$cond:
                            [{$and: ['$candidate.employeeInformation.receiveCalls', {$not: ['$isEmployerBlocked']}]}, '$candidate.employeeInformation.phone', '']
                    },
                    candidateCountryCode: {$cond:
                            [{$and: ['$candidate.employeeInformation.receiveCalls', {$not: ['$isEmployerBlocked']}]}, '$candidate.employeeInformation.countryCode', '']
                    }
                },
                isCandidateHired: {
                    $cond: [
                        {
                            $and: [
                                {
                                    $eq: ['$isHired', true]
                                },
                                {
                                    $eq: ['$isRejected', false]
                                }
                            ]
                        },
                        true,
                        false
                    ]
                },
                experienceInMonths: '$candidate.employeeInformation.experienceInMonths',
                isApplied: 1,
                isCandidateBlocked: 1,
                isEmployerBlocked: 1,
                chats: 1,
                isTranslated: 1,
                chatLanguage: '$candidate.chatLanguage',
                rollNumber: '$candidate.employeeInformation.rollNumber',
                isHired: 1,
                isRejected: 1,
                education: '$candidate.employeeInformation.education'
            }
        });

    /* If search text is given */
    if (request.query.searchText) {
        if (request.query.type.toLowerCase() === 'employer') {
            aggregationCriteria.push(
                {
                    $match: {
                        candidateFullName: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                    }
                }
            );
        } else {
            aggregationCriteria.push(
                {
                    $match: {
                        $or: [
                            {
                                employerFirstName: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                            },
                            {
                                jobTitle: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                            }
                        ]
                    }
                }
            );
        }
    }

    aggregationCriteria.push({$project: {
            candidateFirstName: 1,
            candidateLastName: 1,
            candidateFullName: 1,
            candidateId: 1,
            employerFirstName: 1,
            employerId: 1,
            candidatePhoto: 1,
            employerPhoto: 1,
            jobTitle: 1,
            subJobTitle: 1,
            jobId: 1,
            chats: 1,
            lastMessage: {$slice: ['$lastMessage', -1]},
            payRate: 1,
            jobType: 1,
            unread: 1,
            updatedAt: 1,
            isCandidateOnline: 1,
            isEmployerOnline: 1,
            phone: 1,
            isCandidateHired: 1,
            experienceInMonths: 1,
            isApplied: 1,
            isCandidateBlocked: 1,
            isEmployerBlocked: 1,
            chatLanguage: 1,
            isTranslated: 1,
            rollNumber: 1,
            isHired: 1,
            isRejected: 1,
            education: 1
        }
    });

    aggregationCriteria.push({$unwind: '$lastMessage'});
    aggregationCriteria.push({$sort: {'lastMessage.dateTime': -1}});
    if (request.query.skip) {
        aggregationCriteria.push({$skip: request.query.skip});
    }
    if (request.query.limit) {
        aggregationCriteria.push({$limit: request.query.limit});
    }
    aggregationCriteria.push({$project: {
            candidateFirstName: 1,
            candidateLastName: 1,
            candidateFullName: 1,
            candidateId: 1,
            employerFirstName: 1,
            employerId: 1,
            candidatePhoto: 1,
            employerPhoto: 1,
            jobTitle: 1,
            subJobTitle: 1,
            jobId: 1,
            lastMessage: '$lastMessage.body',
            lastMessageOriginal: '$lastMessage.originalBody',
            lastMessageType: '$lastMessage.type',
            lastMessageEncrypted: '$lastMessage.isEncrypted',
            lastMessageDateTime: '$lastMessage.dateTime',
            senderId: '$lastMessage.from',
            payRate: 1,
            jobType: 1,
            unread: 1,
            updatedAt: 1,
            isCandidateOnline: 1,
            isEmployerOnline: 1,
            phone: 1,
            isCandidateHired: 1,
            experienceInMonths: 1,
            isApplied: 1,
            isCandidateBlocked: 1,
            isEmployerBlocked: 1,
            chats: 1,
            chatLanguage: 1,
            rollNumber: 1,
            isHired: 1,
            isRejected: 1,
            education: 1
        }
    });

    try {
        chats = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred while finding chats in get chats handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!chats.length) {
        return h.response(responseFormatter.responseFormatter([], 'No chats found', 'success', 200)).code(200);
    } else {
        for (let i = 0; i < chats.length; i++) {
            try {
                checkRequest = await chatRequestSchema.chatRequestSchema.findOne({
                    jobId: chats[i].jobId,
                    candidateId: chats[i].candidateId,
                    employerId: chats[i].employerId
                }, {isAccepted: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding chat request in get chats handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if (checkRequest && !checkRequest.isAccepted) {
                chats[i].lastMessageOriginal = '';
                chats[i].lastMessage = '';
                chats[i].lastMessageEncrypted = false;
            }

            if (chats[i].lastMessageEncrypted) {
                chats[i].lastMessage = aes256.decrypt(key, chats[i].lastMessage);
                if (chats[i].lastMessageOriginal) {
                    chats[i].lastMessageOriginal = aes256.decrypt(key, chats[i].lastMessageOriginal);
                }
            }
            const lastIndex = chats[i].chats.length - 1;
            if (chats[i].lastMessageType !== 'isText' && chats[i].lastMessageType !== 'voicemessage') {
                if (chats[i].chats[lastIndex].from.toString() === request.query.userId) {
                    chats[i].chats.reverse();
                    const index = chats[i].chats.findIndex(k => {
                        return ((k.type === 'isText') || (k.type === 'voicemessage')) &&
                            ((k.type.toLowerCase() === 'candidate') ? ((k.hasCandidateDeleted === false) && (k.isEmployerBlocked === false)) : ((k.hasEmployerDeleted === false) && (k.isCandidateBlocked === false)))
                    });
                    if (index !== -1) {
                        chats[i].lastMessageType = chats[i].chats[index].type;
                        chats[i].senderId = chats[i].chats[index].from;
                        if (chats[i].chats[index].isEncrypted) {
                            chats[i].lastMessage = aes256.decrypt(key, chats[i].chats[index].body);
                            if (chats[i].chats[index].originalBody) {
                                chats[i].lastMessageOriginal = aes256.decrypt(key, chats[i].chats[index].originalBody);
                            }
                        } else {
                            chats[i].lastMessage = chats[i].chats[index].body;
                            if (chats[i].chats[index].originalBody) {
                                chats[i].lastMessageOriginal = chats[i].chats[index].originalBody;
                            }
                        }
                        chats[i].lastMessageDateTime = chats[i].chats[index].dateTime;
                    }
                }
            }
            delete chats[i].chats;
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(chats, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.updateUser = async (request, h) => {
    let checkUser, decoded, status, imageName, dataToUpdate, updatedUser, certificates = [], certificateImage, resume, resumeDeleteStatus, emailChanged = false, videoStatus, currency, hubSpotProperties = [], salary,
    dynamicProfileFields = [];

    /* Check whether this user is authorized to perform this action or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether user exists in EZJobs database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in update user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    if (request.payload.latLongs && request.payload.preferredLocationCities) {
        if (request.payload.latLongs.length !== (request.payload.preferredLocationCities.length)) {
            return h.response(responseFormatter.responseFormatter({}, 'Please select the preferred job locations again', 'error', 400)).code(400);
        }
    }

    /* Check if user is trying to change is profile photo */
    if (request.payload.profilePhoto) {
        /* If profile photo is changed delete old one and update new one */
        if (checkUser.employeeInformation.profilePhoto) {
            try {
                status = await commonFunctions.Handlers.deleteImage(checkUser.employeeInformation.profilePhoto);
            } catch (e) {
                logger.error('Error occurred while deleting user image in update user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (!status) {
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred while deleting profile photo', 'error', 500)).code(500);
            }
        }

        /* Upload image to s3 bucket */
        try {
            imageName = await commonFunctions.Handlers.uploadImage(request.payload.profilePhoto.path, request.payload.profilePhoto.filename);
        } catch (e) {
            logger.error('Error occurred while uploading user image in update user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Check for certificates and make changes accordingly */
    certificates = checkUser.employeeInformation.certificates;
    if (request.payload.indexOfCertificatesToRemove) {
        if (request.payload.indexOfCertificatesToRemove.length) {
            for (let i = 0; i < request.payload.indexOfCertificatesToRemove.length; i++) {
                const toBeRemoved = request.payload.indexOfCertificatesToRemove[i];
                /* Delete image from s3 bucket */
                try {
                    status = await commonFunctions.Handlers.deleteImage(checkUser.employeeInformation.achievementsModified[toBeRemoved].image);
                } catch (e) {
                    logger.error('Error occurred while deleting certificate image in update user handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (!status) {
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred while deleting certificate', 'error', 500)).code(500);
                }
            }
            for (let i = 0; i < request.payload.indexOfCertificatesToRemove.length; i++) {
                const toBeRemoved = request.payload.indexOfCertificatesToRemove[i];
                /* Remove it from original list of certificates */
                checkUser.employeeInformation.achievementsModified.splice(toBeRemoved, 1);
            }
        }
    }

    /* Upload certificates if any */
    if (request.payload.certificates) {
        if (request.payload.certificates.length) {
            for (let i = 0; i < request.payload.certificates.length; i++) {
                /* Upload image to s3 bucket */
                try {
                    certificateImage = await commonFunctions.Handlers.uploadImage(request.payload.certificates[i].path, request.payload.certificates[i].filename);
                } catch (e) {
                    logger.error('Error occurred while uploading certificate image in update user handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (certificateImage) {
                    certificates.push(certificateImage);
                }
            }
        }
    }

    if (request.payload.isResumeDeleted) {
        try {
            console.log('deleting old resume...');
            resumeDeleteStatus = await commonFunctions.Handlers.deleteImage(checkUser.employeeInformation.resume);
        } catch (e) {
            logger.error('Error occurred while deleting resume in update user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!resumeDeleteStatus) {
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred while deleting resume', 'error', 500)).code(500);
        }
    }

    /* Upload resume if any */
    if (request.payload.resume) {
        /* Check old resume */
        if (checkUser.employeeInformation.resume) {
            try {
                console.log('deleting old resume...');
                resumeDeleteStatus = await commonFunctions.Handlers.deleteImage(checkUser.employeeInformation.resume);
            } catch (e) {
                logger.error('Error occurred while deleting resume in update user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (!resumeDeleteStatus) {
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred while deleting resume', 'error', 500)).code(500);
            }
        }

        try {
            resume = await commonFunctions.Handlers.uploadImage(request.payload.resume.path, request.payload.resume.filename);
        } catch (e) {
            logger.error('Error occurred while uploading resume in update user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Delete old video if uploading new video */
    if (request.payload.isVideoDeleted) {
        try {
            videoStatus = await commonFunctions.Handlers.deleteImage(checkUser.employeeInformation.description.video);
        } catch (e) {
            logger.error('Error occurred while deleting user description video in update user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!videoStatus) {
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred while deleting profile photo', 'error', 500)).code(500);
        }
    }

    /* Attach currency based on country at the time of login */
    try {
        currency = await codeSchema.CodeSchema.findOne({countryISOName: request.payload.country}, {currencyName: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding currency in create user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update mandatory user information in database */
    dataToUpdate = {
        firstName: request.payload.firstName,
        lastName: request.payload.lastName ? request.payload.lastName : '',
        employeeInformation: {
            description: {
                text: request.payload.descriptionText ? request.payload.descriptionText : '',
                video: request.payload.descriptionVideo ? request.payload.descriptionVideo: ''
            },
            location: {
                type: 'Point',
                coordinates: request.payload.latitude ? [Number(request.payload.longitude), Number(request.payload.latitude)]: checkUser.employeeInformation.location.coordinates
            },
            preferredLocationCities: request.payload.preferredLocationCities ? request.payload.preferredLocationCities : (checkUser.employeeInformation.preferredLocationCities || []),
            education: request.payload.education ? request.payload.education : [],
            languages: request.payload.languages ? request.payload.languages : [],
            isStudent: request.payload.isStudent ? request.payload.isStudent : false,
            skills: request.payload.skills ? request.payload.skills : [],
            skillsLower: [],
            expectedSalary: request.payload.expectedSalary ? request.payload.expectedSalary : checkUser.employeeInformation.expectedSalary,
            expectedSalaryType: request.payload.expectedSalaryType ? request.payload.expectedSalaryType : checkUser.employeeInformation.expectedSalaryType,
            address: request.payload.address ? request.payload.address : checkUser.employeeInformation.address,
            country: request.payload.country,
            certificates: certificates,
            jobType: request.payload.jobType ? request.payload.jobType : [],
            defaultLanguage: 'English',
            isComplete: false,
            profilePhoto: checkUser.employeeInformation.profilePhoto,
            resume: request.payload.isResumeDeleted ? '' : checkUser.employeeInformation.resume,
            phone: checkUser.employeeInformation.phone,
            countryCode: checkUser.employeeInformation.countryCode,
            dob: checkUser.employeeInformation.dob,
            experienceInMonths: 0,
            liftWeight: checkUser.employeeInformation.liftWeight,
            pastJobTitles: [],
            futureJobTitles: [],
            isNegotiable: request.payload.isNegotiable ? request.payload.isNegotiable : false,
            canWork: [],
            lastProfileEdited: Date.now(),
            receiveCalls: !!request.payload.receiveCalls,
            preference: checkUser.employeeInformation.preference,
            achievementsModified: checkUser.employeeInformation.achievementsModified ? checkUser.employeeInformation.achievementsModified : [],
            languageChanged: checkUser.employeeInformation.languageChanged,
            totalViews: checkUser.employeeInformation.totalViews,
            uniqueViews: checkUser.employeeInformation.uniqueViews,
            searchAppearances: checkUser.employeeInformation.searchAppearances,
            rollNumber: checkUser.employeeInformation.rollNumber,
            lastEmailSent: checkUser.employeeInformation.lastEmailSent,
            numberOfEmailsSent: checkUser.employeeInformation.numberOfEmailsSent,
            numberOfCallsMade: checkUser.employeeInformation.numberOfCallsMade,
            educationPA: checkUser.employeeInformation.educationPA,
            isInternship: !!request.payload.isInternship,
            homeTown: request.payload.homeTown ? request.payload.homeTown : '',
            isRelocatable: !!request.payload.isRelocatable,
            workAuthorization: request.payload.workAuthorization ? request.payload.workAuthorization : '',
            subJobType: request.payload.subJobType ? request.payload.subJobType : [],
            securityClearance: !!request.payload.securityClearance,
            card: checkUser.employeeInformation.card ? checkUser.employeeInformation.card : null,
            profileLink: checkUser.employeeInformation.profileLink,
            pastJobTitlesModified: request.payload.pastJobTitlesModified ? request.payload.pastJobTitlesModified : [],
            isEZCVResume: request.payload.isResumeDeleted ? false : (!!checkUser.employeeInformation.isEZCVResume)
        },
        gender: request.payload.gender ? request.payload.gender : (checkUser.gender ? checkUser.gender : 'not specified'),
        currency: currency ? currency.currencyName : 'INR',
        phoneVerified: checkUser.phoneVerified,
        email: checkUser.email
    };

    if (request.payload.latLongs) {
        dataToUpdate.employeeInformation.preferredLocations = {
            type: 'MultiPoint',
            coordinates: request.payload.latLongs
        }
    } else {
        dataToUpdate.employeeInformation.preferredLocations = {
            type: 'MultiPoint',
            coordinates: [dataToUpdate.employeeInformation.location.coordinates]
        }
    }

    if (!request.payload.preferredLocationCities) {
        dataToUpdate.employeeInformation.preferredLocationCities = [
            {
                city: dataToUpdate.employeeInformation.address.city,
                state: dataToUpdate.employeeInformation.address.state,
                country: dataToUpdate.employeeInformation.country,
                latitude: dataToUpdate.employeeInformation.location.coordinates[1],
                longitude: dataToUpdate.employeeInformation.location.coordinates[0]
            }
        ]
    }

    hubSpotProperties.push({
        property: 'firstName',
        value: request.payload.firstName
    });

    if (request.payload.lastName) {
        hubSpotProperties.push({
            property: 'lastName',
            value: request.payload.lastName
        });
    }

    if (request.payload.gender) {
        hubSpotProperties.push({
            property: 'gender',
            value: request.payload.gender
        });
    }

    if (request.payload.isStudent) {
        hubSpotProperties.push({
            property: 'is_student',
            value: 'true'
        });
    } else {
        hubSpotProperties.push({
            property: 'is_student',
            value: 'false'
        });
    }

    if (request.payload.expectedSalary) {
        hubSpotProperties.push({
            property: 'salary',
            value: request.payload.expectedSalary.toString()
        });
    }

    if (request.payload.expectedSalaryType) {
        hubSpotProperties.push({
            property: 'salary_type',
            value: request.payload.expectedSalaryType
        });
        /* Get & Update min max salary collection */
        try {
            salary = await minMaxSalarySchema.minMaxSalarySchema.findOne({country: request.payload.country, type: request.payload.expectedSalaryType.toLowerCase(), role: 'user'}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting minmax salary counts in user profile update handler %s:', JSON.stringify(e));
        }
        if (salary) {
            if ((request.payload.expectedSalary < salary.min) || (request.payload.expectedSalary > salary.max)) {
                let updateValue = {};
                if (request.payload.expectedSalary < salary.min) {
                    updateValue = {
                        $set: {min: request.payload.expectedSalary, role: 'user', type: request.payload.expectedSalaryType.toLowerCase()}
                    }
                } else {
                    updateValue = {
                        $set: {max: request.payload.expectedSalary, role: 'user', type: request.payload.expectedSalaryType.toLowerCase()}
                    }
                }
                try {
                    await minMaxSalarySchema.minMaxSalarySchema.findOneAndUpdate({country: request.payload.country, type: request.payload.expectedSalaryType.toLowerCase(), role: 'user'}, updateValue, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while updating minmax salary counts in user profile update handler %s:', JSON.stringify(e));
                }
            }
        } else {
            try {
                await minMaxSalarySchema.minMaxSalarySchema.findOneAndUpdate({country: request.payload.country, type: request.payload.expectedSalaryType.toLowerCase(), role: 'user'}, {$set: {min: request.payload.expectedSalary, role: 'user', type: request.payload.expectedSalaryType.toLowerCase(), max: request.payload.expectedSalary}}, {lean: true, upsert: true});
            } catch (e) {
                logger.error('Error occurred while updating minmax salary counts in user profile update handler %s:', JSON.stringify(e));
            }
        }
    }

    let language = [];
    if (request.payload.languages) {
        for (let i = 0; i < request.payload.languages.length; i++) {
            language.push(request.payload.languages[i].language);
        }
        hubSpotProperties.push({
            property: 'languages',
            value: language.join(', ')
        });
    }

    /* Populate lower case skills */
    if (request.payload.skills) {
        for (let i = 0; i < request.payload.skills.length; i++) {
            dataToUpdate.employeeInformation.skillsLower.push(request.payload.skills[i].toLowerCase());
        }
        hubSpotProperties.push({
            property: 'skills',
            value: request.payload.skills.join(', ')
        });
    }

    /* Update all the optional parameters*/
    if (imageName) {
        dataToUpdate.employeeInformation.profilePhoto = imageName;
    }
    if (emailChanged) {
        dataToUpdate.emailVerified = false;
    }
    if (request.payload.address && request.payload.address.address1) {
        let latitude, longitude, result, address;
        address = request.payload.address.address1 + ' ' + (request.payload.address.address2 ? request.payload.address.address2 : '') + ' ' +
        request.payload.address.city + ' ' + request.payload.address.state + ' ' + request.payload.address.zipCode;
        try {
            result = await commonFunctions.Handlers.geocode(address);
        } catch (e) {
            logger.error('Error occurred while geo coding user address in update user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (result && result.length) {
            latitude = result[0].latitude;
            longitude = result[0].longitude;

            dataToUpdate.employeeInformation.location = {
                type: 'Point',
                coordinates: [longitude, latitude]
            }
        }
    }
    if (resume) {
        dataToUpdate.employeeInformation.resume = resume;
        dataToUpdate.employeeInformation.isEZCVResume = false;
        hubSpotProperties.push({
            property: 'resume',
            value: resume
        });
    }

    if (request.payload.phone) {
        dataToUpdate.employeeInformation.phone = request.payload.phone;
        dataToUpdate.employeeInformation.countryCode = request.payload.countryCode;
        if (checkUser.employeeInformation.phone && (request.payload.phone !== checkUser.employeeInformation.phone)) {
            dataToUpdate.phoneVerified = false;
        }
        hubSpotProperties.push({
            property: 'mobilephone',
            value: request.payload.countryCode + '' + request.payload.phone
        });
    }
    if (request.payload.dob) {
        dataToUpdate.employeeInformation.dob = request.payload.dob;
        hubSpotProperties.push({
            property: 'date_of_birth',
            value: request.payload.dob.month + '/' + request.payload.dob.day + '/' + request.payload.dob.year
        });
    }
    if (request.payload.achievements) {
        dataToUpdate.employeeInformation.achievements = request.payload.achievements;
    }
    if (request.payload.pastJobTitlesModified) {

        if (request.payload.pastJobTitlesModified) {
            dataToUpdate.employeeInformation.experienceInMonths = commonFunctions.Handlers.calculateExperience(request.payload.pastJobTitlesModified);
        }

        hubSpotProperties.push({
            property: 'experience',
            value: dataToUpdate.experienceInMonths
        });
    }
    if (request.payload.liftWeight) {
        dataToUpdate.employeeInformation.liftWeight = request.payload.liftWeight;
    }
    if (request.payload.pastJobTitles) {
        dataToUpdate.employeeInformation.pastJobTitles = request.payload.pastJobTitles;
        hubSpotProperties.push({
            property: 'past_job_titles',
            value: request.payload.pastJobTitles.join(', ')
        });
    }
    if (request.payload.futureJobTitles) {
        dataToUpdate.employeeInformation.futureJobTitles = request.payload.futureJobTitles;
        hubSpotProperties.push({
            property: 'desired_positions',
            value: request.payload.futureJobTitles.join(', ')
        });
    }
    if (request.payload.canWork) {
        dataToUpdate.employeeInformation.canWork = request.payload.canWork;
    }

    /* Get the dynamic profile fields list to determine profile completion */
    try {
        dynamicProfileFields = await dynamicFieldsSchema.dynamicFieldsSchema.findOne({
            type: 'candidateProfile',
            country: dataToUpdate.employeeInformation.country
        }, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding dynamic profile fields in update user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    dataToUpdate.employeeInformation.isComplete = true;

    if (dynamicProfileFields && dynamicProfileFields.fields) {
        const keys = Object.keys(dynamicProfileFields.fields).filter(k => dynamicProfileFields.fields[k].isRequired === true);
        for (let i = 0; i < keys.length; i++) {
            if (keys[i] === 'selfIntroductionText') {
                dataToUpdate.employeeInformation.isComplete = !!dataToUpdate.employeeInformation.description.text;
                if (!dataToUpdate.employeeInformation.isComplete) {
                    break;
                }
            } else if (keys[i] === 'dob') {
                dataToUpdate.employeeInformation.isComplete = !!dataToUpdate.employeeInformation.dob.day;
                if (!dataToUpdate.employeeInformation.isComplete) {
                    break;
                }
            } else if (keys[i] === 'jobLocation') {
                dataToUpdate.employeeInformation.isComplete = !!dataToUpdate.employeeInformation.preferredLocationCities.length;
                if (!dataToUpdate.employeeInformation.isComplete) {
                    break;
                }
            } else if (keys[i] === 'education' ||
                keys[i] === 'experience' ||
                keys[i] === 'languages' ||
                keys[i] === 'skills' ||
                keys[i] === 'futureJobTitles' ||
                keys[i] === 'pastJobTitles') {
                dataToUpdate.employeeInformation.isComplete = dataToUpdate.employeeInformation[keys[i]] ? !!dataToUpdate.employeeInformation[keys[i]].length : true;
                if (!dataToUpdate.employeeInformation.isComplete) {
                    break;
                }
            } else if (keys[i] === 'firstName' || keys[i] === 'lastName' ||
                keys[i] === 'email') {
                dataToUpdate.employeeInformation.isComplete = !!dataToUpdate[keys[i]];
                if (!dataToUpdate.employeeInformation.isComplete) {
                    break;
                }
            } else if (keys[i] === 'gender' || keys[i] === 'homeTown' ||
                keys[i] === 'jobType' || keys[i] === 'resume') {
                dataToUpdate.employeeInformation.isComplete = !!dataToUpdate.employeeInformation[keys[i]];
                if (!dataToUpdate.employeeInformation.isComplete) {
                    break;
                }
            }
        }
    } else {
        dataToUpdate.employeeInformation.isComplete = !!dataToUpdate.employeeInformation.preferredLocationCities.length &&
            !!dataToUpdate.employeeInformation.description.text &&
            !!dataToUpdate.employeeInformation.dob.day &&
            !!dataToUpdate.phoneVerified &&
            !!dataToUpdate.employeeInformation.education.length &&
            !!dataToUpdate.employeeInformation.languages.length &&
            !!dataToUpdate.employeeInformation.skills.length &&
            !!dataToUpdate.employeeInformation.futureJobTitles.length &&
            !!(dataToUpdate.employeeInformation.isNegotiable || dataToUpdate.employeeInformation.expectedSalary);
    }

    try {
        updatedUser = await userSchema.UserSchema.findByIdAndUpdate({_id: mongoose.Types.ObjectId(request.payload.userId)}, {$set: dataToUpdate}, {lean: true, new: true});
        if (updatedUser) {
            delete updatedUser.password;
        }
    } catch (e) {
        logger.error('Error occurred while updating user info in update user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    dataToUpdate.languages = language;
    dataToUpdate.timeZone = checkUser.timeZone;
    dataToUpdate.email = checkUser.email;

    /* Update hub spot contact properties */
    if (process.env.NODE_ENV === 'production') {
        let statusHubSpot = await commonFunctions.Handlers.updateHubSpotContact(checkUser.email, hubSpotProperties);
        if (statusHubSpot === 404) {
            console.log('HubSpot contact not found');
        }
    }

    /* Add Universities into suggestion collection for auto complete */
    if (request.payload.education) {
        let universities = [];
        for (let i = 0; i < request.payload.education.length; i++) {
            universities.push(request.payload.education[i].university);
        }
        try {
            await searchSuggestionSchema.searchSuggestionSchema.findOneAndUpdate({isUniversity: true}, {$addToSet: {universities: {$each: universities}}, $set: {isUniversity: true}}, {lean: true, upsert: true});
        } catch (e) {
            logger.error('Error occurred while saving universities data into suggestion collection in edit profile handler %s:', JSON.stringify(e));
        }

        /* Add Universities into suggestion collection for auto complete */
        let majors = [];
        for (let i = 0; i < request.payload.education.length; i++) {
            majors.push(request.payload.education[i].major);
        }
        try {
            await searchSuggestionSchema.searchSuggestionSchema.findOneAndUpdate({isMajor: true}, {$addToSet: {majors: {$each: majors}}, $set: {isMajor: true}}, {lean: true, upsert: true});
        } catch (e) {
            logger.error('Error occurred while saving majors data into suggestion collection in edit profile handler %s:', JSON.stringify(e));
        }
    }

    let total = 9;
    let count = 0;
    if (updatedUser.employeeInformation.dob.day) {
        count++;
    }
    if (updatedUser.employeeInformation.profilePhoto) {
        count++;
    }
    if (updatedUser.employeeInformation.address.zipCode && updatedUser.employeeInformation.address.address1) {
        count++;
    }
    if (updatedUser.employeeInformation.education.length) {
        count++;
    }
    if (updatedUser.employeeInformation.languages.length) {
        count++;
    }
    if (updatedUser.employeeInformation.expectedSalary) {
        count++;
    }
    if (updatedUser.employeeInformation.resume) {
        count++;
    }
    if (updatedUser.employeeInformation.skills.length) {
        count++;
    }
    if (updatedUser.employeeInformation.description.text || updatedUser.employeeInformation.description.video) {
        count++;
    }
    updatedUser.profileCompletion = Number(((100 / total) * count).toFixed(2));

    delete updatedUser.employerInformation;

    /* Get the visiting card details */
    let card;
    if (updatedUser.employeeInformation && updatedUser.employeeInformation.card) {
        try {
            card = await visitingCardSchema.visitingCardSchema.findById({_id: updatedUser.employeeInformation.card}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred getting visiting token login handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (card) {
            updatedUser.employeeInformation.card = card;
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(updatedUser, 'User info updated successfully', 'success', 204)).code(200);
};

userHandler.getUser = async (request, h) => {
    let checkUser, projectionCriteria, favourite = false, status, checkEmployer, packageData, constantData,
        subscriptionData, views = 0, isViewed = false, pricing, viewFlag = true;

    if (request.query.role.toLowerCase() === 'candidate') {
        projectionCriteria = {
            password: 0,
            __v: 0,
            employerInformation: 0
        }
    } else if (request.query.role.toLowerCase() === 'employer') {
        projectionCriteria = {
            password: 0,
            __v: 0,
            employeeInformation: 0,
            'employerInformation.verification': 0
        }
    }

    /* Get constant data */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {memberships: 1}, {lean: true, new: true});
    } catch (e) {
        logger.error('Error occurred while finding constant data in get user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check if employer exists */
    if (request.query.employerId) {
        try {
            checkEmployer = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.employerId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding employer in get user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkEmployer) {
            return h.response(responseFormatter.responseFormatter({}, 'No such employer', 'error', 404)).code(404);
        }

        /* Get the subscription info of the employer */
        try {
            subscriptionData = await subscriptionSchema.subscriptionSchema.findById({_id: checkEmployer.subscriptionInfo.subscriptionId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding subscription data in get user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* If candidate profile views are not unlimited then reduce the same and add it into Views collection */
        let addedUsers = [];
        if (checkEmployer.isMaster) {
            checkEmployer.slaveUsers.push(checkEmployer._id);
            addedUsers = checkEmployer.slaveUsers;
        } else {
            let master;
            /* Get master account */
            try {
                master = await userSchema.UserSchema.findOne({slaveUsers: mongoose.Types.ObjectId(checkEmployer._id)}, {
                    _id: 1,
                    slaveUsers: 1
                }, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding master user data in get user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (master) {
                master.slaveUsers.push(master._id);
                addedUsers = master.slaveUsers;
            }
        }
        if (!subscriptionData.numberOfViews.isUnlimited) {
            try {
                isViewed = await viewsSchema.viewsSchema.findOne({
                    employerId: {$in: addedUsers},
                    candidateId: mongoose.Types.ObjectId(request.query.userId)
                }, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding views data in get user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            isViewed = !!isViewed;

            views = subscriptionData ? subscriptionData.numberOfViews.count : 0;

            if (!isViewed) {
                if (views > 0) {
                    /* Reduce the count */
                    try {
                        await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: subscriptionData._id}, {$inc: {'numberOfViews.count': -1}}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while updating subscription data in get user handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                    /* Add same into views collection */
                    let viewToSave = {
                        employerId: mongoose.Types.ObjectId(checkEmployer._id),
                        candidateId: mongoose.Types.ObjectId(request.query.userId)
                    };
                    let expiration;
                    if (subscriptionData.numberOfViews.expiryAfterPackageExpiry === 0) {
                        expiration = subscriptionData.expiresAt;
                    } else if (subscriptionData.numberOfViews.expiryAfterPackageExpiry < 0) {
                        expiration = new Date(moment(subscriptionData.expiresAt).add(50, 'years'));
                    } else if (subscriptionData.numberOfViews.expiryAfterPackageExpiry > 0) {
                        expiration = new Date(moment(subscriptionData.expiresAt).add(subscriptionData.numberOfViews.expiryAfterPackageExpiry, 'days'));
                    }
                    if (expiration) {
                        viewToSave['expiration'] = expiration;
                    }
                    try {
                        await new viewsSchema.viewsSchema(viewToSave).save();
                    } catch (e) {
                        logger.error('Error occurred while adding view data in get user handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                } else {
                    projectionCriteria = {
                        firstName: 1,
                        lastName: 1,
                        'employeeInformation.profilePhoto': 1,
                        'employeeInformation.experienceInMonths': 1,
                        'employeeInformation.expectedSalary': 1,
                        'employeeInformation.expectedSalaryType': 1,
                        'employeeInformation.preferredLocationCities': 1,
                        'employeeInformation.skills': 1,
                        'employeeInformation.pastJobTitles': 1,
                        'employeeInformation.pastJobTitlesModified': 1,
                        'employeeInformation.futureJobTitles': 1,
                        'employeeInformation.dob': 1,
                        'employeeInformation.address': 1,
                        'employeeInformation.description': 1,
                        'employeeInformation.isStudent': 1,
                        'employeeInformation.isInternship': 1,
                        currency: 1,
                        membership: 1
                    }
                }
            }
        } else {
            let checkView;
            try {
                checkView = await viewsSchema.viewsSchema.findOne({
                    employerId: {$in: addedUsers},
                    candidateId: mongoose.Types.ObjectId(request.query.userId)
                }, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding view data in get user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (!checkView) {
                /* Increase the view count if package is of type wallet */
                if (subscriptionData.isWallet) {
                    if (subscriptionData.walletAmount <= 0) {
                        projectionCriteria = {
                            firstName: 1,
                            lastName: 1,
                            'employeeInformation.profilePhoto': 1,
                            'employeeInformation.experienceInMonths': 1,
                            'employeeInformation.expectedSalary': 1,
                            'employeeInformation.expectedSalaryType': 1,
                            'employeeInformation.preferredLocationCities': 1,
                            'employeeInformation.skills': 1,
                            'employeeInformation.pastJobTitles': 1,
                            'employeeInformation.pastJobTitlesModified': 1,
                            'employeeInformation.futureJobTitles': 1,
                            'employeeInformation.dob': 1,
                            'employeeInformation.address': 1,
                            'employeeInformation.description': 1,
                            'employeeInformation.isStudent': 1,
                            'employeeInformation.isInternship': 1,
                            currency: 1,
                            membership: 1
                        };
                        viewFlag = false;
                    } else {
                        try {
                            packageData = await packageSchema.packageSchema.findById({_id: subscriptionData.packageId}, {}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred while finding package data in get user handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }
                        if (packageData) {
                            try {
                                pricing = await pricingSchema.pricingSchema.findOne({country: packageData.country}, {}, {lean: true});
                            } catch (e) {
                                logger.error('Error occurred while finding pricing data in get user handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }
                            if (pricing) {
                                const amount = (pricing.numberOfViews.basePrice / pricing.numberOfViews.count);
                                if (subscriptionData.walletAmount < amount) {
                                    projectionCriteria = {
                                        firstName: 1,
                                        lastName: 1,
                                        'employeeInformation.profilePhoto': 1,
                                        'employeeInformation.experienceInMonths': 1,
                                        'employeeInformation.expectedSalary': 1,
                                        'employeeInformation.expectedSalaryType': 1,
                                        'employeeInformation.preferredLocationCities': 1,
                                        'employeeInformation.skills': 1,
                                        'employeeInformation.pastJobTitles': 1,
                                        'employeeInformation.pastJobTitlesModified': 1,
                                        'employeeInformation.futureJobTitles': 1,
                                        'employeeInformation.dob': 1,
                                        'employeeInformation.address': 1,
                                        'employeeInformation.description': 1,
                                        'employeeInformation.isStudent': 1,
                                        'employeeInformation.isInternship': 1,
                                        currency: 1,
                                        membership: 1
                                    };
                                    viewFlag = false;
                                } else {
                                    try {
                                        await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: subscriptionData._id}, {
                                            $inc: {
                                                'numberOfViews.count': 1,
                                                walletAmount: -amount
                                            }
                                        }, {lean: true});
                                    } catch (e) {
                                        logger.error('Error occurred while updating subscription data in get user handler %s:', JSON.stringify(e));
                                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                                    }
                                }
                            } else {
                                return h.response(responseFormatter.responseFormatter({}, 'No pricing information found for your region', 'error', 400)).code(400);
                            }
                        } else {
                            return h.response(responseFormatter.responseFormatter({}, 'No such package found', 'error', 400)).code(400);
                        }
                    }
                }

                if (viewFlag) {
                    /* Add same into views collection */
                    let viewToSave = {
                        employerId: mongoose.Types.ObjectId(checkEmployer._id),
                        candidateId: mongoose.Types.ObjectId(request.query.userId)
                    };

                    if (subscriptionData.isWallet) {
                        let expiration;
                        if (packageData.numberOfViews.expiryAfterPackageExpiry === 0) {
                            expiration = subscriptionData.expiresAt;
                        } else if (packageData.numberOfViews.expiryAfterPackageExpiry < 0) {
                            expiration = new Date(moment(subscriptionData.expiresAt).add(50, 'years'));
                        } else if (packageData.numberOfViews.expiryAfterPackageExpiry > 0) {
                            expiration = new Date(moment(subscriptionData.expiresAt).add(packageData.numberOfViews.expiryAfterPackageExpiry, 'days'));
                        }

                        if (expiration) {
                            viewToSave['expiration'] = expiration;
                        }
                    }

                    try {
                        await new viewsSchema.viewsSchema(viewToSave).save();
                    } catch (e) {
                        logger.error('Error occurred while adding view data in get user handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }
            } else {
                isViewed = true;
            }
        }
    }

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.userId)}, projectionCriteria, {lean: true}).populate('employerInformation.verificationData', 'status documentType documentNumber documentName documents');
    } catch (e) {
        logger.error('Error occurred while finding user in get user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    } else {
        let total = 0, count = 0;
        if (request.query.role.toLowerCase() === 'employer') {
            total = 4;
            count = 0;
            if (checkUser.employerInformation.companyName) {
                count++;
            }
            if (checkUser.employerInformation.companyPhone) {
                count++;
            }
            if (checkUser.employerInformation.companyAddress.zipCode) {
                count++;
            }
            if (checkUser.employerInformation.companyProfilePhoto) {
                count++;
            }
            checkUser.profileCompletion = Number(((100 / total) * count).toFixed(2));
            checkUser.employerInformation.pan = checkUser.employerInformation.pan ? aes256.decrypt(key, checkUser.employerInformation.pan) : '';

            /* Get document type object */
            if (checkUser.employerInformation.verificationData && checkUser.employerInformation.verificationData.documentType) {
                let document;
                try {
                    document = await verificationFieldSchema.verificationFields.findById({_id: checkUser.employerInformation.verificationData.documentType}, {type: 1}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while getting verification in get user handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (document) {
                    checkUser.employerInformation.verificationData.documentType = document;
                }
            }

        } else if (request.query.role.toLowerCase() === 'candidate') {
            total = 11;
            count = 0;
            if (checkUser.employeeInformation.dob.day) {
                count++;
            }
            if (checkUser.employeeInformation.profilePhoto) {
                count++;
            }
            if (checkUser.employeeInformation.preferredLocationCities.length) {
                count++;
            }
            if (checkUser.employeeInformation.education && checkUser.employeeInformation.education.length) {
                count++;
            }
            if (checkUser.employeeInformation.languages && checkUser.employeeInformation.languages.length) {
                count++;
            }
            if (checkUser.employeeInformation.futureJobTitles && checkUser.employeeInformation.futureJobTitles.length) {
                count++;
            }
            if (checkUser.employeeInformation.isNegotiable || checkUser.employeeInformation.expectedSalary) {
                count++;
            }
            if (checkUser.employeeInformation.resume) {
                count++;
            }
            if (checkUser.employeeInformation.skills && checkUser.employeeInformation.skills.length) {
                count++;
            }
            if (checkUser.employeeInformation.description.text) {
                count++;
            }
            if (checkUser.employeeInformation.description.video) {
                count++;
            }
            checkUser.profileCompletion = Number(((100 / total) * count).toFixed(2));
            delete checkUser.employerInformation;
        }
    }

    if (request.query.employerId && (!subscriptionData.numberOfViews.isUnlimited && views <= 0 && !isViewed)) {
        checkUser.employeeInformation.isPersonalInformationLocked = true;
        checkUser.employeeInformation.isEducationLocked = true;
    } else if (request.query.employerId && subscriptionData.isWallet && !viewFlag) {
        checkUser.employeeInformation.isPersonalInformationLocked = true;
        checkUser.employeeInformation.isEducationLocked = true;
    }

    if (request.query.role.toLowerCase() === 'candidate') {
        checkUser.employeeInformation.isViewed = !!isViewed;
    }

    /* Check if this candidate is favourite or not */
    if (request.query.employerId) {
        try {
            favourite = await favouriteCandidateSchema.favouriteCandidateSchema.findOne({
                userId: mongoose.Types.ObjectId(request.query.employerId),
                candidateId: mongoose.Types.ObjectId(request.query.userId)
            }, {isFavourite: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding favourite candidate in get user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        checkUser.isFavourite = !!favourite;
        /* Check if buyer is blocked by seller or not */
        try {
            status = await userSchema.UserSchema.findOne({_id: mongoose.Types.ObjectId(request.query.userId), blockedBy: {$in: [mongoose.Types.ObjectId(request.query.employerId)]}}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding blocked user in get user details with tracking handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        checkUser.isBlockedByEmployer = !!status;

        /* Increase the count of the views of the candidate */
        try {
            await userSchema.UserSchema.findByIdAndUpdate({_id: request.query.userId}, {$inc: {'employeeInformation.totalViews': 1}, $addToSet: {'employeeInformation.uniqueViews': mongoose.Types.ObjectId(request.query.employerId)}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred updating user in get user details with tracking handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!checkUser.employeeInformation.receiveCalls) {
            checkUser.employeeInformation.phone = '';
            checkUser.employeeInformation.countryCode = '';
        }
    }

    if (checkUser.employeeInformation && checkUser.employeeInformation.card) {
        let card;

        try {
            card = await visitingCardSchema.visitingCardSchema.findById({_id: checkUser.employeeInformation.card}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred getting visiting card in get user details with tracking handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (card) {
            checkUser.employeeInformation.card = card;
        }
    }

    if (checkUser.membership) {
        let memberships = [];
        const idx = memberships.findIndex(k => k._id === checkUser.membership.toString());
        if (idx === -1) {
            let admin;
            try {
                admin = await userSchema.UserSchema.findOne({isPaAdmin: true, membership: checkUser.membership}, {employerInformation: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding membership logo in get user handler %s:', JSON.stringify(e));
            }
            if (admin) {
                memberships.push({_id: checkUser.membership.toString(), photo: admin.employerInformation.companyProfilePhoto});
                checkUser.membershipLogo = admin.employerInformation.companyProfilePhoto;
                const idx1 = constantData.memberships.findIndex(k => k._id.toString() === checkUser.membership.toString());
                if (idx1 !== -1) {
                    checkUser.membershipName = constantData.memberships[idx1].name;
                }
            }
        } else {
            checkUser.membershipLogo = memberships[idx].photo;
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({userInfo: checkUser}, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.verifyToken = async (request, h) => {
    let userId, userData;

    /* Check whether user exists */
    try {
        userData = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.userId)}, {googleId: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while verifying google token in verify token handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!userData) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Verify google token */
    try {
        userId = await commonFunctions.Handlers.verifyGoogleToken(request.query.token);
        if (userId === 'error' || (userData.googleId.id !== userId)) {
            return h.response(responseFormatter.responseFormatter({}, 'Your google session is expired. Please login again.', 'error', 401)).code(401);
        } else {
            await userSchema.UserSchema.findByIdAndUpdate({_id: mongoose.Types.ObjectId(request.query.userId)}, {$set: {'googleId.token': request.query.token}}, {lean: true});
        }
    } catch (e) {
        return h.response(responseFormatter.responseFormatter({}, 'Your google session is expired. Please login again.', 'error', 401)).code(401);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Token is valid', 'success', 200)).code(200);
};

userHandler.updateFavouriteList = async (request, h) => {
    let decoded, checkUser, status;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in update favourite list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in update favourite list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check if it is already favourite */
    try {
        status = await favouriteSchema.favouriteSchema.findOne({ userId: mongoose.Types.ObjectId(request.payload.userId),
            jobId: mongoose.Types.ObjectId(request.payload.jobId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching favourite data in update favourite list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (request.payload.isFavourite && status) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not make this job as favourite more than once', 'error', 400)).code(400);
    }

    /* If isFavourite flag is false then remove thar listing from favourite list otherwise add it into the database */
    if (request.payload.isFavourite) {
        const dataToSave = {
            userId: mongoose.Types.ObjectId(request.payload.userId),
            jobId: mongoose.Types.ObjectId(request.payload.jobId)
        };
        try {
            await new favouriteSchema.favouriteSchema(dataToSave).save();
        } catch (e) {
            logger.error('Error occurred saving favourite list in update favourite list handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        return h.response(responseFormatter.responseFormatter({}, 'Added to Favourite List', 'success', 201)).code(201);
    } else {
        const dataToRemove = {
            userId: mongoose.Types.ObjectId(request.payload.userId),
            jobId: mongoose.Types.ObjectId(request.payload.jobId)
        };
        let removed;
        try {
            removed = await favouriteSchema.favouriteSchema.findOneAndDelete(dataToRemove);
        } catch (e) {
            logger.error('Error occurred removing favourite list in update favourite list handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!removed) {
            return h.response(responseFormatter.responseFormatter({}, 'Job not found in favourite list', 'error', 404)).code(404);
        }
        return h.response(responseFormatter.responseFormatter({}, 'Removed from Favourite List', 'success', 200)).code(200);
    }
};

userHandler.getJobs = async (request, h) => {
    let aggregationCriteria = [], newAggregationCriteria = [], searchCriteria = {}, jobs, favourites, constantData, userData, englishLanguage, totalCount = 0;

    /* Fetch user data */
    if (request.query.userId) {
        try {
            userData = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching user information in get jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Fetch constant data */
    try {
         constantData = await constantSchema.constantSchema.findOne({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching constant data in get jobs handler %s:', JSON.stringify(e));
    }

    /* Get english language */
    try {
        englishLanguage = await languageSchema.languageSchema.findOne({language: 'en', country: request.query.country}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding english language in get jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (request.query.categoryId) {
        searchCriteria.categoryId = mongoose.Types.ObjectId(request.query.categoryId);

        /* Increase click rate of that category ID*/
        try {
            await categorySchema.categorySchema.findByIdAndUpdate({_id: request.query.categoryId}, {$inc: {clicks: 1}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while incrementing click count of category in get jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    if (request.query.categoryIds && request.query.categoryIds.length) {
        const categories = request.query.categoryIds.map(k => mongoose.Types.ObjectId(k));
        searchCriteria.categoryId = {$in: categories};
    }

    if (request.query.startDate) {
       searchCriteria.startDate = {$gte: new Date(request.query.startDate)}
    }

    searchCriteria.country = request.query.country;
    searchCriteria.isUnderReview = false;
    searchCriteria.isArchived = false;
    searchCriteria.isClosed = false;
    searchCriteria.isVisible = true;
    /*searchCriteria.isPremium = false;*/
    /* Added to show premium jobs as normal job in other cities */
    if (request.query.city) {
        searchCriteria['displayCities.city'] = {$ne: request.query.city};
    }

    /* Job type filtering if any */
    if (request.query.jobType) {
        searchCriteria.jobType = request.query.jobType;
    }

    /* Pay rate min/max filtering */
    if (request.query.salaryType) {
        searchCriteria['payRate.type'] = request.query.salaryType;
        searchCriteria['payRate.value'] = {$gte: request.query.payRateMin, $lte: request.query.payRateMax};
    }

    /* Filter based om internship */
    if (request.query.isInternship) {
        searchCriteria['isInternship'] = true;
    }

    /* Check if the job is exposed to this user */
    if (userData) {
        searchCriteria['$or'] = [{isExposedToAll: true}, {exposedTo: userData.paId}, {$and: [{isExposedToCommunity: true}, {membership: userData.membership}]}];
    }

    /* If partner or group parameter is present */
    let ids = [];
    if (request.query.type === 'partner') {
        if (!userData.membership && !userData.additionalMemberships.length) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not a part of any community.', 'error', 400)).code(400);
        }
        if (userData && userData.isMaster) {
            ids = ids.concat(userData.slaveUsers);
        } else {
            ids = ids.concat(userData.slaveUsers)
        }
        searchCriteria['userId'] = {$nin: ids};
    } else if (request.query.type === 'group') {
        let members;
        /* Get members of groups */
        try {
            members = await groupSchema.groupSchema.find({userId: mongoose.Types.ObjectId(request.query.userId), isActive: true}, {members: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding groups in get jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        for (let i = 0; i < members.length; i++) {
            members[i].members = members[i].members.map(k => k.toString());
            ids = commonFunctions.Handlers.arrayUnique(ids, members[i].members);
        }

        ids = ids.map(k => mongoose.Types.ObjectId(k));
        searchCriteria['userId'] = {$in: ids};
    }

    if (request.query.radius && !request.query.isEverywhere) {
        aggregationCriteria.push({
            $geoNear: {
                near: {
                    type: 'Point',
                    coordinates: [Number(request.query.longitude), Number(request.query.latitude)]
                },
                key: 'location',
                distanceField: 'distance',
                maxDistance: (request.query.radius ? request.query.radius : (constantData ? constantData.filterRadius: 50)) * 1609.34,
                spherical: true,
                query: searchCriteria
            }
        });
    } else {
        aggregationCriteria.push({
            $geoNear: {
                near: {
                    type: 'Point',
                    coordinates: [Number(request.query.longitude), Number(request.query.latitude)]
                },
                key: 'location',
                distanceField: 'distance',
                spherical: true,
                query: searchCriteria
            }
        })
    }

    if (request.query.sortCriteria && request.query.sortCriteria.toLowerCase() === 'distance') {
        if (request.query.sortType.toLowerCase() === 'desc') {
            aggregationCriteria.push({$sort: {
                distance: -1
            }});
        } else {
            aggregationCriteria.push({$sort: {createdAt: -1}});
        }
    } else if (request.query.sortCriteria && request.query.sortCriteria.toLowerCase() === 'latest') {
        aggregationCriteria.push({$sort: {createdAt: request.query.sortType.toLowerCase() === 'desc' ? 1 : -1}});
    } else {
        aggregationCriteria.push({$sort: {createdAt: -1}});
    }

    if (request.query.languageIds && request.query.languageIds.length) {
        let criteria = {$match: {$or: []}};
        for (let i = 0 ; i < request.query.languageIds.length; i++) {
            criteria.$match.$or.push(
                {
                    translatedLanguage: mongoose.Types.ObjectId(request.query.languageIds[i])
                }
            );
        }
        aggregationCriteria.push(criteria);
    } else {
        if (englishLanguage) {
            aggregationCriteria.push({
                $match: {
                    translatedLanguage: englishLanguage._id
                }
            });
        }
    }

    /* Define aggregation criteria based on location, radius and active flag of categories and subcategories */
    aggregationCriteria.push(
        {
            $lookup: {
                from: 'User',
                localField: 'userId',
                foreignField: '_id',
                as: 'user'
            }
        },
        {
            $unwind: '$user'
        },
        {
            $lookup: {
                from: 'Category',
                localField: 'categoryId',
                foreignField: '_id',
                as: 'category'
            }
        },
        {
            $unwind: '$category'
        },
        {
            $match: {
                'category.isActive': true
            }
        }
    );

    /* New criteria for preference screen */
    if (userData) {
       /* if (userData.membership) {
            aggregationCriteria.push({
                $match: {
                    $or: [{'user.membership': userData.membership}, {'user.additionalMemberships': mongoose.Types.ObjectId(userData.membership)}]
                }
            });
        }*/

       if (request.query.categoryIds && !request.query.categoryIds.length) {
           if (userData.employeeInformation.preference && userData.employeeInformation.preference.length && !request.query.searchText) {
               aggregationCriteria.push({
                   $match: {
                       $or: [
                           {
                               categoryId: {$in: userData.employeeInformation.preference}
                           },
                           {
                               skillsLower: {$in: userData.employeeInformation.skillsLower}
                           },
                           {
                               'category.tags': {$in: userData.employeeInformation.skillsLower}
                           }
                       ]
                   }
               });
           }
       }
    }

    if (request.query.userId) {
        aggregationCriteria.push({$match: {'user.blockedBy': {$nin: [mongoose.Types.ObjectId(request.query.userId)]}, userId: {$ne: mongoose.Types.ObjectId(request.query.userId)}}});
    }

    /* Check if memberships are provided */
    if (request.query.memberships && request.query.memberships.length) {
        aggregationCriteria.push({$match: {'user.membership': {$in: request.query.memberships}}});
    }

    /* With keywords provided */
    if (request.query.keywords) {
        let criteria ;
        if (request.query.isAny) {
            criteria = {$match: {$or: []}};
            for (let i = 0; i < request.query.keywords.length; i++) {
                criteria.$match.$or.push(
                    {
                        skillsLower: {$all: [new RegExp(request.query.keywords[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                    },
                    {
                        jobDescriptionText: {$all: [new RegExp(request.query.keywords[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                    },
                    {
                        jobTitle: {$all: [new RegExp(request.query.keywords[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                    }
                );
            }
        } else {
            criteria = {$match: {$and: []}};
            for (let i = 0; i < request.query.keywords.length; i++) {
                criteria.$match.$and.push({$or: [
                        {
                            skillsLower: {$all: [new RegExp(request.query.keywords[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                        },
                        {
                            jobDescriptionText: {$all: [new RegExp(request.query.keywords[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                        },
                        {
                            jobTitle: {$all: [new RegExp(request.query.keywords[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                        }
                    ]});
            }
        }
        aggregationCriteria.push(criteria);
    }

    /* With shift provided */
    if (request.query.shift) {
        let criteria = {$match: {$or: []}};
        for (let i = 0; i < request.query.shift.length; i++) {
            criteria.$match.$or.push({shift: new RegExp(request.query.shift[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')})
        }
        aggregationCriteria.push(criteria);
    }

    /* If work from home parameter is provided */
    if (request.query.isWorkFromHome) {
        aggregationCriteria.push({$match: {isWorkFromHome: true}});
    }

    /* If interview start date time and end date time is given */
    if (request.query.isWalkInInterview) {
        aggregationCriteria.push({$match: {isWalkInInterview: true, interviewEndTime: {$gte: new Date()}}});
    }
    /*if (request.query.interviewStartDateTime && request.query.interviewEndDateTime) {
        aggregationCriteria.push({
            $match: {
                isWalkInInterview: true,
                $or: [
                    {
                        $and: [{interviewEndDateTime: {$gte: new Date(request.query.interviewStartDateTime)}},
                            {interviewStartDateTime: {$lte: new Date(request.query.interviewStartDateTime)}}
                        ]
                    },
                    {
                        $and: [{interviewEndDateTime: {$gte: new Date(request.query.interviewEndDateTime)}},
                            {interviewStartDateTime: {$lte: new Date(request.query.interviewEndDateTime)}}
                        ]
                    },
                    {
                        $and: [{interviewStartDateTime: {$gte: new Date(request.query.interviewStartDateTime)}},
                            {interviewEndDateTime: {$lte: new Date(request.query.interviewEndDateTime)}},
                        ]
                    }
                    ]
            }});
    }*/

    /* Filters for jobs ( Last 24 hrs / 7 days / 30 days / all ) */
    if (request.query.filterCriteria && (request.query.filterCriteria === '24hr')) {
        aggregationCriteria.push({$match: {createdAt: {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(24, 'hours').toISOString())}}});
    } else if (request.query.filterCriteria && (request.query.filterCriteria === '7d')) {
        aggregationCriteria.push({$match: {createdAt: {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(7, 'days').toISOString())}}});
    } else if (request.query.filterCriteria && (request.query.filterCriteria === '30d')) {
        aggregationCriteria.push({$match: {createdAt: {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(30, 'days').toISOString())}}});
    }


    /* Define search criteria if searching */
    let facetCriteria = [];
    if (request.query.searchText) {
        let converted = [];
        converted.push(new RegExp((pluralize(request.query.searchText)).replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi'));
        converted.push(new RegExp((pluralize.singular(request.query.searchText)).replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi'));
        if (request.query.searchCriteria && request.query.searchCriteria.length) {
            if (typeof request.query.searchCriteria === 'string') {
                request.query.searchCriteria = JSON.parse(request.query.searchCriteria);
            }
            let matchCriteria = [];
            for (let i = 0; i < request.query.searchCriteria.length; i++) {
                if (request.query.searchCriteria[i].key && request.query.searchCriteria[i].key === 'jobTitle' && request.query.searchCriteria[i].isSelected) {
                    matchCriteria.push({jobTitle: {$in: converted}});
                    matchCriteria.push({subJobTitle: {$in: converted}});
                }
                if (request.query.searchCriteria[i].key && request.query.searchCriteria[i].key === 'skills' && request.query.searchCriteria[i].isSelected) {
                    matchCriteria.push({skills: {$in: converted}});
                }
                if (request.query.searchCriteria[i].key && request.query.searchCriteria[i].key === 'jobDescription' && request.query.searchCriteria[i].isSelected) {
                    matchCriteria.push({jobDescriptionText: {$in: converted}});
                }
            }
            aggregationCriteria.push({
                $match: {$or: matchCriteria}
            });
        } else {
            aggregationCriteria.push({$match: {
                    $or: [
                        {
                            jobTitle: {$in: converted}
                        },
                        {
                            subJobTitle: {$in: converted}
                        },
                        {
                            jobDescriptionText: {$in: converted}
                        },
                        {
                            skills: {$in: converted}
                        },
                        {
                            'user.employerInformation.companyName': {$in: converted}
                        }
                    ]
                }});
        }

        /* Save search text into collection */
        if (request.query.userId) {
            try {
                await searchSchema.searchSchema.findOneAndUpdate({userId: mongoose.Types.ObjectId(request.query.userId)}, {$push: {searchText: request.query.searchText}}, {upsert: true, lean: true});
            } catch (e) {
                logger.error('Error occurred while updating search collection for the user in get jobs handler %s ', JSON.stringify(e));
            }
        }
    }


    if (!request.query.isCompanyVerified) {
        facetCriteria.push({$skip: request.query.skip});
        facetCriteria.push({$limit: request.query.limit});

        facetCriteria.push({
            $lookup: {
                from: 'Verification',
                localField: 'user.employerInformation.verificationData',
                foreignField: '_id',
                as: 'verification'
            }
        });

        facetCriteria.push({
            $unwind: {
                path: '$verification',
                preserveNullAndEmptyArrays: true
            }
        });
    } else {
        aggregationCriteria.push({
            $lookup: {
                from: 'Verification',
                localField: 'user.employerInformation.verificationData',
                foreignField: '_id',
                as: 'verification'
            }
        });

        aggregationCriteria.push({
            $unwind: {
                path: '$verification',
                preserveNullAndEmptyArrays: true
            }
        });

        aggregationCriteria.push({
            $match: {
                'verification.status': 2
            }
        });

        facetCriteria.push({$skip: request.query.skip});
        facetCriteria.push({$limit: request.query.limit});
    }

    facetCriteria.push({
        $project: {
            _id: 1,
            userId: 1,
            payRate: 1,
            currency: 1,
            jobTitle: 1,
            subJobTitle: 1,
            startDate: 1,
            jobType: 1,
            totalViews: 1,
            uniqueViews: {$size: '$uniqueViews'},
            companyLogo: '$user.employerInformation.companyProfilePhoto',
            companyName: '$user.employerInformation.companyName',
            companyAddress1: '$address.address1',
            companyCity: '$address.city',
            companyState: '$address.state',
            companyZipCode: '$address.zipCode',
            companySubLocality: '$address.subLocality',
            latitude: {$arrayElemAt: ['$location.coordinates', 1]},
            longitude: {$arrayElemAt: ['$location.coordinates', 0]},
            isNegotiable: 1,
            phone: {
                $cond: [{$and: [{$eq: ["$isAddedByBulkUpload", true]}, {$eq: ["$hasOwned", false]}]}, "$employeeInformation.phone", ""]
            },
            countryCode: {
                $cond: [{$and: [{$eq: ["$isAddedByBulkUpload", true]}, {$eq: ["$hasOwned", false]}]}, "$employeeInformation.countryCode", ""]
            },
            isAddedByBulkUpload: 1,
            isCompanyWebsite: 1,
            companyWebsite: 1,
            isATS: 1,
            atsEmail: 1,
            createdAt: 1,
            membership: '$user.membership',
            companyVerified: '$verification.status',
            experienceInMonths: 1,
            jobDescriptionText: 1,
            jobDescriptionVideo: 1,
            country: 1
        }
    });

    aggregationCriteria.push({
        $facet: {
            jobs: facetCriteria,
            count: [
                {
                    $count: 'count'
                }
            ]
        }
    });

   try {
       jobs = await jobsSchema.jobSchema.aggregate(aggregationCriteria).allowDiskUse(true);
   } catch (e) {
        console.log(e);
       logger.error('Error occurred while getting all jobs in get jobs handler %s:', JSON.stringify(e));
       return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
   }

    if (jobs[0] && jobs[0].count) {
        totalCount = jobs[0].count[0]? jobs[0].count[0].count : 0;
        jobs = jobs[0].jobs;
    }

    /* Fetch all the items in the favourite list of the user and update the jobs data */
    if (request.query.userId) {
        try {
            favourites = await favouriteSchema.favouriteSchema.find({userId: mongoose.Types.ObjectId(request.query.userId)}, {jobId: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting all favourite list jobs in get jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (favourites && favourites.length) {
            for (let i = 0; i < jobs.length; i++) {
                const idx = favourites.findIndex(j => j.jobId.toString() === jobs[i]._id.toString());
                jobs[i]['isFavourite'] = (idx !== -1);
            }
        }
    }

    let memberships = [];
    for (let i = 0; i < jobs.length; i++) {
        /* Find memberships logo */
        if (jobs[i].membership) {
            const idx = memberships.findIndex(k => k._id === jobs[i].membership.toString());
            if (idx === -1) {
                let admin;
                try {
                    admin = await userSchema.UserSchema.findOne({isPaAdmin: true, membership: jobs[i].membership}, {employerInformation: 1}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding membership logo in get candidates handler %s:', JSON.stringify(e));
                }
                if (admin) {
                    memberships.push({_id: jobs[i].membership.toString(), photo: admin.employerInformation.companyProfilePhoto});
                    jobs[i].membershipLogo = admin.employerInformation.companyProfilePhoto;
                }
            } else {
                jobs[i].membershipLogo = memberships[idx].photo;
            }
        }
    }

    /* Check whether the user has already applied to the job or not */
    let conversations;
    if (request.query.userId) {
        try {
            conversations = await conversationSchema.conversationSchema.find({candidateId: mongoose.Types.ObjectId(request.query.userId)}, {jobId: 1, isApplied: 1, isInvited: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting all conversations pf candidates in get jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        for (let i = 0; i < jobs.length; i++) {
            const idx = conversations.findIndex(j => j.jobId.toString() === jobs[i]._id.toString());
            jobs[i]['isApplied'] = (idx !== -1);
        }
    }

    return h.response(responseFormatter.responseFormatter(jobs, 'Fetched successfully', 'success', 200, totalCount)).code(200);
};

userHandler.getFavouriteList = async (request, h) => {
    let decoded, checkUser, favourite, aggregationCriteria;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in get favourite list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get favourite list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Fetch all the listings from the favourite list for that user */
    if (request.query.searchText) {
        aggregationCriteria = [
            {
                $match: {
                    userId: mongoose.Types.ObjectId(request.query.userId),
                    isFavourite: true
                }
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: '$user'
            },
            {
                $lookup: {
                    from: 'Job',
                    localField: 'jobId',
                    foreignField: '_id',
                    as: 'job'
                }
            },
            {
                $unwind: '$job'
            },
            {
                $match: {
                    $or: [{'job.jobTitle': new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {'job.subJobTitle': {$all: [new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}}, {'user.employerInformation.companyName': new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}]
                }
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'job.userId',
                    foreignField: '_id',
                    as: 'employer'
                }
            },
            {
                $unwind: '$employer'
            }
        ];
        /* If category is provided */
        if (request.query.categoryId) {
            aggregationCriteria.push({$match: {'job.categoryId': mongoose.Types.ObjectId(request.query.categoryId)}});
        }

        /* If job type is provided */
        if (request.query.jobType) {
            aggregationCriteria.push({$match: {'job.jobType': request.query.jobType}});
        }

        /* If pay rate range is provided */
        if (request.query.payRateMin || request.query.payRateMax) {
            aggregationCriteria.push({$match: {'job.payRate.value': {$gt: request.query.payRateMin, $lt: request.query.payRateMax}}});
        }

        /* If filter criteria is provided */
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === '24hr') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(24, 'hours').toISOString())}}});
            } else if (request.query.filterCriteria === '7d') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(7, 'days').toISOString())}}});
            } else if (request.query.filterCriteria === '30d') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(30, 'days').toISOString())}}});
            }
        }

        aggregationCriteria.push({$sort: {_id: -1}});
        aggregationCriteria.push({$skip: request.query.skip});
        aggregationCriteria.push({$limit: request.query.limit});
        aggregationCriteria.push({
            $project: {
                _id: 1,
                jobId: '$job._id',
                userId: '$employer._id',
                payRate: '$job.payRate',
                currency: '$job.currency',
                jobTitle: '$job.jobTitle',
                subJobTitle: '$job.subJobTitle',
                jobDescriptionVideo: '$job.jobDescriptionVideo',
                startDate: '$job.startDate',
                jobType: '$job.jobType',
                experienceInMonths: '$job.experienceInMonths',
                totalViews: '$job.totalViews',
                uniqueViews: {$size: '$job.uniqueViews'},
                companyLogo: '$employer.employerInformation.companyProfilePhoto',
                companyName: '$employer.employerInformation.companyName',
                companyCity: '$job.address.city',
                companyState: '$job.address.state',
                subLocality: '$job.address.subLocality',
                latitude: {$arrayElemAt: ['$job.location.coordinates', 1]},
                longitude: {$arrayElemAt: ['$job.location.coordinates', 0]},
                isNegotiable: '$job.isNegotiable',
                isCompanyWebsite: '$job.isCompanyWebsite',
                companyWebsite: '$job.companyWebsite',
                isATS: '$job.isATS',
                atsEmail: '$job.atsEmail',
                country: '$job.country',
                createdAt: '$job.createdAt'
            }
        });
    } else {
        aggregationCriteria = [
            {
                $match: {
                    userId: mongoose.Types.ObjectId(request.query.userId),
                    isFavourite: true
                }
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: '$user'
            },
            {
                $lookup: {
                    from: 'Job',
                    localField: 'jobId',
                    foreignField: '_id',
                    as: 'job'
                }
            },
            {
                $unwind: '$job'
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'job.userId',
                    foreignField: '_id',
                    as: 'employer'
                }
            },
            {
                $unwind: '$employer'
            }
        ];
        /* If category is provided */
        if (request.query.categoryId) {
            aggregationCriteria.push({$match: {'job.categoryId': mongoose.Types.ObjectId(request.query.categoryId)}});
        }

        /* If job type is provided */
        if (request.query.jobType) {
            aggregationCriteria.push({$match: {'job.jobType': request.query.jobType}});
        }

        /* If pay rate range is provided */
        if (request.query.payRateMin || request.query.payRateMax) {
            aggregationCriteria.push({$match: {'job.payRate.value': {$gt: request.query.payRateMin, $lt: request.query.payRateMax}}});
        }

        /* If filter criteria is provided */
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === '24hr') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(24, 'hours').toISOString())}}});
            } else if (request.query.filterCriteria === '7d') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(7, 'days').toISOString())}}});
            } else if (request.query.filterCriteria === '30d') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(30, 'days').toISOString())}}});
            }
        }

        aggregationCriteria.push({$sort: {_id: -1}});
        aggregationCriteria.push({$skip: request.query.skip});
        aggregationCriteria.push({$limit: request.query.limit});
        aggregationCriteria.push({
            $project: {
                _id: 1,
                jobId: '$job._id',
                userId: '$employer._id',
                payRate: '$job.payRate',
                currency: '$job.currency',
                jobTitle: '$job.jobTitle',
                subJobTitle: '$job.subJobTitle',
                jobDescriptionVideo: '$job.jobDescriptionVideo',
                startDate: '$job.startDate',
                jobType: '$job.jobType',
                experienceInMonths: '$job.experienceInMonths',
                totalViews: '$job.totalViews',
                uniqueViews: {$size: '$job.uniqueViews'},
                companyLogo: '$employer.employerInformation.companyProfilePhoto',
                companyName: '$employer.employerInformation.companyName',
                companyCity: '$job.address.city',
                companyState: '$job.address.state',
                subLocality: '$job.address.subLocality',
                latitude: {$arrayElemAt: ['$job.location.coordinates', 1]},
                longitude: {$arrayElemAt: ['$job.location.coordinates', 0]},
                isNegotiable: '$job.isNegotiable',
                isCompanyWebsite: '$job.isCompanyWebsite',
                companyWebsite: '$job.companyWebsite',
                isATS: '$job.isATS',
                atsEmail: '$job.atsEmail',
                country: '$job.country',
                createdAt: '$job.createdAt'
            }
        });
    }

    try {
        favourite = await favouriteSchema.favouriteSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred fetching favourite list in get favourite list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    let jobs = [];
    for (let i = 0; i < favourite.length; i++) {
        jobs.push(favourite[i]);
        jobs[i].isFavourite = true;
    }

    /* Check whether the user has already applied to the job or not */
    let conversations;
    if (request.query.userId) {
        try {
            conversations = await conversationSchema.conversationSchema.find({candidateId: mongoose.Types.ObjectId(request.query.userId)}, {jobId: 1, isApplied: 1, isInvited: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting all conversations pf candidates in get jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        for (let i = 0; i < jobs.length; i++) {
            const idx = conversations.findIndex(j => j.jobId.toString() === jobs[i].jobId.toString());
            jobs[i]['isApplied'] = (idx !== -1);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(jobs, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getArchivedList = async (request, h) => {
    let decoded, checkUser, archived, aggregationCriteria;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in get archived list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get archived list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get list of all archived job by user */
    aggregationCriteria = [
        {
            $match: {candidateId: mongoose.Types.ObjectId(request.query.userId), isHired: true}
        },
        {
            $lookup: {
                from: 'User',
                localField: 'candidateId',
                foreignField: '_id',
                as: 'candidate'
            }
        },
        {
            $unwind: '$candidate'
        },
        {
            $lookup: {
                from: 'User',
                localField: 'employerId',
                foreignField: '_id',
                as: 'employer'
            }
        },
        {
            $unwind: '$employer'
        },
        {
            $lookup: {
                from: 'Job',
                localField: 'jobId',
                foreignField: '_id',
                as: 'job'
            }
        },
        {
            $unwind: '$job'
        }
    ];

    /* If category id is given */
    if (request.query.categoryId) {
        aggregationCriteria.push({$match: {'job.categoryId': mongoose.Types.ObjectId(request.query.categoryId)}});
    }

    /* If category ids are given */
    if (request.query.categoryIds && request.query.categoryIds.length) {
        const categories = request.query.categoryIds.map(k => mongoose.Types.ObjectId(k));
        aggregationCriteria.push({$match: {'job.categoryId': {$in: categories}}});
    }

    /* If search text is given */
    if (request.query.searchText) {
        aggregationCriteria.push({$match: {$or:
                    [
                        {
                            'job.jobDescriptionText': {$all: [new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                        },
                        {
                            'job.jobTitle': {$all: [new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                        }
                    ]
            }});
    }

    aggregationCriteria.push({$skip: request.query.skip});
    aggregationCriteria.push({$limit: request.query.limit});
    aggregationCriteria.push({
        $project: {
            _id: 1,
            userId: '$candidateId',
            payRate: '$job.payRate',
            currency: '$job.currency',
            startDate: '$job.startDate',
            jobType: '$job.jobType',
            totalViews: '$job.totalViews',
            uniqueViews: {$size: '$job.uniqueViews'},
            companyLogo: '$employer.employerInformation.companyProfilePhoto',
            companyName: '$employer.employerInformation.companyName',
            companyCity: '$job.address.city',
            companyState: '$job.address.state',
            jobTitle: '$job.jobTitle',
            subJobTitle: '$job.subJobTitle',
            isExpired: '$job.isExpired',
            jobId: '$job._id',
            isHired: {$in: [mongoose.Types.ObjectId(request.query.userId), '$job.hiredId']},
            isRejected: 1,
            country: '$job.country',
            createdAt: '$job.createdAt'
        }
    });
    try {
        archived = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred aggregating on conversations in get archived list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(archived, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.updateNotifications = async (request, h) => {
    let decoded, checkUser, updateCriteria, updatedData;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in update notifications handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in update notifications handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Define update criteria according to payload */
    updateCriteria = {
        $set: {notifications: request.payload}
    };
    try {
        updatedData = await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, updateCriteria, {lean: true, new: true});
    } catch (e) {
        logger.error('Error occurred updating privacy settings in update notifications handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (updatedData) {
        delete updatedData.password;
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(updatedData, 'Preference updated', 'success', 204)).code(200);
};

userHandler.autocomplete = async (request, h) => {
    let result, aggregationCriteria;

    /* Define aggregation criteria based on parameters */
    if (request.query.skill) {
        const text = toTitleCase(request.query.text);

        result = await getAutocomplete(text, 'trie:');

        result = result.length ? result : ['Others'];

        return h.response(responseFormatter.responseFormatter(result, 'Fetched successfully', 'success', 200)).code(200);

    } else if (request.query.university) {
        /*aggregationCriteria = [
            {
                $match: {isUniversity: true}
            },
            {
                $unwind: '$universities'
            },
            {
                $match: {
                    universities: new RegExp(request.query.text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                }
            }
        ];*/
        const text = toTitleCase(request.query.text);

        result = await getAutocomplete(text, 'trieCollege:');
        result = result.length ? result : ['Others'];

        return h.response(responseFormatter.responseFormatter(result, 'Fetched successfully', 'success', 200)).code(200);
    } else if (request.query.major) {
        aggregationCriteria = [
            {
                $match: {isMajor: true}
            },
            {
                $unwind: '$majors'
            },
            {
                $match: {
                    majors: new RegExp(request.query.text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                }
            },
            {
                $limit: 10
            }
        ];
    } else if (request.query.jobTitle) {
        let temp;
        try {
            temp = await jobTitleSchema.jobTitleSchema.find({$text: {$search: request.query.text}}, {score: {$meta: 'textScore'}}).sort({score: {$meta: 'textScore'}}).limit(10);
        } catch (e) {
            logger.error('Error occurred finding job title in auto complete handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        result = temp.map(k => k.jobTitle);

        return h.response(responseFormatter.responseFormatter(result, 'Fetched successfully', 'success', 200)).code(200);
    }

    try {
        result = await searchSuggestionSchema.searchSuggestionSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred aggregating in auto complete handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(result, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.changePrivacy = async (request, h) => {
    let decoded, checkUser, updatedData;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in change privacy handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in change privacy handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Update user privacy information */
    try {
        updatedData = await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$set: {privacyType: request.payload.privacyType}}, {lean: true, new: true});
    } catch (e) {
        logger.error('Error occurred updating user data in change privacy handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(updatedData, 'Privacy preference updated', 'success', 204)).code(200);
};

userHandler.getAppliedList = async (request, h) => {
    let decoded, checkUser, applied, aggregationCriteria;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in get applied list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get applied list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Fetch all the listings from the favourite list for that user */
    if (request.query.searchText) {
        aggregationCriteria = [
            {
                $match: {
                    candidateId: mongoose.Types.ObjectId(request.query.userId),
                    isArchived: false,
                    isRejected: false,
                    isApplied: true,
                    isHired: false,
                    paId: {$ne: '$employerId'}
                }
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'candidateId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: '$user'
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'employerId',
                    foreignField: '_id',
                    as: 'employer'
                }
            },
            {
                $unwind: '$employer'
            },
            {
                $lookup: {
                    from: 'Job',
                    localField: 'jobId',
                    foreignField: '_id',
                    as: 'job'
                }
            },
            {
                $unwind: '$job'
            },
            {
                $match: {
                    $or: [{'job.jobTitle': new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {'job.subJobTitle': {$all: [new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}}, {'user.employerInformation.companyName': new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}]
                }
            },
            {
                $lookup: {
                    from: 'Favourite',
                    let: {userId: "$candidateId", jobId: "$jobId"},
                    pipeline: [
                        {$match: {$expr: {$and: [{$eq: ["$userId", "$$userId"]}, {$eq: ["$jobId", "$$jobId"]}]}}}
                    ],
                    as: 'fav'
                }
            },
            {
                $unwind: {
                    path: '$fav',
                    preserveNullAndEmptyArrays: true
                }
            }
        ];

        /* If category is provided */
        if (request.query.categoryId) {
            aggregationCriteria.push({$match: {'job.categoryId': mongoose.Types.ObjectId(request.query.categoryId)}});
        }

        /* If categories are provided */
        if (request.query.categoryIds && request.query.categoryIds.length) {
            const categories = request.query.categoryIds.map(k => mongoose.Types.ObjectId(k));
            aggregationCriteria.push({$match: {'job.categoryId': {$in: categories}}});
        }

        /* If job type is provided */
        if (request.query.jobType) {
            aggregationCriteria.push({$match: {'job.jobType': request.query.jobType}});
        }

        /* If pay rate range is provided */
        if (request.query.payRateMin || request.query.payRateMax) {
            aggregationCriteria.push({$match: {'job.payRate.value': {$gt: request.query.payRateMin, $lt: request.query.payRateMax}}});
        }

        /* If filter criteria is provided */
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === '24hr') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(24, 'hours').toISOString())}}});
            } else if (request.query.filterCriteria === '7d') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(7, 'days').toISOString())}}});
            } else if (request.query.filterCriteria === '30d') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(30, 'days').toISOString())}}});
            }
        }

        aggregationCriteria.push({$sort: {_id: -1}});
        aggregationCriteria.push({$skip: request.query.skip});
        aggregationCriteria.push({$limit: request.query.limit});
        aggregationCriteria.push({
            $project: {
                _id: 1,
                userId: '$employer._id',
                jobId: '$job._id',
                payRate: '$job.payRate',
                currency: '$job.currency',
                jobTitle: '$job.jobTitle',
                subJobTitle: '$job.subJobTitle',
                jobDescriptionVideo: '$job.jobDescriptionVideo',
                experienceInMonths: '$job.experienceInMonths',
                startDate: '$job.startDate',
                jobType: '$job.jobType',
                totalViews: '$job.totalViews',
                uniqueViews: {$size: '$job.uniqueViews'},
                companyLogo: '$employer.employerInformation.companyProfilePhoto',
                companyName: '$employer.employerInformation.companyName',
                companyCity: '$job.address.city',
                companyState: '$job.address.state',
                subLocality: '$job.address.subLocality',
                latitude: {$arrayElemAt: ['$job.location.coordinates', 1]},
                longitude: {$arrayElemAt: ['$job.location.coordinates', 0]},
                isNegotiable: '$job.isNegotiable',
                phone: {
                    $cond: [{$eq: ['$user.employeeInformation.receiveCalls', true]}, '$user.employeeInformation.countryCode', '']
                },
                countryCode: {
                    $cond: [{$eq: ['$user.employeeInformation.receiveCalls', true]}, '$user.employeeInformation.phone', '']
                },
                country: '$job.country',
                createdAt: '$job.createdAt',
                isFavourite: {
                    $cond: [{$eq: ['$fav.userId', mongoose.Types.ObjectId(request.query.userId)]}, true, false]
                }
            }
        });
    } else {
        aggregationCriteria = [
            {
                $match: {
                    candidateId: mongoose.Types.ObjectId(request.query.userId),
                    isArchived: false,
                    isRejected: false,
                    isApplied: true,
                    isHired: false,
                    paId: {$ne: '$employerId'}
                }
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'candidateId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: '$user'
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'employerId',
                    foreignField: '_id',
                    as: 'employer'
                }
            },
            {
                $unwind: '$employer'
            },
            {
                $lookup: {
                    from: 'Job',
                    localField: 'jobId',
                    foreignField: '_id',
                    as: 'job'
                }
            },
            {
                $unwind: '$job'
            },
            {
                $lookup: {
                    from: 'Favourite',
                    let: {userId: "$candidateId", jobId: "$jobId"},
                    pipeline: [
                        {$match: {$expr: {$and: [{$eq: ["$userId", "$$userId"]}, {$eq: ["$jobId", "$$jobId"]}]}}}
                    ],
                    as: 'fav'
                }
            },
            {
                $unwind: {
                    path: '$fav',
                    preserveNullAndEmptyArrays: true
                }
            }
        ];

        /* If category is provided */
        if (request.query.categoryId) {
            aggregationCriteria.push({$match: {'job.categoryId': mongoose.Types.ObjectId(request.query.categoryId)}});
        }

        /* If job type is provided */
        if (request.query.jobType) {
            aggregationCriteria.push({$match: {'job.jobType': request.query.jobType}});
        }

        /* If pay rate range is provided */
        if (request.query.payRateMin && request.query.payRateMax) {
            aggregationCriteria.push({$match: {'job.payRate.value': {$gt: request.query.payRateMin, $lt: request.query.payRateMax}}});
        }

        /* If filter criteria is provided */
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === '24hr') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(24, 'hours').toISOString())}}});
            } else if (request.query.filterCriteria === '7d') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(7, 'days').toISOString())}}});
            } else if (request.query.filterCriteria === '30d') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(30, 'days').toISOString())}}});
            }
        }

        aggregationCriteria.push({$sort: {_id: -1}});
        aggregationCriteria.push({$skip: request.query.skip});
        aggregationCriteria.push({$limit: request.query.limit});
        aggregationCriteria.push({
            $project: {
                _id: 1,
                jobId: '$job._id',
                userId: '$employer._id',
                payRate: '$job.payRate',
                currency: '$job.currency',
                jobTitle: '$job.jobTitle',
                subJobTitle: '$job.subJobTitle',
                jobDescriptionVideo: '$job.jobDescriptionVideo',
                experienceInMonths: '$job.experienceInMonths',
                startDate: '$job.startDate',
                jobType: '$job.jobType',
                totalViews: '$job.totalViews',
                uniqueViews: {$size: '$job.uniqueViews'},
                companyLogo: '$employer.employerInformation.companyProfilePhoto',
                companyName: '$employer.employerInformation.companyName',
                companyCity: '$job.address.city',
                companyState: '$job.address.state',
                subLocality: '$job.address.subLocality',
                latitude: {$arrayElemAt: ['$job.location.coordinates', 1]},
                longitude: {$arrayElemAt: ['$job.location.coordinates', 0]},
                isNegotiable: '$job.isNegotiable',
                receiveCalls: '$user.employeeInformation.receiveCalls',
                phone: {
                    $cond: [{$eq: ['$user.employeeInformation.receiveCalls', true]}, '$user.employeeInformation.countryCode', '']
                },
                countryCode: {
                    $cond: [{$eq: ['$user.employeeInformation.receiveCalls', true]}, '$user.employeeInformation.phone', '']
                },
                country: '$job.country',
                createdAt: '$job.createdAt',
                isFavourite: {
                    $cond: [{$eq: ['$fav.userId', mongoose.Types.ObjectId(request.query.userId)]}, true, false]
                }
            }
        });
    }

    try {
        applied = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred fetching applied list in get favourite list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(applied, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getInvitedList = async (request, h) => {
    let decoded, checkUser, invited, aggregationCriteria;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in get invited list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get invited list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Fetch all the listings from the favourite list for that user */
    if (request.query.searchText) {
        aggregationCriteria = [
            {
                $match: {
                    candidateId: mongoose.Types.ObjectId(request.query.userId),
                    isInvitationRejected: false,
                    isArchived: false,
                    isRejected: false,
                    isInvited: true,
                    isApplied: false,
                    isHired: false
                }
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'employerId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: '$user'
            },
            {
                $lookup: {
                    from: 'Job',
                    localField: 'jobId',
                    foreignField: '_id',
                    as: 'job'
                }
            },
            {
                $unwind: '$job'
            },
            {
                $match: {
                    $or: [{'job.jobTitle': new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {'job.subJobTitle': {$all: [new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}}, {'user.employerInformation.companyName': new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}]
                }
            },
            {
                $lookup: {
                    from: 'Favourite',
                    let: {userId: "$candidateId", jobId: "$jobId"},
                    pipeline: [
                        {$match: {$expr: {$and: [{$eq: ["$userId", "$$userId"]}, {$eq: ["$jobId", "$$jobId"]}]}}}
                    ],
                    as: 'fav'
                }
            },
            {
                $unwind: {
                    path: '$fav',
                    preserveNullAndEmptyArrays: true
                }

            }
        ];
        /* If category is provided */
        if (request.query.categoryId) {
            aggregationCriteria.push({$match: {'job.categoryId': mongoose.Types.ObjectId(request.query.categoryId)}});
        }

        /* If categories are provided */
        if (request.query.categoryIds && request.query.categoryIds.length) {
            const categories = request.query.categoryIds.map(k => mongoose.Types.ObjectId(k));
            aggregationCriteria.push({$match: {'job.categoryId': {$in: categories}}});
        }

        /* If job type is provided */
        if (request.query.jobType) {
            aggregationCriteria.push({$match: {'job.jobType': request.query.jobType}});
        }

        /* If pay rate range is provided */
        if (request.query.payRateMin || request.query.payRateMax) {
            aggregationCriteria.push({$match: {'job.payRate.value': {$gt: request.query.payRateMin, $lt: request.query.payRateMax}}});
        }

        /* If filter criteria is provided */
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === '24hr') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(24, 'hours').toISOString())}}});
            } else if (request.query.filterCriteria === '7d') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(7, 'days').toISOString())}}});
            } else if (request.query.filterCriteria === '30d') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(30, 'days').toISOString())}}});
            }
        }

        aggregationCriteria.push({$skip: request.query.skip});
        aggregationCriteria.push({$limit: request.query.limit});
        aggregationCriteria.push({
            $project: {
                _id: 1,
                jobId: '$job._id',
                userId: '$user._id',
                payRate: '$job.payRate',
                currency: '$job.currency',
                jobTitle: '$job.jobTitle',
                subJobTitle: '$job.subJobTitle',
                jobDescriptionVideo: '$job.jobDescriptionVideo',
                startDate: '$job.startDate',
                jobType: '$job.jobType',
                totalViews: '$job.totalViews',
                uniqueViews: {$size: '$job.uniqueViews'},
                companyLogo: '$user.employerInformation.companyProfilePhoto',
                companyName: '$user.employerInformation.companyName',
                companyCity: '$job.address.city',
                companyState: '$job.address.state',
                subLocality: '$job.address.subLocality',
                isNegotiable: '$job.isNegotiable',
                country: '$job.country',
                createdAt: '$job.createdAt',
                isFavourite: {
                    $cond: [{$eq: ['$fav.userId', mongoose.Types.ObjectId(request.query.userId)]}, true, false]
                }
            }
        });
    } else {
        aggregationCriteria = [
            {
                $match: {
                    candidateId: mongoose.Types.ObjectId(request.query.userId),
                    isInvitationRejected: false,
                    isArchived: false,
                    isRejected: false,
                    isInvited: true,
                    isApplied: false,
                    isHired: false
                }
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'employerId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: '$user'
            },
            {
                $lookup: {
                    from: 'Job',
                    localField: 'jobId',
                    foreignField: '_id',
                    as: 'job'
                }
            },
            {
                $unwind: '$job'
            },
            {
                $lookup: {
                    from: 'Favourite',
                    let: {userId: "$candidateId", jobId: "$jobId"},
                    pipeline: [
                        {$match: {$expr: {$and: [{$eq: ["$userId", "$$userId"]}, {$eq: ["$jobId", "$$jobId"]}]}}}
                    ],
                    as: 'fav'
                }
            },
            {
                $unwind: {
                    path: '$fav',
                    preserveNullAndEmptyArrays: true
                }

            }
        ];
        /* If category is provided */
        if (request.query.categoryId) {
            aggregationCriteria.push({$match: {'job.categoryId': mongoose.Types.ObjectId(request.query.categoryId)}});
        }

        /* If job type is provided */
        if (request.query.jobType) {
            aggregationCriteria.push({$match: {'job.jobType': request.query.jobType}});
        }

        /* If pay rate range is provided */
        if (request.query.payRateMin && request.query.payRateMax) {
            aggregationCriteria.push({$match: {'job.payRate.value': {$gt: request.query.payRateMin, $lt: request.query.payRateMax}}});
        }

        /* If filter criteria is provided */
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === '24hr') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(24, 'hours').toISOString())}}});
            } else if (request.query.filterCriteria === '7d') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(7, 'days').toISOString())}}});
            } else if (request.query.filterCriteria === '30d') {
                aggregationCriteria.push({$match: {'job.createdAt': {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(30, 'days').toISOString())}}});
            }
        }

        aggregationCriteria.push({$skip: request.query.skip});
        aggregationCriteria.push({$limit: request.query.limit});
        aggregationCriteria.push({
            $project: {
                _id: 1,
                jobId: '$job._id',
                userId: '$user._id',
                payRate: '$job.payRate',
                currency: '$job.currency',
                jobTitle: '$job.jobTitle',
                subJobTitle: '$job.subJobTitle',
                startDate: '$job.startDate',
                jobType: '$job.jobType',
                jobDescriptionVideo: '$job.jobDescriptionVideo',
                totalViews: '$job.totalViews',
                uniqueViews: {$size: '$job.uniqueViews'},
                companyLogo: '$user.employerInformation.companyProfilePhoto',
                companyName: '$user.employerInformation.companyName',
                companyCity: '$job.address.city',
                companyState: '$job.address.state',
                subLocality: '$job.address.subLocality',
                isNegotiable: '$job.isNegotiable',
                country: '$job.country',
                createdAt: '$job.createdAt',
                isFavourite: {
                    $cond: [{$eq: ['$fav.userId', mongoose.Types.ObjectId(request.query.userId)]}, true, false]
                }
            }
        });
    }
    try {
        invited = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred fetching applied list in get favourite list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(invited, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getChatStatus = async (request, h) => {
    let checkEmployer, checkCandidate, checkJob, conversations = {}, aggregationCriteria, sortedChats = {},
        arrayFilter, matchCriteria = {flag: true}, searchCriteria, status, userData, chat, shortLink,
        chatLanguage, isBlocked, isCandidateBlocked, constantData, blockEmployerFlag = false, pricingInfo;

    if (request.query.firstId) {
        matchCriteria = {
            'chats._id': {$lt: mongoose.Types.ObjectId(request.query.firstId)}
        };
    }

    /* Check whether seller is present in database or not */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: request.query.employerId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding employer information in get chat status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'Employer doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether buyer is present in database or not */
    try {
        checkCandidate = await userSchema.UserSchema.findById({_id: request.query.candidateId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding candidate information in get chat status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkCandidate) {
        return h.response(responseFormatter.responseFormatter({}, 'Candidate doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check if product is present in database or not */
    try {
        checkJob = await jobsSchema.jobSchema.findById({_id: request.query.jobId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding job information in get chat status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkJob) {
        return h.response(responseFormatter.responseFormatter({}, 'Job not found', 'error', 404)).code(404);
    } else if (checkJob.userId.toString() !== request.query.employerId) {
        return h.response(responseFormatter.responseFormatter({}, 'This job is posted by your added user. You can not start conversation with this candidate.', 'error', 400)).code(400);
    }

    /* Check the chat language of candidate */
    if (checkCandidate.chatLanguage) {
        try {
            chatLanguage = await languageSchema.languageSchema.findById({_id: checkCandidate.chatLanguage}, {language: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding language information in get chat status handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Get constant data */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {freeJobApplications: 1, freeJobExpiry: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding constant information in get chat status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Set all the chat messages of this user to isRead */
    searchCriteria = {
        candidateId: mongoose.Types.ObjectId(request.query.candidateId),
        employerId: mongoose.Types.ObjectId(request.query.employerId),
        jobId: mongoose.Types.ObjectId(request.query.jobId)
    };

    /* Check if employer is blocked */
    try {
        isBlocked = await userSchema.UserSchema.findOne({_id: mongoose.Types.ObjectId(request.query.employerId), blockedBy: {$in: [mongoose.Types.ObjectId(request.query.candidateId)]}}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user information in get chat details handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check if candidate is blocked */
    try {
        isCandidateBlocked = await userSchema.UserSchema.findOne({_id: mongoose.Types.ObjectId(request.query.candidateId), blockedBy: {$in: [mongoose.Types.ObjectId(request.query.employerId)]}}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user information in get chat details handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    try {
        status = await conversationSchema.conversationSchema.findOne(searchCriteria, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching chat information in get chat details handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check whether the conversation thread between employer and PA exists */
    let checkRequest, checkPa;

    try {
        checkRequest = await chatRequestSchema.chatRequestSchema.findOne({paId: checkCandidate.paId, jobId: checkJob._id, candidateId: checkCandidate._id, employerId: checkEmployer._id}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching chat request information in get chat details handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkCandidate.paId) {
        try {
            checkPa = await userSchema.UserSchema.findById({_id: checkCandidate.paId}, {deviceType: 1, deviceToken: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching pa information in get chat details handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    let checkPackage, checkSubscription;

    /* Check package of employer and if it is free then limit the number of applications for the job */
    if (checkEmployer.toObject().hasOwnProperty('subscriptionInfo')) {
        try {
            [checkPackage, checkSubscription] = await Promise.all([
                packageSchema.packageSchema.findById({_id: checkEmployer.subscriptionInfo.packageId}, {
                    isFree: 1,
                    country: 1
                }, {lean: true}),
                subscriptionSchema.subscriptionSchema.findById({_id: checkEmployer.subscriptionInfo.subscriptionId}, {}, {lean: true})
            ]);
        } catch (e) {
            logger.error('Error occurred while fetching employer package in get chat details handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        try {
            pricingInfo = await pricingSchema.pricingSchema.findOne({country: checkPackage.country}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching pricing information in get chat details handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    let flag = false;
    /* Check if chat already exists in case of invitation */
    if (request.query.role.toLowerCase() === 'employer') {
        let employerFlag = false;
        if (!checkCandidate.isExposedToAll && checkCandidate.paId && (checkCandidate.paId.toString() !== request.query.employerId)) {
            if (checkCandidate.exposedTo && checkCandidate.exposedTo.length) {
                const idx = checkCandidate.exposedTo.findIndex(k => k.toString() === checkEmployer._id.toString());
                if (idx === -1) {
                    employerFlag = true;
                }
            } else if (checkCandidate.isExposedToCommunity && checkCandidate.membership !== checkEmployer.membership) {
                employerFlag = true;
            } else {
                employerFlag = true;
            }
        }

        /* Check if this employer is free package employer */
        if (checkPackage && checkPackage.isFree) {
            /* Get total number of invitations and constant data */
            const tempIdx = constantData.freeJobExpiry.findIndex(k => k.country.toLowerCase() === checkEmployer.country.toLowerCase());
            if (tempIdx !== -1) {
                const days = constantData.freeJobExpiry[tempIdx].days;
                const isUnlimited = constantData.freeJobExpiry[tempIdx].isUnlimited;
                if (!isUnlimited) {
                    const today = new Date();
                    const diff = Math.floor((today - new Date(checkJob.createdAt)) / (1000 * 60 * 60 * 24));
                    if (diff > days) {
                        blockEmployerFlag = true;
                    }
                }
            }
        }

        if (employerFlag) {
            /* This candidate is not exposed to given employer */
            if (checkRequest && checkRequest.isRejected) {
                /* Update this chat request and set isRejectedFlag as false */
                try {
                    await chatRequestSchema.chatRequestSchema.findByIdAndUpdate({_id: checkRequest._id}, {$set: {isAccepted: false, isRejected: false}}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while updating chat request information in get chat details handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                /* Send push to PA with the request */
                const pushToSend = {
                    paId: checkRequest.paId,
                    jobId: checkRequest.jobId,
                    role: '',
                    pushType: 'chatRequest',
                    type: 'chatRequest'
                };
                push.createMessage(checkPa.deviceToken, [], pushToSend, checkPa.deviceType, 'Request', 'You have a new request from an employer.', 'beep', '', '');
                return h.response(responseFormatter.responseFormatter({}, 'This candidate\'s recruiter has not exposed them to the current employer. Request has been sent to their recruiter for the same. Please wait while they perform any action on it.', 'success', 400)).code(200);

            } else if (!checkRequest) {
                const dataToSave = {
                    paId: checkCandidate.paId,
                    jobId: checkJob._id,
                    candidateId: checkCandidate._id,
                    employerId: checkEmployer._id,
                    isAccepted: false,
                    isRejected: false,
                    isAppliedByCandidate: false
                };

                try {
                    await new chatRequestSchema.chatRequestSchema(dataToSave).save();
                } catch (e) {
                    logger.error('Error occurred while saving chat request information in get chat details handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                /* Send push */
                let checkPa;
                try {
                    checkPa = await userSchema.UserSchema.findById({_id: checkCandidate.paId}, {deviceType: 1, deviceToken: 1}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding PA information in get chat details handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                if (checkPa) {
                    const pushToSend = {
                        paId: checkPa._id,
                        jobId: checkJob.jobId,
                        role: '',
                        pushType: 'chatRequest',
                        type: 'chatRequest'
                    };
                    push.createMessage(checkPa.deviceToken, [], pushToSend, checkPa.deviceType, 'Request', 'You have a new request from an employer.', 'beep', '', '');
                    return h.response(responseFormatter.responseFormatter({}, 'This candidate\'s recruiter has not exposed them to the current employer. Request has been sent to their recruiter for the same. Please wait while they perform any action on it.', 'success', 400)).code(200);
                }
            } else {
                return h.response(responseFormatter.responseFormatter({}, 'This candidate\'s recruiter has not exposed them to the current employer. Request has been sent to their recruiter for the same. Please wait while they perform any action on it.', 'success', 400)).code(200);
            }
        }

        /* If not already there create a new chat and set isInvited to true */
        if (!status) {
            let checkPackage, checkSubscription, isViewed = false, addedUsers = [];

            /* Check if the candidate is already viewed by the employer */
            if (checkEmployer.isMaster) {
                checkEmployer.slaveUsers.push(checkEmployer._id);
                addedUsers = checkEmployer.slaveUsers;
            } else {
                let master;
                /* Get master account */
                try {
                    master = await userSchema.UserSchema.findOne({slaveUsers: mongoose.Types.ObjectId(checkEmployer._id)}, {_id: 1, slaveUsers: 1}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding master user data in get chat handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (master) {
                    master.slaveUsers.push(master._id);
                    addedUsers = master.slaveUsers;
                }
            }
            try {
                isViewed = await viewsSchema.viewsSchema.findOne({employerId: {$in: addedUsers}, candidateId: mongoose.Types.ObjectId(request.query.candidateId)}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding views data in get chat handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            isViewed = !!isViewed;

            /* Check if views are included in the current package */
            if (checkEmployer.subscriptionInfo && checkEmployer.subscriptionInfo.packageId) {
                try {
                    checkPackage = await packageSchema.packageSchema.findById({_id: checkEmployer.subscriptionInfo.packageId}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while fetching package information in get chat details handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                if (!checkPackage) {
                    return h.response(responseFormatter.responseFormatter({}, 'No package found', 'error', 400)).code(400);
                } else if (!checkPackage.numberOfViews.isIncluded && !isViewed) {
                    return h.response(responseFormatter.responseFormatter({}, 'Your current package does not have any views.', 'error', 400)).code(400);
                } else {
                    /* Check for subscription */
                    if (checkEmployer.subscriptionInfo.subscriptionId) {
                        try {
                            checkSubscription = await subscriptionSchema.subscriptionSchema.findById({_id: checkEmployer.subscriptionInfo.subscriptionId}, {}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred while fetching subscription information in get chat details handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }

                        if ((!checkSubscription || !checkSubscription.isActive) && !isViewed) {
                            return h.response(responseFormatter.responseFormatter({}, 'No subscription found', 'error', 400)).code(400);
                        } else if (checkSubscription.numberOfViews && checkSubscription.numberOfViews.isIncluded && !checkSubscription.numberOfViews.isUnlimited && !isViewed) {
                            if (checkSubscription.numberOfViews.count < 1) {
                                return h.response(responseFormatter.responseFormatter({}, 'You are out of views!', 'error', 400)).code(400);
                            } else {
                                /* Reduce the count */
                                try {
                                    await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkSubscription._id}, {$inc: {'numberOfViews.count': -1}}, {lean: true});
                                } catch (e) {
                                    logger.error('Error occurred while updating subscription data in get chat handler %s:', JSON.stringify(e));
                                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                                }
                                /* Add same into views collection */
                                const viewToSave = {
                                    employerId: mongoose.Types.ObjectId(checkEmployer._id),
                                    candidateId: mongoose.Types.ObjectId(request.query.candidateId)
                                };

                                let expiration;
                                if (checkSubscription.numberOfViews.expiryAfterPackageExpiry === 0) {
                                    expiration = checkSubscription.expiresAt;
                                } else if (checkSubscription.numberOfViews.expiryAfterPackageExpiry < 0) {
                                    expiration = new Date(moment(checkSubscription.expiresAt).add(50, 'years'));
                                } else if (checkSubscription.numberOfViews.expiryAfterPackageExpiry > 0) {
                                    expiration = new Date(moment(checkSubscription.expiresAt).add(checkSubscription.numberOfViews.expiryAfterPackageExpiry, 'days'));
                                }
                                if (expiration) {
                                    viewToSave['expiration'] = expiration;
                                }

                                try {
                                    await new viewsSchema.viewsSchema(viewToSave).save();
                                } catch (e) {
                                    logger.error('Error occurred while adding view data in get chat handler %s:', JSON.stringify(e));
                                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                                }
                            }
                        } else if (checkSubscription.numberOfViews && !checkSubscription.numberOfViews.isIncluded && !isViewed) {
                            return h.response(responseFormatter.responseFormatter({}, 'Your current subscription does not include database views!', 'error', 400)).code(400);
                        } else if (!isViewed) {
                            if (checkSubscription.isWallet && checkSubscription.walletAmount <= 0) {
                                return h.response(responseFormatter.responseFormatter({}, 'Please recharge your wallet to start conversation with this candidate.', 'error', 400)).code(400);
                            } else if (checkSubscription.isWallet) {
                                if (pricingInfo && (pricingInfo.numberOfViews.basePrice / pricingInfo.numberOfViews.count) > checkSubscription.walletAmount) {
                                    return h.response(responseFormatter.responseFormatter({}, 'Please recharge your wallet to start conversation with this candidate.', 'error', 400)).code(400);
                                }
                            }
                            /* Add same into views collection */
                            const viewToSave = {
                                employerId: mongoose.Types.ObjectId(checkEmployer._id),
                                candidateId: mongoose.Types.ObjectId(request.query.candidateId)
                            };

                            let expiration;
                            if (checkSubscription.numberOfViews.expiryAfterPackageExpiry === 0) {
                                expiration = checkSubscription.expiresAt;
                            } else if (checkSubscription.numberOfViews.expiryAfterPackageExpiry < 0) {
                                expiration = new Date(moment(checkSubscription.expiresAt).add(50, 'years'));
                            } else if (checkSubscription.numberOfViews.expiryAfterPackageExpiry > 0) {
                                expiration = new Date(moment(checkSubscription.expiresAt).add(checkSubscription.numberOfViews.expiryAfterPackageExpiry, 'days'));
                            }
                            if (expiration) {
                                viewToSave['expiration'] = expiration;
                            }

                            try {
                                await new viewsSchema.viewsSchema(viewToSave).save();
                            } catch (e) {
                                logger.error('Error occurred while adding view data in get chat handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }

                            /* Add this to viewed candidate list */
                            if (checkSubscription.isWallet) {
                                let cost;

                                cost = pricingInfo.numberOfViews.basePrice / pricingInfo.numberOfViews.count;

                                /* Increase the count */
                                try {
                                    await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkSubscription._id}, {
                                        $inc: {
                                            'numberOfViews.count': 1,
                                            walletAmount: -cost
                                        }
                                    }, {lean: true});
                                } catch (e) {
                                    logger.error('Error occurred while updating subscription data in get chat handler %s:', JSON.stringify(e));
                                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                                }
                            } else {
                                /* Reduce the count */
                                try {
                                    await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkSubscription._id}, {$inc: {'numberOfViews.count': -1}}, {lean: true});
                                } catch (e) {
                                    logger.error('Error occurred while updating subscription data in get chat handler %s:', JSON.stringify(e));
                                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                                }
                            }
                        }
                    }
                }
            }

            if (isCandidateBlocked) {
                return h.response(responseFormatter.responseFormatter({}, 'You have blocked this candidate. For starting the conversation, please unblock the candidate.', 'error', 400)).code(400);
            } else {
                let dataToSave = {
                    roomId: request.query.candidateId + request.query.employerId + request.query.jobId,
                    employerId: mongoose.Types.ObjectId(request.query.employerId),
                    candidateId: mongoose.Types.ObjectId(request.query.candidateId),
                    jobId: mongoose.Types.ObjectId(request.query.jobId),
                    isInvited: true,
                    isEmployerBlocked: false,
                    chats: [
                        {
                            from: mongoose.Types.ObjectId(request.query.employerId),
                            to: mongoose.Types.ObjectId(request.query.candidateId),
                            body: checkEmployer.employerInformation.companyName + ' has invited you to chat for the position of ' + (checkJob.jobTitle === 'Others' ? checkJob.subJobTitle: checkJob.jobTitle),
                            originalBody: checkEmployer.employerInformation.companyName + ' has invited you to chat for the position of ' + (checkJob.jobTitle === 'Others' ? checkJob.subJobTitle: checkJob.jobTitle),
                            isEmployerBlocked: false,
                            isTranslated: false
                        }
                    ],
                    paId: checkCandidate.paId
                };
                if (isBlocked) {
                    dataToSave.isEmployerBlocked = true;
                    dataToSave.chats[0].isEmployerBlocked = true;
                }
                if (chatLanguage && chatLanguage.language !== 'en') {
                    const message = await commonFunctions.Handlers.translate('has invited you to chat for the position of', 'en', chatLanguage.language);
                    if (message && message.translatedText) {
                        dataToSave.chats[0].body = aes256.encrypt(key, checkEmployer.employerInformation.companyName + ' ' + message.translatedText + ' ' + (checkJob.jobTitle === 'Others' ? checkJob.subJobTitle: checkJob.jobTitle));
                        dataToSave.chats[0].originalBody = aes256.encrypt(key, dataToSave.chats[0].originalBody);
                        dataToSave.chats[0].isTranslated = true;
                    }
                } else {
                    dataToSave.chats[0].body = aes256.encrypt(key, dataToSave.chats[0].body);
                    dataToSave.chats[0].originalBody = aes256.encrypt(key, dataToSave.chats[0].originalBody);
                    dataToSave.chats[0].isTranslated = false;
                }
                try {
                    chat = await new conversationSchema.conversationSchema(dataToSave).save();
                    if (!dataToSave.isEmployerBlocked) {
                        /* Send push message */
                        push.createMessage(checkCandidate.deviceToken, [], {employerId: request.query.employerId, candidateId: request.query.candidateId, jobId: request.query.jobId, pushType: 'chat', role: 'Candidate', chatId: chat._id}, checkCandidate.deviceType, 'Invitation', checkEmployer.employerInformation.companyName + ' has invited to chat for the position of ' + checkJob.jobTitle, '');

                        /* Create dynamic link to send in email */
                        shortLink = await commonFunctions.Handlers.createFirebaseShortLink('', request.query.jobId, request.query.candidateId, '', '', '', '', '', request.query.employerId);
                        if (shortLink === 'error') {
                            console.log('Error occurred in creating short link');
                        }

                        /* Send email to the candidate */
                        /* https://images.onata.com/prod/L10nk4aJPF-Headshot-Placeholder.jpg */
                        let email = {
                            to: [{
                                email: checkCandidate.email,
                                type: 'to'
                            }],
                            important: true,
                            merge: true,
                            inline_css: true,
                            merge_language: 'mailchimp',
                            merge_vars: [{
                                rcpt: checkCandidate.email,
                                vars: [
                                    {
                                        name: 'employerName',
                                        content: checkEmployer.employerInformation.companyName
                                    },
                                    {
                                        name: 'employerImage',
                                        content: checkEmployer.employerInformation.companyProfilePhoto ? checkEmployer.employerInformation.companyProfilePhoto :  'https://images.onata.com/prod/L10nk4aJPF-Headshot-Placeholder.jpg'
                                    },
                                    {
                                        name: 'message',
                                        content: checkEmployer.employerInformation.companyName + ' has invited you to chat for the position of ' + (checkJob.jobTitle === 'Others' ? checkJob.subJobTitle: checkJob.jobTitle)
                                    },
                                    {
                                        name: 'jobTitle',
                                        content: (checkJob.jobTitle === 'Others' ? checkJob.subJobTitle: checkJob.jobTitle)
                                    },
                                    {
                                        name: 'chatlink',
                                        content: shortLink ? shortLink.shortLink : ''
                                    }
                                ]
                            }]
                        };
                        await mandrill.Handlers.sendTemplate('chat-to-hire', [], email, true);

                        /* Send whatsapp message to candidate if candidate has uninstalled the app */
                        if (checkCandidate.hasUninstalled && checkCandidate.employeeInformation.phone) {
                            const msg = 'Dear ' + checkCandidate.firstName + ',\n' +
                                'This message is from EZJobs on behalf of ' + checkEmployer.employerInformation.companyName + '.\n' + checkEmployer.firstName +
                                ' has invited you for the ' + checkJob.jobTitle + ' position. Click here ' + shortLink.shortLink + ' to see more details of the job.\n' +
                                'If you have uninstalled EZJobs, install NOW https://ezjobs.page.link/store.';
                            let status = await commonFunctions.Handlers.sendWhatsAppSMS(checkCandidate.employeeInformation.countryCode, checkCandidate.employeeInformation.phone, msg);

                            if (status === 'error') {
                                logger.error('Error occurred in sending sms to employer %s:', JSON.stringify(status));
                            }
                        }

                    }
                } catch (e) {
                    logger.error('Error occurred while fetching chat information in get chat details handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            }
        }
    } else if (request.query.role.toLowerCase() === 'candidate') {
        if (!checkCandidate.isExposedToAll) {
            if (checkCandidate.exposedTo && checkCandidate.exposedTo.length) {
                const idx = checkCandidate.exposedTo.findIndex(k => k.toString() === checkEmployer._id.toString());
                if (idx === -1) {
                    flag = true;
                }
            } else if (checkCandidate.isExposedToCommunity && checkCandidate.membership !== checkEmployer.membership) {
                flag = true;
            } else {
                flag = true;
            }
            if (flag) {
                /* This candidate is not exposed to given employer */
                if (checkRequest && checkRequest.isRejected) {
                    /* Update this chat request and set isRejectedFlag as false */
                    try {
                        await chatRequestSchema.chatRequestSchema.findByIdAndUpdate({_id: checkRequest._id}, {$set: {isAccepted: false, isRejected: false}}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while updating chat request information in get chat details handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }

                    /* Send push to PA with the request */
                    const pushToSend = {
                        paId: checkRequest.paId,
                        jobId: checkRequest.jobId,
                        role: '',
                        pushType: 'chatRequest',
                        type: 'chatRequest'
                    };
                    push.createMessage(checkPa.deviceToken, [], pushToSend, checkPa.deviceType, 'Request', 'You have a new request from candidate.', 'beep', '', '');
                    return h.response(responseFormatter.responseFormatter({}, 'Your recruiter has not exposed you to the current employer. Request has been sent to your recruiter for the same. Please wait while they perform any action on it.', 'success', 400)).code(200);

                } else if (!checkRequest) {
                    const dataToSave = {
                        paId: checkCandidate.paId,
                        jobId: checkJob._id,
                        candidateId: checkCandidate._id,
                        employerId: checkEmployer._id,
                        isAccepted: false,
                        isRejected: false,
                        isAppliedByCandidate: true
                    };

                    try {
                        await new chatRequestSchema.chatRequestSchema(dataToSave).save();
                    } catch (e) {
                        logger.error('Error occurred while saving chat request information in get chat details handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }

                    /* Send push */
                    let checkPa;
                    try {
                        checkPa = await userSchema.UserSchema.findById({_id: checkCandidate.paId}, {deviceType: 1, deviceToken: 1}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while finding PA information in get chat details handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }

                    if (checkPa) {
                        const pushToSend = {
                            paId: checkPa._id,
                            jobId: checkJob.jobId,
                            role: '',
                            pushType: 'chatRequest',
                            type: 'chatRequest'
                        };
                        push.createMessage(checkPa.deviceToken, [], pushToSend, checkPa.deviceType, 'Request', 'You have a new request from candidate.', 'beep', '', '');

                        return h.response(responseFormatter.responseFormatter({}, 'Your recruiter has not exposed you to the current employer. Request has been sent to your recruiter for the same. Please wait while they perform any action on it.', 'success', 400)).code(200);
                    }
                } else {
                    return h.response(responseFormatter.responseFormatter({}, 'Your recruiter has not exposed you to the current employer. Request has been sent to your recruiter for the same. Please wait while they perform any action on it.', 'success', 400)).code(200);
                }
            }
        }
        if (!status) {
            if (checkPackage && checkPackage.isFree) {
                /* Get total number of invitations and constant data */
                const tempIdx = constantData.freeJobApplications.findIndex(k => k.country.toLowerCase() === checkEmployer.country.toLowerCase());
                if (tempIdx !== -1) {
                    const days = constantData.freeJobApplications[tempIdx].days;
                    const isUnlimited = constantData.freeJobApplications[tempIdx].isUnlimited;
                    if (!isUnlimited) {
                        let applications;
                        try {
                            applications = await conversationSchema.conversationSchema.countDocuments({employerId: checkEmployer._id, candidateId: {$ne: checkCandidate._id}});
                        } catch (e) {
                            logger.error('Error occurred while counting applications in get chat details handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }

                        if (applications >= days) {
                            return h.response(responseFormatter.responseFormatter({}, 'This job posting has enough applicants. Please apply to other jobs.', 'success', 400)).code(200);
                        }
                    }
                }
            }
            if (checkJob.isCompanyWebsite || checkJob.isATS) {
                if (isBlocked) {
                    return h.response(responseFormatter.responseFormatter({}, 'You have blocked this employer. For starting the conversation, please unblock the employer.', 'error', 400)).code(400);
                } else {
                    let dataToSave = {
                        roomId: request.query.candidateId + request.query.employerId + request.query.jobId,
                        employerId: mongoose.Types.ObjectId(request.query.employerId),
                        candidateId: mongoose.Types.ObjectId(request.query.candidateId),
                        jobId: mongoose.Types.ObjectId(request.query.jobId),
                        isInvited: false,
                        isApplied: true,
                        isCandidateBlocked: false,
                        chats: [
                            {
                                from: mongoose.Types.ObjectId(request.query.candidateId),
                                to: mongoose.Types.ObjectId(request.query.employerId),
                                body: checkCandidate.firstName + ' has applied for the position of ' + (checkJob.jobTitle === 'Others' ? checkJob.subJobTitle : checkJob.jobTitle) + '. And we have redirected user to the company website.',
                                originalBody: checkCandidate.firstName + ' has applied for the position of ' + (checkJob.jobTitle === 'Others' ? checkJob.subJobTitle : checkJob.jobTitle) + '. And we have redirected user to the company website.',
                                isCandidateBlocked: false,
                                isTranslated: false
                            }
                        ],
                        paId: checkCandidate.paId ? checkCandidate.paId : undefined
                    };
                    if (checkJob.isATS) {
                        dataToSave.chats[0].body = checkCandidate.firstName + ' has applied for the position of ' + (checkJob.jobTitle === 'Others' ? checkJob.subJobTitle: checkJob.jobTitle) + '. And we have forwarded user resume to the provided ATS email address.';
                        dataToSave.chats[0].originalBody = dataToSave.chats[0].body;
                    }
                    if (isCandidateBlocked) {
                        dataToSave.isCandidateBlocked = true;
                        dataToSave.chats[0].isCandidateBlocked = true;
                    }

                    dataToSave.chats[0].body = aes256.encrypt(key, dataToSave.chats[0].body);
                    dataToSave.chats[0].originalBody = aes256.encrypt(key, dataToSave.chats[0].originalBody);

                    try {
                        chat = await new conversationSchema.conversationSchema(dataToSave).save();
                        if (!dataToSave.isCandidateBlocked) {
                            /* Send push message */
                            push.createMessage(checkEmployer.deviceToken, [], {employerId: request.query.employerId, candidateId: request.query.candidateId, jobId: request.query.jobId, pushType: 'chat', role: 'Candidate', chatId: chat._id}, checkCandidate.deviceType, 'Invitation', checkEmployer.employerInformation.companyName + ' has invited to chat for the position of ' + checkJob.jobTitle, '');

                            /* Create dynamic link to send in email */
                            shortLink = await commonFunctions.Handlers.createFirebaseShortLink('', '', request.query.candidateId, '', '', '', '', '', '');
                            if (shortLink === 'error') {
                                console.log('Error occurred in creating short link');
                            }

                            let email = {
                                to: [{
                                    email: checkEmployer.email,
                                    type: 'to'
                                }],
                                important: true,
                                merge: true,
                                inline_css: true,
                                merge_language: 'mailchimp',
                                merge_vars: [{
                                    rcpt: checkEmployer.email,
                                    vars: [
                                        {
                                            name: 'candidateName',
                                            content: checkCandidate.firstName + ' ' + checkCandidate.lastName
                                        },
                                        {
                                            name: 'jobTitle',
                                            content: (checkJob.jobTitle === 'Others' ? checkJob.subJobTitle: checkJob.jobTitle)
                                        },
                                        {
                                            name: 'candidateLink',
                                            content: shortLink ? shortLink.shortLink : ''
                                        }
                                    ]
                                }]
                            };

                            /* Send email to the candidate */
                            if (checkJob.isCompanyWebsite) {
                                await mandrill.Handlers.sendTemplate('redirect_to_company', [], email, true);
                            } else if (checkJob.isATS) {
                                /* Send data to customURL parameter of CEIPAL */
                                if (checkJob.customURL) {
                                    const applicantToSend = {
                                        firstName: checkCandidate.firstName,
                                        lastName: checkCandidate.lastName,
                                        email: checkCandidate.email,
                                        gender: checkCandidate.gender,
                                        dob: checkCandidate.employeeInformation.dob,
                                        profilePhoto: checkCandidate.employeeInformation.profilePhoto,
                                        education: checkCandidate.employeeInformation.education,
                                        address: checkCandidate.employeeInformation.address,
                                        country: checkCandidate.employeeInformation.country,
                                        languages: checkCandidate.employeeInformation.languages,
                                        isStudent: checkCandidate.employeeInformation.isStudent,
                                        skills: checkCandidate.employeeInformation.skills,
                                        resume: checkCandidate.employeeInformation.resume,
                                        expectedSalary: checkCandidate.employeeInformation.expectedSalary,
                                        expectedSalaryType: checkCandidate.employeeInformation.expectedSalaryType,
                                        isNegotiable: checkCandidate.employeeInformation.isNegotiable,
                                        isRelocatable: checkCandidate.employeeInformation.isRelocatable,
                                        jobType: checkCandidate.employeeInformation.jobType,
                                        experience: checkCandidate.employeeInformation.pastJobTitlesModified,
                                        applicantId: checkCandidate.systemGeneratedId,
                                        phone: checkCandidate.employeeInformation.phone
                                    };
                                    let status;
                                    try {
                                        status = await commonFunctions.Handlers.sendApplicantData(applicantToSend, checkJob.customURL);
                                    } catch (e) {
                                        console.log(e);
                                    }
                                    if (status === 'error') {
                                        logger.error('Error occurred while creating applicant data on CEIPAL');
                                    }
                                }


                                /* Send email to the provided ATS email address */
                                if (checkCandidate && !checkCandidate.employeeInformation.resume) {
                                    const path = require('path');
                                    let html = fs.readFileSync(path.resolve(__dirname, '../public/resume_template_1.html'), 'utf8');
                                    const options = {
                                        format: 'A4',
                                        orientation: 'portrait'
                                    };
                                    let languages = [];
                                    if (checkCandidate.employeeInformation.languages.length) {
                                        for (let i = 0; i < checkCandidate.employeeInformation.languages.length; i++) {
                                            languages.push(checkCandidate.employeeInformation.languages[i].name);
                                        }
                                    } else {
                                        languages = undefined;
                                    }
                                    /* Convert experience dates into formatted dates */
                                    if (checkCandidate.employeeInformation.pastJobTitlesModified.length) {
                                        for (let i = 0; i < checkCandidate.employeeInformation.pastJobTitlesModified.length; i++) {
                                            if (checkCandidate.employeeInformation.pastJobTitlesModified[i].startDate) {
                                                checkCandidate.employeeInformation.pastJobTitlesModified[i].startDate = new Date(checkCandidate.employeeInformation.pastJobTitlesModified[i].startDate).toLocaleDateString();
                                            }
                                            if (checkCandidate.employeeInformation.pastJobTitlesModified[i].endDate) {
                                                checkCandidate.employeeInformation.pastJobTitlesModified[i].endDate = new Date(checkCandidate.employeeInformation.pastJobTitlesModified[i].endDate).toLocaleDateString();
                                            }
                                        }
                                    }


                                    let document = {
                                        html: html,
                                        path: path.resolve(__dirname, '../public/resume.pdf'),
                                        data: {
                                            firstName: checkCandidate.firstName,
                                            lastName: checkCandidate.lastName,
                                            email: checkCandidate.email,
                                            phone: checkCandidate.employeeInformation.phone,
                                            selfIntroduction: checkCandidate.employeeInformation.description.text,
                                            skills: checkCandidate.employeeInformation.skills,
                                            languages: languages,
                                            education: checkCandidate.employeeInformation.education,
                                            jobs: checkCandidate.employeeInformation.pastJobTitles.length ? checkCandidate.employeeInformation.pastJobTitles : null,
                                            jobTitle: checkCandidate.employeeInformation.futureJobTitles.length ? checkCandidate.employeeInformation.futureJobTitles[0] : null,
                                            profilePhoto: checkCandidate.employeeInformation.profilePhoto,
                                            workHistory: checkCandidate.employeeInformation.pastJobTitlesModified.length ? checkCandidate.employeeInformation.pastJobTitlesModified : undefined,
                                            futureJobTitles: checkCandidate.employeeInformation.futureJobTitles.length ? checkCandidate.employeeInformation.futureJobTitles : undefined,
                                            personalInformation: {
                                                gender: checkCandidate.employeeInformation.gender,
                                                dob: checkCandidate.employeeInformation.dob.day + '-' + checkCandidate.employeeInformation.dob.month + '-' + checkCandidate.employeeInformation.dob.year
                                            },
                                            address: checkCandidate.employeeInformation.address.city + ', ' + checkCandidate.employeeInformation.address.state
                                        }
                                    };
                                    try {
                                        await pdf.create(document, options);
                                    } catch (e) {
                                        console.log(e);
                                    }

                                    /* Send email to employer for resume */
                                    const mailOptions = {
                                        from: 'support@ezjobs.io',
                                        to: checkJob.atsEmail,
                                        subject: 'Resume of ' + checkCandidate.firstName + ' ' + checkCandidate.lastName + ' via EZJobs',
                                        text: '',
                                        attachments: [
                                            {
                                                filename: 'resume.pdf',
                                                path: path.resolve(__dirname, '../public/resume.pdf')
                                            }
                                        ]
                                    };
                                    try {
                                        commonFunctions.Handlers.nodeMailerEZJobsWithAttachment(mailOptions);
                                    } catch (e) {
                                        logger.error('Error in sending create account email to admin %s:', JSON.stringify(e));
                                    }
                                } else {
                                    /* Send email to employer for resume */
                                    const mailOptions = {
                                        from: 'support@ezjobs.io',
                                        to: checkJob.atsEmail,
                                        subject: 'Resume of ' + checkCandidate.firstName + ' ' + checkCandidate.lastName + ' via EZJobs',
                                        text: '',
                                        attachments: [
                                            {
                                                filename: 'resume.pdf',
                                                path: checkCandidate.employeeInformation.resume
                                            }
                                        ]
                                    };
                                    try {
                                        commonFunctions.Handlers.nodeMailerEZJobsWithAttachment(mailOptions);
                                    } catch (e) {
                                        logger.error('Error in sending create account email to admin %s:', JSON.stringify(e));
                                    }
                                }
                                await mandrill.Handlers.sendTemplate('redirect_to_company_ATS', [], email, true);
                            }
                        }
                    } catch (e) {
                        logger.error('Error occurred while fetching chat information in get chat details handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }

                /* Add the same candidate in the views for this user */
                let addedUsers, isViewed
                if (checkEmployer.isMaster) {
                    checkEmployer.slaveUsers.push(checkEmployer._id);
                    addedUsers = checkEmployer.slaveUsers;
                } else {
                    let master;
                    /* Get master account */
                    try {
                        master = await userSchema.UserSchema.findOne({slaveUsers: mongoose.Types.ObjectId(checkEmployer._id)}, {
                            _id: 1,
                            slaveUsers: 1
                        }, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while finding master user data in get chat handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                    if (master) {
                        master.slaveUsers.push(master._id);
                        addedUsers = master.slaveUsers;
                    }
                }
                try {
                    isViewed = await viewsSchema.viewsSchema.findOne({
                        employerId: {$in: addedUsers},
                        candidateId: mongoose.Types.ObjectId(request.query.candidateId)
                    }, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding views data in get chat handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                isViewed = !!isViewed;
                if (!isViewed) {
                    const viewDataToSave = {
                        employerId: checkEmployer._id,
                        candidateId: checkCandidate._id,
                        expiration: checkSubscription ?
                            ((checkSubscription.applicationValidity && checkSubscription.applicationValidity >= 0) ? new Date(moment(checkSubscription.expiresAt).add(checkSubscription.applicationValidity, 'days')) : checkSubscription.expiresAt) : null
                    };
                    try {
                        await new viewsSchema.viewsSchema(viewDataToSave).save();
                    } catch (e) {
                        logger.error('Error occurred while saving views data in get chat handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }
            }
        }
    }

    if (request.query.role.toLowerCase() === 'candidate') {
        arrayFilter = {
            'elem.to': mongoose.Types.ObjectId(request.query.candidateId)
        };
        matchCriteria['chats.isEmployerBlocked'] = false;
        matchCriteria['chats.hasCandidateDeleted'] = false;
    } else {
        arrayFilter = {
            'elem.to': mongoose.Types.ObjectId(request.query.employerId)
        };
        matchCriteria['chats.isCandidateBlocked'] = false;
        matchCriteria['chats.hasEmployerDeleted'] = false;
    }

    try {
        await conversationSchema.conversationSchema.updateMany(searchCriteria, {$set: {'chats.$[elem].isRead': true}}, {arrayFilters: [arrayFilter]});
    } catch (e) {
        logger.error('Error occurred while setting isRead in get chat details handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    aggregationCriteria = [
        {
            $match: searchCriteria
        },
        {
            $lookup: {
                from: 'User',
                localField: 'candidateId',
                foreignField: '_id',
                as: 'candidate'
            }
        },
        {
            $unwind: '$candidate'
        },
        {
            $lookup: {
                from: 'User',
                localField: 'employerId',
                foreignField: '_id',
                as: 'employer'
            }
        },
        {
            $unwind: '$employer'
        },
        {
            $lookup: {
                from: 'Job',
                localField: 'jobId',
                foreignField: '_id',
                as: 'job'
            }
        },
        {
            $unwind: '$job'
        },
        {
            $unwind: {
                path: '$chats',
                preserveNullAndEmptyArrays: true
            }
        },
        {
            $sort: {
                'chats._id': -1
            }
        },
        {
            $match: matchCriteria
        },
        {
            $limit: request.query.limit
        },
        {
            $sort: {
                'chats._id': 1
            }
        },
        {
            $project: {
                employerFirstName: '$employer.employerInformation.companyName',
                candidateFirstName: '$candidate.firstName',
                candidateLastName: '$candidate.lastName',
                candidatePhoto: '$candidate.employeeInformation.profilePhoto',
                employerPhoto: '$employer.employerInformation.companyProfilePhoto',
                jobTitle: '$job.jobTitle',
                subJobTitle: '$job.subJobTitle',
                currency: '$job.currency',
                payRate: '$job.payRate',
                isArchived: '$job.isArchived',
                isHired: 1,
                isRejected: 1,
                isInvited: 1,
                isApplied: 1,
                isInterested: 1,
                chats: 1,
                isInvitationRejected: 1,
                isCandidateBlocked: 1,
                isEmployerBlocked: 1,
                isNegotiable: '$job.isNegotiable',
                isCandidateOnline: '$candidate.isOnline',
                isEmployerOnline: '$employer.isOnline',
                candidateLastSeen: '$candidate.lastOnline',
                employerLastSeen: '$employer.lastOnline',
                isUnderReview: '$job.isUnderReview',
                jobReceiveCalls: '$job.receiveCalls',
                candidateReceiveCalls: '$candidate.employeeInformation.receiveCalls',
                phone: {
                    employerPhone: {$cond: ['$job.receiveCalls', '$job.phone', '']},
                    employerCountryCode: {$cond: ['$job.receiveCalls', '$job.countryCode', '']},
                    candidatePhone: {$cond: ['$candidate.employeeInformation.receiveCalls', '$candidate.employeeInformation.phone', '']},
                    candidateCountryCode: {$cond: ['$candidate.employeeInformation.receiveCalls', '$candidate.employeeInformation.countryCode', '']}
                },
                chatLanguage: '$candidate.chatLanguage',
                isNotified: 1,
                isTranslationAccepted: 1,
                appDownloaded: '$candidate.hasOwned',
                inApp: '$job.inApp',
                isComplete: '$candidate.employeeInformation.isComplete'
            }
        }
    ];
    try {
        conversations = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
        for (let i = 0; i < conversations.length; i++) {
            if (i === 0) {
                sortedChats = conversations[i];
                sortedChats.chats = [sortedChats.chats];
            } else {
                sortedChats.chats.push(conversations[i].chats);
            }
        }
    } catch (e) {
        logger.error('Error occurred finding conversations information in get chat status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!sortedChats.chats) {
        aggregationCriteria = [
            {
                $match: searchCriteria
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'candidateId',
                    foreignField: '_id',
                    as: 'candidate'
                }
            },
            {
                $unwind: '$candidate'
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'employerId',
                    foreignField: '_id',
                    as: 'employer'
                }
            },
            {
                $unwind: '$employer'
            },
            {
                $lookup: {
                    from: 'Job',
                    localField: 'jobId',
                    foreignField: '_id',
                    as: 'job'
                }
            },
            {
                $unwind: '$job'
            },
            {
                $project: {
                    employerFirstName: '$employer.employerInformation.companyName',
                    candidateFirstName: '$candidate.firstName',
                    candidateLastName: '$candidate.lastName',
                    candidatePhoto: '$candidate.employeeInformation.profilePhoto',
                    employerPhoto: '$employer.employerInformation.companyProfilePhoto',
                    jobTitle: '$job.jobTitle',
                    subJobTitle: '$job.subJobTitle',
                    currency: '$job.currency',
                    payRate: '$job.payRate',
                    isArchived: '$job.isArchived',
                    isHired: 1,
                    isRejected: 1,
                    isInvited: 1,
                    isApplied: 1,
                    isInterested: 1,
                    isInvitationRejected: 1,
                    isCandidateBlocked: 1,
                    isEmployerBlocked: 1,
                    isNegotiable: '$job.isNegotiable',
                    isCandidateOnline: '$candidate.isOnline',
                    isEmployerOnline: '$employer.isOnline',
                    candidateLastSeen: '$candidate.lastOnline',
                    employerLastSeen: '$employer.lastOnline',
                    isUnderReview: '$job.isUnderReview',
                    jobReceiveCalls: '$job.receiveCalls',
                    candidateReceiveCalls: '$candidate.employeeInformation.receiveCalls',
                    phone: {
                        employerPhone: {$cond: ['$job.receiveCalls', '$job.phone', '']},
                        employerCountryCode: {$cond: ['$job.receiveCalls', '$job.countryCode', '']},
                        candidatePhone: {$cond: ['$candidate.employeeInformation.receiveCalls', '$candidate.employeeInformation.phone', '']},
                        candidateCountryCode: {$cond: ['$candidate.employeeInformation.receiveCalls', '$candidate.employeeInformation.countryCode', '']}
                    },
                    chatLanguage: '$candidate.chatLanguage',
                    isNotified: 1,
                    isTranslationAccepted: 1,
                    appDownloaded: '$candidate.hasOwned',
                    isComplete: '$candidate.employeeInformation.isComplete'
                }
            }
        ];
        try {
            conversations = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
            for (let i = 0; i < conversations.length; i++) {
                if (i === 0) {
                    sortedChats = conversations[i];
                    sortedChats.chats = [];
                }
            }
        } catch (e) {
            logger.error('Error occurred finding conversations information in get chat status handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    let language;
    if (sortedChats) {
        if (sortedChats.chatLanguage) {
            try {
                language = await languageSchema.languageSchema.findById({_id: sortedChats.chatLanguage}, {language: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred finding language information in get chat status handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (language) {
                sortedChats.chatLanguage = language.language;
            }
        }
    }

    if (!sortedChats.chats) {
        let checkChat;
        /* Check if chat exists */
        try {
            checkChat = await conversationSchema.conversationSchema.findOne(searchCriteria, {chats: 0}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding conversations information in get chat status handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (checkChat) {
            sortedChats = checkChat;
            if (request.query.role.toLowerCase() === 'candidate') {
                /* Check who is blocked by whom */
                try {
                    userData = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.candidateId), blockedBy: {$nin: [mongoose.Types.ObjectId(request.query.employerId)]}}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding blocked user in get chat details handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (!userData) {
                    sortedChats.isCandidateBlocked = true;
                }
            } else {
                /* Check who is blocked by whom */
                try {
                    userData = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.employerId), blockedBy: {$nin: [mongoose.Types.ObjectId(request.query.candidateId)]}}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding blocked user in get chat details handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (!userData) {
                    sortedChats.isEmployerBlocked = true;
                }
            }
        }
    } else {
        if (sortedChats.chats) {
            for (let i = 0; i < sortedChats.chats.length; i++) {
                if (sortedChats.chats[i].isEncrypted) {
                    sortedChats.chats[i].body = aes256.decrypt(key, sortedChats.chats[i].body);
                    if (sortedChats.chats[i].originalBody) {
                        sortedChats.chats[i].originalBody = aes256.decrypt(key, sortedChats.chats[i].originalBody);
                    }
                }
            }
        }
    }

    if (!sortedChats.employerFirstName) {
        if (checkJob.isArchived) {
            return h.response(responseFormatter.responseFormatter({}, 'This position has already been filled', 'error', 400)).code(400);
        }
    }

    /* Success */
    /* if (blockEmployerFlag) {
         return h.response(responseFormatter.responseFormatter(sortedChats, 'Please purchase our premium plan to start/resume conversation with this candidate.', 'success', 205)).code(200);
     } else {
         return h.response(responseFormatter.responseFormatter(sortedChats, 'Fetched successfully', 'success', 200)).code(200);
     }*/
    return h.response(responseFormatter.responseFormatter(sortedChats, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getPrePopulatedChatMessages = async (request, h) => {
    let messages;

    /* Fetch list of all the messages for the given role and type from chat suggestion collection */
    try {
        messages = await chatSuggestion.chatSuggestionSchema.findOne({role: request.query.role.toLowerCase(), type: request.query.type, language: request.query.language ? request.query.language: 'en'}, {messages: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding chat suggestion data in get pre populated chat message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(messages ? messages.messages: [], 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.sendOTP = async (request, h) => {
    let checkUser, otp, otpData, dataToSave, checkOtp, internalParameters;

    /* Check whether user is present in database or not */
    if (request.payload.userId) {
        try {
            checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {});
        } catch (e) {
            logger.error('Error occurred finding user information in send otp handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkUser) {
            return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
        }
    }

    /* Check whether user has valid authorization token */
    /*try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in send otp handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }*/

    if (process.env.NODE_ENV === 'production') {
        request.payload.hashKey = 'iTdOuXkbPcl';
    } else {
        request.payload.hashKey = 'ahOOACVl/FW';
        /*request.payload.hashKey = 'ahOOACVl/FW';*/
    }

    /* Generate OTP */
    otp = commonFunctions.Handlers.generateOTP();

    /* Check OTP */
    try {
        checkOtp = await otpSchema.otpSchema.findOne({phone: request.payload.phone}, {updatedAt: 1, count: 1}, {upsert: true, lean: true});
    } catch (e) {
        logger.error('Error occurred while finding otp in send otp handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (checkOtp) {
        const diff = (new Date() - new Date(checkOtp.updatedAt)) / 1000;
        /* Check if count exceeds the allowed number of resends */
        if (diff > 86400) {
            checkOtp.count = 0;
        } else if (checkOtp.count && checkOtp.count > 9) {
            return h.response(responseFormatter.responseFormatter({}, 'You are allowed to receive a maximum of 10 OTP codes per calendar day for security reasons.', 'error', 400)).code(400);
        }

        if (diff < 60) {
            return h.response(responseFormatter.responseFormatter({}, 'Please wait upto 60 seconds to resend the OTP.', 'error', 400)).code(400);
        }
    }

    dataToSave = {
        userId: request.payload.userId ? mongoose.Types.ObjectId(request.payload.userId) : undefined,
        otp: otp,
        phone: request.payload.phone,
        countryCode: request.payload.countryCode || '+91',
        count: checkOtp ? (checkOtp.count ? (checkOtp.count + 1) : 1) : 1
    };

    /* Save OTP */
    try {
        await otpSchema.otpSchema.findOneAndUpdate({phone: request.payload.phone}, {$set: dataToSave}, {upsert: true, lean: true});
    } catch (e) {
        logger.error('Error occurred while saving otp in send otp handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get flag from the internal parameters for text sending provider */
    try {
        internalParameters = await internalParameterSchema.internalParameterSchema.findOne({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching internal parameters in send otp handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send OTP */
    if (dataToSave.countryCode === '+91') {
        if (!!internalParameters.useTextLocal) {
            otpData = await commonFunctions.Handlers.sendOTPTextLocal(request.payload.countryCode || '+91', request.payload.phone, otp, request.payload.hashKey);
        } else {
            otpData = commonFunctions.Handlers.sendOTP(request.payload.countryCode || '+91', request.payload.phone, otp, request.payload.hashKey);
        }
    } else {
        otpData = commonFunctions.Handlers.sendOTP(request.payload.countryCode, request.payload.phone, otp, request.payload.hashKey);
    }

    if (otpData === 'error') {
        logger.error('Error occurred while sending otp in send otp handler %s:');
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'OTP has been sent', 'success', 200)).code(200);
};

userHandler.verifyOTP = async (request, h) => {
    let checkUser, otp, dataToReturn = {};

    if (request.payload.userId) {
        /* Check whether user is present in database or not */
        try {
            checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {password: 0}, {});
        } catch (e) {
            logger.error('Error occurred finding user information in verify otp handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Remove OTP from database */
    try {
        otp = await otpSchema.otpSchema.findOneAndDelete({otp: request.payload.otp});
    } catch (e) {
        logger.error('Error occurred while removing otp in verify otp handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (otp) {
        /* Check if user is logging in */
        if (!checkUser) {
            try {
                checkUser = await userSchema.UserSchema.findOne({phone: otp.phone, countryCode: otp.countryCode}, {_id: 1, roles: 1, isPaAdmin: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding user in verify otp handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (checkUser && checkUser.isPaAdmin) {
                return h.response(responseFormatter.responseFormatter({}, 'You can not use this phone number to login into EZJobs app.', 'error', 400)).code(400);
            }
            if (checkUser) {
                /* Check Role */
                const referrer = request.info.referrer;
                if (checkUser.roles[0].toLowerCase() === 'candidate' && referrer.includes('employer')) {
                    return h.response(responseFormatter.responseFormatter({}, 'We do not have your account with the given credentials for Employer role.', 'error', 404)).code(404);
                } else if (checkUser.roles[0].toLowerCase() === 'employer' && referrer.includes('candidate')) {
                    return h.response(responseFormatter.responseFormatter({}, 'We do not have your account with the given credentials for Candidate role.', 'error', 404)).code(404);
                }
                let constantData;
                try {
                    constantData = await constantSchema.constantSchema.findOne({}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding constant info in verify otp handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                dataToReturn = {userInfo: {_id: checkUser._id}, authToken: '', constantInfo: constantData};
                const token = commonFunctions.Handlers.createAuthToken(checkUser._id, 'Candidate');
                dataToReturn.authToken = token;
                const tokenToSave = {
                    userId: checkUser._id,
                    authToken: token,
                    isExpired: false
                };
                /* Save authorization token in token collection */
                try {
                    await tokenSchema.authTokenSchema.findOneAndUpdate({userId: checkUser._id}, tokenToSave, {lean: true, upsert: true});
                } catch (e) {
                    logger.error('Error occurred in saving token in verify otp handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            }
        }

        let updateCriteria;
        if (request.payload.isCompany) {
            updateCriteria = {
                $set: {'employerInformation.phoneVerified': true, 'employerInformation.companyPhone': otp.phone, 'employerInformation.countryCode': otp.countryCode}
            }
        } else {
            updateCriteria = {
                $set: {phoneVerified: true, 'employeeInformation.phone': otp.phone, 'employeeInformation.countryCode': otp.countryCode}
            }
        }
        /* Verify user phone number */
        if (checkUser) {
            try {
                await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, updateCriteria, {lean: true});
            } catch (e) {
                logger.error('Error occurred while updating user in verify otp handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
        return h.response(responseFormatter.responseFormatter(dataToReturn, 'OTP verified', 'success', 200)).code(200);
    } else {
        return h.response(responseFormatter.responseFormatter({}, 'OTP is invalid', 'error', 400)).code(400);
    }
};

userHandler.setInvitation = async (request, h) => {
    let checkUser, decoded, checkChat, updateCriteria, checkEmployer, pushCriteria, checkJob;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.candidateId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in set invitation handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in set invitation handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check if conversation exists */
    try {
        checkChat = await conversationSchema.conversationSchema.findById({_id: mongoose.Types.ObjectId(request.payload.chatId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching chat details in set invitation handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkChat || (checkChat.candidateId.toString() !== request.payload.candidateId)) {
        return h.response(responseFormatter.responseFormatter({}, 'Chat not found', 'error', 404)).code(404);
    } else if (!checkChat.isInvited) {
        return h.response(responseFormatter.responseFormatter({}, 'Problem with invitation', 'error', 400)).code(400);
    } else if (checkChat.isApplied) {
        return h.response(responseFormatter.responseFormatter({}, 'You have already accepted the invitation', 'error', 400)).code(400);
    }

    /* Check if employer exists */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: checkChat.employerId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding employer information in set invitation handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'Employer doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check if job exists */
    try {
        checkJob = await jobsSchema.jobSchema.findById({_id: checkChat.jobId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding job information in set invitation handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkJob) {
        return h.response(responseFormatter.responseFormatter({}, 'Job doesn\'t exists', 'error', 404)).code(404);
    }

    /* Accept the invitation */
    if (request.payload.mode === 'accept') {
        updateCriteria = {isApplied: true, isInterested: true};
        pushCriteria = {chats: {
            from: mongoose.Types.ObjectId(request.payload.candidateId),
            to: checkChat.employerId,
            body: aes256.encrypt(key, 'Candidate has accepted the invitation'),
            originalBody: aes256.encrypt(key, 'Candidate has accepted the invitation'),
            type: 'isText',
            latitude: '',
            longitude: '',
            isRead: false,
            dateTime: Date.now(),
            hasEmployerDeleted: false,
            hasCandidateDeleted: false,
            isCandidateBlocked: false,
            isEmployerBlocked: false
        }};
    } else {
        updateCriteria = {isInvitationRejected: true};
        pushCriteria = {chats: {
                from: mongoose.Types.ObjectId(request.payload.candidateId),
                to: checkChat.employerId,
                body: aes256.encrypt(key, 'Candidate is not interested in this job at this time'),
                originalBody: aes256.encrypt(key, 'Candidate is not interested in this job at this time'),
                type: 'isText',
                latitude: '',
                longitude: '',
                isRead: false,
                dateTime: Date.now(),
                hasEmployerDeleted: false,
                hasCandidateDeleted: false,
                isCandidateBlocked: false,
                isEmployerBlocked: false
            }};
    }

    try {
        await conversationSchema.conversationSchema.findByIdAndUpdate({_id: mongoose.Types.ObjectId(request.payload.chatId)}, {$set: updateCriteria, $push: pushCriteria}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating conversation in set invitation handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send an email to the employer accordingly */
    let email;
    /* Create dynamic link */
    const shortLink = await commonFunctions.Handlers.createFirebaseShortLink(checkEmployer.email, '', '');
    const shortLinkRespond = await commonFunctions.Handlers.createFirebaseShortLink('', checkChat.jobId, checkChat.candidateId, '', '', '', '', '', checkChat.employerId);
    email = {
        to: [{
            email: checkEmployer.email,
            type: 'to'
        }],
        important: true,
        subject: checkUser.firstName.trim() + ' has ' + (request.payload.mode === 'accept' ? 'accepted' : 'declined') + ' your invitation',
        merge: true,
        inline_css: true,
        merge_language: 'mailchimp',
        merge_vars: [{
            rcpt: checkEmployer.email,
            vars: [
                {
                    name: 'employerName',
                    content: checkEmployer.firstName.trim()
                },
                {
                    name: 'candidateName',
                    content: checkUser.firstName.trim()
                },
                {
                    name: 'jobTitle',
                    content: checkJob.jobTitle
                },
                {
                    name: 'status',
                    content: request.payload.mode === 'accept' ? 'accepted' : 'declined'
                },
                {
                    name: 'downloadURL',
                    content: shortLink.shortLink
                },
                {
                    name: 'url',
                    content: shortLinkRespond.shortLink
                }
            ]
        }]
    };
    try {
        await mandrill.Handlers.sendTemplate('invitation-response-template', [], email, true);
    } catch (e) {
        logger.error('Error occurred while sending email in accept/reject invitation handler %s:', JSON.stringify(e));
    }

    /* Success */
    if (request.payload.mode === 'accept') {
        push.createMessage(checkEmployer.deviceToken, [], {employerId: checkChat.employerId, candidateId: checkChat.candidateId, jobId: checkChat.jobId, pushType: 'invitation', chatId: checkChat._id, isInvitationAccepted: true}, checkEmployer.deviceType, 'Invitation', checkUser.firstName + ' has accepted your invitation', '');
        return h.response(responseFormatter.responseFormatter({}, 'Invitation accepted', 'success', 200)).code(200);
    } else {
        push.createMessage(checkEmployer.deviceToken, [], {employerId: checkChat.employerId, candidateId: checkChat.candidateId, jobId: checkChat.jobId, pushType: 'invitation', chatId: checkChat._id, isInvitationAccepted: false}, checkEmployer.deviceType, 'Invitation', checkUser.firstName + ' is not interested', '');
        return h.response(responseFormatter.responseFormatter({}, 'Invitation rejected', 'success', 200)).code(200);
    }
};

userHandler.getMoreScreenNumbers = async (request, h) => {
    let checkUser, decoded, dataToReturn = {
        applied: 0,
        invited: 0,
        favourites: 0,
        activeJobs: 0,
        candidatesApplied: 0,
        invitedByEmployer: 0
    }, role;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in get more numbers handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }
    role = checkUser.roles[0].toLowerCase();

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get more numbers handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get count of applied */
    try {
        dataToReturn.applied = await conversationSchema.conversationSchema.countDocuments({candidateId: mongoose.Types.ObjectId(request.query.userId), isApplied: true, isRejected: false, isHired: false, isInvited: false});
    } catch (e) {
        logger.error('Error occurred in counting applied in get more numbers handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get count of applied */
    try {
        dataToReturn.candidatesApplied = await conversationSchema.conversationSchema.countDocuments({employerId: mongoose.Types.ObjectId(request.query.userId), isApplied: true, isRejected: false, isHired: false, paId: {$ne: mongoose.Types.ObjectId(request.query.userId)}});
    } catch (e) {
        logger.error('Error occurred in counting candidates applied in get more numbers handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get count of invited */
    try {
        dataToReturn.invited = await conversationSchema.conversationSchema.countDocuments({
            employerId: mongoose.Types.ObjectId(request.query.userId),
            isInvited: true,
            isApplied: false,
            isRejected: false,
            isHired: false,
            isInvitationRejected: false,
            paId: {$ne: mongoose.Types.ObjectId(request.query.userId)}
        });
    } catch (e) {
        logger.error('Error occurred in counting invited in get more numbers handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get count of invited */
    const criteria = {
        candidateId: mongoose.Types.ObjectId(request.query.userId),
        isInvited: true,
        isRejected: false,
        isHired: false,
        isInvitationRejected: false
    };
    if (role === 'candidate' && checkUser.paId) {
        criteria['employerId'] = {$ne: checkUser.paId};
    }
    try {
        dataToReturn.invitedByEmployer = await conversationSchema.conversationSchema.countDocuments(criteria);
    } catch (e) {
        logger.error('Error occurred in counting invited in get more numbers handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get count of favourites */
    try {
        dataToReturn.favourites = await favouriteSchema.favouriteSchema.countDocuments({userId: mongoose.Types.ObjectId(request.query.userId)});
    } catch (e) {
        logger.error('Error occurred in counting favourite jobs in get more numbers handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get count of active jobs */
    try {
        dataToReturn.activeJobs = await jobsSchema.jobSchema.countDocuments({
            userId: mongoose.Types.ObjectId(request.query.userId),
            isArchived: false,
            isUnderReview: false,
            isClosed: false,
            isExpired: false,
            isVisible: true,
            isTranslated: false
        });
    } catch (e) {
        logger.error('Error occurred in counting active jobs in get more numbers handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(dataToReturn, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getNotifications = async (request, h) => {
    let checkUser, decoded, aggregationCriteria, matchCriteria = {
        sentTo: mongoose.Types.ObjectId(request.query.userId)
    }, notifications;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in get notifications handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get notifications handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Create aggregation criteria for sorting and pagination */
    if (request.query.lastId) {
        matchCriteria._id = {$lt: mongoose.Types.ObjectId(request.query.lastId)};
    }
    aggregationCriteria = [
        {
            $match: matchCriteria
        },
        {
            $sort: {
                _id: -1
            }
        },
        {
            $limit: request.query.limit
        }
    ];
    try {
        notifications = await notificationSchema.notificationSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred while aggregating in get notifications handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(notifications, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.readNotification = async (request, h) => {
    let checkUser, decoded;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in read notifications handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in read notifications handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Update particular notification to mark as read */
    try {
        await notificationSchema.notificationSchema.findByIdAndUpdate({_id: request.payload.notificationId}, {isRead: true}, {lean: true});
    } catch (e) {
        logger.error('Error occurred updating notification in read notifications handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Marked as read', 'success', 204)).code(200);
};

userHandler.clearNotifications = async (request, h) => {
    let checkUser, decoded;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in clear notifications handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in clear notifications handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Clear all the notifications of a user */
    try {
        await notificationSchema.notificationSchema.deleteMany({sentTo: mongoose.Types.ObjectId(request.payload.userId)});
    } catch (e) {
        logger.error('Error occurred removing notifications in clear notifications handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Notifications cleared successfully', 'success', 204)).code(200);
};

userHandler.blockUser = async (request, h) => {
    let decoded, checkUser, checkCandidate, checkChat, blockedBy, updateCriteria, chat, blockedUser;

    /* Check whether employer is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.employerId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding employer information in block user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'Employer doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether employer is present in database or not */
    try {
        checkCandidate = await userSchema.UserSchema.findById({_id: request.payload.candidateId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding candidate information in block user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkCandidate) {
        return h.response(responseFormatter.responseFormatter({}, 'Candidate doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in block user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check whether chat exists */
    try {
        checkChat = await conversationSchema.conversationSchema.findOne({employerId: mongoose.Types.ObjectId(request.payload.employerId), candidateId: mongoose.Types.ObjectId(request.payload.candidateId), jobId: mongoose.Types.ObjectId(request.payload.jobId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding chat information in block user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkChat) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not block this user as you have not started communication with this user. We suggest you to report the job in that case.', 'error', 400)).code(400);
    }

    /* Get user who is blocking */
    if (request.payload.role.toLowerCase() === 'candidate') {
        blockedBy = checkChat.employerId;
        blockedUser = checkChat.candidateId;
        updateCriteria = {$set: {isCandidateBlocked: true}};
    } else {
        blockedBy = checkChat.candidateId;
        blockedUser = checkChat.employerId;
        updateCriteria = {$set: {isEmployerBlocked: true}};
    }

    /* Add this user to blocked by array list in user collection */
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: blockedBy.toString() === checkChat.employerId.toString() ? checkChat.candidateId: checkChat.employerId}, {$addToSet: {blockedBy: blockedBy}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred updating user information in block user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Add record into the block user collection */
    try {
        await blockUserSchema.blockSchema.findOneAndUpdate({userId: blockedBy}, {$set: {userId: blockedBy, blockedUserId: blockedUser, blockReason: request.payload.reason ? request.payload.reason : ''}}, {lean: true, upsert: true});
    } catch (e) {
        logger.error('Error occurred updating/upserting block user data in block user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update the conversation */
    try {
        chat = await conversationSchema.conversationSchema.findOneAndUpdate({employerId: mongoose.Types.ObjectId(request.payload.employerId), candidateId: mongoose.Types.ObjectId(request.payload.candidateId), jobId: mongoose.Types.ObjectId(request.payload.jobId)}, updateCriteria, {lean: true});
    } catch (e) {
        logger.error('Error occurred updating conversation information in block user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update all other conversations initiated by blocked user */
    let bulk = conversationSchema.conversationSchema.collection.initializeUnorderedBulkOp();
    if (request.payload.role.toLowerCase() === 'candidate') {
        if (chat) {
            bulk
                .find({_id: {$ne: chat._id}, employerId: checkChat.employerId, candidateId: checkChat.candidateId})
                .update({$set: {isCandidateBlocked: true}});
            try {
                await bulk.execute();
            } catch (e) {
                logger.error('Error occurred updating conversation information in block user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            /* Update all other conversations done to blocked user */
            bulk
                .find({_id: {$ne: chat._id}, employerId: checkChat.candidateId, candidateId: checkChat.employerId})
                .update({$set: {isEmployerBlocked: true}});
            try {
                await bulk.execute();
            } catch (e) {
                logger.error('Error occurred updating conversation information in block user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        } else {
            bulk
                .find({employerId: checkChat.employerId, candidateId: checkChat.candidateId})
                .update({$set: {isCandidateBlocked: true}});
            try {
                await bulk.execute();
            } catch (e) {
                logger.error('Error occurred updating conversation information in block user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            /* Update all other conversations done to blocked user */
            bulk
                .find({employerId: checkChat.candidateId, candidateId: checkChat.employerId})
                .update({$set: {isEmployerBlocked: true}});
            try {
                await bulk.execute();
            } catch (e) {
                logger.error('Error occurred updating conversation information in block user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    } else {
        if (chat) {
            bulk
                .find({_id: {$ne: chat._id}, employerId: checkChat.employerId, candidateId: checkChat.candidateId})
                .update({$set: {isEmployerBlocked: true}});
            try {
                await bulk.execute();
            } catch (e) {
                logger.error('Error occurred updating conversation information in block user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            /* Update all other conversations done to blocked user */
            bulk
                .find({_id: {$ne: chat._id}, employerId: checkChat.candidateId, candidateId: checkChat.employerId})
                .update({$set: {isCandidateBlocked: true}});
            try {
                await bulk.execute();
            } catch (e) {
                logger.error('Error occurred updating conversation information in block user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        } else {
            bulk
                .find({employerId: checkChat.employerId, candidateId: checkChat.candidateId})
                .update({$set: {isEmployerBlocked: true}});
            try {
                await bulk.execute();
            } catch (e) {
                logger.error('Error occurred updating conversation information in block user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            /* Update all other conversations done to blocked user */
            bulk
                .find({employerId: checkChat.candidateId, candidateId: checkChat.employerId})
                .update({$set: {isCandidateBlocked: true}});
            try {
                await bulk.execute();
            } catch (e) {
                logger.error('Error occurred updating conversation information in block user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'User blocked', 'success', 204)).code(200);
};

userHandler.reportUser = async (request, h) => {
    let checkUser, checkChat, otherUser, checkOtherUser;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in report user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in report user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check whether chat exists */
    try {
        checkChat = await conversationSchema.conversationSchema.findById({_id: request.payload.chatId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding chat information in report user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Add userId into reportedBy array in user collection */
    let updateCriteria, updateCriteriaChat;
    if (checkChat.candidateId.toString() === request.payload.userId.toString()) {
        updateCriteria = {$push: {reportedBy: checkChat.employerId}};
        otherUser = checkChat.employerId;
        updateCriteriaChat = {$set: {isCandidateReported: true, reportReason: request.payload.reportReason ? request.payload.reportReason : ''}};
    } else {
        updateCriteria = {$push: {reportedBy: checkChat.candidateId}};
        otherUser = checkChat.candidateId;
        updateCriteriaChat = {$set: {isEmployerReported: true, reportReason: request.payload.reportReason ? request.payload.reportReason : ''}};
    }
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, updateCriteria, {lean: true});
    } catch (e) {
        logger.error('Error occurred updating user information in report user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Add record into the report user collection */
    try {
        await reportUserSchema.reportUserSchema.findOneAndUpdate({userId: otherUser}, {$set: {userId: otherUser, reportedUserId: mongoose.Types.ObjectId(request.payload.userId), reportReason: request.payload.reportReason ? request.payload.reportReason : ''}}, {lean: true, upsert: true});
    } catch (e) {
        logger.error('Error occurred updating/upserting report user data in report user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Fetch other user */
    try {
        checkOtherUser = await userSchema.UserSchema.findById({_id: otherUser}, {email: 1, firstName: 1, lastName: 1, phone: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding other user information in report user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update conversation */
    try {
        await conversationSchema.conversationSchema.findByIdAndUpdate({_id: request.payload.chatId}, updateCriteriaChat, {lean: true, new: true});
    } catch (e) {
        logger.error('Error occurred updating conversation information in report user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send email to app support about the same */
    let email = {
        to: [{
            email: 'support@ezjobs.io',
            type: 'to'
        }],
        subject: checkUser.firstName + ' user has been reported by ' + checkOtherUser.firstName,
        important: true,
        merge: true,
        inline_css: true,
        merge_language: 'mailchimp',
        merge_vars: [{
            rcpt: 'support@ezjobs.io',
            vars: [
                {
                    name: 'label',
                    content: 'User'
                },
                {
                    name: 'jobname',
                    content: checkUser.firstName + ' (' + (checkUser.email ? checkUser.email: checkUser.phone) + ').'
                },
                {
                    name: 'reportedby',
                    content: (checkOtherUser.firstName + ' ' + checkOtherUser.lastName).trim()
                },
                {
                    name: 'email',
                    content: (checkOtherUser.email ? checkOtherUser.email: checkOtherUser.phone)
                },
                {
                    name: 'reason',
                    content: request.payload.reportReason
                },
                {
                    name: 'date',
                    content: new Date().toLocaleDateString('en', {year: 'numeric', month: 'long', day: 'numeric'})
                },
                {
                    name: 'userId',
                    content: checkUser.systemGeneratedId
                }
            ]
        }]
    };

    if (process.env.NODE_ENV === 'production') {
        try {
            await mandrill.Handlers.sendTemplate('ezjobs-report-user-job', [], email, true);
        } catch (e) {
            logger.error('Error occurred while sending email in report user handler %s:', JSON.stringify(e));
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'User reported', 'success', 204)).code(200);
};

userHandler.getBlockedUsers = async (request, h) => {
    let decoded, checkUser, blockedUsers;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in get blocked users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get blocked users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId.toString() !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Fetch list of users blocked by this user */
    let searchCriteria = {
        blockedBy: {$in: mongoose.Types.ObjectId(request.query.userId)}
    };

    if (request.query.searchText) {
        const text = decodeURIComponent(request.query.searchText);
        searchCriteria.$or = [{firstName: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {lastName: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {'employerInformation.companyName': new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}];
    }

    const projectionCriteria = {'employerInformation.companyName': 1, _id: 1, 'employerInformation.companyProfilePhoto': 1, firstName: 1, lastName: 1, 'employeeInformation.profilePhoto': 1}

    try {
        blockedUsers = await userSchema.UserSchema.find(searchCriteria, projectionCriteria, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding blocked user information in get blocked users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(blockedUsers, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.unblockUser = async (request, h) => {
    let decoded, checkUser;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in unblock user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in unblock user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId.toString() !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Remove user ID from blocked by array */
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.blockedUserId}, {$pull: {blockedBy: mongoose.Types.ObjectId(request.payload.userId)}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred updating user in unblock user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Remove document from block user collection */
    try {
        await blockUserSchema.blockSchema.findOneAndDelete({userId: mongoose.Types.ObjectId(request.payload.userId)});
    } catch (e) {
        logger.error('Error occurred deleting user from block user collection in unblock user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update conversation data */
    let bulk = conversationSchema.conversationSchema.collection.initializeUnorderedBulkOp();
    bulk
        .find({employerId: mongoose.Types.ObjectId(request.payload.blockedUserId), candidateId: mongoose.Types.ObjectId(request.payload.userId)})
        .update({$set: {isEmployerBlocked: false}});
    try {
        await bulk.execute();
    } catch (e) {
        logger.error('Error occurred updating conversation in unblock user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update conversation data */
    bulk
        .find({employerId: mongoose.Types.ObjectId(request.payload.userId), candidateId: mongoose.Types.ObjectId(request.payload.blockedUserId)})
        .update({$set: {isCandidateBlocked: false}});
    try {
        await bulk.execute();
    } catch (e) {
        logger.error('Error occurred updating conversation in unblock user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'User unblocked', 'success', 200)).code(200);
};

userHandler.reportJob = async (request, h) => {
    let decoded, checkUser, checkJob;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in report job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in report job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId.toString() !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether job exists */
    try {
        checkJob = await jobsSchema.jobSchema.findById({_id: request.payload.jobId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding job in report product handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkJob) {
        return h.response(responseFormatter.responseFormatter({}, 'Job not found', 'error', 404)).code(404);
    } else if (checkJob.userId.toString() === request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'You cannot report your own listing', 'error', 400)).code(400);
    }

    /* Update job info */
    try {
        await jobsSchema.jobSchema.findByIdAndUpdate({_id: request.payload.jobId}, {$push: {reportedBy: mongoose.Types.ObjectId(request.payload.userId), reportReason: request.payload.reportReason}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred updating job in report job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Add record into the report job collection */
    try {
        await reportJobSchema.reportJobSchema.findOneAndUpdate({userId: mongoose.Types.ObjectId(request.payload.userId)}, {$set: {userId: mongoose.Types.ObjectId(request.payload.userId), jobId: mongoose.Types.ObjectId(request.payload.jobId), reportReason: request.payload.reportReason ? request.payload.reportReason : ''}}, {lean: true, upsert: true});
    } catch (e) {
        logger.error('Error occurred updating/upserting report job data in report user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send email about the same to app support */

    let email = {
        to: [{
            email: 'support@ezjobs.io',
            type: 'to'
        }],
        subject: checkJob.jobTitle + ' job has been reported by user',
        important: true,
        merge: true,
        inline_css: true,
        merge_language: 'mailchimp',
        merge_vars: [{
            rcpt: 'support@ezjobs.io',
            vars: [
                {
                    name: 'label',
                    content: 'Job title'
                },
                {
                    name: 'jobname',
                    content: checkJob.jobTitle
                },
                {
                    name: 'reportedby',
                    content: (checkUser.firstName + ' ' + checkUser.lastName).trim()
                },
                {
                    name: 'email',
                    content: checkUser.email ? checkUser.email : checkUser.phone
                },
                {
                    name: 'reason',
                    content: request.payload.reportReason
                },
                {
                    name: 'date',
                    content: new Date().toLocaleDateString('en', {year: 'numeric', month: 'long', day: 'numeric'})
                },
                {
                    name: 'userId',
                    content: checkJob.systemGeneratedId
                }
            ]
        }]
    };

    if (process.env.NODE_ENV === 'production') {
        try {
            await mandrill.Handlers.sendTemplate('ezjobs-report-user-job', [], email, true);
        } catch (e) {
            logger.error('Error occurred while sending email in add user handler %s:', JSON.stringify(e));
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Thank you for reporting this listing. We will review it and act on it if we find anything inappropriate.', 'success', 204)).code(200);
};

userHandler.deleteChat = async (request, h) => {
    let checkUser, decoded, updateCriteria, searchCriteria, updatedChat;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in delete chat handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in delete chat handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Change the parameter accordingly in conversation schema to mark chat as deleted */
    if (request.query.role.toLowerCase() === 'candidate') {
        searchCriteria = {
            candidateId: mongoose.Types.ObjectId(request.query.userId),
            _id: mongoose.Types.ObjectId(request.query.chatId)
        };
        updateCriteria = {
            hasCandidateDeleted: true,
            'chats.$[].hasCandidateDeleted': true
        };
    } else {
        searchCriteria = {
            employerId: mongoose.Types.ObjectId(request.query.userId),
            _id: mongoose.Types.ObjectId(request.query.chatId)
        };
        updateCriteria = {
            hasEmployerDeleted: true,
            'chats.$[].hasEmployerDeleted': true
        };
    }
    try {
        updatedChat = await conversationSchema.conversationSchema.update(searchCriteria, {$set: updateCriteria}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in updating conversation in delete chat handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!updatedChat) {
        return h.response(responseFormatter.responseFormatter({}, 'Chat not found', 'error', 404)).code(404);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Chat deleted successfully', 'success', 202)).code(202);
};

userHandler.getAWSCredentials = async (request, h) => {
    let constantData;

    try {
        constantData = await constantSchema.constantSchema.findOne({secretToken: request.query.secretToken}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding secret token from constants in get AWS credentials handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!constantData) {
        return h.response(responseFormatter.responseFormatter({}, 'Invalid token', 'error', 400)).code(400);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({accessKeyId: AWS.s3.accessKeyId, secretKey: AWS.s3.secretAccessKey, googleAPIKey: googleAPIKey.googleKey}, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getChatsUnreadCount = async (request, h) => {
    let checkUser, decoded, candidateChatCount, employerChatCount, totalChatUnreadCount, totalUnreadNotificationCount;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in get unread count of chats handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get unread count of chats handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get unread chats count */
    try {
        candidateChatCount = await conversationSchema.conversationSchema.aggregate([
            {
                $match: {
                    candidateId: mongoose.Types.ObjectId(request.query.userId),
                    hasCandidateDeleted: false
                }
            },
            {
                $unwind: '$chats'
            },
            {
                $match: {
                    'chats.hasCandidateDeleted': false,
                    'chats.isCandidateBlocked': false,
                    'chats.to': mongoose.Types.ObjectId(request.query.userId),
                    'chats.isRead': false
                }
            },
            {
                $count: 'unread'
            }
        ])
    } catch (e) {
        logger.error('Error occurred while counting unread chats count data in get unread count of chats %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (candidateChatCount.length) {
        candidateChatCount = candidateChatCount[0].unread;
    } else {
        candidateChatCount = 0;
    }

    try {
        employerChatCount = await conversationSchema.conversationSchema.aggregate([
            {
                $match: {
                    employerId: mongoose.Types.ObjectId(request.query.userId),
                    hasEmployerDeleted: false
                }
            },
            {
                $unwind: '$chats'
            },
            {
                $match: {
                    'chats.hasEmployerDeleted': false,
                    'chats.isEmployerBlocked': false,
                    'chats.to': mongoose.Types.ObjectId(request.query.userId),
                    'chats.isRead': false
                }
            },
            {
                $count: 'unread'
            }
        ])
    } catch (e) {
        logger.error('Error occurred while counting unread chats count data in get unread count of chats handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (employerChatCount.length) {
        employerChatCount = employerChatCount[0].unread;
    } else {
        employerChatCount = 0;
    }
    totalChatUnreadCount = checkUser.roles[0].toLowerCase() === 'candidate' ? candidateChatCount : employerChatCount;

    /* Get unread notification count */
    try {
        totalUnreadNotificationCount = await notificationSchema.notificationSchema.countDocuments({sentTo: mongoose.Types.ObjectId(request.query.userId), isRead: false});
    } catch (e) {
        logger.error('Error occurred while counting unread notification count data in get unread count of chats handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({count: totalChatUnreadCount, notificationCount: totalUnreadNotificationCount}, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.unsubscribe = async (request, h) => {
    if (request.payload.Body.toLowerCase() === 'stop') {
        const email = request.payload.From.replace('+', '') + '@ezjobs.io';
        /* Mark unsubscribe flag to true */
        try {
            await userSchema.UserSchema.findOneAndUpdate({email: email}, {$set: {isUnsubscribed: true}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating unsubscribe flag in unsubscribe handler webhook %s:', JSON.stringify(e));
        }
    } else if (request.payload.Body.toLowerCase() === 'start') {
        const email = request.payload.From.replace('+', '') + '@ezjobs.io';
        /* Mark unsubscribe flag to true */
        try {
            await userSchema.UserSchema.findOneAndUpdate({email: email}, {$set: {isUnsubscribed: false}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating unsubscribe flag in unsubscribe handler webhook %s:', JSON.stringify(e));
        }
    }

    return h.response().code(200);
};

userHandler.voice = async (request, h) => {
    let xml = builder.create('Response').ele('Dial', {}, '646-701-0066').end({pretty: true});
    return h.response(xml).type('application/xml').code(200);
};

userHandler.signUpForBulkUploads = async (request, h) => {
    let checkUser, currency, newCheckUser, decoded, data;

    /* Check if user exists in database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user information in sign up for bulk uploads handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'Your user has been removed from the system as it was not claimed in the given time', 'error', 404)).code(404);
    } else if (checkUser.hasOwned) {
        return h.response(responseFormatter.responseFormatter({}, 'You have already owned this account', 'error', 400)).code(400);
    }

    /* Check whether access token is valid */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in sign up for bulk uploads handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* If user is not changing his/her email address notify him */
    let result = request.payload.email.match(/\b(\w*ezjobs\w*)\b/g);
    if (result) {
        return h.response(responseFormatter.responseFormatter({}, 'You must use your email address not the system generated', 'error', 400)).code(400);
    }

    /* Check if new email user exists */
    try {
        newCheckUser = await userSchema.UserSchema.findOne({
            email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi'),
            _id: {$ne: mongoose.Types.ObjectId(request.payload.userId)}
        }, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user information in sign up for bulk uploads handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (newCheckUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User already exists', 'error', 409)).code(409);
    }

    /* If signing with facebook check whether first name is coming or not */
    if (request.payload.facebookId && !request.payload.facebookId.id && request.payload.facebookId.token) {
        return h.response(responseFormatter.responseFormatter({}, 'We are having trouble connecting to Facebook. Please try again.', 'error', 400)).code(400);
    }

    /* Fetch currency from the country and update accordingly */
    try {
        currency = await codeSchema.CodeSchema.findOne({countryISOName: request.payload.country}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching currency information in sign up for bulk uploads handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (currency) {
        checkUser.currency = currency.currencyName;
    }

    checkUser.employerInformation.country = request.payload.country;
    checkUser.employeeInformation.country = request.payload.country;

    /* Update address data of the user company */
    try {
        data = await commonFunctions.Handlers.reverseGeocode(checkUser.employerInformation.companyLocation.coordinates[1], checkUser.employerInformation.companyLocation.coordinates[0]);
    } catch (e) {
        logger.error('Error occurred while reverse geocoding in sign up for bulk uploads handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (data !== 'error') {
        checkUser.employeeInformation.address.address1 = data.address1;
        checkUser.employeeInformation.address.address2 = data.address2;
        checkUser.employeeInformation.address.city = data.city;
        checkUser.employeeInformation.address.state = data.state;
        checkUser.employeeInformation.address.zipCode = data.zipCode;
        checkUser.employeeInformation.address.subLocality = data.subLocality;

        checkUser.employerInformation.companyAddress.address1 = data.address1;
        checkUser.employerInformation.companyAddress.address2 = data.address2;
        checkUser.employerInformation.companyAddress.city = data.city;
        checkUser.employerInformation.companyAddress.state = data.state;
        checkUser.employerInformation.companyAddress.zipCode = data.zipCode;
        checkUser.employerInformation.companyAddress.subLocality = data.subLocality;
    }

    /* If logging in with facebook or google or linkedin, set emailVerified flag to true */
    if (request.payload.googleId || request.payload.facebookId || request.payload.linkedInId) {
        checkUser.emailVerified = true;
    }

    /* Setting all the parameters required from the payload */
    if (request.payload.profilePhoto) {
        checkUser.employeeInformation.profilePhoto = request.payload.profilePhoto;
    }

    checkUser.firstName = request.payload.firstName;
    checkUser.email = request.payload.email;
    checkUser.hasOwned = true;

    if (request.payload.lastName) {
        checkUser.lastName = request.payload.lastName;
    }


    /* If password is provided encrypt it and store it otherwise remove it */
    if (request.payload.password) {
        try {
            checkUser.password = await bcrypt.hash(request.payload.password, SALT_WORK_FACTOR);
        } catch (e) {
            logger.error('Error occurred while encrypting password in sign up for bulk uploads handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        request.payload.password = '';
    }

    /* Check if user is signing up using social media */
    if (request.payload.facebookId) {
        checkUser.facebookId = request.payload.facebookId;
    } else if (request.payload.googleId) {
        checkUser.googleId = request.payload.googleId;
    } else if (request.payload.linkedInId) {
        checkUser.linkedInId = request.payload.linkedInId;
    }

    /* Set referral code */
    checkUser.referralCode = commonFunctions.Handlers.generateReferralCode(checkUser.firstName);

    /* Update user data */
    try {
        checkUser = await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, {$set: checkUser}, {lean: true, new: true});
    } catch (e) {
        logger.error('Error occurred while updating user information in sign up for bulk uploads handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update job data of that user, set isAddedByBulkUpload flag to false */
    let bulk = jobsSchema.jobSchema.collection.initializeUnorderedBulkOp();
    bulk.find({userId: mongoose.Types.ObjectId(checkUser._id)}).update({$set: {isAddedByBulkUpload: false}});
    try {
        await bulk.execute();
    } catch (e) {
        logger.error('Error occurred while updating job information in sign up for bulk uploads handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    delete checkUser.password;

    try {
        const tokenWithExpiry = commonFunctions.Handlers.createAuthTokenWithExpiry(checkUser._id, 'Candidate');

        /* Send verification email to user */
        if (!checkUser.emailVerified) {
            const verificationUrl = emailVerificationUrl + '/user/verify?token=' + tokenWithExpiry;
            try {
                let email = {
                    to: [{
                        email: request.payload.email,
                        name: (request.payload.firstName + ' ' + request.payload.lastName).trim(),
                        type: 'to'
                    }],
                    important: false,
                    merge: true,
                    inline_css: false,
                    merge_language: 'mailchimp',
                    merge_vars: [{
                        rcpt: request.payload.email,
                        vars: [{
                            name: 'VERIFYEMAIL',
                            content: verificationUrl
                        }, {
                            name: 'VERIFYEMAILURL',
                            content: verificationUrl
                        }]
                    }]
                };
                await mandrill.Handlers.sendTemplate('ezjobs-email-verification', [], email, true)
            } catch (e) {
                logger.error('Error in sending verification link to user %s:', JSON.stringify(e));
            }
        }

        /* Send welcome email */
        try {
            let email = {
                to: [{
                    email: request.payload.email,
                    name: (request.payload.firstName + ' ' + request.payload.lastName).trim(),
                    type: 'to'
                }],
                important: false,
                merge: true,
                merge_language: 'mailchimp',
                merge_vars: [{
                    rcpt: request.payload.email,
                    vars: [{
                        name: 'FNAME',
                        content: request.payload.firstName
                    }]
                }]
            };
            await mandrill.Handlers.sendTemplate('ezjobs-welcome', [], email, true)
        } catch (e) {
            logger.error('Error in sending verification link to user %s:', JSON.stringify(e));
        }

        /* Remove device token of all other devices having same device token */
        let bulk = userSchema.UserSchema.collection.initializeUnorderedBulkOp();
        bulk.find({_id: {$ne: checkUser._id}, deviceToken: checkUser.deviceToken}).update({$set: {deviceToken: ''}});
        try {
            await bulk.execute();
        } catch (e) {
            logger.error('Error occurred while removing other device tokens in create user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Create contact into hub spot */
        if (process.env.NODE_ENV === 'production') {
            let contactSource, source;
            if (checkUser.facebookId.id) {
                source = 'Facebook';
            } else if (checkUser.googleId.id) {
                source = 'Google';
            } else if (checkUser.linkedInId.id) {
                source = 'Linkedin';
            } else {
                source = 'Email';
            }
            if (checkUser.deviceType.toLowerCase() === 'android') {
                contactSource = 'Android App';
            } else if (checkUser.deviceType.toLowerCase() === 'ios') {
                contactSource = 'IOS App';
            }
            let status = await commonFunctions.Handlers.createHubSpotContact(checkUser.firstName, checkUser.lastName, checkUser.email, countryList.getName(checkUser.employeeInformation.country), contactSource, source, 'customer', checkUser.employeeInformation.address.city, checkUser.employeeInformation.address.state);
            if (status === 'error') {
                logger.error('Error occurred while creating hub spot contact');
            }
        }
    } catch (e) {
        logger.error('%s', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({authToken: request.auth.credentials.token, userInfo: checkUser}, 'User information updated', 'success', 204)).code(200);
};

userHandler.dynamicLink = async (request, h) => {
    let link;

    link = await commonFunctions.Handlers.createFirebaseShortLink(request.query.email ? request.query.email : '', '', request.query.candidateId ? request.query.candidateId : '');

    return h.response(responseFormatter.responseFormatter(link.shortLink, 'success', 'success', 200)).code(200);
};

userHandler.getInvitedCandidates = async (request, h) => {
    let checkUser, decoded, users;

    /* Check if user exists in database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user information in get invited candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user', 'error', 404)).code(404);
    }

    /* Check whether access token is valid */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get invited candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Fetch all the details candidates who are invited */
    try {
        users = await conversationSchema.conversationSchema.aggregate([
            {
                $match: {
                    employerId: mongoose.Types.ObjectId(request.query.userId),
                    isInvited: true
                }
            },
            {
                $lookup: {
                    localField: 'jobId',
                    foreignField: '_id',
                    from: 'Job',
                    as: 'job'
                }
            },
            {
                $unwind: '$job'
            },
            {
                $lookup: {
                    localField: 'candidateId',
                    foreignField: '_id',
                    from: 'User',
                    as: 'candidate'
                }
            },
            {
                $unwind: '$candidate'
            },
            {
                $project: {
                    candidateFirstName: '$candidate.firstName',
                    candidateLastName: '$candidate.lastName',
                    candidateId: '$candidate._id',
                    jobId: '$job._id',
                    jobTitle: '$job.jobTitle',
                    isApplied: 1,
                    numberOfMessages: {$size: '$chats'}
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred aggregating conversation collection in get invited candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(users, 'Fetched successfully', 'success', 200)).code(200);

};

userHandler.getAppliedJobs = async (request, h) => {
    let checkUser, decoded, jobs;

    /* Check if user exists in database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user information in get applied jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user', 'error', 404)).code(404);
    }

    /* Check whether access token is valid */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get applied jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Fetch all the details candidates who are invited */
    try {
        jobs = await conversationSchema.conversationSchema.aggregate([
            {
                $match: {
                    candidateId: mongoose.Types.ObjectId(request.query.userId),
                    isApplied: true
                }
            },
            {
                $lookup: {
                    localField: 'jobId',
                    foreignField: '_id',
                    from: 'Job',
                    as: 'job'
                }
            },
            {
                $unwind: '$job'
            },
            {
                $lookup: {
                    localField: 'employerId',
                    foreignField: '_id',
                    from: 'User',
                    as: 'employer'
                }
            },
            {
                $unwind: '$employer'
            },
            {
                $project: {
                    employerFirstName: '$employer.firstName',
                    employerLastName: '$employer.lastName',
                    companyName: '$employer.employerInformation.companyName',
                    employerId: '$employer._id',
                    jobId: '$job._id',
                    jobTitle: '$job.jobTitle',
                    isHired: 1,
                    numberOfMessages: {$size: '$chats'}
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred aggregating conversation collection in get applied jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(jobs, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getMinMaxSalaries = async (request, h) => {
    // let [minHourlyResult, maxHourlyResult, minDailyResult, maxDailyResult, minWeeklyResult, maxWeeklyResult, minMonthlyResult, maxMonthlyResult, minYearlyResult, maxYearlyResult, minAnyResult, maxAnyResult] = await Promise.all([await minHourlyF(), await maxHourlyF(), await minDailyF(), await maxDailyF(), await minWeeklyF(), await maxWeeklyF(), await minMonthlyF(), await maxMonthlyF(), await minYearlyF(), await maxYearlyF(), await minAnyF(), await maxAnyF()]);
   /* let finalResult = [
        {
            type: 'hourly',
            min: minHourlyResult[0] ? minHourlyResult[0].minValue : 0,
            max: maxHourlyResult[0] ? maxHourlyResult[0].maxValue : 0
        },
        {
            type: 'daily',
            min: minDailyResult[0] ? minDailyResult[0].minValue : 0,
            max: maxDailyResult[0] ? maxDailyResult[0].maxValue : 0
        },
        {
            type: 'weekly',
            min: minWeeklyResult[0] ? minWeeklyResult[0].minValue : 0,
            max: maxWeeklyResult[0] ? maxWeeklyResult[0].maxValue : 0
        },
        {
            type: 'monthly',
            min: minMonthlyResult[0] ? minMonthlyResult[0].minValue : 0,
            max: maxMonthlyResult[0] ? maxMonthlyResult[0].maxValue : 0
        },
        {
            type: 'yearly',
            min: minYearlyResult[0] ? minYearlyResult[0].minValue : 0,
            max: maxYearlyResult[0] ? maxYearlyResult[0].maxValue : 0
        },
        {
            type: 'any',
            min: minAnyResult[0] ? minAnyResult[0].minValue : 0,
            max: maxAnyResult[0] ? maxAnyResult[0].maxValue : 0
        }
    ];*/

     let finalResult = [
         {
             type: 'hourly',
             min: 0,
             max: 1000
         },
         {
             type: 'daily',
             min: 0,
             max: 10000
         },
         {
             type: 'weekly',
             min: 0,
             max: 100000
         },
         {
             type: 'monthly',
             min: 0,
             max: 1000000
         },
         {
             type: 'yearly',
             min: 0,
             max: 10000000
         },
         {
             type: 'any',
             min: 0,
             max: 10000000
         }
     ];

    /* Functions that will be run parallel for getting salary numbers */
    function minHourlyF() {
        return userSchema.UserSchema.aggregate([
            {
                $match: {
                    'employeeInformation.expectedSalaryType': new RegExp(/hourly/, 'gi'),
                    'employeeInformation.country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    minValue: {$min: '$employeeInformation.expectedSalary'}
                }
            }
        ]);
    }

    function maxHourlyF() {
        return userSchema.UserSchema.aggregate([
            {
                $match: {
                    'employeeInformation.expectedSalaryType': new RegExp(/hourly/, 'gi'),
                    'employeeInformation.country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    maxValue: {$max: '$employeeInformation.expectedSalary'}
                }
            }
        ]);
    }

    function minDailyF() {
        return userSchema.UserSchema.aggregate([
            {
                $match: {
                    'employeeInformation.expectedSalaryType': new RegExp(/daily/, 'gi'),
                    'employeeInformation.country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    minValue: {$min: '$employeeInformation.expectedSalary'}
                }
            }
        ]);
    }

    function maxDailyF() {
        return userSchema.UserSchema.aggregate([
            {
                $match: {
                    'employeeInformation.expectedSalaryType': new RegExp(/daily/, 'gi'),
                    'employeeInformation.country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    maxValue: {$max: '$employeeInformation.expectedSalary'}
                }
            }
        ]);
    }

    function minWeeklyF() {
        return userSchema.UserSchema.aggregate([
            {
                $match: {
                    'employeeInformation.expectedSalaryType': new RegExp(/weekly/, 'gi'),
                    'employeeInformation.country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    minValue: {$min: '$employeeInformation.expectedSalary'}
                }
            }
        ]);
    }

    function maxWeeklyF() {
        return userSchema.UserSchema.aggregate([
            {
                $match: {
                    'employeeInformation.expectedSalaryType': new RegExp(/weekly/, 'gi'),
                    'employeeInformation.country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    maxValue: {$max: '$employeeInformation.expectedSalary'}
                }
            }
        ]);
    }

    function minMonthlyF() {
        return userSchema.UserSchema.aggregate([
            {
                $match: {
                    'employeeInformation.expectedSalaryType': new RegExp(/monthly/, 'gi'),
                    'employeeInformation.country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    minValue: {$min: '$employeeInformation.expectedSalary'}
                }
            }
        ]);
    }

    function maxMonthlyF() {
        return userSchema.UserSchema.aggregate([
            {
                $match: {
                    'employeeInformation.expectedSalaryType': new RegExp(/monthly/, 'gi'),
                    'employeeInformation.country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    maxValue: {$max: '$employeeInformation.expectedSalary'}
                }
            }
        ]);
    }

    function minYearlyF() {
        return userSchema.UserSchema.aggregate([
            {
                $match: {
                    'employeeInformation.expectedSalaryType': new RegExp(/yearly/, 'gi'),
                    'employeeInformation.country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    minValue: {$min: '$employeeInformation.expectedSalary'}
                }
            }
        ]);
    }

    function maxYearlyF() {
        return userSchema.UserSchema.aggregate([
            {
                $match: {
                    'employeeInformation.expectedSalaryType': new RegExp(/yearly/, 'gi'),
                    'employeeInformation.country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    maxValue: {$max: '$employeeInformation.expectedSalary'}
                }
            }
        ]);
    }

    function minAnyF() {
        return userSchema.UserSchema.aggregate([
            {
                $match: {
                    'employeeInformation.country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    minValue: {$min: '$employeeInformation.expectedSalary'}
                }
            }
        ]);
    }

    function maxAnyF() {
        return userSchema.UserSchema.aggregate([
            {
                $match: {
                    'employeeInformation.country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    maxValue: {$max: '$employeeInformation.expectedSalary'}
                }
            }
        ]);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(finalResult, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.callEmployer = async (request, h) => {
    let employer, candidate, job;

    /* Get employer data */
    try {
        employer = await userSchema.UserSchema.findById({_id: request.payload.employerId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred updating employer data in call employer handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Increase the count of the user */
    try {
        candidate = await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.candidateId}, {$inc: {'employeeInformation.numberOfCallsMade': 1}}, {lean: true, new: true});
    } catch (e) {
        logger.error('Error occurred updating candidate data in call employer handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Increase the count for that job */
    try {
        job = await jobsSchema.jobSchema.findByIdAndUpdate({_id: request.payload.jobId}, {$inc: {numberOfCallsMade: 1}}, {lean: true, new: true});
    } catch (e) {
        logger.error('Error occurred updating job data in call employer handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send email to the employer */
    if (employer.isAddedByBulkUpload && !employer.hasOwned && !employer.isUnsubscribed) {
        let dynamicLink = await commonFunctions.Handlers.createFirebaseShortLink(employer.email, '', candidate._id);

        if (job) {
            if (dynamicLink !== 'error') {
                let result = employer.email.match(/\b(\w*ezjobs\w*)\b/g);
                if (!result) {
                    /* Send app download email */
                    try {
                        let email = {
                            to: [{
                                email: employer.email,
                                type: 'to'
                            }],
                            important: true,
                            merge: true,
                            inline_css: true,
                            merge_language: 'mailchimp',
                            merge_vars: [{
                                rcpt: employer.email,
                                vars: [
                                    {
                                        name: 'email',
                                        content: employer.email
                                    },
                                    {
                                        name: 'password',
                                        content: employer.tempPassword
                                    },
                                    {
                                        name: 'downloadURL',
                                        content: dynamicLink.shortLink
                                    },
                                    {
                                        name: 'jobTitle',
                                        content: job.jobTitle
                                    }
                                ]
                            }]
                        };
                        await mandrill.Handlers.sendTemplate('app-download-call', [], email, true);
                        try {
                            await userSchema.UserSchema.findByIdAndUpdate({_id: employer._id}, {$set: {'employeeInformation.lastEmailSent': Date.now()}, $inc: {'employeeInformation.numberOfEmailsSent': 1}}, {lean: true, new: true});
                        } catch (e) {
                            logger.error('Error occurred while updating user details in call employer handler %s:', JSON.stringify(e));
                        }
                    } catch (e) {
                        logger.error('Error in sending app download link to user %s:', JSON.stringify(e));
                    }
                }
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
};

userHandler.getLocationIpApi = async (request, h) => {
    if (request.info.host === 'localhost:4200' || request.info.host === 'testapi.ezjobs.io' || request.info.host === 'api.ezjobs.io') {
        let locationData;

        /* Call ipapi API to fetch location data from IP address */
        const options = {
            method: 'GET',
            uri: 'https://ipapi.co/' + request.query.ipAddress +'/json/?key=e3b7300466cf533b04ae9c19a15a2e98cbebef54',
            json: true
        };

        try {
            locationData = await rp(options);
        } catch (e) {
            logger.error('error occurred while calling ipapi API %s', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (locationData.error) {
            return h.response(responseFormatter.responseFormatter({}, locationData.reason, 'error', 400)).code(400);
        }

        return h.response(responseFormatter.responseFormatter(locationData, 'Fetched successfully', 'success', 200)).code(200);
    } else {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to access this content', 'error', 401)).code(401);
    }
};

userHandler.updatePreference = async (request, h) => {
    let decoded, checkUser, updateCriteria, skillsLower = [], updatedData;

    /* Check if user exists in database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user information in update preference handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user', 'error', 404)).code(404);
    }

    /* Check whether access token is valid */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get applied jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check role and update accordingly */
    if (request.payload.role.toLowerCase() === 'candidate') {
        updateCriteria = {
            $set: {
                'employeeInformation.preference': request.payload.preference,
                isPreferenceSet: true,
                roles: ['Candidate'],
                isRoleSet: true
            }
        };
        if (request.payload.skills) {
            for (let i = 0; i < request.payload.skills.length; i++) {
                skillsLower.push(request.payload.skills[i].toLowerCase());
            }
            updateCriteria.$set['employeeInformation.skills'] = request.payload.skills;
            updateCriteria.$set['employeeInformation.skillsLower'] = skillsLower;
            if (!skillsLower.length && checkUser.employeeInformation.isComplete) {
                updateCriteria.$set['employeeInformation.isComplete'] = false;
            } else {
                updateCriteria.$set['employeeInformation.isComplete'] = checkUser.employeeInformation.isComplete;
            }
        }
    } else {
        updateCriteria = {
            $set: {
                'employerInformation.preference': request.payload.preference,
                isPreferenceSet: true,
                roles: ['Employer'],
                isRoleSet: true
            }
        };
        if (request.payload.skills) {
            for (let i = 0; i < request.payload.skills.length; i++) {
                skillsLower.push(request.payload.skills[i].toLowerCase());
            }
            updateCriteria.$set['employerInformation.skillsPreference'] = request.payload.skills;
            updateCriteria.$set['employerInformation.skillsPreferenceLower'] = skillsLower;
        }
        if (!checkUser.isRoleSet) {
            updateCriteria.$set['employerInformation.companyProfilePhoto'] = checkUser.employeeInformation.profilePhoto;
        }
    }
    try {
        updatedData = await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, updateCriteria, {lean: true, new: true});
    } catch (e) {
        logger.error('Error occurred updating user information in update preference handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update these fields in hubspot */
    let categories = [], hubSpotProperties = [];
    for (let i = 0; i < request.payload.preference.length; i++) {
        /* Get category names */
        let category;
        try {
            category = await categorySchema.categorySchema.findById({_id: request.payload.preference[i]}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred updating user information in update preference handler %s:', JSON.stringify(e));
        }
        if (category) {
            categories.push(category.categoryName);
        }
    }

    if (request.payload.role.toLowerCase() === 'candidate') {
        hubSpotProperties.push({
            property: 'candidate_job_preference',
            value: categories.join(', ')
        });
    } else {
        hubSpotProperties.push({
            property: 'employer_job_preference',
            value: categories.join(', ')
        });
        if (request.payload.skills) {
            hubSpotProperties.push({
                property: 'company_skills',
                value: request.payload.skills.join(', ')
            });
        }
    }

    /* Call HubSpot API to update */
    if (process.env.NODE_ENV === 'production') {
        if (hubSpotProperties.length) {
            let status = await commonFunctions.Handlers.updateHubSpotContact(checkUser.email, hubSpotProperties);
            if (status === 404) {
                console.log('HubSpot contact not found');
            }
        }
    }

    delete updatedData.password;
    delete updatedData.employerInformation.pan;
    /* Success */
    return h.response(responseFormatter.responseFormatter(updatedData, 'Preference updated', 'success', 204)).code(200);
};

userHandler.dataForPreferenceScreen = async (request, h) => {
    /* Count total number of users */
    function totalUsers() {
        return userSchema.UserSchema.countDocuments({});
    }

    /* Count total number of jobs */
    function totalJobs() {
        return jobsSchema.jobSchema.countDocuments({});
    }

    /* Count numbers in parallel */
    let [totalUsersCount, totalJobsCount] = await Promise.all([await totalUsers(), await totalJobs()]);

    /* Round it to nearest hundred value */
    totalUsersCount = Math.round(totalUsersCount / 100) * 100;
    totalJobsCount = Math.round(totalJobsCount / 100) * 100;

    /* Success */
    return h.response(responseFormatter.responseFormatter({totalJobs: totalJobsCount, totalUsers: totalUsersCount}, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getMinMaxSalariesTest = async (request, h) => {
    let salaryData = [
        {
            type: 'hourly',
            min: 0,
            max: 0
        },
        {
            type: 'daily',
            min: 0,
            max: 0
        },
        {
            type: 'weekly',
            min: 0,
            max: 0
        },
        {
            type: 'monthly',
            min: 0,
            max: 0
        },
        {
            type: 'yearly',
            min: 0,
            max: 0
        },
        {
            type: 'any',
            min: 0,
            max: 0
        }
    ], data, min = [], max = [];

    try {
        data = await minMaxSalarySchema.minMaxSalarySchema.find({country: request.query.country, role: 'user'}, {country: 0, _id: 0, createdAt: 0, updatedAt: 0, role: 0, __v: 0}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding min max salary data in get min max salaries handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < data.length; i++) {
        min.push(data[i].min);
        max.push(data[i].max);
        const idx = salaryData.findIndex(k => k.type === data[i].type);
        if (idx !== -1) {
            salaryData[idx].min = data[i].min;
            salaryData[idx].max = data[i].max;
        }
        /*salaryData.push(data[i]);*/
    }
    if (data.length) {
        min.sort((a, b) => {
            return a - b;
        });
        max.sort((a, b) => {
            return b - a;
        });
        salaryData.pop();
        salaryData.push({type: 'any', min: min[0], max: max[0]});
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(salaryData, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getCountry = async (request, h) => {
    let data, country;
    data = await commonFunctions.Handlers.reverseGeocode(request.query.latitude, request.query.longitude, true);
    if (data !== 'error') {
        return h.response(responseFormatter.responseFormatter({address: data}, 'Fetched successfully', 'success', 200)).code(200);
    }
    return h.response(responseFormatter.responseFormatter({}, 'Something went wrong while fetching country information! Please try again later.', 'error', 400)).code(400);
};

userHandler.rateCall = async (request, h) => {
    let checkUser, decoded, checkConversation;

    /* Check if user exists in database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user information in rate call handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user', 'error', 404)).code(404);
    }

    /* Check whether access token is valid */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in rate call handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Update conversation */
    let dataToUpdate;

    if (request.payload.isPA) {
        /* Check if conversation exists */
        try {
            checkConversation = await chatSchema.chatSchema.findOne({callRoomId: request.payload.callRoomId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding conversation in rate call handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkConversation) {
            return h.response(responseFormatter.responseFormatter({}, 'No such call', 'error', 404)).code(404);
        }

        if (request.payload.userId === checkConversation.senderId) {
            dataToUpdate = {
                'callHistory.$.ratingBySender': request.payload.rating
            };
        } else {
            dataToUpdate = {
                'callHistory.$.ratingByReceiver': request.payload.rating
            };
        }

        /* Update call record accordingly for rate */
        try {
            await chatSchema.chatSchema.findOneAndUpdate({callRoomId: request.payload.callRoomId, 'callHistory._id': mongoose.Types.ObjectId(request.payload.callId)}, {$set: dataToUpdate}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in updating chat in rate call handler %s', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

    } else {
        /* Check if conversation exists */
        try {
            checkConversation = await conversationSchema.conversationSchema.findOne({callRoomId: request.payload.callRoomId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding conversation in rate call handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkConversation) {
            return h.response(responseFormatter.responseFormatter({}, 'No such call', 'error', 404)).code(404);
        }

        if (request.payload.role.toLowerCase() === 'employer') {
            dataToUpdate = {
                'callHistory.$.ratingByEmployer': request.payload.rating
            };
        } else {
            dataToUpdate = {
                'callHistory.$.ratingByCandidate': request.payload.rating
            };
        }
        /* Update call record accordingly for rate */
        try {
            await conversationSchema.conversationSchema.findOneAndUpdate({callRoomId: request.payload.callRoomId, 'callHistory._id': mongoose.Types.ObjectId(request.payload.callId)}, {$set: dataToUpdate}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in updating chat in rate call handler %s', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Thank you for your rating.', 'success', 204)).code(200);
};

userHandler.popularCategories = async (request, h) => {
    let categories;

    /*
    * Fetch list of most clicked categories
    * */
    try {
        categories = await categorySchema.categorySchema.find({isActive: true, categoryNameLower: {$ne: 'others'}}, {}, {lean: true}).sort({clicks: -1}).limit(5);
    } catch (e) {
        logger.error('Error occurred in fetching most clicked categories in popular categories handler %s', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (process.env.NODE_ENV === 'production') {
        for (let i = 0; i < categories.length; i++) {
            if (i === 0 || i === 4) {
                categories[i].categoryImage = categories[i].image308x312;
            } else if (i === 1 || i === 2) {
                categories[i].categoryImage = categories[i].image200x148;
            } else if (i === 3) {
                categories[i].categoryImage = categories[i].image420x148;
            }
        }
    } else {
        for (let i = 0; i < categories.length; i++) {
            categories[i].categoryImage = categories[i].categoryImageForWeb;
        }
    }

    return h.response(responseFormatter.responseFormatter(categories, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.jobsOfTheWeek = async (request, h) => {
    let jobs;

    /*
    * Fetch list of Jobs of the week
    * */
    try {
        jobs = await jobsSchema.jobSchema.aggregate([
            {
                $match: {
                    createdAt: {$gte: new Date(momentTz.tz('America/New_York').startOf('year'))},
                    country: request.query.country,
                    isUnderReview: false,
                    isClosed: false,
                    isVisible: true,
                    isTranslated: false
                }
            },
            {
                $project: {
                    count: {$size: '$uniqueViews'},
                    jobTitle: 1,
                    subJobTitle: 1,
                    _id: 1,
                    userId: 1,
                    address: 1,
                    jobDescriptionText: 1,
                    payRate: 1,
                    experienceInMonths: 1,
                    ageRequired: 1,
                    jobType: 1,
                    country: 1,
                    createdAt: 1
                }
            },
            {
                $sort: {
                    createdAt: -1
                }
            },
            {
                $limit: 6
            },
            {
                $sort: {
                    count: -1
                }
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: '$user'
            },
            {
                $match: {
                    'user.employerInformation.companyName': {$ne: ''}
                }
            },
            {
                $project: {
                    jobTitle: {$cond: [{$eq: ["$jobTitle", "Others"]}, "$subJobTitle", "$jobTitle"]},
                    _id: 1,
                    companyPhoto: "$user.employerInformation.companyProfilePhoto",
                    companyName: "$user.employerInformation.companyName",
                    city: "$address.city",
                    state: "$address.state",
                    jobDescriptionText: 1,
                    payRate: 1,
                    experienceInMonths: 1,
                    ageRequired: 1,
                    jobType: 1,
                    country: 1,
                    createdAt: 1
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred in fetching jobs of the week in jobs of the week handler %s', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    let currency;

    for (let i = 0; i < jobs.length; i++) {
        const link = await commonFunctions.Handlers.createFirebaseShortLink('', jobs[i]._id, '', '', '', '', '', '');
        jobs[i].link = link.shortLink;
        try {
            currency = await codeSchema.CodeSchema.findOne({countryISOName: jobs[i].country}, {currency: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in getting currency data in jobs of the week handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        jobs[i].currency = currency.currency;
    }

    return h.response(responseFormatter.responseFormatter(jobs, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getGoogleSupportedLanguages = async (request, h) => {
    let languages;

    languages = await commonFunctions.Handlers.getGoogleSupportedLanguages();
    return h.response(responseFormatter.responseFormatter(languages, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getLanguages = async (request, h) => {
    let languages, searchCriteria, allLanguages;

    if (request.query.state && request.query.country === 'IN') {
        searchCriteria = {
            country: request.query.country,
            states: request.query.state
        };
    } else {
        searchCriteria = {
            country: request.query.country
        }
    }
    if (request.query.inProfile) {
        searchCriteria.inProfile = true;
    } else if (request.query.inAppLanguage) {
        searchCriteria.inAppLanguage = true;
    } else {
        searchCriteria.inChatLanguage = true;
    }

    try {
        languages = await languageSchema.languageSchema.find(searchCriteria, {country: 0, states: 0, rank: 0, inProfile: 0, inAppLanguage: 0, inChatLanguage: 0, createdAt: 0, updatedAt: 0, __v: 0}, {lean: true}).sort({rank: 1});
    } catch (e) {
        logger.error('Error occurred in fetching languages in get languages handler %s', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!languages.length) {
        try {
            languages = await languageSchema.languageSchema.find({country: 'IN', rank: 1}, {country: 0, states: 0, rank: 0, inProfile: 0, inAppLanguage: 0, inChatLanguage: 0, createdAt: 0, updatedAt: 0, __v: 0}, {lean: true}).sort({rank: 1});
        } catch (e) {
            logger.error('Error occurred in fetching languages in get languages handler %s', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        try {
            allLanguages = await languageSchema.languageSchema.find({country: request.query.country}, {country: 0, states: 0, rank: 0, inProfile: 0, inAppLanguage: 0, inChatLanguage: 0, createdAt: 0, updatedAt: 0, __v: 0}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in fetching all languages in get languages handler %s', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        for (let i = 0; i < allLanguages.length; i++) {
            const idx = languages.findIndex(k => k.language === allLanguages[i].language);
            if (idx === -1) {
                languages.push(allLanguages[i]);
            }
        }
    }

    return h.response(responseFormatter.responseFormatter(languages, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.changeUserLanguage = async (request, h) => {
    let checkUser, decoded, updateCriteria = {};

    /* Check if user exists in database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user information in change user language handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user', 'error', 404)).code(404);
    }

    /* Check whether access token is valid */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in change user language handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /*
    * Update language
    * */
    if (request.payload.inAppLanguage) {
        updateCriteria = {
            appLanguage: mongoose.Types.ObjectId(request.payload.languageId)
        };
    } else if (request.payload.inChatLanguage) {
        updateCriteria = {
            chatLanguage: mongoose.Types.ObjectId(request.payload.languageId)
        };
    }

    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$set: updateCriteria}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating user information in change user language handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
};

userHandler.getActivePackages = async (request, h) => {
    let packages, finalPackageData = [], currency, constantData, pricing;

    try {
        packages = await packageSchema.packageSchema.find({country: request.query.country, isActive: true, isVisible: true}, {numberOfUsersEnrolled: 0, rank: 0, isActive: 0, createdAt: 0, updatedAt: 0, __v: 0}, {lean: true}).sort({rank: 1});
    } catch (e) {
        logger.error('Error occurred while fetching packages information in get active packages handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get base prices */
    try {
        pricing = await pricingSchema.pricingSchema.findOne({country: request.query.country}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching pricing information in get active packages handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    try {
        currency = await codeSchema.CodeSchema.findOne({countryISOName: request.query.country}, {currency: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching currency information in get active packages handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!currency) {
        return h.response(responseFormatter.responseFormatter({}, 'Sorry this information is not available in your region.', 'error', 400)).code(400);
    }

    /* Get constant data */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {taxes: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching constant information in get active packages handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    const fields = ['_id', 'country', 'packageName', 'yearlyDiscount', 'monthlyDiscount', 'totalMonthly',
        'totalYearly', 'packageDiscount', 'currency', 'planIdMonthly', 'planIdAnnually', 'isFree', 'idx', 'trialPeriod',
        'totalMonthlyBeforeTax', 'totalYearlyBeforeTax', 'taxType', 'taxAmount', 'totalMonthlyOriginal', 'totalYearlyOriginal',
        'yearlyDiscountAmount', 'monthlyDiscountAmount', 'packageDiscountMonthlyAmount', 'packageDiscountYearlyAmount', 'isCustom',
        'isVisible', 'applicationValidity', 'validity', 'customText', 'newPackage', 'isWallet', 'strikeTotal', 'minQuantity', 'quantityDiscount',
        'colorCode', 'connectedPackage'];
    if (packages && packages.length) {
        for (let i = 0; i < packages.length; i++) {
            packages[i].currency = currency.currency;
            const features = Object.keys(packages[i]);
            let dataToPush = {};
            let feature = [];
            for (let j = 0; j < features.length; j++) {
                if (fields.indexOf(features[j]) !== -1) {
                    dataToPush[features[j]] = packages[i][features[j]];
                } else {
                    feature.push({
                        name: packages[i][features[j]].label,
                        heading: packages[i][features[j]].heading,
                        isFree: packages[i][features[j]].isFree,
                        isUnlimited: packages[i][features[j]].isUnlimited,
                        isIncluded: packages[i][features[j]].isIncluded,
                        monthlyCount: packages[i][features[j]].monthlyCount,
                        yearlyCount: packages[i][features[j]].yearlyCount,
                        type: packages[i][features[j]].type,
                        multiple: packages[i][features[j]].multiple,
                        key: features[j],
                        basePrice: pricing[features[j]] ? pricing[features[j]].basePrice : 0,
                        baseCount: pricing[features[j]] ? pricing[features[j]].count : 0,
                        minCount: packages[i][features[j]].minCount,
                        featureInfo: packages[i][features[j]].featureInfo
                    });
                }
            }

            let subFeatures = [];
            for (let a = 0; a < feature.length; a++) {
                const idx = subFeatures.findIndex(k => k.heading === feature[a].heading);
                if (idx !== -1) {
                    if (subFeatures[idx]['subFeatures']) {
                        subFeatures[idx]['subFeatures'].push(feature[a]);
                    } else {
                        subFeatures[idx]['subFeatures'] = [feature[a]];
                    }
                } else {
                    subFeatures.push({
                        heading: feature[a].heading,
                        subFeatures: [feature[a]]
                    });
                }
            }
            /*for (let i = 0; i < subFeatures.length; i++) {
                subFeatures[i].subFeatures.sort((a, b) => {
                    return b.isIncluded - a.isIncluded;
                });
            }*/
            dataToPush['features'] = subFeatures;
            finalPackageData.push(dataToPush);
        }
    }

    /* Calculate taxes */
    for (let i = 0; i < finalPackageData.length; i++) {
        if (finalPackageData[i].totalMonthlyBeforeTax && !finalPackageData[i].isCustom) {
            finalPackageData[i].monthlyTax = parseFloat((finalPackageData[i].totalMonthly - finalPackageData[i].totalMonthlyBeforeTax).toFixed(2));
            finalPackageData[i].yearlyTax = parseFloat((finalPackageData[i].totalYearly - finalPackageData[i].totalYearlyBeforeTax).toFixed(2));
        }
    }

    return h.response(responseFormatter.responseFormatter(finalPackageData, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getActivePackagesNew = async (request, h) => {
    let packages, finalPackageData = [], currency, internalParameters, pricing, showIncluded = true;

    try {
        packages = await packageSchema.packageSchema.find({country: request.query.country, isActive: true, isVisible: true}, {numberOfUsersEnrolled: 0, rank: 0, isActive: 0, createdAt: 0, updatedAt: 0, __v: 0}, {lean: true}).sort({rank: 1});
    } catch (e) {
        logger.error('Error occurred while fetching packages information in get new active packages handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get base prices */
    try {
        pricing = await pricingSchema.pricingSchema.findOne({country: request.query.country}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching pricing information in get new active packages handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    try {
        currency = await codeSchema.CodeSchema.findOne({countryISOName: request.query.country}, {currency: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching currency information in get new active packages handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!currency) {
        return h.response(responseFormatter.responseFormatter({}, 'Sorry this information is not available in your region.', 'error', 400)).code(400);
    }

    /* Get list of Internal Parameters */
    try {
        internalParameters = await internalParameterSchema.internalParameterSchema.findOne({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching internal parameters information in get new active packages handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (internalParameters) {
        showIncluded = !!internalParameters.showIncludedInPackages;
    }

    if (packages && packages.length) {
        for (let i = 0; i < packages.length; i++) {
            packages[i].currency = currency.currency;
            const features = Object.keys(packages[i]);
            let dataToPush = {};
            let feature = [];
            for (let j = 0; j < features.length; j++) {
                if (typeof packages[i][features[j]] !== 'object' || features[j] === '_id') {
                    dataToPush[features[j]] = packages[i][features[j]];
                } else if (typeof packages[i][features[j]] === 'object' && features[j] !== 'connectedPackage') {
                    if (!showIncluded) {
                        if (packages[i][features[j]].isIncluded) {
                            feature.push({
                                name: packages[i][features[j]].label,
                                heading: packages[i][features[j]].heading,
                                isFree: packages[i][features[j]].isFree,
                                isUnlimited: packages[i][features[j]].isUnlimited,
                                isIncluded: packages[i][features[j]].isIncluded,
                                count: packages[i][features[j]].count,
                                type: packages[i][features[j]].type,
                                multiple: pricing[features[j]].multiple,
                                key: features[j],
                                basePrice: pricing[features[j]].basePrice,
                                baseCount: pricing[features[j]].count,
                                minCount: packages[i][features[j]].minCount,
                                featureInfo: packages[i][features[j]].featureInfo,
                                allowQuantity: !!packages[i][features[j]].allowQuantity,
                                unit: pricing[features[j]].unit,
                                expiryAfterPackageExpiry: packages[i][features[j]].expiryAfterPackageExpiry || 0
                            });
                        }
                    } else {
                        feature.push({
                            name: packages[i][features[j]].label,
                            heading: packages[i][features[j]].heading,
                            isFree: packages[i][features[j]].isFree,
                            isUnlimited: packages[i][features[j]].isUnlimited,
                            isIncluded: packages[i][features[j]].isIncluded,
                            count: packages[i][features[j]].count,
                            type: packages[i][features[j]].type,
                            multiple: pricing[features[j]].multiple,
                            key: features[j],
                            basePrice: pricing[features[j]].basePrice,
                            baseCount: pricing[features[j]].count,
                            minCount: packages[i][features[j]].minCount,
                            featureInfo: packages[i][features[j]].featureInfo,
                            allowQuantity: !!packages[i][features[j]].allowQuantity,
                            unit: pricing[features[j]].unit,
                            expiryAfterPackageExpiry: packages[i][features[j]].expiryAfterPackageExpiry || 0
                        });
                    }
                }
            }

            let subFeatures = [];
            for (let a = 0; a < feature.length; a++) {
                const idx = subFeatures.findIndex(k => k.heading === feature[a].heading);
                if (idx !== -1) {
                    if (subFeatures[idx]['subFeatures']) {
                        subFeatures[idx]['subFeatures'].push(feature[a]);
                    } else {
                        subFeatures[idx]['subFeatures'] = [feature[a]];
                    }
                } else {
                    subFeatures.push({
                        heading: feature[a].heading,
                        subFeatures: [feature[a]]
                    });
                }
            }

            dataToPush['features'] = subFeatures;
            finalPackageData.push(dataToPush);
        }
    }

    return h.response(responseFormatter.responseFormatter(finalPackageData, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.walkInInterviews = async (request, h) => {
    let walkInInterviews;

    try {
        walkInInterviews = await jobsSchema.jobSchema.aggregate([
            {
                $geoNear: {
                    near: {type: 'Point', coordinates: [Number(request.query.longitude), Number(request.query.latitude)]},
                    key: 'location',
                    distanceField: 'dist',
                    query: {
                        isWalkInInterview: true,
                        isClosed: false
                    },
                    spherical: true
                }
            },
            {
                $limit: 3
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: '$user'
            },
            {
                $match: {
                    'user.employerInformation.companyName': {$ne: ''}
                }
            },
            {
                $project: {
                    jobTitle: 1,
                    _id: 1,
                    companyPhoto: "$user.employerInformation.companyProfilePhoto",
                    companyName: "$user.employerInformation.companyName",
                    city: "$address.city",
                    state: "$address.state",
                    jobDescriptionText: 1,
                    payRate: 1,
                    experienceInMonths: 1,
                    ageRequired: 1,
                    jobType: 1
                }
            }
        ])
    } catch (e) {
        logger.error('Error occurred while aggregating jobs data in get walk in interviews handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < walkInInterviews.length; i++) {
        const link = await commonFunctions.Handlers.createFirebaseShortLink('', walkInInterviews[i]._id, '', '', '', '', '', '');
        walkInInterviews[i].link = link.shortLink;
    }

    return h.response(responseFormatter.responseFormatter(walkInInterviews, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.sendLinkToDownload = async (request, h) => {
    let status;

    status = await commonFunctions.Handlers.sendSMS(request.payload.countryCode, request.payload.phone, 'Please download EZJobs App at: https://ezjobs.page.link/store');
    if (status === 'error') {
        return h.response(responseFormatter.responseFormatter({}, 'Something went wrong. Please try again later.', 'error', 400)).code(400);
    }

    return h.response(responseFormatter.responseFormatter({}, 'Link sent successfully', 'success', 200)).code(200);
};

userHandler.getPremiumJobs = async (request, h) => {
    let aggregationCriteria = [], searchCriteria = {}, jobs, favourites, userData, totalCount;

    /* Fetch user data */
    if (request.query.userId) {
        try {
            userData = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching user information in get premium jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    searchCriteria.country = request.query.country;
    searchCriteria.isUnderReview = false;
    searchCriteria.isArchived = false;
    searchCriteria.isClosed = false;
    searchCriteria['displayCities.city'] = request.query.city;
    searchCriteria.isPremium = true;
    if (userData) {
        searchCriteria.translatedLanguage = mongoose.Types.ObjectId(userData.appLanguage);
    }

    /* Total count of query results */
    try {
        totalCount = await jobsSchema.jobSchema.countDocuments(searchCriteria);
    } catch (e) {
        logger.error('Error occurred while counting total premium jobs in get premium jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }


    aggregationCriteria.push({
        $match: searchCriteria
    });

    /* Filter all returned jobs */
    if (request.query.ids) {
        let ids = [];
        for (let i = 0; i < request.query.ids.length; i++) {
            ids.push(mongoose.Types.ObjectId(request.query.ids[i]));
        }

        aggregationCriteria.push({
            $match: {
                _id: {$nin: ids}
            }
        });
    }

    /* Define aggregation criteria based on location, radius and active flag of categories and subcategories */
    aggregationCriteria.push(
        {
            $lookup: {
                from: 'User',
                localField: 'userId',
                foreignField: '_id',
                as: 'user'
            }
        },
        {
            $unwind: '$user'
        },
        {
            $lookup: {
                from: 'Category',
                localField: 'categoryId',
                foreignField: '_id',
                as: 'category'
            }
        },
        {
            $unwind: '$category'
        },
        {
            $match: {
                'category.isActive': true
            }
        }
    );

    /* New criteria for preference screen */
    if (userData) {
        if (userData.employeeInformation.preference && userData.employeeInformation.preference.length && !request.query.searchText) {
            aggregationCriteria.push({
                $match: {
                    $or: [
                        {
                            categoryId: {$in: userData.employeeInformation.preference}
                        },
                        {
                            skillsLower: {$in: userData.employeeInformation.skillsLower}
                        },
                        {
                            'category.tags': {$in: userData.employeeInformation.skillsLower}
                        }
                    ]
                }
            });
        }
    }

    if (request.query.userId) {
        aggregationCriteria.push({$match: {'user.blockedBy': {$nin: [mongoose.Types.ObjectId(request.query.userId)]}, userId: {$ne: mongoose.Types.ObjectId(request.query.userId)}}});
    }

    aggregationCriteria.push({$sample: {size: request.query.limit}});
    aggregationCriteria.push({
        $project: {
            _id: 1,
            distance: 1,
            userId: 1,
            payRate: 1,
            currency: 1,
            jobTitle: 1,
            subJobTitle: 1,
            startDate: 1,
            jobType: 1,
            totalViews: 1,
            uniqueViews: {$size: '$uniqueViews'},
            companyLogo: '$user.employerInformation.companyProfilePhoto',
            companyName: '$user.employerInformation.companyName',
            companyCity: '$address.city',
            companyState: '$address.state',
            companySubLocality: '$address.subLocality',
            latitude: {$arrayElemAt: ['$location.coordinates', 1]},
            longitude: {$arrayElemAt: ['$location.coordinates', 0]},
            isNegotiable: 1,
            phone: 1,
            countryCode: 1,
            isCompanyWebsite: 1,
            companyWebsite: 1,
            isATS: 1,
            atsEmail: 1
        }
    });

    try {
        jobs = await jobsSchema.jobSchema.aggregate(aggregationCriteria);
    } catch (e) {
        console.log(e);
        logger.error('Error occurred while getting all jobs in get get premium jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Fetch all the items in the favourite list of the user and update the jobs data */
    if (request.query.userId) {
        try {
            favourites = await favouriteSchema.favouriteSchema.find({userId: mongoose.Types.ObjectId(request.query.userId)}, {jobId: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting all favourite list jobs in get premium jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (favourites && favourites.length) {
            for (let i = 0; i < jobs.length; i++) {
                const idx = favourites.findIndex(j => j.jobId.toString() === jobs[i]._id.toString());
                jobs[i]['isFavourite'] = (idx !== -1);
            }
        }

        let conversations;
        try {
            conversations = await conversationSchema.conversationSchema.find({candidateId: mongoose.Types.ObjectId(request.query.userId)}, {jobId: 1, isApplied: 1, isInvited: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting all conversations pf candidates in get premium jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        for (let i = 0; i < jobs.length; i++) {
            const idx = conversations.findIndex(j => j.jobId.toString() === jobs[i]._id.toString());
            jobs[i]['isApplied'] = (idx !== -1);
        }
    }

    return h.response(responseFormatter.responseFormatter(jobs, 'Fetched successfully', 'success', 200, totalCount)).code(200);
};

userHandler.setUserCountry = async (request, h) => {
    let checkUser, decoded, updateCriteria = {country: request.payload.country};

    /* Check if user exists in database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user information in set user country handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user', 'error', 404)).code(404);
    }

    /* Check whether access token is valid */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in set user country handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check if user has assigned free package or not */
    if (!checkUser.subscriptionInfo) {
        let freePackage, checkPackage, numberOfJobsPosted = 0, subscriptionData;
        try {
            checkPackage = await packageSchema.packageSchema.findOne({country: request.payload.country, isFree: true, isActive: true}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding free package in set user country handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        try {
            freePackage = await packageSchema.packageSchema.findOne({country: request.payload.country, isFree: true, isActive: true}, {_id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding free package in set user country handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Get the number of jobs posted */
        try {
            numberOfJobsPosted = await jobsSchema.jobSchema.countDocuments({userId: mongoose.Types.ObjectId(request.payload.userId), isArchived: false});
        } catch (e) {
            logger.error('Error occurred counting number of jobs posted by user in set user country handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (freePackage) {
            updateCriteria.subscriptionInfo = {
                packageId: freePackage._id
            };

            delete checkPackage._id;
            /* Save subscription in database */
            let subscriptionToSave = new subscriptionSchema.subscriptionSchema(checkPackage);
            delete subscriptionToSave.createdAt;
            delete subscriptionToSave.updatedAt;
            delete subscriptionToSave._id;
            subscriptionToSave.isActive = false;
            subscriptionToSave.userId = checkUser._id;
            subscriptionToSave.planType = 'monthly';
            subscriptionToSave.packageId = freePackage._id;
            subscriptionToSave.numberOfJobs.count = checkPackage.numberOfJobs.monthlyCount - numberOfJobsPosted;
            subscriptionToSave.numberOfUsers.count = checkPackage.numberOfUsers.monthlyCount;
            subscriptionToSave.numberOfViews.count = checkPackage.numberOfViews.monthlyCount;
            subscriptionToSave.numberOfTextTranslations.count = checkPackage.numberOfTextTranslations.monthlyCount;
            subscriptionToSave.numberOfJobTranslations.count = checkPackage.numberOfJobTranslations.monthlyCount;
            subscriptionToSave.jobsInAllLocalities.count = checkPackage.jobsInAllLocalities.count;
            subscriptionToSave.isEnded = false;
            subscriptionToSave.isActive = true;
            subscriptionToSave.isPaid = true;
            subscriptionToSave.isFree = true;

            try {
                subscriptionData = await subscriptionToSave.save();
            } catch (e) {
                logger.error('Error occurred saving subscription information in auth user handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            updateCriteria.subscriptionInfo['subscriptionId'] = subscriptionData._id;
        }
    }

    /* Set the user country */
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$set: updateCriteria}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating user information in set user country handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Information updated', 'success', 204)).code(204);
};

userHandler.updateAchievements = async (request, h) => {
    let checkUser, decoded, status;

    console.log(request.payload);

    /* Check whether this user is authorized to perform this action or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update achievements handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether user exists in EZJobs database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in update achievements handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    if (request.payload.indexOfCertificatesToRemove) {
        if (request.payload.indexOfCertificatesToRemove.length) {
            for (let i = 0; i < request.payload.indexOfCertificatesToRemove.length; i++) {
                const toBeRemoved = request.payload.indexOfCertificatesToRemove[i];
                /* Delete image from s3 bucket */
                try {
                    status = await commonFunctions.Handlers.deleteImage(checkUser.employeeInformation.achievementsModified[toBeRemoved].image);
                } catch (e) {
                    logger.error('Error occurred while deleting certificate image in update achievements handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                console.log('STATUS::: ', status);
                if (!status) {
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred while deleting certificate', 'error', 500)).code(500);
                }
            }
            for (let i = 0; i < request.payload.indexOfCertificatesToRemove.length; i++) {
                const toBeRemoved = request.payload.indexOfCertificatesToRemove[i];
                /* Remove it from original list of achievements */
                checkUser.employeeInformation.achievementsModified.splice(toBeRemoved, 1);
            }
        }
    }

    if (!request.payload.achievementsModified) {
        request.payload.achievementsModified = [];
    }

    /* Update user */
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$set: {'employeeInformation.achievementsModified': request.payload.achievementsModified}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating user in update achievements handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);

};

userHandler.updateRating = async (request, h) => {
    let checkCandidate, checkEmployer, checkChat, checkJob;

    /* Check if candidate exists */
    try {
        checkCandidate = await userSchema.UserSchema.findById({_id: request.payload.candidateId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding candidate in update rating handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkCandidate) {
        return h.response(responseFormatter.responseFormatter({}, 'No such candidate.', 'error', 404)).code(404);
    }

    /* Check if employer exists */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: request.payload.employerId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding employer in update rating handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'No such employer.', 'error', 404)).code(404);
    }

    /* Check if job exists */
    try {
        checkJob = await jobsSchema.jobSchema.findById({_id: request.payload.jobId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding job in update rating handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkJob) {
        return h.response(responseFormatter.responseFormatter({}, 'No such job.', 'error', 404)).code(404);
    }

    if (!request.payload.rate) {
        return h.response(responseFormatter.responseFormatter({}, 'Rating should be more than 0', 'error', 400)).code(400);
    }

    if (request.payload.isChat) {
        /* Check if chat exists */
        try {
            checkChat = await conversationSchema.conversationSchema.findOne({employerId: mongoose.Types.ObjectId(request.payload.employerId), candidateId: mongoose.Types.ObjectId(request.payload.candidateId), jobId: mongoose.Types.ObjectId(request.payload.jobId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding conversation in update rating handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkChat) {
            return h.response(responseFormatter.responseFormatter({}, 'No such conversation.', 'error', 404)).code(404);
        }

        /* Save rating into conversation collection */
        try {
            await conversationSchema.conversationSchema.findOneAndUpdate({employerId: mongoose.Types.ObjectId(request.payload.employerId), candidateId: mongoose.Types.ObjectId(request.payload.candidateId), jobId: mongoose.Types.ObjectId(request.payload.jobId)}, {$set: {rating: {rate: request.payload.rate, note: request.payload.note, isShown: true, postedAt: new Date()}}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating conversation in update rating handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        /* Save into rating collection */
        const dataToUpdate = {
            candidateId: mongoose.Types.ObjectId(request.payload.candidateId),
            employerId: mongoose.Types.ObjectId(request.payload.employerId),
            jobId: mongoose.Types.ObjectId(request.payload.jobId),
            rate: request.payload.rate,
            note: request.payload.note ? request.payload.note : ''
        };
        try {
            await ratingSchema.rateSchema.findOneAndUpdate({candidateId: mongoose.Types.ObjectId(request.payload.candidateId), employerId: mongoose.Types.ObjectId(request.payload.employerId), jobId: mongoose.Types.ObjectId(request.payload.jobId)}, {$set: dataToUpdate}, {upsert: true, new: true});
        } catch (e) {
            logger.error('Error occurred while saving rating in update rating handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Thank you for your rating.', 'success', 204)).code(200);
};

userHandler.rateApp = async (request, h) => {
    let checkUser, decoded;

    /* Check whether this user is authorized to perform this action or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in rate app handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether user exists in EZJobs database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in rate app handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    if (!request.payload.rate) {
        return h.response(responseFormatter.responseFormatter({}, 'Rating should be more than 0', 'error', 400)).code(400);
    }

    /* Update the rating */
    const dataToUpdate = {
        rating: {
            rate: request.payload.rate,
            note: request.payload.note ? request.payload.note : '',
            postedAt: new Date()
        }
    };
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$set: dataToUpdate}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating user in rate app handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Thank you for your rating.', 'success', 204)).code(200);
};

userHandler.getEmailPreference = async (request, h) => {
    let checkUser, decoded, preferences = [];

    /* Check whether this user is authorized to perform this action or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get email preference handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether user exists in EZJobs database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get email preference handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Get preferences */
    try {
        preferences = await emailPreferenceUserSchema.emailPreferenceUserSchema.aggregate([
            {
                $match: {
                    userId: mongoose.Types.ObjectId(checkUser._id)
                }
            },
            {
                $lookup: {
                    from: 'EmailPreferenceType',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'pref'
                }
            },
            {
                $unwind: '$pref'
            },
            {
                $project: {
                    id: 1,
                    title: '$pref.title',
                    description: '$pref.description',
                    isSelected: 1
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred while aggregating preferences in get email preference handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }


    return h.response(responseFormatter.responseFormatter(preferences, 'Fetched successfully.', 'success', 200)).code(200);
};

userHandler.updateEmailPreference = async (request, h) => {
    let checkUser, decoded, status;

    /* Check whether this user is authorized to perform this action or not */
     try {
         decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
     } catch (e) {
         logger.error('Error occurred while decoding token in update email preference handler %s:', JSON.stringify(e));
         return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
     }
     if (decoded.userId !== request.payload.userId) {
         return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
     }

    /* Check whether user exists in EZJobs database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in update email preference handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Update preference data */
    try {
        await emailPreferenceUserSchema.emailPreferenceUserSchema.findOneAndUpdate({userId: checkUser._id, id: request.payload.categoryId}, {$set: {isSelected: request.payload.isSelected}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating preference in update email preference handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter({}, 'Email preference updated.', 'success', 204)).code(200);
};

userHandler.testData = async (request, h) => {
    let data;

    data = await commonFunctions.Handlers.getContactMautic(request.query.email);

    return h.response(responseFormatter.responseFormatter(data, 'Fetched successfully.', 'success', 200)).code(200);
};

userHandler.hubSpotCall = async (request, h) => {
    console.log(request.payload);
    let map = [
        {
            usContact: '+16463500350',
            indiaContact: '09398019881'
        },
        {
            usContact: '+17322263359',
            indiaContact: '08184893844'
        },
        {
            usContact: '+19734469502',
            indiaContact: '08125547336'
        },
        {
            usContact: '+16462015366',
            indiaContact: '09010018458'
        },
        {
            usContact: '+16099450744',
            indiaContact: '08919017961'
        },
        {
            usContact: '+16467010066',
            indiaContact: '09885850136'
        },
        {
            usContact: '+19734460005',
            indiaContact: '09542529553'
        },
        {
            usContact: '+19734462660',
            indiaContact: '08520851288'
        }
    ];

    const findNumber = map.findIndex(k => k.usContact === request.payload.from);
    if (findNumber === -1) {
        return h.response(responseFormatter.responseFormatter({}, 'Call failed.', 'error', 400)).code(400);
    } else if (!map[findNumber].indiaContact) {
        return h.response(responseFormatter.responseFormatter({}, 'Call failed.', 'error', 400)).code(400);
    }

    const formData = {
        From: map[findNumber].indiaContact,
        To: request.payload.to,
        CallerId: '08047188299'
    }

    let options = {
        method: 'POST',
        url: 'https://abdd1e3bdedbe487389a0f1ba8e5a604725ba3a3a5488bc8:a2aa71748b2b9934fd35b9ad4576e68857e76ba013b531e1@api.exotel.com/v1/Accounts/futransolutions1/Calls/connect.json',
        formData: formData
    }, status;

    try {
        status = await rp(options);
    } catch (e) {
        console.log(e);
        return h.response(responseFormatter.responseFormatter({}, 'Call failed.', 'error', e.statusCode)).code(e.statusCode);
    }

    status = JSON.parse(status);

    if (status.Call) {
        return h.response(responseFormatter.responseFormatter({}, 'Call connected.', 'success', 200)).code(200);
    } else {
        return h.response(responseFormatter.responseFormatter({}, 'Call failed.', 'error', 400)).code(400);
    }
};

userHandler.resendInvitation = async (request, h) => {
    let checkEmployer, checkCandidate, checkJob, searchCriteria, status;

    /* Check whether seller is present in database or not */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: request.payload.employerId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding employer information in resend invitation handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'Employer doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether buyer is present in database or not */
    try {
        checkCandidate = await userSchema.UserSchema.findById({_id: request.payload.candidateId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding candidate information in resend invitation handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkCandidate) {
        return h.response(responseFormatter.responseFormatter({}, 'Candidate doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check if product is present in database or not */
    try {
        checkJob = await jobsSchema.jobSchema.findById({_id: request.payload.jobId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding job information in resend invitation handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkJob) {
        return h.response(responseFormatter.responseFormatter({}, 'Job not found', 'error', 404)).code(404);
    }

    /* Set all the chat messages of this user to isRead */
    searchCriteria = {
        candidateId: mongoose.Types.ObjectId(request.payload.candidateId),
        employerId: mongoose.Types.ObjectId(request.payload.employerId),
        jobId: mongoose.Types.ObjectId(request.payload.jobId)
    };

    try {
        status = await conversationSchema.conversationSchema.findOne(searchCriteria, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching chat information in resend invitation handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!status) {
        return h.response(responseFormatter.responseFormatter({}, 'Conversation not found', 'error', 404)).code(404);
    }

    const dataToPush = {
        from: mongoose.Types.ObjectId(request.payload.employerId),
        to: mongoose.Types.ObjectId(request.payload.candidateId),
        body: aes256.encrypt(key, checkEmployer.employerInformation.companyName + ' is waiting for your reply for the position of ' + checkJob.jobTitle),
        originalBody: aes256.encrypt(key, checkEmployer.employerInformation.companyName + ' is waiting for your reply for the position of ' + checkJob.jobTitle),
        dateTime: new Date(),
        isRead: false,
        type: 'isText',
        duration: 0,
        latitude: '',
        longitude: '',
        hasEmployerDeleted: false,
        hasCandidateDeleted: false,
        isCandidateBlocked: false,
        isEmployerBlocked: false,
        isEncrypted: true,
        isTranslated: false,
        isDeleted: false
    }

    /* Push into chats array */
    try {
        await conversationSchema.conversationSchema.findByIdAndUpdate({_id: status._id}, {$push: {chats: dataToPush}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating chat information in resend invitation handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Invited successfully.', 'success', 200)).code(200);
};

userHandler.recoveryEmail = async (request, h) => {
    let checkUser, decoded, checkDuplicate;

    /* Check whether this user is authorized to perform this action or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update recovery email handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether user exists in EZJobs database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in update recovery email handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check for duplicate email address */
    try {
        checkDuplicate = await userSchema.UserSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding duplicate email in update recovery email handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (checkDuplicate) {
        return h.response(responseFormatter.responseFormatter({}, 'An account already exists with the given recovery email address.', 'error', 409)).code(409);
    }

    /* Update email address */
    const emailVerified = (checkUser.email.toLowerCase() === request.payload.email.toLowerCase()) ? checkUser.emailVerified : false;
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, {$set: {emailVerified: emailVerified, email: request.payload.email}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating user in update recovery email handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send verification email if email verified flag is false */
    if (!emailVerified) {
        const tokenWithExpiry = commonFunctions.Handlers.createAuthTokenWithExpiry(checkUser._id, 'Candidate');
        const verificationUrl = emailVerificationUrl + '/user/verify?token=' + tokenWithExpiry;
        try {
            let email = {
                to: [{
                    email: request.payload.email,
                    name: (checkUser.firstName + ' ' + checkUser.lastName).trim(),
                    type: 'to'
                }],
                important: false,
                merge: true,
                inline_css: false,
                merge_language: 'mailchimp',
                merge_vars: [{
                    rcpt: request.payload.email,
                    vars: [{
                        name: 'VERIFYEMAIL',
                        content: verificationUrl
                    }, {
                        name: 'VERIFYEMAILURL',
                        content: verificationUrl
                    }]
                }]
            };
            await mandrill.Handlers.sendTemplate('ezjobs-email-verification', [], email, true)
        } catch (e) {
            logger.error('Error in sending verification link to user %s:', JSON.stringify(e));
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'An email has been sent to the given email for verification.', 'success', 204)).code(200);
};

userHandler.getCardDesigns = async (request, h) => {
    let cards;

    try {
        cards = await visitingCardSchema.visitingCardSchema.find({isActive: true}, {}, {lean: true}).skip(request.query.skip).limit(request.query.limit);
    } catch (e) {
        logger.error('Error occurred while finding cards in get card designs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(cards, 'Fetched successfully.', 'success', 200)).code(200);
};

userHandler.updateUserCard = async (request, h) => {
    let checkUser, decoded, deepLink, dataToUpdate = {}, checkCard;

    /* Check whether this user is authorized to perform this action or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update user card handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether user exists in EZJobs database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in update user card handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check if card exists */
    try {
        checkCard = await visitingCardSchema.visitingCardSchema.findById({_id: request.payload.cardId}, {}, {lean: true});
    } catch (e) {
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkCard) {
        return h.response(responseFormatter.responseFormatter({}, 'No such card.', 'error', 404)).code(404);
    } else if (!checkCard.isActive) {
        return h.response(responseFormatter.responseFormatter({}, 'The selected card design is not available.', 'error', 400)).code(400);
    }

    /* Generate deep link if it is not there */
    if (!checkUser.employeeInformation.profileLink) {
        deepLink = await commonFunctions.Handlers.createFirebaseShortLink('', '', request.payload.userId, '', '', '', '', '', '');
        if (deepLink === 'error') {
            console.log('Error occurred in creating deep link');
        } else {
            dataToUpdate['employeeInformation.profileLink'] = deepLink.shortLink;
        }
    }

    dataToUpdate['employeeInformation.card'] = mongoose.Types.ObjectId(request.payload.cardId);

    /* Update user profile */
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$set: dataToUpdate}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating user in update user card handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({card: checkCard, profileLink: deepLink ? deepLink : checkUser.employeeInformation.profileLink}, 'Updated successfully.', 'success', 204)).code(200);
};

userHandler.getSimilarEntities = async (request, h) => {
    let checkUser, checkJob, similarEntities, aggregationCriteria = [
        {
            $geoNear: {
                near: {
                    type: 'Point',
                    coordinates: [Number(request.query.longitude), Number(request.query.latitude)]
                },
                distanceField: 'distance',
                key: '',
                maxDistance: (50) * 1609.34,
                spherical: true,
                query: {}
            }
        }
    ];

    if (!request.query.userId && !request.query.jobId) {
        return h.response(responseFormatter.responseFormatter({}, 'UserId/JobId is missing.', 'error', 400)).code(400);
    }

    if (request.query.userId) {
        try {
            checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {employeeInformation: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding user in get similar entities handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkUser) {
            return h.response(responseFormatter.responseFormatter({}, 'User not found.', 'error', 404)).code(404);
        }
        aggregationCriteria[0].$geoNear.query = {isActive: true, 'employeeInformation.isComplete': true, privacyType: 'standard', 'employeeInformation.country': checkUser.employeeInformation.country,  _id: {$ne: mongoose.Types.ObjectId(request.query.userId)}};
        aggregationCriteria[0].$geoNear.key = 'employeeInformation.location';
        aggregationCriteria.push({
            $project: {
                _id: 1,
                firstName: 1,
                lastName: 1,
                experienceInMonths: '$employeeInformation.experienceInMonths',
                profilePhoto: '$employeeInformation.profilePhoto',
                description: '$employeeInformation.description.text',
                city: '$employeeInformation.address.city',
                state: '$employeeInformation.address.state',
                pastJobTitles: '$employeeInformation.pastJobTitles',
                pastJobTitlesModified: '$employeeInformation.pastJobTitlesModified',
                futureJobTitles: '$employeeInformation.futureJobTitles',
                isStudent: '$employeeInformation.isStudent',
                skills: '$employeeInformation.skills',
                distance: 1,
                size: {$size: {$setIntersection: [checkUser.employeeInformation.skillsLower, '$employeeInformation.skillsLower']}},
                preferredLocationCities: '$employeeInformation.preferredLocationCities',
                preferredLocations: '$employeeInformation.preferredLocations'
            }
        });
        aggregationCriteria.push({
            $match: {
                size: {$gt: 0}
            }
        });
        aggregationCriteria.push({
            $sort: {
                size: -1
            }
        });
        aggregationCriteria.push({
            $skip: request.query.skip
        });
        aggregationCriteria.push({
            $limit: request.query.limit
        });
        aggregationCriteria.push({
            $project: {
                _id: 1,
                firstName: 1,
                lastName: 1,
                experienceInMonths: 1,
                profilePhoto: 1,
                description: 1,
                city: 1,
                state: 1,
                pastJobTitles: 1,
                pastJobTitlesModified: 1,
                futureJobTitles: 1,
                isStudent: 1,
                skills: 1,
                preferredLocationCities: 1,
                preferredLocations: 1
            }
        });

        try {
            similarEntities = await userSchema.UserSchema.aggregate(aggregationCriteria);
        } catch (e) {
            logger.error('Error occurred while aggregating users in get similar entities handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    if (request.query.jobId) {
        try {
            checkJob = await jobsSchema.jobSchema.findById({_id: request.query.jobId}, {skillsLower: 1, country: 1, categoryId: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding job in get similar entities handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkJob) {
            return h.response(responseFormatter.responseFormatter({}, 'Job not found.', 'error', 404)).code(404);
        }
        aggregationCriteria[0].$geoNear.query = {country: checkJob.country, _id: {$ne: mongoose.Types.ObjectId(request.query.jobId)}, isArchived: false, isTranslated: false};
        aggregationCriteria[0].$geoNear.key = 'location';
        aggregationCriteria.push({
            $lookup: {
                from: 'User',
                localField: 'userId',
                foreignField: '_id',
                as: 'user'
            }
        });
        aggregationCriteria.push( {
            $unwind: '$user'
        });
        aggregationCriteria.push({
                $lookup: {
                    from: 'Verification',
                    localField: 'user.employerInformation.verificationData',
                    foreignField: '_id',
                    as: 'verification'
                }
        });
        aggregationCriteria.push({
                $unwind: {
                    path: '$verification',
                    preserveNullAndEmptyArrays: true
                }
        });

        aggregationCriteria.push({
            $project: {
                _id: 1,
                userId: 1,
                payRate: 1,
                currency: 1,
                jobTitle: 1,
                subJobTitle: 1,
                startDate: 1,
                jobType: 1,
                totalViews: 1,
                uniqueViews: {$size: '$uniqueViews'},
                companyLogo: '$user.employerInformation.companyProfilePhoto',
                companyName: '$user.employerInformation.companyName',
                companyCity: '$address.city',
                companyState: '$address.state',
                companySubLocality: '$address.subLocality',
                latitude: {$arrayElemAt: ['$location.coordinates', 1]},
                longitude: {$arrayElemAt: ['$location.coordinates', 0]},
                interviewStartDateTime: 1,
                interviewEndDateTime: 1,
                isWorkFromHome: 1,
                shift: 1,
                isWalkInInterview: 1,
                companyVerified: '$verification.status',
                size: {$size: {$setIntersection: [checkJob.skillsLower, '$skillsLower']}}
            }
        });
        aggregationCriteria.push({
            $match: {
                size: {$gt: 0}
            }
        });
        aggregationCriteria.push({
            $sort: {
                size: -1
            }
        });
        aggregationCriteria.push({
            $skip: request.query.skip
        });
        aggregationCriteria.push({
            $limit: request.query.limit
        });
        aggregationCriteria.push({
            $project: {
                _id: 1,
                userId: 1,
                payRate: 1,
                currency: 1,
                jobTitle: 1,
                subJobTitle: 1,
                startDate: 1,
                jobType: 1,
                totalViews: 1,
                uniqueViews: 1,
                companyLogo: 1,
                companyName: 1,
                companyCity: 1,
                companyState: 1,
                companySubLocality: 1,
                latitude: 1,
                longitude: 1,
                interviewStartDateTime: 1,
                interviewEndDateTime: 1,
                isWorkFromHome: 1,
                shift: 1,
                isWalkInInterview: 1,
                companyVerified: 1
            }
        });

        try {
            similarEntities = await jobsSchema.jobSchema.aggregate(aggregationCriteria);
        } catch (e) {
            logger.error('Error occurred while aggregating jobs in get similar entities handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    return h.response(responseFormatter.responseFormatter(similarEntities, 'Fetched successfully.', 'success', 200)).code(200);
};

userHandler.connect = async (request, h) => {
    let decoded, checkInvitation, message = '', statusCode = 200, req, receiver, sender;

    /* Check whether this user is authorized to perform this action or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in connect handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.sender) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether the invitation already exists */
    try {
        checkInvitation = await networkSchema.networkSchema.findOne({$or: [{$and: [{sender: mongoose.Types.ObjectId(request.payload.sender)}, {receiver: mongoose.Types.ObjectId(request.payload.receiver)}]}, {$and: [{sender: mongoose.Types.ObjectId(request.payload.receiver)}, {receiver: mongoose.Types.ObjectId(request.payload.sender)}]}]}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding invitation in connect handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get the sender data to send push */
    try {
        sender = await userSchema.UserSchema.findById({_id: request.payload.sender}, {firstName: 1, lastName: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding sender in connect handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get the receiver data to send push */
    try {
        receiver = await userSchema.UserSchema.findById({_id: request.payload.receiver}, {firstName: 1, lastName: 1, email: 1, deviceToken: 1, deviceType: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding receiver in connect handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkInvitation) {
        if (checkInvitation.status.toLowerCase() === 'pending') {
            message = 'Reminder has been sent.';

            /* Send the push notification */
            if (sender && receiver && receiver.deviceToken && receiver.deviceType) {
                push.createMessage(receiver.deviceToken, [], {}, receiver.deviceType, 'Connection Reminder', sender.firstName + ' has sent you a reminder for the connection request they sent.', 'beep');
            }

        } else if (checkInvitation.status.toLowerCase() === 'rejected') {
            message = 'Connect request has been sent.';
            /* Update the invitation as pending */
            try {
                await networkSchema.networkSchema.findByIdAndUpdate({_id: checkInvitation._id}, {$set: {status: 'pending'}}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while updating invitation in connect handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
        statusCode = 204;
    } else {
        /* Create invitation and send an email regarding the same */
        const dataToSave = {
            sender: mongoose.Types.ObjectId(request.payload.sender),
            receiver: mongoose.Types.ObjectId(request.payload.receiver),
            status: 'pending',
            message: request.payload.message || ''
        };

        try {
            req = await new networkSchema.networkSchema(dataToSave).save();
        } catch (e) {
            logger.error('Error occurred while saving invitation in connect handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /*
        * Send the email to the receiver regarding the same
        * */

        try {
            let email = {
                to: [{
                    email: receiver.email,
                    name: (receiver.firstName + ' ' + receiver.lastName).trim(),
                    type: 'to'
                }],
                subject: 'Connection request from ' + sender.firstName.trim(),
                important: false,
                merge: true,
                inline_css: false,
                merge_language: 'mailchimp',
                merge_vars: [{
                    rcpt: receiver.email,
                    vars: [
                        {
                            name: 'firstName',
                            content: receiver.firstName
                        },
                        {
                            name: 'name',
                            content: sender.firstName
                        },
                        {
                            name: 'body',
                            content: request.payload.message.trim()
                        }
                    ]
                }]
            };
            await mandrill.Handlers.sendTemplate('ezjobs-connection-request', [], email, true)
        } catch (e) {
            logger.error('Error in sending connection template to user %s:', JSON.stringify(e));
        }

        /* Send the push notification */
        if (sender && receiver && receiver.deviceToken && receiver.deviceType) {
            push.createMessage(receiver.deviceToken, [], {}, receiver.deviceType, 'Connection Request', sender.firstName + ' has sent you a connection request', 'beep');
        }

        message = 'Connect request has been sent.'
        statusCode = 201;
    }

    return h.response(responseFormatter.responseFormatter({requestId: req ? req._id : checkInvitation._id}, message, 'success', statusCode)).code(200);
};

userHandler.acceptRejectConnection = async (request, h) => {
    let checkUser, decoded, checkConnection, status = request.payload.status === 'accept' ? 'accepted' : 'rejected', message = '';

    /* Check whether user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in accept/reject connection handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    }

    /* Check whether this user is authorized to perform this action or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in accept reject connection handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether request exists */
    try {
        checkConnection = await networkSchema.networkSchema.findById({_id: request.payload.requestId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding connection request in accept/reject connection handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkConnection) {
        return h.response(responseFormatter.responseFormatter({}, 'No such connection request', 'error', 404)).code(404);
    } else if (checkConnection.status.toLowerCase() === 'rejected') {
        return h.response(responseFormatter.responseFormatter({}, 'This invitation is already declined', 'error', 400)).code(400);
    }

    /* Update the connect request */
    try {
        await networkSchema.networkSchema.findByIdAndUpdate({_id: checkConnection._id}, {$set: {status: status}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating connection request in accept/reject connection handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send push notification if invitation is accepted */
    if (status === 'accepted') {
        let sender;
        try {
            sender = await userSchema.UserSchema.findById({_id: checkConnection.receiver}, {firstName: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding receiver in accept/reject connection handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (request.payload.userId === checkConnection.receiver.toString()) {
            if (checkUser.deviceToken) {
                if (sender) {
                    push.createMessage(checkUser.deviceToken, [], {}, checkUser.deviceType, 'Connection', sender.firstName + ' is now a connection', 'beep');
                }
            }
        }
        message = 'Congratulations! ' + sender.firstName + ' is now a connection.';
    } else if (status === 'rejected') {
        try {
            await networkSchema.networkSchema.findByIdAndDelete({_id: checkConnection._id});
        } catch (e) {
            logger.error('Error occurred while deleting connection request in accept/reject connection handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (checkConnection.status === 'pending') {
            if (checkConnection.sender.toString() === request.payload.userId) {
                message = 'We have cancelled your connection request.'
            } else {
                message = 'Connection request declined.'
            }
        } else {
            message = 'Connection removed.'
        }

        /* Remove both the users from each others groups */
        try {
            await groupSchema.groupSchema.updateMany({userId: checkConnection.sender}, {$pull: {members: checkConnection.receiver}});
        } catch (e) {
            logger.error('Error occurred while removing receiver from sender groups in accept/reject connection handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        try {
            await groupSchema.groupSchema.updateMany({userId: checkConnection.receiver}, {$pull: {members: checkConnection.sender}});
        } catch (e) {
            logger.error('Error occurred while removing sender from receiver groups in accept/reject connection handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, message, 'success', 200)).code(200);
};

userHandler.sendEmail = async (request, h) => {
    const dateTime = request.payload.date + ' @ ' + request.payload.time;
    let email = {
        to: [{
            email: 'kpraveen@ezjobs.io',
            type: 'to'
        }, {
            email: 'gdev@ezjobs.io',
            type: 'to'
        }],
        important: true,
        merge: true,
        inline_css: true,
        merge_language: 'mailchimp',
        merge_vars: [{
            rcpt: 'kpraveen@ezjobs.io',
            vars: [
                {
                    name: 'phone',
                    content: request.payload.phone
                },
                {
                    name: 'packageName',
                    content: request.payload.packageName
                },
                {
                    name: 'date',
                    content: dateTime
                }
            ]
        }, {
            rcpt: 'gdev@ezjobs.io',
            vars: [
                {
                    name: 'phone',
                    content: request.payload.phone
                },
                {
                    name: 'packageName',
                    content: request.payload.packageName
                },
                {
                    name: 'date',
                    content: dateTime
                }
            ]
        }]
    };
    try {
        await mandrill.Handlers.sendTemplate('ezjobs-website-package', [], email, true);
    } catch (e) {
        logger.error('Error occurred while sending email to sales %s', JSON.stringify(e));
    }

    return h.response(responseFormatter.responseFormatter({}, 'Email sent', 'success', 200)).code(200);
};

userHandler.getPromotions = async (request, h) => {
    let checkUser, decoded, promotions;

    /* Check whether user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get promotions handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    }

    /* Check whether this user is authorized to perform this action or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get promotions handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get list of promotions */
    const searchCriteria = {
        userIds: {$in: mongoose.Types.ObjectId(request.query.userId)},
        country: request.query.country
    }
    try {
        promotions = await promoCodeSchema.promoCodeSchema.find(searchCriteria, {
            promotionName: 1,
            promoCode: 1,
            subText: 1,
            expiration: 1
        }, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding promotions in get promotions handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(promotions, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getPromotionsNoAuth = async (request, h) => {
    let promotion = {}, searchCriteria = {
        country: request.query.country,
        expiration: {$gte: new Date()},
        isGlobal: true
    };

    try {
        promotion = await promoCodeSchema.promoCodeSchema.findOne(searchCriteria, {
            promotionName: 1,
            promoCode: 1,
            subText: 1,
            expiration: 1
        }, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding global promotion in get promotions no auth handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(promotion || {}, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getConnectedPackage = async (request, h) => {
    let checkPackage, connectedPackage, missingFeatures = [], response = {}, currency;

    /* Check if the package exists */
    try {
        checkPackage = await packageSchema.packageSchema.findById({_id: request.query.packageId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding package in get connected package handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPackage) {
        return h.response(responseFormatter.responseFormatter({}, 'Package not found', 'error', 404)).code(404);
    }

    try {
        currency = await codeSchema.CodeSchema.findOne({countryISOName: checkPackage.country}, {currency: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding currency in get connected package handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check if connected package exists */
    if (checkPackage.connectedPackage) {
        try {
            connectedPackage = await packageSchema.packageSchema.findById({_id: checkPackage.connectedPackage}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding connected package in get connected package handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        for (const feat in checkPackage) {
            if (typeof checkPackage[feat] === 'object' && feat !== '_id' && feat !== 'connectedPackage') {
                if (!checkPackage[feat]['isIncluded'] && connectedPackage[feat]['isIncluded']) {
                    connectedPackage[feat]['name'] = connectedPackage[feat]['label'];
                    missingFeatures.push(connectedPackage[feat]);
                }
            }
        }
        response = {
            subFeatures: missingFeatures,
            packageName: connectedPackage.packageName,
            currency: currency.currency,
            colorCode: connectedPackage.colorCode,
            strikeTotal: +(connectedPackage.strikeTotal - checkPackage.strikeTotal).toFixed(2),
            total: +(connectedPackage.total - checkPackage.total).toFixed(2),
            _id: connectedPackage._id
        };

        response.discount = 100 - Math.ceil((response.total * 100) / (response.strikeTotal));
    }

    return h.response(responseFormatter.responseFormatter(response, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.applyPromo = async (request, h) => {
    let checkUser, decoded, promotion = {};

    /* Check whether user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in apply promotions handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    }

    /* Check whether this user is authorized to perform this action or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in apply promotions handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get list of promotions */
    const searchCriteria = {
        promoCode: request.payload.promoCode.toUpperCase(),
        $or: [{isGlobal: true}, {userIds: {$in: mongoose.Types.ObjectId(request.payload.userId)}}],
        country: request.payload.country
    }
    try {
        promotion = await promoCodeSchema.promoCodeSchema.findOne(searchCriteria, {
            promotionName: 1,
            promoCode: 1,
            subText: 1,
            expiration: 1,
            packageIds: 1
        }, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding promotions in apply promotions handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!promotion) {
        return h.response(responseFormatter.responseFormatter({}, 'Invalid promo', 'error', 400)).code(400);
    } else if (promotion.expiration && (new Date(promotion.expiration) < new Date())) {
        return h.response(responseFormatter.responseFormatter({}, 'This promo code is no longer valid', 'error', 400)).code(400);
    }
    const idx = promotion.packageIds.findIndex(k => k.toString() === request.payload.packageId);
    if (idx === -1) {
        return h.response(responseFormatter.responseFormatter({}, 'This promotion is not valid for the current package', 'error', 400)).code(400);
    }

    delete promotion.packageIds;

    /* Success */
    return h.response(responseFormatter.responseFormatter(promotion, 'Promotion applied successfully', 'success', 200)).code(200);
};

userHandler.uploadVideo = async (request, h) => {
    let imageUrl, checkData;

    /* Check if the request is coming from the same ip address */
    try {
        checkData = await resumeSchema.resumeSchema.find({
            ipAddress: request.info.remoteAddress,
            createdAt: {$gt: new Date().setHours(0, 0, 0)}
        }, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding total images in upload resume handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (process.env.NODE_ENV === 'production') {
        if (checkData.length > 10) {
            return h.response(responseFormatter.responseFormatter({}, 'You can not upload more than 10 resumes per given day', 'error', 400)).code(400);
        }
    }

    /* Upload video and generate URL */
    try {
        imageUrl = await commonFunctions.Handlers.uploadImage(request.payload.resume.path, request.payload.resume.filename, 'resume');
    } catch (e) {
        logger.error('Error occurred while uploading image in upload resume handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Save this information in database */
    if (imageUrl) {
        const dataToSave = {
            ipAddress: request.info.remoteAddress,
            resumeLink: imageUrl
        }
        try {
            await new resumeSchema.resumeSchema(dataToSave).save();
        } catch (e) {
            logger.error('Error occurred while saving data in upload resume handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        return h.response(responseFormatter.responseFormatter({url: imageUrl}, 'Uploaded successfully', 'success', 201)).code(200);
    } else {
        return h.response(responseFormatter.responseFormatter({}, 'Error occurred while uploading image', 'error', 500)).code(500);
    }
};

userHandler.createOrder = async (request, h) => {
    let checkUser, currency, taxBracket, order, constantData, taxType;

    /* Check if user exists or not if userId is provided */
    if (request.payload.userId) {
        try {
            checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {
                _id: 1,
                firstName: 1,
                lastName: 1,
                email: 1,
                phone: 1
            }, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching user data in create order resume writing handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!checkUser) {
            return h.response(responseFormatter.responseFormatter({}, 'No such user found', 'error', 404)).code(404);
        }
    }

    /*
    * Get Currency data from the country
    * */
    try {
        currency = await codeSchema.CodeSchema.findOne({countryISOName: request.payload.country}, {currencyName: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting currency data in create order resume writing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!currency) {
        return h.response(responseFormatter.responseFormatter({}, 'Error occurred while fetching currency for the given country', 'error', 400)).code(400);
    } else {
        request.payload.currency = currency.currencyName;
    }

    /*
    * Get the amount for Resume writing Services based on the country
    * */
    let resumePricing;
    try {
        resumePricing = await resumePricingSchema.resumePricingSchema.findOne({country: request.payload.country}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting resume pricing data in create order resume writing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!resumePricing) {
        /* Find the default pricing value */
        try {
            resumePricing = await resumePricingSchema.resumePricingSchema.findOne({isDefault: true}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in getting resume pricing data in create order resume writing handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /*
   * Get the tax bracket
   * */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {taxes: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting constant data data in create order resume writing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (constantData.taxes.length) {
        const idx = constantData.taxes.findIndex(k => k.country === request.payload.country);
        if (idx !== -1) {
            taxBracket = constantData.taxes[idx].taxAmount;
            taxType = constantData.taxes[idx].taxType;
            resumePricing.actualPrice = (resumePricing.actualPrice * (1 + taxBracket / 100));
        }
    }

    /*
    * Create order on Razorpay
    * */
    const notes = {
        customerId: checkUser ? checkUser._id : '',
        customerName: request.payload.name,
        email: request.payload.email,
        phone: request.payload.phone,
        type: 'resume writing'
    };
    order = await rzrPay.Handler.createOrder(resumePricing.actualPrice * 100, currency.currencyName, notes);
    if (order.statusCode && order.statusCode !== 200) {
        return h.response(responseFormatter.responseFormatter({}, order.error.error.description, 'error', order.statusCode)).code(order.statusCode);
    }

    /*
    * Save this information into database
    * */
    request.payload.orderId = order.id;
    request.payload.mode = checkUser ? 'auto' : 'manual';
    request.payload.taxType = taxType || '';
    request.payload.taxAmount = taxBracket;
    request.payload.totalAmountPaid = resumePricing.actualPrice;
    if (!request.payload.userId) {
        delete request.payload.userId;
    }
    const dataToSave = new resumeOrderSchema.resumeOrderSchema(request.payload);

    try {
        await dataToSave.save();
    } catch (e) {
        logger.error('Error occurred in saving resume order in create order resume writing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({orderId: order.id}, 'Order created', 'success', 201)).code(200);
}

userHandler.validateSignature = async (request, h) => {
    console.log(request.payload);
    let isSignatureValid, order, userInfo, searchCriteria = {
        email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')
    }, currency;

    isSignatureValid = rzrPay.Handler.validateSignature(request.payload.razorpay_payment_id, request.payload.razorpay_order_id, request.payload.razorpay_signature, true);

    if (isSignatureValid) {
        try {
            order = await resumeOrderSchema.resumeOrderSchema.findOneAndUpdate({orderId: request.payload.razorpay_order_id}, {
                $set: {
                    razorpay_payment_id: request.payload.razorpay_payment_id,
                    isSignatureVerified: true,
                    isPaid: true,
                    purchasedDate: new Date()
                }
            }, {lean: true, new: true});
        } catch (e) {
            logger.error('Error occurred in updating resume order in validate signature handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Create user in the EZJobs if user is not created before */
        if (!request.payload.userId && !request.payload.existingResume) {
            try {
                userInfo = await userSchema.UserSchema.findOne(searchCriteria, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in finding user in validate signature handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            /* Attach currency based on country at the time of login */
            try {
                currency = await codeSchema.CodeSchema.findOne({countryISOName: request.payload.country}, {currencyName: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in finding currency in validate signature handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (currency) {
                request.payload.currency = currency.currencyName;
            }

            /* Check if user exists. If not create new user in database */
            try {
                if (!userInfo) {
                    const userData = new userSchema.UserSchema(request.payload);
                    let result, latitude, longitude;
                    if (request.payload.phone) {
                        userData.employeeInformation.phone = request.payload.phone;
                    }
                    userData.employerInformation.country = request.payloadcountry;
                    userData.employeeInformation.country = request.payload.country;
                    userData.country = request.payload.country;
                    userData.gender = request.payload.gender;
                    userData.tempPassword = commonFunctions.Handlers.generatePassword();
                    userData.password = userData.tempPassword;
                    userData.isRoleSet = true;
                    userData.employeeInformation.dob = request.payload.dob;
                    userData.employeeInformation.education = request.payload.education;
                    userData.employeeInformation.homeTown = request.payload.city;
                    userData.employeeInformation.pastJobTitlesModified = request.payload.workHistory;
                    userData.employeeInformation.resume = order.resume;
                    userData.employeeInformation.isEZCVResume = true;
                    userData.employeeInformation.skills = request.payload.skills;
                    userData.employeeInformation.skillsLower = request.payload.skills.map(k => k.toLowerCase());
                    userData.employeeInformation.futureJobTitles = [request.payload.jobTitle];

                    /* Get the coordinates from lat long */
                    try {
                        result = await commonFunctions.Handlers.geocode(request.payload.city + ', ' + order.country);
                    } catch (e) {
                        logger.error('Error occurred while geo coding user address in validate signature handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                    if (result && result.length) {
                        latitude = result[0].latitude;
                        longitude = result[0].longitude;

                        userData.employeeInformation.location.coordinates = [longitude, latitude];
                        userData.employerInformation.companyLocation.coordinates = [longitude, latitude];
                        userData.employeeInformation.preferredLocations.coordinates = [[longitude, latitude]];
                        userData.employeeInformation.preferredLocationCities = [{
                            city: request.payload.city,
                            country: request.payload.country, latitude: latitude, longitude: longitude
                        }];
                    }

                    let language;
                    try {
                        language = await languageSchema.languageSchema.findOne({
                            country: request.payload.country,
                            language: 'en'
                        }, {_id: 1, name: 1}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred in finding language data in validate signature handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                    if (language) {
                        userData.appLanguage = language._id;
                        userData.chatLanguage = language._id;
                    }

                    userData.roles = ['Candidate'];
                    userData.hasOwned = false;

                    /* Get the visiting card details */
                    let card;
                    if (!userData.employeeInformation.card) {
                        try {
                            card = await visitingCardSchema.visitingCardSchema.findOne({}, {}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred getting visiting card in validate signature handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }
                        if (card) {
                            userData.employeeInformation.card = card._id;
                        }

                        /* Generate deep link if it is not there */
                        if (!userData.employeeInformation.profileLink) {
                            let deepLink = await commonFunctions.Handlers.createFirebaseShortLink('', '', userData._id, '', '', '', '', '', '');
                            if (deepLink === 'error') {
                                console.log('Error occurred in creating deep link');
                            } else {
                                userData.employeeInformation.profileLink = deepLink.shortLink;
                            }
                        }
                    }

                    try {
                        const tempData = await userData.save();
                        const dataToSave = tempData.toObject();

                        /* Send verification email to user */
                        if (order.email) {
                            /* Send welcome email */
                            try {
                                let email = {
                                    to: [{
                                        email: order.email,
                                        name: order.name.trim(),
                                        type: 'to'
                                    }],
                                    important: false,
                                    merge: true,
                                    merge_language: 'mailchimp',
                                    merge_vars: [{
                                        rcpt: order.email,
                                        vars: [
                                            {
                                                name: 'fname',
                                                content: order.name
                                            },
                                            {
                                                name: 'email',
                                                content: order.email
                                            },
                                            {
                                                name: 'password',
                                                content: userData.tempPassword
                                            }
                                        ]
                                    }]
                                };
                                mandrill.Handlers.sendTemplate('ezresume-to-ezjobs-registration', [], email, true)
                            } catch (e) {
                                logger.error('Error in sending email to user %s:', JSON.stringify(e));
                            }
                        }

                        let emailPreferenceUser;
                        /* Check for email preference */
                        try {
                            emailPreferenceUser = await emailPreferenceUserSchema.emailPreferenceUserSchema.findOne({userId: dataToSave._id}, {}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred while finding user email preferences in validate signature handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }
                        if (!emailPreferenceUser) {
                            let preferences = [], documentsToInsert = [];
                            /* Save all email preferences */
                            try {
                                preferences = await emailPreferenceTypeSchema.emailPreferenceTypeSchema.find({}, {}, {lean: true});
                            } catch (e) {
                                logger.error('Error occurred while finding email preferences in create user handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }

                            for (let i = 0; i < preferences.length; i++) {
                                const prefToSave = {
                                    userId: dataToSave._id,
                                    categoryId: preferences[i]._id,
                                    id: i + 1,
                                    isSelected: true
                                };
                                documentsToInsert.push({insertOne: {'document': new emailPreferenceUserSchema.emailPreferenceUserSchema(prefToSave)}});
                            }
                            try {
                                await emailPreferenceUserSchema.emailPreferenceUserSchema.collection.bulkWrite(documentsToInsert);
                            } catch (e) {
                                logger.error('Error occurred while saving email preference data in validate signature handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }
                        }

                        dataToSave.isSignup = true;
                    } catch (e) {
                        logger.error('%s', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }
            } catch (e) {
                console.log(e);
                logger.error('%s', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        } else if (request.payload.existingResume) {
            /* Send email to admin for temporary password */
            const mailOptions = {
                from: 'support@ezjobs.io',
                to: 'orders@ezjobs.io',
                subject: 'New Resume Order Received',
                text: 'Email: ' + order.email + '\n' +
                    'Name: ' + order.name + '\n' +
                    'Phone: ' + (request.payload.countryCode || '') + order.phone + '\n' +
                    'Template: ' + order.themeName + '\n' +
                    'Price: ' + (request.payload.currency || '') + order.totalAmountPaid,
                attachments: [
                    {
                        filename: 'resume.pdf',
                        path: order.resume
                    }
                ]
            };

            if (process.env.NODE_ENV === 'production') {
                try {
                    commonFunctions.Handlers.nodeMailerEZJobsWithAttachment(mailOptions);
                } catch (e) {
                    console.log(e);
                    logger.error('Error in sending order email to admin %s:', JSON.stringify(e));
                }
            }
        }

        /* Success */
        return h.response(responseFormatter.responseFormatter({}, 'Signature verified', 'success', 200)).code(200);
    }

    return h.response(responseFormatter.responseFormatter({}, 'Signature not verified', 'error', 400)).code(400);
};

userHandler.getResumePricing = async (request, h) => {
    let resumePricing, constantData, taxBracket = 0, priceWithoutTax, promoAmount = 0, promoData, originalPrice = 0;

    try {
        resumePricing = await resumePricingSchema.resumePricingSchema.findOne({country: request.query.country}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting resume pricing data in get resume pricing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!resumePricing) {
        /* Find the default pricing value */
        try {
            resumePricing = await resumePricingSchema.resumePricingSchema.findOne({isDefault: true}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in getting resume pricing data in get resume pricing handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    originalPrice = resumePricing.actualPrice;

    /*
    * Check if promotion is applied
    * */
    if (request.query.promoCode) {
        try {
            promoData = await promoCodeSchema.promoCodeSchema.findOne({promoCode: request.query.promoCode}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in getting promo data in get resume pricing handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!promoData) {
            return h.response(responseFormatter.responseFormatter({}, 'Discount code is not valid.', 'error', 400)).code(400);
        } else if (!promoData.forResume) {
            return h.response(responseFormatter.responseFormatter({}, 'Discount code is not valid.', 'error', 400)).code(400);
        }
        if (promoData.promoType === 'percentage') {
            promoAmount = originalPrice * (promoData.amount / 100);
        } else {
            promoAmount = (originalPrice - promoData.amount) < 0 ? originalPrice : (originalPrice - promoData.amount);
        }

        if (promoAmount > originalPrice) {
            promoAmount = originalPrice;
        }

        resumePricing.actualPrice -= promoAmount;
    }

    /*
   * Get the tax bracket
   * */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {taxes: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting constant data data in get resume pricing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (constantData.taxes.length) {
        const idx = constantData.taxes.findIndex(k => k.country === request.query.country);
        if (idx !== -1) {
            taxBracket = constantData.taxes[idx].taxAmount;
            priceWithoutTax = resumePricing.actualPrice;
            resumePricing.actualPrice = (resumePricing.actualPrice * (1 + taxBracket / 100));
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({
        strikePrice: resumePricing.strikePrice,
        originalPrice: originalPrice,
        actualPrice: resumePricing.actualPrice,
        tax: taxBracket,
        priceWithoutTax: priceWithoutTax,
        promoAmount: promoAmount
    }, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.sendOTPResume = async (request, h) => {
    let checkUser, checkOtp, internalParameters;

    const parameterToMatch = new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi');

    try {
        checkUser = await userSchema.UserSchema.findOne({$or: [{email: parameterToMatch}, {phone: parameterToMatch}]}, {
            deviceToken: 1,
            deviceType: 1,
            phone: 1,
            countryCode: 1,
            email: 1
        }, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding user in send otp resume writing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'We did not find any account with the given information.', 'error', 404)).code(404);
    }

    /* Check OTP */
    try {
        checkOtp = await otpSchema.otpSchema.findOne({email: request.payload.email}, {
            updatedAt: 1,
            count: 1,
            mode: 1
        }, {upsert: true, lean: true});
    } catch (e) {
        logger.error('Error occurred while finding otp in send otp resume writing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (checkOtp && checkOtp.mode === 'phone') {
        const diff = (new Date() - new Date(checkOtp.updatedAt)) / 1000;
        /* Check if count exceeds the allowed number of resends */
        if (diff > 86400) {
            checkOtp.count = 0;
        } else if (checkOtp.count && checkOtp.count > 9) {
            return h.response(responseFormatter.responseFormatter({}, 'You are allowed to receive a maximum of 10 OTP codes per calendar day for security reasons.', 'error', 400)).code(400);
        }

        if (diff < 60) {
            return h.response(responseFormatter.responseFormatter({}, 'Please wait upto 60 seconds to resend the OTP.', 'error', 400)).code(400);
        }
    }

    const otp = commonFunctions.Handlers.generateOTP();

    const dataToSave = {
        otp: otp,
        email: request.payload.email,
        userId: checkUser._id,
        mode: request.payload.isPhone ? 'phone' : 'app'
    };
    try {
        await otpSchema.otpSchema.findOneAndUpdate({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {$set: dataToSave}, {
            lean: true,
            upsert: true
        });
    } catch (e) {
        logger.error('Error occurred while saving otp in send otp resume writing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send OTP in app or on phone based on the user criteria */
    if (request.payload.isPhone) {
        /* Get flag from the internal parameters for text sending provider */
        try {
            internalParameters = await internalParameterSchema.internalParameterSchema.findOne({}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching internal parameters in send otp resume writing handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (checkUser.phone) {
            if (checkUser.country === 'IN') {
                if (!!internalParameters.useTextLocal) {
                    await commonFunctions.Handlers.sendOTPTextLocal(checkUser.countryCode || '+91', checkUser.phone, otp, '');
                } else {
                    commonFunctions.Handlers.sendOTP(checkUser.countryCode || '+91', checkUser.phone, otp, '');
                }
            } else {
                commonFunctions.Handlers.sendOTP(checkUser.countryCode, checkUser.phone, otp, '');
            }
        } else {
            let email = {
                to: [{
                    email: checkUser.email,
                    type: 'to'
                }],
                important: true,
                merge: true,
                inline_css: true,
                merge_language: 'mailchimp',
                merge_vars: [{
                    rcpt: checkUser.email,
                    vars: [
                        {
                            name: 'otp',
                            content: otp
                        }
                    ]
                }]
            };
            await mandrill.Handlers.sendTemplate('otp', [], email, true);
        }
    } else {
        let notification = {
            sentTo: checkUser._id,
            isAdmin: true,
            adminId: '5ce54cd59266381ee8cad49b',
            isRead: false,
            message: 'This is your one time password for EZCV - ' + otp,
            image: 'https://images.onata.com/test/02RNd9alezj.png',
            type: 'otp'
        };

        /* Save notification into database */
        try {
            await new notificationSchema.notificationSchema(notification).save();
        } catch (e) {
            logger.error('Error occurred while saving notification in send otp resume writing handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        const pushData = {
            title: 'One time password',
            body: otp + ' - This is your one time password from EZCV.',
            pushType: 'ezcv_otp'
        }

        /* Send push notification to the user */
        push.createMessage(checkUser.deviceToken, [], pushData, checkUser.deviceType, 'One time password', otp + ' - This is your one time password from EZCV.');
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({userId: checkUser._id}, 'OTP sent successfully', 'success', 200)).code(200);

};

userHandler.verifyOTPResume = async (request, h) => {
    let checkUser, otp, dataToReturn = {};

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {
            password: 0,
            employerInformation: 0
        }, {});
    } catch (e) {
        logger.error('Error occurred finding user information in verify otp resume writing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Remove OTP from database */
    try {
        otp = await otpSchema.otpSchema.findOneAndDelete({
            userId: mongoose.Types.ObjectId(request.payload.userId),
            otp: request.payload.otp
        });
    } catch (e) {
        logger.error('Error occurred while removing otp in verify otp resume writing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (otp) {
        return h.response(responseFormatter.responseFormatter(checkUser, 'OTP verified', 'success', 200)).code(200);
    } else {
        return h.response(responseFormatter.responseFormatter({}, 'OTP is invalid', 'error', 400)).code(400);
    }
};

userHandler.convertImageToBase64 = async (request, h) => {
    const images = [];

    for (let i = 0; i < request.payload.urls.length; i++) {
        const img = await commonFunctions.Handlers.convertImage(request.payload.urls[i]);
        if (img !== 'error') {
            images.push(img);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(images, 'Fetched successfully.', 'success', 200)).code(200);
};

userHandler.updateOrder = async (request, h) => {
    let checkOrder;

    try {
        checkOrder = await resumeOrderSchema.resumeOrderSchema.findOneAndUpdate({orderId: request.payload.orderId}, {$set: {resume: request.payload.resume}}, {new: true});
    } catch (e) {
        logger.error('Error occurred while updating order in update order handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (request.payload.uploadToProfile && checkOrder.userId) {
        try {
            userSchema.UserSchema.findByIdAndUpdate({_id: checkOrder.userId}, {
                $set: {
                    'employeeInformation.resume': checkOrder.resume,
                    'employeeInformation.isEZCVResume': true
                }
            }).exec();
        } catch (e) {
            logger.error('Error occurred while updating user in update order handler %s:', JSON.stringify(e));
        }
    } else {
        try {
            userSchema.UserSchema.findOneAndUpdate({email: checkOrder.email}, {
                $set: {
                    'employeeInformation.resume': checkOrder.resume,
                    'employeeInformation.isEZCVResume': true
                }
            }).exec();
        } catch (e) {
            logger.error('Error occurred while updating user in update order handler %s:', JSON.stringify(e));
        }
    }

    /* Send email with the resume link as well */
    if (checkOrder) {
        let email = {
            to: [{
                email: checkOrder.email,
                type: 'to'
            }],
            important: true,
            merge: true,
            inline_css: true,
            merge_language: 'mailchimp',
            subject: 'Thank you for your order!',
            merge_vars: [{
                rcpt: checkOrder.email,
                vars: [
                    {
                        name: 'date',
                        content: new Date(checkOrder.createdAt).toLocaleDateString('en', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        })
                    },
                    {
                        name: 'orderId',
                        content: checkOrder.orderId
                    },
                    {
                        name: 'resume',
                        content: await commonFunctions.Handlers.createFirebaseShortLinkForExcel(checkOrder.resume)
                    },
                    {
                        name: 'amount',
                        content: checkOrder.totalAmountPaid
                    }
                ]
            }]
        };
        mandrill.Handlers.sendTemplate('ezjobs-resume-writing-order', [], email, true);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
}

userHandler.getResponsibilities = async (request, h) => {
    let responsibilities = [], keywords, criteria;

    keywords = request.query.jobTitle.split(' ');
    criteria = {$or: []};
    for (let i = 0; i < keywords.length; i++) {
        criteria.$or.push(
            {
                jobTitle: {$all: [new RegExp(keywords[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
            }
        );
    }

    try {
        responsibilities = await taskSchema.taskSchema.find(criteria, {responsibility: 1}, {lean: true});
    } catch (e) {
        console.log(e);
        logger.error('Error occurred while getting tasks in get responsibilities handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(responsibilities, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getLatLngs = async (request, h) => {
    let latlngs, searchCriteria = {};
    if (request.query.address) {
        const text = decodeURIComponent(request.query.address);
        searchCriteria.$or = [
            {
                'city': {$all: [new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
            }
        ];
    }
    try {
        latlngs = await citySchema.citySchema.find(searchCriteria, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting latlngs in get LatLngs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(latlngs, 'Fetched successfully', 'success', 200)).code(200);
}

userHandler.getPosts = async (request, h) => {
    let checkUser, decoded, posts, networkUsers, aggregationCriteria, searchTerms, tags, searchCriteria;

    /* Check if the user exists or not and also if the user token is valid or not */
    try {
        [checkUser, decoded] = await Promise.all([userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true}),
            commonFunctions.Handlers.decodeToken(request.auth.credentials.token)]);
    } catch (e) {
        logger.error('Error occurred while checking user and decoding token in get posts handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user found.', 'error', 404)).code(404);
    }

    /* Get search Terms and Tags */
    try {
        [searchTerms, tags] = await Promise.all([searchHistorySchema.searchHistorySchema.find({userId: mongoose.Types.ObjectId(request.query.userId)}, {}, {lean: true}).sort({_id: -1}).limit(150),
            tagSchema.tagSchema.find({userId: mongoose.Types.ObjectId(request.query.userId)}, {}, {lean: true}).sort({_id: -1}).limit(150)]);
    } catch (e) {
        logger.error('Error occurred while getting search terms and tags in get posts handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    searchTerms = searchTerms.map(k => k.searchTerm);
    tags = tags.map(k => k.tag);

    /* If user has enough data in search terms and/or tags then serve posts based on his preference */
    if (searchTerms.length + tags.length > 10) {
        searchCriteria = {
            $or: [
                {
                    tags: {$all: searchTerms}
                },
                {
                    body: {$all: tags}
                },
                {
                    tags: {$all: tags}
                },
                {
                    body: {$all: searchTerms}
                }
            ]
        }
    }

    /* Get Network Users */
    try {
        networkUsers = await networkSchema.networkSchema.find({
            $or: [{sender: mongoose.Types.ObjectId(request.query.userId)}, {receiver: mongoose.Types.ObjectId(request.query.userId)}],
            status: 'accepted'
        }, {sender: 1, receiver: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding network users in get posts handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (networkUsers.length) {
        networkUsers = networkUsers.map(k => {
            if (k.sender.toString() === checkUser._id.toString()) {
                return k.receiver;
            } else {
                return k.sender;
            }
        });
    }

    /* Get the posts */
    aggregationCriteria = [
        {
            $sort: {
                _id: -1
            }
        },
        {
            $match: {
                userId: {$ne: mongoose.Types.ObjectId(request.query.userId)},
                reportedBy: {$nin: [mongoose.Types.ObjectId(request.query.userId)]},
                hiddenBy: {$nin: [mongoose.Types.ObjectId(request.query.userId)]},
                $and: [
                    {
                        $or: [
                            {
                                $and: [
                                    /*{
                                        userId: {$in: networkUsers}
                                    },*/
                                    {
                                        limitedVisibility: true
                                    }
                                ]
                            },
                            {
                                limitedVisibility: false
                            }
                        ]
                    },
                    {
                        $or: [
                            {
                                $and: [
                                    {
                                        expiration: {$gte: new Date()}
                                    },
                                    {
                                        isPoll: true
                                    }
                                ]
                            },
                            {
                                isPoll: false
                            }
                        ]
                    }
                ],
                isUnderReview: false
            }
        }
    ];

    if (request.query.pageId) {
        /* Remove self post check in the pages */
        delete aggregationCriteria[1].$match.userId;
        aggregationCriteria.push({$match: {pageId: mongoose.Types.ObjectId(request.query.pageId)}});
    }

    /* If search text is given */
    if (request.query.searchText) {
        aggregationCriteria.push({
            $match: {
                $or: [
                    {
                        tags: {$all: [new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                    },
                    {
                        body: {$all: [new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                    }
                ]
            }
        });

        /* Save the search term in collection */
        const dataToSave = {
            userId: mongoose.Types.ObjectId(request.query.userId),
            searchTerm: request.query.searchText.trim()
        };

        /* Save the same into collection */
        try {
            new searchHistorySchema.searchHistorySchema(dataToSave).save();
        } catch (e) {
            logger.error('Error occurred while saving search term in search terms in get posts handler %s:', JSON.stringify(e));
        }
    } else {
        if (searchCriteria) {
            aggregationCriteria.push({$match: searchCriteria});
        }
    }

    aggregationCriteria.push({
        $skip: request.query.skip
    }, {
        $limit: request.query.limit
    }, {
        $lookup: {
            from: 'User',
            localField: 'userId',
            foreignField: '_id',
            as: 'user'
        }
    }, {
        $unwind: '$user'
    }, {
        $lookup: {
            from: 'User',
            localField: 'postedBy',
            foreignField: '_id',
            as: 'postedBy'
        }
    }, {
        $unwind: {
            path: '$postedBy',
            preserveNullAndEmptyArrays: true
        }
    }, {
        $lookup: {
            from: 'Like',
            let: {userId: checkUser._id, postId: '$_id'},
            pipeline: [
                {
                    $match: {
                        $expr: {
                            $and: [
                                {
                                    $eq: ['$userId', '$$userId']
                                },
                                {
                                    $eq: ['$postId', '$$postId']
                                }
                            ]
                        }
                    }
                }
            ],
            as: 'like'
        }
    }, {
        $project: {
            _id: 1,
            userInfo: {
                _id: '$user._id',
                firstName: '$user.firstName',
                lastName: '$user.lastName',
                experience: {
                    $filter: {
                        input: '$user.employeeInformation.pastJobTitlesModified',
                        as: 'exp',
                        cond: {$eq: ['$$exp.isCurrent', true]}
                    }
                },
                profilePhoto: '$user.employeeInformation.profilePhoto',
                companyProfilePhoto: '$user.employerInformation.companyProfilePhoto',
                companyName: '$user.employerInformation.companyName',
                city: '$user.employerInformation.companyAddress.city',
                state: '$user.employerInformation.companyAddress.state'
            },
            views: 1,
            likeCount: 1,
            commentCount: 1,
            postedBy: {
                _id: '$postedBy._id',
                firstName: '$postedBy.firstName',
                lastName: '$postedBy.lastName',
                experience: {
                    $filter: {
                        input: '$postedBy.employeeInformation.pastJobTitlesModified',
                        as: 'exp',
                        cond: {$eq: ['$$exp.isCurrent', true]}
                    }
                },
                profilePhoto: '$postedBy.employeeInformation.profilePhoto',
                companyProfilePhoto: '$postedBy.employerInformation.companyProfilePhoto',
                companyName: '$postedBy.employerInformation.companyName',
                city: '$postedBy.employerInformation.companyAddress.city',
                state: '$postedBy.employerInformation.companyAddress.state'
            },
            isShare: 1,
            isPoll: 1,
            questions: 1,
            totalVotes: 1,
            shareLink: 1,
            isConnection: {
                $cond: [{$in: ['$userId', networkUsers]}, true, false]
            },
            likeFlag: {
                $cond: [
                    {
                        $gt: [
                            {
                                $size: '$like'
                            },
                            0
                        ]
                    },
                    true,
                    false
                ]
            },
            body: 1,
            tags: 1,
            media: 1,
            question: 1,
            options: 1,
            totalVotes: 1,
            votes: 1,
            pollId: 1,
            createdAt: 1,
            originalPostId: 1
        }
    }, {
        $unwind: {
            path: '$userInfo.experience',
            preserveNullAndEmptyArrays: true
        }
    }, {
        $unwind: {
            path: '$postedBy.experience',
            preserveNullAndEmptyArrays: true
        }
    }, {
        $lookup: {
            from: 'Post',
            let: {'id': '$originalPostId'},
            pipeline: [
                {
                    $match: {
                        $expr: {
                            $eq: ['$_id', '$$id']
                        }
                    }
                },
                {
                    $project: {
                        body: 1,
                        tags: 1,
                        media: 1,
                        views: 1,
                        likeCount: 1,
                        commentCount: 1
                    }
                }
            ],
            as: 'originalPostData'
        }
    }, {
        $unwind: {
            path: '$originalPostData',
            preserveNullAndEmptyArrays: true
        }
    }, {
        $project: {
            _id: 1,
            userInfo: {
                _id: 1,
                firstName: 1,
                lastName: 1,
                experience: 1,
                profilePhoto: 1,
                companyProfilePhoto: 1,
                companyName: 1,
                city: 1,
                state: 1
            },
            views: 1,
            likeCount: 1,
            commentCount: 1,
            postedBy: {
                _id: 1,
                firstName: 1,
                lastName: 1,
                experience: 1,
                profilePhoto: 1,
                companyProfilePhoto: 1,
                companyName: 1,
                city: 1,
                state: 1
            },
            isShare: 1,
            isPoll: 1,
            questions: 1,
            totalVotes: 1,
            shareLink: 1,
            isConnection: 1,
            likeFlag: 1,
            body: 1,
            tags: 1,
            media: 1,
            question: 1,
            options: 1,
            totalVotes: 1,
            votes: 1,
            pollId: 1,
            createdAt: 1,
            originalPostData: 1
        }
    });

    try {
        posts = await postSchema.postSchema.aggregate(aggregationCriteria)
    } catch (e) {
        logger.error('Error occurred while finding posts in get posts handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Filter all poll posts information and attach */
    const polls = posts.filter(k => k.isPoll === true);
    const pollIds = polls.map(k => k.pollId);
    let pollData;

    try {
        pollData = await pollSchema.pollSchema.aggregate([
            {
                $match: {
                    _id: {$in: pollIds}
                }
            },
            {
                $lookup: {
                    from: 'Vote',
                    localField: '_id',
                    foreignField: 'pollId',
                    as: 'vote'
                }
            },
            {
                $unwind: {
                    path: '$vote',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $group: {
                    _id: {
                        selectedOption: '$vote.selectedOption',
                        pollId: '$vote.pollId'
                    },
                    count: {$sum: 1},
                    userIds: {$push: '$vote.userId'},
                    question: {$first: '$question'},
                    options: {$first: '$options'},
                    totalVotes: {$first: '$totalVotes'},
                    pollId: {$first: '$_id'}
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred while aggregating polls in get posts handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Attach Poll related information to main Posts object */
    for (let i = 0; i < pollData.length; i++) {
        const idx = posts.findIndex(k => ((k.pollId ? k.pollId.toString() : '') === pollData[i].pollId.toString()));
        if (idx !== -1) {
            posts[idx].question = pollData[i].question;
            posts[idx].totalVotes = pollData[i].totalVotes;
            posts[idx].options = pollData[i].options;
            if (typeof pollData[i]._id.selectedOption === 'number') {
                posts[idx].votes = (posts[idx].votes || []).concat([{
                    selectedOptionIndex: pollData[i]._id.selectedOption,
                    votes: pollData[i].count
                }]);
            }
            pollData[i].userIds = pollData[i].userIds.map(k => k.toString());
            const userIdx = pollData[i].userIds.findIndex(k => k === checkUser._id.toString());
            posts[idx].userVoted = posts[idx].userVoted || (userIdx !== -1);
            if (userIdx !== -1) {
                posts[idx].userSelectedOptionIndex = pollData[i]._id.selectedOption;
            }
        }
    }

    /* Update the number of views count */
    const postIds = posts.map(k => k._id);
    try {
        postSchema.postSchema.updateMany({_id: {$in: postIds}}, {$inc: {views: 1}}).exec();
    } catch (e) {
        logger.error('Error occurred while incrementing total views in get posts handler %s:', JSON.stringify(e));
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(posts, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.createPost = async (request, h) => {
    let checkUser, decoded, postData;


    /* Check if the user exists or not and also if the user token is valid or not */
    try {
        [checkUser, decoded] = await Promise.all([userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true}),
            commonFunctions.Handlers.decodeToken(request.auth.credentials.token)]);
    } catch (e) {
        logger.error('Error occurred while checking user and decoding token in create post handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user found.', 'error', 404)).code(404);
    }

    if ((!request.payload.body && !request.payload.media.length && !request.payload.tags.length) && (!request.payload.isPoll && !request.payload.isShare)) {
        return h.response(responseFormatter.responseFormatter({}, 'Your post should be either Regular post or a Poll.', 'error', 400)).code(400);
    }

    if (!request.payload.isPoll) {
        request.payload.isPoll = undefined;
    } else if (!request.payload.question || !(request.payload.options && request.payload.options.length)) {
        return h.response(responseFormatter.responseFormatter({}, 'You must provide Poll question and/or options.', 'error', 400)).code(400);
    }

    /* Check if the post is going to be posted in multiple pages */
    if (request.payload.pageIds && request.payload.pageIds.length) {
        for (let i = 0; i < request.payload.pageIds.length; i++) {
            const dataToSave = new postSchema.postSchema(request.payload);
            dataToSave.pageId = mongoose.Types.ObjectId(request.payload.pageIds[i]);
            dataToSave.isUnderReview = !!(request.payload.media && request.payload.media.length);

            /* Check if the post is of type poll */
            if (request.payload.isPoll) {
                const pollToSave = {
                    userId: checkUser._id,
                    question: request.payload.question,
                    options: request.payload.options
                }

                let pollData;
                try {
                    pollData = await new pollSchema.pollSchema(pollToSave).save();
                } catch (e) {
                    logger.error('Error occurred while saving poll data in create post handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                dataToSave.pollId = pollData._id;
            }

            /* Save the post into collection */
            try {
                await dataToSave.save();
            } catch (e) {
                logger.error('Error occurred while saving post data in create post handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    } else {
        if (!request.payload.isShare) {
            delete request.payload.postedBy;
            delete request.payload.originalPostId;
        }

        const dataToSave = new postSchema.postSchema(request.payload);
        /*dataToSave.isUnderReview = !!(request.payload.media && request.payload.media.length);*/   // Commented for the development purpose
        dataToSave.peopleCount = request.payload.people ? request.payload.people.length : 0;

        /* Check if the post is of type poll */
        if (request.payload.isPoll) {
            const pollToSave = {
                userId: checkUser._id,
                question: request.payload.question,
                options: request.payload.options
            }

            let pollData;
            try {
                pollData = await new pollSchema.pollSchema(pollToSave).save();
            } catch (e) {
                logger.error('Error occurred while saving poll data in create post handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            dataToSave.pollId = pollData._id;
        }

        /* Save the post into collection */
        try {
            postData = await dataToSave.save();
        } catch (e) {
            logger.error('Error occurred while saving post data in create post handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* If tags are there then save them in collection respective to user */
    if (request.payload.tags && request.payload.tags.length) {
        let documentsToInsert = [];
        for (let i = 0; i < request.payload.tags.length; i++) {
            const dataToSave = {
                userId: mongoose.Types.ObjectId(request.payload.userId),
                tag: request.payload.tags[i]
            };
            documentsToInsert.push({insertOne: {'document': new tagSchema.tagSchema(dataToSave)}});
        }
        try {
            await tagSchema.tagSchema.collection.bulkWrite(documentsToInsert);
        } catch (e) {
            logger.error('Error occurred while saving tag data in create post handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* If people are tagged then save them in collection respective to user */
    if (request.payload.people && request.payload.people.length) {
        const documentsToInsert = [];
        for (let i = 0; i < request.payload.people.length; i++) {
            const dataToSave = {
                userId: request.payload.people[i],
                postId: postData._id,
                posterId: checkUser._id
            };
            documentsToInsert.push({insertOne: {'document': new peopleSchema.peopleSchema(dataToSave)}});
        }
        try {
            await peopleSchema.peopleSchema.collection.bulkWrite(documentsToInsert);
        } catch (e) {
            logger.error('Error occurred while saving people data in create post handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Post created successfully', 'success', 201)).code(200);
};

userHandler.updatePost = async (request, h) => {
    let checkUser, decoded, checkPost;


    /* Check if the user exists or not and also if the user token is valid or not */
    try {
        [checkUser, decoded, checkPost] = await Promise.all([userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true}),
            commonFunctions.Handlers.decodeToken(request.auth.credentials.token), postSchema.postSchema.findById({_id: request.payload.postId}, {
                isPoll: 1,
                isShare: 1,
                pageIds: 1,
                userId: 1
            }, {lean: true})]);
    } catch (e) {
        logger.error('Error occurred while checking user and decoding token in update post handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user found.', 'error', 404)).code(404);
    }

    if ((!request.payload.body && !request.payload.media.length && !request.payload.tags.length)) {
        return h.response(responseFormatter.responseFormatter({}, 'Your post cannot be empty', 'error', 400)).code(400);
    }

    /* Check if post exists */
    if (!checkPost) {
        return h.response(responseFormatter.responseFormatter({}, 'No such post found', 'error', 404)).code(404);
    } else if (checkPost.userId !== checkUser._id) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Update the current as well as all the posts posted in other pages */
    const dataToUpdate = {
        body: request.payload.body,
        media: request.payload.media,
        tags: request.payload.tags,
        peopleCount: request.payload.people ? request.payload.people.length : 0,
        expiration: request.payload.expiration ? request.payload.expiration : undefined
    };

    dataToUpdate['isUnderReview'] = !!(request.payload.media && request.payload.media.length)

    const searchCriteria = {
        $or: [
            {
                postId: mongoose.Types.ObjectId(request.payload.postId),
            },
            {
                pageId: {$in: checkPost.pageIds}
            }
        ]
    };

    if (checkPost.isShare) {
        searchCriteria.$or.push({originalPostId: mongoose.Types.ObjectId(request.payload.postId)});
    }

    /* If people are tagged then update the people collection accordingly */
    if (request.payload.people && request.payload.people.length) {
        /* Remove people who are not tagged in the updated one */
        try {
            await peopleSchema.peopleSchema.deleteMany({postId: checkPost._id, userId: {$nin: request.payload.people}});
        } catch (e) {
            logger.error('Error occurred while deleting people(s) in update post handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Loop through the people array and add them if not already added */
        for (let i = 0; i < request.payload.people.length; i++) {
            try {
                await peopleSchema.peopleSchema.findOneAndUpdate({
                    postId: checkPost._id,
                    userId: {$nin: request.payload.people}
                }, {
                    $set: {
                        postId: checkPost._id,
                        userId: {$nin: request.payload.people},
                        posterId: checkUser._id
                    }
                }, {upsert: true});
            } catch (e) {
                logger.error('Error occurred while updating people(s) in update post handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }

    try {
        await postSchema.postSchema.updateMany(searchCriteria, {$set: dataToUpdate});
    } catch (e) {
        logger.error('Error occurred while updating post(s) in update post handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
};

userHandler.postAction = async (request, h) => {
    let checkUser, decoded, checkPost,checkCommentLike,checkComment;

    /* Check if the user exists or not and also if the user token is valid or not */
    try {
        [checkUser, decoded] = await Promise.all([userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true}),
            commonFunctions.Handlers.decodeToken(request.auth.credentials.token)]);
    } catch (e) {
        logger.error('Error occurred while checking user and decoding token in post action handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user found.', 'error', 404)).code(404);
    }

    /* Check if such post exists */
    try {
        checkPost = await postSchema.postSchema.findById({_id: request.payload.postId}, {
            _id: 1,
            userId: 1,
            pollId: 1,
            isPoll: 1
        }, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding post in post action handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkPost) {
        return h.response(responseFormatter.responseFormatter({}, 'No such post found.', 'error', 404)).code(404);
    }

    /* Check action parameter and based on that perform actions */
    if (request.payload.action === 'report') {
        /* Check if reporting the entire post or a particular comment */
        if (request.payload.commentId) {
            try {
                await commentSchema.commentSchema.findByIdAndUpdate({_id: request.payload.commentId}, {
                    $addToSet: {reportedBy: checkUser._id},
                    $inc: {reportCount: 1}
                });
            } catch (e) {
                logger.error('Error occurred while updating comment about action type report in post action handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        } else {
            try {
                await postSchema.postSchema.findByIdAndUpdate({_id: checkPost._id}, {
                    $addToSet: {reportedBy: mongoose.Types.ObjectId(request.payload.userId)},
                    $inc: {reportCount: 1}
                });
            } catch (e) {
                logger.error('Error occurred while updating post about action type report in post action handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    } else if (request.payload.action === 'hide') {
        try {
            await postSchema.postSchema.findByIdAndUpdate({_id: checkPost._id}, {
                $addToSet: {hiddenBy: mongoose.Types.ObjectId(request.payload.userId)},
                $inc: {hideCount: 1}
            });
        } catch (e) {
            logger.error('Error occurred while updating post about action type hide in post action handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.payload.action === 'like') {
        let checkLike;

        /* Check if user is liking it or disliking it */
        try {
            checkLike = await likeSchema.likeSchema.findOne({
                userId: mongoose.Types.ObjectId(request.payload.userId),
                postId: mongoose.Types.ObjectId(request.payload.postId)
            }, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while checking like existence about action type like in post action handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* If like exists then reduce like count by 1 and remove it from the like collection*/
        if (checkLike) {
            try {
                await Promise.all([likeSchema.likeSchema.findByIdAndDelete({_id: checkLike._id}), postSchema.postSchema.findByIdAndUpdate({_id: checkPost._id}, {$inc: {likeCount: -1}})]);
            } catch (e) {
                logger.error('Error occurred while removing like and reducing like count about action type like in post action handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        } else {
            /* Increase the like count by 1 and add the document in Like Collection */
            const dataToSave = {
                userId: checkUser._id,
                postId: checkPost._id
            }
            try {
                await Promise.all([new likeSchema.likeSchema(dataToSave).save(), postSchema.postSchema.findByIdAndUpdate({_id: checkPost._id}, {$inc: {likeCount: 1}})]);
            } catch (e) {
                logger.error('Error occurred while adding like and increasing like count about action type like in post action handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    } else if (request.payload.action === 'comment') {
        if (!request.payload.comment) {
            return h.response(responseFormatter.responseFormatter({}, 'Comment can not be left blank', 'error', 400)).code(400);
        }

        /* Increase the comment count by 1 and add the document in Comment Collection */
        const dataToSave = {
            userId: checkUser._id,
            postId: checkPost._id,
            comment: request.payload.comment.trim()
        }

        let commentData, postData;
        try {
            [commentData, postData] = await Promise.all([new commentSchema.commentSchema(dataToSave).save(), postSchema.postSchema.findByIdAndUpdate({_id: checkPost._id}, {$inc: {commentCount: 1}})]);
        } catch (e) {
            logger.error('Error occurred while adding comment and increasing comment count about action type comment in post action handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Check if people are tagged */
        if (request.payload.people && request.payload.people.length) {
            const documentsToAdd = [];
            for (let i = 0; i < request.payload.people.length; i++) {
                const dataToSave = {
                    userId: mongoose.Types.ObjectId(request.payload.people[i]),
                    postId: checkPost._id,
                    posterId: checkPost.userId,
                    commentId: commentData._id
                }
                documentsToAdd.push({insertOne: {'document': new peopleSchema.peopleSchema(dataToSave)}});
            }
            try {
                await peopleSchema.peopleSchema.collection.bulkWrite(documentsToAdd);
            } catch (e) {
                logger.error('Error occurred while adding people about action type comment in post action handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    } else if (request.payload.action === 'commentDelete') {
        if (!request.payload.commentId) {
            return h.response(responseFormatter.responseFormatter({}, 'Comment ID is required', 'error', 400)).code(400);
        }
        try {
            await Promise.all([commentSchema.commentSchema.findByIdAndDelete({_id: request.payload.commentId}), postSchema.postSchema.findByIdAndUpdate({_id: checkPost._id}, {$inc: {commentCount: -1}})]);
        } catch (e) {
            logger.error('Error occurred while removing comment and decreasing comment count about action type comment delete in post action handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Delete from people collection if any */
        try {
            peopleSchema.peopleSchema.deleteMany({commentId: mongoose.Types.ObjectId(request.payload.commentId)}).exec();
        } catch (e) {
            logger.error('Error occurred while removing people about action type comment delete in post action handler %s:', JSON.stringify(e));
        }
    } else if (request.payload.action === 'commentEdit') {
        if (!request.payload.commentId) {
            return h.response(responseFormatter.responseFormatter({}, 'Comment ID is required', 'error', 400)).code(400);
        } else if (!request.payload.comment) {
            return h.response(responseFormatter.responseFormatter({}, 'Comment can not be left blank', 'error', 400)).code(400);
        }

        try {
            await commentSchema.commentSchema.findByIdAndUpdate({_id: request.payload.commentId}, {$set: {comment: request.payload.comment.trim()}});
        } catch (e) {
            logger.error('Error occurred while editing comment about action type comment edit in post action handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Delete from people collection if any */
        try {
            peopleSchema.peopleSchema.deleteMany({commentId: mongoose.Types.ObjectId(request.payload.commentId)}).exec();
        } catch (e) {
            logger.error('Error occurred while removing people about action type comment edit in post action handler %s:', JSON.stringify(e));
        }

        if (request.payload.people && request.payload.people.length) {
            const documentsToAdd = [];
            for (let i = 0; i < request.payload.people.length; i++) {
                const dataToSave = {
                    userId: mongoose.Types.ObjectId(request.payload.people[i]),
                    postId: checkPost._id,
                    posterId: checkPost.userId,
                    commentId: mongoose.Types.ObjectId(request.payload.commentId)
                }
                documentsToAdd.push({insertOne: {'document': new peopleSchema.peopleSchema(dataToSave)}});
            }
            try {
                await peopleSchema.peopleSchema.collection.bulkWrite(documentsToAdd);
            } catch (e) {
                logger.error('Error occurred while adding people about action type comment in post action handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    } else if (request.payload.action === 'delete') {
        if (checkPost.userId.toString() !== request.payload.userId) {
            return h.response(responseFormatter.responseFormatter({}, 'You can not perform this action', 'error', 400)).code(400);
        }

        /* Delete the post */
        try {
            await postSchema.postSchema.findByIdAndDelete({_id: checkPost._id});
        } catch (e) {
            logger.error('Error occurred while deleting post in post action handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Delete related comments and likes */
        try {
            await Promise.all([commentSchema.commentSchema.deleteMany({postId: checkPost._id}), likeSchema.likeSchema.deleteMany({postId: checkPost._id})]);
        } catch (e) {
            logger.error('Error occurred while deleting comments and likes in post action handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.payload.action === 'vote') {
        /* Check if post type is poll or not */
        if (!checkPost.isPoll) {
            return h.response(responseFormatter.responseFormatter({}, 'You can only vote to poll posts', 'error', 400)).code(400);
        }

        /* Check if the user has already voted before or not */
        let checkVote;

        try {
            checkVote = await voteSchema.voteSchema.findOne({
                pollId: checkPost.pollId,
                userId: checkUser._id
            }, {_id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding vote in post action handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* If vote is not there then save the voting information into collection */
        if (!checkVote) {
            const voteToSave = {
                userId: checkUser._id,
                pollId: checkPost.pollId,
                selectedOption: request.payload.selectedOption || 0,
                selectedOptionText: request.payload.selectedOptionText || ''
            }

            /* This can use regular JavaScript execution */
            try {
                Promise.all([new voteSchema.voteSchema(voteToSave).save(), pollSchema.pollSchema.findByIdAndUpdate({_id: checkPost.pollId}, {$inc: {totalVotes: 1}})]);
            } catch (e) {
                logger.error('Error occurred while saving vote in post action handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    } else if (request.payload.action === "likeComment") {

    try{
      checkComment = await commentSchema.commentSchema.findById(
        { _id: mongoose.Types.ObjectId(request.payload.commentId) },
        {},
        { lean: true }
      );
    } catch (e) {
      logger.error(
        "Error occurred while finding comment in post action handler %s:",
        JSON.stringify(e)
      );
      return h
        .response(
          responseFormatter.responseFormatter(
            {},
            "An error occurred",
            "error",
            500
          )
        )
        .code(500);
    }
    if (!checkComment) {
      return h
        .response(
          responseFormatter.responseFormatter(
            {},
            "No such comment found.",
            "error",
            404
          )
        )
        .code(404);
    }

      
      try {
        checkCommentLike = await commentLikeSchema.commentLikeSchema.findOne(
          {
            userId: mongoose.Types.ObjectId(request.payload.userId),
            commentId: mongoose.Types.ObjectId(request.payload.commentId),
          },
          {},
          { lean: true }
        );
      } catch (e) {
        logger.error(
          "Error occurred while checking like existence about action type like in post action handler %s:",
          JSON.stringify(e)
        );
        return h
          .response(
            responseFormatter.responseFormatter(
              {},
              "An error occurred",
              "error",
              500
            )
          )
          .code(500);
      }

      if (checkCommentLike) {
        try {
          await Promise.all([
            commentLikeSchema.commentLikeSchema.findByIdAndDelete({ _id: checkCommentLike._id }),
            commentSchema.commentSchema.findByIdAndUpdate(
              { _id: checkComment._id },
              { $inc: { likeCount: -1 } }
            ),
          ]);
        } catch (e) {
          logger.error(
            "Error occurred while removing like and reducing like count about action type like in post action handler %s:",
            JSON.stringify(e)
          );
          return h
            .response(
              responseFormatter.responseFormatter(
                {},
                "An error occurred",
                "error",
                500
              )
            )
            .code(500);
        }
      } else {
        const dataToSave = {
          userId: checkUser._id,
          commentId: checkComment._id,
        };
        try {
          await Promise.all([
            new commentLikeSchema.commentLikeSchema(dataToSave).save(),
            commentSchema.commentSchema.findByIdAndUpdate(
              { _id: checkComment._id },
              { $inc: { likeCount: 1 } }
            ),
          ]);
        } catch (e) {
          logger.error(
            "Error occurred while adding like and increasing like count about action type like in post action handler %s:",
            JSON.stringify(e)
          );
          return h
            .response(
              responseFormatter.responseFormatter(
                {},
                "An error occurred",
                "error",
                500
              )
            )
            .code(500);
        }
      }
    }
    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Operation successful', 'success', 200)).code(200);
};

userHandler.postDetails = async (request, h) => {
    let checkUser, decoded, checkPost, data = [];

    /* Check if the user exists or not and also if the user token is valid or not */
    try {
        [checkUser, decoded, checkPost] = await Promise.all([userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true}),
            commonFunctions.Handlers.decodeToken(request.auth.credentials.token), postSchema.postSchema.findById({_id: request.query.postId}, {}, {lean: true})]);
    } catch (e) {
        logger.error('Error occurred while checking user, decoding token and checking post in get post details handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user found.', 'error', 404)).code(404);
    }
    if (!checkPost) {
        return h.response(responseFormatter.responseFormatter({}, 'No such post found.', 'error', 404)).code(404);
    }

    /* Find data based on the type parameter */
    if (request.query.type === 'likes') {
        try {
            data = await likeSchema.likeSchema.aggregate([
                {
                    $match: {
                        postId: checkPost._id
                    }
                },
                {
                    $lookup: {
                        from: 'User',
                        localField: 'userId',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                {
                    $unwind: '$user'
                },
                {
                    $project: {
                        userId: '$user._id',
                        profilePhoto: '$user.employeeInformation.profilePhoto',
                        companyProfilePhoto: '$user.employerInformation.companyProfilePhoto',
                        firstName: '$user.firstName',
                        lastName: '$user.lastName',
                        companyName: '$user.employerInformation.companyName'
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while finding likes in get post details handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.type === 'comments') {
        try {
            data = await commentSchema.commentSchema.aggregate([
                {
                    $match: {
                        postId: checkPost._id
                    }
                },
                {
                    $lookup: {
                        from: 'User',
                        localField: 'userId',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                {
                    $unwind: '$user'
                },
                {
                    $project: {
                        userId: '$user._id',
                        profilePhoto: '$user.employeeInformation.profilePhoto',
                        companyProfilePhoto: '$user.employerInformation.companyProfilePhoto',
                        firstName: '$user.firstName',
                        lastName: '$user.lastName',
                        companyName: '$user.employerInformation.companyName',
                        comment: 1
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while finding comments in get post details handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(data, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.searchTags = async (request, h) => {
    let checkUser, decoded, tags, searchCriteria = {
        tag: new RegExp('^' + request.query.searchText, 'i')
    };

    /* Check if the user exists or not and also if the user token is valid or not */
    try {
        [checkUser, decoded] = await Promise.all([userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true}),
            commonFunctions.Handlers.decodeToken(request.auth.credentials.token)]);
    } catch (e) {
        logger.error('Error occurred while checking user and decoding token in search tags handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user found.', 'error', 404)).code(404);
    }

    /* Get the list of tags from the collection based on search text */
    try {
        tags = await tagSchema.tagSchema.aggregate([
            {
                $match: searchCriteria
            },
            {
                $group: {
                    _id: '$tag',
                    total: {$sum: 1}
                }
            },
            {
                $skip: request.query.skip
            },
            {
                $limit: request.query.limit
            },
            {
                $project: {
                    _id: 0,
                    tag: '$_id',
                    total: 1
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred while searching tags in search tags handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(tags, 'Fetched successfully', 'success', 200)).code(200);
};

userHandler.getSocialProfileData = async (request, h) => {
    let checkUser, decoded, searchCriteriaForNetwork, searchCriteriaForViews, noOfPosts, noOfPolls, noOfConnections, noOfViews;

    /* Check if the user exists or not and also if the user token is valid or not */
    try {
        [checkUser, decoded] = await Promise.all([userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true}),
            commonFunctions.Handlers.decodeToken(request.auth.credentials.token)]);
    } catch (e) {
        logger.error('Error occurred while checking user and decoding token in get SocialProfileData handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user found.', 'error', 404)).code(404);
    }

    /* Get total posts count */
    try {
        noOfPosts = await postSchema.postSchema.countDocuments({userId: request.query.userId});
    } catch (e) {
        logger.error('Error occurred while counting posts in get SocialProfileData handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get total polls count */
    try {
        noOfPolls = await pollSchema.pollSchema.countDocuments({userId: request.query.userId});
    } catch (e) {
        logger.error('Error occurred while counting polls in get SocialProfileData handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    searchCriteriaForNetwork = {
        $or:[{sender: request.query.userId, status: 'accepted'}, {receiver: request.query.userId, status: 'accepted'}]
    };

    /* Get total connections count */
    try {
        noOfConnections = await networkSchema.networkSchema.countDocuments(searchCriteriaForNetwork);
    } catch (e) {
        logger.error('Error occurred while counting connections in get SocialProfileData handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    searchCriteriaForViews = {
        visitedTo: request.query.userId
    }

    /* Get total views count */
    try {
        noOfViews = await visitorSchema.visitorSchema.countDocuments(searchCriteriaForViews);
    } catch (e) {
        logger.error('Error occurred while counting views in get SocialProfileData handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    const dataToReturn = {
        noOfPosts: noOfPosts + noOfPolls,
        noOfConnections: noOfConnections,
        noOfViews: noOfViews
    };

    /* Success */
    return h.response(responseFormatter.responseFormatter(dataToReturn, 'Fetched successfully', 'success', 200)).code(200);
}

userHandler.visitUser = async (request, h) => {
    let checkUser, decoded, visited;

    /* Check if the user exists or not and also if the user token is valid or not */
    try {
        [checkUser, decoded] = await Promise.all([userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true}),
            commonFunctions.Handlers.decodeToken(request.auth.credentials.token)]);
    } catch (e) {
        logger.error('Error occurred while checking user and decoding token in visit user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user found.', 'error', 404)).code(404);
    }

    /* Check if user already visited or not */
    try {
        visited = await visitorSchema.visitorSchema.findOne({userId: request.payload.userId, visitedTo: request.payload.visitedTo}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in visit user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!visited) {
        const dataToSave = new visitorSchema.visitorSchema(request.payload);
        try {
            await dataToSave.save();
        } catch (e) {
            logger.error('Error occurred in saving visitor information in visit user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Visited successfully', 'success', 200)).code(200);

}

userHandler.getSocialGroups = async (request, h) => {
    let checkUser, decoded, listOfGroups, searchCriteria;

    /* Check if the user exists or not and also if the user token is valid or not */
    try {
        [checkUser, decoded] = await Promise.all([userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true}),
            commonFunctions.Handlers.decodeToken(request.auth.credentials.token)]);
    } catch (e) {
        logger.error('Error occurred while checking user and decoding token in get getSocialGroups handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user found.', 'error', 404)).code(404);
    }

    searchCriteria = {
        createdBy: request.query.userId
    }

    /* Get list of social groups*/
    try {
        listOfGroups = await pageSchema.pageSchema.find(searchCriteria, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while counting views in get getSocialGroups handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(listOfGroups, 'Fetched successfully', 'success', 200)).code(200);
}

function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        function (txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}

/* Create TRIE */
const redisClient1 = require('redis').createClient();

function getAutocomplete(text, prefix) {
    // load Autocomplete, pass along redisClient and prefix.
    const Autocomplete = require('../utils/autocomplete')(redisClient1,prefix);
    return new Promise((resolve, reject) => {
        Autocomplete.suggest(text, 10, function(result) {
            resolve(result);
        });
    });
}

module.exports = {
    Handlers: userHandler
};
