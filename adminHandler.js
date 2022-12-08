'use strict';

const adminSchema = require('../schema/adminSchema');
const codeSchema = require('../schema/codeSchema');
const categorySchema = require('../schema/categorySchema');
const responseFormatter = require('../utils/responseFormatter');
const commonFunctions = require('../utils/commonFunctions');
const logger = require('../utils/logger');
const tokenSchema = require('../schema/authToken');
const userSchema = require('../schema/userSchema');
const permissionSchema = require('../schema/permission');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const push = require('../utils/push');
const weightSchema = require('../schema/weightageSchema');
const chatSuggestionSchema = require('../schema/chatSuggestion');
const constantSchema = require('../schema/constantSchema');
const jobSchema = require('../schema/jobSchema');
const moment = require('moment-timezone');
const conversationSchema = require('../schema/conversationSchema');
const countryList = require('country-list');
const csvToJson = require('convert-csv-to-json');
const incompleteProfileCompleteSchema = require('../schema/incompleteProfileFields');
const notPermittedWordsSchema = require('../schema/badWordsSchema');
const favoriteSchema = require('../schema/favouriteSchema');
const mandrill = require('../utils/mandrill');
const csc = require('country-state-city').default;
const pdf = require("pdf-creator-node");
const fs = require('fs');
const razorPay = require('../utils/paymentGatewayRzrpy');
const packageSchema = require('../schema/packageSchema');
const pricingSchema = require('../schema/pricingSchema');
const languageSchema = require('../schema/languageSchema');
const updateLanguageScript = require('../utils/updateLanguageScript');
const citySchema = require('../schema/citiesSchema');
const subscriptionSchema = require('../schema/subscriptionSchema');
const menuConfigSchema = require('../schema/menuConfig');
const blockUserSchema = require('../schema/blockSchema');
const reportUserSchema = require('../schema/reportUserSchema');
const reportJobSchema = require('../schema/reportJobSchema');
const companyVerificationSchema = require('../schema/companyVerificationSchema');
const verificationFieldSchema = require('../schema/verificationFields');
const jobTitleSchema = require('../schema/jobTitleSchema');
const auditSchema = require('../schema/auditSchema');
const promoCodeSchema = require('../schema/promoCodeSchema');
const internalParameterSchema = require('../schema/internalParameterSchema');
const viewsSchema = require('../schema/viewsSchema');
const pluralize = require('pluralize');
const csv = require('csvtojson');
const emailPreferenceUserSchema = require("../schema/emailPreferenceUser");
const {google} = require('googleapis');
const key = require('../config/googleCrawlerCredentials');
const rp = require('request-promise');
const resumeOrderSchema = require("../schema/resumeOrderSchema");
const taskSchema = require("../schema/taskSchema");
const referralSchema = require("../schema/referralSchema");
const zoneSchema = require('../schema/zoneSchema');
const path = require("path");
let handlers = {};

let baseUrl, emailVerificationUrl;

if (process.env.NODE_ENV === 'development') {
    baseUrl = 'https://dev.onata.com';
    emailVerificationUrl = 'https://devapi.onata.com';
} else if (process.env.NODE_ENV === 'test') {
    baseUrl = 'https://test.ezjobs.io';
    emailVerificationUrl = 'https://testapi.onata.com';
} else if (process.env.NODE_ENV === 'production') {
    baseUrl = 'https://live.onata.com';
    emailVerificationUrl = 'https://liveapi.onata.com';
} else {
    baseUrl = 'http://localhost'
}

handlers.validate = async (request, token, h) =>{
    let decoded;
    let isValid = false;
    const credentials = { token };
    const artifacts = { test: 'info' };
    let checkAdmin = async (userId, token) => {
        const check = await tokenSchema.authTokenSchema.findOne({userId: userId, authToken: token, isExpired: false}, {}, {lean: true});
        return !!check;
    };
    try {
        decoded = await commonFunctions.Handlers.decodeToken(token);
        if (decoded.role === 'ADMIN') {
            try {
                isValid = await checkAdmin(decoded.userId, token);
            } catch (e) {
                logger.error('%s', JSON.stringify(e));
            }
        }
    } catch (e) {}
    return { isValid, credentials, artifacts };
};

handlers.getCountryWithCodes = async (request, h) => {
    try {
        const codes = await codeSchema.CodeSchema.find({}, {}, {lean: true});
        if (!codes) {
            return h.response(responseFormatter.responseFormatter([], 'Fetched successfully', 'success', 200)).code(200);
        }
        return h.response(responseFormatter.responseFormatter(codes, 'Fetched successfully', 'success', 200)).code(200);
    } catch (e) {
        logger.error('Error occurred in getting country codes %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
};

handlers.createAdmin = async (request, h) => {
    let decoded, adminData;

    /* Check if admin is allowed to create new admin or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in create admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        adminData = await adminSchema.AdminSchema.findById({_id: mongoose.Types.ObjectId(decoded.userId)}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in create admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!adminData) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (!adminData.isSuper) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    try {
        const checkAdmin = await adminSchema.AdminSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {}, {lean: true});
        if (checkAdmin) {
            return h.response(responseFormatter.responseFormatter({}, 'Admin already exists with the same email address', 'success', 200)).code(500);
        } else {
            request.payload.password = await commonFunctions.Handlers.generatePassword();
            const dataToSave = new adminSchema.AdminSchema(request.payload);
            dataToSave.permissions = [];
            for (let i = 0; i < request.payload.permissions.length; i++) {
                dataToSave.permissions.push(mongoose.Types.ObjectId(request.payload.permissions[i]));
            }
            const newAdmin = await dataToSave.save();
            if (newAdmin) {
                /* Send email to admin for temporary password */
                const mailOptions = {
                    from: 'support@ezjobs.io',
                    to: request.payload.email,
                    subject: 'Account creation',
                    text: 'Your temporary password is ' + request.payload.password
                };
                try {
                    await commonFunctions.Handlers.nodeMailerEZJobs(mailOptions.from, mailOptions.subject, mailOptions.text, mailOptions.to);
                } catch (e) {
                    logger.error('Error in sending create account email to admin %s:', JSON.stringify(e));
                }
                return h.response(responseFormatter.responseFormatter({}, 'Admin credentials created successfully', 'success', 200));
            }
            return h.response(responseFormatter.responseFormatter({}, 'Error in creating Admin credentials', 'error', 500)).code(500);
        }
    } catch (e) {
        logger.error('Error occurred in creating new admin %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
};

handlers.editAdmin = async (request, h) => {
    let adminData, dataToUpdate, decoded, checkAdmin;

    /* Check if user is the same who is trying to update location */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in edit admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check if admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: decoded.userId}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding admin in edit admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    }

    /* Check if admin is allowed to create new admin or not */
    try {
        adminData = await adminSchema.AdminSchema.findById({_id: mongoose.Types.ObjectId(request.payload.adminId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in edit admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!adminData) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (!checkAdmin.isSuper) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Update admin information */
    try {
        dataToUpdate = {
            firstName: request.payload.firstName,
            lastName: request.payload.lastName,
            permissions: [],
            isSuper: request.payload.isSuper
        };
        for (let i = 0; i < request.payload.permissions.length; i++) {
            dataToUpdate.permissions.push(mongoose.Types.ObjectId(request.payload.permissions[i]));
        }
        await adminSchema.AdminSchema.findByIdAndUpdate({_id: mongoose.Types.ObjectId(request.payload.adminId)}, {$set: dataToUpdate}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in edit admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Admin information edited successfully', 'success', 204)).code(200);
};

handlers.authAdmin = async (request, h) => {
    try {
        const checkAdmin = await adminSchema.AdminSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {
            _id: 1,
            password: 1,
            email: 1,
            firstName: 1,
            lastName: 1,
            isActive: 1,
            permissions: 1
        }, {lean: true}).populate('permissions', 'permissionName');
        if (checkAdmin) {
            if (!checkAdmin.isActive) {
                return h.response(responseFormatter.responseFormatter({}, 'This account has been disabled. Please contact Onata support team.', 'error', 400)).code(400);
            }
            const match = await bcrypt.compare(request.payload.password, checkAdmin.password);
            if (!match) {
                return h.response(responseFormatter.responseFormatter({}, 'Email or password is incorrect', 'error', 400)).code(400);
            } else {
                const token = await commonFunctions.Handlers.createAuthToken(checkAdmin._id, 'ADMIN');
                const tokenToSave = {
                    userId: checkAdmin._id,
                    authToken: token,
                    isExpired: false
                };
                try {
                    await tokenSchema.authTokenSchema.findOneAndUpdate({userId: checkAdmin._id}, tokenToSave, {lean: true, upsert: true});
                } catch (e) {
                    logger.error('Error occurred in saving token in auth admin handler %s', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                delete checkAdmin.password;
                return h.response(responseFormatter.responseFormatter({authToken: token, adminInfo: checkAdmin}, 'Fetched successfully', 'success', 200)).code(200);
            }
        }
        return h.response(responseFormatter.responseFormatter({}, 'No such admin', 'error', 404)).code(404);
    } catch (e) {
        logger.error('Error occurred in authorizing admin %s', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
};

handlers.createAuthToken = async (request, h) => {
    let checkAdmin, token;
  try {
      checkAdmin = await adminSchema.AdminSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {_id: 1}, {lean: true});
  } catch (e) {
      logger.error('Error occurred in finding admin in createAuthToken handler %s:', JSON.stringify(e));
      return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
  }
  if (checkAdmin) {
      try {
          token = await commonFunctions.Handlers.createAuthToken(checkAdmin._id, request.payload.role);
      } catch (e) {
          logger.error('Error occurred in creating token in createAuthToken handler %s:', JSON.stringify(e));
          return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
      }
      if (token) {
          const tokenToSave = {
              userId: checkAdmin._id,
              authToken: token,
              isExpired: false
          };
          try {
              await tokenSchema.authTokenSchema.findOneAndUpdate({userId: checkAdmin._id}, tokenToSave, {lean: true, upsert: true});
          } catch (e) {
              logger.error('Error occurred in saving token in createAuthToken handler %s:', JSON.stringify(e));
              return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
          }
      }
  } else {
      return h.response(responseFormatter.responseFormatter({}, 'No such admin', 'error', 404)).code(404);
  }
  return h.response(responseFormatter.responseFormatter(token, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.getAllUsers = async (request, h) => {
    let userData, searchCriteria = {roles: request.query.role}, text, projection = {
        password: 0,
        employerInformation: 0,
        employeeInformation: 0,
        deviceToken: 0,
        timeZone: 0,
        passwordResetToken: 0,
        termsAndConditionsVersion: 0,
        notifications: 0
    }, aggregationCriteria;

    if (request.query.role.toLowerCase() === 'candidate') {
        delete projection.employeeInformation;
    } else {
        delete projection.employerInformation;
    }

    if (request.query.searchText) {
        text = decodeURIComponent(request.query.searchText);
        searchCriteria.$or = [{firstName: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {lastName: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {email: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {'employerInformation.companyName': new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}];
    }
    if (request.query.deviceType) {
        searchCriteria.deviceType = request.query.deviceType;
    }
    if (request.query.status) {
        searchCriteria.isActive = (request.query.status === 'active');
    }
    if (request.query.emailVerified) {
        searchCriteria.emailVerified = (request.query.emailVerified === 'true');
    }
    if (request.query.phoneVerified) {
        searchCriteria.phoneVerified = (request.query.phoneVerified === 'true');
    }
    if (request.query.isStudent) {
        searchCriteria['employeeInformation.isStudent'] = (request.query.isStudent === 'true');
    }
    if (request.query.filterCriteria) {
        if (request.query.filterCriteria === 'today') {
            searchCriteria.createdAt = {$gt: new Date(moment.tz("America/New_York").startOf('day'))};
        } else if (request.query.filterCriteria === 'thisWeek') {
            searchCriteria.createdAt = {$gt: new Date(moment.tz("America/New_York").startOf('week'))};
        } else if (request.query.filterCriteria === 'thisMonth') {
            searchCriteria.createdAt = {$gt: new Date(moment.tz("America/New_York").startOf('month'))};
        } else if (request.query.filterCriteria === 'thisQuarter') {
            searchCriteria.createdAt = {$gt: new Date(moment.tz("America/New_York").startOf('quarter'))};
        } else if (request.query.filterCriteria === 'thisYear') {
            searchCriteria.createdAt = {$gt: new Date(moment.tz("America/New_York").startOf('year'))};
        }
    }

    aggregationCriteria = [
        {
            $sort: {_id: -1}
        },
        {
            $match: searchCriteria
        },
        {
            $limit: request.query.limit
        },
        {
            $project: projection
        }
    ];

    if (request.query.lastId) {
        searchCriteria._id = {$lt: mongoose.Types.ObjectId(request.query.lastId)};
    } else if (request.query.firstId) {
        searchCriteria._id = {$gt: mongoose.Types.ObjectId(request.query.firstId)};
        aggregationCriteria = [
            {
                $sort: {_id: -1}
            },
            {
                $match: searchCriteria
            },
            {
                $sort: {_id: 1}
            },
            {
                $limit: request.query.limit
            },
            {
                $sort: {_id: -1}
            },
            {
                $project: projection
            }
        ];
    }

    /* Get list of all the users from the database */
    try {
        userData = await userSchema.UserSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred in finding users in get all users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!userData) {
        return h.response(responseFormatter.responseFormatter([], 'Fetched successfully', 'success', 200)).code(200);
    }
    return h.response(responseFormatter.responseFormatter(userData, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.getAllAdmins = async (request, h) => {

    let adminData, searchCriteria, aggregationCriteria;

    if (request.query.lastId) {
        searchCriteria = {
            _id: {$lt: mongoose.Types.ObjectId(request.query.lastId)}
        };
        aggregationCriteria = [
            {
                $sort: {_id: -1}
            },
            {
                $match: searchCriteria
            },
            {
                $lookup: {
                    from: 'Permission',
                    localField: 'permissions',
                    foreignField: '_id',
                    as: 'permissions'
                }
            },
            {
                $limit: request.query.limit
            },
            {
                $project: {
                    _id: 1,
                    email: 1,
                    firstName: 1,
                    lastName: 1,
                    isActive: 1,
                    'permissions._id': 1,
                    'permissions.permissionName': 1,
                    isSuper: 1
                }
            }
        ];
    } else if (request.query.firstId) {
        searchCriteria = {
            _id: {$gt: mongoose.Types.ObjectId(request.query.firstId)}
        };
        aggregationCriteria = [
            {
                $sort: {_id: -1}
            },
            {
                $match: searchCriteria
            },
            {
                $sort: {_id: 1}
            },
            {
                $lookup: {
                    from: 'Permission',
                    localField: 'permissions',
                    foreignField: '_id',
                    as: 'permissions'
                }
            },
            {
                $limit: request.query.limit
            },
            {
                $sort: {_id: -1}
            },
            {
                $project: {
                    _id: 1,
                    email: 1,
                    firstName: 1,
                    lastName: 1,
                    isActive: 1,
                    'permissions._id': 1,
                    'permissions.permissionName': 1,
                    isSuper: 1
                }
            }
        ];
    } else {
        searchCriteria = {};
        aggregationCriteria = [
            {
                $sort: {_id: -1}
            },
            {
                $match: searchCriteria
            },
            {
                $lookup: {
                    from: 'Permission',
                    localField: 'permissions',
                    foreignField: '_id',
                    as: 'permissions'
                }
            },
            {
                $limit: request.query.limit
            },
            {
                $project: {
                    _id: 1,
                    email: 1,
                    firstName: 1,
                    lastName: 1,
                    isActive: 1,
                    'permissions._id': 1,
                    'permissions.permissionName': 1,
                    isSuper: 1
                }
            }
        ];
    }

    /* Fetch all the admin information from the database */
    try {
        adminData = await adminSchema.AdminSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred in getting admin data in get all admins handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    return h.response(responseFormatter.responseFormatter(adminData ? adminData : [], 'Fetched successfully', 'success', 200)).code(200);
};

handlers.changeStatus = async (request, h) => {

    let checkAdmin;

    /* Check if that admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: mongoose.Types.ObjectId(request.payload.adminId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in change status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin', 'error', 404)).code(404);
    } else if (!checkAdmin.isSuper) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Remove token from Token collection */
    if (!request.payload.isActive) {
        try {
            await tokenSchema.authTokenSchema.findOneAndDelete({userId: request.payload.adminId}, {});
        } catch (e) {
            logger.error('Error occurred in deleting admin token from token collection in change status handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Deactivate particular admin */
    try {
        await adminSchema.AdminSchema.findByIdAndUpdate({_id: mongoose.Types.ObjectId(request.payload.adminId)}, {$set: {isActive: request.payload.isActive}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in deleting admin token from token collection in change status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success*/
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
};

handlers.changeStatusUser = async (request, h) => {

    let adminData, decoded;
    /* Extract admin ID from the token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in change status user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check if admin is super admin or not */
    try {
        adminData = await adminSchema.AdminSchema.findById({_id: mongoose.Types.ObjectId(decoded.userId)}, {isSuper: 1, firstName: 1, lastName: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding admin in change status user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!adminData) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin', 'error', 404)).code(404);
    } else if (!adminData.isSuper) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Deactivate user and provider other information */
    try {
        let updateCriteria = {};
        if (request.payload.isActive) {
            updateCriteria.isActive = true;
            updateCriteria.deactivatedBy = '';
            updateCriteria.deactivationReason = '';
        } else {
            updateCriteria.isActive = false;
            updateCriteria.deactivatedBy = adminData.firstName + ' ' + adminData.lastName;
            updateCriteria.deactivationReason = request.payload.reason ? request.payload.reason : '';
        }
        await userSchema.UserSchema.findByIdAndUpdate({_id: mongoose.Types.ObjectId(request.payload.userId)}, {$set: updateCriteria}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in updating user in change status user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Remove that user token from the Token collection*/
    try {
        await tokenSchema.authTokenSchema.findOneAndDelete({userId: request.payload.userId}, {});
    } catch (e) {
        logger.error('Error occurred in removing user token in change status user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
};

handlers.changeAdminPassword = async (request, h) => {
    let checkAdmin, isMatch = false, newPassword, decoded;

    /* Check if admin is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in change password handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if new password is same as old password */
    if (request.payload.oldPassword === request.payload.password) {
        return h.response(responseFormatter.responseFormatter({}, 'You are trying to change your password to your current password', 'error', 400)).code(400);
    }

    /* Check if admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {password: 1, isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in change password handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin does not exists', 'error', 404)).code(404);
    }
   /* if (!checkAdmin.isSuper) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }*/

    /* Compare database password with the old password */
    try {
        isMatch = await bcrypt.compare(request.payload.oldPassword, checkAdmin.password);
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
        await adminSchema.AdminSchema.findByIdAndUpdate({_id: request.payload.adminId}, {$set: {password: newPassword}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating password in admin collection in change password handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Remove token from the database */
    try {
        await tokenSchema.authTokenSchema.findOneAndUpdate({userId: request.payload.adminId}, {$set: {isExpired: true}}, {lean: true})
    } catch (e) {
        logger.error('Error occurred while removing auth token in change password handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Password changed successfully', 'success', 204)).code(200);
};

handlers.resetAdminPassword = async (request, h) => {
    let password, updatedAdmin, decoded, intermediatePassword, superAdmin;

    /* Check if admin is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in change password handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if admin who is trying to change password is super admin or not */
    try {
        superAdmin = await adminSchema.AdminSchema.findById({_id: mongoose.Types.ObjectId(request.payload.adminId)}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching admin data in change password handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!superAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (!superAdmin.isSuper) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Create a hash of new password and save it to user collection */
    intermediatePassword = commonFunctions.Handlers.generatePassword();
    password = await commonFunctions.Handlers.createPassword(intermediatePassword);
    try {
        updatedAdmin = await adminSchema.AdminSchema.findByIdAndUpdate({_id: mongoose.Types.ObjectId(request.payload.adminIdToBeChanged)}, {$set: {password: password}}, {lean: true, new: true});
    } catch (e) {
        logger.error('Error occurred while updating admin in resetpassword handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!updatedAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin whose password you want to change doesn\'t exists', 'error', 404)).code(404);
    }

    /* Send email to user that his/her password has been changed */
    const mailOptions = {
        from: 'support@ezjobs.io',
        to: updatedAdmin.email,
        subject: 'Password reset',
        text: 'Your temporary password is ' + intermediatePassword
    };
    try {
        await commonFunctions.Handlers.nodeMailerEZJobs(mailOptions.from, mailOptions.subject, mailOptions.text, mailOptions.to);
    } catch (e) {
        logger.error('Error in sending reset password email to admin %s:', JSON.stringify(e));
    }

    /* Remove token from the database */
    try {
        await tokenSchema.authTokenSchema.findOneAndUpdate({userId: updatedAdmin._id}, {$set: {isExpired: true}}, {lean: true})
    } catch (e) {
        logger.error('Error occurred while removing auth token in change password handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Password reset successfully', 'success', 204)).code(200);
};

handlers.logout = async (request, h) => {

    let decoded;

    /* Decode token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding auth token in logout handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check if admin id and token matches*/
    if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Removing token from the token collection */
    try {
        await tokenSchema.authTokenSchema.findOneAndDelete({userId: request.payload.adminId});
    } catch (e) {
        logger.error('Error occurred while removing auth token in logout handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Admin logged out successfully', 'success', 200)).code(200);
};

handlers.sendPush = (request, h) => {
    push.createMessage(request.payload.to, request.payload.registration_ids, request.payload.data, request.payload.deviceType, request.payload.notification.title, request.payload.notification.body, request.payload.notification.sound);
    return 1;
};

handlers.createCategory = async (request, h) => {
    let imageName, isDuplicate, imageNameWeb;

    /* Check for duplicate */
    try {
        isDuplicate = await categorySchema.categorySchema.findOne({categoryNameLower: request.payload.categoryName.toLowerCase()}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding category image in create category handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (isDuplicate) {
        return h.response(responseFormatter.responseFormatter({}, 'Category already exists', 'error', 409)).code(409);
    }

    /* Upload to s3 */
    try {
        imageName = await commonFunctions.Handlers.uploadImage(request.payload.categoryImage.path, request.payload.categoryImage.filename);
    } catch (e) {
        logger.error('Error occurred while uploading category image in create category handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred while uploading image', 'error', 500)).code(500);
    }

    /* Upload to s3 */
    try {
        imageNameWeb = await commonFunctions.Handlers.uploadImage(request.payload.categoryImageForWeb.path, request.payload.categoryImageForWeb.filename);
    } catch (e) {
        logger.error('Error occurred while uploading category image for web in create category handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred while uploading image', 'error', 500)).code(500);
    }

    /* Save data into database */
    const dataToSave = {
        categoryName: request.payload.categoryName,
        categoryNameLower: request.payload.categoryName.toLowerCase(),
        categoryImage: imageName,
        categoryImageForWeb: imageNameWeb,
        labels: request.payload.labels
    };
    try {
        new categorySchema.categorySchema(dataToSave).save();
    } catch (e) {
        logger.error('Error occurred while saving category data in create category handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Category saved successfully', 'success', 201)).code(201);
};

handlers.editCategory = async (request, h) => {
    let checkDuplicate, dataToUpdate, newImage, newImageWeb, status, categoryInfo;

    /* Check if updated category already exists or not */
    try {
        checkDuplicate = await categorySchema.categorySchema.findOne({categoryNameLower: request.payload.categoryName.toLowerCase()}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding category in create category handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (checkDuplicate && checkDuplicate._id.toString() !== request.payload.categoryId) {
        return h.response(responseFormatter.responseFormatter({}, 'Category named ' + request.payload.categoryName + ' exists', 'error', 409)).code(409);
    }

    /* Get category info */
    try {
        categoryInfo = await categorySchema.categorySchema.findById({_id: mongoose.Types.ObjectId(request.payload.categoryId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding category in create category handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!categoryInfo) {
        return h.response(responseFormatter.responseFormatter({}, 'Category not found', 'error', 404)).code(404);
    }

    /* Check if image is updated */
    dataToUpdate = {
        categoryName: request.payload.categoryName,
        labels: request.payload.labels
    };

   /* Check if image has been changed or not. If changed remove old and replace it with new and edit information in database */
    if (request.payload.categoryImage && request.payload.categoryImage.path) {
        try {
            status = await commonFunctions.Handlers.deleteImage(categoryInfo.categoryImage);
        } catch (e) {
            logger.error('Error occurred while deleting category image in edit category handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (status !== 'success') {
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred while deleting image in edit category', 'error', 500)).code(500);
        }
        try {
            newImage = await commonFunctions.Handlers.uploadImage(request.payload.categoryImage.path, request.payload.categoryImage.filename);
            dataToUpdate.categoryImage = newImage;
        } catch (e) {
            logger.error('Error occurred while uploading category image in create category handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred while uploading image', 'error', 500)).code(500);
        }
    } else {
        dataToUpdate.categoryImage = categoryInfo.categoryImage;
    }

    /* Check if image for web has been changed or not. If changed remove old and replace it with new and edit information in database */
    if (request.payload.categoryImageForWeb && request.payload.categoryImageForWeb.path) {
        try {
            status = await commonFunctions.Handlers.deleteImage(categoryInfo.categoryImageForWeb);
        } catch (e) {
            logger.error('Error occurred while deleting category image in edit category handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (status !== 'success') {
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred while deleting image for web in edit category', 'error', 500)).code(500);
        }
        try {
            newImageWeb = await commonFunctions.Handlers.uploadImage(request.payload.categoryImageForWeb.path, request.payload.categoryImageForWeb.filename);
            dataToUpdate.categoryImageForWeb = newImageWeb;
        } catch (e) {
            logger.error('Error occurred while uploading category image for web in create category handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred while uploading image', 'error', 500)).code(500);
        }
    } else {
        dataToUpdate.categoryImageForWeb = categoryInfo.categoryImageForWeb;
    }

    try {
        await categorySchema.categorySchema.findByIdAndUpdate({_id: mongoose.Types.ObjectId(request.payload.categoryId)}, {$set: dataToUpdate}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating category data in edit category handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Category updated successfully', 'success', 204)).code(200);
};

handlers.getCategories = async (request, h) => {
    let categories;

    /* Fetch all the categories from the database */
    try {
        categories = await categorySchema.categorySchema.find({isActive: true}, {}, {lean: true}).sort({categoryName: 1});
    } catch (e) {
        logger.error('Error occurred while getting category data in get categories handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < categories.length; i++) {
        if (categories[i].categoryName === 'Others') {
            categories.push(categories[i]);
            categories.splice(i, 1);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(categories ? categories : [], 'Fetched successfully', 'success', 200)).code(200);
};

handlers.getPermissions = async (request, h) => {
    let permissions;

    /* Get list of all permissions for admin panel */
    try {
        permissions = await permissionSchema.permissionSchema.find({}, {__v: 0}, {lean: true}).populate('addedBy', 'firstName lastName');
    } catch (e) {
        logger.error('Error occurred while getting permission data in get permission handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(permissions, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.createPermission = async (request, h) => {
    let admin, permissionData, dataToSave;

    /* Check whether admin is super admin or not */
    try {
        admin = await adminSchema.AdminSchema.findById({_id: mongoose.Types.ObjectId(request.payload.adminId)}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting admin data in create permission handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!admin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (!admin.isSuper) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether same permission name exists in database */
    try {
        permissionData = await permissionSchema.permissionSchema.find({permissionNameLower: request.payload.permissionName.toLowerCase()}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting permissions data in create permission handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (permissionData && permissionData.length) {
        return h.response(responseFormatter.responseFormatter({}, 'Permission named ' + request.payload.permissionName + ' already exists', 'error', 409)).code(409);
    } else {
        /* Create a new permission and save it into the database */
        dataToSave = {
            permissionName: request.payload.permissionName,
            permissionNameLower: request.payload.permissionName.toLowerCase(),
            addedBy: mongoose.Types.ObjectId(request.payload.adminId)
        };
        try {
            await new permissionSchema.permissionSchema(dataToSave).save();
        } catch (e) {
            logger.error('Error occurred while saving permissions data in create permission handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Permission created successfully', 'success', 201)).code(201);
};

handlers.editPermission = async (request, h) => {
    let admin, permissionData, dataToUpdate;

    /* Check whether admin is super admin or not */
    try {
        admin = await adminSchema.AdminSchema.findById({_id: mongoose.Types.ObjectId(request.payload.adminId)}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting admin data in edit permission handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!admin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (!admin.isSuper) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether same permission name exists in database */
    try {
        permissionData = await permissionSchema.permissionSchema.findOne({permissionNameLower: request.payload.permissionName.toLowerCase()}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting permissions data in edit permission handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (permissionData && (permissionData._id.toString() !== request.payload.permissionId)) {
        return h.response(responseFormatter.responseFormatter({}, 'Permission named ' + request.payload.permissionName + ' already exists', 'error', 409)).code(409);
    } else {
        /* Update new permission into the database */
        dataToUpdate = {
            permissionName: request.payload.permissionName,
            permissionNameLower: request.payload.permissionName.toLowerCase(),
            addedBy: mongoose.Types.ObjectId(request.payload.adminId)
        };
        try {
            await permissionSchema.permissionSchema.findByIdAndUpdate({_id: mongoose.Types.ObjectId(request.payload.permissionId)}, {$set: dataToUpdate}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating permissions data in edit permission handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Permission edited successfully', 'success', 204)).code(200);
};

handlers.removePermission = async (request, h) => {
    let admin, permissionData;

    /* Check whether admin is super admin or not */
    try {
        admin = await adminSchema.AdminSchema.findById({_id: mongoose.Types.ObjectId(request.payload.adminId)}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting admin data in delete permission handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!admin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (!admin.isSuper) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether same permission name exists in database */
    try {
        permissionData = await permissionSchema.permissionSchema.findByIdAndDelete({_id: mongoose.Types.ObjectId(request.payload.permissionId)},  {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting permissions data in delete permission handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!permissionData) {
        return h.response(responseFormatter.responseFormatter({}, 'Permission not found', 'error', 404)).code(404);
    }

    /* Remove permission from admins as well */
    try {
        await adminSchema.AdminSchema.updateMany({permissions: mongoose.Types.ObjectId(request.payload.permissionId)}, {$pull: {permissions: mongoose.Types.ObjectId(request.payload.permissionId)}}, {});
    } catch (e) {
        logger.error('Error occurred while pulling out permissions data in delete permission handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Permission removed successfully', 'success', 200)).code(200);
};

handlers.editWeight = async (request, h) => {
    let admin;

    /* Check whether admin is super admin or not */
    try {
        admin = await adminSchema.AdminSchema.findById({_id: mongoose.Types.ObjectId(request.payload.adminId)}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting admin data in edit weight handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!admin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (!admin.isSuper) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Update weight collection with weight values */
    if (request.payload.isSkill) {
        try {
            await weightSchema.weightSchema.findOneAndUpdate({isSkill: true, 'skills._id': mongoose.Types.ObjectId(request.payload._id)}, {$set: {'skills.$.similarSkills': request.payload.similarSkills}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating weight data of skills in edit weight handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        try {
            await weightSchema.weightSchema.findOneAndUpdate({isJobTitle: true, 'jobTitles._id': mongoose.Types.ObjectId(request.payload._id)}, {$set: {'jobTitles.$.similarJobTitles': request.payload.similarJobTitles}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating weight data of job titles in edit weight handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Weight values updated', 'success', 204)).code(200);
};

handlers.getWeight = async (request, h) => {
    let weights;

    /* Get weight values based on query parameter */
    try {
        weights = await weightSchema.weightSchema.findOne({isSkill: request.query.isSkill}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching weight data in get weight handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(weights ? weights : {}, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.userResetPassword = async (request, h) => {
    let checkUser, passwordResetToken, resetToken, checkAdmin;

    /* Check whether admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding admin in userResetPassword handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Looks like this admin does not have your account with us', 'error', 404)).code(404);
    } else if (!checkAdmin.isSuper) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in userResetPassword handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'Looks like this user does not have your account with us', 'error', 404)).code(404);
    }

    /* Check whether user has signed up using facebook or google */
    if (checkUser.facebookId.id) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not reset your password as user have signed up using Facebook', 'error', 400)).code(400);
    } else if (checkUser.googleId.id) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not reset your password as user have signed up using Google', 'error', 400)).code(400);
    } else if (checkUser.linkedInId.id) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not reset your password as user have signed up using Linked In', 'error', 400)).code(400);
    }

    /* Generate and assign password reset token to user*/
    resetToken = commonFunctions.Handlers.resetToken();
    passwordResetToken = commonFunctions.Handlers.resetTokenGenerator(checkUser.email, resetToken);
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$set: {passwordResetToken: resetToken}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating user in userResetPassword handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send change password link to user */
    const verificationUrl = baseUrl + '/forgotPassword?resetToken=' + passwordResetToken;
    const mailOptions = {
        from: 'support@ezjobs.io',
        to: checkUser.email,
        subject: 'Reset Password',
        text: 'Click this link to reset your password' + verificationUrl + '.'
    };
    try {
        await commonFunctions.Handlers.nodeMailerEZJobs(mailOptions.from, mailOptions.subject, mailOptions.text, mailOptions.to);
    } catch (e) {
        logger.error('Error in sending verification link to user %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'Something went wrong while sending email. Please try again later.', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Password reset link has been successfully sent to ' + checkUser.email, 'success', 200)).code(200);
};

handlers.createChatMessage = async (request, h) => {
    let checkAdmin, payload, isExist;

    /* Check whether admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding admin in create chat message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Looks like this admin does not have your account with us', 'error', 404)).code(404);
    }

    /* Check if messages exists */
    try {
        isExist = await chatSuggestionSchema.chatSuggestionSchema.findOne({adminId: mongoose.Types.ObjectId(request.payload.adminId), type: request.payload.type}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding chat suggestion in create chat message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (isExist) {
        return h.response(responseFormatter.responseFormatter({}, 'Chat messages for this type already exists', 'error', 409)).code(409);
    }

    payload = new chatSuggestionSchema.chatSuggestionSchema(request.payload);
    try {
        await payload.save();
    } catch (e) {
        logger.error('Error occurred while saving chat message in create chat message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Chat messages saved successfully', 'success', 201)).code(201);
};

handlers.editChatMessage = async (request, h) => {
    let checkAdmin;

    /* Check whether admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding admin in edit chat message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Looks like this admin does not have your account with us', 'error', 404)).code(404);
    }

    try {
        await chatSuggestionSchema.chatSuggestionSchema.findByIdAndUpdate({_id: request.payload._id}, {$set: request.payload}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while saving chat message in edit chat message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Chat messages updated successfully', 'success', 204)).code(200);
};

handlers.removeChatMessage = async (request, h) => {
    let checkAdmin;

    /* Check whether admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding admin in remove chat message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Looks like this admin does not have your account with us', 'error', 404)).code(404);
    }

    try {
        await chatSuggestionSchema.chatSuggestionSchema.findByIdAndDelete({_id: request.payload._id});
    } catch (e) {
        logger.error('Error occurred while removing chat message in remove chat message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Chat messages removed successfully', 'success', 202)).code(202);
};

handlers.getChatMessage = async (request, h) => {
    let data;

    try {
        data = await chatSuggestionSchema.chatSuggestionSchema.find({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching chat message in get chat message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(data, 'Chat messages fetched successfully', 'success', 200)).code(200);
};

handlers.removeCertificatesAndResume = async (request, h) => {
    let checkAdmin, userData;

    /* Check whether admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding admin in remove certificates and resume handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (!checkAdmin.isSuper) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* If resume is true then delete it from s3 bucket */
    if (request.payload.isResume) {
        /* Fetch user data */
        try {
            userData = await userSchema.UserSchema.findById({_id: request.payload.userId}, {employeeInformation: 1, deviceType: 1, deviceToken: 1, _id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding user in remove certificates and resume handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!userData) {
            return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
        }

        /* Delete image from s3 bucket */
        try {
            status = await commonFunctions.Handlers.deleteImage(userData.employeeInformation.resume);
        } catch (e) {
            logger.error('Error occurred while deleting resume image in remove certificates and resume handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!status) {
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred while deleting resume', 'error', 500)).code(500);
        }

        /* Update user */
        try {
            await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$set: {'employeeInformation.resume': ''}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating user in remove certificates and resume handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    if (request.payload.isCertificate) {
        if (!request.payload.certificatesToRemove) {
            return h.response(responseFormatter.responseFormatter({}, 'Certificates are required for removal', 'error', 400)).code(400);
        } else if (!request.payload.certificatesToRemove.length) {
            return h.response(responseFormatter.responseFormatter({}, 'Certificates are required for removal', 'error', 400)).code(400);
        }
        for (let i = 0; i < request.payload.certificatesToRemove.length; i++) {
            /* Delete image from s3 bucket */
            try {
                status = await commonFunctions.Handlers.deleteImage(request.payload.certificatesToRemove[i]);
            } catch (e) {
                logger.error('Error occurred while deleting certificate image in remove certificates and resume handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (!status) {
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred while deleting certificate', 'error', 500)).code(500);
            }
            const idx = userData.employeeInformation.certificates.findIndex(k => k === request.payload.certificatesToRemove[i]);
            if (idx !== -1) {
                userData.employeeInformation.certificates.splice(idx, 1);
            }
        }
        /* Update user data */
        try {
            await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$set: {'employeeInformation.certificates': userData.employeeInformation.certificates}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating user in remove certificates and resume handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Send push to user about same */
    push.createMessage(userData.deviceToken, [], {userId: userData._id, type: 'certificate'}, userData.deviceType, 'Resume/Certificates removed by EZJobs', 'Your Resume and/or certificate has(ve) been removed by EZJobs as they are not meeting the certain criteria. Please contact support for more details', '');

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Removed successfully', 'success', 202)).code(202);
};

handlers.userDetails = async (request, h) => {
    let checkAdmin, checkUser;

    /* Check whether admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding admin in user details handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    }

    /* Check whether user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {password: 0}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in user details handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(checkUser, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.editConstant = async (request, h) => {
    let checkAdmin, constantData;

    /* Check whether admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding admin in edit constant handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (!checkAdmin.isSuper) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    if (task) {
        /* Destroy the cron */
        task.destroy();
    }

    /* Edit constant data */
    try {
        constantData = await constantSchema.constantSchema.findOneAndUpdate({}, {$set: request.payload}, {lean: true, upsert: true, new: true});
    } catch (e) {
        logger.error('Error occurred while update constants in edit constant handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (constantData.profileCompletionCron) {
        /* Start the cron */
        await commonFunctions.Handlers.cronJobForIncompleteProfilePush(constantData.profileCompletionCron.minute, constantData.profileCompletionCron.hour, constantData.profileCompletionCron.dayOfMonth, constantData.profileCompletionCron.month, constantData.profileCompletionCron.dayOfWeek);
    }

    if (constantData.ownProfileSMSAndEmailCron) {
        /* Start the cron */
        await commonFunctions.Handlers.cronJobForOwnAccountEmailAndSMS(constantData.ownProfileSMSAndEmailCron.minute, constantData.ownProfileSMSAndEmailCron.hour, constantData.ownProfileSMSAndEmailCron.dayOfMonth, constantData.ownProfileSMSAndEmailCron.month, constantData.ownProfileSMSAndEmailCron.dayOfWeek, constantData.ownProfileSMSAndEmailCron.state);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
};

handlers.getAllJobs = async (request, h) => {
    let checkAdmin, aggregateCriteria, jobs, count, countCriteria;

    /* Check whether admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding admin in get all jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    }

    /* Create aggregation criteria based on firstId and lastId */
    if (request.query.firstId) {
        aggregateCriteria = [
            {
                $sort: {_id: -1}
            },
            {
                $match: {
                    _id: {$gt: mongoose.Types.ObjectId(request.query.firstId)}
                }
            },
            {
                $sort: {_id: 1}
            },
            {
                $limit: request.query.limit
            },
            {
                $sort: {_id: -1}
            },
            {
                $lookup: {
                    from: 'Category',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'categoryId'
                }
            },
            {
                $unwind: '$categoryId'
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'userId'
                }
            },
            {
                $unwind: '$userId'
            },
            {
                $project: {
                    _id: 1,
                    jobTitle: 1,
                    jobDescriptionText: 1,
                    payRate: 1,
                    currency: 1,
                    address: 1,
                    isUnderReview: 1,
                    reviewReason: 1,
                    jobType: 1,
                    isNegotiable: 1,
                    experienceInMonths: 1,
                    isClosed: 1,
                    numberOfPositions: 1,
                    skills: 1,
                    isArchived: 1,
                    categoryName: '$categoryId.categoryName',
                    firstName: '$userId.firstName',
                    lastName: '$userId.lastName',
                    totalViews: 1,
                    uniqueViews: {$size: '$uniqueViews'}
                }
            }
        ];
        if (request.query.searchText) {
            aggregateCriteria[1].$match.$or = [{jobTitle: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {jobDescriptionText: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}];
        }
        if (request.query.state) {
            aggregateCriteria[1].$match['address.state'] = request.query.state;
        }
        if (request.query.country) {
            aggregateCriteria[1].$match.country = request.query.country;
        }
        if (request.query.isUnderReview) {
            aggregateCriteria[1].$match.isUnderReview = true;
        }
    } else if (request.query.lastId) {
        aggregateCriteria = [
            {
                $sort: {_id: -1}
            },
            {
                $match: {
                    _id: {$lt: mongoose.Types.ObjectId(request.query.lastId)}
                }
            },
            {
                $limit: request.query.limit
            },
            {
                $lookup: {
                    from: 'Category',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'categoryId'
                }
            },
            {
                $unwind: '$categoryId'
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'userId'
                }
            },
            {
                $unwind: '$userId'
            },
            {
                $project: {
                    _id: 1,
                    jobTitle: 1,
                    jobDescriptionText: 1,
                    payRate: 1,
                    currency: 1,
                    address: 1,
                    isUnderReview: 1,
                    reviewReason: 1,
                    jobType: 1,
                    isNegotiable: 1,
                    experienceInMonths: 1,
                    isClosed: 1,
                    numberOfPositions: 1,
                    skills: 1,
                    isArchived: 1,
                    categoryName: '$categoryId.categoryName',
                    firstName: '$userId.firstName',
                    lastName: '$userId.lastName',
                    totalViews: 1,
                    uniqueViews: {$size: '$uniqueViews'}
                }
            }
        ];
        if (request.query.searchText) {
            aggregateCriteria[1].$match.$or = [{jobTitle: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {jobDescriptionText: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}];
        }
        if (request.query.state) {
            aggregateCriteria[1].$match['address.state'] = request.query.state;
        }
        if (request.query.country) {
            aggregateCriteria[1].$match.country = request.query.country;
        }
        if (request.query.isUnderReview) {
            aggregateCriteria[1].$match.isUnderReview = true;
        }
    } else {
        aggregateCriteria = [
            {
                $sort: {_id: -1}
            },
            {
                $limit: request.query.limit
            },
            {
                $lookup: {
                    from: 'Category',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'categoryId'
                }
            },
            {
                $unwind: '$categoryId'
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'userId'
                }
            },
            {
                $unwind: '$userId'
            },
            {
                $project: {
                    _id: 1,
                    jobTitle: 1,
                    jobDescriptionText: 1,
                    payRate: 1,
                    currency: 1,
                    address: 1,
                    isUnderReview: 1,
                    reviewReason: 1,
                    jobType: 1,
                    isNegotiable: 1,
                    experienceInMonths: 1,
                    isClosed: 1,
                    numberOfPositions: 1,
                    skills: 1,
                    isArchived: 1,
                    categoryName: '$categoryId.categoryName',
                    firstName: '$userId.firstName',
                    lastName: '$userId.lastName',
                    totalViews: 1,
                    uniqueViews: {$size: '$uniqueViews'},
                    companyName: '$userId.employerInformation.companyName'
                }
            }
        ];
        if (request.query.searchText) {
            aggregateCriteria[0] = {$match: {$or : [{jobTitle: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {jobDescriptionText: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}]}};
            aggregateCriteria.unshift({$sort: {_id: -1}});
        }
        if (request.query.isUnderReview) {
            if (!aggregateCriteria[0].$match) {
                aggregateCriteria[0] = {$match: {isUnderReview: true}};
            } else {
                aggregateCriteria[0].$match = {isUnderReview: true};
            }
            aggregateCriteria.unshift({$sort: {_id: -1}});
        }
        if (request.query.state) {
            if (!aggregateCriteria[0].$match) {
                aggregateCriteria[0] = {$match: {'address.state': request.query.state}};
            } else {
                aggregateCriteria[0].$match = {'address.state': request.query.state};
            }
            aggregateCriteria.unshift({$sort: {_id: -1}});
        }
        if (request.query.country) {
            if (!aggregateCriteria[0].$match) {
                aggregateCriteria[0] = {$match: {country: request.query.country}};
            } else {
                aggregateCriteria[0].$match = {country: request.query.country};
            }
            aggregateCriteria.unshift({$sort: {_id: -1}});
        }
    }

    /* Count criteria for counting total count based on filter criteria */
    countCriteria = [];
    if (request.query.searchText) {
        countCriteria.push({$match: {$or : [{jobTitle: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {jobDescriptionText: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}]}});
    }
    if (request.query.isUnderReview) {
        if (!countCriteria[0]) {
            countCriteria.push({$match: {isUnderReview: true}});
        } else {
            countCriteria[0].$match['isUnderReview'] = true;
        }
    }
    if (request.query.state) {
        if (!countCriteria[0]) {
            countCriteria.push({$match: {'address.state': request.query.state}});
        } else {
            countCriteria[0].$match['address.state'] = request.query.state;
        }
    }
    if (request.query.country) {
        if (!countCriteria[0]) {
            countCriteria.push({$match: {country: request.query.country}});
        } else {
            countCriteria[0].$match['country'] = request.query.country;
        }
    }
    countCriteria.push({$count: 'total'});

    /* Aggregate on job collection */
    try {
        jobs = await jobSchema.jobSchema.aggregate(aggregateCriteria);
    } catch (e) {
        logger.error('Error occurred while aggregating jobs in get all jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Aggregate on job collection to get total count */
    try {
        count = await jobSchema.jobSchema.aggregate(countCriteria);
    } catch (e) {
        logger.error('Error occurred while aggregating jobs for finding total count in get all jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(jobs, 'Fetched successfully', 'success', 200, count[0] ? count[0].total: 0)).code(200);
};

handlers.getJobDetails = async (request, h) => {
    let checkAdmin, jobDetails, aggregationCriteria;

    /* Check whether admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding admin in get job details handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    }

    aggregationCriteria = [
        {
            $match: {
                _id: mongoose.Types.ObjectId(request.query.jobId)
            }
        },
        {
            $lookup: {
                from: 'User',
                localField: 'userId',
                foreignField: '_id',
                as: 'userId'
            }
        },
        {
            $unwind: '$userId'
        },
        {
            $lookup: {
                from: 'Category',
                localField: 'categoryId',
                foreignField: '_id',
                as: 'categoryId'
            }
        },
        {
            $unwind: '$categoryId'
        }
    ];

    /* Aggregate on product collection */
    try {
        jobDetails = await jobSchema.jobSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred while aggregating on job collection in get job details handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(jobDetails.length ? jobDetails[0]: [], 'Fetched successfully', 'success', 200)).code(200);
};

handlers.getConstantData = async (request, h) => {
    let constantData = {};

    /* Constant Data fetch */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding constant in get constant details handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(constantData, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.changeJobStatus = async (request, h) => {
    let checkAdmin, updateCriteria, userData, jobData;

    /* Check whether admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding admin in change job status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (!checkAdmin.isSuper) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    if (request.payload.isActive) {
        updateCriteria = {
            isUnderReview: false,
            reviewReason: ''
        };
    } else {
        updateCriteria = {
            isUnderReview: true,
            reviewReason: request.payload.reviewReason ? request.payload.reviewReason : ''
        };
    }

    /* Update product data accordingly */
    try {
        await jobSchema.jobSchema.findByIdAndUpdate({_id: request.payload.jobId}, {$set: updateCriteria}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating job data in change job status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Fetch product data */
    try {
        jobData = await jobSchema.jobSchema.findById({_id: request.payload.jobId}, {userId: 1, jobTitle: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding job in change job status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Fetch user data */
    try {
        userData = await userSchema.UserSchema.findById({_id: jobData.userId}, {deviceType: 1, deviceToken: 1, email: 1, 'employerInformation.companyName': 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user data in change job status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    let email = {
        to: [{
            email: userData.email,
            type: 'to'
        }],
        important: true,
        merge: true,
        inline_css: true,
        merge_language: 'mailchimp',
        merge_vars: [{
            rcpt: userData.email,
            vars: [
                {
                    name: 'jobTitle',
                    content: jobData.jobTitle
                },
                {
                    name: 'companyName',
                    content: userData.employerInformation.companyName
                }
            ]
        }]
    };

    /* Send push to user regarding the status */
    if (request.payload.isActive) {
        push.createMessage(userData.deviceToken, [], {jobId: jobData._id, type: 'general'}, userData.deviceType, 'Congratulations!', 'Your listing has been approved by the EZJobs', '');
        /* Send email about the same */
        await mandrill.Handlers.sendTemplate('review-successful', [], email, true);
    } else {
        push.createMessage(userData.deviceToken, [], {jobId: jobData._id, type: 'general'}, userData.deviceType, 'Listing in review!', 'Your listing has been submitted for review for some reason', '');
        await mandrill.Handlers.sendTemplate('under-review', [], email, true);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Preference updated', 'success', 204)).code(200);
};

handlers.getDashboardData = async (request, h) => {
    let checkAdmin, dashboardData = {
        numberOfCandidates: 0,
        numberOfUsers: 0,
        numberOfEmployers: 0,
        numberOfUsersFacebook: 0,
        numberOfUsersGoogle: 0,
        numberOfUsersLinkedIn: 0,
        numberOfActiveListings: 0,
        numberOfClosedListings: 0,
        numberOfListingsBlockedByAdmin: 0,
        numberOfChatMessages: 0,
        numberOfCompletedProfiles: 0,
        numberOfUsersEmail: 0,
        numberOfInvitations: 0,
        numberOfApplications: 0,
        numberOfInvitationsAcceptances: 0,
        numberOfHiredCandidates: 0,
        numberOfEmployersAddedByBulkUpload: 0,
        numberOfOwnedAccounts: 0,
        numberOfIncompletedProfiles: 0,
        numberOfCalls: 0,
        numberOfCallsMade: 0
    }, filterCriteria = {};

    /* Check whether admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding admin in get dashboard details handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    }
    [dashboardData.numberOfUsers, dashboardData.numberOfCandidates, dashboardData.numberOfEmployers,
    dashboardData.numberOfUsersGoogle, dashboardData.numberOfUsersFacebook, dashboardData.numberOfUsersLinkedIn, dashboardData.numberOfActiveListings,
    dashboardData.numberOfClosedListings, dashboardData.numberOfListingsBlockedByAdmin, dashboardData.numberOfCompletedProfiles,
    dashboardData.numberOfUsersEmail, dashboardData.numberOfInvitations, dashboardData.numberOfApplications, dashboardData.numberOfInvitationsAcceptances,
    dashboardData.numberOfHiredCandidates, dashboardData.numberOfEmployersAddedByBulkUpload, dashboardData.numberOfOwnedAccounts, dashboardData.numberOfIncompletedProfiles,
    dashboardData.numberOfCalls, dashboardData.numberOfCallsMade] = await Promise.all([
        await totalUsers(), await totalCandidates(), await totalEmployers(),
        await totalGoogleUsers(), await totalFacebookUsers(), await totalLinkedInUsers(), await totalActiveListings(),
        await totalClosedListings(), await totalBlockedListings(), await totalCompleteProfiles(),
        await totalEmailUsers(), await totalInvitedCandidates(), await totalAppliedCandidates(), await totalAcceptedInvitations(),
        await totalHiredCandidates(), await totalBulkUploads(), await totalOwnedAccounts(), await totalIncompleteProfiles(),
        await totalCalls(), await totalCallsMade()
    ]);

    dashboardData.numberOfChatMessages = dashboardData.numberOfChatMessages.length ? dashboardData.numberOfChatMessages[0].chats : 0;
    dashboardData.numberOfInvitations = dashboardData.numberOfInvitations[0] ? dashboardData.numberOfInvitations[0].totalCount : dashboardData.numberOfInvitations;
    dashboardData.numberOfApplications = dashboardData.numberOfApplications[0] ? dashboardData.numberOfApplications[0].totalCount : dashboardData.numberOfApplications;
    dashboardData.numberOfInvitationsAcceptances = dashboardData.numberOfInvitationsAcceptances[0] ? dashboardData.numberOfInvitationsAcceptances[0].totalCount : dashboardData.numberOfInvitationsAcceptances;
    dashboardData.numberOfHiredCandidates = dashboardData.numberOfHiredCandidates[0] ? dashboardData.numberOfHiredCandidates[0].totalCount : dashboardData.numberOfHiredCandidates;
    dashboardData.numberOfEmployersAddedByBulkUpload = dashboardData.numberOfEmployersAddedByBulkUpload[0] ? dashboardData.numberOfEmployersAddedByBulkUpload[0].totalCount : dashboardData.numberOfEmployersAddedByBulkUpload;
    dashboardData.numberOfCalls = dashboardData.numberOfCalls[0] ? dashboardData.numberOfCalls[0].numberOfCallsMade : 0;
    dashboardData.numberOfCallsMade = dashboardData.numberOfCallsMade[0] ? dashboardData.numberOfCallsMade[0].numberOfCallsMade : 0;

    if (typeof dashboardData.numberOfInvitations === 'object') {
        dashboardData.numberOfInvitations = 0;
    }
    if (typeof dashboardData.numberOfApplications === 'object') {
        dashboardData.numberOfApplications = 0;
    }
    if (typeof dashboardData.numberOfInvitationsAcceptances === 'object') {
        dashboardData.numberOfInvitationsAcceptances = 0;
    }
    if (typeof dashboardData.numberOfHiredCandidates === 'object') {
        dashboardData.numberOfHiredCandidates = 0;
    }
    if (typeof dashboardData.numberOfEmployersAddedByBulkUpload === 'object') {
        dashboardData.numberOfEmployersAddedByBulkUpload = 0;
    }

    /* Get count of total users */
    function totalUsers() {
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === 'today') {
                filterCriteria = {
                    createdAt: {$gte: new Date(moment.tz('America/New_York').startOf('day'))}
                }
            } else if (request.query.filterCriteria === 'yesterday') {
                filterCriteria = {
                    createdAt: {$gte: new Date(moment.tz('America/New_York').startOf('day').subtract(1, 'days')), $lte: new Date(moment.tz('America/New_York').endOf('day').subtract(1, 'days'))}
                }
            } else if (request.query.filterCriteria === 'thisWeek') {
                filterCriteria = {
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week')), $lte: new Date(moment.tz("America/New_York").endOf('week'))}
                }
            } else if (request.query.filterCriteria === 'lastWeek') {
                filterCriteria = {
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks')), $lte: new Date(moment.tz("America/New_York").endOf('week').subtract(1, 'weeks'))}
                }
            } else if (request.query.filterCriteria === 'thisMonth') {
                filterCriteria = {
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month')), $lte: new Date(moment.tz("America/New_York").endOf('month'))}
                }
            }  else if (request.query.filterCriteria === 'lastMonth') {
                filterCriteria = {
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months')), $lte: new Date(moment.tz("America/New_York").endOf('month').subtract(1, 'months'))}
                }
            } else if (request.query.filterCriteria === 'thisQuarter') {
                filterCriteria = {
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter')), $lte: new Date(moment.tz("America/New_York").endOf('quarter'))}
                }
            }  else if (request.query.filterCriteria === 'lastQuarter') {
                filterCriteria = {
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter').subtract(1, 'quarters')), $lte: new Date(moment.tz("America/New_York").endOf('quarter').subtract(1, 'quarters'))}
                }
            } else if (request.query.filterCriteria === 'thisYear') {
                filterCriteria = {
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year')), $lte: new Date(moment.tz("America/New_York").endOf('year'))}
                }
            } else if (request.query.filterCriteria === 'lastYear') {
                filterCriteria = {
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years')), $lte: new Date(moment.tz("America/New_York").endOf('year').subtract(1, 'years'))}
                }
            }
            if (request.query.country) {
                filterCriteria['employeeInformation.country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                }
            }
            return  userSchema.UserSchema.countDocuments(filterCriteria);
        } else if (request.query.startDate && request.query.endDate) {
            filterCriteria = {
                createdAt: {$gte: new Date(request.query.startDate), $lte: new Date(request.query.endDate)}
            };
            if (request.query.country) {
                filterCriteria['employeeInformation.country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                }
            }
            return  userSchema.UserSchema.countDocuments(filterCriteria);
        } else {
            if (request.query.country) {
                if (request.query.state && request.query.city) {
                    return  userSchema.UserSchema.countDocuments({'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.state) {
                    return  userSchema.UserSchema.countDocuments({'employeeInformation.country': request.query.country, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.city) {
                    return  userSchema.UserSchema.countDocuments({'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city});
                } else {
                    return  userSchema.UserSchema.countDocuments({'employeeInformation.country': request.query.country});
                }
            } else {
               return userSchema.UserSchema.estimatedDocumentCount({});
            }
        }
    }

    /* Get count of candidates */
    function totalCandidates() {
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === 'today') {
                filterCriteria = {
                    roles: 'Candidate',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('day'))}
                }
            } else if (request.query.filterCriteria === 'yesterday') {
                filterCriteria = {
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('day').subtract(1, 'days'))}
                }
            } else if (request.query.filterCriteria === 'thisWeek') {
                filterCriteria = {
                    roles: 'Candidate',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('week'))}
                }
            } else if (request.query.filterCriteria === 'lastWeek') {
                filterCriteria = {
                    roles: 'Candidate',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks'))}
                }
            } else if (request.query.filterCriteria === 'thisMonth') {
                filterCriteria = {
                    roles: 'Candidate',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('month'))}
                }
            } else if (request.query.filterCriteria === 'lastMonth') {
                filterCriteria = {
                    roles: 'Candidate',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months'))}
                }
            } else if (request.query.filterCriteria === 'thisQuarter') {
                filterCriteria = {
                    roles: 'Candidate',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('quarter'))}
                }
            } else if (request.query.filterCriteria === 'lastQuarter') {
                filterCriteria = {
                    roles: 'Candidate',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('quarter').subtract(1, 'quarters'))}
                }
            } else if (request.query.filterCriteria === 'thisYear') {
                filterCriteria = {
                    roles: 'Candidate',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('year'))}
                }
            } else if (request.query.filterCriteria === 'lastYear') {
                filterCriteria = {
                    roles: 'Candidate',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years'))}
                }
            }
            if (request.query.country) {
                filterCriteria['employeeInformation.country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                }
            }
            return userSchema.UserSchema.countDocuments(filterCriteria);
        } else if (request.query.startDate && request.query.endDate) {
            filterCriteria = {
                roles: 'Candidate',
                createdAt: {$gte: new Date(request.query.startDate), $lte: new Date(request.query.endDate)}
            };
            if (request.query.country) {
                filterCriteria['employeeInformation.country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                }
            }
            return userSchema.UserSchema.countDocuments(filterCriteria);
        } else {
            if (request.query.country) {
                if (request.query.state && request.query.city) {
                    return userSchema.UserSchema.countDocuments({roles: 'Candidate', 'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.state) {
                    return userSchema.UserSchema.countDocuments({roles: 'Candidate', 'employeeInformation.country': request.query.country, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.city) {
                    return userSchema.UserSchema.countDocuments({roles: 'Candidate', 'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city});
                } else {
                    return userSchema.UserSchema.countDocuments({roles: 'Candidate', 'employeeInformation.country': request.query.country});
                }
            } else {
                return userSchema.UserSchema.countDocuments({roles: 'Candidate'});
            }
        }
    }

    /* Get count of employers */
    function totalEmployers() {
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === 'today') {
                filterCriteria = {
                    roles: 'Employer',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('day'))}
                }
            } else if (request.query.filterCriteria === 'yesterday') {
                filterCriteria = {
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('day').subtract(1, 'days'))}
                }
            } else if (request.query.filterCriteria === 'thisWeek') {
                filterCriteria = {
                    roles: 'Employer',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('week'))}
                }
            } else if (request.query.filterCriteria === 'lastWeek') {
                filterCriteria = {
                    roles: 'Employer',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks'))}
                }
            } else if (request.query.filterCriteria === 'thisMonth') {
                filterCriteria = {
                    roles: 'Employer',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('month'))}
                }
            } else if (request.query.filterCriteria === 'lastMonth') {
                filterCriteria = {
                    roles: 'Employer',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months'))}
                }
            } else if (request.query.filterCriteria === 'thisQuarter') {
                filterCriteria = {
                    roles: 'Employer',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('quarter'))}
                }
            } else if (request.query.filterCriteria === 'lastQuarter') {
                filterCriteria = {
                    roles: 'Employer',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('quarter').subtract(1, 'quarters'))}
                }
            } else if (request.query.filterCriteria === 'thisYear') {
                filterCriteria = {
                    roles: 'Employer',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('year'))}
                }
            } else if (request.query.filterCriteria === 'lastYear') {
                filterCriteria = {
                    roles: 'Employer',
                    createdAt: {$gt: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years'))}
                }
            }

            if (request.query.country) {
                filterCriteria['employeeInformation.country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                }
            }
            return userSchema.UserSchema.countDocuments(filterCriteria);
        } else if (request.query.startDate && request.query.endDate) {
            filterCriteria = {
                roles: 'Employer',
                createdAt: {$gte: new Date(request.query.startDate), $lte: new Date(request.query.endDate)}
            };
            if (request.query.country) {
                filterCriteria['employeeInformation.country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                }
            }
            return userSchema.UserSchema.countDocuments(filterCriteria);
        } else {
            if (request.query.country) {
                if (request.query.state && request.query.city) {
                    return userSchema.UserSchema.countDocuments({roles: 'Employer', 'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.state) {
                    return userSchema.UserSchema.countDocuments({roles: 'Employer', 'employeeInformation.country': request.query.country, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.city) {
                    return userSchema.UserSchema.countDocuments({roles: 'Employer', 'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city});
                } else {
                    return userSchema.UserSchema.countDocuments({roles: 'Employer', 'employeeInformation.country': request.query.country});
                }
            } else {
                return userSchema.UserSchema.countDocuments({roles: 'Employer'});
            }
        }
    }

    /* Get count of google users */
    function totalGoogleUsers() {
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === 'today') {
                filterCriteria = {
                    'googleId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('day'))}
                }
            } else if (request.query.filterCriteria === 'yesterday') {
                filterCriteria = {
                    'googleId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('day').subtract(1, 'days')), $lte: new Date(moment.tz("America/New_York").endOf('day').subtract(1, 'days'))}
                }
            } else if (request.query.filterCriteria === 'thisWeek') {
                filterCriteria = {
                    'googleId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week')), $lte: new Date(moment.tz("America/New_York").endOf('week'))}
                }
            } else if (request.query.filterCriteria === 'lastWeek') {
                filterCriteria = {
                    'googleId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks')), $lte: new Date(moment.tz("America/New_York").endOf('week').subtract(1, 'weeks'))}
                }
            } else if (request.query.filterCriteria === 'thisMonth') {
                filterCriteria = {
                    'googleId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month')), $lte: new Date(moment.tz("America/New_York").endOf('month'))}
                }
            } else if (request.query.filterCriteria === 'lastMonth') {
                filterCriteria = {
                    'googleId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months')), $lte: new Date(moment.tz("America/New_York").endOf('month').subtract(1, 'months'))}
                }
            } else if (request.query.filterCriteria === 'thisQuarter') {
                filterCriteria = {
                    'googleId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter')), $lte: new Date(moment.tz("America/New_York").endOf('quarter'))}
                }
            } else if (request.query.filterCriteria === 'lastQuarter') {
                filterCriteria = {
                    'googleId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter').subtract(1, 'quarters')), $lte: new Date(moment.tz("America/New_York").endOf('quarter').subtract(1, 'quarters'))}
                }
            } else if (request.query.filterCriteria === 'thisYear') {
                filterCriteria = {
                    'googleId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year')), $lte: new Date(moment.tz("America/New_York").endOf('year'))}
                }
            } else if (request.query.filterCriteria === 'lastYear') {
                filterCriteria = {
                    'googleId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years')), $lte: new Date(moment.tz("America/New_York").endOf('year').subtract(1, 'years'))}
                }
            }

            if (request.query.country) {
                filterCriteria['employeeInformation.country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                }
            }
            return userSchema.UserSchema.countDocuments(filterCriteria);
        } else if (request.query.startDate && request.query.endDate) {
            filterCriteria = {
                'googleId.id': {$ne: ''},
                createdAt: {$gte: new Date(request.query.startDate), $lte: new Date(request.query.endDate)}
            };
            if (request.query.country) {
                filterCriteria['employeeInformation.country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                }
            }
            return userSchema.UserSchema.countDocuments(filterCriteria);
        } else {
            if (request.query.country) {
                if (request.query.state && request.query.city) {
                    return userSchema.UserSchema.countDocuments({'googleId.id': {$ne: ''}, 'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.state) {
                    return userSchema.UserSchema.countDocuments({'googleId.id': {$ne: ''}, 'employeeInformation.country': request.query.country, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.city) {
                    return userSchema.UserSchema.countDocuments({'googleId.id': {$ne: ''}, 'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city});
                } else {
                    return userSchema.UserSchema.countDocuments({'googleId.id': {$ne: ''}, 'employeeInformation.country': request.query.country});
                }
            } else {
                return userSchema.UserSchema.countDocuments({'googleId.id': {$ne: ''}});
            }
        }
    }

    /* Get count of facebook users */
    function totalFacebookUsers() {
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === 'today') {
                filterCriteria = {
                    'facebookId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('day'))}
                }
            } else if (request.query.filterCriteria === 'yesterday') {
                filterCriteria = {
                    'facebookId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('day').subtract(1, 'days')), $lte: new Date(moment.tz("America/New_York").endOf('day').subtract(1, 'days'))}
                }
            } else if (request.query.filterCriteria === 'thisWeek') {
                filterCriteria = {
                    'facebookId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week')), $lte: new Date(moment.tz("America/New_York").endOf('week'))}
                }
            } else if (request.query.filterCriteria === 'lastWeek') {
                filterCriteria = {
                    'facebookId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks')), $lte: new Date(moment.tz("America/New_York").endOf('week').subtract(1, 'weeks'))}
                }
            } else if (request.query.filterCriteria === 'thisMonth') {
                filterCriteria = {
                    'facebookId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month')), $lte: new Date(moment.tz("America/New_York").endOf('month'))}
                }
            } else if (request.query.filterCriteria === 'lastMonth') {
                filterCriteria = {
                    'facebookId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months')), $lte: new Date(moment.tz("America/New_York").endOf('month').subtract(1, 'months'))}
                }
            } else if (request.query.filterCriteria === 'thisQuarter') {
                filterCriteria = {
                    'facebookId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter')), $lte: new Date(moment.tz("America/New_York").endOf('quarter'))}
                }
            } else if (request.query.filterCriteria === 'lastQuarter') {
                filterCriteria = {
                    'facebookId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter').subtract(1, 'quarters')), $lte: new Date(moment.tz("America/New_York").endOf('quarter').subtract(1, 'quarters'))}
                }
            } else if (request.query.filterCriteria === 'thisYear') {
                filterCriteria = {
                    'facebookId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year')), $lte: new Date(moment.tz("America/New_York").endOf('year'))}
                }
            } else if (request.query.filterCriteria === 'lastYear') {
                filterCriteria = {
                    'facebookId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years')), $lte: new Date(moment.tz("America/New_York").endOf('year').subtract(1, 'years'))}
                }
            }

            if (request.query.country) {
                filterCriteria['employeeInformation.country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                }
            }
            return userSchema.UserSchema.countDocuments(filterCriteria);
        } else if (request.query.startDate && request.query.endDate) {
            filterCriteria = {
                'facebookId.id': {$ne: ''},
                createdAt: {$gte: new Date(request.query.startDate), $lte: new Date(request.query.endDate)}
            };
            if (request.query.country) {
                filterCriteria['employeeInformation.country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                }
            }
            return userSchema.UserSchema.countDocuments(filterCriteria);
        } else {
            if (request.query.country) {
                if (request.query.state && request.query.city) {
                    return userSchema.UserSchema.countDocuments({'facebookId.id': {$ne: ''}, 'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.state) {
                    return userSchema.UserSchema.countDocuments({'facebookId.id': {$ne: ''}, 'employeeInformation.country': request.query.country, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.city) {
                    return userSchema.UserSchema.countDocuments({'facebookId.id': {$ne: ''}, 'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city});
                } else {
                    return userSchema.UserSchema.countDocuments({'facebookId.id': {$ne: ''}, 'employeeInformation.country': request.query.country});
                }
            } else {
                return userSchema.UserSchema.countDocuments({'facebookId.id': {$ne: ''}});
            }
        }
    }

    /* Get count of linkedin users */
    function totalLinkedInUsers() {
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === 'today') {
                filterCriteria = {
                    'linkedInId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('day'))}
                }
            } else if (request.query.filterCriteria === 'yesterday') {
                filterCriteria = {
                    'linkedInId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('day').subtract(1, 'days')), $lte: new Date(moment.tz("America/New_York").endOf('day').subtract(1, 'days'))}
                }
            } else if (request.query.filterCriteria === 'thisWeek') {
                filterCriteria = {
                    'linkedInId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week')), $lte: new Date(moment.tz("America/New_York").endOf('week'))}
                }
            } else if (request.query.filterCriteria === 'lastWeek') {
                filterCriteria = {
                    'linkedInId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks')), $lte: new Date(moment.tz("America/New_York").endOf('week').subtract(1, 'weeks'))}
                }
            } else if (request.query.filterCriteria === 'thisMonth') {
                filterCriteria = {
                    'linkedInId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month')), $lte: new Date(moment.tz("America/New_York").endOf('month'))}
                }
            } else if (request.query.filterCriteria === 'lastMonth') {
                filterCriteria = {
                    'linkedInId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months')), $lte: new Date(moment.tz("America/New_York").endOf('month').subtract(1, 'months'))}
                }
            } else if (request.query.filterCriteria === 'thisQuarter') {
                filterCriteria = {
                    'linkedInId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter')), $lte: new Date(moment.tz("America/New_York").endOf('quarter'))}
                }
            } else if (request.query.filterCriteria === 'lastQuarter') {
                filterCriteria = {
                    'linkedInId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter').subtract(1, 'quarters')), $lte: new Date(moment.tz("America/New_York").endOf('quarter').subtract(1, 'quarters'))}
                }
            } else if (request.query.filterCriteria === 'thisYear') {
                filterCriteria = {
                    'linkedInId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year')), $lte: new Date(moment.tz("America/New_York").endOf('year'))}
                }
            } else if (request.query.filterCriteria === 'lastYear') {
                filterCriteria = {
                    'linkedInId.id': {$ne: ''},
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years')), $lte: new Date(moment.tz("America/New_York").endOf('year').subtract(1, 'years'))}
                }
            }

            if (request.query.country) {
                filterCriteria['employeeInformation.country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                }
            }
            return userSchema.UserSchema.countDocuments(filterCriteria);
        } else if (request.query.startDate && request.query.endDate) {
            filterCriteria = {
                'linkedInId.id': {$ne: ''},
                createdAt: {$gte: new Date(request.query.startDate), $lte: new Date(request.query.endDate)}
            };
            if (request.query.country) {
                filterCriteria['employeeInformation.country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                }
            }
            return userSchema.UserSchema.countDocuments(filterCriteria);
        } else {
            if (request.query.country) {
                if (request.query.state && request.query.city) {
                    return userSchema.UserSchema.countDocuments({'linkedInId.id': {$ne: ''}, 'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.state) {
                    return userSchema.UserSchema.countDocuments({'linkedInId.id': {$ne: ''}, 'employeeInformation.country': request.query.country, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.city) {
                    return userSchema.UserSchema.countDocuments({'linkedInId.id': {$ne: ''}, 'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city});
                } else {
                    return userSchema.UserSchema.countDocuments({'linkedInId.id': {$ne: ''}, 'employeeInformation.country': request.query.country});
                }
            } else {
                return userSchema.UserSchema.countDocuments({'linkedInId.id': {$ne: ''}});
            }
        }
    }

    /* Get count of active listings by users */
    function totalActiveListings() {
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === 'today') {
                filterCriteria = {
                    isClosed: false,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('day'))}
                }
            } else if (request.query.filterCriteria === 'yesterday') {
                filterCriteria = {
                    isClosed: false,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('day').subtract(1, 'days')), $lte: new Date(moment.tz("America/New_York").endOf('day').subtract(1, 'days'))}
                }
            } else if (request.query.filterCriteria === 'thisWeek') {
                filterCriteria = {
                    isClosed: false,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week')), $lte: new Date(moment.tz("America/New_York").endOf('week'))}
                }
            } else if (request.query.filterCriteria === 'lastWeek') {
                filterCriteria = {
                    isClosed: false,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks')), $lte: new Date(moment.tz("America/New_York").endOf('week').subtract(1, 'weeks'))}
                }
            } else if (request.query.filterCriteria === 'thisMonth') {
                filterCriteria = {
                    isClosed: false,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month')), $lte: new Date(moment.tz("America/New_York").endOf('month'))}
                }
            } else if (request.query.filterCriteria === 'lastMonth') {
                filterCriteria = {
                    isClosed: false,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months')), $lte: new Date(moment.tz("America/New_York").endOf('month').subtract(1, 'months'))}
                }
            } else if (request.query.filterCriteria === 'thisQuarter') {
                filterCriteria = {
                    isClosed: false,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter')), $lte: new Date(moment.tz("America/New_York").endOf('quarter'))}
                }
            } else if (request.query.filterCriteria === 'lastQuarter') {
                filterCriteria = {
                    isClosed: false,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter').subtract(1, 'quarters')), $lte: new Date(moment.tz("America/New_York").endOf('quarter').subtract(1, 'quarters'))}
                }
            } else if (request.query.filterCriteria === 'thisYear') {
                filterCriteria = {
                    isClosed: false,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year')), $lte: new Date(moment.tz("America/New_York").endOf('year'))}
                }
            } else if (request.query.filterCriteria === 'lastYear') {
                filterCriteria = {
                    isClosed: false,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years')), $lte: new Date(moment.tz("America/New_York").endOf('year').subtract(1, 'years'))}
                }
            }
            if (request.query.country) {
                filterCriteria['country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['address.state'] = request.query.state;
                    filterCriteria['address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['address.city'] = request.query.city;
                }
            }
            return jobSchema.jobSchema.countDocuments(filterCriteria);
        } else if (request.query.startDate && request.query.endDate) {
            filterCriteria = {
                isClosed: false,
                createdAt: {$gte: new Date(request.query.startDate), $lte: new Date(request.query.endDate)}
            };
            if (request.query.country) {
                filterCriteria['country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['address.state'] = request.query.state;
                    filterCriteria['address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['address.city'] = request.query.city;
                }
            }
            return jobSchema.jobSchema.countDocuments(filterCriteria);
        } else {
            if (request.query.country) {
                if (request.query.state && request.query.city) {
                    return jobSchema.jobSchema.countDocuments({isClosed: false, country: request.query.country, 'address.city': request.query.city, 'address.state': request.query.state});
                } else if (request.query.state) {
                    return jobSchema.jobSchema.countDocuments({isClosed: false, country: request.query.country, 'address.state': request.query.state});
                } else if (request.query.city) {
                    return jobSchema.jobSchema.countDocuments({isClosed: false, country: request.query.country, 'address.city': request.query.city});
                } else {
                    return jobSchema.jobSchema.countDocuments({isClosed: false, country: request.query.country});
                }
            } else {
                return jobSchema.jobSchema.countDocuments({isClosed: false});
            }
        }
    }

    /* Get count of archived by users */
    function totalClosedListings() {
        let filterCriteria = {
            isClosed: true
        };
        if (request.query.country) {
            filterCriteria['country'] = request.query.country;
            if (request.query.state && request.query.city) {
                filterCriteria['address.state'] = request.query.state;
                filterCriteria['address.city'] = request.query.city;
            } else if (request.query.state) {
                filterCriteria['address.state'] = request.query.state;
            } else if (request.query.city) {
                filterCriteria['address.city'] = request.query.city;
            }
        }
        return jobSchema.jobSchema.countDocuments(filterCriteria);
    }

    /* Get count of listings blocked by admin by users */
    function totalBlockedListings() {
        let filterCriteria = {
            isUnderReview: true
        };
        if (request.query.country) {
            filterCriteria['country'] = request.query.country;
            if (request.query.state && request.query.city) {
                filterCriteria['address.state'] = request.query.state;
                filterCriteria['address.city'] = request.query.city;
            } else if (request.query.state) {
                filterCriteria['address.state'] = request.query.state;
            } else if (request.query.city) {
                filterCriteria['address.city'] = request.query.city;
            }
        }
        return jobSchema.jobSchema.countDocuments(filterCriteria);
    }

    /* Get count of chat messages */
    function totalChatMessages() {
        let count, criteria, aggregationCriteria;
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === 'today') {
                criteria = {
                    'chats.dateTime': {$gte: new Date(moment.tz("America/New_York").startOf('day'))}
                }
            } else if (request.query.filterCriteria === 'yesterday') {
                criteria = {
                    'chats.dateTime': {$gte: new Date(moment.tz("America/New_York").startOf('day').subtract(1, 'days')), $lte: new Date(moment.tz("America/New_York").endOf('day').subtract(1, 'days'))}
                }
            } else if (request.query.filterCriteria === 'thisWeek') {
                criteria = {
                    'chats.dateTime': {$gte: new Date(moment.tz("America/New_York").startOf('week'))}
                }
            } else if (request.query.filterCriteria === 'lastWeek') {
                criteria = {
                    'chats.dateTime': {$gte: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks')), $lte: new Date(moment.tz("America/New_York").endOf('week').subtract(1, 'weeks'))}
                }
            } else if (request.query.filterCriteria === 'thisMonth') {
                criteria = {
                    'chats.dateTime': {$gte: new Date(moment.tz("America/New_York").startOf('month'))}
                }
            } else if (request.query.filterCriteria === 'lastMonth') {
                criteria = {
                    'chats.dateTime': {$gte: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months')), $lte: new Date(moment.tz("America/New_York").endOf('month').subtract(1, 'months'))}
                }
            } else if (request.query.filterCriteria === 'thisQuarter') {
                criteria = {
                    'chats.dateTime': {$gte: new Date(moment.tz("America/New_York").startOf('quarter'))}
                }
            } else if (request.query.filterCriteria === 'lastQuarter') {
                criteria = {
                    'chats.dateTime': {$gte: new Date(moment.tz("America/New_York").startOf('quarter').subtract(1, 'quarters')), $lte: new Date(moment.tz("America/New_York").endOf('quarter').subtract(1, 'quarters'))}
                }
            } else if (request.query.filterCriteria === 'thisYear') {
                criteria = {
                    'chats.dateTime': {$gte: new Date(moment.tz("America/New_York").startOf('year'))}
                }
            } else if (request.query.filterCriteria === 'lastYear') {
                criteria = {
                    'chats.dateTime': {$gte: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years')), $lte: new Date(moment.tz("America/New_York").endOf('year').subtract(1, 'years'))}
                }
            }

            aggregationCriteria = [
                {
                    $match: criteria
                },
                {
                    $unwind: '$chats'
                },
                {
                    $match: criteria
                }
            ];

            if (request.query.country) {
                aggregationCriteria.push({
                    $lookup: {
                        localField: 'jobId',
                        foreignField: '_id',
                        from: 'Job',
                        as: 'job'
                    }
                });
                aggregationCriteria.push({$unwind: '$job'});
                aggregationCriteria.push({$match: {'job.country': request.query.country}});
                if (request.query.state) {
                    aggregationCriteria.push({$match: {'job.address.state': request.query.state}});
                }
                if (request.query.city) {
                    aggregationCriteria.push({$match: {'job.address.city': request.query.city}});
                }
            }
            aggregationCriteria.push({
                $count: 'chats'
            });
            return conversationSchema.conversationSchema.aggregate(aggregationCriteria);
        } else if (request.query.startDate && request.query.endDate) {
            criteria = {
                'chats.dateTime': {$gte: new Date(request.query.startDate), $lte: new Date(request.query.endDate)}
            };
            aggregationCriteria = [
                {
                    $match: criteria
                },
                {
                    $unwind: '$chats'
                },
                {
                    $match: criteria
                }
            ];
            if (request.query.country) {
                aggregationCriteria.push({
                    $lookup: {
                        localField: 'jobId',
                        foreignField: '_id',
                        from: 'Job',
                        as: 'job'
                    }
                });
                aggregationCriteria.push({$unwind: '$job'});
                aggregationCriteria.push({$match: {'job.country': request.query.country}});
                if (request.query.state) {
                    aggregationCriteria.push({$match: {'job.address.state': request.query.state}});
                }
                if (request.query.city) {
                    aggregationCriteria.push({$match: {'job.address.city': request.query.city}});
                }
            }
            aggregationCriteria.push({
                $count: 'chats'
            });
           return conversationSchema.conversationSchema.aggregate(aggregationCriteria);
        } else {
            aggregationCriteria = [{
                $unwind: '$chats'
            }];
            if (request.query.country) {
                aggregationCriteria.push({
                    $lookup: {
                        localField: 'jobId',
                        foreignField: '_id',
                        from: 'Job',
                        as: 'job'
                    }
                });
                aggregationCriteria.push({$unwind: '$job'});
                aggregationCriteria.push({$match: {'job.country': request.query.country}});
                if (request.query.state) {
                    aggregationCriteria.push({$match: {'job.address.state': request.query.state}});
                }
                if (request.query.city) {
                    aggregationCriteria.push({$match: {'job.address.city': request.query.city}});
                }
            }
            aggregationCriteria.push({
                $count: 'chats'
            });
            return conversationSchema.conversationSchema.aggregate(aggregationCriteria);
        }
    }

    /* Get count of Completed user profiles */
    function totalCompleteProfiles() {
        if (request.query.country) {
            let criteria = {
                'employeeInformation.country': request.query.country
            };
            if (request.query.state && request.query.city) {
                criteria = {
                    'employeeInformation.isComplete': true,
                    'employeeInformation.country': request.query.country,
                    'employeeInformation.address.city': request.query.city,
                    'employeeInformation.address.state': request.query.state
                };
            } else if (request.query.state) {
                criteria = {
                    'employeeInformation.isComplete': true,
                    'employeeInformation.country': request.query.country,
                    'employeeInformation.address.state': request.query.state
                };
            } else if (request.query.city) {
                criteria = {
                    'employeeInformation.isComplete': true,
                    'employeeInformation.country': request.query.country,
                    'employeeInformation.address.city': request.query.city
                };
            }
            return userSchema.UserSchema.countDocuments(criteria);
        } else {
            return userSchema.UserSchema.countDocuments({'employeeInformation.isComplete': true});
        }
    }

    /* Get count of In-completed user profiles */
    function totalIncompleteProfiles() {
        if (request.query.country) {
            let criteria = {
                'employeeInformation.isComplete': false,
                'employeeInformation.country': request.query.country,
            };
            if (request.query.state && request.query.city) {
                criteria = {
                    'employeeInformation.isComplete': false,
                    'employeeInformation.country': request.query.country,
                    'employeeInformation.address.city': request.query.city,
                    'employeeInformation.address.state': request.query.state
                };
            } else if (request.query.state) {
                criteria = {
                    'employeeInformation.isComplete': false,
                    'employeeInformation.country': request.query.country,
                    'employeeInformation.address.state': request.query.state
                };
            } else if (request.query.city) {
                criteria = {
                    'employeeInformation.isComplete': false,
                    'employeeInformation.country': request.query.country,
                    'employeeInformation.address.city': request.query.city
                };
            }
            return userSchema.UserSchema.countDocuments(criteria);
        } else {
            return userSchema.UserSchema.countDocuments({'employeeInformation.isComplete': false});
        }
    }

    /* Get count of email signed up users */
    function totalEmailUsers() {
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === 'today') {
                filterCriteria = {
                    'linkedInId.id': '',
                    'facebookId.id': '',
                    'googleId.id': '',
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('day'))}
                }
            } else if (request.query.filterCriteria === 'yesterday') {
                filterCriteria = {
                    'linkedInId.id': '',
                    'facebookId.id': '',
                    'googleId.id': '',
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('day').subtract(1, 'days')), $lte: new Date(moment.tz("America/New_York").endOf('day').subtract(1, 'days'))}
                }
            } else if (request.query.filterCriteria === 'thisWeek') {
                filterCriteria = {
                    'linkedInId.id': '',
                    'facebookId.id': '',
                    'googleId.id': '',
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week'))}
                }
            } else if (request.query.filterCriteria === 'lastWeek') {
                filterCriteria = {
                    'linkedInId.id': '',
                    'facebookId.id': '',
                    'googleId.id': '',
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks')), $lte: new Date(moment.tz("America/New_York").endOf('week').subtract(1, 'weeks'))}
                }
            } else if (request.query.filterCriteria === 'thisMonth') {
                filterCriteria = {
                    'linkedInId.id': '',
                    'facebookId.id': '',
                    'googleId.id': '',
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month'))}
                }
            } else if (request.query.filterCriteria === 'lastMonth') {
                filterCriteria = {
                    'linkedInId.id': '',
                    'facebookId.id': '',
                    'googleId.id': '',
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months')), $lte: new Date(moment.tz("America/New_York").endOf('month').subtract(1, 'months'))}
                }
            } else if (request.query.filterCriteria === 'thisQuarter') {
                filterCriteria = {
                    'linkedInId.id': '',
                    'facebookId.id': '',
                    'googleId.id': '',
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter'))}
                }
            } else if (request.query.filterCriteria === 'lastQuarter') {
                filterCriteria = {
                    'linkedInId.id': '',
                    'facebookId.id': '',
                    'googleId.id': '',
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter').subtract(1, 'quarters')), $lte: new Date(moment.tz("America/New_York").endOf('quarter').subtract(1, 'quarters'))}
                }
            } else if (request.query.filterCriteria === 'thisYear') {
                filterCriteria = {
                    'linkedInId.id': '',
                    'facebookId.id': '',
                    'googleId.id': '',
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year'))}
                }
            } else if (request.query.filterCriteria === 'lastYear') {
                filterCriteria = {
                    'linkedInId.id': '',
                    'facebookId.id': '',
                    'googleId.id': '',
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years')), $lte: new Date(moment.tz("America/New_York").endOf('year').subtract(1, 'years'))}
                }
            }

            if (request.query.country) {
                filterCriteria['employeeInformation.country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                }
            }
            return userSchema.UserSchema.countDocuments(filterCriteria);
        } else if (request.query.startDate && request.query.endDate) {
            filterCriteria = {
                'linkedInId.id': '',
                'facebookId.id': '',
                'googleId.id': '',
                createdAt: {$gte: new Date(request.query.startDate), $lte: new Date(request.query.endDate)}
            };
            if (request.query.country) {
                filterCriteria['employeeInformation.country'] = request.query.country;
                if (request.query.state && request.query.city) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                } else if (request.query.state) {
                    filterCriteria['employeeInformation.address.state'] = request.query.state;
                } else if (request.query.city) {
                    filterCriteria['employeeInformation.address.city'] = request.query.city;
                }
            }
            return userSchema.UserSchema.countDocuments(filterCriteria);
        } else {
            if (request.query.country) {
                if (request.query.state && request.query.city) {
                    return userSchema.UserSchema.countDocuments({'linkedInId.id': '', 'facebookId.id': '', 'googleId.id': '', 'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.state) {
                    return userSchema.UserSchema.countDocuments({'linkedInId.id': '', 'facebookId.id': '', 'googleId.id': '', 'employeeInformation.country': request.query.country, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.city) {
                   return userSchema.UserSchema.countDocuments({'linkedInId.id': '', 'facebookId.id': '', 'googleId.id': '', 'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city});
                } else {
                    return userSchema.UserSchema.countDocuments({'linkedInId.id': '', 'facebookId.id': '', 'googleId.id': '', 'employeeInformation.country': request.query.country});
                }
            } else {
                return userSchema.UserSchema.countDocuments({'linkedInId.id': '', 'facebookId.id': '', 'googleId.id': ''});
            }
        }
    }

    /* Get count of invited candidates */
    function totalInvitedCandidates() {
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === 'today') {
                filterCriteria = {
                    isInvited: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('day'))}
                }
            } else if (request.query.filterCriteria === 'yesterday') {
                filterCriteria = {
                    isInvited: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('day').subtract(1, 'days')), $lte: new Date(moment.tz("America/New_York").endOf('day').subtract(1, 'days'))}
                }
            } else if (request.query.filterCriteria === 'thisWeek') {
                filterCriteria = {
                    isInvited: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week')), $lte: new Date(moment.tz("America/New_York").endOf('week'))}
                }
            } else if (request.query.filterCriteria === 'lastWeek') {
                filterCriteria = {
                    isInvited: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks')), $lte: new Date(moment.tz("America/New_York").endOf('week').subtract(1, 'weeks'))}
                }
            } else if (request.query.filterCriteria === 'thisMonth') {
                filterCriteria = {
                    isInvited: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month')), $lte: new Date(moment.tz("America/New_York").endOf('month'))}
                }
            } else if (request.query.filterCriteria === 'lastMonth') {
                filterCriteria = {
                    isInvited: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months')), $lte: new Date(moment.tz("America/New_York").endOf('month').subtract(1, 'months'))}
                }
            } else if (request.query.filterCriteria === 'thisQuarter') {
                filterCriteria = {
                    isInvited: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter')), $lte: new Date(moment.tz("America/New_York").endOf('quarter'))}
                }
            } else if (request.query.filterCriteria === 'lastQuarter') {
                filterCriteria = {
                    isInvited: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter').subtract(1, 'quarters')), $lte: new Date(moment.tz("America/New_York").endOf('quarter').subtract(1, 'quarters'))}
                }
            } else if (request.query.filterCriteria === 'thisYear') {
                filterCriteria = {
                    isInvited: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year')), $lte: new Date(moment.tz("America/New_York").endOf('year'))}
                }
            } else if (request.query.filterCriteria === 'lastYear') {
                filterCriteria = {
                    isInvited: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years')), $lte: new Date(moment.tz("America/New_York").endOf('year').subtract(1, 'years'))}
                }
            }

           /* if (request.query.country) {
                let total, matchCriteria = {
                    'job.country': request.query.country
                };
                if (request.query.state) {
                    matchCriteria['job.address.state'] = request.query.state
                }
                if (request.query.city) {
                    matchCriteria['job.address.city'] = request.query.city
                }
                try {
                   return conversationSchema.conversationSchema.aggregate([
                        {
                            $match: filterCriteria
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
                            $match: matchCriteria
                        },
                        {
                            $count: 'totalCount'
                        }
                    ]);
                } catch (e) {
                    logger.error('Error occurred while aggregating conversation collection in get dashboard details handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            } else {
                return conversationSchema.conversationSchema.countDocuments(filterCriteria);
            }*/
            return conversationSchema.conversationSchema.countDocuments(filterCriteria);
        } else if (request.query.startDate && request.query.endDate) {
            filterCriteria = {
                isInvited: true,
                createdAt: {$gte: new Date(request.query.startDate), $lte: new Date(request.query.endDate)}
            };
            /*if (request.query.country) {
                let total, matchCriteria = {
                    'job.country': request.query.country
                };
                if (request.query.state) {
                    matchCriteria['job.address.state'] = request.query.state
                }
                if (request.query.city) {
                    matchCriteria['job.address.city'] = request.query.city
                }
                try {
                    return conversationSchema.conversationSchema.aggregate([
                        {
                            $match: filterCriteria
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
                            $match: matchCriteria
                        },
                        {
                            $count: 'totalCount'
                        }
                    ]);
                } catch (e) {
                    logger.error('Error occurred while aggregating conversation collection in get dashboard details handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            } else {
                return conversationSchema.conversationSchema.countDocuments(filterCriteria);
            }*/
            return conversationSchema.conversationSchema.countDocuments(filterCriteria);
        } else {
            /*if (request.query.country) {
                let total, matchCriteria = {
                    'job.country': request.query.country
                };
                if (request.query.state) {
                    matchCriteria['job.address.state'] = request.query.state
                }
                if (request.query.city) {
                    matchCriteria['job.address.city'] = request.query.city
                }
                try {
                    return conversationSchema.conversationSchema.aggregate([
                        {
                            $match: {
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
                            $match: matchCriteria
                        },
                        {
                            $count: 'totalCount'
                        }
                    ]);
                } catch (e) {
                    logger.error('Error occurred while aggregating conversation collection in get dashboard details handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            } else {
                return conversationSchema.conversationSchema.countDocuments({isInvited: true});
            }*/
            return conversationSchema.conversationSchema.countDocuments({isInvited: true});
        }
    }

    /* Get count of applied candidates */
    function totalAppliedCandidates() {
        filterCriteria = {
            isApplied: true, isInvited: false
        }
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === 'today') {
                filterCriteria = {
                    isApplied: true,
                    isInvited: false,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('day'))}
                }
            } else if (request.query.filterCriteria === 'yesterday') {
                filterCriteria = {
                    isApplied: true,
                    isInvited: false,
                    createdAt: {
                        $gte: new Date(moment.tz("America/New_York").startOf('day').subtract(1, 'days')),
                        $lte: new Date(moment.tz("America/New_York").endOf('day').subtract(1, 'days'))
                    }
                }
            } else if (request.query.filterCriteria === 'thisWeek') {
                filterCriteria = {
                    isApplied: true,
                    isInvited: false,
                    createdAt: {
                        $gte: new Date(moment.tz("America/New_York").startOf('week')),
                        $lte: new Date(moment.tz("America/New_York").endOf('week'))
                    }
                }
            } else if (request.query.filterCriteria === 'lastWeek') {
                filterCriteria = {
                    isApplied: true,
                    isInvited: false,
                    createdAt: {
                        $gte: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks')),
                        $lte: new Date(moment.tz("America/New_York").endOf('week').subtract(1, 'weeks'))
                    }
                }
            } else if (request.query.filterCriteria === 'thisMonth') {
                filterCriteria = {
                    isApplied: true,
                    isInvited: false,
                    createdAt: {
                        $gte: new Date(moment.tz("America/New_York").startOf('month')),
                        $lte: new Date(moment.tz("America/New_York").endOf('month'))
                    }
                }
            } else if (request.query.filterCriteria === 'lastMonth') {
                filterCriteria = {
                    isApplied: true,
                    isInvited: false,
                    createdAt: {
                        $gte: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months')),
                        $lte: new Date(moment.tz("America/New_York").endOf('month').subtract(1, 'months'))
                    }
                }
            } else if (request.query.filterCriteria === 'thisQuarter') {
                filterCriteria = {
                    isApplied: true,
                    isInvited: false,
                    createdAt: {
                        $gte: new Date(moment.tz("America/New_York").startOf('quarter')),
                        $lte: new Date(moment.tz("America/New_York").endOf('quarter'))
                    }
                }
            } else if (request.query.filterCriteria === 'lastQuarter') {
                filterCriteria = {
                    isApplied: true,
                    isInvited: false,
                    createdAt: {
                        $gte: new Date(moment.tz("America/New_York").startOf('quarter').subtract(1, 'quarters')),
                        $lte: new Date(moment.tz("America/New_York").endOf('quarter').subtract(1, 'quarters'))
                    }
                }
            } else if (request.query.filterCriteria === 'thisYear') {
                filterCriteria = {
                    isApplied: true,
                    isInvited: false,
                    createdAt: {
                        $gte: new Date(moment.tz("America/New_York").startOf('year')),
                        $lte: new Date(moment.tz("America/New_York").endOf('year'))
                    }
                }
            } else if (request.query.filterCriteria === 'lastYear') {
                filterCriteria = {
                    isApplied: true,
                    isInvited: false,
                    createdAt: {
                        $gte: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years')),
                        $lte: new Date(moment.tz("America/New_York").endOf('year').subtract(1, 'years'))
                    }
                }
            }

            /* if (request.query.country) {
                 let total, matchCriteria = {
                     'job.country': request.query.country
                 };
                 if (request.query.state) {
                     matchCriteria['job.address.state'] = request.query.state
                 }
                 if (request.query.city) {
                     matchCriteria['job.address.city'] = request.query.city
                 }
                 try {
                    return conversationSchema.conversationSchema.aggregate([
                         {
                             $match: filterCriteria
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
                             $match: matchCriteria
                         },
                         {
                             $count: 'totalCount'
                         }
                     ]);
                 } catch (e) {
                     logger.error('Error occurred while aggregating conversation collection in get dashboard details handler %s:', JSON.stringify(e));
                     return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                 }
             } else {
                 return conversationSchema.conversationSchema.countDocuments(filterCriteria);
             }*/
            return conversationSchema.conversationSchema.countDocuments(filterCriteria);
        } else if (request.query.startDate && request.query.endDate) {
            filterCriteria = {
                isApplied: true,
                isInvited: false,
                createdAt: {$gte: new Date(request.query.startDate), $lte: new Date(request.query.endDate)}
            };
            return conversationSchema.conversationSchema.countDocuments(filterCriteria);
        } else {
            return conversationSchema.conversationSchema.countDocuments(filterCriteria);
        }
        /*if (request.query.country) {
            let total, matchCriteria = {
                'job.country': request.query.country
            };
            if (request.query.state) {
                matchCriteria['job.address.state'] = request.query.state
            }
            if (request.query.city) {
                matchCriteria['job.address.city'] = request.query.city
            }
            try {
                return conversationSchema.conversationSchema.aggregate([
                    {
                        $match: filterCriteria
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
                        $match: matchCriteria
                    },
                    {
                        $count: 'totalCount'
                    }
                ]);
            } catch (e) {
                logger.error('Error occurred while aggregating conversation collection in get dashboard details handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        } else {
            return conversationSchema.conversationSchema.countDocuments(filterCriteria);
        }*/
    }

    /* Get count of accepted invitations candidates */
    function totalAcceptedInvitations() {
        /*if (request.query.country) {
            let total, matchCriteria = {
                'job.country': request.query.country
            };
            if (request.query.state) {
                matchCriteria['job.address.state'] = request.query.state
            }
            if (request.query.city) {
                matchCriteria['job.address.city'] = request.query.city
            }
            try {
                return conversationSchema.conversationSchema.aggregate([
                    {
                        $match: {
                            isApplied: true,
                            isInvited: true,
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
                        $match: matchCriteria
                    },
                    {
                        $count: 'totalCount'
                    }
                ]);
            } catch (e) {
                logger.error('Error occurred while aggregating conversation collection in get dashboard details handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        } else {
            return conversationSchema.conversationSchema.countDocuments({ isApplied: true, isInvited: true,});
        }*/
        return conversationSchema.conversationSchema.countDocuments({ isApplied: true, isInvited: true});
    }

    /* Get total count of hired candidates */
    function totalHiredCandidates() {
        let matchCriteria, total = 0;
        if (request.query.country) {
            matchCriteria = {
                isClosed: true,
                'hiredId.1': {$exists: true},
                country: request.query.country
            };
            if (request.query.state) {
                matchCriteria['address.state'] = request.query.state;
            }
            if (request.query.city) {
                matchCriteria['address.city'] = request.query.city;
            }
        } else {
            matchCriteria = {
                isClosed: true,
                'hiredId.1': {$exists: true}
            };
        }
        return jobSchema.jobSchema.aggregate([
            {
                $match: matchCriteria
            },
            {
                $unwind: '$hiredId'
            },
            {
                $count: 'totalCount'
            }
        ]);
    }

    /* Get count of number of employers added by bulk upload */
    function totalBulkUploads() {
        if (request.query.filterCriteria) {
            if (request.query.filterCriteria === 'today') {
                filterCriteria = {
                    isAddedByBulkUpload: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('day'))}
                }
            } else if (request.query.filterCriteria === 'yesterday') {
                filterCriteria = {
                    isAddedByBulkUpload: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('day').subtract(1, 'days')), $lte: new Date(moment.tz("America/New_York").endOf('day').subtract(1, 'days'))}
                }
            } else if (request.query.filterCriteria === 'thisWeek') {
                filterCriteria = {
                    isAddedByBulkUpload: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week')), $lte: new Date(moment.tz("America/New_York").endOf('week'))}
                }
            } else if (request.query.filterCriteria === 'lastWeek') {
                filterCriteria = {
                    isAddedByBulkUpload: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks')), $lte: new Date(moment.tz("America/New_York").endOf('week').subtract(1, 'weeks'))}
                }
            } else if (request.query.filterCriteria === 'thisMonth') {
                filterCriteria = {
                    isAddedByBulkUpload: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month')), $lte: new Date(moment.tz("America/New_York").endOf('month'))}
                }
            } else if (request.query.filterCriteria === 'lastMonth') {
                filterCriteria = {
                    isAddedByBulkUpload: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months')), $lte: new Date(moment.tz("America/New_York").endOf('month').subtract(1, 'months'))}
                }
            } else if (request.query.filterCriteria === 'thisQuarter') {
                filterCriteria = {
                    isAddedByBulkUpload: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter')), $lte: new Date(moment.tz("America/New_York").endOf('quarter'))}
                }
            } else if (request.query.filterCriteria === 'lastQuarter') {
                filterCriteria = {
                    isAddedByBulkUpload: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('quarter').subtract(1, 'quarters')), $lte: new Date(moment.tz("America/New_York").endOf('quarter').subtract(1, 'quarters'))}
                }
            } else if (request.query.filterCriteria === 'thisYear') {
                filterCriteria = {
                    isAddedByBulkUpload: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year')), $lte: new Date(moment.tz("America/New_York").endOf('year'))}
                }
            } else if (request.query.filterCriteria === 'lastYear') {
                filterCriteria = {
                    isAddedByBulkUpload: true,
                    createdAt: {$gte: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years')), $lte: new Date(moment.tz("America/New_York").endOf('year').subtract(1, 'years'))}
                }
            }

            if (request.query.country) {
                let total, matchCriteria = {
                    'employeeInformation.country': request.query.country
                };
                if (request.query.state) {
                    matchCriteria['employeeInformation.address.state'] = request.query.state
                }
                if (request.query.city) {
                    matchCriteria['employeeInformation.address.city'] = request.query.city
                }
                try {
                    return userSchema.UserSchema.aggregate([
                        {
                            $match: filterCriteria
                        },
                        {
                            $match: matchCriteria
                        },
                        {
                            $count: 'totalCount'
                        }
                    ]);
                } catch (e) {
                    logger.error('Error occurred while aggregating userSchema collection in get dashboard details handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            } else {
                return userSchema.UserSchema.countDocuments(filterCriteria);
            }
        } else if (request.query.startDate && request.query.endDate) {
            filterCriteria = {
                isAddedByBulkUpload: true,
                createdAt: {$gte: new Date(request.query.startDate), $lte: new Date(request.query.endDate)}
            };
            if (request.query.country) {
                let total, matchCriteria = {
                    'employeeInformation.country': request.query.country
                };
                if (request.query.state) {
                    matchCriteria['employeeInformation.address.state'] = request.query.state
                }
                if (request.query.city) {
                    matchCriteria['employeeInformation.address.city'] = request.query.city
                }
                try {
                    return userSchema.UserSchema.aggregate([
                        {
                            $match: filterCriteria
                        },
                        {
                            $match: matchCriteria
                        },
                        {
                            $count: 'totalCount'
                        }
                    ]);
                } catch (e) {
                    logger.error('Error occurred while aggregating userSchema collection in get dashboard details handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            } else {
                return userSchema.UserSchema.countDocuments(filterCriteria);
            }
        } else {
            if (request.query.country) {
                if (request.query.state && request.query.city) {
                    return userSchema.UserSchema.countDocuments({isAddedByBulkUpload: true, 'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.state) {
                    return userSchema.UserSchema.countDocuments({isAddedByBulkUpload: true, 'employeeInformation.country': request.query.country, 'employeeInformation.address.state': request.query.state});
                } else if (request.query.city) {
                    return userSchema.UserSchema.countDocuments({isAddedByBulkUpload: true, 'employeeInformation.country': request.query.country, 'employeeInformation.address.city': request.query.city});
                } else {
                    return userSchema.UserSchema.countDocuments({isAddedByBulkUpload: true, 'employeeInformation.country': request.query.country});
                }
            } else {
               return userSchema.UserSchema.countDocuments({isAddedByBulkUpload: true});
            }
        }
    }

    /* Get count of number of employers added by bulk upload and owned account */
    function totalOwnedAccounts() {
        if (request.query.country) {
            let criteria;
            if (request.query.state && request.query.city) {
                criteria = {
                    isAddedByBulkUpload: true,
                    hasOwned: true,
                    'employeeInformation.country': request.query.country,
                    'employeeInformation.address.city': request.query.city,
                    'employeeInformation.address.state': request.query.state
                }
            } else if (request.query.state) {
                criteria = {
                    isAddedByBulkUpload: true,
                    hasOwned: true,
                    'employeeInformation.country': request.query.country,
                    'employeeInformation.address.state': request.query.state
                }
            } else if (request.query.city) {
                criteria = {
                    isAddedByBulkUpload: true,
                    hasOwned: true,
                    'employeeInformation.country': request.query.country,
                    'employeeInformation.address.city': request.query.city
                }
            } else {
                criteria = {
                    isAddedByBulkUpload: true,
                    hasOwned: true,
                    'employeeInformation.country': request.query.country
                }
            }
            return userSchema.UserSchema.countDocuments(criteria);
        } else {
            return userSchema.UserSchema.countDocuments({isAddedByBulkUpload: true, hasOwned: true});
        }
    }

    /* Get count of total number of calls candidates made */
    function totalCallsMade() {
        return userSchema.UserSchema.aggregate([
            {
                $match: {
                    'employeeInformation.numberOfCallsMade': {$gt: 0}
                }
            },
            {
                $group: {
                    _id: null,
                    numberOfCallsMade: {$sum: '$employeeInformation.numberOfCallsMade'}
                }
            }
        ]);
    }

    /* Get count of total number of calls job got */
    function totalCalls() {
        return jobSchema.jobSchema.aggregate([
            {
                $match: {
                    numberOfCallsMade: {$gt: 0}
                }
            },
            {
                $group: {
                    _id: null,
                    numberOfCallsMade: {$sum: '$numberOfCallsMade'}
                }
            }
        ]);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(dashboardData, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.getDashboardDataForWebsite = async (request, h) => {
    let data;
    try {
        data = await global.client.get('dashboard');
    } catch (e) {
        logger.error('Error occurred in get dashboard data for website handler %s', e);
    }
    /* Success */
    return h.response(responseFormatter.responseFormatter(data ? JSON.parse(data) : [], 'Fetched successfully', 'success', 200)).code(200);
};

handlers.getCountries = async (request, h) => {
    let countries;

    countries = csc.getAllCountries();

    return h.response(responseFormatter.responseFormatter(countries, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.uploadBulkDataFromCSV = async (request, h) => {
    let jsonData, userCount = 0, jobCount = 0, englishLanguage, internalParameters, flag = true;

    try {
        jsonData = await csv().fromFile(request.payload.file.path);
    } catch (e) {
        logger.error('Error occurred while parsing csv file %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'Something went wrong while parsing csv file', 'error', 500)).code(500);
    }

    /* Get internal parameters to check if engagebay addition is enabled or not */
    try {
        internalParameters = await internalParameterSchema.internalParameterSchema.findOne({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding internal parameters in upload bulk data from csv %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'Something went wrong while parsing csv file', 'error', 500)).code(500);
    }

    flag = internalParameters ? !!internalParameters.addToEngagebay : flag;

    /* Get english language */
    try {
        englishLanguage = await languageSchema.languageSchema.findOne({
            language: 'en',
            country: jsonData[0].country
        }, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding english language in get jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!jsonData || !jsonData.length) {
        return h.response(responseFormatter.responseFormatter({}, 'No data inside csv file', 'error', 404)).code(404);
    } else {
        for (let i = request.payload.skip; i < ((request.payload.skip + request.payload.limit) > jsonData.length ? jsonData.length : (request.payload.skip + request.payload.limit)) ; i++) {
            let checkUser, email, shortLink, addressData;
            const data = jsonData[i];
            if (data.email) {
                email = data.email;
            } else {
                email = data.countryCode + data.phone + '@ezjobs.io';
            }

            /* Search whether this user is already present in the database or not */
            try {
                checkUser = await userSchema.UserSchema.findOne({email: email}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding user in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'Something went wrong while parsing csv file', 'error', 500)).code(500);
            }

            /* Engage Bay */
            let checkContact;
            try {
                checkContact = await commonFunctions.Handlers.checkEngageBayContact(email);
            } catch (e) {
                logger.error('Error occurred while checking contact existence %s:', e);
            }

            if (!checkUser) {
                let dataToSave = new userSchema.UserSchema(data);
                dataToSave.employerInformation.companyLocation.coordinates = [Number(data.longitude), Number(data.latitude)];
                dataToSave.employerInformation.companyName = data.companyName ? data.companyName : 'Not specified';
                dataToSave.employerInformation.country = data.country;
                dataToSave.employerInformation.countryCode = '+' + data.countryCode;
                dataToSave.employerInformation.companyPhone = data.phone;
                dataToSave.employerInformation.isComplete = true;
                dataToSave.employeeInformation.location.coordinates = [Number(data.longitude), Number(data.latitude)];
                dataToSave.employeeInformation.preferredLocations = {
                    type: 'MultiPoint',
                    coordinates: [[Number(data.longitude), Number(data.latitude)]]
                };

                if (data.logo) {
                    dataToSave.employerInformation.companyProfilePhoto = data.logo;
                }
                if (data.type) {
                   dataToSave.employerInformation.isLandLine = (data.type.toLowerCase() === 'l');
                }

                /* Update address data of the user company */
                try {
                    addressData = await commonFunctions.Handlers.reverseGeocode(dataToSave.employerInformation.companyLocation.coordinates[1], dataToSave.employerInformation.companyLocation.coordinates[0]);
                } catch (e) {
                    logger.error('Error occurred in reverse geocoding user address in create user handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                if (addressData !== 'error') {
                    dataToSave.employeeInformation.address.address1 = addressData.address1;
                    dataToSave.employeeInformation.address.address2 = addressData.address2;
                    dataToSave.employeeInformation.address.city = addressData.city;
                    dataToSave.employeeInformation.address.state = addressData.state;
                    dataToSave.employeeInformation.address.zipCode = addressData.zipCode;
                    dataToSave.employeeInformation.address.subLocality = addressData.subLocality;

                    dataToSave.employerInformation.companyAddress.address1 = addressData.address1;
                    dataToSave.employerInformation.companyAddress.address2 = addressData.address2;
                    dataToSave.employerInformation.companyAddress.city = addressData.city;
                    dataToSave.employerInformation.companyAddress.state = addressData.state;
                    dataToSave.employerInformation.companyAddress.zipCode = addressData.zipCode;
                    dataToSave.employerInformation.companyAddress.subLocality = addressData.subLocality;

                    dataToSave.employeeInformation.preferredLocationCities = [{city: addressData.city, state: addressData.state, country: data.country, latitude: Number(data.latitude), longitude: Number(data.longitude)}];
                }

                dataToSave.employeeInformation.country = data.country;
                dataToSave.employeeInformation.countryCode = '+' + data.countryCode;
                if (data.phone) {
                    dataToSave.employeeInformation.phone = data.phone;
                }
                dataToSave.email = email;
                if (!dataToSave.firstName) {
                    dataToSave.firstName = 'NA';
                }
                if (!dataToSave.lastName) {
                    dataToSave.lastName = 'NA';
                }
                dataToSave.roles = ['Employer'];
                dataToSave.appVersion = '1.0.17';
                dataToSave.deviceType = 'ANDROID';
                dataToSave.timeZone = data.country === 'US' ? -240 : 330;
                dataToSave.currency = data.country === 'US' ? 'USD' : 'INR';
                dataToSave.isAddedByBulkUpload = true;
                dataToSave.tempPassword = commonFunctions.Handlers.generatePassword();
                dataToSave.password = dataToSave.tempPassword;
                dataToSave.isOnline = false;
                dataToSave.isRoleSet = true;
                if (data.visibility) {
                    dataToSave.websiteVisibility = true;
                }

                /* Save user into database */
                try {
                    checkUser = await dataToSave.save();
                    userCount++;
                } catch (e) {
                    logger.error('Error occurred while saving user in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                if (process.env.NODE_ENV === 'production' && flag) {
                    if (checkContact && checkContact.status !== 200) {
                        let contactProperties = [], contactData = {
                            properties: [],
                            companyIds: []
                        }, checkCompany;

                        const firstName = new commonFunctions.engageBay('name', 'TEXT', 'SYSTEM', true, checkUser.firstName);
                        contactProperties.push(firstName.getProperties());

                        const lastName = new commonFunctions.engageBay('last_name', 'TEXT', 'SYSTEM', true, checkUser.lastName);
                        contactProperties.push(lastName.getProperties());

                        const email = new commonFunctions.engageBay('email', 'TEXT', 'SYSTEM', true, checkUser.email);
                        contactProperties.push(email.getProperties());

                        const phone = new commonFunctions.engageBay('phone', 'TEXT', 'SYSTEM', true, checkUser.employerInformation.countryCode + checkUser.employerInformation.companyPhone);
                        contactProperties.push(phone.getProperties());

                        const engageSource = new commonFunctions.engageBay('Source', 'TEXT', 'CUSTOM', true, data.logo ? 'BA31' : 'Email');
                        contactProperties.push(engageSource.getProperties());

                        const engageContactSource = new commonFunctions.engageBay('Contact source', 'TEXT', 'CUSTOM', true, data.source ? data.source : 'Web');
                        contactProperties.push(engageContactSource.getProperties());

                        const zone = new commonFunctions.engageBay('Zone', 'TEXT', 'CUSTOM', true, data.zone ? data.zone : '');
                        contactProperties.push(zone.getProperties());

                        contactData.properties = contactProperties;

                        try {
                            checkCompany = await commonFunctions.Handlers.checkEngageBayCompany(checkUser.employerInformation.companyName);
                        } catch (e) {
                            logger.error('Error occurred while checking company existence %s:', e);
                        }

                        if (checkCompany === 'NOTFOUND') {
                            /* Create company in Engage Bay */
                            let company, companyProperties = [], companyData = {
                                properties: []
                            };

                            const engageCompanyName = new commonFunctions.engageBay('name', 'TEXT', 'SYSTEM', true, checkUser.employerInformation.companyName);
                            companyProperties.push(engageCompanyName.getProperties());

                            companyData.properties = companyProperties;

                            try {
                                company = await commonFunctions.Handlers.createEngageBayCompany(companyData);
                            } catch (e) {
                                logger.error('Error occurred while creating company data %s:', e);
                            }

                            if (company.status === 200) {
                                contactData.companyIds.push(company.data.id);
                            }

                        } else if (checkCompany.id) {
                            contactData.companyIds.push(checkCompany.id);
                        }

                        try {
                            checkContact = await commonFunctions.Handlers.createEngageBayContact(contactData);
                        } catch (e) {
                            logger.error('Error occurred while creating contact data %s:', e);
                        }

                    }
                }

            }
            /* Create job for the user */
            let checkJob;

            /* Check whether same job exists in the database for the same user */
            try {
                checkJob = await jobSchema.jobSchema.findOne({userId: mongoose.Types.ObjectId(checkUser._id), jobTitle: data.jobTitle}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding job data in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (!checkJob) {
                const jobDataToSave = new jobSchema.jobSchema(data);
                jobDataToSave.userId = mongoose.Types.ObjectId(checkUser._id);
                jobDataToSave.categoryId = mongoose.Types.ObjectId(data.categoryId);
                jobDataToSave.jobTitle = data.jobTitle;
                jobDataToSave.jobDescriptionText = data.jobDescription;
                jobDataToSave.country = data.country;
                jobDataToSave.location.coordinates = [Number(data.longitude), Number(data.latitude)];
                jobDataToSave.displayLocation.coordinates = [[Number(data.longitude), Number(data.latitude)]];
                if (data.validUpto) {
                    jobDataToSave.validUpto = new Date(data.validUpto);
                }
                if (!addressData) {
                    try {
                        addressData = await commonFunctions.Handlers.reverseGeocode(jobDataToSave.location.coordinates[1], jobDataToSave.location.coordinates[0]);
                    } catch (e) {
                        logger.error('Error occurred in reverse geocoding user address in create user handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }
                if (addressData !== 'error') {
                    jobDataToSave.address.address1 = addressData.address1;
                    jobDataToSave.address.address2 = addressData.address2;
                    jobDataToSave.address.city = addressData.city;
                    jobDataToSave.address.state = addressData.state;
                    jobDataToSave.address.zipCode = addressData.zipCode;
                    jobDataToSave.address.subLocality = addressData.subLocality;
                }
                jobDataToSave.numberOfPositions = 1;
                jobDataToSave.jobType = data.jobType ? (data.jobType === 'F' ? 'Full-time' : 'Part-time') : 'Full-time';
                jobDataToSave.payRate.type = 'Yearly';
                jobDataToSave.currency = data.country === 'US' ? 'USD': 'INR';
                if (data.experience) {
                    jobDataToSave.experienceInMonths = Number(data.experience);
                }
                jobDataToSave.isNegotiable = true;
                jobDataToSave.ageRequired = 18;
                jobDataToSave.isWalkInInterview = !!data.isWalkInInterview;
                if (jobDataToSave.isWalkInInterview) {
                    jobDataToSave.interviewStartDateTime = new Date(data.startDate);
                    jobDataToSave.interviewEndDateTime = new Date(data.endDate);
                    jobDataToSave.interviewStartDate =  new Date(data.startDate);
                    jobDataToSave.interviewEndDate =  new Date(data.endDate);
                    jobDataToSave.interviewStartTime =  new Date(data.startDate + ' ' + data.startTime);
                    jobDataToSave.interviewEndTime = new Date(data.endDate + ' ' + data.endTime);
                }
                jobDataToSave.isAddedByBulkUpload = true;
                jobDataToSave.translatedLanguage = englishLanguage._id;
                if (data.contactSource) {
                    if (data.contactSource.toLowerCase() === 'ats') {
                        jobDataToSave.isATS = true;
                        jobDataToSave.atsEmail = data.link;
                    }
                    if (data.contactSource.toLowerCase() === 'w') {
                        jobDataToSave.isCompanyWebsite = true;
                        jobDataToSave.companyWebsite = data.link;
                    }
                }

                /* Save job into database */
                try {
                    let text, status;
                    await jobDataToSave.save();
                    jobCount++;
                    /* Create dynamic link */
                    shortLink = await commonFunctions.Handlers.createFirebaseShortLink(email, '', '');
                    if (shortLink === 'error') {
                        return h.response(responseFormatter.responseFormatter({}, 'Error occurred during creating short links', 'error', 500)).code(500);
                    } else {
                        text = 'Your job ' + jobDataToSave.jobTitle + ' has been added in to EZJobs(app). To own this job posting and hiring candidates: 1. Claim your account by clicking on the link ' + shortLink.shortLink + ' . 2. Login using the email: ' + checkUser.email + ' and password: ' + checkUser.tempPassword + ' . 3. Complete the profile. 4. Start Hiring.';
                    }

                    if (process.env.NODE_ENV === 'production' && flag) {
                        let activeJobs, engageBayProperties = [];

                        /* Get the job listings of the employer */
                        try {
                            activeJobs = await jobSchema.jobSchema.find({
                                userId: checkUser._id,
                                isVisible: true,
                                isTranslated: false
                            }, {}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred while finding job postings in upload bulk data from CSV handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }

                        const len = activeJobs.length;
                        let jobsData = [];

                        for (let i = 0; i < len; i++) {
                            const shortLink = await commonFunctions.Handlers.createFirebaseShortLink('', activeJobs[i]._id, '', '', '', '', '', '', '');
                            jobsData.push(activeJobs[i].jobTitle + ' : ' + shortLink.shortLink + '. ');
                        }

                        const jobs = new commonFunctions.engageBay('Jobs', 'TEXTAREA', 'CUSTOM', true, jobsData.toString());
                        engageBayProperties.push(jobs.getProperties());

                        if (engageBayProperties.length) {
                            try {
                                await commonFunctions.Handlers.updateEngageBayContact({id: checkContact.data.id, properties: engageBayProperties});
                            } catch (e) {
                                logger.error('Error occurred while updating user in engage bay %s:', JSON.stringify(e));
                            }
                        }
                    }

                    /* Send SMS to user if phone number is there */
                    if (checkUser.employerInformation.companyPhone && !checkUser.employerInformation.isLandLine) {
                        status = await commonFunctions.Handlers.sendSMS(checkUser.employerInformation.countryCode, checkUser.employerInformation.companyPhone, text);
                        if (status === 'error') {
                            /* Remove data and job */
                            try {
                                await userSchema.UserSchema.findByIdAndDelete({_id: checkUser._id});
                                userCount--;
                            } catch (e) {
                                logger.error('Error occurred while removing user in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                            }

                            try {
                                await jobSchema.jobSchema.findByIdAndDelete({_id: jobDataToSave._id});
                                jobCount--;
                            } catch (e) {
                                logger.error('Error occurred while removing job in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                            }
                        } else {
                            try {
                                checkUser = await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, {$set: {isMessageSent: true}, $inc: {numberOfMessagesSent: 1}}, {lean: true, new: true});
                            } catch (e) {
                                logger.error('Error occurred while updating user details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }
                        }
                    }
                    if (data.email) {
                        /* Send app download email */
                        try {
                            let email = {
                                to: [{
                                    email: data.email,
                                    type: 'to'
                                }],
                                important: true,
                                merge: true,
                                inline_css: true,
                                merge_language: 'mailchimp',
                                merge_vars: [{
                                    rcpt: data.email,
                                    vars: [
                                        {
                                            name: 'email',
                                            content: data.email
                                        },
                                        {
                                            name: 'password',
                                            content: checkUser.tempPassword
                                        },
                                        {
                                            name: 'downloadURL',
                                            content: shortLink.shortLink
                                        },
                                        {
                                            name: 'jobTitle',
                                            content: jobDataToSave.jobTitle
                                        }
                                    ]
                                }]
                            };
                            await mandrill.Handlers.sendTemplate('app-download', [], email, true);
                            try {
                                checkUser = await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, {$set: {'employeeInformation.lastEmailSent': Date.now()}, $inc: {'employeeInformation.numberOfEmailsSent': 1}}, {lean: true, new: true});
                            } catch (e) {
                                logger.error('Error occurred while updating user details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }
                        } catch (e) {
                            logger.error('Error in sending app download link to user %s:', JSON.stringify(e));
                        }

                    }

                    let statusHub = await commonFunctions.Handlers.createHubSpotContactEmployer(checkUser.firstName, checkUser.lastName, checkUser.email, countryList.getName(checkUser.employeeInformation.country), '', '', 'customer', checkUser.employeeInformation.address.city, checkUser.employeeInformation.address.state, checkUser.employerInformation.companyPhone, checkUser.employerInformation.companyName, '', data.source, data.classified);
                    if (statusHub === 'error') {
                        logger.error('Error occurred while creating hub spot contact');
                    }

                    let jobsData = [], hubSpotProperties = [];
                    const shortLinkJob = await commonFunctions.Handlers.createFirebaseShortLink('', jobDataToSave._id, '', '', '', '', '', '', '');
                    jobsData.push(jobDataToSave.jobTitle + ' : ' + shortLinkJob.shortLink + '. ');

                    hubSpotProperties.push({
                        property: 'job_posted_by_employer',
                        value: jobsData.toString()
                    });

                    let statusEmployer = await commonFunctions.Handlers.updateHubSpotContactEmployer(checkUser.email, hubSpotProperties);
                    if (statusEmployer === 404) {
                        console.log('HubSpot contact not found');
                    }

                } catch (e) {
                    logger.error('Error occurred while saving job in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            }
        }
    }

    return h.response(responseFormatter.responseFormatter({}, userCount + ' users have been added and ' + jobCount + ' jobs have been added.', 'success', 201)).code(201);
};

handlers.uploadBulkCandidateDataFromCSV = async (request, h) => {
    let jsonData, userCount = 0, englishLanguage;

    try {
        jsonData = await csv().fromFile(request.payload.file.path);
    } catch (e) {
        logger.error('Error occurred while parsing csv file %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'Something went wrong while parsing csv file', 'error', 500)).code(500);
    }

    /* Get english language */
    try {
        englishLanguage = await languageSchema.languageSchema.findOne({
            language: 'en',
            country: jsonData[0].country
        }, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding english language in get jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!jsonData || !jsonData.length) {
        return h.response(responseFormatter.responseFormatter({}, 'No data inside csv file', 'error', 404)).code(404);
    } else {
        for (let i = request.payload.skip; i < ((request.payload.skip + request.payload.limit) > jsonData.length ? jsonData.length : (request.payload.skip + request.payload.limit)); i++) {
            let checkUser, email, shortLink, addressData;
            const data = jsonData[i];
            if (data.email) {
                email = data.email;
            } else {
                continue;
            }

            /* Search whether this user is already present in the database or not */
            try {
                checkUser = await userSchema.UserSchema.findOne({email: email}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding user in uploadBulkCandidateDataFromCSV handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'Something went wrong while parsing csv file', 'error', 500)).code(500);
            }

            /* Engage Bay */
            let checkContact;
            try {
                checkContact = await commonFunctions.Handlers.checkEngageBayContact(email);
            } catch (e) {
                logger.error('Error occurred while checking contact existence %s:', e);
            }

            if (!checkUser) {
                let dataToSave = new userSchema.UserSchema(data);
                dataToSave.employerInformation.companyLocation.coordinates = [Number(data.longitude), Number(data.latitude)];
                dataToSave.employerInformation.companyName = data.companyName ? data.companyName : 'Not specified';
                const country = commonFunctions.Handlers.getCountryISOCode(data.country);
                if (country) {
                    dataToSave.employeeInformation.country = country;
                    dataToSave.country = country;
                } else {
                    continue;
                }
                dataToSave.employeeInformation.countryCode = '+' + (data.countryCode || '1');
                dataToSave.employeeInformation.isComplete = true;
                dataToSave.employeeInformation.location.coordinates = [Number(data.longitude), Number(data.latitude)];
                dataToSave.employeeInformation.preferredLocations = {
                    type: 'MultiPoint',
                    coordinates: [[Number(data.longitude), Number(data.latitude)]]
                };
                dataToSave.firstName = data['Name'];
                dataToSave.email = data['Email'];
                dataToSave.employeeInformation.workAuthorization = data['Work Authorization'] !== 'N/A' ? data['Work Authorization'] : '';
                dataToSave.employeeInformation.experienceInMonths = data['Experience'] !== 'N/A' ? data['Experience'] * 12 : 0;
                dataToSave.employeeInformation.address.city = data['City'];
                dataToSave.employeeInformation.address.state = data['State'];
                dataToSave.employeeInformation.address.zipCode = data['Zip Code'] + '';
                dataToSave.employeeInformation.futureJobTitles = data['Job Title'] !== 'N/A' ? [data['Job Title']] : [];
                dataToSave.employeeInformation.skills = data['Skills'] !== 'N/A' ? data['Skills'].split(',') : [];
                dataToSave.employeeInformation.skillsLower = dataToSave.employeeInformation.skills.map(k => k.toLowerCase());

                dataToSave.employeeInformation.preferredLocationCities = [{
                    city: data['City'],
                    state: data['State'],
                    country: country,
                    latitude: Number(data.latitude),
                    longitude: Number(data.longitude)
                }];
                if (data.phone) {
                    dataToSave.employeeInformation.phone = data.phone;
                }
                dataToSave.email = email;
                if (!dataToSave.firstName) {
                    dataToSave.firstName = 'NA';
                }
                dataToSave.roles = ['Candidate'];
                dataToSave.appVersion = '1.2.63';
                dataToSave.deviceType = 'ANDROID';
                dataToSave.timeZone = country === 'US' ? -240 : 330;
                dataToSave.currency = country === 'US' ? 'USD' : 'INR';
                dataToSave.isAddedByBulkUpload = true;
                dataToSave.tempPassword = commonFunctions.Handlers.generatePassword();
                dataToSave.password = dataToSave.tempPassword;
                dataToSave.isOnline = false;
                dataToSave.isRoleSet = true;

                /* Save user into database */
                try {
                    checkUser = await dataToSave.save();
                    userCount++;
                } catch (e) {
                    logger.error('Error occurred while saving user in uploadBulkCandidateDataFromCSV handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            }
        }
    }

    return h.response(responseFormatter.responseFormatter({}, userCount + ' users have been added.', 'success', 201)).code(201);
};

handlers.sendSMSToDownload = async (request, h) => {
    let status;

    /* Fetch the phone details of all the users*/
    for (let i = 0; i < request.payload.userIds.length; i++) {
        let user, text = '', shortLink, job;
        try {
            user = await userSchema.UserSchema.findById({_id: request.payload.userIds[i]}, {
                'employeeInformation.countryCode': 1,
                'employeeInformation.phone': 1,
                email: 1,
                tempPassword: 1,
                isAddedByBulkUpload: 1,
                hasOwned: 1,
                isUnsubscribed: 1
            }, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding user details in send sms to download handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        try {
            job = await jobSchema.jobSchema.findOne({userId: mongoose.Types.ObjectId(request.payload.userIds[i])}, {jobTitle: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding job details in send sms to download handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (user.isAddedByBulkUpload && !user.hasOwned && !user.isUnsubscribed) {
            /* Create dynamic link */
            shortLink = await commonFunctions.Handlers.createFirebaseShortLink(user.email);
            if (shortLink === 'error') {
                return h.response(responseFormatter.responseFormatter({}, 'Error occurred during creating short links', 'error', 500)).code(500);
            } else {
                text += 'Your job ' + job.jobTitle + ' has been added in to EZJobs(app). To own this job posting and hiring candidates: 1. Claim your account by clicking on the link ' + shortLink.shortLink + ' . 2. Login using the email: ' + user.email + ' and password: ' + user.tempPassword + ' . 3. Complete the profile. 4. Start Hiring.';
            }

            /* Send SMS to user */
            status = await commonFunctions.Handlers.sendSMS(user.employeeInformation.countryCode, user.employeeInformation.phone, text);
            if (status === 'error') {

            } else {
                try {
                    user = await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userIds[i]}, {$set: {isMessageSent: true}, $inc: {numberOfMessagesSent: 1}}, {lean: true, new: true});
                } catch (e) {
                    logger.error('Error occurred while updating user details in send sms to download handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Successfully sent', 'success', 200)).code(200);
};

handlers.sendSMSToDownloadToAll = async (request, h) => {
    let status, users, userIds = [];

    /* Fetch list of all the users */
    try {
        users = await userSchema.UserSchema.find({isAddedByBulkUpload: true, isMessageSent: false, hasOwned: false}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user details in send sms to download to all handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    for (let i = 0; i < users.length; i++) {
        userIds.push(users[i]._id);
    }

    /* Fetch the phone details of all the users*/
    for (let i = 0; i < userIds.length; i++) {
        let user, text = '', shortLink, job;
        try {
            user = await userSchema.UserSchema.findById({_id: userIds[i]}, {'employeeInformation.countryCode': 1, 'employeeInformation.phone': 1, email: 1, tempPassword: 1, isAddedByBulkUpload: 1, hasOwned: 1, isUnsubscribed: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding user details in send sms to download to all handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        try {
            console.log(userIds[i]);
            job = await jobSchema.jobSchema.findOne({userId: mongoose.Types.ObjectId(userIds[i])}, {jobTitle: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding job details in send sms to download to all handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (user.isAddedByBulkUpload && !user.hasOwned && !user.isUnsubscribed) {
            /* Create dynamic link */
            shortLink = await commonFunctions.Handlers.createFirebaseShortLink(user.email);
            if (shortLink === 'error') {
                return h.response(responseFormatter.responseFormatter({}, 'Error occurred during creating short links', 'error', 500)).code(500);
            } else {
                text += 'Your job ' + job.jobTitle + ' has been added in to EZJobs(app). To own this job posting and hiring candidates: 1. Claim your account by clicking on the link ' + shortLink.shortLink + ' . 2. Login using the email: ' + user.email + ' and password: ' + user.tempPassword + ' . 3. Complete the profile. 4. Start Hiring.';
            }

            /* Send SMS to user */
            status = await commonFunctions.Handlers.sendSMS(user.employeeInformation.countryCode, user.employeeInformation.phone, text);
            if (status === 'error') {

            } else {
                try {
                    user = await userSchema.UserSchema.findByIdAndUpdate({_id: userIds[i]}, {$set: {isMessageSent: true}, $inc: {numberOfMessagesSent: 1}}, {lean: true, new: true});
                } catch (e) {
                    logger.error('Error occurred while updating user details in send sms to download handler to all %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Successfully sent', 'success', 200)).code(200);
};

handlers.updateProfileCompletionFields = async (request, h) => {
    let checkAdmin, decoded;

    /* Check if admin is allowed to create new admin or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in update profile completion fields handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in update profile completion fields handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    } else if (!checkAdmin.isSuper) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Update fields */
    try {
        await incompleteProfileCompleteSchema.incompleteProfileFieldsSchema.updateMany({}, {$set: {fields: request.payload.fields}}, {lean: true, upsert: true});
    } catch (e) {
        logger.error('Error occurred in updating fields data in update profile completion fields handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Fields updated', 'success', 204)).code(200);
};

handlers.getProfileCompletionFields = async (request, h) => {
    let checkAdmin, decoded, fieldsData;

    /* Check if admin is allowed to create new admin or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in get profile completion fields handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in get profile completion fields handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.query.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get fields data */
    try {
        fieldsData = await incompleteProfileCompleteSchema.incompleteProfileFieldsSchema.findOne({}, {fields: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting fields data in get profile completion fields handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(fieldsData.fields, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.updateProfileCompletionFieldsForUser = async (request, h) => {
    let checkAdmin, decoded, checkUser;

    /* Check if admin is allowed to create new admin or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in update profile completion fields for user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in update profile completion fields for user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether user exists or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting user data in update profile completion fields for user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    }

    /* Update fields for the user */
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$set: {'employeeInformation.profileCompletionFields': request.payload.fields}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in updating user data in update profile completion fields for user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated', 'success', 204)).code(200);
};

handlers.sendProfileCompletionEmails = async (request, h) => {
    let checkAdmin, decoded;

    /* Check if admin is allowed to create new admin or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in send profile completion emails handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in send profile completion emails handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Loop through user IDS and send emails accordingly */
    for (let i = 0; i < request.payload.userIds.length; i++) {
        let user;
        try {
            user = await userSchema.UserSchema.findById({_id: request.payload.userIds[i]}, {hasUnsubscribedEmails: 1, 'employeeInformation.profileCompletionFields': 1, firstName: 1, email: 1, lastName: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding user in send profile completion emails handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (user && !user.hasUnsubscribedEmails && user.employeeInformation.profileCompletionFields && user.employeeInformation.profileCompletionFields.length) {
            /* Send welcome email */
            try {
                let email = {
                    to: [{
                        email: user.email,
                        name: (user.firstName + ' ' + user.lastName).trim(),
                        type: 'to'
                    }],
                    important: false,
                    merge: true,
                    merge_language: 'handlebars',
                    merge_vars: [{
                        rcpt: user.email,
                        vars: [
                            {
                                name: 'fname',
                                content: user.firstName
                            },
                            {
                                name: 'fields',
                                content: user.employeeInformation.profileCompletionFields
                            }
                        ]
                    }]
                };
                await mandrill.Handlers.sendTemplate('ezjobs-profile-completion-master', [], email, true);

                /* Update user information to increase count */
                try {
                    await userSchema.UserSchema.findByIdAndUpdate({_id: user._id}, {$inc: {'employeeInformation.numberOfEmailsSent': 1}, $set: {'employeeInformation.lastEmailSent': Date.now()}}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred in updating user in send profile completion emails handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            } catch (e) {
                logger.error('Error in sending incomplete profile email to user %s:', JSON.stringify(e));
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Email sent successfully', 'success', 200)).code(200);
};

handlers.sendProfileCompletionTexts = async (request, h) => {
    let checkAdmin, decoded;

    /* Check if admin is allowed to create new admin or not */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in send profile completion texts handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in send profile completion texts handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Loop through user IDS and send emails accordingly */
    for (let i = 0; i < request.payload.userIds.length; i++) {
        let user, smsStatus;
        try {
            user = await userSchema.UserSchema.findById({_id: request.payload.userIds[i]}, {isUnsubscribed: 1, 'employeeInformation.profileCompletionFields': 1, firstName: 1, email: 1, lastName: 1, 'employeeInformation.countryCode': 1, 'employeeInformation.phone': 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding user in send profile completion texts handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (user && !user.isUnsubscribed && user.employeeInformation.profileCompletionFields && user.employeeInformation.profileCompletionFields.length) {
            /* Send sms */
            let body = '';
            if (user.employeeInformation.phone) {
                smsStatus = await commonFunctions.Handlers.sendSMS(user.employeeInformation.countryCode, user.employeeInformation.phone, body);
                if (smsStatus !== 'error') {
                    /* Update user information to increase count */
                    try {
                        await userSchema.UserSchema.findByIdAndUpdate({_id: user._id}, {$inc: {numberOfMessagesSent: 1}}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred in updating user in send profile completion texts handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Texts sent successfully', 'success', 200)).code(200);
};

handlers.reverseGeocode = async (request, h) => {
    let userData;

    try {
        userData = await userSchema.UserSchema.find({'employeeInformation.address.subLocality': {$ne: ''}}, {employeeInformation: 1, employerInformation: 1, _id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in fetching user information in reverse geocode handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < userData.length; i++) {
        let userAddress = {}, companyAddress = {}, data, jobData;
        /* Update address data of the users */
        try {
            data = await commonFunctions.Handlers.reverseGeocode(userData[i].employeeInformation.location.coordinates[1], userData[i].employeeInformation.location.coordinates[0]);
        } catch (e) {
            logger.error('Error occurred in reverse geocoding user address in reverse geocode handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (data !== 'error') {
            userAddress.address1 = data.address1;
            userAddress.address2 = data.address2;
            userAddress.city = data.city;
            userAddress.state = data.state;
            userAddress.zipCode = data.zipCode;
            userAddress.subLocality = data.subLocality;
        }

        /* Update address data of the user company */
        try {
            data = await commonFunctions.Handlers.reverseGeocode(userData[i].employerInformation.companyLocation.coordinates[1], userData[i].employerInformation.companyLocation.coordinates[0]);
        } catch (e) {
            logger.error('Error occurred in reverse geocoding user address in reverse geocode handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (data !== 'error') {
            companyAddress.address1 = data.address1;
            companyAddress.address2 = data.address2;
            companyAddress.city = data.city;
            companyAddress.state = data.state;
            companyAddress.zipCode = data.zipCode;
            companyAddress.subLocality = data.subLocality;
        }

        /* Update user data */
        try {
            await userSchema.UserSchema.findByIdAndUpdate({_id: userData[i]._id}, {$set: {'employeeInformation.address': userAddress, 'employerInformation.companyAddress': companyAddress}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in updating user information in reverse geocode handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Find job of this user */
        try {
            jobData = await jobSchema.jobSchema.find({userId: mongoose.Types.ObjectId(userData[i]._id), subLocality: {$ne: ''}}, {location: 1, _id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in fetching job information in reverse geocode handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (jobData) {
            for (let i = 0; i < jobData.length; i++) {
                let jobAddress = {};
                /* Update address data of the user company */
                try {
                    data = await commonFunctions.Handlers.reverseGeocode(jobData[i].location.coordinates[1], jobData[i].location.coordinates[0]);
                } catch (e) {
                    logger.error('Error occurred in reverse geocoding job address in reverse geocode handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                if (data !== 'error') {
                    jobAddress.address1 = data.address1;
                    jobAddress.address2 = data.address2;
                    jobAddress.city = data.city;
                    jobAddress.state = data.state;
                    jobAddress.zipCode = data.zipCode;
                    jobAddress.subLocality = data.subLocality;
                }

                /* Update job */
                try {
                    await jobSchema.jobSchema.findByIdAndUpdate({_id: jobData[i]._id}, {$set: {address: jobAddress}}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred in updating job data in reverse geocode handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Success', 'success', 200)).code(200);
};

handlers.getStates = async (request, h) => {
    let states = csc.getStatesOfCountry(request.query.countryId);

    /* Success */
    return h.response(responseFormatter.responseFormatter(states, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.getCities = async (request, h) => {
    let cities = csc.getCitiesOfState(request.query.stateId);

    /* Success */
    return h.response(responseFormatter.responseFormatter(cities, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.ownAccountCron = async (request, h) => {
    let checkAdmin, decoded, updateCriteria;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in ownAccountCron handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in ownAccountCron handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Start or stop the cron */
    if (request.payload.mode === 'start') {
        updateCriteria = {
            hasOwnProfileSMSAndEmailCronStarted: true
        };
        taskOwnAccount.start();
        console.log(taskOwnAccount.getStatus());
    } else {
        updateCriteria = {
            hasOwnProfileSMSAndEmailCronStarted: false
        };
        if (taskOwnAccount) {
            taskOwnAccount.destroy();
        }
    }

    /* Update constant data */
    try {
        await constantSchema.constantSchema.findOneAndUpdate({}, {$set: updateCriteria}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in updating constant data in ownAccountCron handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Cron setting updated successfully', 'success', 204)).code(200);
};

handlers.generateDynamicLink = async (request, h) => {
    let checkAdmin, decoded, shortLink;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in generate dynamic link handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in  generate dynamic link handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Create dynamic link */
    shortLink = await commonFunctions.Handlers.createFirebaseShortLink('', '', '', request.payload.keyword ? request.payload.keyword : '', request.payload.categoryId ? request.payload.categoryId : '', request.payload.latitude ? request.payload.latitude : '', request.payload.longitude ? request.payload.longitude : '', request.payload.role ? request.payload.role : '');
    if (shortLink === 'error') {
        return h.response(responseFormatter.responseFormatter({}, 'Error occurred during generating short link. Please contact support team.', 'error', 500)).code(500);
    } else {
        return h.response(responseFormatter.responseFormatter({deepLink: shortLink.shortLink}, 'Created successfully', 'success', 201)).code(201);
    }
};

handlers.interviewStartEndTime = async (request, h) => {
    let jobs;

    try {
        jobs = await jobSchema.jobSchema.find({isWalkInInterview: true}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting jobs data in interview start end time handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < jobs.length; i++) {
        let startDate, endDate, startTime, endTime;
        if (jobs[i].interviewStartDateTime) {
            const date = new Date(jobs[i].interviewStartDateTime);
            const dd = date.getDate();
            const mm = date.getMonth() + 1;
            const yy = date.getFullYear();
            startDate = new Date(mm + '/' + dd + '/' + yy);
            startTime = new Date(jobs[i].interviewStartDateTime);
        }
        if (jobs[i].interviewEndDateTime) {
            const date = new Date(jobs[i].interviewEndDateTime);
            const dd = date.getDate();
            const mm = date.getMonth() + 1;
            const yy = date.getFullYear();
            endDate = new Date(mm + '/' + dd + '/' + yy);
            endTime = new Date(jobs[i].interviewEndDateTime);
        }
        if (startDate && startTime && endDate && endTime) {
            /* Update the job */
            const updateCriteria = {
                interviewStartDate: startDate,
                interviewStartTime: startTime,
                interviewEndDate: endDate,
                interviewEndTime: endTime
            };
            try {
                await jobSchema.jobSchema.findByIdAndUpdate({_id: jobs[i]._id}, {$set: updateCriteria}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in updating jobs data in interview start end time handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Script successfully executed', 'success', 200)).code(200);
};

handlers.notPermittedWords = async (request, h) => {
    let checkAdmin, decoded, words;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in not permitted words handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in not permitted words handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if ((decoded.userId !== request.payload.adminId) || (!checkAdmin.isSuper)) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get the list of old words */
    try {
        words = await notPermittedWordsSchema.notPermittedWordsSchema.findOne({}, {words: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding words data in not permitted words handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Remove words from bad-words library */
    if (words.words.length) {
        global.filter.removeWords(...words.words);
    }

    /* Save words into the database */
    try {
        words = await notPermittedWordsSchema.notPermittedWordsSchema.findOneAndUpdate({}, {$set: {words: request.payload.words}}, {lean: true, upsert: true, new: true});
    } catch (e) {
        logger.error('Error occurred in updating words data in not permitted words handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (words.words.length) {
        global.filter.addWords(...words.words);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(words, 'Updated successfully', 'success', 204)).code(200);
};

handlers.createDynamicLink = async (request, h) => {
    let shortLink;

    shortLink = await commonFunctions.Handlers.createFirebaseShortLink(request.payload.email ? request.payload.email : '',
        request.payload.jobId ? request.payload.jobId: '', request.payload.candidateId ? request.payload.candidateId : '', request.payload.keyword ? request.payload.keyword : '', request.payload.categoryId ? request.payload.categoryId: '', request.payload.latitude ? request.payload.latitude: '', request.payload.longitude ? request.payload.longitude : '', '', request.payload.employerId ? request.payload.employerId: '');
    if (shortLink === 'error') {
        console.log('error occurred');
    }
    return h.response(responseFormatter.responseFormatter(shortLink.shortLink, 'Created successfully', 'success', 201)).code(201);
};

handlers.getUserInfoWithQuery = async (request, h) => {
    let checkAdmin, decoded, userData, jobData, searchCriteria = {$or: []};

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in get user info with query handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in get user info with query handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.query.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Find user in EZ Jobs database from given criteria */
    if (request.query.email) {
        searchCriteria.$or.push({email: new RegExp('^' + request.query.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')});
    }
    if (request.query.phone) {
        searchCriteria.$or.push({'employerInformation.companyPhone': request.query.phone});
        searchCriteria.$or.push({'employeeInformation.phone': request.query.phone});
    }
    if (request.query.firstName) {
        searchCriteria.$or.push({firstName: request.query.firstName});
    }
    if (request.query.lastName) {
        searchCriteria.$or.push({firstName: request.query.lastName});
    }

    try {
        userData = await userSchema.UserSchema.findOne(searchCriteria, {password: 0}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting user data in get user info with query handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!userData) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user exists', 'error', 404)).code(404);
    } else {
        try {
            jobData = await jobSchema.jobSchema.find({userId: userData._id}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in getting jobs data of user in get user info with query handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({userInfo: userData, jobInfo: jobData}, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.sendDynamicLinkEmailSMS = async (request, h) => {
    let checkAdmin, decoded, checkUser;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in send dynamic link email sms handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in send dynamic link email sms handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding user data in send dynamic link email sms handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    }

    /* Check if isEmail key is true */
    if (request.payload.isEmail) {

    }

    /* Check if isSMS key is true */
    if (request.payload.isSMS) {
        if (request.payload.role.toLowerCase() === 'employer') {

        } else if (request.payload.role.toLowerCase() === 'candidate') {

        } else {
            return h.response(responseFormatter.responseFormatter({}, 'Please select a role to send the SMS', 'error', 400)).code(400);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Sent successfully', 'success', 200)).code(200);
};

handlers.removeIncorrectData = async (request, h) => {
    let checkAdmin, decoded, userData;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in remove incorrect data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {isSuper: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in remove incorrect data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if ((decoded.userId !== request.payload.adminId) || (!checkAdmin.isSuper)) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get all the data whose address is not there */
    try {
        userData = await userSchema.UserSchema.aggregate([
            {
                $match: {
                    isAddedByBulkUpload: true,
                    hasOwned: false,
                    'employeeInformation.address.city': {$eq: ''}
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred in aggregating user data in remove incorrect data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Remove from favourite list, conversation list and job list */
    for (let i = 0; i < userData.length; i++) {
        let jobs;
        try {
            jobs = await jobSchema.jobSchema.find({userId: mongoose.Types.ObjectId(userData[i]._id)}, {_id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding jobs data in remove incorrect data handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        for (let j = 0; j < jobs.length; j++) {
            /* Delete from favorite list */
            try {
                await favoriteSchema.favouriteSchema.deleteMany({jobId: mongoose.Types.ObjectId(jobs[j]._id)});
            } catch (e) {
                console.log(e);
                logger.error('Error occurred in deleting favorite jobs data in remove incorrect data handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            /* Delete from conversations */
            try {
                await conversationSchema.conversationSchema.deleteMany({jobId: mongoose.Types.ObjectId(jobs[j]._id)});
            } catch (e) {
                logger.error('Error occurred in deleting conversation data in remove incorrect data handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
        /* Delete jobs */
        try {
            await jobSchema.jobSchema.deleteMany({userId: mongoose.Types.ObjectId(userData[i]._id)});
        } catch (e) {
            logger.error('Error occurred in deleting jobs data in remove incorrect data handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Delete user */
        try {
            await userSchema.UserSchema.findByIdAndDelete({_id: userData[i]._id});
        } catch (e) {
            logger.error('Error occurred in deleting user data in remove incorrect data handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Script run successfully', 'success', 200)).code(200);
};

handlers.sendSilentPush = async (request, h) => {
    let result;
    result = await push.createSilentMessage('', request.payload.deviceToken, {pushType: 'silent'}, 'ANDROID');
    if (result === 'NotRegistered') {
        return h.response(responseFormatter.responseFormatter({}, 'Device unregistered', 'success', 200)).code(200);
    }
    return h.response(responseFormatter.responseFormatter({}, 'Push sent successfully', 'success', 200)).code(200);
};

handlers.updateHubSpotForUninstalls = async (request, h) => {
    let users;
    try {
        users = await userSchema.UserSchema.find({isAddedByBulkUpload: false}, {hasUninstalled: 1, email: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding user data in update hubspot for uninstalls handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    for (let i = 0; i < users.length; i++) {
        let hubSpotProperties = [];
        if (users[i].hasUninstalled) {
            hubSpotProperties.push({
                property: 'app_uninstall',
                value: 'True'
            });
        } else {
            hubSpotProperties.push({
                property: 'app_uninstall',
                value: 'False'
            });
        }
        /* Update contact */
        let status = await commonFunctions.Handlers.updateHubSpotContact(users[i].email, hubSpotProperties);
        if (status === 404) {
            console.log('HubSpot contact not found');
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
};

handlers.getReportedJobs = async (request, h) => {
    let checkAdmin, decoded, jobs, aggregationCriteria, totalCount;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in get reported jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in get reported jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.query.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Aggregate on Job collection to fetch all the reported jobs by users */
    aggregationCriteria = [
        {
            $sort: {_id: -1}
        },
        {
            $match: {
                'reportedBy.0': {$exists: true}
            }
        },
        {
            $limit: request.query.limit
        },
        {
            $unwind: {
                path: '$reportedBy',
                includeArrayIndex: 'reported_index'
            }
        },
        {
            $unwind: {
                path: '$reportReason',
                includeArrayIndex: 'reportedReason_index'
            }
        },
        {
            $project: {
                _id: 1,
                jobTitle: 1,
                reportedBy: 1,
                reportReason: 1,
                userId: 1,
                isUnderReview: 1,
                isArchived: 1,
                compare: {
                    $cmp: ['$reported_index', '$reportedReason_index']
                }
            }
        },
        {
            $match: {
                compare: 0
            }
        },
        {
            $lookup: {
                from: 'User',
                localField: 'reportedBy',
                foreignField: '_id',
                as: 'reporter'
            }
        },
        {
            $unwind: '$reporter'
        },
        {
            $lookup: {
                from: 'User',
                localField: 'userId',
                foreignField: '_id',
                as: 'poster'
            }
        },
        {
            $unwind: '$poster'
        },
        {
            $project: {
                _id: 1,
                jobTitle: 1,
                reportedBy: '$reporter.email',
                reportReason: 1,
                postedBy: '$poster.email',
                isUnderReview: 1,
                isArchived: 1,
            }
        }
    ];
    if (request.query.firstId) {
        aggregationCriteria.shift();
        aggregationCriteria.shift();
        aggregationCriteria.unshift({
            $match: {
                _id: {$gt: mongoose.Types.ObjectId(request.query.firstId)}
            }
        });
        aggregationCriteria.unshift( {
            $match: {
                'reportedBy.0': {$exists: true}
            }
        });
        aggregationCriteria.unshift( {
           $sort: {_id: -1}
        });
    } else if (request.query.lastId) {
        aggregationCriteria.shift();
        aggregationCriteria.shift();
        aggregationCriteria.unshift({
            $match: {
                _id: {$lt: mongoose.Types.ObjectId(request.query.lastId)}
            }
        });
        aggregationCriteria.unshift( {
            $match: {
                'reportedBy.0': {$exists: true}
            }
        });
        aggregationCriteria.unshift( {
            $sort: {_id: -1}
        });
    }
    try {
        jobs = await jobSchema.jobSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred in aggregating reported jobs in get reported jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Count total number of documents for pagination */
    try {
        totalCount = await jobSchema.jobSchema.countDocuments({'reportedBy.0': {$exists: true}});
    } catch (e) {
        logger.error('Error occurred in aggregating reported jobs to get count in get reported jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(jobs, 'Fetched successfully', 'success', 200, totalCount)).code(200);
};

handlers.getReportedUsers = async (request, h) => {
    let checkAdmin, decoded, users, aggregationCriteria, totalCount;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in get reported users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in get reported users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.query.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Aggregate on Job collection to fetch all the reported jobs by users */
    aggregationCriteria = [
        {
            $sort: {_id: -1}
        },
        {
            $match: {
                $or: [
                    {isCandidateReported: true},
                    {isEmployerReported: true}
                ]
            }
        },
        {
            $limit: request.query.limit
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
            $project: {
                _id: 1,
                reporterEmail: {
                    $cond: [{$eq: ['$isCandidateReported', true]}, '$employer.email', '$candidate.email']
                },
                reportedEmail: {
                    $cond: [{$eq: ['$isCandidateReported', true]}, '$candidate.email', '$employer.email']
                },
                reportReason: 1,
                reporterId: {
                    $cond: [{$eq: ['$isCandidateReported', true]}, '$employer._id', '$candidate._id']
                },
                reportedId: {
                    $cond: [{$eq: ['$isCandidateReported', true]}, '$candidate._id', '$employer._id']
                }
            }
        }
    ];
    if (request.query.firstId) {
        aggregationCriteria.shift();
        aggregationCriteria.shift();
        aggregationCriteria.unshift({
            $match: {
                _id: {$gt: mongoose.Types.ObjectId(request.query.firstId)}
            }
        });
        aggregationCriteria.unshift(  {
            $match: {
                $or: [
                    {isCandidateReported: true},
                    {isEmployerReported: true}
                ]
            }
        });
        aggregationCriteria.unshift( {
            $sort: {_id: -1}
        });
    } else if (request.query.lastId) {
        aggregationCriteria.shift();
        aggregationCriteria.shift();
        aggregationCriteria.unshift({
            $match: {
                _id: {$lt: mongoose.Types.ObjectId(request.query.lastId)}
            }
        });
        aggregationCriteria.unshift(  {
            $match: {
                $or: [
                    {isCandidateReported: true},
                    {isEmployerReported: true}
                ]
            }
        });
        aggregationCriteria.unshift( {
            $sort: {_id: -1}
        });
    }
    try {
        users = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred in aggregating reported users in get reported users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Count total number of documents for pagination */
    try {
        totalCount = await conversationSchema.conversationSchema.countDocuments({ '$or': [ { isCandidateReported: true }, { isEmployerReported: true } ] });
    } catch (e) {
        logger.error('Error occurred in aggregating reported users for getting count in get reported users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(users, 'Fetched successfully', 'success', 200, totalCount)).code(200);
};

handlers.getBlockedUsersForAdmin = async (request, h) => {
    let checkAdmin, decoded, users, aggregationCriteria, totalCount;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in get blocked users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in get blocked users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.query.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Aggregate on Job collection to fetch all the reported jobs by users */
    aggregationCriteria = [
        {
            $sort: {_id: -1}
        },
        {
            $limit: request.query.limit
        },
        {
            $lookup: {
                from: 'User',
                localField: 'userId',
                foreignField: '_id',
                as: 'blockingUser'
            }
        },
        {
            $unwind: '$blockingUser'
        },
        {
            $lookup: {
                from: 'User',
                localField: 'blockedUserId',
                foreignField: '_id',
                as: 'blockedUser'
            }
        },
        {
            $unwind: '$blockedUser'
        },
        {
            $project: {
                _id: 1,
                email: '$blockedUser.email',
                blockerEmail: '$blockingUser.email',
                blockReason: 1
            }
        }
    ];
    if (request.query.firstId) {
        aggregationCriteria.shift();
        aggregationCriteria.unshift({
            $match: {
                _id: {$gt: mongoose.Types.ObjectId(request.query.firstId)}
            }
        });
        aggregationCriteria.unshift( {
            $sort: {_id: -1}
        });
    } else if (request.query.lastId) {
        aggregationCriteria.shift();
        aggregationCriteria.unshift({
            $match: {
                _id: {$lt: mongoose.Types.ObjectId(request.query.lastId)}
            }
        });
        aggregationCriteria.unshift( {
            $sort: {_id: -1}
        });
    }
    try {
        users = await blockUserSchema.blockSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred in aggregating blocked users in get blocked users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Count total number of documents for pagination */
    try {
        totalCount = await blockUserSchema.blockSchema.estimatedDocumentCount({});
    } catch (e) {
        logger.error('Error occurred in aggregating blocked users for total count in get blocked users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(users, 'Fetched successfully', 'success', 200, totalCount)).code(200);
};

handlers.uploadVideo = async (request, h) => {
    let imageUrl;

    /* Upload video and generate URL */
    try {
        imageUrl = await commonFunctions.Handlers.uploadImage(request.payload.image.path, request.payload.image.filename === 'blob' ? request.payload.image.filename + '.aac' : request.payload.image.filename);
    } catch (e) {
        logger.error('Error occurred while uploading image in upload video handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (imageUrl) {
        return h.response(responseFormatter.responseFormatter({url: imageUrl}, 'Uploaded successfully', 'success', 201)).code(200);
    } else {
        return h.response(responseFormatter.responseFormatter({}, 'Error occurred while uploading image', 'error', 500)).code(500);
    }
};

handlers.createResume = async (request, h) => {
    let user;

    try {
        user = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user information in create resume handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (user && !user.employeeInformation.resume) {
        const path = require('path');
        let html = fs.readFileSync(path.resolve(__dirname, '../public/resume_template.html'), 'utf8');
        const options = {
            format: 'A4',
            orientation: 'portrait'
        };
        let languages = [];
        if (user.employeeInformation.languages.length) {
            for (let i = 0; i < user.employeeInformation.languages.length; i++) {
                languages.push(user.employeeInformation.languages[i].language);
            }
        } else {
            languages = undefined;
        }
        let document = {
            html: html,
            path: path.resolve(__dirname, '../public/resume.pdf'),
            data: {
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phone: user.employeeInformation.phone,
                selfIntroduction: user.employeeInformation.description.text,
                skills: user.employeeInformation.skills,
                languages: languages,
                education: user.employeeInformation.education,
                jobs: user.employeeInformation.pastJobTitles.length ? user.employeeInformation.pastJobTitles : null,
                jobTitle: user.employeeInformation.futureJobTitles.length ? user.employeeInformation.futureJobTitles[0] : null,
                profilePhoto: user.employeeInformation.profilePhoto,
                pastJobTitles: user.employeeInformation.pastJobTitles.length ? user.employeeInformation.pastJobTitles : undefined,
                futureJobTitles: user.employeeInformation.futureJobTitles.length ? user.employeeInformation.futureJobTitles : undefined,
                personalInformation: {
                    gender: user.employeeInformation.gender,
                    dob: user.employeeInformation.dob.day + '-' + user.employeeInformation.dob.month + '-' + user.employeeInformation.dob.year
                },
                address: user.employeeInformation.address.city + ', ' + user.employeeInformation.address.state
            }
        };

        try {
            await pdf.create(document, options);
        } catch (e) {
            console.log(e);
        }

        /* Send email to admin for temporary password */
        const mailOptions = {
            from: 'support@ezjobs.io',
            to: 'pyash@ezjobs.io',
            subject: 'Sample Resume',
            text: 'Please find the resume',
            attachments: [
                {
                    filename: 'resume.pdf',
                    path: path.resolve(__dirname, '../public/resume.pdf')
                }
            ]
        };
        try {
            await commonFunctions.Handlers.nodeMailerEZJobsWithAttachment(mailOptions);
        } catch (e) {
            console.log(e);
            logger.error('Error in sending create account email to admin %s:', JSON.stringify(e));
        }

        return h.response(responseFormatter.responseFormatter({}, 'Email sent', 'success', 200)).code(200);
    } else {
        return h.response(responseFormatter.responseFormatter({}, 'Successfully created', 'success', 200)).code(200);
    }
};

handlers.updateHubSpotContacts = async (request, h) => {
    let users;

    /* Fetch all the users who is employer */
    try {
        users = await userSchema.UserSchema.find({roles: 'Employer'}, {email: 1, employerInformation: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user information in update hubspot contacts handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < users.length; i++) {
        if (users[i].employerInformation.countryCode && users[i].employerInformation.companyPhone) {
            let hubSpotProperty = [];
            hubSpotProperty.push({
               property: 'phone',
               value: users[i].employerInformation.countryCode + users[i].employerInformation.companyPhone
           });
            /* Update contact */
            let status = await commonFunctions.Handlers.updateHubSpotContact(users[i].email, hubSpotProperty);
            if (status === 404) {
                console.log('HubSpot contact not found');
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
};

handlers.createPricing = async (request, h) => {
    let checkAdmin, decoded, currency;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in create pricing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in create pricing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /*
    * Get Currency data from the country
    * */
    try {
        currency = await codeSchema.CodeSchema.findOne({countryISOName: request.payload.country}, {currencyName: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting currency data in create pricing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!currency) {
        return h.response(responseFormatter.responseFormatter({}, 'Error occurred while fetching currency for the given country', 'error', 400)).code(400);
    } else {
        request.payload.currency = currency.currencyName;
    }

    /*
    * Save the payload in database
    * */
    try {
        await new pricingSchema.pricingSchema(request.payload).save();
    } catch (e) {
        logger.error('Error occurred in saving pricing data in create pricing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter({}, 'Pricing created successfully', 'success', 201)).code(200);
};

handlers.createPackage = async (request, h) => {
    let checkAdmin, decoded, weekPlan, monthPlan, annualPlan, monthDiscount, yearDiscount, constantData, totalMonthly, totalMonthlyOriginal, totalYearly, totalYearlyOriginal, pack,
        packageUsers, pricing, totalMonthlyBeforeTax, totalYearlyBeforeTax;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in create plan handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in create plan handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    try {
        pricing = await pricingSchema.pricingSchema.findOne({_id: mongoose.Types.ObjectId(request.payload.pricingId), isActive: true}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting pricing data in create plan handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!pricing) {
        return h.response(responseFormatter.responseFormatter({}, 'No pricing information found to create a package', 'error', 400)).code(400);
    }

    /* Get constant data */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {taxes: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting constant data in create plan handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get the tax information from constant data */
    if (constantData && constantData.taxes) {
        const idx = constantData.taxes.findIndex(k => k.country.toLowerCase() === request.payload.country.toLowerCase());
        if (idx !== -1) {
            request.payload.taxType = constantData.taxes[idx].taxType;
            request.payload.taxAmount = constantData.taxes[idx].taxAmount;
        } else {
            request.payload.taxType = 'N/A';
            request.payload.taxAmount = 0;
        }
    } else {
        request.payload.taxType = 'N/A';
        request.payload.taxAmount = 0;
    }

    if (!request.payload.total) {
        if (request.payload.numberOfJobs && request.payload.numberOfJobs.isIncluded && !request.payload.isFree) {
            if (request.payload.numberOfJobs.isFree) {
                request.payload.numberOfJobs.totalMonthly = 0;
                request.payload.numberOfJobs.totalYearly = 0;
                request.payload.numberOfJobs.totalMonthlyOriginal = 0;
                request.payload.numberOfJobs.totalYearlyOriginal = 0;
            } else if (request.payload.numberOfJobs && request.payload.numberOfJobs.isUnlimited) {
                request.payload.numberOfJobs.totalMonthly = commonFunctions.Handlers.calculatePricing(pricing.numberOfJobs.basePrice, request.payload.monthlyDiscount, 'monthly');
                request.payload.numberOfJobs.totalYearly = commonFunctions.Handlers.calculatePricing(pricing.numberOfJobs.basePrice, request.payload.yearlyDiscount, 'yearly');
                request.payload.numberOfJobs.totalMonthlyOriginal = pricing.numberOfJobs.basePrice;
                request.payload.numberOfJobs.totalYearlyOriginal = pricing.numberOfJobs.basePrice;
            } else {
                request.payload.numberOfJobs.totalMonthly = commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfJobs.basePrice, pricing.numberOfJobs.count, request.payload.numberOfJobs.monthlyCount, 'monthly', request.payload.monthlyDiscount, request.payload.taxAmount);
                request.payload.numberOfJobs.totalYearly = commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfJobs.basePrice, pricing.numberOfJobs.count, request.payload.numberOfJobs.monthlyCount * 12, 'yearly', request.payload.yearlyDiscount, request.payload.taxAmount);
                request.payload.numberOfJobs.totalMonthlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.numberOfJobs.basePrice, pricing.numberOfJobs.count, request.payload.numberOfJobs.monthlyCount, 'monthly');
                request.payload.numberOfJobs.totalYearlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.numberOfJobs.basePrice, pricing.numberOfJobs.count, request.payload.numberOfJobs.monthlyCount * 12, 'yearly');
            }
            if (request.payload.numberOfJobs && request.payload.numberOfJobs.isForcedMonthly) {
                request.payload.numberOfJobs.totalMonthly = request.payload.numberOfJobs.forcedMonthly;
                request.payload.numberOfJobs.totalMonthlyOriginal = request.payload.numberOfJobs.forcedMonthly;
            }
            if (request.payload.numberOfJobs && request.payload.numberOfJobs.isForcedYearly) {
                request.payload.numberOfJobs.totalYearly = request.payload.numberOfJobs.forcedYearly;
                request.payload.numberOfJobs.totalYearlyOriginal = request.payload.numberOfJobs.forcedYearly;
            }
        } else {
            request.payload.numberOfJobs.totalMonthly = 0;
            request.payload.numberOfJobs.totalYearly = 0;
            request.payload.numberOfJobs.totalMonthlyOriginal = 0;
            request.payload.numberOfJobs.totalYearlyOriginal = 0;
        }
        request.payload.numberOfJobs.heading = pricing.numberOfJobs.heading;
        request.payload.numberOfJobs.label = pricing.numberOfJobs.label;

        if (request.payload.numberOfUsers && request.payload.numberOfUsers.isIncluded && !request.payload.isFree) {
            if (request.payload.numberOfUsers.isFree) {
                request.payload.numberOfUsers.totalMonthly = 0;
                request.payload.numberOfUsers.totalYearly = 0;
                request.payload.numberOfUsers.totalMonthlyOriginal = 0;
                request.payload.numberOfUsers.totalYearlyOriginal = 0;
            } else if (request.payload.numberOfUsers && request.payload.numberOfUsers.isUnlimited) {
                request.payload.numberOfUsers.totalMonthly = commonFunctions.Handlers.calculatePricing(pricing.numberOfUsers.basePrice, request.payload.monthlyDiscount, 'monthly');
                request.payload.numberOfUsers.totalYearly = commonFunctions.Handlers.calculatePricing(pricing.numberOfUsers.basePrice, request.payload.yearlyDiscount, 'yearly');
                request.payload.numberOfUsers.totalMonthlyOriginal = pricing.numberOfUsers.basePrice;
                request.payload.numberOfUsers.totalYearlyOriginal = pricing.numberOfUsers.basePrice;
            } else {
                request.payload.numberOfUsers.totalMonthly = commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfUsers.basePrice, pricing.numberOfUsers.count, request.payload.numberOfUsers.monthlyCount, 'monthly', request.payload.monthlyDiscount, request.payload.taxAmount);
                request.payload.numberOfUsers.totalYearly = commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfUsers.basePrice, pricing.numberOfUsers.count, request.payload.numberOfUsers.monthlyCount * 12, 'yearly', request.payload.yearlyDiscount, request.payload.taxAmount);
                request.payload.numberOfUsers.totalMonthlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.numberOfUsers.basePrice, pricing.numberOfUsers.count, request.payload.numberOfUsers.monthlyCount, 'monthly');
                request.payload.numberOfUsers.totalYearlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.numberOfUsers.basePrice, pricing.numberOfUsers.count, request.payload.numberOfUsers.monthlyCount * 12, 'yearly');
            }
            if (request.payload.numberOfUsers && request.payload.numberOfUsers.isForcedMonthly) {
                request.payload.numberOfUsers.totalMonthly = request.payload.numberOfUsers.forcedMonthly;
                request.payload.numberOfUsers.totalMonthlyOriginal = request.payload.numberOfUsers.forcedMonthly;
            }
            if (request.payload.numberOfUsers && request.payload.numberOfUsers.isForcedYearly) {
                request.payload.numberOfUsers.totalYearly = request.payload.numberOfUsers.forcedYearly;
                request.payload.numberOfUsers.totalYearlyOriginal = request.payload.numberOfUsers.forcedYearly;
            }
        } else {
            request.payload.numberOfUsers.totalMonthly = 0;
            request.payload.numberOfUsers.totalYearly = 0;
            request.payload.numberOfUsers.totalMonthlyOriginal = 0;
            request.payload.numberOfUsers.totalYearlyOriginal = 0;
        }
        request.payload.numberOfUsers.heading = pricing.numberOfUsers.heading;
        request.payload.numberOfUsers.label = pricing.numberOfUsers.label;

        if (request.payload.numberOfViews && request.payload.numberOfViews.isIncluded && !request.payload.isFree) {
            if (request.payload.numberOfViews.isFree) {
                request.payload.numberOfViews.totalMonthly = 0;
                request.payload.numberOfViews.totalYearly = 0;
                request.payload.numberOfViews.totalMonthlyOriginal = 0;
                request.payload.numberOfViews.totalYearlyOriginal = 0;
            } else if (request.payload.numberOfViews && request.payload.numberOfViews.isUnlimited) {
                request.payload.numberOfViews.totalMonthly = commonFunctions.Handlers.calculatePricing(pricing.numberOfViews.basePrice, request.payload.monthlyDiscount, 'monthly');
                request.payload.numberOfViews.totalYearly = commonFunctions.Handlers.calculatePricing(pricing.numberOfViews.basePrice, request.payload.yearlyDiscount, 'yearly');
                request.payload.numberOfViews.totalMonthlyOriginal = pricing.numberOfViews.basePrice;
                request.payload.numberOfViews.totalYearlyOriginal = pricing.numberOfViews.basePrice;
            } else {
                request.payload.numberOfViews.totalMonthly = commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfViews.basePrice, pricing.numberOfViews.count, request.payload.numberOfViews.monthlyCount, 'monthly', request.payload.monthlyDiscount, request.payload.taxAmount);
                request.payload.numberOfViews.totalYearly = commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfViews.basePrice, pricing.numberOfViews.count, request.payload.numberOfViews.yearlyCount, 'yearly', request.payload.yearlyDiscount, request.payload.taxAmount);
                request.payload.numberOfViews.totalMonthlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.numberOfViews.basePrice, pricing.numberOfViews.count, request.payload.numberOfViews.monthlyCount, 'monthly');
                request.payload.numberOfViews.totalYearlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.numberOfViews.basePrice, pricing.numberOfViews.count, request.payload.numberOfViews.yearlyCount, 'yearly');
            }
            if (request.payload.numberOfViews && request.payload.numberOfViews.isForcedMonthly) {
                request.payload.numberOfViews.totalMonthly = request.payload.numberOfViews.forcedMonthly;
                request.payload.numberOfViews.totalMonthlyOriginal = request.payload.numberOfViews.forcedMonthly;
            }
            if (request.payload.numberOfViews && request.payload.numberOfViews.isForcedYearly) {
                request.payload.numberOfViews.totalYearly = request.payload.numberOfViews.forcedYearly;
                request.payload.numberOfViews.totalYearlyOriginal = request.payload.numberOfViews.forcedYearly;
            }
        } else {
            request.payload.numberOfViews.totalMonthly = 0;
            request.payload.numberOfViews.totalYearly = 0;
            request.payload.numberOfViews.totalMonthlyOriginal = 0;
            request.payload.numberOfViews.totalYearlyOriginal = 0;
        }
        request.payload.numberOfViews.heading = pricing.numberOfViews.heading;
        request.payload.numberOfViews.label = pricing.numberOfViews.label;

        if (request.payload.numberOfTextTranslations && request.payload.numberOfTextTranslations.isIncluded && !request.payload.isFree) {
            if (request.payload.numberOfTextTranslations.isFree) {
                request.payload.numberOfTextTranslations.totalMonthly = 0;
                request.payload.numberOfTextTranslations.totalYearly = 0;
                request.payload.numberOfTextTranslations.totalMonthlyOriginal = 0;
                request.payload.numberOfTextTranslations.totalYearlyOriginal = 0;
            } else if (request.payload.numberOfTextTranslations && request.payload.numberOfTextTranslations.isUnlimited) {
                request.payload.numberOfTextTranslations.totalMonthly = commonFunctions.Handlers.calculatePricing(pricing.numberOfTextTranslations.basePrice, request.payload.monthlyDiscount, 'monthly');
                request.payload.numberOfTextTranslations.totalYearly = commonFunctions.Handlers.calculatePricing(pricing.numberOfTextTranslations.basePrice, request.payload.yearlyDiscount, 'yearly');
                request.payload.numberOfTextTranslations.totalMonthlyOriginal = pricing.numberOfTextTranslations.basePrice;
                request.payload.numberOfTextTranslations.totalYearlyOriginal = pricing.numberOfTextTranslations.basePrice;
            } else {
                request.payload.numberOfTextTranslations.totalMonthly = commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfTextTranslations.basePrice, pricing.numberOfTextTranslations.count, request.payload.numberOfTextTranslations.monthlyCount, 'monthly', request.payload.monthlyDiscount, request.payload.taxAmount);
                request.payload.numberOfTextTranslations.totalYearly = commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfTextTranslations.basePrice, pricing.numberOfTextTranslations.count, request.payload.numberOfTextTranslations.yearlyCount, 'yearly', request.payload.yearlyDiscount, request.payload.taxAmount);
                request.payload.numberOfTextTranslations.totalMonthlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.numberOfTextTranslations.basePrice, pricing.numberOfTextTranslations.count, request.payload.numberOfTextTranslations.monthlyCount, 'monthly');
                request.payload.numberOfTextTranslations.totalYearlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.numberOfTextTranslations.basePrice, pricing.numberOfTextTranslations.count, request.payload.numberOfTextTranslations.yearlyCount, 'yearly');
            }
            if (request.payload.numberOfTextTranslations && request.payload.numberOfTextTranslations.isForcedMonthly) {
                request.payload.numberOfTextTranslations.totalMonthly = request.payload.numberOfTextTranslations.forcedMonthly;
                request.payload.numberOfTextTranslations.totalMonthlyOriginal = request.payload.numberOfTextTranslations.forcedMonthly;
            }
            if (request.payload.numberOfTextTranslations && request.payload.numberOfTextTranslations.isForcedYearly) {
                request.payload.numberOfTextTranslations.totalYearly = request.payload.numberOfTextTranslations.forcedYearly;
                request.payload.numberOfTextTranslations.totalYearlyOriginal = request.payload.numberOfTextTranslations.forcedYearly;
            }
        } else {
            request.payload.numberOfTextTranslations.totalMonthly = 0;
            request.payload.numberOfTextTranslations.totalYearly = 0;
            request.payload.numberOfTextTranslations.totalMonthlyOriginal = 0;
            request.payload.numberOfTextTranslations.totalYearlyOriginal = 0;
        }
        request.payload.numberOfTextTranslations.heading = pricing.numberOfTextTranslations.heading;
        request.payload.numberOfTextTranslations.label = pricing.numberOfTextTranslations.label;

        if (request.payload.numberOfJobTranslations && request.payload.numberOfJobTranslations.isIncluded && !request.payload.isFree) {
            if (request.payload.numberOfJobTranslations.isFree) {
                request.payload.numberOfJobTranslations.totalMonthly = 0;
                request.payload.numberOfJobTranslations.totalYearly = 0;
                request.payload.numberOfJobTranslations.totalMonthlyOriginal = 0;
                request.payload.numberOfJobTranslations.totalYearlyOriginal = 0;
            } else if (request.payload.numberOfJobTranslations && request.payload.numberOfJobTranslations.isUnlimited) {
                request.payload.numberOfJobTranslations.totalMonthly = commonFunctions.Handlers.calculatePricing(pricing.numberOfJobTranslations.basePrice, request.payload.monthlyDiscount, 'monthly');
                request.payload.numberOfJobTranslations.totalYearly = commonFunctions.Handlers.calculatePricing(pricing.numberOfJobTranslations.basePrice, request.payload.yearlyDiscount, 'yearly');
                request.payload.numberOfJobTranslations.totalMonthlyOriginal = pricing.numberOfJobTranslations.basePrice;
                request.payload.numberOfJobTranslations.totalYearlyOriginal = pricing.numberOfJobTranslations.basePrice;
            } else {
                request.payload.numberOfJobTranslations.totalMonthly = commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfJobTranslations.basePrice, pricing.numberOfJobTranslations.count, request.payload.numberOfJobTranslations.monthlyCount, 'monthly', request.payload.monthlyDiscount, request.payload.taxAmount);
                request.payload.numberOfJobTranslations.totalYearly = commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfJobTranslations.basePrice, pricing.numberOfJobTranslations.count, request.payload.numberOfJobTranslations.yearlyCount, 'yearly', request.payload.yearlyDiscount, request.payload.taxAmount);
                request.payload.numberOfJobTranslations.totalMonthlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.numberOfJobTranslations.basePrice, pricing.numberOfJobTranslations.count, request.payload.numberOfJobTranslations.monthlyCount, 'monthly');
                request.payload.numberOfJobTranslations.totalYearlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.numberOfJobTranslations.basePrice, pricing.numberOfJobTranslations.count, request.payload.numberOfJobTranslations.yearlyCount, 'yearly');
            }
            if (request.payload.numberOfJobTranslations && request.payload.numberOfJobTranslations.isForcedMonthly) {
                request.payload.numberOfJobTranslations.totalMonthly = request.payload.numberOfJobTranslations.forcedMonthly;
                request.payload.numberOfJobTranslations.totalMonthlyOriginal = request.payload.numberOfJobTranslations.forcedMonthly;
            }
            if (request.payload.numberOfJobTranslations && request.payload.numberOfJobTranslations.isForcedYearly) {
                request.payload.numberOfJobTranslations.totalYearly = request.payload.numberOfJobTranslations.forcedYearly;
                request.payload.numberOfJobTranslations.totalYearlyOriginal = request.payload.numberOfJobTranslations.forcedYearly;
            }
        } else {
            request.payload.numberOfJobTranslations.totalMonthly = 0;
            request.payload.numberOfJobTranslations.totalYearly = 0;
            request.payload.numberOfJobTranslations.totalMonthlyOriginal = 0;
            request.payload.numberOfJobTranslations.totalYearlyOriginal = 0;
        }
        request.payload.numberOfJobTranslations.heading = pricing.numberOfJobTranslations.heading;
        request.payload.numberOfJobTranslations.label = pricing.numberOfJobTranslations.label;

        if (request.payload.videoCall && request.payload.videoCall.isIncluded && !request.payload.isFree) {
            if (request.payload.videoCall.isFree) {
                request.payload.videoCall.totalMonthly = 0;
                request.payload.videoCall.totalYearly = 0;
                request.payload.videoCall.totalMonthlyOriginal = 0;
                request.payload.videoCall.totalYearlyOriginal = 0;
            } else {
                request.payload.videoCall.totalMonthly = commonFunctions.Handlers.calculatePricing(pricing.videoCall.basePrice, request.payload.monthlyDiscount, 'monthly', request.payload.taxAmount);
                request.payload.videoCall.totalYearly = commonFunctions.Handlers.calculatePricing(pricing.videoCall.basePrice * 12, request.payload.yearlyDiscount, 'yearly', request.payload.taxAmount);
                request.payload.videoCall.totalMonthlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.videoCall.basePrice, 1, 1,'monthly');
                request.payload.videoCall.totalYearlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.videoCall.basePrice, 1, 12, 'yearly');
            }
            if (request.payload.videoCall && request.payload.videoCall.isForcedMonthly) {
                request.payload.videoCall.totalMonthly = request.payload.videoCall.forcedMonthly;
                request.payload.videoCall.totalMonthlyOriginal = request.payload.videoCall.forcedMonthly;
            }
            if (request.payload.videoCall && request.payload.videoCall.isForcedYearly) {
                request.payload.videoCall.totalYearly = request.payload.videoCall.forcedYearly;
                request.payload.videoCall.totalYearlyOriginal = request.payload.videoCall.forcedYearly;
            }
        } else {
            request.payload.videoCall.totalMonthly = 0;
            request.payload.videoCall.totalYearly = 0;
            request.payload.videoCall.totalMonthlyOriginal = 0;
            request.payload.videoCall.totalYearlyOriginal = 0;
        }
        request.payload.videoCall.heading = pricing.videoCall.heading;
        request.payload.videoCall.label = pricing.videoCall.label;

        if (request.payload.audioCall && request.payload.audioCall.isIncluded && !request.payload.isFree) {
            if (request.payload.audioCall.isFree) {
                request.payload.audioCall.totalMonthly = 0;
                request.payload.audioCall.totalYearly = 0;
                request.payload.audioCall.totalMonthlyOriginal = 0;
                request.payload.audioCall.totalYearlyOriginal = 0;
            } else {
                request.payload.audioCall.totalMonthly = commonFunctions.Handlers.calculatePricing(pricing.audioCall.basePrice, request.payload.monthlyDiscount, 'monthly', request.payload.taxAmount);
                request.payload.audioCall.totalYearly = commonFunctions.Handlers.calculatePricing(pricing.audioCall.basePrice * 12, request.payload.yearlyDiscount, 'yearly', request.payload.taxAmount);
                request.payload.audioCall.totalMonthlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.audioCall.basePrice, 1, 1, 'monthly');
                request.payload.audioCall.totalYearlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.audioCall.basePrice, 1, 12, 'yearly');
            }
            if (request.payload.audioCall && request.payload.audioCall.isForcedMonthly) {
                request.payload.audioCall.totalMonthly = request.payload.audioCall.forcedMonthly;
                request.payload.audioCall.totalMonthlyOriginal = request.payload.audioCall.forcedMonthly;
            }
            if (request.payload.audioCall && request.payload.audioCall.isForcedYearly) {
                request.payload.audioCall.totalYearly = request.payload.audioCall.forcedYearly;
                request.payload.audioCall.totalYearlyOriginal = request.payload.audioCall.forcedYearly;
            }
        } else {
            request.payload.audioCall.totalMonthly = 0;
            request.payload.audioCall.totalYearly = 0;
            request.payload.audioCall.totalMonthlyOriginal = 0;
            request.payload.audioCall.totalYearlyOriginal = 0;
        }
        request.payload.audioCall.heading = pricing.audioCall.heading;
        request.payload.audioCall.label = pricing.audioCall.label;

        if (request.payload.jobsInAllLocalities && request.payload.jobsInAllLocalities.isIncluded && !request.payload.isFree) {
            if (request.payload.jobsInAllLocalities.isFree) {
                request.payload.jobsInAllLocalities.totalMonthly = 0;
                request.payload.jobsInAllLocalities.totalYearly = 0;
                request.payload.jobsInAllLocalities.totalMonthlyOriginal = 0;
                request.payload.jobsInAllLocalities.totalYearlyOriginal = 0;
            } else {
                request.payload.jobsInAllLocalities.totalMonthly = commonFunctions.Handlers.calculatePricing(pricing.jobsInAllLocalities.basePrice, request.payload.monthlyDiscount, 'monthly', request.payload.taxAmount);
                request.payload.jobsInAllLocalities.totalYearly = commonFunctions.Handlers.calculatePricing(pricing.jobsInAllLocalities.basePrice * 12, request.payload.yearlyDiscount, 'yearly', request.payload.taxAmount);
                request.payload.jobsInAllLocalities.totalMonthlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.jobsInAllLocalities.basePrice, 1, 1, 'monthly');
                request.payload.jobsInAllLocalities.totalYearlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.jobsInAllLocalities.basePrice, 1, 12, 'yearly');
            }
            if (request.payload.jobsInAllLocalities && request.payload.jobsInAllLocalities.isForcedMonthly) {
                request.payload.jobsInAllLocalities.totalMonthly = request.payload.jobsInAllLocalities.forcedMonthly;
                request.payload.jobsInAllLocalities.totalMonthlyOriginal = request.payload.jobsInAllLocalities.forcedMonthly;
            }
            if (request.payload.jobsInAllLocalities && request.payload.jobsInAllLocalities.isForcedYearly) {
                request.payload.jobsInAllLocalities.totalYearly = request.payload.jobsInAllLocalities.forcedYearly;
                request.payload.jobsInAllLocalities.totalYearlyOrigin = request.payload.jobsInAllLocalities.forcedYearly;
            }
        } else {
            request.payload.jobsInAllLocalities.totalMonthly = 0;
            request.payload.jobsInAllLocalities.totalYearly = 0;
            request.payload.jobsInAllLocalities.totalMonthlyOriginal = 0;
            request.payload.jobsInAllLocalities.totalYearlyOriginal = 0;
        }
        request.payload.jobsInAllLocalities.heading = pricing.jobsInAllLocalities.heading;
        request.payload.jobsInAllLocalities.label = pricing.jobsInAllLocalities.label;

        if (request.payload.showOnline && request.payload.showOnline.isIncluded && !request.payload.isFree) {
            if (!request.payload.showOnline.isFree) {
                request.payload.showOnline.totalMonthly = commonFunctions.Handlers.calculatePricing(pricing.showOnline.basePrice, request.payload.monthlyDiscount, 'monthly', request.payload.taxAmount);
                request.payload.showOnline.totalYearly = commonFunctions.Handlers.calculatePricing(pricing.showOnline.basePrice * 12, request.payload.yearlyDiscount, 'yearly', request.payload.taxAmount);
                request.payload.showOnline.totalMonthlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.showOnline.basePrice, 1, 1, 'monthly');
                request.payload.showOnline.totalYearlyOriginal = commonFunctions.Handlers.calculateOriginalPrice(pricing.showOnline.basePrice, 1, 12, 'yearly');
            } else {
                request.payload.showOnline.totalMonthlyOriginal = 0;
                request.payload.showOnline.totalYearlyOriginal = 0;
            }
            if (request.payload.showOnline && request.payload.showOnline.isForcedMonthly) {
                request.payload.showOnline.totalMonthly = request.payload.showOnline.forcedMonthly;
                request.payload.showOnline.totalMonthlyOriginal = request.payload.showOnline.forcedMonthly;
            }
            if (request.payload.showOnline && request.payload.showOnline.isForcedYearly) {
                request.payload.showOnline.totalYearly = request.payload.showOnline.forcedYearly;
                request.payload.showOnline.totalYearlyOriginal = request.payload.showOnline.forcedYearly;
            }
        } else {
            request.payload.showOnline.totalMonthly = 0;
            request.payload.showOnline.totalYearly = 0;
            request.payload.showOnline.totalMonthlyOriginal = 0;
            request.payload.showOnline.totalYearlyOriginal = 0;
        }
        request.payload.showOnline.heading = pricing.showOnline.heading;
        request.payload.showOnline.label = pricing.showOnline.label;

        totalMonthlyBeforeTax = request.payload.numberOfUsers.totalMonthly + request.payload.numberOfJobs.totalMonthly +
            request.payload.numberOfViews.totalMonthly + request.payload.numberOfTextTranslations.totalMonthly +
            request.payload.numberOfJobTranslations.totalMonthly + (request.payload.videoCall.isIncluded ?
                request.payload.videoCall.totalMonthly : 0) +
            (request.payload.audioCall.isIncluded ? request.payload.audioCall.totalMonthly : 0) +
            (request.payload.showOnline.isIncluded ? request.payload.showOnline.totalMonthly: 0) +
            (request.payload.jobsInAllLocalities.isIncluded ? request.payload.jobsInAllLocalities.totalMonthly: 0);
        totalMonthlyOriginal = request.payload.numberOfUsers.totalMonthlyOriginal + request.payload.numberOfJobs.totalMonthlyOriginal +
            request.payload.numberOfViews.totalMonthlyOriginal + request.payload.numberOfTextTranslations.totalMonthlyOriginal +
            request.payload.numberOfJobTranslations.totalMonthlyOriginal + (request.payload.videoCall.isIncluded ?
                request.payload.videoCall.totalMonthlyOriginal : 0) +
            (request.payload.audioCall.isIncluded ? request.payload.audioCall.totalMonthlyOriginal : 0) +
            (request.payload.showOnline.isIncluded ? request.payload.showOnline.totalMonthlyOriginal : 0) +
            (request.payload.jobsInAllLocalities.isIncluded ? request.payload.jobsInAllLocalities.totalMonthlyOriginal : 0);

        totalMonthlyBeforeTax = parseFloat(totalMonthlyBeforeTax.toFixed(2));
        request.payload.totalMonthlyOriginal = parseFloat(totalMonthlyOriginal.toFixed(2));


        totalYearlyBeforeTax = request.payload.numberOfUsers.totalYearly + request.payload.numberOfJobs.totalYearly + request.payload.numberOfViews.totalYearly + request.payload.numberOfTextTranslations.totalYearly +
            request.payload.numberOfJobTranslations.totalYearly + (request.payload.videoCall.isIncluded ? request.payload.videoCall.totalYearly : 0) +
            (request.payload.audioCall.isIncluded ? request.payload.audioCall.totalYearly : 0) + (request.payload.showOnline.isIncluded ? request.payload.showOnline.totalYearly: 0) +
            (request.payload.jobsInAllLocalities.isIncluded ? request.payload.jobsInAllLocalities.totalYearly: 0);

        totalYearlyOriginal = request.payload.numberOfUsers.totalYearlyOriginal + request.payload.numberOfJobs.totalYearlyOriginal + request.payload.numberOfViews.totalYearlyOriginal +
            request.payload.numberOfTextTranslations.totalYearlyOriginal +
            request.payload.numberOfJobTranslations.totalYearlyOriginal + (request.payload.videoCall.isIncluded ? request.payload.videoCall.totalYearlyOriginal : 0) +
            (request.payload.audioCall.isIncluded ? request.payload.audioCall.totalYearlyOriginal : 0) + (request.payload.showOnline.isIncluded ? request.payload.showOnline.totalYearlyOriginal: 0) +
            (request.payload.jobsInAllLocalities.isIncluded ? request.payload.jobsInAllLocalities.totalYearlyOriginal: 0);
        request.payload.totalYearlyOriginal = parseFloat(totalYearlyOriginal.toFixed(2));

        if (request.payload.packageDiscount) {
            totalYearlyBeforeTax = (totalYearlyBeforeTax * (1 - (request.payload.packageDiscount / 100)));
            totalMonthlyBeforeTax = (totalMonthlyBeforeTax * (1 - (request.payload.packageDiscount / 100)));
        }

        request.payload.totalMonthlyBeforeTax = parseFloat(totalMonthlyBeforeTax.toFixed(2));
        request.payload.totalYearlyBeforeTax = parseFloat(totalYearlyBeforeTax.toFixed(2));

        totalMonthly = parseFloat((totalMonthlyBeforeTax * (1 + (request.payload.taxAmount / 100))).toFixed(2));
        totalYearly = parseFloat((totalYearlyBeforeTax * (1 + (request.payload.taxAmount / 100))).toFixed(2));

        request.payload.totalMonthly = totalMonthly;
        request.payload.totalYearly = totalYearly;
        request.payload.monthlyDiscountAmount = parseFloat(((request.payload.totalMonthlyOriginal) * (request.payload.monthlyDiscount / 100)).toFixed(2));
        request.payload.yearlyDiscountAmount = parseFloat(((request.payload.totalYearlyOriginal) * (request.payload.yearlyDiscount / 100)).toFixed(2));
        request.payload.packageDiscountMonthlyAmount = parseFloat(((request.payload.totalMonthlyOriginal - request.payload.monthlyDiscountAmount) * (request.payload.packageDiscount / 100)).toFixed(2));
        request.payload.packageDiscountYearlyAmount = parseFloat(((request.payload.totalYearlyOriginal - request.payload.yearlyDiscountAmount) * (request.payload.packageDiscount / 100)).toFixed(2));

        if (!request.payload.isFree) {
            monthPlan = await razorPay.Handler.createPlan('monthly', 1, request.payload.packageName, 'Monthly plan created at ' + new Date().toISOString(), totalMonthly * 100, pricing.currency, {});
            if (monthPlan.statusCode && monthPlan.statusCode !== 200) {
                return h.response(responseFormatter.responseFormatter({}, monthPlan.error.error.description, 'error', monthPlan.statusCode)).code(monthPlan.statusCode);
            }
            request.payload.planIdMonthly = monthPlan.id;

            annualPlan = await razorPay.Handler.createPlan('yearly', 1, request.payload.packageName, 'Yearly plan created at ' + new Date().toISOString(), totalYearly * 100, pricing.currency, {});
            if (annualPlan.statusCode && annualPlan.statusCode !== 200) {
                return h.response(responseFormatter.responseFormatter({}, annualPlan.error.error.description, 'error', annualPlan.statusCode)).code(annualPlan.statusCode);
            }
            request.payload.planIdAnnually = annualPlan.id;
        }
    }

/*    /!*
    * Save package details in database
    * *!/
    try {
        pack = await new packageSchema.packageSchema(request.payload).save();
    } catch (e) {
        logger.error('Error occurred in saving plan data in create plan handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /!* Make the current package as inactive *!/
    if (request.payload.packageId) {
        try {
            await packageSchema.packageSchema.findByIdAndUpdate({_id: request.payload.packageId}, {$set: {isActive: false, replacedPackageId: pack._id}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in updating old package data in create plan handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }*/

    if (request.payload.packageId) {
        /* Make the current package as inactive */
        try {
            await packageSchema.packageSchema.findByIdAndUpdate({_id: request.payload.packageId}, request.payload, {lean: true});
        } catch (e) {
            logger.error('Error occurred in updating old package data in create plan handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        /*
        * Get color codes and assign randomly to the package
        * */
        let colorCodes = [], randomNumber;
        try {
            colorCodes = await internalParameterSchema.internalParameterSchema.findOne({}, {colorCodes: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding color codes from internal parameters in create plan handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (colorCodes && colorCodes.colorCodes.length) {
            randomNumber = Math.floor(Math.random() * colorCodes.colorCodes.length);
            request.payload.colorCode = colorCodes.colorCodes[randomNumber];
        }


        /*
        * Save package details in database
        * */
        try {
            await new packageSchema.packageSchema(request.payload).save();
        } catch (e) {
            logger.error('Error occurred in saving plan data in create plan handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Save this information in audit collection */
    const auditDataToSave = {
        type: 'package',
        updatedBy: mongoose.Types.ObjectId(request.payload.adminId),
        data: request.payload
    };

    try {
        await new auditSchema.auditSchema(auditDataToSave).save();
    } catch (e) {
        logger.error('Error occurred in saving audit data in create plan handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return request.payload.packageId ?
        h.response(responseFormatter.responseFormatter({}, 'Package updated', 'success', 204)).code(200) : h.response(responseFormatter.responseFormatter({}, 'Package created', 'success', 201)).code(200);
};

handlers.getActivePackages = async (request, h) => {
    let packages;

    /* Get list of all active packages */
    try {
        packages = await packageSchema.packageSchema.find({country: request.query.country, isCustom: {$ne: true}}, {planIdMonthly: 0, planIdAnnually: 0}, {lean: true}).sort({_id: -1});
    } catch (e) {
        logger.error('Error occurred in fetching packages data in get active packages handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter(packages, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.changePackageStatus = async (request, h) => {
    let decoded, checkAdmin, pack;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in change package status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in change package status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Update package information */
    try {
        pack = await packageSchema.packageSchema.findByIdAndUpdate({_id: request.payload.packageId}, {$set: {isActive: request.payload.isActive}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in updating package data in change package status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!pack) {
        return h.response(responseFormatter.responseFormatter({}, 'Package not found', 'error', 404)).code(404);
    }

    return h.response(responseFormatter.responseFormatter({}, 'Package updated successfully', 'success', 201)).code(200);
};

handlers.addLanguage = async (request, h) => {
    let decoded, checkAdmin, checkLanguage, countries, states = [], checkRank;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in add language handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in add language handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    if (request.payload.language.toLowerCase() === 'en') {
        request.payload.rank = 1;
    } else if ((request.payload.language.toLowerCase() === 'hi') && (request.payload.country.toLowerCase() === 'in')) {
        request.payload.rank = 2;
    }

    /*
    * Check if rank is already assigned to other language for the given country
    * */
    if (request.payload.languageId) {
        try {
            checkRank = await languageSchema.languageSchema.findOne({country: request.payload.country, rank: request.payload.rank, _id: {$ne: mongoose.Types.ObjectId(request.payload.languageId)}}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in getting language data for rank in add language handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        try {
            checkRank = await languageSchema.languageSchema.findOne({country: request.payload.country, rank: request.payload.rank}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in getting language data for rank in add language handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    if (checkRank) {
        return h.response(responseFormatter.responseFormatter({}, 'Language already exists for the given rank', 'error', 409)).code(409);
    }

    /*
    * Assign all the states if the language is english
    * */
    if (request.payload.language.toLowerCase() === 'en') {
        countries = csc.getAllCountries();
        const idx = countries.findIndex(k => k.sortname.toLowerCase() === request.payload.country.toLowerCase());
        if (idx !== -1) {
            const countryId = countries[idx].id;
            const s = csc.getStatesOfCountry(countryId);
            s.forEach((state) => {
                states.push(state.name);
            });
            request.payload.states = states;
        }
    } else if ((request.payload.language.toLowerCase() === 'hi') && (request.payload.country.toLowerCase() === 'in')) {
        countries = csc.getAllCountries();
        const idx = countries.findIndex(k => k.sortname.toLowerCase() === 'in');
        if (idx !== -1) {
            const countryId = countries[idx].id;
            const s = csc.getStatesOfCountry(countryId);
            s.forEach((state) => {
                states.push(state.name);
            });
            request.payload.states = states;
        }
    } else {
        countries = csc.getAllCountries();
        const idx = countries.findIndex(k => k.sortname.toLowerCase() === request.payload.country.toLowerCase());
        if (idx !== -1) {
            const countryId = countries[idx].id;
            const s = csc.getStatesOfCountry(countryId);
            s.forEach((state) => {
                states.push(state.name);
            });
            request.payload.states = states;
        }
    }

    /*
    * Save the language data in database
    * */
    if (request.payload.languageId) {
        try {
            await languageSchema.languageSchema.findByIdAndUpdate({_id: request.payload.languageId}, {$set: request.payload}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in updating language data in add language handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
    } else {
        try {
            await new languageSchema.languageSchema(request.payload).save();
        } catch (e) {
            logger.error('Error occurred in saving language data in add language handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    return h.response(responseFormatter.responseFormatter({}, 'Language added', 'success', 201)).code(200);
};

handlers.removeLanguage = async (request, h) => {
    let decoded, checkAdmin;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in remove language handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in remove language handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Remove language from the database */
    try {
        await languageSchema.languageSchema.findByIdAndRemove({_id: request.payload.languageId});
    } catch (e) {
        logger.error('Error occurred in removing language data in remove language handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Language removed successfully', 'success', 204)).code(200);
};

handlers.languageScript = async (request, h) => {

    try {
        await updateLanguageScript.updateLanguageScript();
    } catch (e) {
        console.log(e);
    }

    return h.response(responseFormatter.responseFormatter({}, 'Updated', 'success', 204)).code(200);
};

handlers.translatePrePopulatedMessages = async (request, h) => {
    let decoded, checkAdmin, languages;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in translate prepopulated message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in translate prepopulated message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Fetch list of all languages which are in inChatLanguage */
    try {
        languages = await languageSchema.languageSchema.find({inChatLanguage: true}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting languages data in translate prepopulated message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < languages.length; i++) {
        let isPresent;
        try {
            isPresent = await chatSuggestionSchema.chatSuggestionSchema.find({language: languages[i].language}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in getting chat suggestion data in translate prepopulated message handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!isPresent.length) {
            let chatSuggestion;
            try {
                chatSuggestion = await chatSuggestionSchema.chatSuggestionSchema.find({language: 'en'}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in getting chat suggestion data in translate prepopulated message handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (chatSuggestion.length) {
                for (let j = 0; j < chatSuggestion.length; j++) {
                    let messages = [];
                    /* Translate the message in given language */
                    chatSuggestion[j].language = languages[i].language;
                    for (let k = 0; k < chatSuggestion[j].messages.length; k++) {
                        const message = await commonFunctions.Handlers.translate(chatSuggestion[j].messages[k].message, 'en', languages[i].language);
                        if (message && message.translatedText) {
                            messages.push({message: message.translatedText});
                        }
                    }
                    chatSuggestion[j].messages = messages;
                    delete chatSuggestion[j]._id;
                    delete chatSuggestion[j].__v;
                    delete chatSuggestion[j].createdAt;
                    delete chatSuggestion[j].updatedAt;
                    /* Save into database */
                    try {
                        await new chatSuggestionSchema.chatSuggestionSchema(chatSuggestion[j]).save();
                    } catch (e) {
                        logger.error('Error occurred in saving chat suggestion data in translate prepopulated message handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }
            }
        }
    }

    return h.response(responseFormatter.responseFormatter({}, 'Translation success', 'success', 200)).code(200);
};

handlers.setDisplayLocation = async (request, h) => {
    let jobs;

    try {
        jobs = await jobSchema.jobSchema.find({}, {location: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding jobs data in set display location handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < jobs.length; i++) {
        const dataToUpdate = {
            'displayLocation.coordinates': [jobs[i].location.coordinates],
            isPremium: false
        };
        try {
            await jobSchema.jobSchema.findByIdAndUpdate({_id: jobs[i]._id}, {$set: dataToUpdate}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in updating jobs data in set display location handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
};

handlers.checkGST = async (request, h) => {
    let flag, verificationData;

    flag = commonFunctions.Handlers.checkGST(request.payload.gstin);
    if (!flag) {
        return h.response(responseFormatter.responseFormatter({}, 'Invalid GSTIN provided.', 'error', 400)).code(400);
    }

    try {
        verificationData = await commonFunctions.Handlers.verifyGST(request.payload.gstin);
    } catch (e) {
        logger.error('Error occurred in verifying GST number in GST verification handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (verificationData && verificationData.error) {
        return h.response(responseFormatter.responseFormatter({}, verificationData.message, 'error', 400)).code(400);
    }

    return h.response(responseFormatter.responseFormatter(verificationData, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.updateCities = async (request, h) => {
    let cities;

    try {
        cities = await citySchema.citySchema.find({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding cities in update cities handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < cities.length; i++) {
        const dataToUpdate = {
            location: {
                type: 'Point',
                coordinates: [Number(cities[i].longitude), Number(cities[i].latitude)]
            }
        };
        try {
            await citySchema.citySchema.findByIdAndUpdate({_id: cities[i]._id}, {$set: dataToUpdate}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in updating cities in update cities handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
}

handlers.getAllLanguages = async (request, h) => {
    const languages = require('language-list')();

    return h.response(responseFormatter.responseFormatter(languages.getData(), 'Fetched successfully', 'success', 200)).code(200);
};

handlers.getLanguages = async (request, h) => {
    let checkAdmin, languages, finalData = [];

    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in get languages handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    }

    try {
        languages = await languageSchema.languageSchema.find({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting language data in get languages handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < languages.length; i++) {
        const idx = finalData.findIndex(k => k.country === languages[i].country);
        if (idx === -1) {
            finalData.push({
                country: languages[i].country,
                languages: [
                    {
                        _id: languages[i]._id,
                        name: languages[i].name,
                        nameT: languages[i].nameT,
                        language: languages[i].language,
                        inProfile: languages[i].inProfile,
                        inAppLanguage: languages[i].inAppLanguage,
                        inChatLanguage: languages[i].inChatLanguage,
                        rank: languages[i].rank
                    }
                ]
            })
        } else {
            finalData[idx].languages.push({
                _id: languages[i]._id,
                name: languages[i].name,
                nameT: languages[i].nameT,
                language: languages[i].language,
                inProfile: languages[i].inProfile,
                inAppLanguage: languages[i].inAppLanguage,
                inChatLanguage: languages[i].inChatLanguage,
                rank: languages[i].rank
            });
        }
    }

    return h.response(responseFormatter.responseFormatter(finalData, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.getPricingInformation = async (request, h) => {
    let checkAdmin, decoded, pricingData;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in get pricing information handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in get pricing information handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.query.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Fetch pricing information according to country */
    try {
        pricingData = await pricingSchema.pricingSchema.findOne({country: request.query.country}, {createdAt: 0, updatedAt: 0, __v: 0}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting pricing data in get pricing information handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter(pricingData, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.sendWhatsapp = async (request, h) => {
    let status = await commonFunctions.Handlers.sendWhatsAppSMS(request.payload.countryCode, request.payload.phone, request.payload.text);
    console.log(status);
    if (status === 'error') {
        logger.error('Error occurred in sending sms to employer %s:', JSON.stringify(status));
    }
    return h.response(responseFormatter.responseFormatter({}, 'Message sent on whatsapp', 'success', 200)).code(200);
};

handlers.getEmployerSubscription = async (request, h) => {
    let checkAdmin, decoded, checkUser, searchCriteria, checkSubscription, dataToReturn = {
        firstName: '',
        lastName: '',
        companyName: '',
        phone: '',
        email: '',
        companyAddress: {},
        numberOfJobs: 0,
        numberOfUsers: 0,
        numberOfViews: 0,
        numberOfTextTranslations: 0,
        numberOfJobTranslations: 0,
        unitPrice: {
            numberOfJobs: 0,
            numberOfUsers: 0,
            numberOfViews: 0,
            numberOfTextTranslations: 0,
            numberOfJobTranslations: 0
        },
        extras: [],
        subscriptionId: ''
    }, pricing, checkPackage;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in get employer subscription information handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in get employer subscription information handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.query.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check if user exists */
    if (request.query.email) {
        searchCriteria = {
            email: new RegExp('^' + request.query.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')
        };
    } else {
        searchCriteria = {
            'employerInformation.companyPhone': request.query.phone
        };
    }

    try {
        checkUser = await userSchema.UserSchema.findOne(searchCriteria, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting user data in get employer subscription information handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found.', 'error', 404)).code(404);
    }

    dataToReturn.firstName = checkUser.firstName;
    dataToReturn.lastName = checkUser.lastName;
    dataToReturn.email = checkUser.email;
    dataToReturn.companyName = checkUser.employerInformation.companyName;
    dataToReturn.companyAddress = checkUser.employerInformation.companyAddress;
    dataToReturn.phone = checkUser.employerInformation.companyPhone;

    /* Check if any active subscriptions for the employer */
    try {
        checkSubscription = await subscriptionSchema.subscriptionSchema.findOne({userId: checkUser._id, isActive: true, isFree: false}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting subscription data in get employer subscription information handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkSubscription) {
        return h.response(responseFormatter.responseFormatter({}, 'No active subscriptions.', 'error', 404)).code(404);
    }

    /* Get the package information */
    try {
        checkPackage = await packageSchema.packageSchema.findById({_id: checkSubscription.packageId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting package data in get employer subscription information handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkPackage) {
        return h.response(responseFormatter.responseFormatter({}, 'No such package found.', 'error', 404)).code(404);
    }

    /* Get the pricing information for unit prices */
    try {
        pricing = await pricingSchema.pricingSchema.findOne({country: checkPackage.country}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting pricing data in get employer subscription information handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!pricing) {
        return h.response(responseFormatter.responseFormatter({}, 'No unit prices found.', 'error', 404)).code(404);
    }

    dataToReturn.unitPrice.numberOfJobs = pricing.numberOfJobs.basePrice / pricing.numberOfJobs.count;
    dataToReturn.unitPrice.numberOfViews = pricing.numberOfViews.basePrice / pricing.numberOfViews.count;
    dataToReturn.unitPrice.numberOfJobTranslations = pricing.numberOfJobTranslations.basePrice / pricing.numberOfJobTranslations.count;
    dataToReturn.unitPrice.numberOfTextTranslations = pricing.numberOfTextTranslations.basePrice / pricing.numberOfTextTranslations.count;
    dataToReturn.unitPrice.numberOfUsers = pricing.numberOfUsers.basePrice / pricing.numberOfUsers.count;
    dataToReturn.numberOfUsers = checkSubscription.numberOfUsers.isIncluded ? checkSubscription.numberOfUsers.count : 0;
    dataToReturn.numberOfJobs = checkSubscription.numberOfJobs.isIncluded ? checkSubscription.numberOfJobs.count : 0;
    dataToReturn.numberOfViews = checkSubscription.numberOfViews.isIncluded ? checkSubscription.numberOfViews.count : 0;
    dataToReturn.numberOfJobTranslations = checkSubscription.numberOfJobTranslations.isIncluded ? checkSubscription.numberOfJobTranslations.count : 0;
    dataToReturn.numberOfTextTranslations = checkSubscription.numberOfTextTranslations.isIncluded ? checkSubscription.numberOfTextTranslations.count : 0;
    dataToReturn.extras = checkSubscription.extras ? checkSubscription.extras : [];
    dataToReturn.subscriptionId = checkSubscription._id;

    /* Success */
    return h.response(responseFormatter.responseFormatter(dataToReturn, 'Fetched successfully', 'success', 200)).code(200);
}

handlers.upgradeEmployerSubscription = async (request, h) => {
    let checkAdmin, decoded, checkSubscription, dataToUpdate;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in upgrade employer subscription information handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in upgrade employer subscription information handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check if subscription exists */
    try {
        checkSubscription = await subscriptionSchema.subscriptionSchema.findById({_id: request.payload.subscriptionId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting subscription data in upgrade employer subscription information handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkSubscription) {
        return h.response(responseFormatter.responseFormatter({}, 'No subscription found.', 'error', 404)).code(404);
    } else if (!checkSubscription.isActive || checkSubscription.isFree) {
        return h.response(responseFormatter.responseFormatter({}, 'Invalid subscription.', 'error', 400)).code(400);
    }

    /* Check if payment ID is valid */
    const data = request.payload.paymentId.split('pay_');
    if (data.length !== 2) {
        return h.response(responseFormatter.responseFormatter({}, 'Please provide valid payment ID.', 'error', 400)).code(400);
    }

    dataToUpdate = {
        numberOfJobs: request.payload.numberOfJobs,
        numberOfUsers: request.payload.numberOfUsers,
        numberOfViews: request.payload.numberOfViews,
        numberOfTextTranslations: request.payload.numberOfTextTranslations,
        numberOfJobTranslations: request.payload.numberOfJobTranslations,
        createdBy: checkAdmin.firstName + ' ' + checkAdmin.lastName,
        paymentId: request.payload.paymentId,
        payment: request.payload.payment,
        note: request.payload.note,
        createdAt: new Date()
    };

    const update = {
        $inc: {
            'numberOfJobs.count': request.payload.numberOfJobs,
            'numberOfUsers.count': request.payload.numberOfUsers,
            'numberOfViews.count': request.payload.numberOfViews,
            'numberOfTextTranslations.count': request.payload.numberOfTextTranslations,
            'numberOfJobTranslations.count': request.payload.numberOfJobTranslations
        },
        $push: {
            extras: dataToUpdate
        }
    };

    /* Update subscription */
    try {
        await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkSubscription._id}, update, {lean: true});
    } catch (e) {
        logger.error('Error occurred in updating subscription data in upgrade employer subscription information handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
};

handlers.createCommunity = async (request, h) => {
    let checkAdmin, decoded, membershipToAdd = {}, userDataToSave = {
        email: request.payload.email,
        firstName: request.payload.firstName,
        lastName: request.payload.lastName ? request.payload.lastName : '',
        isUniversity: !!request.payload.isUniversity,
        isConsulting: !!request.payload.isConsulting,
        isNonProfit: !!request.payload.isNonProfit,
        isTraining: !!request.payload.isTraining,
        country: request.payload.country,
        isOrganization: true,
        membership: '',
        isPaAdmin: true,
        companyEmailRequired: !!request.payload.companyEmailRequired,
        roles: ['Employer'],
        employerInformation: {
            companyName: request.payload.membership,
            companyProfilePhoto: '',
            companyAddress: request.payload.address,
            country: request.payload.country,
            companyLocation: {
                type: 'Point',
                coordinates: [Number(request.payload.longitude), Number(request.payload.latitude)]
            },
            website: request.payload.website
        },
        employeeInformation: {
            country: request.payload.country,
            address: request.payload.address,
            location: {
                type: 'Point',
                coordinates: [Number(request.payload.longitude), Number(request.payload.latitude)]
            },
            preferredLocations: {
                type: 'MultiPoint',
                coordinates: [[Number(request.payload.longitude), Number(request.payload.latitude)]]
            },
            preferredLocationCities: [
                {
                    city: request.payload.address.city,
                    state: request.payload.address.state,
                    country: request.payload.country,
                    latitude: Number(request.payload.latitude),
                    longitude: Number(request.payload.longitude)
                }
            ]
        }
    }, checkUser;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in create community handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in create community handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check if the user with the given email already exists */
    try {
        checkUser = await userSchema.UserSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in checking user data in create community handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'An account with the given email already exists.', 'error', 409)).code(409);
    }

    membershipToAdd = {
        _id: mongoose.Types.ObjectId(),
        name: request.payload.membership,
        logo: '',
        country: 'US'
    };

    userDataToSave.membership = membershipToAdd._id;
    const tempPassword = commonFunctions.Handlers.generatePassword();

    /* Save into constant */
    try {
        await constantSchema.constantSchema.findOneAndUpdate({}, {$addToSet: {memberships: membershipToAdd}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in updating constant data in create community handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Create user */
    let admin = new userSchema.UserSchema(userDataToSave);
    admin.password = tempPassword;
    admin.tempPassword = tempPassword;

    if (request.payload.companyLogo) {
        let imageName;
        /* Upload image to s3 bucket */
        try {
            imageName = await commonFunctions.Handlers.uploadImage(request.payload.companyLogo.path, request.payload.companyLogo.filename);
        } catch (e) {
            logger.error('Error occurred while uploading company image in create community handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (imageName) {
            admin.employerInformation.companyProfilePhoto = imageName;
        }
    }

    /* Send email */
    let email = {
        to: [{
            email: request.payload.email,
            type: 'to'
        }],
        important: true,
        merge: true,
        inline_css: true,
        subject: 'Welcome to EZJobs Community Administrator (EZCA)',
        merge_language: 'mailchimp',
        merge_vars: [{
            rcpt: request.payload.email,
            vars: [
                {
                    name: 'email',
                    content: request.payload.email
                },
                {
                    name: 'password',
                    content: tempPassword
                },
                {
                    name: 'downloadURL',
                    content: 'https://ca.ezjobs.io'
                },
                {
                    name: 'fname',
                    content: request.payload.firstName
                }
            ]
        }]
    };
    await mandrill.Handlers.sendTemplate('ezca-admin-welcome', [], email, true);

    try {
        await admin.save();
    } catch (e) {
        logger.error('Error occurred in saving user data in create community handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Created successfully.', 'success', 201)).code(201);
};

handlers.getCommunities = async (request, h) => {
    let checkAdmin, decoded, communities, constantData;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in get communities handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in get communities handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.query.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get communities */
    try {
        communities = await userSchema.UserSchema.find({isPaAdmin: true, isMaster: true}, {email: 1, firstName: 1, lastName: 1, membership: 1, employerInformation: 1, isUniversity: 1, isConsulting: 1, isOrganization: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting community data in get communities handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get constant data */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {memberships: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting constant data in get communities handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < communities.length; i++) {
        const idx = constantData.memberships.findIndex(k => k._id.toString() === communities[i].membership);
        if (idx !== -1) {
            communities[i].membership = constantData.memberships[idx].name;
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(communities, 'Fetched successfully.', 'success', 200)).code(200);
};

handlers.updateMenuConfig = async (request, h) => {
    let checkAdmin, decoded;

    /* Check if admin is allowed to perform this action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred in decoding token in update menu config handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting admin data in update menu config handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Admin not found', 'error', 404)).code(404);
    } else if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Update menu configuration */
    let dataToUpdate = {
        menus: request.payload.menus
    }

    try {
        await menuConfigSchema.menuConfigSchema.findOneAndUpdate({platform: request.payload.platform, type: request.payload.type}, {$set: dataToUpdate}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in updating menu config data in update menu config handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully.', 'success', 204)).code(200);
};

handlers.getMenuConfig = async (request, h) => {
    let menuConfig;

    try {
        menuConfig = await menuConfigSchema.menuConfigSchema.findOne({platform: request.query.platform, type: request.query.type}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in fetching menu config data in get menu config handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(menuConfig, 'Fetched successfully.', 'success', 200)).code(200);
};

handlers.uploadLastWeekDataBulk = async (request, h) => {
    let users;

    try {
        users = await userSchema.UserSchema.find({isAddedByBulkUpload: true, createdAt: {$gte: new Date('2020-12-14T05:00:00.000Z'), $lt: new Date('2020-12-21T05:00:00.000Z')}}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in fetching bulk uploaded users data in uploadLastWeekDataBulk handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Loop through this array to upload data on to hubspot */
    for (let i = 0; i < users.length; i++) {
        /*let statusHub = await commonFunctions.Handlers.createHubSpotContactEmployer(users[i].firstName, users[i].lastName, users[i].email, countryList.getName(users[i].employeeInformation.country), '', '', 'customer', users[i].employeeInformation.address.city, users[i].employeeInformation.address.state, users[i].employerInformation.companyPhone, users[i].employerInformation.companyName, '', 'newspaper', '');
        if (statusHub === 'error') {
            logger.error('Error occurred while creating hub spot contact');
        }*/

        /* Get job of this user */
       /* let checkJob;
        try {
            checkJob = await jobSchema.jobSchema.findOne({userId: mongoose.Types.ObjectId(users[i]._id)}, {_id: 1, jobTitle: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in fetching bulk uploaded users job data in uploadLastWeekDataBulk handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }*/

        /*if (checkJob) {
            let jobsData = [], hubSpotProperties = [];
            const shortLinkJob = await commonFunctions.Handlers.createFirebaseShortLink('', checkJob._id, '', '', '', '', '', '', '');
            jobsData.push(checkJob.jobTitle + ' : ' + shortLinkJob.shortLink + '. ');

            hubSpotProperties.push({
                property: 'job_posted_by_employer',
                value: jobsData.toString()
            });

            let statusEmployer = await commonFunctions.Handlers.updateHubSpotContactEmployer(users[i].email, hubSpotProperties);
            if (statusEmployer === 404) {
                console.log('HubSpot contact not found');
            }
        }*/
        let hubSpotProperties = [];
        hubSpotProperties.push({
            property: 'isbulkupload',
            value: true
        });

        let statusEmployer = await commonFunctions.Handlers.updateHubSpotContactEmployer(users[i].email, hubSpotProperties);
        if (statusEmployer === 404) {
            console.log('HubSpot contact not found');
        }

    }
};

handlers.blockUserUpdate = async (request, h) => {
    let users;

    /* Find users where blockedBy parameter is not empty array */
    try {
        users = await userSchema.UserSchema.find({blockedBy: {$ne: []}}, {_id: 1, blockedBy: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in fetching users data in block user update handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    const len = users.length;

    for (let i = 0; i < len; i++) {
        /* Save data into new collection */
        for (let j = 0; j < users[i].blockedBy.length; j++) {
            const dataToSave = {
                userId: users[i].blockedBy[j],
                blockedUserId: users[i]._id,
                blockReason: ''
            };

            try {
                await new blockUserSchema.blockSchema(dataToSave).save();
            } catch (e) {
                logger.error('Error occurred in saving blocked users data in block user update handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Operation successful.', 'success', 200)).code(200);
};

handlers.reportUserUpdate = async (request, h) => {
    let users;

    /* Find users where reportedBy parameter is not empty array */
    try {
        users = await userSchema.UserSchema.find({reportedBy: {$ne: []}}, {_id: 1, reportedBy: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in fetching users data in report user update handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    const len = users.length;

    for (let i = 0; i < len; i++) {
        /* Save data into new collection */
        for (let j = 0; j < users[i].reportedBy.length; j++) {
            const dataToSave = {
                userId: users[i].reportedBy[j],
                reportedUserId: users[i]._id,
                reportReason: ''
            };

            try {
                await new reportUserSchema.reportUserSchema(dataToSave).save();
            } catch (e) {
                logger.error('Error occurred in saving reported users data in report user update handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Operation successful.', 'success', 200)).code(200);
};

handlers.reportJobUpdate = async (request, h) => {
    let jobs;

    /* Find jobs where reportedBy parameter is not empty array */
    try {
        jobs = await jobSchema.jobSchema.find({reportedBy: {$ne: []}}, {_id: 1, reportedBy: 1, reportReason: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in fetching jobs data in report user update handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    const len = jobs.length;

    for (let i = 0; i < len; i++) {
        /* Save data into new collection */
        for (let j = 0; j < jobs[i].reportedBy.length; j++) {
            const dataToSave = {
                userId: jobs[i].reportedBy[j],
                jobId: jobs[i]._id,
                reportReason: jobs[i].reportReason[j] ? jobs[i].reportReason[j] : ''
            };

            try {
                await new reportJobSchema.reportJobSchema(dataToSave).save();
            } catch (e) {
                logger.error('Error occurred in saving reported jobs data in report job update handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Operation successful.', 'success', 200)).code(200);
};

handlers.uptimeWebhook = async (request, h) => {
    console.log(request.query);

    return h.response().code(200);
}

handlers.updateUserCounter = async (request, h) => {
    let users, counter = 1;

    try {
        users = await userSchema.UserSchema.find({}, {_id: 1, systemGeneratedId: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding all users in update user counter handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < users.length; i++) {
        if (!users[i].systemGeneratedId) {
            try {
                await userSchema.UserSchema.findByIdAndUpdate({_id: users[i]._id}, {$set: {systemGeneratedId: counter}});
            } catch (e) {
                logger.error('Error occurred in updating user in update user counter handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
        counter++;
    }

    return h.response(responseFormatter.responseFormatter({}, 'Success', 'success', 200)).code(200);
};

handlers.updateJobCounter = async (request, h) => {
    let jobs, counter = 1;

    try {
        jobs = await jobSchema.jobSchema.find({}, {_id: 1, systemGeneratedId: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding all jobs in update job counter handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < jobs.length; i++) {
        if (!jobs[i].systemGeneratedId) {
            try {
                await jobSchema.jobSchema.findByIdAndUpdate({_id: jobs[i]._id}, {$set: {systemGeneratedId: counter}});
            } catch (e) {
                logger.error('Error occurred in updating job in update user counter handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            counter++;
        }
    }

    return h.response(responseFormatter.responseFormatter({}, 'Success', 'success', 200)).code(200);
};

handlers.updateFreeJobs = async (request, h) => {
    let jobs, bulkJobOperations = [], freePackage = {}, userData;

    try {
        jobs = await jobSchema.jobSchema.find({isArchived: false, isVisible: true}, {userId: 1, country: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding jobs in update free jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    const len = jobs.length;
    for (let i = 0; i < len; i++) {
        if (freePackage[jobs[i].country]) {
            try {
                userData = await userSchema.UserSchema.findById({_id: jobs[i].userId}, {subscriptionInfo: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in finding user in update free jobs handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if (userData) {
                if (!userData.subscriptionInfo) {
                    bulkJobOperations.push(await jobSchema.jobSchema.findByIdAndUpdate({_id: jobs[i]._id}, {$set: {isFree: true}}, {lean: true}));
                } else {
                    if (userData.subscriptionInfo.packageId.toString() === freePackage[jobs[i].country]._id.toString()) {
                        bulkJobOperations.push(await jobSchema.jobSchema.findByIdAndUpdate({_id: jobs[i]._id}, {$set: {isFree: true}}, {lean: true}));
                    } else {
                        bulkJobOperations.push(await jobSchema.jobSchema.findByIdAndUpdate({_id: jobs[i]._id}, {$set: {isFree: false}}, {lean: true}));
                    }
                }
            }
        } else {
            try {
                freePackage[jobs[i].country] = await packageSchema.packageSchema.findOne({country: jobs[i].country, isFree: true, isActive: true}, {_id: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in finding package in update free jobs handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }

    /* Run operations in bulk */
    try {
        await Promise.all(bulkJobOperations);
    } catch (e) {
        logger.error('Error occurred in running bulk job update operations in update free jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Operation successful.', 'success', 200)).code(200);
};

handlers.verifyCompany = async (request, h) => {
    let checkAdmin, checkUser, verificationData, templateName, masterUser, addedUsers;

    /* Check if Admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding admin info in verify company handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding user info in verify company handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user found', 'error', 404)).code(404);
    }
    if (checkUser.isMaster) {
        checkUser.slaveUsers.push(checkUser._id);
        addedUsers = checkUser.slaveUsers;
    } else {
        try {
            masterUser = await userSchema.UserSchema.findOne({slaveUsers: checkUser._id}, {
                _id: 1,
                slaveUsers: 1
            }, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding master user info in verify company handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        masterUser.slaveUsers.push(masterUser._id);
        addedUsers = masterUser.slaveUsers;
    }

    /* Get the verification data if exists */
    try {
        verificationData = await companyVerificationSchema.companyVerificationSchema.findOne({userId: mongoose.Types.ObjectId(request.payload.userId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding verification info in verify company handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!verificationData) {
        return h.response(responseFormatter.responseFormatter({}, 'No documents to verify.', 'error', 404)).code(404);
    }

    /* Verify the data */
    const dataToUpdate = {
        status: request.payload.status,
        additionalNotes: request.payload.additionalNotes ? request.payload.additionalNotes : '',
        verifiedBy: request.payload.adminId,
        documents: request.payload.status === 3 ? [] : verificationData.documents
    }

    const shortLink = await commonFunctions.Handlers.createFirebaseShortLink(checkUser.email);

    let email = {
        to: [{
            email: checkUser.email,
            type: 'to'
        }],
        important: true,
        merge: true,
        inline_css: true,
        subject: 'Update on your company verification | EZJobs',
        merge_language: 'mailchimp',
        merge_vars: [{
            rcpt: checkUser.email,
            vars: [
                {
                    name: 'name',
                    content: checkUser.employerInformation.companyName
                },
                {
                    name: 'reason',
                    content: request.payload.additionalNotes
                },
                {
                    name: 'url',
                    content: shortLink.shortLink
                }
            ]
        }]
    };

    /* Remove all uploaded documents if status is 3 */
    if (request.payload.status === 3) {
        const len = verificationData.documents.length;
        for (let i = 0; i < len; i++) {
            try {
                await commonFunctions.Handlers.deleteImage(verificationData.documents[i]);
            } catch (e) {
                logger.error('Error occurred while deleting document in verify company handler %s:', JSON.stringify(e));
            }
        }

        templateName = 'ezjobs-company-verification-rejected';
    } else if (request.payload.status === 2) {
        templateName = 'ezjobs-company-verification-accepted';
    }

    const body = request.payload.status === 2 ? 'Congratulations! Your company is verified now' : 'We are not able to verify your company from the documents you have uploaded';

    for (let i = 0; i < addedUsers.length; i++) {
        let user;
        try {
            user = await userSchema.UserSchema.findById({_id: addedUsers[i]}, {
                deviceToken: 1,
                deviceType: 1,
                _id: 1,
                isActive: 1
            }, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding user info in verify company handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (user && user.isActive) {
            push.createMessage(user.deviceToken, [], {
                userId: user._id,
                status: request.payload.status,
                pushType: 'companyVerification'
            }, user.deviceType, 'Company verification status', body, '', '', '');
        }
    }

    await mandrill.Handlers.sendTemplate(templateName, [], email, true);

    try {
        await companyVerificationSchema.companyVerificationSchema.findByIdAndUpdate({_id: verificationData._id}, {$set: dataToUpdate}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in updating verification info in verify company handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully.', 'success', 204)).code(200);
};

handlers.getCompanyVerificationData = async (request, h) => {
    let checkAdmin, verificationData, searchCriteria = {};

    /* Check if Admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding admin info in get company verification data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }

    if (request.query.status) {
        searchCriteria = {
            status: request.query.status
        }
    }

    /* Get the verification data if exists */
    try {
        if (request.query.searchText || request.query.country || request.query.state || (request.query.signedUpStartDate && request.query.signedUpEndDate) || (request.query.approvalStartDate && request.query.approvalEndDate)) {
            let aggregationCriteria = [
                {$match: searchCriteria},
                {
                    $sort: {_id: -1}
                },
                {
                    $lookup: {
                        from: 'User',
                        localField: 'userId',
                        foreignField: '_id',
                        as: 'company'
                    }
                },
                {
                    $unwind: '$company'
                }
            ];
            if (request.query.searchText) {
                aggregationCriteria.push({
                    $match: {
                        'company.email': new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                    }
                });
            }
            if (request.query.country) {
                aggregationCriteria.push({
                    $match: {
                        'company.employerInformation.country': new RegExp(request.query.country.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                    }
                });
            }
            if (request.query.state) {
                aggregationCriteria.push({
                    $match: {
                        'company.employerInformation.companyAddress.state': new RegExp(request.query.state.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                    }
                });
            }
            if (request.query.signedUpStartDate && request.query.signedUpEndDate) {
                aggregationCriteria.push({
                    $match: {
                        'company.createdAt': {$gte: new Date(request.query.signedUpStartDate), $lte: new Date(request.query.signedUpEndDate)}
                    }
                });
            }
            if (request.query.approvalStartDate && request.query.approvalEndDate) {
                aggregationCriteria.push({
                    $match: {
                        updatedAt: {$gte: new Date(request.query.approvalStartDate), $lte: new Date(request.query.approvalEndDate)}
                    }
                });
            }

            aggregationCriteria.push({
                $skip: request.query.skip
            });

            aggregationCriteria.push({
                $limit: request.query.limit
            });

            aggregationCriteria.push({
                $lookup: {
                    from: 'VerificationField',
                    localField: 'documentType',
                    foreignField: '_id',
                    as: 'document'
                }
            });

            aggregationCriteria.push({$unwind: '$document'});

            aggregationCriteria.push({
                $lookup: {
                    from: 'Job',
                    localField: 'company._id',
                    foreignField: 'userId',
                    as: 'jobs'
                }
            });

            aggregationCriteria.push({
                $project: {
                    _id: 1,
                    additionalNotes: 1,
                    createdAt: 1,
                    documentName: 1,
                    documentNumber: 1,
                    documentType: {
                        _id: '$document._id',
                        type: '$document.type'
                    },
                    documents: 1,
                    status: 1,
                    updatedAt: 1,
                    userId: {
                        _id: '$company._id',
                        email: '$company.email',
                        firstName: '$company.firstName',
                        lastName: '$company.lastName',
                        employerInformation: '$company.employerInformation'
                    },
                    jobs: 1
                }
            });

            verificationData = await companyVerificationSchema.companyVerificationSchema.aggregate(aggregationCriteria);
        } else {
            verificationData = await companyVerificationSchema.companyVerificationSchema.find(searchCriteria, {}, {lean: true}).sort({_id: -1}).skip(request.query.skip).limit(request.query.limit).populate('userId documentType', 'email employerInformation firstName lastName type');
        }
    } catch (e) {
        logger.error('Error occurred in finding verification info in get company verification data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(verificationData ? verificationData : {}, 'Fetched successfully.', 'success', 200)).code(200);
};

handlers.addVerificationField = async (request, h) => {
    let checkAdmin;

    /* Check if Admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding admin info in add verification field handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }

    /* Save data into collection */
    try {
        await new verificationFieldSchema.verificationFields(request.payload).save();
    } catch (e) {
        logger.error('Error occurred in saving verification fields in add verification field handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Saved successfully.', 'success', 201)).code(200);
};

handlers.updateVerificationField = async (request, h) => {
    let checkAdmin;

    /* Check if Admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding admin info in update verification field handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }

    /* Update/Remove data of collection */
    if (request.payload.isRemove) {
        try {
            await verificationFieldSchema.verificationFields.findByIdAndDelete({_id: request.payload.fieldId});
        } catch (e) {
            logger.error('Error occurred in removing verification fields in update verification field handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        try {
            await verificationFieldSchema.verificationFields.findByIdAndUpdate({_id: request.payload.fieldId}, {$set: request.payload}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in updating verification fields in update verification field handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully.', 'success', 204)).code(200);
};

handlers.getVerificationField = async (request, h) => {
    let verificationFields;

    /* Get data from collection */
    try {
        verificationFields = await verificationFieldSchema.verificationFields.find({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in fetching verification fields in get verification field handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(verificationFields, 'Fetched successfully.', 'success', 200)).code(200);
};

handlers.fixJobTitles = async (request, h) => {
    let jsonData, fileName = request.payload.file.filename, jobCount = 0;

    if (fileName.split('.')[1] !== 'csv') {
        return h.response(responseFormatter.responseFormatter({}, 'The given file is not a csv file', 'error', 400)).code(400);
    }

    /* Parse CSV file to save bulk data in EZJobs database */
    try {
        jsonData = csvToJson.fieldDelimiter(',').getJsonFromCsv(request.payload.file.path);
    } catch (e) {
        logger.error('Error occurred while parsing csv file %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'Something went wrong while parsing csv file', 'error', 500)).code(500);
    }

    if (!jsonData || !jsonData.length) {
        return h.response(responseFormatter.responseFormatter({}, 'No data inside csv file', 'error', 404)).code(404);
    } else {
        for (let i = 0; i < jsonData.length ; i++) {
            if (jsonData[i].jobId && Number(jsonData[i].jobId)) {
                let checkJob;

                try {
                    checkJob = await jobSchema.jobSchema.findOne({systemGeneratedId: Number(jsonData[i].jobId)}, {isArchived: 1, isTranslated: 1}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding job in fix job titles handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred.', 'error', 500)).code(500);
                }

                if (checkJob) {
                    if (jsonData[i].Code && jsonData[i].Code.toLowerCase() === 'd') {
                        if (!checkJob.isArchived) {
                            /* Set job as archived */
                            try {
                                await jobSchema.jobSchema.findByIdAndUpdate({_id: checkJob._id}, {$set: {isArchived: true, isClosed: true, numberOfPositions: 0}}, {lean: true});
                            } catch (e) {
                                logger.error('Error occurred while updating job in fix job titles handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }

                            /* Update chats to mark job as archived */
                            let bulk = conversationSchema.conversationSchema.collection.initializeUnorderedBulkOp();
                            bulk
                                .find({jobId: mongoose.Types.ObjectId(checkJob._id), isHired: false})
                                .update({$set: {isArchived: true, isRejected: true, isHired: true}});
                            try {
                                await bulk.execute();
                            } catch (e) {
                                logger.error('Error occurred while updating chats data in fix job titles handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }

                            /* Remove job from wish list as well */
                            try {
                                await favoriteSchema.favouriteSchema.deleteMany({jobId: mongoose.Types.ObjectId(checkJob._id)});
                            } catch (e) {
                                logger.error('Error occurred while deleting favourite data in fix job titles handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }
                        }
                    } else if (jsonData[i].Code && jsonData[i].Code.toLowerCase() === 'y') {
                        const suggestion = await getAutocomplete(jsonData[i].category);
                        console.log(suggestion);
                        /*const suggestion = [];*/
                        try {
                            await jobSchema.jobSchema.findByIdAndUpdate({_id: checkJob._id}, {$set: {jobTitle: suggestion[0] ? suggestion[0] : jsonData[i].category}}, {lean: true});
                        } catch (e) {
                            console.log(e);
                            logger.error('Error occurred while updating jobs data in fix job titles handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }
                    } else if (jsonData[i].Code && jsonData[i].Code.toLowerCase() === 'x') {
                        if (jsonData[i].ReplaceJobTitlewith) {
                            const suggestion = await getAutocomplete(jsonData[i].ReplaceJobTitlewith);
                            /*const suggestion = [];*/
                            try {
                                await jobSchema.jobSchema.findByIdAndUpdate({_id: checkJob._id}, {$set: {jobTitle: suggestion[0] ? suggestion[0] : jsonData[i].category}}, {lean: true});
                            } catch (e) {
                                logger.error('Error occurred while updating jobs data in fix job titles handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }
                        } else {
                            let category;
                            try {
                                category = await categorySchema.categorySchema.findOne({categoryName: jsonData[i].category}, {_id: 1}, {lean: true});
                            } catch (e) {
                                logger.error('Error occurred while finding category in fix job titles handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }
                            if (category) {
                                try {
                                    await jobSchema.jobSchema.findByIdAndUpdate({_id: checkJob._id}, {$set: {categoryId: category._id}}, {lean: true});
                                } catch (e) {
                                    logger.error('Error occurred while updating jobs data in fix job titles handler %s:', JSON.stringify(e));
                                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                                }
                            }
                        }
                    } else if (jsonData[i].Code && jsonData[i].Code.toLowerCase() === 'rx') {
                        const suggestion = await getAutocomplete(jsonData[i].ReplaceJobTitlewith);
                        /*const suggestion = [];*/
                        try {
                            await jobSchema.jobSchema.findByIdAndUpdate({_id: checkJob._id}, {$set: {jobTitle: suggestion[0] ? suggestion[0] : jsonData[i].category}}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred while updating jobs data in fix job titles handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }

                        let category;
                        try {
                            category = await categorySchema.categorySchema.findOne({categoryName: jsonData[i].category}, {_id: 1}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred while finding category in fix job titles handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }
                        if (category) {
                            try {
                                await jobSchema.jobSchema.findByIdAndUpdate({_id: checkJob._id}, {$set: {categoryId: category._id}}, {lean: true});
                            } catch (e) {
                                logger.error('Error occurred while updating jobs data in fix job titles handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }
                        }
                    } else if (jsonData[i].Code && jsonData[i].Code.toLowerCase() === 'r') {
                        const suggestion = await getAutocomplete(jsonData[i].ReplaceJobTitlewith);
                        /*const suggestion = [];*/
                        try {
                            await jobSchema.jobSchema.findByIdAndUpdate({_id: checkJob._id}, {$set: {jobTitle: suggestion[0] ? suggestion[0] : jsonData[i].category}}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred while updating jobs data in fix job titles handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }
                    } else {
                        if (!checkJob.isTranslated) {
                            const words = ['female', 'male', 'parttime', 'part time', 'fulltime', 'full time', 'office work', 'required', 'fresher', 'only', 'staff', 'hiring', 'wanted', 'want', 'wanting'];
                            if (jsonData[i].jobTitle) {
                                let title = jsonData[i].jobTitle;
                                for (let j = 0; j < words.length; j++) {
                                    title = title.replace(new RegExp(words[j], 'gi'), '');
                                }

                                const otherWords = ['cum', '&', 'for', 'require', 'in', 'or', 'department', 'job', '/', 'at', 'needed', 'hiring', 'vacancy', 'jobs', 'on', '@', 'zomato', 'with', 'only'];
                                for (let j = 0; j < otherWords.length; j++) {
                                    if (otherWords[j] === '&' || otherWords[j] === '/' || otherWords[j] === '@') {
                                        title = title.replace(new RegExp(otherWords[j], 'gi'), '$');
                                    } else {
                                        title = title.replace(new RegExp('\\b' + otherWords[j] + '\\b', 'gi'), '$');
                                    }
                                    const idx = title.indexOf('$');
                                    if (idx !== -1) {
                                        title = title.substr(0, idx).trim();
                                    }
                                }

                                if (!title) {
                                    title = jsonData[i].category;
                                }
                                const suggestion = await getAutocomplete(title);
                                /*const suggestion = [];*/
                                try {
                                    await jobSchema.jobSchema.findByIdAndUpdate({_id: checkJob._id}, {$set: {jobTitle: suggestion[0] ? suggestion[0] : title}}, {lean: true});
                                } catch (e) {
                                    logger.error('Error occurred while updating jobs data in fix job titles handler %s:', JSON.stringify(e));
                                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    return h.response(responseFormatter.responseFormatter({}, 'Operation successful.', 'success', 201)).code(201);
};

handlers.fixFinalJobTitles = async (request, h) => {
    let jsonData, fileName = request.payload.file.filename;

    if (fileName.split('.')[1] !== 'csv') {
        return h.response(responseFormatter.responseFormatter({}, 'The given file is not a csv file', 'error', 400)).code(400);
    }

    /* Parse CSV file to save bulk data in EZJobs database */
    try {
        jsonData = csvToJson.fieldDelimiter(',').getJsonFromCsv(request.payload.file.path);
    } catch (e) {
        logger.error('Error occurred while parsing csv file %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'Something went wrong while parsing csv file', 'error', 500)).code(500);
    }

    if (!jsonData || !jsonData.length) {
        return h.response(responseFormatter.responseFormatter({}, 'No data inside csv file', 'error', 404)).code(404);
    } else {
        for (let i = 0; i < jsonData.length ; i++) {
            if (jsonData[i].jobId && Number(jsonData[i].jobId)) {
                let checkJob;

                try {
                    checkJob = await jobSchema.jobSchema.findOne({systemGeneratedId: Number(jsonData[i].jobId)}, {isArchived: 1, isTranslated: 1}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding job in fix job titles handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred.', 'error', 500)).code(500);
                }

                if (checkJob) {
                    if (jsonData[i].Code && jsonData[i].Code.toLowerCase() === 'd') {
                        if (!checkJob.isArchived) {
                            /* Set job as archived */
                            try {
                                await jobSchema.jobSchema.findByIdAndUpdate({_id: checkJob._id}, {$set: {isArchived: true, isClosed: true, numberOfPositions: 0}}, {lean: true});
                            } catch (e) {
                                logger.error('Error occurred while updating job in fix job titles handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }

                            /* Update chats to mark job as archived */
                            let bulk = conversationSchema.conversationSchema.collection.initializeUnorderedBulkOp();
                            bulk
                                .find({jobId: mongoose.Types.ObjectId(checkJob._id), isHired: false})
                                .update({$set: {isArchived: true, isRejected: true, isHired: true}});
                            try {
                                await bulk.execute();
                            } catch (e) {
                                logger.error('Error occurred while updating chats data in fix job titles handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }

                            /* Remove job from wish list as well */
                            try {
                                await favoriteSchema.favouriteSchema.deleteMany({jobId: mongoose.Types.ObjectId(checkJob._id)});
                            } catch (e) {
                                logger.error('Error occurred while deleting favourite data in fix job titles handler %s:', JSON.stringify(e));
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }
                        }
                    } else {
                        if (!checkJob.isTranslated) {
                            if (jsonData[i].jobTitle) {
                                let title = toTitleCase(jsonData[i].jobTitle.trim());
                                const suggestion = await getAutocomplete(title);

                                try {
                                    await jobSchema.jobSchema.findByIdAndUpdate({_id: checkJob._id}, {$set: {jobTitle: suggestion[0] ? suggestion[0] : title}}, {lean: true});
                                } catch (e) {
                                    logger.error('Error occurred while updating jobs data in fix job titles handler %s:', JSON.stringify(e));
                                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    return h.response(responseFormatter.responseFormatter({}, 'Operation successful.', 'success', 201)).code(201);
};

handlers.addToRedis = async (request, h) => {
    let jsonData, fileName = request.payload.file.filename;

    if (fileName.split('.')[1] !== 'csv') {
        return h.response(responseFormatter.responseFormatter({}, 'The given file is not a csv file', 'error', 400)).code(400);
    }

    /* Parse CSV file to save bulk data in EZJobs database */
    try {
        jsonData = csvToJson.fieldDelimiter(',').getJsonFromCsv(request.payload.file.path);
    } catch (e) {
        logger.error('Error occurred while parsing csv file %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'Something went wrong while parsing csv file', 'error', 500)).code(500);
    }

    if (!jsonData || !jsonData.length) {
        return h.response(responseFormatter.responseFormatter({}, 'No data inside csv file', 'error', 404)).code(404);
    } else {
        for (let i = 0; i < jsonData.length; i++) {
            const title = toTitleCase(jsonData[i].jobTitle.trim());
            console.log('adding');
            Autocomplete1.add(title);
        }
    }

    return h.response(responseFormatter.responseFormatter({}, 'Operation successful.', 'success', 200)).code(200);
};

handlers.getJobsForDisplay = async (request, h) => {
    let companies;

    try {
        companies = await userSchema.UserSchema.aggregate([
            {
                $match: {
                    websiteVisibility: true
                }
            },
            {
              $sort: {
                  _id: -1
              }
            },
            {
                $lookup: {
                    from: 'Job',
                    let: {userId: '$_id'},
                    pipeline: [
                        { $match: { $expr: { $and: [{ $eq: [ "$userId", "$$userId" ] }, { $eq: [ "$isVisible", true ] }, { $eq: [ "$isArchived", false ] }, { $eq: [ "$isExposedToAll", true ] }] } }, },
                    ],
                    as: 'jobs'
                }
            },
            {
                $match: {
                    jobs: {$ne: []}
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
                    companyName: '$employerInformation.companyName',
                    companyLogo: '$employerInformation.companyProfilePhoto',
                    city: '$employerInformation.companyAddress.city',
                    state: '$employerInformation.companyAddress.state'
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred while aggregating user in get jobs for display handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred.', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter(companies, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.displayOnWebsite = async (request, h) => {
    let checkAdmin, checkVerification;

    /* Check if Admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding admin info in display on website handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }

    /* Check if verification exists */
    try {
        checkVerification = await companyVerificationSchema.companyVerificationSchema.findById({_id: request.payload.verificationId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding company verification info in display on website handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkVerification) {
        return h.response(responseFormatter.responseFormatter({}, 'No such company found.', 'error', 404)).code(404);
    }

    /* Update verification */
    try {
        await companyVerificationSchema.companyVerificationSchema.findByIdAndUpdate({_id: request.payload.verificationId}, {$set: {websiteVisibility: request.payload.websiteVisibility}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in updating company verification info in display on website handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update user */
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: checkVerification.userId}, {$set: {websiteVisibility: request.payload.websiteVisibility}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in updating user info in display on website handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
};

handlers.getJobsByCompany = async (request, h) => {
    let jobs, totalCount, searchCriteria = {
        userId: mongoose.Types.ObjectId(request.query.companyId),
        isUnderReview: false,
        isExpired: false,
        isArchived: false,
        isClosed: false,
        isVisible: true
    }, checkUser, userIds;

    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.companyId}, {_id: 1, slaveUsers: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding user in get jobs by company handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such company.', 'error', 404)).code(404);
    }

    checkUser.slaveUsers.push(checkUser._id);
    userIds = checkUser.slaveUsers.map(k => mongoose.Types.ObjectId(k));
    searchCriteria.userId = {$in: userIds};

    try {
        totalCount = await jobSchema.jobSchema.countDocuments(searchCriteria);
    } catch (e) {
        logger.error('Error occurred in counting number of jobs in get jobs by company handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    try {
        jobs = await jobSchema.jobSchema.aggregate([
            {
                $match: searchCriteria
            },
            {
                $sort: {
                    _id: -1
                }
            },
            {
                $skip: request.query.skip
            },
            {
              $limit: request.query.limit
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'company'
                }
            },
            {
                $unwind: '$company'
            },
            {
                $project: {
                    _id: 1,
                    jobTitle: 1,
                    subJobTitle: 1,
                    payRate: 1,
                    address: 1,
                    experienceInMonths: 1,
                    postedAt: '$createdAt',
                    companyName: '$company.employerInformation.companyName',
                    companyLogo: '$company.employerInformation.companyProfilePhoto',
                    companyDescription: '$company.employerInformation.companyDescription',
                    city: '$company.employerInformation.companyAddress.city',
                    state: '$company.employerInformation.companyAddress.state',
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred in aggregating jobs in get jobs by company handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter(jobs, 'Fetched successfully.', 'success', 200, totalCount)).code(200);

};

handlers.search = async (request, h) => {
    let checkAdmin, decoded, result = [], facetCriteria = [], aggregationCriteria = [];

    /* Check if Admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding admin info in search handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }

    /* Check if admin is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in search handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    let converted = [];
    converted.push(new RegExp((pluralize(request.query.searchText)).replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi'));
    converted.push(new RegExp((pluralize.singular(request.query.searchText)).replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi'));

    /* Get the results based on the type */
    if (request.query.type === 'job') {
        try {
            result = await jobSchema.jobSchema.aggregate([
                {
                    $geoNear: {
                        near: {
                            type: 'Point',
                            coordinates: [Number(request.query.longitude), Number(request.query.latitude)]
                        },
                        key: 'location',
                        distanceField: 'distance',
                        maxDistance: 100 * 1609.34,
                        spherical: true,
                        query: {
                            country: request.query.country,
                            isUnderReview: false,
                            isArchived: false,
                            isClosed: false,
                            isVisible: true,
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
                                }
                            ]
                        }
                    }
                },
                {
                    $sort: {
                        _id: -1
                    }
                },
                {
                    $skip: request.query.skip
                },
                {
                    $limit: request.query.limit
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
                        _id: 1,
                        jobTitle: 1,
                        jobDescriptionText: 1,
                        skills: 1,
                        payRate: 1,
                        address: 1,
                        companyName: '$user.employerInformation.companyName',
                        companyLogo: '$user.employerInformation.companyProfilePhoto',
                        currency: 1,
                        jobType: 1,
                        country: 1
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while aggregating job in search handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.type === 'candidate') {
        aggregationCriteria.push({
            $geoNear: {
                near: {
                    type: 'Point',
                    coordinates: [Number(request.query.longitude), Number(request.query.latitude)]
                },
                key: 'employeeInformation.preferredLocations',
                distanceField: 'distance',
                maxDistance: request.query.radius * 1609.34,
                spherical: true,
                query: {
                    'employeeInformation.isComplete': true,
                    'employeeInformation.country': request.query.country,
                    privacyType: 'standard',
                    $or: [
                        {
                            'employeeInformation.pastJobTitlesModified.designation': {$in: converted}
                        },
                        {
                            'employeeInformation.futureJobTitles': {$in: converted}
                        },
                        {
                            'employeeInformation.skills': {$in: converted}
                        },
                        {
                            'employeeInformation.description.text': {$in: converted}
                        }
                    ]
                }
            }
        }, {
            $sort: {
                _id: -1
            }
        });

        facetCriteria.push({
            $skip: request.query.skip
        }, {
            $limit: request.query.limit
        }, {
            $project: {
                _id: 1,
                email: 1,
                firstName: 1,
                lastName: 1,
                'employeeInformation.phone': 1,
                'employeeInformation.resume': 1,
                hasUninstalled: 1,
                lastOnline: 1
            }
        });

        aggregationCriteria.push({
            $facet: {
                candidates: facetCriteria,
                count: [
                    {
                        $count: 'count'
                    }
                ]
            }
        });

        try {
            result = await userSchema.UserSchema.aggregate(aggregationCriteria);
        } catch (e) {
            logger.error('Error occurred while aggregating user in search handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (result && result.length) {
            result = result[0];
        }
    }

    return h.response(responseFormatter.responseFormatter(result, 'Fetched successfully.', 'success', 200)).code(200);
};

handlers.addJobTitle = async (request, h) => {
    let checkAdmin, decoded;

    /* Check if Admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding admin info in add job title handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }

    /* Check if admin is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in add job title handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Save into database */
    const dataToSave = {
        jobTitle: request.payload.jobTitle
    };
    try {
        await new jobTitleSchema.jobTitleSchema(dataToSave).save();
    } catch (e) {
        logger.error('Error occurred while saving job title in add job title handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Added successfully', 'success', 201)).code(200);
};

handlers.preferredLocationScript = async (request, h) => {
    let checkAdmin, decoded, users;

    /* Check if Admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding admin info in preferred location script handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }

    /* Check if admin is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in preferred location script handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Fetch all the users */
    try {
        users = await userSchema.UserSchema.find({}, {_id: 1, 'employeeInformation.location': 1, 'employeeInformation.address': 1, 'employeeInformation.preferredLocations': 1, 'employeeInformation.country': 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding users in preferred location script handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    const len = users.length;

    for (let i = 0; i < len; i++) {
        if (!users[i].employeeInformation.preferredLocations) {
            const dataToUpdate = {
                'employeeInformation.preferredLocations': {
                    type: 'MultiPoint',
                    coordinates: [users[i].employeeInformation.location.coordinates]
                },
                'employeeInformation.preferredLocationCities': [
                    {
                        city: users[i].employeeInformation.address.city,
                        state: users[i].employeeInformation.address.state,
                        country: users[i].employeeInformation.country,
                        latitude: users[i].employeeInformation.location.coordinates[1],
                        longitude: users[i].employeeInformation.location.coordinates[0]
                    }
                ]
            };

            /* Update */
            try {
                await userSchema.UserSchema.findByIdAndUpdate({_id: users[i]._id}, {$set: dataToUpdate}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while updating users in preferred location script handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Script completed', 'success', 200)).code(200);
};

handlers.getAllPromos = async (request, h) => {
    let checkAdmin, decoded, promos;

    /* Check if Admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding admin info in get all promos handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }

    /* Check if admin is actually who is trying perform the action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get all promos handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Get all promos from the database */
    try {
        promos = await promoCodeSchema.promoCodeSchema.aggregate([
            {
                $match: {
                    country: request.query.country
                }
            },
            {
                $facet: {
                    count: [{
                        $count: 'count'
                    }],
                    promos: [
                        {
                            $sort: {_id: -1}
                        },
                        {
                            $skip: request.query.skip
                        },
                        {
                            $limit: request.query.limit
                        },
                        {
                            $lookup: {
                                from: 'Admin',
                                localField: 'createdBy',
                                foreignField: '_id',
                                as: 'admin'
                            }
                        },
                        {
                            $unwind: '$admin'
                        },
                        {
                            $project: {
                                _id: 1,
                                createdBy: {$concat: ['$admin.firstName', ' ', '$admin.lastName']},
                                promoCode: 1,
                                promoType: 1,
                                amount: 1,
                                count: 1,
                                currency: 1,
                                expiration: 1,
                                isGlobal: 1,
                                userIds: 1,
                                userIdsExpanded: 1,
                                promotionName: 1,
                                packageIds: 1,
                                country: 1,
                                subText: 1
                            }
                        }
                    ]
                }
            }
        ]);
    } catch (e) {
        console.log(e);
        logger.error('Error occurred while aggregating promos in get all promos handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(promos[0] ? promos[0].promos : [], 'Fetched successfully', 'success', 200, promos[0].count[0] ? promos[0].count[0].count : 0)).code(200);
};

handlers.createPromo = async (request, h) => {
    let checkAdmin, decoded, checkDuplicate, currency;

    /* Check if Admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding admin info in create promo handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }

    /* Check if admin is actually who is trying perform the action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in create promo handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check for duplicate promo for the given country */
    try {
        checkDuplicate = await promoCodeSchema.promoCodeSchema.findOne({promoCode: request.payload.promoCode, country: request.payload.country}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding duplicate promo code in create promo handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (checkDuplicate) {
        return h.response(responseFormatter.responseFormatter({}, 'Duplicate promo', 'error', 409)).code(409);
    }

    /* Get currency */
    try {
        currency = await codeSchema.CodeSchema.findOne({countryISOName: request.payload.country}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding currency in create promo handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!currency) {
        return h.response(responseFormatter.responseFormatter({}, 'Error in fetching currency details.', 'error', 400)).code(400);
    } else {
        request.payload.currency = currency.currencyName;
    }
    request.payload.createdBy = request.payload.adminId;

    /* Create promo in the database */
    try {
        await new promoCodeSchema.promoCodeSchema(request.payload).save();
    } catch (e) {
        logger.error('Error occurred while saving promo code in create promo handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Promotion added', 'success', 201)).code(201);
};

handlers.updatePromo = async (request, h) => {
    let checkAdmin, decoded, checkPromo, checkDuplicate, currency;

    /* Check if Admin exists */
    try {
        checkAdmin = await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding admin info in create promo handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }

    /* Check if admin is actually who is trying perform the action */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update promo handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    [checkPromo, checkDuplicate, currency] = await Promise.all([
        await promoCodeSchema.promoCodeSchema.findById({_id: request.payload.promoId}, {}, {lean: true}),
        await promoCodeSchema.promoCodeSchema.findOne({_id: {$ne: mongoose.Types.ObjectId(request.payload.promoId)}, promoCode: request.payload.promoCode, country: request.payload.country}, {}, {lean: true}),
        await codeSchema.CodeSchema.findOne({countryISOName: request.payload.country}, {}, {lean: true})
    ]);

    /* Check whether promotion exists */
    if (!checkPromo) {
        return h.response(responseFormatter.responseFormatter({}, 'Promotion not found', 'error', 404)).code(404);
    }

    /* Save into audit collection */
    const auditData = {
        type: 'promotion',
        updatedBy: request.payload.adminId,
        data: checkPromo
    };
    try {
        await new auditSchema.auditSchema(auditData).save();
    } catch (e) {
        logger.error('Error occurred while saving audit data in update promo handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check for duplicate promo for the given country */
    if (checkDuplicate) {
        return h.response(responseFormatter.responseFormatter({}, 'Duplicate promo', 'error', 409)).code(409);
    }

    /* Get currency */
    if (!currency) {
        return h.response(responseFormatter.responseFormatter({}, 'Error in fetching currency details.', 'error', 400)).code(400);
    } else {
        request.payload.currency = currency.currencyName;
    }

    /* Update the promo */
    try {
        await promoCodeSchema.promoCodeSchema.findByIdAndUpdate({_id: request.payload.promoId}, {$set: request.payload}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating promo in update promo handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Promotion updated', 'success', 204)).code(200);
};

handlers.getInternalParameters = async (request, h) => {
    let checkAdmin, decoded, internalParameters;

    try {
        [checkAdmin, decoded] = await Promise.all([await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true}),
            await commonFunctions.Handlers.decodeToken(request.auth.credentials.token)])
    } catch (e) {
        logger.error('Error occurred while finding admin and decoding token in get internal parameters handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }
    if (decoded.userId !== request.query.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Get parameters */
    try {
        internalParameters = await internalParameterSchema.internalParameterSchema.findOne({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding internal parameters in get internal parameters handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(internalParameters || {}, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.updateInternalParameters = async (request, h) => {
    let checkAdmin, decoded;

    try {
        [checkAdmin, decoded] = await Promise.all([await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true}),
            await commonFunctions.Handlers.decodeToken(request.auth.credentials.token)])
    } catch (e) {
        logger.error('Error occurred while finding admin and decoding token in update internal parameters handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }
    if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Update the internal parameters */
    try {
        await internalParameterSchema.internalParameterSchema.findOneAndUpdate({}, {$set: request.payload}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating internal parameters in update internal parameters handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(204);
};

handlers.getEmployerSubscriptionInfo = async (request, h) => {
    let checkAdmin, decoded, checkUser, checkSubscription, searchCriteria;

    try {
        [checkAdmin, decoded] = await Promise.all([await adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true}),
            await commonFunctions.Handlers.decodeToken(request.auth.credentials.token)])
    } catch (e) {
        logger.error('Error occurred while finding admin and decoding token in get employer subscription info handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }
    if (decoded.userId !== request.query.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    request.query.email = decodeURIComponent(request.query.email);

    try {
        checkUser = await userSchema.UserSchema.findOne({$or: [{email: new RegExp('^' + request.query.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {phone: request.query.email}]}, {subscriptionInfo: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get employer subscription info handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user found', 'error', 404)).code(404);
    }

    /* Get subscription data of the employer */
    try {
        checkSubscription = await subscriptionSchema.subscriptionSchema.findById({_id: checkUser.subscriptionInfo.subscriptionId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding subscription in get employer subscription info handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(checkSubscription, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.reduceViews = async (request, h) => {
    let checkAdmin, decoded, subscriptionData, checkUser, views;

    try {
        [checkAdmin, decoded] = await Promise.all([await adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true}),
            await commonFunctions.Handlers.decodeToken(request.auth.credentials.token)])
    } catch (e) {
        logger.error('Error occurred while finding admin and decoding token in reduce views handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }
    if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.employerId}, {
            _id: 1,
            isMaster: 1,
            slaveUsers: 1
        }, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding employer in reduce views handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user.', 'error', 404)).code(404);
    }
    if (checkUser.isMaster) {
        checkUser.slaveUsers.push(checkUser._id);
    } else {
        try {
            checkUser = await userSchema.UserSchema.findOne({slaveUsers: mongoose.Types.ObjectId(request.payload.employerId)}, {
                _id: 1,
                slaveUsers: 1
            }, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding master account in reduce views handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        checkUser.slaveUsers.push(checkUser._id);
    }

    request.payload.candidateIds = request.payload.candidateIds.map(k => mongoose.Types.ObjectId(k));

    try {
        views = await viewsSchema.viewsSchema.find({
            employerId: {$in: checkUser.slaveUsers},
            candidateId: {$in: request.payload.candidateIds}
        }, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding views in reduce views handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    const viewsToReduce = request.payload.candidateIds.length - views.length;

    try {
        subscriptionData = await subscriptionSchema.subscriptionSchema.findById({_id: request.payload.subscriptionId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding subscription in reduce views handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (subscriptionData.numberOfViews.count < viewsToReduce) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not reduce more views than available', 'error', 400)).code(400);
    } else {
        try {
            await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: request.payload.subscriptionId}, {$inc: {'numberOfViews.count': -viewsToReduce}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating subscription in reduce views handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        const documentsToInsert = [];
        for (let i = 0; i < request.payload.candidateIds.length; i++) {
            const idx = views.findIndex(k => k.candidateId.toString() === request.payload.candidateIds[i].toString());
            if (idx === -1) {
                const viewToSave = {
                    candidateId: request.payload.candidateIds[i],
                    employerId: request.payload.employerId,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    expiration: new Date(moment.tz("America/New_York").add(subscriptionData.numberOfViews.expiryAfterPackageExpiry > 0 ? subscriptionData.numberOfViews.expiryAfterPackageExpiry : 18250, 'days'))
                };
                documentsToInsert.push({insertOne: {'document': new viewsSchema.viewsSchema(viewToSave)}});
            }
        }
        if (documentsToInsert.length) {
            try {
                await viewsSchema.viewsSchema.collection.bulkWrite(documentsToInsert);
            } catch (e) {
                logger.error('Error occurred while saving views data in reduce views handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
};

handlers.submitForIndexing = async (request, h) => {
    let jobs;

    try {
        jobs = await jobSchema.jobSchema.find({isArchived: false, isVisible: true}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding jobs in submit for indexing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < jobs.length; i++) {
        try {
            await commonFunctions.Handlers.submitForIndexing(jobs[i]._id, false);
        } catch (e) {
            logger.error('Error occurred while submitting jobs in submit for indexing handler %s:', JSON.stringify(e));
        }
    }

    return h.response(responseFormatter.responseFormatter({}, 'Success', 'success', 200)).code(200);
};

handlers.resumeOrders = async (request, h) => {
    let checkAdmin, decoded, orders, aggregationCriteria = [], facetCriteria = [], totalCount = 0;

    try {
        [checkAdmin, decoded] = await Promise.all([adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true}),
            commonFunctions.Handlers.decodeToken(request.auth.credentials.token)])
    } catch (e) {
        logger.error('Error occurred while finding admin and decoding token in get resume orders handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }
    if (decoded.userId !== request.query.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    aggregationCriteria.push({
        $match: {
            existingResume: true,
            isPaid: true
        }
    });

    if (request.query.filter === 'pending') {
        aggregationCriteria.push(
            {
                $match: {
                    status: 'pending'
                }
            }
        );
    } else if (request.query.filter === 'fulfilled') {
        aggregationCriteria.push(
            {
                $match: {
                    status: 'fulfilled'
                }
            }
        );
    }

    if (request.query.searchText) {
        const text = decodeURIComponent(request.query.searchText);
        aggregationCriteria.push({
            $match: {
                $or: [{email: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {phone: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {name: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')},]
            }
        });
    }

    aggregationCriteria.push({
        $sort: {
            _id: 1
        }
    });

    facetCriteria.push({$skip: request.query.skip});
    facetCriteria.push({$limit: request.query.limit});
    facetCriteria.push({
        $project: {
            _id: 1,
            email: 1,
            phone: 1,
            resume: 1,
            status: 1,
            orderId: 1,
            name: 1,
            themeName: 1
        }
    })

    aggregationCriteria.push({
        $facet: {
            orders: facetCriteria,
            count: [
                {
                    $count: 'count'
                }
            ]
        }
    });

    try {
        orders = await resumeOrderSchema.resumeOrderSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred while getting all resume orders in get orders handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (orders[0] && orders[0].count) {
        totalCount = orders[0].count[0] ? orders[0].count[0].count : 0;
        orders = orders[0].orders;
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(orders, 'Fetched successfully', 'success', 200, totalCount)).code(200);
};

handlers.changeOrderStatus = async (request, h) => {
    let checkAdmin, decoded;

    try {
        [checkAdmin, decoded] = await Promise.all([adminSchema.AdminSchema.findById({_id: request.payload.adminId}, {}, {lean: true}),
            commonFunctions.Handlers.decodeToken(request.auth.credentials.token)])
    } catch (e) {
        logger.error('Error occurred while finding admin and decoding token in change order status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }
    if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Update the order */
    try {
        await resumeOrderSchema.resumeOrderSchema.findByIdAndUpdate({_id: request.payload.resumeOrderId}, {$set: {status: request.payload.status}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating resume order data in change order status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 204)).code(200);
};

handlers.getRafflePeople = async (request, h) => {
    let checkUser, participants = [];

    try {
        checkUser = await userSchema.UserSchema.findOne({email: decodeURIComponent(request.query.email)}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get raffle people handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkUser) {
        try {
            participants = await referralSchema.referralSchema.aggregate([
                {
                    $match: {
                        referredBy: mongoose.Types.ObjectId(checkUser._id)
                    }
                },
                {
                    $lookup: {
                        from: 'User',
                        localField: 'referredTo',
                        foreignField: '_id',
                        as: 'participant'
                    }
                },
                {
                    $unwind: '$participant'
                },
                {
                    $project: {
                        firstName: '$participant.firstName',
                        lastName: '$participant.lastName',
                        deviceType: '$participant.deviceType',
                        deviceToken: '$participant.deviceToken'
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while aggregating referral collection in get raffle people handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(participants, 'Fetched successfully', 'success', 200)).code(200);
}

handlers.updateZone = async (request, h) => {

    try {
        await zoneSchema.zoneSchema.findOneAndUpdate({
            country: request.payload.country,
            zone: request.payload.zone
        }, {$set: {states: request.payload.states}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating zone data in update zone handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully', 'success', 201)).code(200);
};

handlers.getZoneData = async (request, h) => {
    let zoneData;

    try {
        zoneData = await zoneSchema.zoneSchema.find({country: request.query.country}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding zone data in get zone data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(zoneData, 'Fetched successfully', 'success', 200)).code(200);
};

handlers.getReport = async (request, h) => {
    let checkAdmin, decoded, data, headings = [];

    /* Check if admin exists or not and whether the token is valid or not */
    try {
        [checkAdmin, decoded] = await Promise.all([adminSchema.AdminSchema.findById({_id: request.query.adminId}, {}, {lean: true}),
            commonFunctions.Handlers.decodeToken(request.auth.credentials.token)])
    } catch (e) {
        logger.error('Error occurred while finding admin and decoding token in get report handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found.', 'error', 404)).code(404);
    }
    if (decoded.userId !== request.query.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    if (request.query.type === 'churn_all') {
        headings = ['installed', 'uninstalled'];
        try {
            data = await userSchema.UserSchema.aggregate([
                {
                    $match: {
                        $and: [
                            {
                                createdAt: {$gte: new Date(request.query.startDate)}
                            },
                            {
                                createdAt: {$lte: new Date(request.query.endDate)}
                            }
                        ],
                        hasUninstalled: true
                    }
                },
                {
                    $project: {
                        installed: '$createdAt',
                        uninstalled: '$lastOnline'
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while getting churn data in get report handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.type === 'churn_candidate') {
        headings = ['email', 'firstName', 'lastName', 'phone', 'countryCode', 'profileCompleted', 'installed', 'uninstalled'];
        try {
            data = await userSchema.UserSchema.aggregate([
                {
                    $match: {
                        $and: [
                            {
                                createdAt: {$gte: new Date(request.query.startDate)}
                            },
                            {
                                createdAt: {$lte: new Date(request.query.endDate)}
                            }
                        ],
                        hasUninstalled: true,
                        roles: 'Candidate'
                    }
                },
                {
                    $project: {
                        email: 1,
                        firstName: 1,
                        lastName: 1,
                        phone: '$employeeInformation.phone',
                        countryCode: '$employeeInformation.countryCode',
                        profileCompleted: '$employeeInformation.isComplete',
                        installed: '$createdAt',
                        uninstalled: '$lastOnline'
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while getting churn candidate data in get report handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.type === 'churn_employer') {
        headings = ['email', 'firstName', 'lastName', 'phone', 'countryCode', 'profileCompleted', 'installed', 'uninstalled'];
        try {
            data = await userSchema.UserSchema.aggregate([
                {
                    $match: {
                        $and: [
                            {
                                createdAt: {$gte: new Date(request.query.startDate)}
                            },
                            {
                                createdAt: {$lte: new Date(request.query.endDate)}
                            }
                        ],
                        hasUninstalled: true,
                        roles: 'Employer'
                    }
                },
                {
                    $project: {
                        email: 1,
                        firstName: 1,
                        lastName: 1,
                        phone: '$employerInformation.companyPhone',
                        countryCode: '$employerInformation.countryCode',
                        profileCompleted: '$employerInformation.isComplete',
                        installed: '$createdAt',
                        uninstalled: '$lastOnline'
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while getting churn employer data in get report handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.type === 'city_wise_candidates') {
        headings = ['_id', 'state', 'country', 'candidates', 'latitude', 'longitude'];
        try {
            data = await userSchema.UserSchema.aggregate([
                {
                    $match: {
                        $and: [
                            {
                                createdAt: {$gte: new Date(request.query.startDate)}
                            },
                            {
                                createdAt: {$lte: new Date(request.query.endDate)}
                            }
                        ],
                        roles: 'Candidate'
                    }
                },
                {
                    $group: {
                        "_id": "$employeeInformation.address.city",
                        "state": {
                            "$first": "$employeeInformation.address.state"
                        },
                        "country": {
                            "$first": "$employeeInformation.country"
                        },
                        "candidates": {
                            "$sum": 1.0
                        },
                        "latitude": {
                            "$first": {
                                "$arrayElemAt": [
                                    "$employeeInformation.location.coordinates",
                                    1.0
                                ]
                            }
                        },
                        "longitude": {
                            "$first": {
                                "$arrayElemAt": [
                                    "$employeeInformation.location.coordinates",
                                    0.0
                                ]
                            }
                        }
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while getting city wise candidates data in get report handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.type === 'city_wise_employers') {
        headings = ['_id', 'state', 'country', 'employers', 'latitude', 'longitude'];
        try {
            data = await userSchema.UserSchema.aggregate([
                {
                    $match: {
                        $and: [
                            {
                                createdAt: {$gte: new Date(request.query.startDate)}
                            },
                            {
                                createdAt: {$lte: new Date(request.query.endDate)}
                            }
                        ],
                        roles: 'Employer'
                    }
                },
                {
                    $group: {
                        "_id": "$employeeInformation.address.city",
                        "state": {
                            "$first": "$employeeInformation.address.state"
                        },
                        "country": {
                            "$first": "$employeeInformation.country"
                        },
                        "employers": {
                            "$sum": 1.0
                        },
                        "latitude": {
                            "$first": {
                                "$arrayElemAt": [
                                    "$employeeInformation.location.coordinates",
                                    1.0
                                ]
                            }
                        },
                        "longitude": {
                            "$first": {
                                "$arrayElemAt": [
                                    "$employeeInformation.location.coordinates",
                                    0.0
                                ]
                            }
                        }
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while getting city wise employers data in get report handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.type === 'job_applications_invitations') {
        headings = ['employer', 'jobTitle', 'city', 'state', 'invitations', 'applications'];
        try {
            data = await jobSchema.jobSchema.aggregate(
                [
                    {
                        $match: {
                            $and: [
                                {
                                    createdAt: {$gte: new Date(request.query.startDate)}
                                },
                                {
                                    createdAt: {$lte: new Date(request.query.endDate)}
                                }
                            ]
                        }
                    },
                    {
                        "$lookup": {
                            "from": "User",
                            "localField": "userId",
                            "foreignField": "_id",
                            "as": "employer"
                        }
                    },
                    {
                        "$unwind": {
                            "path": "$employer"
                        }
                    },
                    {
                        "$lookup": {
                            "from": "Conversation",
                            "localField": "_id",
                            "foreignField": "jobId",
                            "as": "chat"
                        }
                    },
                    {
                        "$unwind": {
                            "path": "$chat"
                        }
                    },
                    {
                        "$project": {
                            "jobTitle": 1.0,
                            "city": "$address.city",
                            "state": "$address.state",
                            "employer": "$employer.employerInformation.companyName",
                            "chat": 1.0,
                            "isInvited": {
                                "$cond": [
                                    {
                                        "$eq": [
                                            "$chat.isInvited",
                                            true
                                        ]
                                    },
                                    1.0,
                                    0.0
                                ]
                            },
                            "isApplied": {
                                "$cond": [
                                    {
                                        "$and": [
                                            {
                                                "$eq": [
                                                    "$chat.isInvited",
                                                    false
                                                ]
                                            },
                                            {
                                                "$eq": [
                                                    "$chat.isApplied",
                                                    true
                                                ]
                                            }
                                        ]
                                    },
                                    1.0,
                                    0.0
                                ]
                            }
                        }
                    },
                    {
                        "$group": {
                            "_id": "$_id",
                            "invitations": {
                                "$sum": "$isInvited"
                            },
                            "applications": {
                                "$sum": "$isApplied"
                            },
                            "employer": {
                                "$first": "$employer"
                            },
                            "jobTitle": {
                                "$first": "$jobTitle"
                            },
                            "city": {
                                "$first": "$city"
                            },
                            "state": {
                                "$first": "$state"
                            }
                        }
                    },
                    {
                        "$project": {
                            "employer": 1.0,
                            "jobTitle": 1.0,
                            "city": 1.0,
                            "state": 1.0,
                            "invitations": 1.0,
                            "applications": 1.0
                        }
                    }
                ]
            )
        } catch (e) {
            logger.error('Error occurred while getting job applications invitations data in get report handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.type === 'weekly_candidate_signups') {
        headings = ['firstName', 'lastName', 'email', 'phone', 'city', 'state'];
        try {
            data = await userSchema.UserSchema.aggregate([
                {
                    $match: {
                        $and: [
                            {
                                createdAt: {$gte: new Date(request.query.startDate)}
                            },
                            {
                                createdAt: {$lte: new Date(request.query.endDate)}
                            }
                        ],
                        roles: 'Candidate'
                    }
                },
                {
                    "$project": {
                        "firstName": 1.0,
                        "lastName": 1.0,
                        "email": 1.0,
                        "phone": 1.0,
                        "city": "$employeeInformation.address.city",
                        "state": "$employeeInformation.address.state"
                    }
                },
                {
                    "$sort": {
                        "city": -1.0
                    }
                },
                {
                    "$match": {
                        "state": {
                            "$ne": ""
                        }
                    }
                }
            ])
        } catch (e) {
            logger.error('Error occurred while getting weekly candidate sign up data in get report handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.type === 'weekly_job_postings') {
        headings = ['jobTitle', 'city', 'state', 'companyName', 'bulkUpload', 'views', 'calls', 'isClosed', 'applications', 'invitations'];
        try {
            data = await jobSchema.jobSchema.aggregate([
                {
                    $match: {
                        $and: [
                            {
                                createdAt: {$gte: new Date(request.query.startDate)}
                            },
                            {
                                createdAt: {$lte: new Date(request.query.endDate)}
                            }
                        ],
                        isVisible: true
                    }
                },
                {
                    "$project": {
                        "jobTitle": 1.0,
                        "city": "$address.city",
                        "state": "$address.state",
                        "bulkUpload": "$isAddedByBulkUpload",
                        "views": "$totalViews",
                        "calls": "$numberOfCallsMade",
                        "isClosed": "$isArchived",
                        "userId": 1.0
                    }
                },
                {
                    "$lookup": {
                        "from": "Conversation",
                        "let": {
                            "jobId": "$_id"
                        },
                        "pipeline": [
                            {
                                "$match": {
                                    "$expr": {
                                        "$and": [
                                            {
                                                "$eq": [
                                                    "$jobId",
                                                    "$$jobId"
                                                ]
                                            },
                                            {
                                                "$eq": [
                                                    "$isInvited",
                                                    true
                                                ]
                                            }
                                        ]
                                    }
                                }
                            }
                        ],
                        "as": "invitations"
                    }
                },
                {
                    "$lookup": {
                        "from": "Conversation",
                        "let": {
                            "jobId": "$_id"
                        },
                        "pipeline": [
                            {
                                "$match": {
                                    "$expr": {
                                        "$and": [
                                            {
                                                "$eq": [
                                                    "$jobId",
                                                    "$$jobId"
                                                ]
                                            },
                                            {
                                                "$eq": [
                                                    "$isInvited",
                                                    false
                                                ]
                                            }
                                        ]
                                    }
                                }
                            }
                        ],
                        "as": "applications"
                    }
                },
                {
                    "$lookup": {
                        "from": "User",
                        "localField": "userId",
                        "foreignField": "_id",
                        "as": "company"
                    }
                },
                {
                    "$unwind": {
                        "path": "$company"
                    }
                },
                {
                    "$project": {
                        "jobTitle": 1.0,
                        "city": 1.0,
                        "state": 1.0,
                        "companyName": "$company.employerInformation.companyName",
                        "bulkUpload": 1.0,
                        "views": 1.0,
                        "calls": 1.0,
                        "isClosed": 1.0,
                        "applications": {
                            "$size": "$applications"
                        },
                        "invitations": {
                            "$size": "$invitations"
                        }
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while getting weekly job posting data in get report handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.type === 'uninstalls') {
        headings = ['firstName', 'lastName', 'email', 'phone', 'city', 'state', 'installDate', 'uninstallDate', 'days'];
        try {
            data = await userSchema.UserSchema.aggregate([
                {
                    $match: {
                        $and: [
                            {
                                hasUninstalledDate: {$gte: new Date(request.query.startDate)}
                            },
                            {
                                hasUninstalledDate: {$lte: new Date(request.query.endDate)}
                            }
                        ]
                    }
                },
                {
                    "$project": {
                        "firstName": 1.0,
                        "lastName": 1.0,
                        "email": 1.0,
                        "phone": "$employeeInformation.phone",
                        "city": "$employeeInformation.address.city",
                        "state": "$employeeInformation.address.state",
                        "installDate": "$createdAt",
                        "uninstallDate": "$hasUninstalledDate",
                        "days": {
                            "$trunc": {
                                "$divide": [
                                    {
                                        "$subtract": [
                                            "$hasUninstalledDate",
                                            "$createdAt"
                                        ]
                                    },
                                    86400000.0
                                ]
                            }
                        }
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while getting uninstalls data in get report handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.type === 'company_logo_upload') {
        headings = ['email', 'company', 'jobTitle', 'jobClosed', 'invitations', 'applications', 'jobViews'];
        try {
            data = await userSchema.UserSchema.aggregate([
                {
                    "$match": {
                        $and: [
                            {
                                createdAt: {$gte: new Date(request.query.startDate)}
                            },
                            {
                                createdAt: {$lte: new Date(request.query.endDate)}
                            }
                        ],
                        "websiteVisibility": true
                    }
                },
                {
                    "$lookup": {
                        "from": "Job",
                        "localField": "_id",
                        "foreignField": "userId",
                        "as": "job"
                    }
                },
                {
                    "$unwind": {
                        "path": "$job"
                    }
                },
                {
                    "$project": {
                        "email": 1.0,
                        "company": "$employerInformation.companyName",
                        "jobTitle": "$job.jobTitle",
                        "jobClosed": "$job.isArchived",
                        "jobId": "$job._id",
                        "jobViews": {
                            "$size": "$job.uniqueViews"
                        }
                    }
                },
                {
                    "$lookup": {
                        "from": "Conversation",
                        "let": {
                            "jobId": "$jobId"
                        },
                        "pipeline": [
                            {
                                "$match": {
                                    "$expr": {
                                        "$and": [
                                            {
                                                "$eq": [
                                                    "$$jobId",
                                                    "$jobId"
                                                ]
                                            },
                                            {
                                                "$eq": [
                                                    "$isInvited",
                                                    true
                                                ]
                                            }
                                        ]
                                    }
                                }
                            }
                        ],
                        "as": "invitations"
                    }
                },
                {
                    "$lookup": {
                        "from": "Conversation",
                        "let": {
                            "jobId": "$jobId"
                        },
                        "pipeline": [
                            {
                                "$match": {
                                    "$expr": {
                                        "$and": [
                                            {
                                                "$eq": [
                                                    "$$jobId",
                                                    "$jobId"
                                                ]
                                            },
                                            {
                                                "$eq": [
                                                    "$isInvited",
                                                    false
                                                ]
                                            }
                                        ]
                                    }
                                }
                            }
                        ],
                        "as": "applications"
                    }
                },
                {
                    "$project": {
                        "email": 1.0,
                        "company": 1.0,
                        "jobTitle": 1.0,
                        "jobClosed": 1.0,
                        "invitations": {
                            "$size": "$invitations"
                        },
                        "applications": {
                            "$size": "$applications"
                        },
                        "jobViews": 1.0
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while getting company logo upload data in get report handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.type === 'employer_number_of_jobs') {
        headings = ['company', 'jobs'];
        try {
            data = await userSchema.UserSchema.aggregate([
                {
                    "$match": {
                        $and: [
                            {
                                createdAt: {$gte: new Date(request.query.startDate)}
                            },
                            {
                                createdAt: {$lte: new Date(request.query.endDate)}
                            }
                        ],
                        "roles": "Employer"
                    }
                },
                {
                    "$lookup": {
                        "from": "Job",
                        "localField": "_id",
                        "foreignField": "userId",
                        "as": "job"
                    }
                },
                {
                    "$project": {
                        "company": "$employerInformation.companyName",
                        "jobs": {
                            "$size": "$job"
                        }
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while getting employer number of jobs data in get report handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    let result, url;
    try {
        result = await commonFunctions.Handlers.createExcelFileForReports(request.query.type + '.xlsx', data, headings);
    } catch (e) {
        logger.error('Error occurred while creating excel sheet in get report handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (result) {
        const file = {
            fileName: request.query.type + '.xlsx',
            path: path.resolve(__dirname, '../' + request.query.type + '.xlsx')
        }
        try {
            url = await commonFunctions.Handlers.uploadExcel(file.path, file.fileName);
        } catch (e) {
            console.log(e);
        }

        if (url) {
            try {
                fs.unlinkSync(file.path);
            } catch (e) {
                console.log(e);
            }
        }
        /* Success */
        return h.response(responseFormatter.responseFormatter(url, 'Fetched successfully', 'success', 200)).code(200);
    }
};

/* Create TRIE */
const redisClient1 = require('redis').createClient();
global.Autocomplete1 = require('../utils/autocomplete.js')(redisClient1, 'trieJob:');

function getAutocomplete(text, prefix) {
    // load Autocomplete, pass along redisClient and prefix.
    const Autocomplete = require('../utils/autocomplete')(redisClient1, prefix);
    return new Promise((resolve, reject) => {
        Autocomplete.suggest(text, 10, function (result) {
            resolve(result);
        });
    });
}

function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}

module.exports = {
    Handlers: handlers
};
