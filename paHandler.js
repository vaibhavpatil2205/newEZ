'use strict';

const mongoose = require('mongoose');
const responseFormatter = require('../utils/responseFormatter');
const commonFunctions = require('../utils/commonFunctions');
const userSchema = require('../schema/userSchema');
const codeSchema = require('../schema/codeSchema');
const constantSchema = require('../schema/constantSchema');
const jobSchema = require('../schema/jobSchema');
const categorySchema = require('../schema/categorySchema');
const logger = require('../utils/logger');
const bcrypt = require('bcrypt');
const tokenSchema = require('../schema/authToken');
const mandrill = require('../utils/mandrill');
const otpSchema = require('../schema/otpSchema');
const conversationSchema = require('../schema/conversationSchema');
const paConfigSchema = require('../schema/paConfig');
const aes256 = require('aes256');
const uploadHistorySchema = require('../schema/uploadHistory');
const mailServerSchema = require('../schema/mailServerSchema');
const campusInterviewSchema = require('../schema/campusInterviewSchema');
const candidateStatusSchema = require('../schema/candidateStatusSchema');
const chapterSchema = require('../schema/chapterSchema');
const key = require('../config/aesSecretKey').key;
const push = require('../utils/push');
const moment = require('moment-timezone');
const nodeMailer = require('nodemailer');
const majorSchema = require('../schema/majorSchema');
const invitationSchema = require('../schema/invitationSchema');
const groupSchema = require('../schema/groupSchema');
const regionSchema = require("../schema/regionSchema");
const vendorTypeSchema = require('../schema/vendorType');
const packageSchema = require('../schema/packageSchema');
const languageSchema = require('../schema/languageSchema');
const subscriptionSchema = require('../schema/subscriptionSchema');
const degreeSchema = require('../schema/degreeSchema');
const chatSchema = require('../schema/chatSchemaPA');
const menuConfigSchema = require('../schema/menuConfig');
const autoCompleteTrainingInstituteSchema = require('../schema/autoCompleteTrainingInstituteSchema');
const configurationSchema = require('../schema/configurationSchema');
const searchSuggestionSchema = require('../schema/searchSuggestionSchema');
const blockUserSchema = require('../schema/blockSchema');
const dynamicFieldSchema = require('../schema/dynamicFieldsSchema');
const chatRequestSchema = require('../schema/chatRequestSchema');
const hotListSchema = require('../schema/hotlistSchema');
const networkSchema = require('../schema/networkSchema');

let paHandler = {};

paHandler.signUp = async (request, h) => {
    let checkUser, dataToSave, currency, constantData, jobData, category, isEmailVerified, menus = [], config = [];

    /* Check if user already exists */
    try {
        checkUser = await userSchema.UserSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in signup pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'Account already exists', 'error', 409)).code(409);
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

    /* Check if membership is valid */
    if (constantData.memberships && request.payload.membership) {
        const idx = constantData.memberships.findIndex(k => k._id.toString() === request.payload.membership);
        if (idx === -1) {
            return h.response(responseFormatter.responseFormatter({}, 'Membership is invalid.', 'error', 400)).code(400);
        }
    }

    /* Update invitation schema */
    let bulk = invitationSchema.invitationSchema.collection.initializeUnorderedBulkOp();
    bulk
        .find({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')})
        .update({$set: {isInvited: false, isInvitationAccepted: true}});
    try {
        await bulk.execute();
    } catch (e) {
        logger.error('Error occurred while updating invitations in create user pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check if the email is verified or not */
    try {
        isEmailVerified = await otpSchema.otpSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {isVerified: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding otp data in create user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!isEmailVerified) {
        return h.response(responseFormatter.responseFormatter({}, 'You have to verify the email first.', 'error', 400)).code(400);
    } else if (!isEmailVerified.isVerified) {
        return h.response(responseFormatter.responseFormatter({}, 'You have to verify the email first.', 'error', 400)).code(400);
    }

    dataToSave = new userSchema.UserSchema(request.payload);
    dataToSave.employerInformation.companyName = request.payload.collegeName;
    dataToSave.employerInformation.companyAddress = request.payload.address;
    dataToSave.employerInformation.companyLocation.coordinates = [Number(request.payload.longitude), Number(request.payload.latitude)];
    dataToSave.employeeInformation.address = request.payload.address;
    dataToSave.employeeInformation.location.coordinates = [Number(request.payload.longitude), Number(request.payload.latitude)];
    dataToSave.employeeInformation.preferredLocations.coordinates = [[Number(request.payload.longitude), Number(request.payload.latitude)]];
    dataToSave.employerInformation.country = request.payload.country;
    dataToSave.employeeInformation.country = request.payload.country;
    dataToSave.roles = ['Employer'];
    dataToSave.isPa = true;
    dataToSave.emailVerified = true;
    dataToSave.appVersionPA = request.payload.appVersion;
    dataToSave.employeeInformation.preferredLocationCities = [
        {
            city: request.payload.address.city,
            state: request.payload.address.state,
            country: request.payload.country,
            latitude: Number(request.payload.latitude),
            longitude: Number(request.payload.longitude)
        }
    ];

    /* Assign default language */
    let language;
    try {
        language = await languageSchema.languageSchema.findOne({language: 'en', country: dataToSave.country}, {_id: 1, name: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding language data in signup pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (language) {
        dataToSave.appLanguage = language._id;
        dataToSave.chatLanguage = language._id;
    }

    /* Create free subscription for this users */
    let checkPackage;
    try {
        checkPackage = await packageSchema.packageSchema.findOne({isFree: true, country: dataToSave.country, isActive: true}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding package in signup pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (checkPackage) {
        dataToSave.subscriptionInfo = {packageId: checkPackage._id};
        /* Create free subscription & Check whether plan exists */
        let subscriptionData, packageId;

        try {
            packageId = await packageSchema.packageSchema.findOne({country: dataToSave.country, isFree: true, isActive: true}, {_id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching package id in signup pa handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        delete checkPackage._id;
        /* Save subscription in database */
        let subscriptionToSave = new subscriptionSchema.subscriptionSchema(checkPackage);
        delete subscriptionToSave.createdAt;
        delete subscriptionToSave.updatedAt;
        delete subscriptionToSave._id;
        subscriptionToSave.isActive = false;
        subscriptionToSave.userId = dataToSave._id;
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
            logger.error('Error occurred saving subscription information in signup pa handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        dataToSave.subscriptionInfo['subscriptionId'] = subscriptionData._id;
    }

    /* Save into database */
    try {
        dataToSave = await dataToSave.save();
    } catch (e) {
        logger.error('Error occurred while saving user in signup pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Remove record from database about OTP */
    try {
        await otpSchema.otpSchema.findOneAndDelete({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in removing otp data in create user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Create Auth token */
    const token = commonFunctions.Handlers.createAuthToken(dataToSave._id, 'PA');

    /* Save token into the database */
    const tokenToSave = {
        userId: dataToSave._id,
        authToken: token,
        isExpired: false
    };
    try {
        await tokenSchema.authTokenSchema.findOneAndUpdate({userId: dataToSave._id}, {$set: tokenToSave}, {lean: true, upsert: true});
    } catch (e) {
        logger.error('Error occurred while saving user token in signup pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get category for saving it into job */
    try {
        category = await categorySchema.categorySchema.findOne({isActive: true, categoryName: 'Others'}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding category in signup pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Create default PA config*/
    const configToSave = {
        paId: dataToSave._id,
        degree: [],
        major: [],
        email: '',
        course: [],
        batch: [],
        jobTitles: [],
        isExposedToAll: [true]
    };
    try {
        await new paConfigSchema.paConfigSchema(configToSave).save();
    } catch (e) {
        logger.error('Error occurred saving default config information in upload members PA admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Create a fake job so that PA can chat with his/her candidates */
    jobData = new jobSchema.jobSchema(request.payload);
    jobData.jobTitle = request.payload.isUniversity ? 'Placement officer' : 'Consulting company';
    jobData.location.coordinates = [Number(request.payload.longitude), Number(request.payload.latitude)];
    jobData.displayLocation.coordinates = [[Number(request.payload.longitude), Number(request.payload.latitude)]];
    jobData.numberOfPositions = 1;
    jobData.isVisible = false;
    jobData.userId = mongoose.Types.ObjectId(dataToSave._id);
    jobData.categoryId = mongoose.Types.ObjectId(category._id);

    try {
        await jobData.save();
    } catch (e) {
        logger.error('Error occurred while saving job data in signup pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (constantData.memberships) {
        const idx = constantData.memberships.findIndex(k => k._id.toString() === dataToSave.membership);
        if (idx !== -1) {
            dataToSave.membership = constantData.memberships[idx].name;
        }
    }

    /* Fetch menu data */
    let type = dataToSave.isUniversity ? 'University' : (dataToSave.isConsulting ? 'Consulting' : (dataToSave.isNonProfit ? 'Non-profit': (dataToSave.isTraining ? 'Training' : '')));
    try {
        menus = await menuConfigSchema.menuConfigSchema.findOne({platform: 'PA', type: type}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding menus data in signup pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Fetch configuration data*/
    try {
        config = await configurationSchema.configurationSchema.findOne({isUniversity: dataToSave.isUniversity, isNonProfit: dataToSave.isNonProfit, isTraining: dataToSave.isTraining, isConsulting: dataToSave.isConsulting}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding configuration data in sign up pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    let updatedData;
    try {
        updatedData = await paConfigSchema.paConfigSchema.findOne({paId: dataToSave._id}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding configuration data in sign up pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (config) {
        const idx = config.filter.findIndex(k => k.key === 'network');
        if (idx !== -1) {
            let filters = config.filter[idx].filters;
            const idxMembership = filters.findIndex(k => k.key === 'membershipId');
            if (idxMembership !== -1) {
                let memberships = [];
                for (let i = 0; i < constantData.memberships.length; i++) {
                    memberships.push({key: constantData.memberships[i]._id, label: constantData.memberships[i].name});
                }
                config.filter[idx].filters[idxMembership].values = memberships;
            }
            const idxGroup = filters.findIndex(k => k.key === 'groupId');
            if (idxGroup !== -1) {
                config.filter[idx].filters[idxGroup].values = [];
            }
        }

        const idxCandidate = config.filter.findIndex(k => k.key === 'candidate');
        if (idxCandidate !== -1) {
            let filters = config.filter[idxCandidate].filters;
            const idxGroup = filters.findIndex(k => k.key === 'groupId');
            if (idxGroup !== -1) {
                config.filter[idxCandidate].filters[idxGroup].values = [];
            }

            const idxDegree = filters.findIndex(k => k.key === 'degreeName');
            if (idxDegree !== -1) {
                config.filter[idxCandidate].filters[idxDegree].values = [];
            }

            const idxMajor = filters.findIndex(k => k.key === 'majorName');
            if (idxMajor !== -1) {
                config.filter[idxCandidate].filters[idxMajor].values = [];
            }

            const idxBatch = filters.findIndex(k => k.key === 'batch');
            if (idxBatch !== -1) {
                config.filter[idxCandidate].filters[idxBatch].values = [];
            }

            const idxCourse = filters.findIndex(k => k.key === 'course');
            if (idxCourse !== -1) {
                config.filter[idxCandidate].filters[idxCourse].values = [];
            }

            const idxJobTitles = filters.findIndex(k => k.key === 'jobTitles');
            if (idxJobTitles !== -1) {
                config.filter[idxCandidate].filters[idxJobTitles].values = [];
            }

            const idxGraduationYear = filters.findIndex(k => k.key === 'graduationYear');
            if (idxGraduationYear !== -1) {
                let temp = [], currentYear = new Date().getFullYear();
                for (let i = currentYear - 25; i < currentYear + 3; i++) {
                    temp.push({key: i, label: i});
                }
                config.filter[idxCandidate].filters[idxGraduationYear].values = temp;
            }
        }

        if (updatedData) {
            for (let i = 0; i < config.config.length; i++) {
                if (config.config[i].key === 'degreeName') {
                    config.config[i].values = updatedData.degree ? updatedData.degree : [];
                } else if (config.config[i].key === 'majorName') {
                    config.config[i].values = updatedData.major ? updatedData.major : [];
                } else if (config.config[i].key === 'batch') {
                    config.config[i].values = updatedData.batch ? updatedData.batch : [];
                } else if (config.config[i].key === 'course') {
                    config.config[i].values = updatedData.course ? updatedData.course : [];
                } else if (config.config[i].key === 'jobTitles') {
                    config.config[i].values = updatedData.jobTitles ? updatedData.jobTitles : [];
                } else if (config.config[i].key === 'isExposedToAll') {
                    config.config[i].values = updatedData.isExposedToAll ? updatedData.isExposedToAll : [];
                }
            }
        }
    }

    /* Add view data for candidate management in config object */
    config.candidateViewType = dataToSave.isUniversity ? 'isAcademic' : (dataToSave.isConsulting ? 'isSkill' : '');

    /* Success */
    return h.response(responseFormatter.responseFormatter({authToken: token, userInfo: dataToSave, constantData: constantData, jobId: jobData._id, jobTitle: jobData.jobTitle, menus: menus, config: config}, 'Profile created successfully', 'success', 201)).code(201);
};

paHandler.auth = async (request, h) => {
    let checkUser, dataToUpdate, match, userData, constantData, checkJob, menus = [], config = [], region, chapter;

    /* Checking if user is logging in using email */
    try {
        checkUser = await userSchema.UserSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while checking user in auth user pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkUser) {
        /*const idx = checkUser.roles.findIndex(k => k.toLowerCase() === 'candidate');
        if (idx !== -1) {
            return h.response(responseFormatter.responseFormatter({}, 'You can not use the credentials of EZJobs to login with the EZJobs PA.', 'error', 400)).code(400);
        }*/

        if (checkUser.isPaAdmin) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not eligible to use this credentials for logging in.', 'error', 400)).code(400);
        } else if (!checkUser.isActive) {
            return h.response(responseFormatter.responseFormatter({}, 'Your account has been deactivated by the admin.', 'error', 400)).code(400);
        }
        const idx = checkUser.roles.findIndex(k => k === 'Candidate');
        if (idx !== -1) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not eligible to use this credentials for logging in.', 'error', 400)).code(400);
        }

        /* Check if password is correct */
        if (request.payload.password) {
            try {
                match = await bcrypt.compare(request.payload.password, checkUser.password);
            } catch (e) {
                logger.error('Error occurred while comparing passwords in auth user pa handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (!match) {
                return h.response(responseFormatter.responseFormatter({}, 'Email or password is incorrect', 'error', 400)).code(400);
            }
        }
        if (!checkUser.isActive && checkUser.isSlave) {
            return h.response(responseFormatter.responseFormatter({}, 'Your parent account has been blocked your account. Please contact parent account administrator for more information', 'error', 400)).code(400);
        }

        dataToUpdate = {
            appVersion: request.payload.appVersion,
            deviceType: request.payload.deviceType,
            deviceToken: request.payload.deviceToken,
            isPa: true,
            hasOwned: true
        };

        if (!checkUser.isPa) {
            dataToUpdate['isConsulting'] = true;
            dataToUpdate['isNonProfit'] = false;
            dataToUpdate['isUniversity'] = false;
            dataToUpdate['isIndividual'] = true;
            dataToUpdate['isOrganization'] = false;
            dataToUpdate['isTraining'] = false;
        }


        /* Check if user has assigned free package or not */
        if (!checkUser.subscriptionInfo) {
            let freePackage, checkPackage, numberOfJobsPosted = 0, subscriptionData;
            try {
                checkPackage = await packageSchema.packageSchema.findOne({country: checkUser.country, isFree: true, isActive: true}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred finding free package in auth PA handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            try {
                freePackage = await packageSchema.packageSchema.findOne({country: checkUser.country, isFree: true, isActive: true}, {_id: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred finding free package in auth PA handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            /* Get the number of jobs posted */
            try {
                numberOfJobsPosted = await jobSchema.jobSchema.countDocuments({userId: mongoose.Types.ObjectId(checkUser._id), isVisible: true});
            } catch (e) {
                logger.error('Error occurred counting number of jobs posted by user in auth PA handler %s:', JSON.stringify(e));
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
                    logger.error('Error occurred saving subscription information in auth PA handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                dataToUpdate.subscriptionInfo['subscriptionId'] = subscriptionData._id;
            }
        }

        /* Update user data */
        try {
            userData = await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, {$set: dataToUpdate}, {lean: true, new: true});
        } catch (e) {
            logger.error('Error occurred while updating user data in auth user pa handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Get job data */
        try {
            checkJob = await jobSchema.jobSchema.findOne({userId: mongoose.Types.ObjectId(checkUser._id), isVisible: false}, {_id: 1, jobTitle: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting job data in auth user pa handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* If job is not found then create a hidden job post */
        if (!checkJob) {
            let category;
            /* Get category for saving it into job */
            try {
                category = await categorySchema.categorySchema.findOne({isActive: true, categoryName: 'Others'}, {_id: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding category in auth pa handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            /* Create a fake job so that PA can chat with his/her candidates */
            checkJob = new jobSchema.jobSchema(request.payload);
            checkJob.jobTitle = checkUser.isUniversity ? 'Placement officer' : 'Consulting company';
            checkJob.location.coordinates = [checkUser.employeeInformation.location.coordinates[0], checkUser.employeeInformation.location.coordinates[1]];
            checkJob.displayLocation.coordinates = [[checkUser.employeeInformation.location.coordinates[0], checkUser.employeeInformation.location.coordinates[1]]];
            checkJob.numberOfPositions = 1;
            checkJob.isVisible = false;
            checkJob.userId = mongoose.Types.ObjectId(checkUser._id);
            checkJob.categoryId = mongoose.Types.ObjectId(category._id);

            try {
                await checkJob.save();
            } catch (e) {
                logger.error('Error occurred while saving job data in auth pa handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }

        const token = await commonFunctions.Handlers.createAuthToken(checkUser._id, 'PA');

        /* Save token into the database */
        const dataToSave = {
            userId: checkUser._id,
            authToken: token,
            isExpired: false
        };
        try {
            await tokenSchema.authTokenSchema.findOneAndUpdate({userId: checkUser._id}, {$set: dataToSave}, {lean: true, upsert: true});
        } catch (e) {
            logger.error('Error occurred while saving user token in signup pa handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Fetch constant data */
        try {
            constantData = await constantSchema.constantSchema.findOne({}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding constant data in auth user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (constantData.memberships) {
            const idx = constantData.memberships.findIndex(k => k._id.toString() === userData.membership);
            if (idx !== -1) {
                userData.membership = constantData.memberships[idx].name;
                userData.membershipId = constantData.memberships[idx]._id;
            }
        }

        /* Fetch menu data */
        let type = checkUser.isUniversity ? 'University' : (checkUser.isConsulting ? 'Consulting' : (checkUser.isNonProfit ? 'Non-profit': (checkUser.isTraining ? 'Training' : '')));
        try {
            menus = await menuConfigSchema.menuConfigSchema.findOne({platform: 'PA', type: type}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding menus data in auth user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        
        /* Fetch configuration data*/
        try {
            config = await configurationSchema.configurationSchema.findOne({isUniversity: checkUser.isUniversity, isNonProfit: checkUser.isNonProfit, isTraining: checkUser.isTraining, isConsulting: checkUser.isConsulting}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding configuration data in auth user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        let updatedData;
        try {
            updatedData = await paConfigSchema.paConfigSchema.findOne({paId: checkUser._id}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding configuration data in auth user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (config) {
            const idx = config.filter.findIndex(k => k.key === 'network');
            if (idx !== -1) {
                let filters = config.filter[idx].filters;
                const idxMembership = filters.findIndex(k => k.key === 'membershipId');
                if (idxMembership !== -1) {
                    let memberships = [];
                    for (let i = 0; i < constantData.memberships.length; i++) {
                        memberships.push({key: constantData.memberships[i]._id, label: constantData.memberships[i].name});
                    }
                    config.filter[idx].filters[idxMembership].values = memberships;
                }
                const idxGroup = filters.findIndex(k => k.key === 'groupId');
                if (idxGroup !== -1) {
                    let groups = [], temp = [];
                    /* Get groups */
                    try {
                        groups = await groupSchema.groupSchema.find({userId: checkUser._id, isCandidate: false}, {}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred in finding groups data in update new PA config handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                    for (let i = 0; i < groups.length; i++) {
                        temp.push({key: groups[i]._id, label: groups[i].groupName});
                    }
                    config.filter[idx].filters[idxGroup].values = temp;
                }
            }


            const idxCandidate = config.filter.findIndex(k => k.key === 'candidate');
            if (idxCandidate !== -1) {
                let filters = config.filter[idxCandidate].filters;
                const idxGroup = filters.findIndex(k => k.key === 'groupId');
                if (idxGroup !== -1) {
                    let groups = [], temp = [];
                    /* Get groups */
                    try {
                        groups = await groupSchema.groupSchema.find({userId: checkUser._id, isCandidate: true}, {}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred in finding groups data in update new PA config handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                    for (let i = 0; i < groups.length; i++) {
                        temp.push({key: groups[i]._id, label: groups[i].groupName});
                    }
                    config.filter[idxCandidate].filters[idxGroup].values = temp;
                }

                const idxDegree = filters.findIndex(k => k.key === 'degreeName');
                if (idxDegree !== -1) {
                    let temp = [];
                    if (updatedData && updatedData.degree) {
                        for (let i = 0; i < updatedData.degree.length; i++) {
                            temp.push({key: updatedData.degree[i].name, label: updatedData.degree[i].name});
                        }
                    }
                    config.filter[idxCandidate].filters[idxDegree].values = temp;
                }

                const idxMajor = filters.findIndex(k => k.key === 'majorName');
                if (idxMajor !== -1) {
                    let temp = [];
                    if (updatedData && updatedData.major) {
                        for (let i = 0; i < updatedData.major.length; i++) {
                            temp.push({key: updatedData.major[i], label: updatedData.major[i]});
                        }
                    }
                    config.filter[idxCandidate].filters[idxMajor].values = temp;
                }

                const idxBatch = filters.findIndex(k => k.key === 'batch');
                if (idxBatch !== -1) {
                    let temp = [];
                    if (updatedData && updatedData.batch) {
                        for (let i = 0; i < updatedData.batch.length; i++) {
                            temp.push({key: updatedData.batch[i], label: updatedData.batch[i]});
                        }
                    }
                    config.filter[idxCandidate].filters[idxBatch].values = temp;
                }

                const idxCourse = filters.findIndex(k => k.key === 'course');
                if (idxCourse !== -1) {
                    let temp = [];
                    if (updatedData && updatedData.course) {
                        for (let i = 0; i < updatedData.course.length; i++) {
                            temp.push({key: updatedData.course[i], label: updatedData.course[i]});
                        }
                    }
                    config.filter[idxCandidate].filters[idxCourse].values = temp;
                }

                const idxJobTitles = filters.findIndex(k => k.key === 'jobTitles');
                if (idxJobTitles !== -1) {
                    let temp = [];
                    if (updatedData && updatedData.jobTitles) {
                        for (let i = 0; i < updatedData.jobTitles.length; i++) {
                            temp.push({key: updatedData.jobTitles[i], label: updatedData.jobTitles[i]});
                        }
                    }
                    config.filter[idxCandidate].filters[idxJobTitles].values = temp;
                }

                const idxGraduationYear = filters.findIndex(k => k.key === 'graduationYear');
                if (idxGraduationYear !== -1) {
                    let temp = [], currentYear = new Date().getFullYear();
                    for (let i = currentYear - 25; i < currentYear + 3; i++) {
                        temp.push({key: i, label: i});
                    }
                    config.filter[idxCandidate].filters[idxGraduationYear].values = temp;
                }
            }

            if (updatedData) {
                for (let i = 0; i < config.config.length; i++) {
                    if (config.config[i].key === 'degreeName') {
                        config.config[i].values = updatedData.degree ? updatedData.degree : [];
                    } else if (config.config[i].key === 'majorName') {
                        config.config[i].values = updatedData.major ? updatedData.major : [];
                    } else if (config.config[i].key === 'batch') {
                        config.config[i].values = updatedData.batch ? updatedData.batch : [];
                    } else if (config.config[i].key === 'course') {
                        config.config[i].values = updatedData.course ? updatedData.course : [];
                    } else if (config.config[i].key === 'jobTitles') {
                        config.config[i].values = updatedData.jobTitles ? updatedData.jobTitles : [];
                    } else if (config.config[i].key === 'isExposedToAll') {
                        config.config[i].values = updatedData.isExposedToAll ? updatedData.isExposedToAll : [];
                    }
                }
            }
        }

        /* Get regions and chapters data */
        if (userData.employerInformation.region) {
            try {
                region = await regionSchema.regionSchema.findById({_id: userData.employerInformation.region}, {name: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in finding region data in update new PA config handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (region) {
                userData.employerInformation.region = region.name;
            }
        }
        if (userData.employerInformation.chapter) {
            try {
                chapter = await chapterSchema.chapterSchema.findById({_id: userData.employerInformation.chapter}, {name: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in finding chapter data in update new PA config handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (chapter) {
                userData.employerInformation.chapter = chapter.name;
            }
        }

        /* Add view data for candidate management in config object */
        config.candidateViewType = (userData.isUniversity || userData.isTraining) ? 'isAcademic' : (userData.isConsulting ? 'isSkill' : '');


        return h.response(responseFormatter.responseFormatter({authToken: token, userInfo: userData, constantData: constantData, jobId: checkJob ? checkJob._id : '', jobTitle: checkJob ? checkJob.jobTitle : '', menus: menus, config: config}, 'Logged in successfully', 'success', 200)).code(200);
    }

    return h.response(responseFormatter.responseFormatter({}, 'We do not find account with the given email', 'error', 404)).code(404);
};

paHandler.getDashboardData = async (request, h) => {
    let checkUser, decoded, invitations = [], applications = [], otherData = [], hired = [], candidates, activeJobs, jobApplications = [], hiredForJobs = [];

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get dashboard data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get dashboard data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists', 'error', 404)).code(404);
    }

    if (checkUser.isMaster) {
        checkUser.slaveUsers.push(mongoose.Types.ObjectId(checkUser._id));
    } else {
        /* Get the master user (This is temporary) */
        /*try {
            masterUser = await userSchema.UserSchema.findById({_id: checkUser.paId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting master user in get candidates data handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!masterUser) {
            return h.response(responseFormatter.responseFormatter({}, 'Something went wrong! Please contact support.', 'error', 400)).code(400);
        }
        masterUser.slaveUsers.push(mongoose.Types.ObjectId(masterUser._id));*/
    }

    /* Get dashboard data */
    /*
    * paId: {$in: (checkUser.isMaster ? checkUser.slaveUsers : [mongoose.Types.ObjectId(checkUser._id)])},
    * */
    let invitationAggregation = [], matchCriteria = {
        paId: {$in: (checkUser.isMaster ? checkUser.slaveUsers : [checkUser._id])},
        isPa: false,
        isPaEmployer: false
    }, filterCriteria = {};

    if (request.query.degreeName) {
        matchCriteria['employeeInformation.educationPA.level'] = request.query.degreeName;
    }

    if (request.query.majorName) {
        matchCriteria['employeeInformation.educationPA.major'] = request.query.majorName;
    }

    if (request.query.batch) {
        matchCriteria['employeeInformation.batch'] = request.query.batch;
    }

    if (request.query.course) {
        matchCriteria['employeeInformation.course'] = request.query.course;
    }

    if (request.query.appDownload) {
        matchCriteria['hasOwned'] = request.query.appDownload === 'downloaded';
    }

    invitationAggregation.push({
        $match: matchCriteria
    });

    invitationAggregation.push({
        $lookup: {
            localField: '_id',
            foreignField: 'candidateId',
            from: 'Conversation',
            as: 'candidate'
        }
    });

    invitationAggregation.push( {
        $unwind: '$candidate'
    });

    invitationAggregation.push({
        $lookup: {
            localField: 'candidate.jobId',
            foreignField: '_id',
            from: 'Job',
            as: 'job'
        }
    });

    invitationAggregation.push( {
        $unwind: '$job'
    });

    if (request.query.filter) {
        if (request.query.filter === 'thisWeek') {
            filterCriteria['candidate.createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('week')), $lte: new Date(moment.tz("America/New_York").endOf('week'))}
        } else if (request.query.filter === 'lastWeek') {
            filterCriteria['candidate.createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks')), $lte: new Date(moment.tz("America/New_York").endOf('week').subtract(1, 'weeks'))}
        } else if (request.query.filter === 'thisMonth') {
            filterCriteria['candidate.createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('month')), $lte: new Date(moment.tz("America/New_York").endOf('month'))}
        } else if (request.query.filter === 'lastMonth') {
            filterCriteria['candidate.createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months')), $lte: new Date(moment.tz("America/New_York").endOf('month').subtract(1, 'months'))}
        } else if (request.query.filter === 'thisYear') {
            filterCriteria['candidate.createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('year')), $lte: new Date(moment.tz("America/New_York").endOf('year'))}
        } else if (request.query.filter === 'lastYear') {
            filterCriteria['candidate.createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years')), $lte: new Date(moment.tz("America/New_York").endOf('year').subtract(1, 'years'))}
        }
    }

    if (request.query.employerId) {
        filterCriteria['candidate.employerId'] = mongoose.Types.ObjectId(request.query.employerId);
    }

    invitationAggregation.push({
        $match: filterCriteria
    });

    invitationAggregation.push({
        $match: {
            'job.isVisible': true,
            'candidate.isInvited': true,
            'candidate.employerId': {$nin: (checkUser.isMaster ? checkUser.slaveUsers : [mongoose.Types.ObjectId(checkUser._id)])}
        }
    });

    invitationAggregation.push({
        $count: 'invitations'
    });

    try {
        invitations = await userSchema.UserSchema.aggregate(invitationAggregation);
    } catch (e) {
        logger.error('Error occurred while aggregating user in get dashboard data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    let applicationAggregation = [];

    if (checkUser.isUniversity) {
        applicationAggregation.push({
            $match: matchCriteria
        });

        applicationAggregation.push({
            $lookup: {
                localField: '_id',
                foreignField: 'candidateId',
                from: 'Conversation',
                as: 'candidate'
            }
        });

        applicationAggregation.push( {
            $unwind: '$candidate'
        });

        applicationAggregation.push({
            $lookup: {
                localField: 'candidate.jobId',
                foreignField: '_id',
                from: 'Job',
                as: 'job'
            }
        });

        applicationAggregation.push( {
            $unwind: '$job'
        });

        applicationAggregation.push({
            $match: filterCriteria
        });

        applicationAggregation.push({
            $match: {
                'job.isVisible': true,
                'candidate.isInvited': false,
                'candidate.isApplied': true
            }
        });

        applicationAggregation.push({
            $count: 'applications'
        });


        try {
            applications = await userSchema.UserSchema.aggregate(applicationAggregation)
        } catch (e) {
            logger.error('Error occurred while aggregating user in get dashboard data handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    let hiredAggregation = [];

    hiredAggregation.push({
        $match: matchCriteria
    });

    hiredAggregation.push({
        $lookup: {
            localField: '_id',
            foreignField: 'candidateId',
            from: 'Conversation',
            as: 'candidate'
        }
    });

    hiredAggregation.push( {
        $unwind: '$candidate'
    });

    hiredAggregation.push({
        $match: filterCriteria
    });

    hiredAggregation.push({
        $match: {
            'candidate.isHired': true,
            'candidate.isRejected': false
        }
    });

    hiredAggregation.push({
        $count: 'hired'
    });
    try {
        hired = await userSchema.UserSchema.aggregate(hiredAggregation)
    } catch (e) {
        logger.error('Error occurred while aggregating user in get dashboard data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (request.query.filter) {
        if (request.query.filter === 'thisWeek') {
            matchCriteria['createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('week')), $lte: new Date(moment.tz("America/New_York").endOf('week'))}
        } else if (request.query.filter === 'lastWeek') {
            matchCriteria['createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks')), $lte: new Date(moment.tz("America/New_York").endOf('week').subtract(1, 'weeks'))}
        } else if (request.query.filter === 'thisMonth') {
            matchCriteria['createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('month')), $lte: new Date(moment.tz("America/New_York").endOf('month'))}
        } else if (request.query.filter === 'lastMonth') {
            matchCriteria['createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months')), $lte: new Date(moment.tz("America/New_York").endOf('month').subtract(1, 'months'))}
        } else if (request.query.filter === 'thisYear') {
            matchCriteria['createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('year')), $lte: new Date(moment.tz("America/New_York").endOf('year'))}
        } else if (request.query.filter === 'lastYear') {
            matchCriteria['createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years')), $lte: new Date(moment.tz("America/New_York").endOf('year').subtract(1, 'years'))}
        }
    }

    try {
        candidates = await userSchema.UserSchema.countDocuments(matchCriteria);
    } catch (e) {
        logger.error('Error occurred while counting users in get dashboard data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkUser.isUniversity) {
        try {
            otherData = await userSchema.UserSchema.aggregate([
                {
                    $match: {
                        paId: {$in: (checkUser.isMaster ? checkUser.slaveUsers : [mongoose.Types.ObjectId(checkUser._id)])},
                        isPaEmployer: false
                    }
                },
                {
                    $project: {
                        uniqueViews: {$size: '$employeeInformation.uniqueViews'},
                        'employeeInformation.totalViews': 1,
                        'employeeInformation.searchAppearances': 1
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalViews: {$sum: '$employeeInformation.totalViews'},
                        uniqueViews: {$sum: '$uniqueViews'},
                        searchAppearances: {$sum: '$employeeInformation.searchAppearances'}
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while aggregating user in get dashboard data handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Get total job post counts */
    try {
        activeJobs = await jobSchema.jobSchema.countDocuments({userId: {$in: (checkUser.isMaster ? checkUser.slaveUsers : [checkUser._id])}, isArchived: false, isVisible: true});
    } catch (e) {
        logger.error('Error occurred while counting active jobs in get dashboard data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get total applicants for the jobs */
    try {
        jobApplications = await jobSchema.jobSchema.aggregate([
            {
                $match: {
                    userId: {$in: (checkUser.isMaster ? checkUser.slaveUsers : [checkUser._id])},
                    isArchived: false,
                    isVisible: true
                }
            },
            {
                $lookup: {
                    from: 'Conversation',
                    localField: '_id',
                    foreignField: 'jobId',
                    as: 'application'
                }
            },
            {
                $unwind: '$application'
            },
            {
                $count: 'applications'
            }
        ])
    } catch (e) {
        logger.error('Error occurred while aggregating active jobs in get dashboard data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get total hired candidate for the jobs */
    try {
        hiredForJobs = await jobSchema.jobSchema.aggregate([
            {
                $match: {
                    userId: {$in: (checkUser.isMaster ? checkUser.slaveUsers : [checkUser._id])}
                }
            },
            {
                $lookup: {
                    from: 'Conversation',
                    localField: '_id',
                    foreignField: 'jobId',
                    as: 'application'
                }
            },
            {
                $unwind: '$application'
            },
            {
                $match: {
                    'application.isHired': true,
                    'application.isRejected': false
                }
            },
            {
                $count: 'hired'
            }
        ])
    } catch (e) {
        logger.error('Error occurred while aggregating active jobs in get dashboard data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    const dataToReturn = {
        totalViews: otherData[0] ? otherData[0].totalViews : 0,
        uniqueViews: otherData[0] ? otherData[0].uniqueViews : 0,
        searchAppearances: otherData[0] ? otherData[0].searchAppearances : 0,
        invitations: invitations[0] ? invitations[0].invitations : 0,
        applications: applications[0] ? applications[0].applications : 0,
        candidates: candidates,
        hired: hired[0] ? hired[0].hired : 0,
        activeJobs: activeJobs,
        jobApplications: jobApplications[0] ? jobApplications[0].applications : 0,
        hiredForJobs: hiredForJobs[0] ? hiredForJobs[0].hired : 0
    };

    return h.response(responseFormatter.responseFormatter(dataToReturn, 'Fetched successfully', 'success', 200)).code(200);
};

paHandler.getDashboardDataCampusInterview = async (request, h) => {
    let checkUser, decoded, matchCriteria, dataToReturn = {
        employersVisited: 0,
        studentInterviewed: 0,
        offersMade: 0,
        offersAccepted: 0,
        upcomingInterviews: 0
    };

    /* Check if user is actually who is trying to access */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get dashboard data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get dashboard data campus interview handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists', 'error', 404)).code(404);
    }

    /* Define the match criteria */
    matchCriteria = {
        paId: mongoose.Types.ObjectId(request.query.userId)
    };

    if (request.query.degreeName) {
        matchCriteria['degree'] = request.query.degree;
    }

    if (request.query.major) {
        matchCriteria['major'] = request.query.major;
    }

    if (request.query.filter) {
        if (request.query.filter === 'thisWeek') {
            matchCriteria['visitDate'] = {$gte: new Date(moment.tz("America/New_York").startOf('week')), $lte: new Date(moment.tz("America/New_York").endOf('week'))}
        } else if (request.query.filter === 'lastWeek') {
            matchCriteria['visitDate'] = {$gte: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks')), $lte: new Date(moment.tz("America/New_York").endOf('week').subtract(1, 'weeks'))}
        } else if (request.query.filter === 'thisMonth') {
            matchCriteria['visitDate'] = {$gte: new Date(moment.tz("America/New_York").startOf('month')), $lte: new Date(moment.tz("America/New_York").endOf('month'))}
        } else if (request.query.filter === 'lastMonth') {
            matchCriteria['visitDate'] = {$gte: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months')), $lte: new Date(moment.tz("America/New_York").endOf('month').subtract(1, 'months'))}
        } else if (request.query.filter === 'thisYear') {
            matchCriteria['visitDate'] = {$gte: new Date(moment.tz("America/New_York").startOf('year')), $lte: new Date(moment.tz("America/New_York").endOf('year'))}
        } else if (request.query.filter === 'lastYear') {
            matchCriteria['visitDate'] = {$gte: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years')), $lte: new Date(moment.tz("America/New_York").endOf('year').subtract(1, 'years'))}
        }
    }

    /* Count total number of employers visited */
    try {
        dataToReturn.employersVisited = await campusInterviewSchema.campusInterviewSchema.countDocuments(matchCriteria);
    } catch (e) {
        logger.error('Error occurred while counting employer visited in get dashboard data campus interview handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Create match criteria for getting other parameters */
    let matchCriteriaStatus = {
        paId: mongoose.Types.ObjectId(request.query.userId)
    }, filterCriteria = {}, aggregateCriteria = [];

    if (request.query.filter) {
        if (request.query.filter === 'thisWeek') {
            matchCriteriaStatus['createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('week')), $lte: new Date(moment.tz("America/New_York").endOf('week'))}
        } else if (request.query.filter === 'lastWeek') {
            matchCriteriaStatus['createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('week').subtract(1, 'weeks')), $lte: new Date(moment.tz("America/New_York").endOf('week').subtract(1, 'weeks'))}
        } else if (request.query.filter === 'thisMonth') {
            matchCriteriaStatus['createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('month')), $lte: new Date(moment.tz("America/New_York").endOf('month'))}
        } else if (request.query.filter === 'lastMonth') {
            matchCriteriaStatus['createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('month').subtract(1, 'months')), $lte: new Date(moment.tz("America/New_York").endOf('month').subtract(1, 'months'))}
        } else if (request.query.filter === 'thisYear') {
            matchCriteriaStatus['createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('year')), $lte: new Date(moment.tz("America/New_York").endOf('year'))}
        } else if (request.query.filter === 'lastYear') {
            matchCriteriaStatus['createdAt'] = {$gte: new Date(moment.tz("America/New_York").startOf('year').subtract(1, 'years')), $lte: new Date(moment.tz("America/New_York").endOf('year').subtract(1, 'years'))}
        }
    }

    if (request.query.degreeName) {
        filterCriteria['candidate.employeeInformation.educationPA.level'] = request.query.degreeName;
    }

    if (request.query.major) {
        filterCriteria['candidate.employeeInformation.educationPA.major'] = request.query.major;
    }

    /* Count other parameters */
    let data;
    aggregateCriteria.push({
        $match: matchCriteriaStatus
    });
    if (filterCriteria) {
        aggregateCriteria.push({
            $lookup: {
                localField: 'candidateId',
                foreignField: '_id',
                from: 'User',
                as: 'candidate'
            }
        });
        aggregateCriteria.push({
            $unwind: '$candidate'
        });
        aggregateCriteria.push({
            $match: filterCriteria
        });
    }

    aggregateCriteria.push({
        "$group" : {
            "_id" : {
                "status" : "$status"
            },
            "total" : {
                "$sum" : 1.0
            }
        }
    });
    try {
        data = await candidateStatusSchema.candidateStatusSchema.aggregate(aggregateCriteria);
    } catch (e) {
        logger.error('Error occurred while aggregating candidate status in get dashboard data campus interview handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    const len = data.length;
    for (let i = 0; i < len; i++) {
        if (data[i]._id.status === 'Interviewed') {
            dataToReturn.studentInterviewed = data[i].total
        } else if (data[i]._id.status === 'Offered') {
            dataToReturn.offersMade = data[i].total
        } else if (data[i]._id.status === 'Accepted') {
            dataToReturn.offersAccepted = data[i].total
        }
    }

    /* Get count of upcoming interviews */
    try {
        dataToReturn.upcomingInterviews = await campusInterviewSchema.campusInterviewSchema.countDocuments({paId: mongoose.Types.ObjectId(request.query.userId),visitDate: {$gt: new Date()}});
    } catch (e) {
        logger.error('Error occurred while counting upcoming interviews in get dashboard data campus interview handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(dataToReturn, 'Fetched successfully.', 'success', 200)).code(200);
};

paHandler.sendOTP = async (request, h) => {
    let otp, checkUser;

    /* Check if user already exists */
    try {
        checkUser = await userSchema.UserSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in send otp handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'An account with the given email already exists.', 'error', 409)).code(409);
    }

    /* Generate OTP */
    otp = commonFunctions.Handlers.generateOTP();

    let email = {
        to: [{
            email: request.payload.email,
            type: 'to'
        }],
        important: true,
        merge: true,
        inline_css: true,
        merge_language: 'mailchimp',
        merge_vars: [{
            rcpt: request.payload.email,
            vars: [
                {
                    name: 'otp',
                    content: otp
                }
            ]
        }]
    };
    await mandrill.Handlers.sendTemplate('otp', [], email, true);

    /* Save otp into database */
    const dataToSave = {
        otp: otp,
        email: request.payload.email
    };
    try {
        await otpSchema.otpSchema.findOneAndUpdate({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {$set: dataToSave}, {
            lean: true,
            upsert: true
        });
    } catch (e) {
        logger.error('Error occurred while saving otp in send otp handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'OTP sent successfully', 'success', 200)).code(200);
};

paHandler.verifyOTP = async (request, h) => {
    let checkOtp;

    try {
        checkOtp = await otpSchema.otpSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding otp in verify otp handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkOtp) {
        return h.response(responseFormatter.responseFormatter({}, 'OTP verification failed.', 'error', 400)).code(400);
    } else if (checkOtp.otp !== request.payload.otp) {
        return h.response(responseFormatter.responseFormatter({}, 'Please enter the correct OTP.', 'error', 400)).code(400);
    } else {
        try {
            await otpSchema.otpSchema.findOneAndUpdate({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {$set: {isVerified: true}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating otp in verify otp handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        return h.response(responseFormatter.responseFormatter({}, 'Email verified', 'success', 200)).code(200);
    }
};

paHandler.getCandidates = async (request, h) => {
    let checkUser, decoded, candidates, aggregationCriteria = [], notAcademicSearchCriteria = {}, skillSearchCriteria = {};

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get candidates data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get candidates data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists', 'error', 404)).code(404);
    }

    if (checkUser.isMaster) {
        checkUser.slaveUsers.push(mongoose.Types.ObjectId(checkUser._id));
    } else {
        /* Get the master user (This is temporary) */
        /*try {
            masterUser = await userSchema.UserSchema.findById({_id: checkUser.paId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting master user in get candidates data handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!masterUser) {
            return h.response(responseFormatter.responseFormatter({}, 'Something went wrong! Please contact support.', 'error', 400)).code(400);
        }
        masterUser.slaveUsers.push(mongoose.Types.ObjectId(masterUser._id));*/
    }

    /* Define aggregation criteria */
    /*
    * paId: {$in: checkUser.isMaster ? checkUser.slaveUsers : [mongoose.Types.ObjectId(checkUser._id)]},
    * */
    let searchCriteria = {
        paId: {$in: checkUser.isMaster ? checkUser.slaveUsers : [checkUser._id]},
        isPaEmployer: false,
        isPa: false
    }, sortCriteria = {};

    if (checkUser.membership) {
        searchCriteria.$or = [{membership: checkUser.membership}, {additionalMemberships: checkUser.membership}];
    }

    if (request.query.searchText) {
        const text = decodeURIComponent(request.query.searchText);
        searchCriteria.$or = [{firstName: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {lastName: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {email: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {'employeeInformation.rollNumber': new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}];
        skillSearchCriteria.$or = [{firstName: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {lastName: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {email: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}];
        notAcademicSearchCriteria.$or = [{'candidate.firstName': new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {'candidate.lastName': new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {'candidate.email': new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {'candidate.employeeInformation.rollNumber': new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}];
    }

    if (request.query.degreeName) {
        searchCriteria['employeeInformation.educationPA.level'] = new RegExp(request.query.degreeName.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi');
        notAcademicSearchCriteria['candidate.employeeInformation.educationPA.level'] = new RegExp(request.query.degreeName.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi');
    }
    if (request.query.majorName) {
        searchCriteria['employeeInformation.educationPA.major'] = new RegExp(request.query.majorName.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi');
        notAcademicSearchCriteria['candidate.employeeInformation.educationPA.major'] = new RegExp(request.query.majorName.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi');
    }
    if (request.query.graduationYear) {
        searchCriteria['employeeInformation.educationPA.graduationYear'] = Number(request.query.graduationYear);
        notAcademicSearchCriteria['candidate.employeeInformation.educationPA.graduationYear'] = Number(request.query.graduationYear);
    }
    if (request.query.batch) {
        searchCriteria['employeeInformation.batch'] = request.query.batch;
        notAcademicSearchCriteria['candidate.employeeInformation.batch'] = request.query.batch;
    }
    if (request.query.course) {
        searchCriteria['employeeInformation.course'] = request.query.course;
        notAcademicSearchCriteria['candidate.employeeInformation.course'] = request.query.course;
    }
    if (request.query.appDownload) {
        searchCriteria['hasOwned'] = (request.query.appDownload === 'downloaded');
        skillSearchCriteria['hasOwned'] = (request.query.appDownload === 'downloaded');
        notAcademicSearchCriteria['candidate.hasOwned'] = (request.query.appDownload === 'downloaded');
    }

    if (request.query.type === 'isAcademic') {
        aggregationCriteria.push({$match: searchCriteria});
    } else {
        aggregationCriteria.push({$match: {paId: {$in: checkUser.isMaster ? checkUser.slaveUsers : [mongoose.Types.ObjectId(checkUser._id)]}}});
    }

    if (request.query.sortCriteria) {
        if (request.query.type !== 'isAcademic' && request.query.type !== 'isSkill') {
            if (request.query.sortCriteria === 'invitations') {
                sortCriteria = {invitations: request.query.sortOrder === 'asc' ? 1 : -1};
            } else if (request.query.sortCriteria === 'applications') {
                sortCriteria = {applications: request.query.sortOrder === 'asc' ? 1 : -1};
            } else if (request.query.sortCriteria === 'views') {
                sortCriteria = {views: request.query.sortOrder === 'asc' ? 1 : -1};
            } else if (request.query.sortCriteria === 'searchAppearances') {
                sortCriteria = {searchAppearances: request.query.sortOrder === 'asc' ? 1 : -1};
            }
        } else if (request.query.type === 'isAcademic') {
            if (request.query.sortCriteria === 'name') {
                sortCriteria = {firstName: request.query.sortOrder === 'asc' ? 1 : -1};
            } else if (request.query.sortCriteria === 'rollNumber') {
                sortCriteria = {'employeeInformation.rollNumber': request.query.sortOrder === 'asc' ? 1 : -1};
            } else if (request.query.sortCriteria === 'degreeName') {
                sortCriteria = {'employeeInformation.educationPA.degreeName': request.query.sortOrder === 'asc' ? 1 : -1};
            } else if (request.query.sortCriteria === 'group') {
                sortCriteria = {'employeeInformation.educationPA.level': request.query.sortOrder === 'asc' ? 1 : -1};
            } else if (request.query.sortCriteria === 'cgpa') {
                sortCriteria = {'employeeInformation.educationPA.cgpa': request.query.sortOrder === 'asc' ? 1 : -1};
            } else if (request.query.sortCriteria === 'rank') {
                sortCriteria = {'employeeInformation.educationPA.rank': request.query.sortOrder === 'asc' ? 1 : -1};
            } else if (request.query.sortCriteria === 'graduationYear') {
                sortCriteria = {'employeeInformation.educationPA.graduationYear': request.query.sortOrder === 'asc' ? 1 : -1};
            }
            aggregationCriteria.push({$sort: sortCriteria});
        }
    }

    if (request.query.type === 'isAcademic') {
        if (!request.query.sortCriteria) {
            aggregationCriteria.push({$sort: {_id: 1}});
        }
        aggregationCriteria.push({$skip: request.query.skip});
        aggregationCriteria.push({$limit: request.query.limit});
        aggregationCriteria.push({
            $project: {
                firstName:1 ,
                lastName: 1,
                'employeeInformation.profilePhoto': 1,
                'employeeInformation.rollNumber': 1,
                'employeeInformation.educationPA': 1,
                'employeeInformation.description': 1,
                'employeeInformation.resume': 1,
                'employeeInformation.achievementsModified': 1,
                appDownloaded: '$hasOwned',
                profileCompleted: '$employeeInformation.isComplete',
                paId: 1
            }
        });

        try {
            candidates = await userSchema.UserSchema.aggregate(aggregationCriteria);
        } catch (e) {
            logger.error('Error occurred while aggregating user in get candidates data handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.type !== 'isSkill') {
        /*aggregationCriteria.push({
            $group: {
                _id: '$candidateId',
                invitations: {$sum: {$cond: [{$and: [{$eq: ['$isInvited', true]}, {$cond: [{$setIsSubset: [{$map: {input: [], as: 'el', in: {$add: ['$$el', '$employerId']}}}, (checkUser.isMaster ? checkUser.slaveUsers : [mongoose.Types.ObjectId(checkUser._id)])]}, 0, 1]}]}, 1, 0]}},
                applications: {$sum: {$cond: [{$and: [{$eq: ['$isInvited', false]}, {$eq: ['$isApplied', true]}]}, 1, 0]}}
            }
        });*/
        aggregationCriteria.push({
            $group: {
                _id: '$candidateId',
                invitations: {$sum: {$cond: [{$and: [{$eq: ['$isInvited', true]}, {$cond: [{$setIsSubset: [['$employerId'], (checkUser.isMaster ? checkUser.slaveUsers : [mongoose.Types.ObjectId(checkUser._id)])]}, 0, 1]}]}, 1, 0]}},
                applications: {$sum: {$cond: [{$and: [{$eq: ['$isInvited', false]}, {$eq: ['$isApplied', true]}]}, 1, 0]}}
            }
        });

        if (request.query.sortCriteria === 'invitations' || request.query.sortCriteria === 'applications') {
            aggregationCriteria.push({$sort: sortCriteria});
            aggregationCriteria.push({$skip: request.query.skip});
            aggregationCriteria.push({$limit: request.query.limit});
        }

        aggregationCriteria.push({
            $lookup: {
                localField: '_id',
                foreignField: '_id',
                from: 'User',
                as: 'candidate'
            }
        });

        aggregationCriteria.push({
            $unwind: '$candidate'
        });

        aggregationCriteria.push({$match: notAcademicSearchCriteria});

        if (!request.query.sortCriteria) {
            aggregationCriteria.push({$sort: {_id: 1}});
            aggregationCriteria.push({$skip: request.query.skip});
            aggregationCriteria.push({$limit: request.query.limit});
        }

        aggregationCriteria.push({
            $project: {
                _id: 1,
                email: '$candidate.email',
                firstName: '$candidate.firstName',
                lastName: '$candidate.lastName',
                invitations: 1,
                applications: 1,
                views: {$size: '$candidate.employeeInformation.uniqueViews'},
                searchAppearances: '$candidate.employeeInformation.searchAppearances',
                rollNumber: '$candidate.employeeInformation.rollNumber',
                description: '$candidate.employeeInformation.description',
                resume: '$candidate.employeeInformation.resume',
                appDownloaded: '$candidate.hasOwned',
                profileCompleted: '$candidate.employeeInformation.isComplete',
                profilePhoto: '$candidate.employeeInformation.profilePhoto',
                jobId: 1,
                paId: '$candidate.paId'
            }
        });

        if (request.query.sortCriteria === 'views' || request.query.sortCriteria === 'searchAppearances') {
            aggregationCriteria.push({$sort: sortCriteria});
            aggregationCriteria.push({$skip: request.query.skip});
            aggregationCriteria.push({$limit: request.query.limit});
        } else if (request.query.sortCriteria === 'name') {
            aggregationCriteria.push({
                $sort: {
                    firstName: request.query.sortOrder === 'asc' ? 1 : -1
                }
            });
            aggregationCriteria.push({$skip: request.query.skip});
            aggregationCriteria.push({$limit: request.query.limit});
        } else if (request.query.sortCriteria === 'rollNumber') {
            aggregationCriteria.push({
                $sort: {
                    rollNumber: request.query.sortOrder === 'asc' ? 1 : -1
                }
            });
            aggregationCriteria.push({$skip: request.query.skip});
            aggregationCriteria.push({$limit: request.query.limit});
        }

        try {
            candidates = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
        } catch (e) {
            logger.error('Error occurred while aggregating conversation in get candidates data handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        aggregationCriteria.push({$match: {isPa: false}});
        if (!request.query.sortCriteria) {
            aggregationCriteria.push({$sort: {_id: 1}});
        } else {
            if (request.query.sortCriteria === 'name') {
                sortCriteria = {firstName: request.query.sortOrder === 'asc' ? 1 : -1};
            }
            aggregationCriteria.push({$sort: sortCriteria});
        }

        aggregationCriteria.push({$match: skillSearchCriteria});

        aggregationCriteria.push({$skip: request.query.skip});
        aggregationCriteria.push({$limit: request.query.limit});
        aggregationCriteria.push({
            $project: {
                firstName: 1,
                lastName: 1,
                pastJobTitles: '$employeeInformation.pastJobTitles',
                futureJobTitles: '$employeeInformation.futureJobTitles',
                workAuthorization: '$employeeInformation.workAuthorization',
                securityClearance: '$employeeInformation.securityClearance',
                isRelocatable: '$employeeInformation.isRelocatable',
                skills: '$employeeInformation.skills',
                appDownloaded: '$hasOwned',
                profileCompleted: '$employeeInformation.isComplete',
                paId: 1,
                'employeeInformation.profilePhoto': 1,
                'employeeInformation.rollNumber': 1,
                'employeeInformation.educationPA': 1,
                'employeeInformation.description': 1,
                'employeeInformation.resume': 1,
                'employeeInformation.achievementsModified': 1
            }
        });

        try {
            candidates = await userSchema.UserSchema.aggregate(aggregationCriteria);
        } catch (e) {
            logger.error('Error occurred while aggregating user in get candidates data handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(candidates, 'Fetched successfully', 'success', 200)).code(200);
};

paHandler.uploadBulkDataFromCSV = async (request, h) => {
    let fileName = request.payload.file.filename, candidateCount = 0, checkUser, decoded, checkJob, uploadData, result, totalCount = 0, config, isExposedToAll = true;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in upload candidates data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in upload candidates data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    const ext = fileName.split('.')[1];

    if (ext !== 'xls' && ext !== 'xlsx') {
        return h.response(responseFormatter.responseFormatter({}, 'The given file is not a xls file', 'error', 400)).code(400);
    }

    /* Check if placement officer has posted a job or not */
    try {
        checkJob = await jobSchema.jobSchema.findOne({userId: request.payload.userId, isVisible: false}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding job in get candidates data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkJob) {
        return h.response(responseFormatter.responseFormatter({}, 'No job found for the placement officer', 'error', 404)).code(404);
    }

    try {
        result = await commonFunctions.Handlers.parseExcelForPA(request.payload.file.path);
    } catch (e) {
        logger.error('Error occurred parsing excel file in get candidates data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error while parsing excel file', 'error', 500)).code(500);
    }

    const len = result.length;

    /* Create a record for history */
    const uploadHistory = {
        fileName: fileName,
        paId: mongoose.Types.ObjectId(request.payload.userId),
        status: 'Pending',
        uploadCount: 0,
        degree: request.payload.degreeName,
        graduationYear: request.payload.graduationYear,
        major: request.payload.majorName
    };

    uploadData = new uploadHistorySchema.uploadHistory(uploadHistory);

    try {
        await uploadData.save();
    } catch (e) {
        logger.error('Error occurred while saving upload data in get candidates data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* If course and batch exists then add it into the user */
    if (request.payload.course && request.payload.batch) {
        let checkAutoComplete;

        try {
            checkAutoComplete = await autoCompleteTrainingInstituteSchema.autoCompleteTrainingInstituteSchema.findOne({userId: mongoose.Types.ObjectId(request.payload.userId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding autocomplete training institute data in upload candidates data handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (checkAutoComplete) {
            try {
                await autoCompleteTrainingInstituteSchema.autoCompleteTrainingInstituteSchema.findOneAndUpdate({userId: mongoose.Types.ObjectId(request.payload.userId)}, {$addToSet: {courses: request.payload.course, batches: request.payload.batch}}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while updating autocomplete training institute data in upload candidates data handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        } else {
            const dataToSave = {
                userId: mongoose.Types.ObjectId(request.payload.userId),
                courses: [request.payload.course],
                batches: [request.payload.batch]
            };

            try {
                await new autoCompleteTrainingInstituteSchema.autoCompleteTrainingInstituteSchema(dataToSave).save();
            } catch (e) {
                logger.error('Error occurred while saving autocomplete training institute data in upload candidates data handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }

    /* Get configuration data for PA */
    try {
        config = await paConfigSchema.paConfigSchema.findOne({paId: checkUser._id}, {isExposedToAll: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding configuration data in upload candidates data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (config && config.isExposedToAll) {
        if (config.isExposedToAll.length) {
            isExposedToAll = !!config.isExposedToAll[0];
        }
    }

    for (let i = 0; i < len; i++) {
        let checkCandidate;
        const data = result[i];

        /* Search whether this user is already present in the database or not */
        if (data['Email']) {
            totalCount++;
            try {
                checkCandidate = await userSchema.UserSchema.findOne({email: data['Email']}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding user in uploadBulkDataFromCSV PA handler %s:', JSON.stringify(e));
                /* Update upload data */
                try {
                    await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Error'}}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while upload history details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                }
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if (!checkCandidate) {
                /*if ((data['Degree'].toLowerCase() === request.payload.degree.toLowerCase()) && (data['Major'].toLowerCase() === request.payload.major.toLowerCase()) && (Number(data['Graduation year']) === request.payload.graduationYear)) {*/
                    const tempPassword = commonFunctions.Handlers.generatePassword();
                    let dataToSave = {
                        firstName: data['First name'],
                        lastName: data['Last name'],
                        email: data['Email'],
                        'employeeInformation.rollNumber': data['Roll number'],
                        'employeeInformation.educationPA': {
                            university: data['College name'] ? data['College name'] : '',
                            level: data['Degree'] ? data['Degree'] : '',
                            graduationYear: Number(data['Graduation year']) ? Number(data['Graduation year']) : 0,
                            major: data['Major'] ? data['Major'] : '',
                            cgpa: Number(data['CGPA']) ? Number(data['CGPA']) : 0,
                            rank: Number(data['Rank']) ? Number(data['Rank']) : 0
                        },
                        'employeeInformation.education': [{
                            university: checkUser.isUniversity ? data['College name'] : '',
                            level: checkUser.isUniversity ? data['Degree'] : '',
                            graduationYear: checkUser.isUniversity ? Number(data['Graduation year']) : 0,
                            major: checkUser.isUniversity ? data['Major'] : '',
                            cgpa: checkUser.isUniversity ? Number(data['CGPA']) : 0,
                            rank: checkUser.isUniversity ? Number(data['Rank']) : 0
                        }],
                        'employeeInformation.skills': data['Skills'].split(','),
                        'employeeInformation.dob': {
                            day: data['DOB'] ? data['DOB'].split('/')[0] : '',
                            month: data['DOB'] ? data['DOB'].split('/')[1] : '',
                            year: data['DOB'] ? data['DOB'].split('/')[2] : ''
                        },
                        'employeeInformation.resume': data['Resume link'],
                        roles: ['Candidate'],
                        'employeeInformation.location': checkUser.employerInformation.companyLocation,
                        'employerInformation.companyLocation': checkUser.employerInformation.companyLocation,
                        'employerInformation.companyAddress': checkUser.employerInformation.companyAddress,
                        'employeeInformation.address': checkUser.employerInformation.companyAddress,
                        'employeeInformation.country': checkUser.country,
                        'employerInformation.country': checkUser.country,
                        country: checkUser.country,
                        'employeeInformation.countryCode': checkUser.employerInformation.countryCode,
                        'employeeInformation.phone': data['Phone number'],
                        'employeeInformation.course': request.payload.course ? request.payload.course : '',
                        'employeeInformation.batch': request.payload.batch ? request.payload.batch : '',
                        isAddedByBulkUploadPA: true,
                        paId: mongoose.Types.ObjectId(request.payload.userId),
                        tempPassword: tempPassword,
                        password: tempPassword,
                        hasInstalled: false,
                        membership: checkUser.membership ? checkUser.membership : '',
                        isExposedToAll: isExposedToAll,
                        isRoleSet: true
                    };
                    if (dataToSave['employeeInformation.skills'][0] !== '') {
                        dataToSave['employeeInformation.skillsLower'] = dataToSave['employeeInformation.skills'].map(s => s.toLowerCase());
                    }
                    if (!dataToSave['employeeInformation.education'][0].university) {
                        dataToSave['employeeInformation.education'] = [];
                    }

                    dataToSave['employeeInformation.preferredLocations'] = {
                        type: 'MultiPoint',
                        coordinates: [checkUser.employerInformation.companyLocation.coordinates]
                    };

                dataToSave['employeeInformation.preferredLocationCities'] = [
                    {
                        city: checkUser.employerInformation.companyAddress.city,
                        state: checkUser.employerInformation.companyAddress.state,
                        country: checkUser.employerInformation.country,
                        latitude: checkUser.employerInformation.companyLocation.coordinates[1],
                        longitude: checkUser.employerInformation.companyLocation.coordinates[0]
                    }
                ];

                    const saveData = new userSchema.UserSchema(dataToSave);
                    try {
                        await saveData.save();
                    } catch (e) {
                        logger.error('Error occurred saving user in uploadBulkDataFromCSV PA handler %s:', JSON.stringify(e));
                        /* Update upload data */
                        try {
                            await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Error'}}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred while upload history details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                        }
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }

                    candidateCount++;

                    /* Create a chat with the placement officer */
                    const chatToSave = {
                        roomId: saveData._id.toString() + request.payload.userId + checkJob._id.toString(),
                        candidateId: mongoose.Types.ObjectId(saveData._id),
                        employerId: mongoose.Types.ObjectId(request.payload.userId),
                        jobId: mongoose.Types.ObjectId(checkJob._id),
                        isApplied: true,
                        isInvited: true,
                        hasEmployerDeleted: false,
                        hasCandidateDeleted: false,
                        isCandidateBlocked: false,
                        isEmployerBlocked: false,
                        paId: mongoose.Types.ObjectId(checkUser._id),
                        chats: [{
                            from: mongoose.Types.ObjectId(request.payload.userId),
                            to: mongoose.Types.ObjectId(saveData._id),
                            body: aes256.encrypt(key, 'This is your placement officer.'),
                            originalBody: aes256.encrypt(key, 'This is your placement officer.'),
                            type: 'isText',
                            duration: 0,
                            latitude: '',
                            longitude: '',
                            isRead: false,
                            hasEmployerDeleted: false,
                            hasCandidateDeleted: false,
                            isCandidateBlocked: false,
                            isEmployerBlocked: false,
                            isEncrypted: true,
                            isTranslated: false
                        }]
                    };

                    try {
                        await new conversationSchema.conversationSchema(chatToSave).save();
                    } catch (e) {
                        logger.error('Error occurred saving chat in uploadBulkDataFromCSV PA handler %s:', JSON.stringify(e));
                        /* Update upload data */
                        try {
                            await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Error'}}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred while upload history details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                        }
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }

                    /* Send email to the candidates for with the password and link to download the app */
                    if (dataToSave.email) {
                        let email;
                        try {
                            /* Create dynamic link */
                            const shortLink = await commonFunctions.Handlers.createFirebaseShortLink(dataToSave.email, '', '');
                            if (checkUser.isNonProfit) {
                                email = {
                                    to: [{
                                        email: dataToSave.email,
                                        type: 'to'
                                    }],
                                    important: true,
                                    subject: checkUser.employerInformation.companyName + ' has invited you to join them',
                                    merge: true,
                                    inline_css: true,
                                    merge_language: 'mailchimp',
                                    merge_vars: [{
                                        rcpt: dataToSave.email,
                                        vars: [
                                            {
                                                name: 'fname',
                                                content: dataToSave.firstName.trim()
                                            },
                                            {
                                                name: 'email',
                                                content: dataToSave.email
                                            },
                                            {
                                                name: 'password',
                                                content: dataToSave.tempPassword
                                            },
                                            {
                                                name: 'downloadURL',
                                                content: shortLink.shortLink
                                            },
                                            {
                                                name: 'paname',
                                                content: checkUser.firstName
                                            }
                                        ]
                                    }]
                                };
                                try {
                                    await mandrill.Handlers.sendTemplate('invitation-mail-to-students-tie-to-join-ezpa', [], email, true);
                                } catch (e) {
                                    logger.error('Error occurred while sending invitation email in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                                }
                            } else {
                                email = {
                                    to: [{
                                        email: dataToSave.email,
                                        type: 'to'
                                    }],
                                    important: true,
                                    subject: checkUser.employerInformation.companyName + ' has invited you to join them',
                                    merge: true,
                                    inline_css: true,
                                    merge_language: 'mailchimp',
                                    merge_vars: [{
                                        rcpt: dataToSave.email,
                                        vars: [
                                            {
                                                name: 'fname',
                                                content: dataToSave.firstName.trim()
                                            },
                                            {
                                                name: 'email',
                                                content: dataToSave.email
                                            },
                                            {
                                                name: 'password',
                                                content: dataToSave.tempPassword
                                            },
                                            {
                                                name: 'downloadURL',
                                                content: shortLink.shortLink
                                            }
                                        ]
                                    }]
                                };
                                try {
                                    await mandrill.Handlers.sendTemplate('mail-to-consultants-ezpa', [], email, true);
                                } catch (e) {
                                    logger.error('Error occurred while sending invitation email in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                                }
                            }

                            try {
                                checkUser = await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, {$set: {'employeeInformation.lastEmailSent': Date.now()}, $inc: {'employeeInformation.numberOfEmailsSent': 1}}, {lean: true, new: true});
                            } catch (e) {
                                logger.error('Error occurred while updating user details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                                /* Update upload data */
                                try {
                                    await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Error'}}, {lean: true});
                                } catch (e) {
                                    logger.error('Error occurred while upload history details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                                }
                                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                            }
                        } catch (e) {
                            logger.error('Error in sending app download link to user %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }
                    }
                /*} else {
                    /!* Update upload data *!/
                    try {
                        await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Error'}}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while upload history details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                    }
                }*/
            }
        }
    }

    /* Update upload data */
    try {
        await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Complete'}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while upload history details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter({}, 'Uploaded successfully', 'success', 200)).code(200);
};

paHandler.uploadBulkDataFromCSVNonProfit = async (request, h) => {
    let fileName = request.payload.file.filename, candidateCount = 0, checkUser, decoded, checkJob, uploadData, result, totalCount = 0;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in upload candidates data for non profit handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in upload candidates datafor non profit handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    const ext = fileName.split('.')[1];

    if (ext !== 'xls' && ext !== 'xlsx') {
        return h.response(responseFormatter.responseFormatter({}, 'The given file is not a xls file', 'error', 400)).code(400);
    }

    /* Check if placement officer has posted a job or not */
    try {
        checkJob = await jobSchema.jobSchema.findOne({userId: request.payload.userId, isVisible: false}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding job in get candidates data for non profit handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkJob) {
        return h.response(responseFormatter.responseFormatter({}, 'No job found for the placement officer', 'error', 404)).code(404);
    }

    try {
        result = await commonFunctions.Handlers.parseExcelForPA(request.payload.file.path);
    } catch (e) {
        logger.error('Error occurred parsing excel file in get candidates data for non profit handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error while parsing excel file', 'error', 500)).code(500);
    }

    const len = result.length;

    /* Create a record for history */
    const uploadHistory = {
        fileName: fileName,
        paId: mongoose.Types.ObjectId(request.payload.userId),
        status: 'Pending',
        uploadCount: 0,
        degree: 'Not applicable',
        graduationYear: 0,
        major: 'Not applicable'
    };

    uploadData = new uploadHistorySchema.uploadHistory(uploadHistory);

    try {
        await uploadData.save();
    } catch (e) {
        logger.error('Error occurred while saving upload data in get candidates data for non profit handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < len; i++) {
        let checkCandidate;
        const data = result[i];

        /* Search whether this user is already present in the database or not */
        if (data['Email']) {
            totalCount++;
            try {
                checkCandidate = await userSchema.UserSchema.findOne({email: data['Email']}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding user in uploadBulkDataFromCSV PA for non profit handler %s:', JSON.stringify(e));
                /* Update upload data */
                try {
                    await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Error'}}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while upload history details in uploadBulkDataFromCSV for non profit handler %s:', JSON.stringify(e));
                }
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if (!checkCandidate) {
                const tempPassword = commonFunctions.Handlers.generatePassword();
                let dataToSave = {
                    firstName: data['First name'] ? data['First name'] : '',
                    lastName: data['Last name'] ? data['Last name'] : '',
                    email: data['Email'],
                    roles: ['Candidate'],
                    'employeeInformation.location': checkUser.employerInformation.companyLocation,
                    'employerInformation.companyLocation': checkUser.employerInformation.companyLocation,
                    'employeeInformation.address': checkUser.employerInformation.companyAddress,
                    'employeeInformation.country': checkUser.country,
                    'employerInformation.country': checkUser.country,
                    country: checkUser.country,
                    isAddedByBulkUploadPA: true,
                    paId: mongoose.Types.ObjectId(request.payload.userId),
                    tempPassword: tempPassword,
                    password: tempPassword,
                    hasInstalled: false,
                    membership: checkUser.membership ? checkUser.membership : '',
                    isRoleSet: true
                };

                dataToSave['employeeInformation.preferredLocations'] = {
                    type: 'MultiPoint',
                    coordinates: [checkUser.employerInformation.companyLocation.coordinates]
                };

                dataToSave['employeeInformation.preferredLocationCities'] = [
                    {
                        city: checkUser.employerInformation.companyAddress.city,
                        state: checkUser.employerInformation.companyAddress.state,
                        country: checkUser.employerInformation.country,
                        latitude: checkUser.employerInformation.companyLocation.coordinates[1],
                        longitude: checkUser.employerInformation.companyLocation.coordinates[0]
                    }
                ];

                const saveData = new userSchema.UserSchema(dataToSave);
                try {
                    await saveData.save();
                } catch (e) {
                    logger.error('Error occurred saving user in uploadBulkDataFromCSV PA for non profit handler %s:', JSON.stringify(e));
                    /* Update upload data */
                    try {
                        await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Error'}}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while upload history details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                    }
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                candidateCount++;

                /* Create a chat with the placement officer */
                const chatToSave = {
                    roomId: saveData._id.toString() + request.payload.userId + checkJob._id.toString(),
                    candidateId: mongoose.Types.ObjectId(saveData._id),
                    employerId: mongoose.Types.ObjectId(request.payload.userId),
                    jobId: mongoose.Types.ObjectId(checkJob._id),
                    isApplied: true,
                    isInvited: true,
                    hasEmployerDeleted: false,
                    hasCandidateDeleted: false,
                    isCandidateBlocked: false,
                    isEmployerBlocked: false,
                    paId: mongoose.Types.ObjectId(checkUser._id),
                    chats: [{
                        from: mongoose.Types.ObjectId(request.payload.userId),
                        to: mongoose.Types.ObjectId(saveData._id),
                        body: aes256.encrypt(key, 'This is your placement officer.'),
                        originalBody: aes256.encrypt(key, 'This is your placement officer.'),
                        type: 'isText',
                        duration: 0,
                        latitude: '',
                        longitude: '',
                        isRead: false,
                        hasEmployerDeleted: false,
                        hasCandidateDeleted: false,
                        isCandidateBlocked: false,
                        isEmployerBlocked: false,
                        isEncrypted: true,
                        isTranslated: false
                    }]
                };

                try {
                    await new conversationSchema.conversationSchema(chatToSave).save();
                } catch (e) {
                    logger.error('Error occurred saving chat in uploadBulkDataFromCSV PA for non profit handler %s:', JSON.stringify(e));
                    /* Update upload data */
                    try {
                        await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Error'}}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while upload history details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                    }
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                /* Send email to the candidates for with the password and link to download the app */
                if (dataToSave.email) {
                    let email;
                    try {
                        /* Create dynamic link */
                        const shortLink = await commonFunctions.Handlers.createFirebaseShortLink(dataToSave.email, '', '');
                        email = {
                            to: [{
                                email: dataToSave.email,
                                type: 'to'
                            }],
                            important: true,
                            subject: checkUser.employerInformation.companyName + ' has invited you to join them',
                            merge: true,
                            inline_css: true,
                            merge_language: 'mailchimp',
                            merge_vars: [{
                                rcpt: dataToSave.email,
                                vars: [
                                    {
                                        name: 'fname',
                                        content: 'Student'
                                    },
                                    {
                                        name: 'email',
                                        content: dataToSave.email
                                    },
                                    {
                                        name: 'password',
                                        content: dataToSave.tempPassword
                                    },
                                    {
                                        name: 'downloadURL',
                                        content: shortLink.shortLink
                                    },
                                    {
                                        name: 'paname',
                                        content: (checkUser.firstName + ' ' + checkUser.lastName).trim()
                                    },
                                    {
                                        name: 'companyName',
                                        content: checkUser.employerInformation.companyName
                                    },
                                    {
                                        name: 'community',
                                        content: checkUser.membership.toString() === '611aa6d519add1146d831b72' ? 'Sri Venkateswara Hindu Temple' : 'ITServe Alliance CSR'
                                    }
                                ]
                            }]
                        };
                        try {
                            if (process.env.NODE_ENV === 'production') {
                                if (checkUser.membership.toString() === '601b296b1518584fb3e1d52e') {
                                    await mandrill.Handlers.sendTemplate('invitation-mail-to-students-tie-to-join-ezpa', [], email, true);
                                } else if (checkUser.membership.toString() === '611aa6d519add1146d831b72') {
                                    await mandrill.Handlers.sendTemplate('invitation-mail-to-students-temple-ezpa', [], email, true);
                                } else {
                                    await mandrill.Handlers.sendTemplate('invitation-mail-to-students-its-to-join-ezpa', [], email, true);
                                }
                            } else {
                                await mandrill.Handlers.sendTemplate('invitation-mail-to-students-tie-to-join-ezpa', [], email, true);
                            }
                        } catch (e) {
                            logger.error('Error occurred while sending invitation email in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                        }

                        try {
                            checkUser = await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, {$set: {'employeeInformation.lastEmailSent': Date.now()}, $inc: {'employeeInformation.numberOfEmailsSent': 1}}, {lean: true, new: true});
                        } catch (e) {
                            logger.error('Error occurred while updating user details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                            /* Update upload data */
                            try {
                                await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Error'}}, {lean: true});
                            } catch (e) {
                                logger.error('Error occurred while upload history details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                            }
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }
                    } catch (e) {
                        logger.error('Error in sending app download link to user %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }
            }
        }
    }

    /* Update upload data */
    try {
        await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Complete'}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while upload history details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter({}, 'Uploaded successfully', 'success', 200)).code(200);
};

paHandler.getUploadHistory = async (request, h) => {
    let checkUser, decoded, history;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in upload history data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in upload history data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Get history data */
    try {
        history = await uploadHistorySchema.uploadHistory.find({paId: mongoose.Types.ObjectId(request.query.userId), isEmployer: !!request.query.isEmployer}, {}, {lean: true}).sort({createdAt: -1}).populate('paId', 'firstName lastName');
    } catch (e) {
        logger.error('Error occurred while finding history data in upload history data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(history, 'Fetched successfully', 'success', 200)).code(200);
};

paHandler.sendMessage = async (request, h) => {
    let checkUser, decoded, checkJob, mailServer;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in send message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in send message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Get mail server data */
    try {
        mailServer = await mailServerSchema.mailServerSchema.findOne({userId: mongoose.Types.ObjectId(request.payload.userId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding mail server in send message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    /*if (!mailServer) {
        return h.response(responseFormatter.responseFormatter({}, 'Please configure the mail server to send emails.', 'error', 404)).code(404);
    }*/

    /* Get the job data for the employer */
    try {
        checkJob = await jobSchema.jobSchema.findOne({userId: mongoose.Types.ObjectId(request.payload.userId), isVisible: false}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding job in send message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send the message to the candidates */
    if (request.payload.isEmail) {
        if (!request.payload.subject) {
            return h.response(responseFormatter.responseFormatter({}, 'Subject is required for sending emails', 'error', 400)).code(400);
        }
    }

    const len = request.payload.candidateIds.length;
    for (let i = 0; i < len; i++) {
        let candidateData;

        /* Fetch candidate data */
        try {
            candidateData = await userSchema.UserSchema.findById({_id: request.payload.candidateIds[i]}, {paId: 1, deviceToken: 1, deviceType: 1, email: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding candidate in send message handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Check if PA is associated with the given candidate */
        if (!candidateData) {
            return h.response(responseFormatter.responseFormatter({}, 'No such user found.', 'error', 404)).code(404);
        }

        if (request.payload.isInApp) {
            const dataToPush = {
                from: mongoose.Types.ObjectId(request.payload.userId),
                to: mongoose.Types.ObjectId(request.payload.candidateIds[i]),
                body: aes256.encrypt(key, request.payload.body),
                originalBody: aes256.encrypt(key, request.payload.body),
                type: 'isText',
                duration: 0,
                latitude: '',
                longitude: '',
                isRead: false,
                hasEmployerDeleted: false,
                hasCandidateDeleted: false,
                isCandidateBlocked: false,
                isEmployerBlocked: false,
                isEncrypted: true,
                isTranslated: false
            };
            let update;
            try {
                update = await conversationSchema.conversationSchema.findOneAndUpdate({employerId: mongoose.Types.ObjectId(checkUser._id), candidateId: mongoose.Types.ObjectId(request.payload.candidateIds[i]), jobId: mongoose.Types.ObjectId(checkJob._id)}, {$push: {chats: dataToPush}}, {lean: true, new: true});
            } catch (e) {
                logger.error('Error occurred while updating conversation in send message handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if (update) {
                let payloadToSend = {
                    employerId: checkUser._id,
                    candidateId: request.payload.candidateIds[i],
                    jobId: checkJob._id,
                    role: 'candidate',
                    pushType: 'chat',
                    chatId: update._id,
                    type: 'isText'
                };

                push.createMessage(candidateData.deviceToken, [], payloadToSend, candidateData.deviceType, checkUser.firstName + ' ' + checkUser.lastName, request.payload.body, 'beep', 'chat_' + checkUser._id, 'EZJobs_chat');
            } else {
                /* Create a chat with the placement officer */
                const chatToSave = {
                    roomId: candidateData._id.toString() + request.payload.userId + checkJob._id.toString(),
                    candidateId: mongoose.Types.ObjectId(candidateData._id),
                    employerId: mongoose.Types.ObjectId(request.payload.userId),
                    jobId: mongoose.Types.ObjectId(checkJob._id),
                    isApplied: true,
                    isInvited: true,
                    hasEmployerDeleted: false,
                    hasCandidateDeleted: false,
                    isCandidateBlocked: false,
                    isEmployerBlocked: false,
                    paId: mongoose.Types.ObjectId(checkUser._id),
                    chats: [{
                        from: mongoose.Types.ObjectId(request.payload.userId),
                        to: mongoose.Types.ObjectId(candidateData._id),
                        body: aes256.encrypt(key, request.payload.body),
                        originalBody: aes256.encrypt(key, request.payload.body),
                        type: 'isText',
                        duration: 0,
                        latitude: '',
                        longitude: '',
                        isRead: false,
                        hasEmployerDeleted: false,
                        hasCandidateDeleted: false,
                        isCandidateBlocked: false,
                        isEmployerBlocked: false,
                        isEncrypted: true,
                        isTranslated: false
                    }]
                };

                try {
                    await new conversationSchema.conversationSchema(chatToSave).save();
                } catch (e) {
                    logger.error('Error occurred saving chat in upload individual candidate handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            }
        }
        if (request.payload.isEmail) {
            let status;
            if (!request.payload.password) {
                try {
                    status = await commonFunctions.Handlers.nodeMailerEZJobs('support@ezjobs.io', 'Email from ' + checkUser.firstName + ': ' + request.payload.subject, request.payload.body, candidateData.email);
                } catch (e) {
                    logger.error('Error in sending email to employers while sending message %s:', e);
                }
            } else {
                let sender = checkUser.employerInformation.companyName + ' <' + mailServer.email + '>';
                const mailOptions = {
                    from: sender,
                    to: candidateData.email,
                    subject: request.payload.subject,
                    text: request.payload.body
                };
                try {
                    status = await nodeMailer.createTransport({
                        host: mailServer.host,
                        port: mailServer.port,
                        secure: mailServer.port === 465 ? true : false,
                        auth: {
                            user: mailServer.email,
                            pass: request.payload.password
                        }
                    }).sendMail(mailOptions);
                } catch (e) {
                    logger.error('Error in sending create account email in add user handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'Error occurred while sending email. Please check the information provided in the configuration.', 'error', 400)).code(400);
                }
            }
        }
    }

    return h.response(responseFormatter.responseFormatter({}, 'Message sent successfully.', 'success', 200)).code(200);
};

paHandler.updateConfig = async (request, h) => {
    let checkPA, decoded;

    /* Check if user exists */
    try {
        checkPA = await userSchema.UserSchema.findById({_id: request.payload.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in update config handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPA) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkPA.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to access the resource */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update config handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Update the data accordingly */
    const dataToUpdate = {
        paId: mongoose.Types.ObjectId(request.payload.paId),
        degree: request.payload.degree ? request.payload.degree : [],
        major: request.payload.major ? request.payload.major : []
    };

    try {
        await paConfigSchema.paConfigSchema.findByIdAndUpdate({_id: request.payload.paId}, {$set: dataToUpdate}, {lean: true, upsert: true});
    } catch (e) {
        logger.error('Error occurred while updating configuration in update config handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Configuration updated.', 'success', 204)).code(200);
};

paHandler.getConfig = async (request, h) => {
    let checkPA, decoded, configData = {};

    /* Check if user exists */
    try {
        checkPA = await userSchema.UserSchema.findById({_id: request.query.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get config handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPA) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkPA.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to access the resource */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get config handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Get config data */
    try {
        configData = await paConfigSchema.paConfigSchema.findOne({paId: mongoose.Types.ObjectId(request.query.paId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting config data in get config handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(configData ? configData : {}, 'Fetched successfully', 'success', 200)).code(200);
};

paHandler.tokenLoginPA = async (request, h) => {
    let decoded, checkUser, updatedUser, checkJob, constantData, menus = [], config = [], region, chapter;

    /* Check if user is actually who is trying to login */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in token login pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user exists or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.userId)}, {password: 0}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in token login pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Fetch constant data */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding constant data in create user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update user information in the database */
    let dataToUpdate = {
        appVersionPA: request.query.appVersion,
        timeZone: request.query.timeZone,
        deviceType: request.query.deviceType,
        deviceId: request.query.deviceId ? request.query.deviceId : ''
    };
    if (request.query.deviceToken) {
        dataToUpdate.deviceToken = request.query.deviceToken;
    }
    try {
        updatedUser = await userSchema.UserSchema.findByIdAndUpdate({_id: mongoose.Types.ObjectId(request.query.userId)}, {$set: dataToUpdate}, {lean: true, new: true});
        if (updatedUser) {
            delete updatedUser.password;
        }
    } catch (e) {
        logger.error('Error occurred while updating user in token login handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get the job details */
    try {
        checkJob = await jobSchema.jobSchema.findOne({userId: mongoose.Types.ObjectId(checkUser._id)}, {_id: 1, jobTitle: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding job in token login handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkJob) {
        updatedUser.jobTitle = checkJob.jobTitle;
        updatedUser.jobId = checkJob._id;
    }

    /* Remove device token of all other devices having same device token */
    let bulk = userSchema.UserSchema.collection.initializeUnorderedBulkOp();
    bulk
        .find({_id: {$ne: updatedUser._id}, deviceToken: updatedUser.deviceToken})
        .update({$set: {deviceToken: ''}});
    try {
        await bulk.execute();
    } catch (e) {
        logger.error('Error occurred while removing other device tokens in auth user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (constantData.memberships) {
        const idx = constantData.memberships.findIndex(k => k._id.toString() === updatedUser.membership);
        if (idx !== -1) {
            updatedUser.membership = constantData.memberships[idx].name;
        }
    }

    /* Fetch menu data */
    let type = checkUser.isUniversity ? 'University' : (checkUser.isConsulting ? 'Consulting' : (checkUser.isNonProfit ? 'Non-profit': (checkUser.isTraining ? 'Training' : '')));
    try {
        menus = await menuConfigSchema.menuConfigSchema.findOne({platform: 'PA', type: type}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding menus data in token login PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    updatedUser.menus = menus;

    /* Fetch configuration data*/
    try {
        config = await configurationSchema.configurationSchema.findOne({isUniversity: checkUser.isUniversity, isNonProfit: checkUser.isNonProfit, isTraining: checkUser.isTraining, isConsulting: checkUser.isConsulting}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding configuration data in token login PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    let updatedData;
    try {
        updatedData = await paConfigSchema.paConfigSchema.findOne({paId: checkUser._id}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding configuration data in token login PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (config) {
        const idx = config.filter.findIndex(k => k.key === 'network');
        if (idx !== -1) {
            let filters = config.filter[idx].filters;
            const idxMembership = filters.findIndex(k => k.key === 'membershipId');
            if (idxMembership !== -1) {
                let memberships = [];
                for (let i = 0; i < constantData.memberships.length; i++) {
                    memberships.push({key: constantData.memberships[i]._id, label: constantData.memberships[i].name});
                }
                config.filter[idx].filters[idxMembership].values = memberships;
            }
            const idxGroup = filters.findIndex(k => k.key === 'groupId');
            if (idxGroup !== -1) {
                let groups = [], temp = [];
                /* Get groups */
                try {
                    groups = await groupSchema.groupSchema.find({userId: checkUser._id, isCandidate: false}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred in finding groups data in update new PA config handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                for (let i = 0; i < groups.length; i++) {
                    temp.push({key: groups[i]._id, label: groups[i].groupName});
                }
                config.filter[idx].filters[idxGroup].values = temp;
            }
        }

        const idxCandidate = config.filter.findIndex(k => k.key === 'candidate');
        if (idxCandidate !== -1) {
            let filters = config.filter[idxCandidate].filters;
            const idxGroup = filters.findIndex(k => k.key === 'groupId');
            if (idxGroup !== -1) {
                let groups = [], temp = [];
                /* Get groups */
                try {
                    groups = await groupSchema.groupSchema.find({userId: checkUser._id, isCandidate: true}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred in finding groups data in update new PA config handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                for (let i = 0; i < groups.length; i++) {
                    temp.push({key: groups[i]._id, label: groups[i].groupName});
                }
                config.filter[idxCandidate].filters[idxGroup].values = temp;
            }

            const idxDegree = filters.findIndex(k => k.key === 'degreeName');
            if (idxDegree !== -1) {
                let temp = [];
                if (updatedData && updatedData.degree) {
                    for (let i = 0; i < updatedData.degree.length; i++) {
                        temp.push({key: updatedData.degree[i].name, label: updatedData.degree[i].name});
                    }
                }
                config.filter[idxCandidate].filters[idxDegree].values = temp;
            }

            const idxMajor = filters.findIndex(k => k.key === 'majorName');
            if (idxMajor !== -1) {
                let temp = [];
                if (updatedData && updatedData.major) {
                    for (let i = 0; i < updatedData.major.length; i++) {
                        temp.push({key: updatedData.major[i], label: updatedData.major[i]});
                    }
                }
                config.filter[idxCandidate].filters[idxMajor].values = temp;
            }

            const idxBatch = filters.findIndex(k => k.key === 'batch');
            if (idxBatch !== -1) {
                let temp = [];
                if (updatedData && updatedData.batch) {
                    for (let i = 0; i < updatedData.batch.length; i++) {
                        temp.push({key: updatedData.batch[i], label: updatedData.batch[i]});
                    }
                }
                config.filter[idxCandidate].filters[idxBatch].values = temp;
            }

            const idxCourse = filters.findIndex(k => k.key === 'course');
            if (idxCourse !== -1) {
                let temp = [];
                if (updatedData && updatedData.course) {
                    for (let i = 0; i < updatedData.course.length; i++) {
                        temp.push({key: updatedData.course[i], label: updatedData.course[i]});
                    }
                }
                config.filter[idxCandidate].filters[idxCourse].values = temp;
            }

            const idxJobTitles = filters.findIndex(k => k.key === 'jobTitles');
            if (idxJobTitles !== -1) {
                let temp = [];
                if (updatedData && updatedData.jobTitles) {
                    for (let i = 0; i < updatedData.jobTitles.length; i++) {
                        temp.push({key: updatedData.jobTitles[i], label: updatedData.jobTitles[i]});
                    }
                }
                config.filter[idxCandidate].filters[idxJobTitles].values = temp;
            }

            const idxGraduationYear = filters.findIndex(k => k.key === 'graduationYear');
            if (idxGraduationYear !== -1) {
                let temp = [], currentYear = new Date().getFullYear();
                for (let i = currentYear - 25; i < currentYear + 3; i++) {
                    temp.push({key: i, label: i});
                }
                config.filter[idxCandidate].filters[idxGraduationYear].values = temp;
            }
        }

        if (updatedData) {
            for (let i = 0; i < config.config.length; i++) {
                if (config.config[i].key === 'degreeName') {
                    config.config[i].values = updatedData.degree ? updatedData.degree : [];
                } else if (config.config[i].key === 'majorName') {
                    config.config[i].values = updatedData.major ? updatedData.major : [];
                } else if (config.config[i].key === 'batch') {
                    config.config[i].values = updatedData.batch ? updatedData.batch : [];
                } else if (config.config[i].key === 'course') {
                    config.config[i].values = updatedData.course ? updatedData.course : [];
                } else if (config.config[i].key === 'jobTitles') {
                    config.config[i].values = updatedData.jobTitles ? updatedData.jobTitles : [];
                } else if (config.config[i].key === 'isExposedToAll') {
                    config.config[i].values = updatedData.isExposedToAll ? updatedData.isExposedToAll : [];
                }
            }
        }

        updatedUser.config = config;
    }

    /* Get regions and chapters data */
    if (updatedUser.employerInformation.region) {
        try {
            region = await regionSchema.regionSchema.findById({_id: updatedUser.employerInformation.region}, {name: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding region data in token login PA handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (region) {
            updatedUser.employerInformation.region = region.name;
        }
    }
    if (updatedUser.employerInformation.chapter) {
        try {
            chapter = await chapterSchema.chapterSchema.findById({_id: updatedUser.employerInformation.chapter}, {name: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding chapter data in token login PA handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (chapter) {
            updatedUser.employerInformation.chapter = chapter.name;
        }
    }

    /* Add view data for candidate management in config object */
    updatedUser.config.candidateViewType = updatedUser.isUniversity ? 'isAcademic' : (updatedUser.isConsulting ? 'isSkill' : '');

    return h.response(responseFormatter.responseFormatter(updatedUser, 'Fetched successfully', 'success', 200)).code(200);
};

paHandler.updateProfile = async (request, h) => {
    let decoded, checkUser, imageName, dataToUpdate, status, updatedData;

    /* Check if user is actually who is trying to login */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update profile pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user exists or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.paId)}, {password: 0}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in update profile pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized.', 'error', 401)).code(401);
    }

    /* Check if user is trying to change is profile photo */
    if (request.payload.profilePhoto) {
        /* If profile photo is changed delete old one and update new one */
        if (checkUser.employerInformation.companyProfilePhoto) {
            try {
                status = await commonFunctions.Handlers.deleteImage(checkUser.employerInformation.companyProfilePhoto);
            } catch (e) {
                logger.error('Error occurred while deleting user image in update profile pa handler %s:', JSON.stringify(e));
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
            logger.error('Error occurred while uploading user image in update profile pa handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    dataToUpdate = checkUser;
    if (imageName) {
        if (checkUser.isMaster) {
            dataToUpdate.employerInformation.companyProfilePhoto = imageName;
        }
        dataToUpdate.employeeInformation.profilePhoto = imageName;
    }
    if (request.payload.address) {
        dataToUpdate.employerInformation.companyAddress = request.payload.address;
    }

    dataToUpdate.firstName = request.payload.firstName ? request.payload.firstName : '';
    dataToUpdate.lastName = request.payload.lastName ? request.payload.lastName : '';
    dataToUpdate.employerInformation.companyName = request.payload.companyName ? request.payload.companyName : '';
    dataToUpdate.employerInformation.country = request.payload.country ? request.payload.country : '';
    dataToUpdate.employerInformation.designation = request.payload.designation ? request.payload.designation : '';
    dataToUpdate.employerInformation.countryCode = request.payload.countryCode ? request.payload.countryCode : '';
    dataToUpdate.employerInformation.companyPhone = request.payload.phone ? request.payload.phone : '';
    if (request.payload.region) {
        dataToUpdate.employerInformation.region = mongoose.Types.ObjectId(request.payload.region);
    }
    if (request.payload.chapter) {
        dataToUpdate.employerInformation.chapter = mongoose.Types.ObjectId(request.payload.chapter);
    }
    if (request.payload.vendorType) {
        dataToUpdate.employerInformation.vendorType = mongoose.Types.ObjectId(request.payload.vendorType);
    }
    dataToUpdate.employerInformation.website = request.payload.website ? request.payload.website : '';
    dataToUpdate.employerInformation.memberSince = request.payload.memberSince ? request.payload.memberSince : '';
    dataToUpdate.employerInformation.companyAddress = request.payload.address ? request.payload.address : {address1: '', address2: '', city: '', state: '', zipCode: ''};
    dataToUpdate.employerInformation.companyDescription = request.payload.companyDescription ? request.payload.companyDescription : '';
    dataToUpdate.employerInformation.preferredVendorTo = request.payload.preferredVendorTo ? request.payload.preferredVendorTo : [];
    dataToUpdate.employerInformation.skillsAvailable = request.payload.skillsAvailable ? request.payload.skillsAvailable : [];
    dataToUpdate.employerInformation.skillsPreference = request.payload.skillsPreference ? request.payload.skillsPreference : [];
    dataToUpdate.employerInformation.skillsAvailableLower = request.payload.skillsAvailable ? (request.payload.skillsAvailable.map(x => x.toLowerCase())) : [];
    dataToUpdate.employerInformation.skillsPreferenceLower = request.payload.skillsPreference ? (request.payload.skillsPreference.map(x => x.toLowerCase())) : [];

    dataToUpdate.employerInformation.isComplete = !!dataToUpdate.employerInformation.companyName && !!dataToUpdate.employerInformation.companyAddress.address1;

    /* Update the data */
    try {
        updatedData = await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.paId}, {$set: dataToUpdate}, {lean: true, new: true});
    } catch (e) {
        logger.error('Error occurred while updating user in update profile pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* If master profile is updated then change all child profiles */
    if (checkUser.isMaster) {
        const childData = {
            'employerInformation.website': updatedData.employerInformation.website,
            'employerInformation.memberSince': updatedData.employerInformation.memberSince,
            'employerInformation.companyAddress': updatedData.employerInformation.companyAddress,
            'employerInformation.companyDescription': updatedData.employerInformation.companyDescription,
            'employerInformation.companyName': updatedData.employerInformation.companyName,
            'employerInformation.country': updatedData.employerInformation.country,
            'employerInformation.companyPhone': updatedData.employerInformation.companyPhone,
            'employerInformation.countryCode': updatedData.employerInformation.countryCode,
            'employerInformation.companyProfilePhoto': updatedData.employerInformation.companyProfilePhoto,
            'employerInformation.isComplete': updatedData.employerInformation.isComplete
        }

        for (let i = 0; i < updatedData.slaveUsers.length; i++) {
            try {
                await userSchema.UserSchema.findByIdAndUpdate({_id: updatedData.slaveUsers[i]}, {$set: childData}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while updating slave users in update profile pa handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }

    delete updatedData.password;

    /* Success */
    return h.response(responseFormatter.responseFormatter(updatedData, 'Updated successfully', 'success', 204)).code(200);
};

paHandler.uploadIndividualCandidate = async (request, h) => {
    let decoded, checkUser, resumeName, checkJob, config, isExposedToAll;

    /* Check if user is actually who is trying to login */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in upload individual candidate pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user exists or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.paId)}, {password: 0}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in upload individual candidate pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action', 'error', 400)).code(400);
    }

    /* Check if the account with the given email exists */
    let duplicate;
    try {
        duplicate = await userSchema.UserSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding duplicate user in upload individual candidate pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (duplicate) {
        return h.response(responseFormatter.responseFormatter({}, 'Account with the given email already exists.', 'error', 409)).code(409);
    }

    /* Check job */
    try {
        checkJob = await jobSchema.jobSchema.findOne({userId: mongoose.Types.ObjectId(request.payload.paId), isVisible: false}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding job in upload individual candidate pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (request.payload.resumeFile) {
        /* Upload resume to s3 bucket */
        try {
            resumeName = await commonFunctions.Handlers.uploadImage(request.payload.resumeFile.path, request.payload.resumeFile.filename);
        } catch (e) {
            logger.error('Error occurred while uploading user image in update profile pa handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* If course and batch exists then add it into the user */
    if (request.payload.course && request.payload.batch) {
        let checkAutoComplete;

        try {
            checkAutoComplete = await autoCompleteTrainingInstituteSchema.autoCompleteTrainingInstituteSchema.findOne({userId: mongoose.Types.ObjectId(request.payload.paId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding autocomplete training institute data in upload individual candidate data handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (checkAutoComplete) {
            try {
                await autoCompleteTrainingInstituteSchema.autoCompleteTrainingInstituteSchema.findOneAndUpdate({userId: mongoose.Types.ObjectId(request.payload.paId)}, {$addToSet: {courses: request.payload.course, batches: request.payload.batch}}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while updating autocomplete training institute data in upload individual candidate data handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        } else {
            const dataToSave = {
                userId: mongoose.Types.ObjectId(request.payload.paId),
                courses: [request.payload.course],
                batches: [request.payload.batch]
            };

            try {
                await new autoCompleteTrainingInstituteSchema.autoCompleteTrainingInstituteSchema(dataToSave).save();
            } catch (e) {
                logger.error('Error occurred while saving autocomplete training institute data in upload individual candidate data handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }

    /* Get configuration data for PA */
    try {
        config = await paConfigSchema.paConfigSchema.findOne({paId: checkUser._id}, {isExposedToAll: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding configuration data in upload individual candidates data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (config && config.isExposedToAll) {
        if (config.isExposedToAll.length) {
            console.log(config.isExposedToAll);
            isExposedToAll = !!config.isExposedToAll[0];
        }
    }

    /* Create the candidate data */
    const tempPassword = commonFunctions.Handlers.generatePassword();
    let dataToSave = {
        firstName: request.payload.firstName,
        lastName: request.payload.lastName ? request.payload.lastName : '',
        email: request.payload.email.toLowerCase(),
        'employeeInformation.rollNumber': request.payload.rollNumber ? request.payload.rollNumber : '',
        'employeeInformation.educationPA': {
            university: checkUser.employerInformation.companyName,
            level: request.payload.degreeName,
            graduationYear: request.payload.graduationYear,
            major: request.payload.majorName,
            cgpa: request.payload.cgpa,
            rank: request.payload.rank ? request.payload.rank : undefined
        },
        'employeeInformation.education': [{
            university: checkUser.isUniversity ? checkUser.employerInformation.companyName : '',
            level: checkUser.isUniversity ? request.payload.degreeName : '',
            graduationYear: checkUser.isUniversity ? request.payload.graduationYear : 0,
            major: checkUser.isUniversity ? request.payload.majorName : '',
            cgpa: checkUser.isUniversity ? request.payload.cgpa : 0,
            rank: checkUser.isUniversity ? (request.payload.rank ? request.payload.rank : undefined) : 0
        }],
        'employeeInformation.skills': request.payload.skills ? request.payload.skills : [],
        'employeeInformation.dob': {
            day: request.payload.dob ? request.payload.dob.day : '',
            month: request.payload.dob ? request.payload.dob.month : '',
            year: request.payload.dob ? request.payload.dob.year : ''
        },
        'employeeInformation.resume': request.payload.resumeFile ? resumeName : request.payload.resumeLink,
        roles: ['Candidate'],
        'employeeInformation.location': checkUser.employerInformation.companyLocation,
        'employerInformation.companyLocation': checkUser.employerInformation.companyLocation,
        'employerInformation.companyAddress': checkUser.employerInformation.companyAddress,
        'employeeInformation.address': checkUser.employerInformation.companyAddress,
        'employeeInformation.country': checkUser.country,
        'employerInformation.country': checkUser.country,
        country: checkUser.country,
        'employeeInformation.countryCode': request.payload.countryCode ? request.payload.countryCode : '',
        'employeeInformation.phone': request.payload.phone ? request.payload.phone : '',
        'employeeInformation.course': request.payload.course ? request.payload.course : '',
        'employeeInformation.batch': request.payload.batch ? request.payload.batch : '',
        'employeeInformation.pastJobTitles': request.payload.jobTitles ? [request.payload.jobTitles] : [],
        isAddedByBulkUploadPA: true,
        paId: mongoose.Types.ObjectId(request.payload.paId),
        tempPassword: tempPassword,
        password: tempPassword,
        hasInstalled: false,
        membership: checkUser.membership ? checkUser.membership : '',
        isExposedToAll: isExposedToAll,
        isRoleSet: true
    };
    if (dataToSave['employeeInformation.skills'][0] !== '') {
        dataToSave['employeeInformation.skillsLower'] = dataToSave['employeeInformation.skills'].map(s => s.toLowerCase());
    }

    if (!dataToSave["employeeInformation.education"][0].university) {
        dataToSave["employeeInformation.education"] = [];
    }

    dataToSave['employeeInformation.preferredLocations'] = {
        type: 'MultiPoint',
        coordinates: [checkUser.employerInformation.companyLocation.coordinates]
    };

    dataToSave['employeeInformation.preferredLocationCities'] = [
        {
            city: checkUser.employerInformation.companyAddress.city,
            state: checkUser.employerInformation.companyAddress.state,
            country: checkUser.employerInformation.country,
            latitude: checkUser.employerInformation.companyLocation.coordinates[1],
            longitude: checkUser.employerInformation.companyLocation.coordinates[0]
        }
    ];

    const saveData = new userSchema.UserSchema(dataToSave);
    try {
        await saveData.save();
    } catch (e) {
        logger.error('Error occurred saving user in upload individual candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Create a chat with the placement officer */
    const chatToSave = {
        roomId: saveData._id.toString() + request.payload.paId + checkJob._id.toString(),
        candidateId: mongoose.Types.ObjectId(saveData._id),
        employerId: mongoose.Types.ObjectId(request.payload.paId),
        jobId: mongoose.Types.ObjectId(checkJob._id),
        isApplied: true,
        isInvited: true,
        hasEmployerDeleted: false,
        hasCandidateDeleted: false,
        isCandidateBlocked: false,
        isEmployerBlocked: false,
        paId: mongoose.Types.ObjectId(checkUser._id),
        chats: [{
            from: mongoose.Types.ObjectId(request.payload.paId),
            to: mongoose.Types.ObjectId(saveData._id),
            body: aes256.encrypt(key, 'This is your placement officer.'),
            originalBody: aes256.encrypt(key, 'This is your placement officer.'),
            type: 'isText',
            duration: 0,
            latitude: '',
            longitude: '',
            isRead: false,
            hasEmployerDeleted: false,
            hasCandidateDeleted: false,
            isCandidateBlocked: false,
            isEmployerBlocked: false,
            isEncrypted: true,
            isTranslated: false
        }]
    };

    try {
        await new conversationSchema.conversationSchema(chatToSave).save();
    } catch (e) {
        logger.error('Error occurred saving chat in upload individual candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Create dynamic link */
    const shortLink = await commonFunctions.Handlers.createFirebaseShortLink(dataToSave.email, '', '');
    let email;
    if (checkUser.isNonProfit) {
        email = {
            to: [{
                email: dataToSave.email,
                type: 'to'
            }],
            important: true,
            subject: checkUser.employerInformation.companyName + ' has invited you to join them',
            merge: true,
            inline_css: true,
            merge_language: 'mailchimp',
            merge_vars: [{
                rcpt: dataToSave.email,
                vars: [
                    {
                        name: 'fname',
                        content: dataToSave.firstName.trim()
                    },
                    {
                        name: 'email',
                        content: dataToSave.email
                    },
                    {
                        name: 'password',
                        content: dataToSave.tempPassword
                    },
                    {
                        name: 'downloadURL',
                        content: shortLink.shortLink
                    },
                    {
                        name: 'paname',
                        content: checkUser.firstName
                    }
                ]
            }]
        };
        try {
            await mandrill.Handlers.sendTemplate('invitation-mail-to-students-tie-to-join-ezpa', [], email, true);
        } catch (e) {
            logger.error('Error occurred while sending invitation email in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
        }
    } else {
        email = {
            to: [{
                email: dataToSave.email,
                type: 'to'
            }],
            important: true,
            subject: checkUser.employerInformation.companyName + ' has invited you to join them',
            merge: true,
            inline_css: true,
            merge_language: 'mailchimp',
            merge_vars: [{
                rcpt: dataToSave.email,
                vars: [
                    {
                        name: 'fname',
                        content: dataToSave.firstName.trim()
                    },
                    {
                        name: 'email',
                        content: dataToSave.email
                    },
                    {
                        name: 'password',
                        content: dataToSave.tempPassword
                    },
                    {
                        name: 'downloadURL',
                        content: shortLink.shortLink
                    }
                ]
            }]
        };
        try {
            await mandrill.Handlers.sendTemplate('mail-to-consultants-ezpa', [], email, true);
        } catch (e) {
            logger.error('Error occurred while sending invitation email in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Candidate details added successfully', 'success', 201)).code(200);
};

paHandler.uploadIndividualCandidateNonProfit = async (request, h) => {
    let decoded, checkUser, checkJob;

    /* Check if user is actually who is trying to login */
   /* try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in upload individual candidate non profit pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }*/

    /* Check if user exists or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.paId)}, {password: 0}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in upload individual candidate non profit pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action', 'error', 400)).code(400);
    }

    /* Check if the account with the given email exists */
    let duplicate;
    try {
        duplicate = await userSchema.UserSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding duplicate user in upload individual candidate non profit pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (duplicate) {
        return h.response(responseFormatter.responseFormatter({}, 'Account with the given email already exists.', 'error', 409)).code(409);
    }

    /* Check job */
    try {
        checkJob = await jobSchema.jobSchema.findOne({userId: mongoose.Types.ObjectId(request.payload.paId), isVisible: false}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding job in upload individual candidate non profit pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Create the candidate data */
    const tempPassword = commonFunctions.Handlers.generatePassword();
    let dataToSave = {
        firstName: request.payload.firstName ? request.payload.firstName : '',
        lastName: request.payload.lastName ? request.payload.lastName : '',
        email: request.payload.email,
        roles: ['Candidate'],
        'employeeInformation.location': checkUser.employerInformation.companyLocation,
        'employerInformation.companyLocation': checkUser.employerInformation.companyLocation,
        'employerInformation.companyAddress': checkUser.employerInformation.companyAddress,
        'employeeInformation.address': checkUser.employerInformation.companyAddress,
        'employeeInformation.country': checkUser.country,
        'employerInformation.country': checkUser.country,
        'employeeInformation.countryCode': request.payload.countryCode ? request.payload.countryCode : '',
        'employeeInformation.phone': request.payload.phone ? request.payload.phone : '',
        country: checkUser.country,
        isAddedByBulkUploadPA: true,
        paId: mongoose.Types.ObjectId(request.payload.paId),
        tempPassword: tempPassword,
        password: tempPassword,
        hasInstalled: false,
        membership: checkUser.membership ? checkUser.membership : '',
        isRoleSet: true
    };

    dataToSave['employeeInformation.preferredLocations'] = {
        type: 'MultiPoint',
        coordinates: [checkUser.employerInformation.companyLocation.coordinates]
    };

    dataToSave['employeeInformation.preferredLocationCities'] = [
        {
            city: checkUser.employerInformation.companyAddress.city,
            state: checkUser.employerInformation.companyAddress.state,
            country: checkUser.employerInformation.country,
            latitude: checkUser.employerInformation.companyLocation.coordinates[1],
            longitude: checkUser.employerInformation.companyLocation.coordinates[0]
        }
    ];

    const saveData = new userSchema.UserSchema(dataToSave);
    try {
        await saveData.save();
    } catch (e) {
        logger.error('Error occurred saving user in upload individual candidate non profit handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Create a chat with the placement officer */
    const chatToSave = {
        roomId: saveData._id.toString() + request.payload.paId + checkJob._id.toString(),
        candidateId: mongoose.Types.ObjectId(saveData._id),
        employerId: mongoose.Types.ObjectId(request.payload.paId),
        jobId: mongoose.Types.ObjectId(checkJob._id),
        isApplied: true,
        isInvited: true,
        hasEmployerDeleted: false,
        hasCandidateDeleted: false,
        isCandidateBlocked: false,
        isEmployerBlocked: false,
        paId: mongoose.Types.ObjectId(checkUser._id),
        chats: [{
            from: mongoose.Types.ObjectId(request.payload.paId),
            to: mongoose.Types.ObjectId(saveData._id),
            body: aes256.encrypt(key, 'This is your placement officer.'),
            originalBody: aes256.encrypt(key, 'This is your placement officer.'),
            type: 'isText',
            duration: 0,
            latitude: '',
            longitude: '',
            isRead: false,
            hasEmployerDeleted: false,
            hasCandidateDeleted: false,
            isCandidateBlocked: false,
            isEmployerBlocked: false,
            isEncrypted: true,
            isTranslated: false
        }]
    };

    try {
        await new conversationSchema.conversationSchema(chatToSave).save();
    } catch (e) {
        logger.error('Error occurred saving chat in upload individual candidate non profit handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Create dynamic link */
    const shortLink = await commonFunctions.Handlers.createFirebaseShortLink(dataToSave.email, '', '');
    let email = {
        to: [{
            email: dataToSave.email,
            type: 'to'
        }],
        important: true,
        subject: checkUser.employerInformation.companyName + ' has invited you to join them',
        merge: true,
        inline_css: true,
        merge_language: 'mailchimp',
        merge_vars: [{
            rcpt: dataToSave.email,
            vars: [
                {
                    name: 'fname',
                    content: 'Student/Candidate'
                },
                {
                    name: 'email',
                    content: dataToSave.email
                },
                {
                    name: 'password',
                    content: dataToSave.tempPassword
                },
                {
                    name: 'downloadURL',
                    content: shortLink.shortLink
                },
                {
                    name: 'paname',
                    content: (checkUser.firstName + ' ' + checkUser.lastName).trim()
                },
                {
                    name: 'companyName',
                    content: checkUser.employerInformation.companyName
                },
                {
                    name: 'community',
                    content: checkUser.membership.toString() === '611aa6d519add1146d831b72' ? 'Sri Venkateswara Hindu Temple' : 'ITServe Alliance CSR'
                }
            ]
        }]
    };

    try {
        if (process.env.NODE_ENV === 'production') {
            if (checkUser.membership.toString() === '601b296b1518584fb3e1d52e') {
                await mandrill.Handlers.sendTemplate('invitation-mail-to-students-tie-to-join-ezpa', [], email, true);
            } else if (checkUser.membership.toString() === '611aa6d519add1146d831b72') {
                await mandrill.Handlers.sendTemplate('invitation-mail-to-students-temple-ezpa', [], email, true);
            } else if (checkUser.membership) {
                await mandrill.Handlers.sendTemplate('invitation-mail-to-students-its-to-join-ezpa', [], email, true);
            } else {
                await mandrill.Handlers.sendTemplate('invitation-mail-to-students-general-to-join-ezpa', [], email, true);
            }
        } else {
            await mandrill.Handlers.sendTemplate('invitation-mail-to-students-tie-to-join-ezpa', [], email, true);
        }
    } catch (e) {
        logger.error('Error occurred while sending invitation email in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
    }

    if (request.payload.phone && request.payload.countryCode) {
        await commonFunctions.Handlers.sendSMS(request.payload.countryCode, request.payload.phone, 'Please download EZJobs App at: https://ezjobs.page.link/store');
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Candidate details added successfully', 'success', 201)).code(200);
};

paHandler.uploadEmployers = async (request, h) => {
    let fileName = request.payload.file.filename, employerCount = 0, checkUser, decoded, uploadData, result, totalCount = 0;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in upload employers data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in upload employers data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    const ext = fileName.split('.')[1];

    if (ext !== 'xls' && ext !== 'xlsx') {
        return h.response(responseFormatter.responseFormatter({}, 'The given file is not a xls file', 'error', 400)).code(400);
    }

    try {
        result = await commonFunctions.Handlers.parseExcelForPA(request.payload.file.path);
    } catch (e) {
        logger.error('Error occurred parsing excel file in upload employers data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error while parsing excel file', 'error', 500)).code(500);
    }

    const len = result.length;

    /* Create a record for history */
    const uploadHistory = {
        fileName: fileName,
        paId: mongoose.Types.ObjectId(request.payload.userId),
        status: 'Pending',
        uploadCount: 0,
        degree: request.payload.degree,
        graduationYear: request.payload.graduationYear,
        major: request.payload.major,
        isEmployer: true
    };

    uploadData = new uploadHistorySchema.uploadHistory(uploadHistory);

    try {
        await uploadData.save();
    } catch (e) {
        logger.error('Error occurred while saving upload data in upload employers data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < len; i++) {
        let checkEmployer;
        const data = result[i];

        /* Search whether this user is already present in the database or not */
        if (data['Email']) {
            totalCount++;
            try {
                checkEmployer = await userSchema.UserSchema.findOne({email: data['Email']}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding user in uploadEmployers PA handler %s:', JSON.stringify(e));
                /* Update upload data */
                try {
                    await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: employerCount, errorCount: totalCount - employerCount, status: 'Error'}}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while upload history details in uploadEmployers handler %s:', JSON.stringify(e));
                }
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if (!checkEmployer) {
                const tempPassword = commonFunctions.Handlers.generatePassword();
                let dataToSave = {
                    firstName: data['First name'],
                    lastName: data['Last name'],
                    email: data['Email'],
                    roles: checkUser.isPaAdmin ? ['PA'] : ['Employer'],
                    'employerInformation.companyLocation': checkUser.employerInformation.companyLocation,
                    'employeeInformation.location': checkUser.employerInformation.companyLocation,
                    'employerInformation.companyAddress': checkUser.employerInformation.companyAddress,
                    'employeeInformation.address': checkUser.employerInformation.companyAddress,
                    'employeeInformation.country': checkUser.country,
                    'employerInformation.country': checkUser.country,
                    country: checkUser.country,
                    'employerInformation.countryCode': checkUser.employerInformation.countryCode,
                    'employerInformation.companyPhone': data['Phone number'],
                    'employerInformation.companyName': data['Company name'],
                    isAddedByBulkUploadPA: true,
                    paId: checkUser.isPaAdmin ? undefined : mongoose.Types.ObjectId(request.payload.userId),
                    isPa: !!checkUser.isPaAdmin,
                    tempPassword: tempPassword,
                    password: tempPassword,
                    hasInstalled: false,
                    isPaEmployer: !checkUser.isPaAdmin,
                    membership: checkUser.isPaAdmin ? (checkUser.membership ? checkUser.membership : '') : ''
                };

                dataToSave['employeeInformation.preferredLocations'] = {
                    type: 'MultiPoint',
                    coordinates: [checkUser.employerInformation.companyLocation.coordinates]
                };

                dataToSave['employeeInformation.preferredLocationCities'] = [
                    {
                        city: checkUser.employerInformation.companyAddress.city,
                        state: checkUser.employerInformation.companyAddress.state,
                        country: checkUser.country,
                        latitude: checkUser.employerInformation.companyLocation.coordinates[1],
                        longitude: checkUser.employerInformation.companyLocation.coordinates[0]
                    }
                ];

                const saveData = new userSchema.UserSchema(dataToSave);
                try {
                    await saveData.save();
                } catch (e) {
                    logger.error('Error occurred saving user in uploadEmployers PA handler %s:', JSON.stringify(e));
                    /* Update upload data */
                    try {
                        await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: employerCount, errorCount: totalCount - employerCount, status: 'Error'}}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while upload history details in uploadEmployers handler %s:', JSON.stringify(e));
                    }
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                employerCount++;

                /* Send email to the candidates for with the password and link to download the app */
                if (dataToSave.email) {
                    try {
                        /* Create dynamic link */
                        const shortLink = await commonFunctions.Handlers.createFirebaseShortLink(dataToSave.email, '', '');
                        let email = {
                            to: [{
                                email: dataToSave.email,
                                type: 'to'
                            }],
                            important: true,
                            merge: true,
                            inline_css: true,
                            merge_language: 'mailchimp',
                            merge_vars: [{
                                rcpt: dataToSave.email,
                                vars: [
                                    {
                                        name: 'placementOfficer',
                                        content: (checkUser.firstName + ' ' + checkUser.lastName).trim()
                                    },
                                    {
                                        name: 'college',
                                        content: checkUser.employerInformation.companyName
                                    },
                                    {
                                        name: 'email',
                                        content: dataToSave.email
                                    },
                                    {
                                        name: 'password',
                                        content: dataToSave.tempPassword
                                    },
                                    {
                                        name: 'downloadURL',
                                        content: shortLink.shortLink
                                    }
                                ]
                            }]
                        };
                        await mandrill.Handlers.sendTemplate('app-download-pa', [], email, true);
                        try {
                            checkUser = await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, {$set: {'employeeInformation.lastEmailSent': Date.now()}, $inc: {'employeeInformation.numberOfEmailsSent': 1}}, {lean: true, new: true});
                        } catch (e) {
                            logger.error('Error occurred while updating user details in uploadEmployers handler %s:', JSON.stringify(e));
                            /* Update upload data */
                            try {
                                await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: employerCount, errorCount: totalCount - employerCount, status: 'Error'}}, {lean: true});
                            } catch (e) {
                                logger.error('Error occurred while upload history details in uploadEmployers handler %s:', JSON.stringify(e));
                            }
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }
                    } catch (e) {
                        logger.error('Error in sending app download link to user %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }
            } else {
                /* Update upload data */
                try {
                    await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: employerCount, errorCount: totalCount - employerCount, status: 'Error'}}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while upload history details in uploadEmployers handler %s:', JSON.stringify(e));
                }
            }
        }
    }

    /* Update upload data */
    try {
        await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: employerCount, errorCount: totalCount - employerCount, status: 'Complete'}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while upload history details in uploadEmployers handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter({}, 'Uploaded successfully', 'success', 200)).code(200);
};

paHandler.uploadIndividualEmployer = async (request, h) => {
    let checkUser, decoded, checkDuplicate;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in upload individual employer data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa && !checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in upload individual employer data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if account already exists */
    try {
        checkDuplicate = await userSchema.UserSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in upload individual employer data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkDuplicate) {
        return h.response(responseFormatter.responseFormatter({}, 'Account already exists.', 'error', 409)).code(409);
    }

    const tempPassword = commonFunctions.Handlers.generatePassword();
    let dataToSave = {
        firstName: request.payload.firstName,
        lastName: request.payload.lastName ? request.payload.lastName : '',
        email: request.payload.email,
        roles: checkUser.isPaAdmin ? ['PA'] : ['Employer'],
        'employerInformation.companyLocation': checkUser.employerInformation.companyLocation,
        'employeeInformation.location': checkUser.employerInformation.companyLocation,
        'employerInformation.companyAddress': checkUser.employerInformation.companyAddress,
        'employeeInformation.address': checkUser.employerInformation.companyAddress,
        'employeeInformation.country': checkUser.country,
        'employerInformation.country': checkUser.country,
        country: checkUser.country,
        'employerInformation.countryCode': request.payload.countryCode ? request.payload.countryCode : '',
        'employerInformation.companyPhone': request.payload.phone ? request.payload.phone : '',
        'employerInformation.companyName': request.payload.companyName,
        isAddedByBulkUploadPA: true,
        paId: checkUser.isPaAdmin ? undefined : mongoose.Types.ObjectId(request.payload.paId),
        isPa: !!checkUser.isPaAdmin,
        tempPassword: tempPassword,
        password: tempPassword,
        hasInstalled: false,
        isPaEmployer: !checkUser.isPaAdmin,
        membership: checkUser.isPaAdmin ? (checkUser.membership ? checkUser.membership : '') : ''
    };

    dataToSave['employeeInformation.preferredLocations'] = {
        type: 'MultiPoint',
        coordinates: [checkUser.employerInformation.companyLocation.coordinates]
    };

    dataToSave['employeeInformation.preferredLocationCities'] = [
        {
            city: checkUser.employerInformation.companyAddress.city,
            state: checkUser.employerInformation.companyAddress.state,
            country: checkUser.country,
            latitude: checkUser.employerInformation.companyLocation.coordinates[1],
            longitude: checkUser.employerInformation.companyLocation.coordinates[0]
        }
    ];

    const saveData = new userSchema.UserSchema(dataToSave);
    try {
        await saveData.save();
    } catch (e) {
        logger.error('Error occurred saving user in upload individual employer data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    const shortLink = await commonFunctions.Handlers.createFirebaseShortLink(dataToSave.email, '', '');
    let email = {
        to: [{
            email: dataToSave.email,
            type: 'to'
        }],
        important: true,
        merge: true,
        inline_css: true,
        merge_language: 'mailchimp',
        merge_vars: [{
            rcpt: dataToSave.email,
            vars: [
                {
                    name: 'placementOfficer',
                    content: (checkUser.firstName + ' ' + checkUser.lastName).trim()
                },
                {
                    name: 'college',
                    content: checkUser.employerInformation.companyName
                },
                {
                    name: 'email',
                    content: dataToSave.email
                },
                {
                    name: 'password',
                    content: dataToSave.tempPassword
                },
                {
                    name: 'downloadURL',
                    content: shortLink.shortLink
                }
            ]
        }]
    };
    await mandrill.Handlers.sendTemplate('app-download-pa-employer', [], email, true);

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Uploaded successfully', 'success', 201)).code(200);
};

paHandler.getEmployers = async (request, h) => {
    let checkUser, decoded, employers, aggregationCriteria, searchCriteria = {}, constantData;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get employers data PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa && !checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to access the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get employers data PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    if (request.query.searchText) {
        const text = request.query.searchText;
        if (checkUser.isPaAdmin) {
            searchCriteria = {
                _id: {$ne: mongoose.Types.ObjectId(request.query.paId)},
                isPa: true,
                membership: checkUser.membership.toString(),
                $or: [{firstName: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {lastName: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {email: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {'employerInformation.companyName': new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}]
            };

        } else {
            /* Not in use */
            searchCriteria = {
                $or: [{$and: [{paId: mongoose.Types.ObjectId(request.query.paId)}, {isPaEmployer: true}]}, {membership: checkUser.membership, _id: {$ne: mongoose.Types.ObjectId(request.query.paId)}, isPaAdmin: false}],
                $or: [{firstName: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {lastName: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {email: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {'employerInformation.companyName': new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}]
            };
        }
    } else {
        if (checkUser.isPaAdmin) {
            checkUser.additionalMemberships.push(mongoose.Types.ObjectId(checkUser.membership));
            let allMemberships = checkUser.additionalMemberships, allMembershipsString = checkUser.membership;
            searchCriteria = {
                _id: {$ne: mongoose.Types.ObjectId(request.query.paId)},
                isPa: true,
                $or: [{membership: allMembershipsString}, {additionalMemberships: {$in: allMemberships}}]
            };
        } else {
            /* Not in use */
            searchCriteria = {
                $or: [{$and: [{paId: mongoose.Types.ObjectId(request.query.paId)}, {isPaEmployer: true}]}, {membership: checkUser.membership, _id: {$ne: mongoose.Types.ObjectId(request.query.paId)}, isPaAdmin: false, isPaEmployer: true}]
            };
        }
    }

    if (request.query.filter) {
        searchCriteria['hasOwned'] = (request.query.filter === 'installed');
    }

    if (request.query.chapter) {
        searchCriteria['employerInformation.chapter'] = mongoose.Types.ObjectId(request.query.chapter);
    }

    if (request.query.region) {
        searchCriteria['employerInformation.region'] = mongoose.Types.ObjectId(request.query.region);
    }

    if (request.query.status) {
        searchCriteria['isActive'] = request.query.status.toLowerCase() === 'active';
    }

    if (request.query.memberSince) {
        searchCriteria['employerInformation.memberSince'] = request.query.memberSince;
    }

    /* Get the list of employers */
    aggregationCriteria = [
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
              from: 'Chapter',
              localField: 'employerInformation.chapter',
              foreignField: '_id',
              as: 'chapter'
          }
        },
        {
            $unwind: {
                path: '$chapter',
                preserveNullAndEmptyArrays: true
            }
        },
        {
            $project: {
                _id: 1,
                firstName: 1,
                lastName: 1,
                companyName: '$employerInformation.companyName',
                companyLogo: '$employerInformation.companyProfilePhoto',
                countryCode: '$employerInformation.countryCode',
                phone: '$employerInformation.companyPhone',
                email: 1,
                membership: 1,
                additionalMemberships: 1,
                appDownloaded: '$hasOwned',
                isComplete: '$employerInformation.isComplete',
                isActive: 1,
                memberType: 1,
                isSlave: 1,
                chapter: '$chapter.name'
            }
        }
    ];
    try {
        employers = await userSchema.UserSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred while aggregating user collection in get employers data PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get the memberships of each employers if any */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {memberships: 1, memberTypes: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding constant info in get employers data PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /*let flag = false, idxType;
    if (checkUser.isNonProfit || checkUser.isConsulting) {
        checkUser.isNonProfit ? (idxType = constantData.memberTypes.findIndex(k => k.isNonProfit === true)) : idxType = constantData.memberTypes.findIndex(k => k.isConsulting === true);
        if (idxType !== -1) {
            flag = true;
        }
    }*/

    if (constantData.memberships) {
        const len = employers.length;
        for (let i = 0; i < len; i++) {
            const idx = constantData.memberships.findIndex(k => k._id.toString() === employers[i].membership);
            if (idx !== -1) {
                employers[i].membership = constantData.memberships[idx].name;
            }
            /*if (flag) {
                const idxTypeMember = constantData.memberTypes[idxType].types.findIndex(k => k.key === employers[i].memberType);
                if (idxTypeMember !== -1) {
                    employers[i].memberType = constantData.memberTypes[idxType].types[idxTypeMember].label;
                }
            }*/
            if (employers[i].memberType) {
                const result = employers[i].memberType.replace( /([A-Z])/g, " $1" );
                employers[i].memberType = result.charAt(0).toUpperCase() + result.slice(1);
            }

            if (employers[i].additionalMemberships && employers[i].additionalMemberships.length) {
                let extraMemberships = [];
                for (let j = 0; j < employers[i].additionalMemberships.length; j++) {
                    const idx = constantData.memberships.findIndex(k => k._id.toString() === employers[i].additionalMemberships[j].toString());
                    if (idx !== -1) {
                        extraMemberships.push(constantData.memberships[idx].name);
                    }
                }
                delete employers[i].additionalMemberships;
                employers[i].additionalMemberships = extraMemberships;
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(employers, 'Fetched successfully', 'success', 200)).code(200);
};

paHandler.getEmployerJobs = async (request, h) => {
    let checkUser, decoded, jobs, aggregationCriteria;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get employer jobs data PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa && !checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to access the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get employer jobs data PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Get all jobs of employer */
    aggregationCriteria = [
        {
            $match: {
                _id: mongoose.Types.ObjectId(request.query.employerId)
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
                from: 'Job',
                localField: '_id',
                foreignField: 'userId',
                as: 'jobs'
            }
        },
        {
            $unwind: {
                path: '$jobs',
                preserveNullAndEmptyArrays: true
            }
        }];

    if (checkUser.isPaAdmin) {
        aggregationCriteria.push({
            $match: {
                'jobs.isVisible': true,
                'jobs.isArchived': false,
                'jobs.isTranslated': false
            }
        });
    } else {
        aggregationCriteria.push({
            $match: {
                'jobs.isVisible': true,
                'jobs.isArchived': false,
                'jobs.isTranslated': false,
                $or: [{'jobs.isExposedToAll': true}, {'jobs.exposedTo': checkUser._id}, {$and: [{'jobs.isExposedToCommunity': true}, {'jobs.membership': checkUser.membership}]}]
            }
        });
    }

    aggregationCriteria.push({
            $lookup: {
                from: 'Conversation',
                localField: 'jobs._id',
                foreignField: 'jobId',
                as: 'candidates'
            }
        },
        {
            "$addFields" : {
                "filtered" : {
                    "$filter" : {
                        "input" : "$candidates",
                        "as" : "c",
                        "cond" : {
                            "$eq" : [
                                "$$c.paId",
                                mongoose.Types.ObjectId(request.query.paId)
                            ]
                        }
                    }
                }
            }
        },
        {
            $project: {
                _id: '$jobs._id',
                jobTitle: '$jobs.jobTitle',
                subJobTitle: '$jobs.subJobTitle',
                jobDescriptionVideo: '$jobs.jobDescriptionVideo',
                numberOfPositions: '$jobs.numberOfPositions',
                jobType: '$jobs.jobType',
                address: '$jobs.address',
                candidates: {$size: '$filtered'}
            }
        });

    /* Not in use */
    /*
    * {
            "$addFields" : {
                "masterUser" : [
                    "$_id"
                ]
            }
        },
        {
            "$project" : {
                _id : "$jobs._id",
                jobTitle : "$jobs.jobTitle",
                jobDescriptionVideo : "$jobs.jobDescriptionVideo",
                numberOfPositions : "$jobs.numberOfPositions",
                jobType : "$jobs.jobType",
                address : "$jobs.address",
                candidates : 1.0,
                masterUser : 1.0,
                isMaster : 1.0,
                slaveUsers : 1.0,
                paId : "$candidates.paId",
                slaveUsersNew : {
                    "$concatArrays" : [
                        "$masterUser",
                        "$slaveUsers"
                    ]
                }
            }
        },
        {
            "$addFields" : {
                "filtered" : {
                    "$filter" : {
                        "input" : "$candidates",
                        "as" : "c",
                        "cond" : {
                            "if" : {
                                "$eq" : [
                                    "$isMaster",
                                    true
                                ]
                            },
                            "then" : {
                                "$in" : [
                                    "$$c.paId",
                                    "$slaveUsersNew"
                                ]
                            },
                            "else" : {
                                "$eq" : [
                                    "$$c.paId",
                                    mongoose.Types.ObjectId(request.query.paId)
                                ]
                            }
                        }
                    }
                }
            }
        },
        {
            $project: {
                _id: 1,
                jobTitle: 1,
                jobDescriptionVideo: 1,
                numberOfPositions: 1,
                jobType: 1,
                address: 1,
                candidates: {$size: '$filtered'}
            }
        }
    * */


    try {
        jobs = await userSchema.UserSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred while aggregating user collection in get employer jobs data PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < jobs.length; i++) {
        if (!jobs[i]._id) {
            jobs.splice(i, 1);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(jobs, 'Fetched successfully', 'success', 200)).code(200);
};

paHandler.getEmployerJobsCandidates = async (request, h) => {
    let checkUser, decoded, candidates, aggregationCriteria;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get candidates for employer jobs data PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to access the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get candidates for employer jobs data PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Get candidates */
    aggregationCriteria = [
        {
            $match: {
                jobId: mongoose.Types.ObjectId(request.query.jobId),
                paId: mongoose.Types.ObjectId(request.query.paId)
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
                localField: 'candidateId',
                foreignField: '_id',
                as: 'candidate'
            }
        },
        {
            $unwind: '$candidate'
        },
        {
            $project: {
                candidateId: '$candidate._id',
                firstName: '$candidate.firstName',
                lastName: '$candidate.lastName',
                isApplied: 1,
                isInvited: 1,
                isHired: 1,
                rollNumber: '$candidate.employeeInformation.rollNumber',
                education: '$candidate.employeeInformation.educationPA'
            }
        }
    ];
    try {
        candidates = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred while aggregating conversation collection in get candidates for employer jobs data PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(candidates, 'Fetched successfully', 'success', 200)).code(200);
};

paHandler.setupMailServer = async (request, h) => {
    let checkPa, decoded, dataToUpdate;

    /* Check if user exists */
    try {
        checkPa = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in setup mail server PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPa) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkPa.isPa && !checkPa.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to access the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in setup mail server PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Update the mail server data */
    dataToUpdate = {
        host: request.payload.host,
        port: request.payload.port,
        email: request.payload.email,
        userId: mongoose.Types.ObjectId(request.payload.userId)
    };

    try {
        await mailServerSchema.mailServerSchema.findOneAndUpdate({userId: mongoose.Types.ObjectId(request.payload.userId)}, {$set: dataToUpdate}, {lean: true, upsert: true});
    } catch (e) {
        logger.error('Error occurred updating mail server data in setup mail server PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Mail server configuration updated.', 'success', 204)).code(200);
};

paHandler.addCampusInterview = async (request, h) => {
    let checkPa, decoded, checkEmployer;

    /* Check if user exists */
    try {
        checkPa = await userSchema.UserSchema.findById({_id: request.payload.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in add campus interview handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPa) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkPa.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to access the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in add campus interview handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if employer exists */
    try {
        checkEmployer = await userSchema.UserSchema.findOne({_id: mongoose.Types.ObjectId(request.payload.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding employer in add campus interview handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'No such employer.', 'error', 404)).code(404);
    }

    /* Save data into database */
    try {
        await new campusInterviewSchema.campusInterviewSchema(request.payload).save();
    } catch (e) {
        logger.error('Error occurred while saving campus interview data in add campus interview handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Campus interview created.', 'success', 201)).code(201);
};

paHandler.updateCampusInterview = async (request, h) => {
    let checkPa, decoded, checkInterview, checkEmployer;

    /* Check if user exists */
    try {
        checkPa = await userSchema.UserSchema.findById({_id: request.payload.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in add campus interview handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPa) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkPa.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to access the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in add campus interview handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if employer exists */
    try {
        checkEmployer = await userSchema.UserSchema.findOne({_id: mongoose.Types.ObjectId(request.payload.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding employer in add campus interview handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'No such employer.', 'error', 404)).code(404);
    }

    /* Check if interview exists */
    try {
        checkInterview = await campusInterviewSchema.campusInterviewSchema.findOne({_id: mongoose.Types.ObjectId(request.payload.campusInterviewId), paId: mongoose.Types.ObjectId(request.payload.paId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding employer in add campus interview handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkInterview) {
        return h.response(responseFormatter.responseFormatter({}, 'No such campus interview.', 'error', 404)).code(404);
    }

    /* Update data into database */
    try {
        await campusInterviewSchema.campusInterviewSchema.findByIdAndUpdate({_id: request.payload.campusInterviewId}, {$set: request.payload}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while saving campus interview data in add campus interview handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Campus interview updated.', 'success', 201)).code(201);
};

paHandler.getCampusInterviews = async (request, h) => {
    let checkPa, decoded, campusInterviews, projectCriteria = {};

    /* Check if user exists */
    try {
        checkPa = await userSchema.UserSchema.findById({_id: request.query.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get campus interviews handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPa) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkPa.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    if (checkPa.isUniversity) {
        projectCriteria = {
            _id: 1,
            employerId: 1,
            employerName: '$employer.employerInformation.companyName',
            companyLogo: '$employer.employerInformation.companyProfilePhoto',
            visitDateTime: 1,
            address: 1,
            cutOfRank: 1,
            cutOfCgpa: 1,
            degreeName: 1,
            majorName: 1,
            graduationYear: 1
        };
    } else if (checkPa.isTraining) {
        projectCriteria = {
            _id: 1,
            employerId: 1,
            employerName: '$employer.employerInformation.companyName',
            companyLogo: '$employer.employerInformation.companyProfilePhoto',
            visitDateTime: 1,
            address: 1,
            cutOfRank: 1,
            cutOfCgpa: 1,
            batch: 1,
            course: 1
        };
    } else {
        projectCriteria = {
            _id: 1,
            employerId: 1,
            employerName: '$employer.employerInformation.companyName',
            companyLogo: '$employer.employerInformation.companyProfilePhoto',
            visitDateTime: 1,
            address: 1,
            cutOfRank: 1,
            cutOfCgpa: 1,
            degreeName: 1,
            majorName: 1,
            batch: 1,
            course: 1,
            graduationYear: 1
        };
    }

    /* Check if user is actually who is trying to access the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get campus interviews handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Get campus interview information */
    let matchCriteria;
    if (request.query.filter) {
        if (request.query.filter === 'past') {
            matchCriteria = {
                paId: mongoose.Types.ObjectId(request.query.paId),
                visitDateTime: {$lt: new Date()}
            };
        } else if (request.query.filter === 'future') {
            matchCriteria = {
                paId: mongoose.Types.ObjectId(request.query.paId),
                visitDateTime: {$gt: new Date()}
            };
        } else {
            matchCriteria = {
                paId: mongoose.Types.ObjectId(request.query.paId)
            };
        }
    } else {
        matchCriteria = {
            paId: mongoose.Types.ObjectId(request.query.paId)
        };
    }

    if (request.query.startDate && request.query.endDate) {
        matchCriteria = {
            paId: mongoose.Types.ObjectId(request.query.paId),
            visitDateTime: {$gte: new Date(request.query.startDate), $lte: new Date(request.query.endDate)}
        };
    }
    try {
        campusInterviews = await campusInterviewSchema.campusInterviewSchema.aggregate([
            {
                $match: matchCriteria
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
                    localField: 'employerId',
                    foreignField: '_id',
                    as: 'employer'
                }
            },
            {
                $unwind: '$employer'
            },
            {
                $project: projectCriteria
            }
        ]);
    } catch (e) {
        logger.error('Error occurred while aggregating campus interview collection in get campus interviews handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get list of qualified candidates for the campus interview based on the cut of score defined */
    const len = campusInterviews.length;
    for (let i = 0; i < len; i++) {
        let matchCriteria, count = 0;

        if (checkPa.isUniversity) {
            matchCriteria = {
                paId: mongoose.Types.ObjectId(request.query.paId),
                roles: 'Candidate',
                'employeeInformation.educationPA.level': campusInterviews[i].degreeName,
                'employeeInformation.educationPA.major': campusInterviews[i].majorName,
                'employeeInformation.educationPA.graduationYear': campusInterviews[i].graduationYear
            };
        }

        if (checkPa.isTraining) {
            matchCriteria = {
                paId: mongoose.Types.ObjectId(request.query.paId),
                roles: 'Candidate',
                'employeeInformation.batch': campusInterviews[i].batch,
                'employeeInformation.course': campusInterviews[i].course
            };
        }

        if (campusInterviews[i].cutOfCgpa) {
            matchCriteria['employeeInformation.educationPA.cgpa'] = {$gte: campusInterviews[i].cutOfCgpa};
        }

        if (campusInterviews[i].cutOfRank) {
            matchCriteria['employeeInformation.educationPA.rank'] = {$lte: campusInterviews[i].cutOfRank};
        }

        /* Count total number of qualified candidates */
        try {
            count = await userSchema.UserSchema.countDocuments(matchCriteria);
        } catch (e) {
            logger.error('Error occurred while counting qualified candidates in get campus interviews handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        campusInterviews[i].qualifiedCandidates = count;
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(campusInterviews, 'Fetched successfully', 'success', 200)).code(200);
};

paHandler.getMailServer = async (request, h) => {
    let checkPa, decoded, mailServer = {};

    /* Check if user exists */
    try {
        checkPa = await userSchema.UserSchema.findById({_id: request.query.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get mail server handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPa) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkPa.isPa && !checkPa.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to access the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get mail server handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Get mail server info */
    try {
        mailServer = await mailServerSchema.mailServerSchema.findOne({userId: mongoose.Types.ObjectId(request.query.paId)}, {_id: 0, userId: 0, __v: 0, createdAt: 0, updatedAt: 0}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding mail server in get mail server handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(mailServer, 'Fetched successfully.', 'success', 200)).code(200);
};

paHandler.getQualifiedCandidates = async (request, h) => {
    let checkPa, decoded, checkInterview, checkEmployer, candidates, matchCriteria = {};

    /* Check if Campus interview exists */
    try {
        checkInterview = await campusInterviewSchema.campusInterviewSchema.findById({_id: request.query._id}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding campus interview in get qualified candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkInterview) {
        return h.response(responseFormatter.responseFormatter({}, 'No such campus interview.', 'error', 404)).code(404);
    }

    /* Check if PA exists */
    try {
        checkPa = await userSchema.UserSchema.findById({_id: checkInterview.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding pa in get qualified candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPa) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found.', 'error', 404)).code(404);
    } else if (!checkPa.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user is actually who is trying to access the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get mail server handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkInterview.paId.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if Employer exists */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: checkInterview.employerId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding employer in get qualified candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'No such employer.', 'error', 404)).code(404);
    }

    if (checkPa.isUniversity) {
        matchCriteria = {
            paId: checkInterview.paId,
            roles: 'Candidate',
            'employeeInformation.educationPA.level': checkInterview.degreeName,
            'employeeInformation.educationPA.major': checkInterview.majorName,
            'employeeInformation.educationPA.graduationYear': checkInterview.graduationYear
        };
    }

    if (checkPa.isTraining) {
        matchCriteria = {
            paId: checkInterview.paId,
            roles: 'Candidate',
            'employeeInformation.batch': checkInterview.batch,
            'employeeInformation.course': checkInterview.course
        };
    }

    if (checkInterview.cutOfCgpa) {
        matchCriteria['employeeInformation.educationPA.cgpa'] = {$gte: checkInterview.cutOfCgpa};
    }

    if (checkInterview.cutOfRank) {
        matchCriteria['employeeInformation.educationPA.rank'] = {$lte: checkInterview.cutOfRank};
    }

    /* Get candidates */
    try {
        candidates = await userSchema.UserSchema.aggregate([
            {
                $match: matchCriteria
            },
            {
                $lookup: {
                    localField: '_id',
                    foreignField: 'candidateId',
                    from: 'CandidateStatus',
                    as: 'status'
                }
            },
            {
                $unwind: {
                    path: '$status',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $sort: {
                    'employeeInformation.educationPA.cgpa': 1
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
                    firstName: 1,
                    lastName: 1,
                    rollNumber: '$employeeInformation.rollNumber',
                    education: '$employeeInformation.educationPA',
                    status: '$status.status',
                    batch: '$employeeInformation.batch',
                    course: '$employeeInformation.course'
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred while aggregating user collection in get qualified candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(candidates, 'Fetched successfully.', 'success', 200)).code(200);
};

paHandler.addUser = async (request, h) => {
    let checkPa, checkUser, decoded, user, jobData, category, paAdmin;

    /* Check if PA exists */
    try {
        checkPa = await userSchema.UserSchema.findById({_id: request.payload.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding pa in add user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPa) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found.', 'error', 404)).code(404);
    } else if (!checkPa.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    } else if (checkPa.isSlave) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to access the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get mail server handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check PA admin if user is part of organization */
    if (checkPa.isOrganization) {
        try {
            paAdmin = await userSchema.UserSchema.findById({_id: checkPa.paId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding pa admin in add user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Check if the user with the given email already exists */
    try {
        checkUser = await userSchema.UserSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in add user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User already exists.', 'error', 409)).code(409);
    }

    /* Create user and save it into database */
    user = new userSchema.UserSchema(request.payload);
    user.employerInformation = checkPa.employerInformation;
    user.employerInformation.numberOfJobsPosted = 0;
    user.roles = ['Employer'];
    user.password = commonFunctions.Handlers.generatePassword();
    user.tempPassword = user.password;
    user.referralCode = commonFunctions.Handlers.generateReferralCode(request.payload.firstName);
    user.employeeInformation.location = user.employerInformation.companyLocation;
    user.employeeInformation.preferredLocations = {
        type: 'MultiPoint',
        coordinates: [user.employerInformation.companyLocation.coordinates]
    };

    user.employeeInformation.preferredLocationCities = [
        {
            city: user.employerInformation.companyAddress.city,
            state: user.employerInformation.companyAddress.state,
            country: user.employerInformation.country,
            latitude: user.employerInformation.companyLocation.coordinates[1],
            longitude: user.employerInformation.companyLocation.coordinates[0]
        }
    ];
    user.subscriptionInfo = checkPa.subscriptionInfo;
    user.isMaster = false;
    user.isSlave = true;
    user.isPa = true;
    user.paId = mongoose.Types.ObjectId(request.payload.paId);
    user.membership = checkPa.membership;
    user.isConsulting = !!checkPa.isConsulting;
    user.isUniversity = !!checkPa.isUniversity;
    user.isIndividual = !!checkPa.isIndividual;
    user.isOrganization = !!checkPa.isOrganization;
    user.isNonProfit = !!checkPa.isNonProfit;
    user.isTraining = !!checkPa.isTraining;
    user.isRoleSet = true;
    user.isPreferenceSet = true;

    /* Send app download email */
    if (checkPa.isNonProfit) {
        let email = {
            to: [{
                email: request.payload.email,
                type: 'to'
            }],
            subject: checkPa.firstName + ' ' + checkPa.lastName + ' has invited you to join them in EZJobs',
            important: true,
            merge: true,
            inline_css: true,
            merge_language: 'mailchimp',
            merge_vars: [{
                rcpt: request.payload.email,
                vars: [
                    {
                        name: 'password',
                        content: user.password
                    },
                    {
                        name: 'fname',
                        content: user.firstName + ' ' + user.lastName
                    },
                    {
                        name: 'url',
                        content: 'https://pa.ezjobs.io'
                    },
                    {
                        name: 'community',
                        content: checkPa.isOrganization ? paAdmin.employerInformation.companyName : checkPa.employerInformation.companyName
                    },
                    {
                        name: 'email',
                        content: request.payload.email
                    }
                ]
            }]
        };

        try {
            /* await mandrill.Handlers.sendTemplate('mail-to-users-from-ezpa', [], email, true);*/
            if (process.env.NODE_ENV === 'production') {
                if (checkPa.membership.toString() === '601b296b1518584fb3e1d52e') {
                    await mandrill.Handlers.sendTemplate('tie-champions', [], email, true);
                } else if (checkPa.membership.toString() === '611aa6d519add1146d831b72') {
                    await mandrill.Handlers.sendTemplate('temple-champions', [], email, true);
                } else {
                    await mandrill.Handlers.sendTemplate('its-champions', [], email, true);
                }
            } else {
                await mandrill.Handlers.sendTemplate('tie-champions', [], email, true);
            }
        } catch (e) {
            logger.error('Error occurred while sending email in add user handler %s:', JSON.stringify(e));
        }
    } else {
        let email = {
            to: [{
                email: request.payload.email,
                type: 'to'
            }],
            subject: checkPa.firstName + ' ' + checkPa.lastName + ' has invited you to join them in EZJobs PA',
            important: true,
            merge: true,
            inline_css: true,
            merge_language: 'mailchimp',
            merge_vars: [{
                rcpt: request.payload.email,
                vars: [
                    {
                        name: 'password',
                        content: user.password
                    },
                    {
                        name: 'fname',
                        content: user.firstName + ' ' + user.lastName
                    },
                    {
                        name: 'url',
                        content: 'https://pa.ezjobs.io'
                    },
                    {
                        name: 'community',
                        content: checkPa.isOrganization ? paAdmin.employerInformation.companyName : checkPa.employerInformation.companyName
                    },
                    {
                        name: 'email',
                        content: request.payload.email
                    }
                ]
            }]
        };

        try {
             await mandrill.Handlers.sendTemplate('mail-to-users-from-ezpa', [], email, true);
        } catch (e) {
            logger.error('Error occurred while sending email in add user handler %s:', JSON.stringify(e));
        }
    }

    try {
        await user.save();
    } catch (e) {
        logger.error('Error occurred while saving user in add user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get category for saving it into job */
    try {
        category = await categorySchema.categorySchema.findOne({isActive: true, categoryName: 'Others'}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding category in signup pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Create default PA config*/
    const configToSave = {
        paId: user._id,
        degree: [],
        major: [],
        email: '',
        course: [],
        batch: [],
        jobTitles: [],
        isExposedToAll: [true]
    };
    try {
        await new paConfigSchema.paConfigSchema(configToSave).save();
    } catch (e) {
        logger.error('Error occurred saving default config information in upload members PA admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Create a fake job so that PA can chat with his/her candidates */
    jobData = new jobSchema.jobSchema(request.payload);
    jobData.jobTitle = checkPa.isUniversity ? 'Placement officer' : 'Consulting company';
    jobData.location.coordinates = [0, 0];
    jobData.displayLocation.coordinates = [[0, 0]];
    jobData.numberOfPositions = 1;
    jobData.isVisible = false;
    jobData.userId = mongoose.Types.ObjectId(user._id);
    jobData.categoryId = mongoose.Types.ObjectId(category._id);

    try {
        await jobData.save();
    } catch (e) {
        logger.error('Error occurred while saving job data in add user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Add this user to the exposed list */
    let bulk = jobSchema.jobSchema.collection.initializeUnorderedBulkOp();
    bulk
        .find({isExposedToCommunity: true, membership: checkPa.membership.toString()})
        .update({$push: {exposedTo: user._id}});
    try {
        await bulk.execute();
    } catch (e) {
        logger.error('Error occurred while pushing exposed data in add user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update master account user */
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.paId}, {$push: {slaveUsers: user._id}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating user in add user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(user, 'User added successfully', 'success', 201)).code(200);
};

paHandler.getUsers = async (request, h) => {
    let checkPa, decoded, users;

    /* Check if PA exists */
    try {
        checkPa = await userSchema.UserSchema.findById({_id: request.query.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding pa in get users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPa) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found.', 'error', 404)).code(404);
    } else if (!checkPa.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user is actually who is trying to access the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get mail server handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Get user information */
    try {
        users = await userSchema.UserSchema.findById({_id: request.query.paId}, {_id: 1, slaveUsers: 1}, {lean: true}).populate('slaveUsers', 'firstName lastName _id email employeeInformation.profilePhoto employerInformation.companyProfilePhoto employeeInformation.phone employerInformation.companyPhone isActive chapter hasOwned');
    } catch (e) {
        logger.error('Error occurred while finding slave users in get users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get chapter information if any */
    const len = users.slaveUsers.length;
    for (let i = 0; i < len; i++) {
        if (users.slaveUsers[i].chapter) {
            let chapter;
            try {
                chapter = await chapterSchema.chapterSchema.findById({_id: users.slaveUsers[i].chapter}, {name: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding chapter in get users handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (chapter) {
                users.slaveUsers[i].chapter = chapter.name;
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(users, 'Fetched successfully', 'success', 200)).code(200);
};

paHandler.removeUser = async (request, h) => {
    let checkPA, decoded;

    /* Check if user exists in EZJobs database */
    try {
        checkPA = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.paId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPA) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    } else if (!checkPA.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized.', 'error', 401)).code(401);
    } else if (checkPA.isSlave) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action.', 'error', 400)).code(400);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkPA._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    const idx = checkPA.slaveUsers.findIndex(i => i.toString() === request.payload.userId);
    if (idx === -1) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 400)).code(400);
    }

    /* Make remove user as individual user */
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$set: {isActive: request.payload.isActive}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating user information in get users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Remove token of that user */
    try {
        await tokenSchema.authTokenSchema.findOneAndDelete({userId: request.payload.userId});
    } catch (e) {
        logger.error('Error occurred while deleting token information in get users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Status updated.', 'success', 204)).code(200);
};

paHandler.getMemberships = async (request, h) => {
    let memberships = [], data;

    try {
        data = await constantSchema.constantSchema.findOne({}, {memberships: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting constant data in get memberships handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (data && data.memberships) {
        data.memberships = data.memberships.filter(k => k.country === request.query.country);
        memberships = data.memberships;
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(memberships, 'Fetched successfully.', 'success', 200)).code(200);
}

paHandler.changeCandidateStatus = async (request, h) => {
    let checkPa, decoded, constantData;

    /* Check if user exists in EZJobs database */
    try {
        checkPa = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.paId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in change candidate status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPa) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    } else if (!checkPa.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in change candidate status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkPa._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether status is valid */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {candidateStatus: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting constant information in change candidate status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (constantData) {
        if (!constantData.candidateStatus) {
            constantData.candidateStatus = [];
        }
        const idx = constantData.candidateStatus.findIndex(k => k === request.payload.status);
        if (idx === -1) {
            return h.response(responseFormatter.responseFormatter({}, 'Invalid status.', 'error', 400)).code(400);
        }
    }

    /* Check candidate existence with PA and update accordingly */
    const len = request.payload.candidateIds.length;
    for (let i = 0; i < len; i++) {
        let checkCandidate;

        /* Check if candidate is linked to this PA */
        try {
            checkCandidate = await userSchema.UserSchema.findOne({_id: mongoose.Types.ObjectId(request.payload.candidateIds[i]), paId: mongoose.Types.ObjectId(request.payload.paId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting candidate information in change candidate status handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (checkCandidate) {
            if (request.payload.status !== 'Qualified') {
                try {
                    await candidateStatusSchema.candidateStatusSchema.findOneAndUpdate({paId: mongoose.Types.ObjectId(request.payload.paId), candidateId: mongoose.Types.ObjectId(request.payload.candidateIds[i])}, {$set: {status: request.payload.status}}, {lean: true, upsert: true});
                } catch (e) {
                    logger.error('Error occurred while updating candidate status information in change candidate status handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            } else {
                try {
                    await candidateStatusSchema.candidateStatusSchema.findOneAndDelete({paId: mongoose.Types.ObjectId(request.payload.paId), candidateId: mongoose.Types.ObjectId(request.payload.candidateIds[i])});
                } catch (e) {
                    logger.error('Error occurred while removing candidate status information in change candidate status handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Status updated.', 'success', 204)).code(200);
};

paHandler.sendEmail = async (request, h) => {
    let checkPa, decoded;

    /* Check if user exists in EZJobs database */
    try {
        checkPa = await userSchema.UserSchema.findById({_id: request.payload.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in send email handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPa) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    } else if (!checkPa.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in send email handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkPa._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check if provided campus interview ids are linked to the given PA */
    const len = request.payload.campusInterviewIds.length;
    for (let i = 0; i < len; i++) {
        let checkInterview, matchCriteria, candidates, checkEmployer;
        try {
            checkInterview = await campusInterviewSchema.campusInterviewSchema.findOne({_id: mongoose.Types.ObjectId(request.payload.campusInterviewIds[i]), paId: mongoose.Types.ObjectId(request.payload.paId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding campus interview in send email handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!checkInterview) {
            return h.response(responseFormatter.responseFormatter({}, 'One of the campus interviews selected does not belong to you.', 'error', 400)).code(400);
        }

        /* Get employer information */
        try {
            checkEmployer = await userSchema.UserSchema.findById({_id: checkInterview.employerId}, {employerInformation: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding employer in send email handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        matchCriteria = {
            paId: checkInterview.paId,
            roles: 'Candidate',
            'employeeInformation.educationPA.level': checkInterview.degree,
            'employeeInformation.educationPA.major': checkInterview.major,
        };

        if (checkInterview.cutOfCgpa) {
            matchCriteria['employeeInformation.educationPA.cgpa'] = {$gte: checkInterview.cutOfCgpa};
        }

        if (checkInterview.cutOfRank) {
            matchCriteria['employeeInformation.educationPA.rank'] = {$lte: checkInterview.cutOfRank};
        }

        /* Get candidates */
        try {
            candidates = await userSchema.UserSchema.aggregate([
                {
                    $match: matchCriteria
                },
                {
                    $project: {
                        firstName: 1,
                        lastName: 1,
                        email: 1
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while aggregating user collection in send email handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        const ln = candidates.length;
        for (let i = 0; i < ln; i++) {
            /* Send email to candidate */
            const options = { year: "numeric", month: "long", day: "numeric" }
            const date = new Date(checkInterview.visitDate).toLocaleDateString(undefined, options)
            const time = new Date(checkInterview.visitTime).toLocaleTimeString();
            const address = checkInterview.address.address1 + ', ' + (checkInterview.address.address2 ? (checkInterview.address.address2 + ', ') : '') +
                checkInterview.address.city + ', ' + checkInterview.address.state + ', ' + checkInterview.address.zipCode + '.'
            let email = {
                to: [{
                    email: candidates[i].email,
                    type: 'to'
                }],
                important: true,
                merge: true,
                inline_css: true,
                merge_language: 'mailchimp',
                merge_vars: [{
                    rcpt: candidates[i].email,
                    vars: [
                        {
                            name: 'firstName',
                            content: candidates[i].firstName
                        },
                        {
                            name: 'companyName',
                            content: checkEmployer.employerInformation.companyName
                        },
                        {
                            name: 'collegeName',
                            content: checkPa.employerInformation.companyName
                        },
                        {
                            name: 'date',
                            content: date
                        },
                        {
                            name: 'time',
                            content: time
                        },
                        {
                            name: 'location',
                            content: address
                        }
                    ]
                }]
            };
            await mandrill.Handlers.sendTemplate('campus-interview-schedule', [], email, true);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Email sent.', 'success', 200)).code(200);
};

/*paHandler.getChapters = async (request, h) => {
    let chapters;

    try {
        chapters = await chapterSchema.chapterSchema.find({country: request.query.country}, {}, {lean: true}).sort({name: 1});
    } catch (e) {
        logger.error('Error occurred while finding chapters in get chapters handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /!* Success *!/
    return h.response(responseFormatter.responseFormatter(chapters, 'Fetched successfully.', 'success', 200)).code(200);
};*/

paHandler.sendJobsToCandidates = async (request, h) => {
    let checkPa, decoded;

    /* Check if user exists in EZJobs database */
    try {
        checkPa = await userSchema.UserSchema.findById({_id: request.payload.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in send jobs to candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPa) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    } else if (!checkPa.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in send jobs to candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkPa._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get job details */
    const jobLen = request.payload.jobIds.length, jobData = [];
    for (let i = 0; i < jobLen; i++) {
        let job;

        /* Find job details from job ID */
        try {
            job = await jobSchema.jobSchema.findOne({_id: mongoose.Types.ObjectId(request.payload.jobIds[i]), isArchived: false}, {_id: 1, jobTitle: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting job data in send jobs to candidates handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (job) {
            /* Create deep link for the job */
            const link = await commonFunctions.Handlers.createFirebaseShortLink('', job._id, '', '', '', '', '', '', '');
            if (link !== 'error') {
                jobData.push({
                    _id: job._id,
                    jobTitle: job.jobTitle,
                    deepLink: link.shortLink
                });
            }
        }
    }

    /* Get candidates details */
    const candidatesLen = request.payload.candidateIds.length, candidateData = [];
    for (let i = 0; i < candidatesLen; i++) {
        let candidate;

        /* Find candidate details from candidate ID */
        try {
            candidate = await userSchema.UserSchema.findOne({_id: mongoose.Types.ObjectId(request.payload.candidateIds[i]), paId: mongoose.Types.ObjectId(request.payload.paId)}, {_id: 1, email: 1, firstName: 1, lastName: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting candidates data in send jobs to candidates handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (candidate) {
            candidateData.push({
                email: candidate.email,
                firstName: candidate.firstName,
                lastName: candidate.lastName
            });
        }
    }

    /* Send email to all the candidates with the job data */
    const len = candidateData.length;
    for (let i = 0; i < len; i++) {
        let email = {
            to: [{
                email: candidateData[i].email,
                type: 'to'
            }],
            important: true,
            merge: true,
            inline_css: true,
            merge_language: 'handlebars',
            merge_vars: [{
                rcpt: candidateData[i].email,
                vars: [
                    {
                        name: 'firstName',
                        content: candidateData[i].firstName
                    },
                    {
                        name: 'lastName',
                        content: candidateData[i].lastName
                    },
                    {
                        name: 'fields',
                        content: jobData
                    }
                ]
            }]
        };
        await mandrill.Handlers.sendTemplate('send_jobs_to_c', [], email, true);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Sent successfully.', 'success', 200)).code(200);
};

paHandler.uploadBulkDataFromCSVCustom = async (request, h) => {
    let fileName = request.payload.file.filename, candidateCount = 0, checkUser, decoded, checkJob, uploadData, result, totalCount = 0;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in upload candidates data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in upload candidates data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    const ext = fileName.split('.')[1];

    if (ext !== 'xls' && ext !== 'xlsx') {
        return h.response(responseFormatter.responseFormatter({}, 'The given file is not a xls file', 'error', 400)).code(400);
    }

    /* Check if placement officer has posted a job or not */
    try {
        checkJob = await jobSchema.jobSchema.findOne({userId: request.payload.userId, isVisible: false}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding job in upload candidates data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkJob) {
        return h.response(responseFormatter.responseFormatter({}, 'No job found for the placement officer', 'error', 404)).code(404);
    }

    try {
        result = await commonFunctions.Handlers.parseExcelForPA(request.payload.file.path);
    } catch (e) {
        logger.error('Error occurred parsing excel file in upload candidates data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error while parsing excel file', 'error', 500)).code(500);
    }

    const len = result.length;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /* Create a record for history */
    const uploadHistory = {
        fileName: fileName,
        paId: mongoose.Types.ObjectId(request.payload.userId),
        status: 'Pending',
        uploadCount: 0,
        degree: '',
        graduationYear: 0,
        major: ''
    };

    uploadData = new uploadHistorySchema.uploadHistory(uploadHistory);

    try {
        await uploadData.save();
    } catch (e) {
        logger.error('Error occurred while saving upload data in upload candidates data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    let major = '';
    for (let i = 0; i < len; i++) {
        let checkCandidate;
        const data = result[i];

        /* Search whether this user is already present in the database or not */
        if (data['Email']) {
            totalCount++;
            try {
                checkCandidate = await userSchema.UserSchema.findOne({email: data['Email'].toLowerCase()}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding user in uploadBulkDataFromCSV PA handler %s:', JSON.stringify(e));
                /* Update upload data */
                try {
                    await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Error'}}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while upload history details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                }
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if (!checkCandidate) {
                const tempPassword = commonFunctions.Handlers.generatePassword();
                /**/
                let educationData = [];
                if (data['X Marks']) {
                    let board = '';
                    if (data['X Board']) {
                        const xBoard = data['X Board'].split(' ');
                        if (xBoard[0].toLowerCase() === 'other') {
                            board = 'Other';
                        } else if (xBoard[0].toLowerCase() === 'central') {
                            board = 'CBSE';
                        } else if (xBoard[0].toLowerCase() === 'indian') {
                            board = 'ICSE';
                        } else if (xBoard[0].toLowerCase() === 'international') {
                            board = 'IB';
                        } else {
                            board = 'State';
                        }
                        educationData.push({
                            university: '',
                            level: 'X',
                            graduationYear: Number(data['X Year']) ? Number(data['X Year']) : 0,
                            major: '',
                            cgpa: Number(data['X Marks']) ? Number(data['X Marks']) : 0,
                            rank: 0,
                            board: board,
                            outOf: 100
                        });
                    }
                }
                if (data['XII Marks']) {
                    let board = '';
                    if (data['XII Board']) {
                        const xBoard = data['XII Board'].split(' ');
                        if (xBoard[0].toLowerCase() === 'other') {
                            board = 'Other';
                        } else if (xBoard[0].toLowerCase() === 'central') {
                            board = 'CBSE';
                        } else if (xBoard[0].toLowerCase() === 'indian') {
                            board = 'ICSE';
                        } else if (xBoard[0].toLowerCase() === 'international') {
                            board = 'IB';
                        } else {
                            board = 'State';
                        }
                        educationData.push({
                            university: '',
                            level: 'XII',
                            graduationYear: Number(data['XII Year']) ? Number(data['XII Year']) : 0,
                            major: '',
                            cgpa: Number(data['XII Marks']) ? Number(data['XII Marks']) : 0,
                            rank: 0,
                            board: board,
                            outOf: 100
                        });
                    }
                }

                /* Check if the excel sheet provided major is present in EZJobs database */
                if (major !== data['Graduation Branch']) {
                    let checkMajor;
                    try {
                        checkMajor = await majorSchema.majorSchema.findOne({majorName: new RegExp(data['Graduation Branch'].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while finding major in uploadBulkDataFromCSV PA handler %s:', JSON.stringify(e));
                        /* Update upload data */
                        try {
                            await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Error'}}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred while upload history details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                        }
                    }
                    if (!checkMajor) {
                        const dataToSave = {
                            majorName: data['Graduation Branch'].toUpperCase()
                        };
                        try {
                            await new majorSchema.majorSchema(dataToSave).save();
                        } catch (e) {
                            logger.error('Error occurred while saving major in uploadBulkDataFromCSV PA handler %s:', JSON.stringify(e));
                        }
                    }
                    major = data['Graduation Branch'];
                }

                educationData.push({
                    university: checkUser.employerInformation.companyName,
                    level: 'B.Tech.',
                    graduationYear: Number(data['Graduation Year']),
                    major: major,
                    cgpa: Number(data['Graduation Marks']),
                    rank: 0,
                    board: '',
                    outOf: 100
                });
                /**/
                const fullName = data['Name'].split(' ');
                const monthOfBirth = months.findIndex(k => k === data['Date of Birth'].split('-')[1]);
                let dataToSave = {
                    firstName: fullName[0],
                    lastName: fullName[fullName.length - 1],
                    email: data['Email'].toLowerCase(),
                    'employeeInformation.rollNumber': data['Roll Number'],
                    'employeeInformation.educationPA': {
                        university: checkUser.employerInformation.companyName,
                        level: 'B.Tech.',
                        graduationYear: Number(data['Graduation Year']),
                        major: major,
                        cgpa: Number(data['Graduation Marks']),
                        rank: Number(data['Rank']) ? Number(data['Rank']) : 0
                    },
                    'employeeInformation.education': educationData,
                    'employeeInformation.skills': [],
                    'employeeInformation.skillsLower': [],
                    'employeeInformation.dob': {
                        day: data['Date of Birth'].split('-')[0],
                        month: monthOfBirth + 1,
                        year: data['Date of Birth'].split('-')[2]
                    },
                    'employeeInformation.resume': '',
                    roles: ['Candidate'],
                    'employeeInformation.location': checkUser.employerInformation.companyLocation,
                    'employerInformation.companyLocation': checkUser.employerInformation.companyLocation,
                    'employerInformation.companyAddress': checkUser.employerInformation.companyAddress,
                    'employeeInformation.address': checkUser.employerInformation.companyAddress,
                    'employeeInformation.country': checkUser.country,
                    'employerInformation.country': checkUser.country,
                    country: checkUser.country,
                    'employeeInformation.countryCode': checkUser.employerInformation.countryCode,
                    'employeeInformation.phone': data['Mobile'],
                    isAddedByBulkUploadPA: true,
                    paId: mongoose.Types.ObjectId(request.payload.userId),
                    tempPassword: 'qwerty',
                    password: 'qwerty',
                    hasInstalled: false,
                    membership: checkUser.membership ? checkUser.membership : '',
                    'employeeInformation.homeTown': data['Home Town'],
                    gender: data['Gender'].toLowerCase(),
                    'employeeInformation.batch': data['Batch'],
                };

                dataToSave['employeeInformation.preferredLocations'] = {
                    type: 'MultiPoint',
                    coordinates: [checkUser.employerInformation.companyLocation.coordinates]
                };

                dataToSave['employeeInformation.preferredLocationCities'] = [
                    {
                        city: checkUser.employerInformation.companyAddress.city,
                        state: checkUser.employerInformation.companyAddress.state,
                        country: checkUser.country,
                        latitude: checkUser.employerInformation.companyLocation.coordinates[1],
                        longitude: checkUser.employerInformation.companyLocation.coordinates[0]
                    }
                ];

                const saveData = new userSchema.UserSchema(dataToSave);
                try {
                    await saveData.save();
                } catch (e) {
                    logger.error('Error occurred saving user in uploadBulkDataFromCSV PA handler %s:', JSON.stringify(e));
                    /* Update upload data */
                    try {
                        await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Error'}}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while upload history details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                    }
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                candidateCount++;

                /* Create a chat with the placement officer */
                const chatToSave = {
                    roomId: saveData._id.toString() + request.payload.userId + checkJob._id.toString(),
                    candidateId: mongoose.Types.ObjectId(saveData._id),
                    employerId: mongoose.Types.ObjectId(request.payload.userId),
                    jobId: mongoose.Types.ObjectId(checkJob._id),
                    isApplied: true,
                    isInvited: true,
                    hasEmployerDeleted: false,
                    hasCandidateDeleted: false,
                    isCandidateBlocked: false,
                    isEmployerBlocked: false,
                    paId: mongoose.Types.ObjectId(checkUser._id),
                    chats: [{
                        from: mongoose.Types.ObjectId(request.payload.userId),
                        to: mongoose.Types.ObjectId(saveData._id),
                        body: aes256.encrypt(key, 'This is your placement officer.'),
                        originalBody: aes256.encrypt(key, 'This is your placement officer.'),
                        type: 'isText',
                        duration: 0,
                        latitude: '',
                        longitude: '',
                        isRead: false,
                        hasEmployerDeleted: false,
                        hasCandidateDeleted: false,
                        isCandidateBlocked: false,
                        isEmployerBlocked: false,
                        isEncrypted: true,
                        isTranslated: false
                    }]
                };

                try {
                    await new conversationSchema.conversationSchema(chatToSave).save();
                } catch (e) {
                    logger.error('Error occurred saving chat in uploadBulkDataFromCSV PA handler %s:', JSON.stringify(e));
                    /* Update upload data */
                    try {
                        await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Error'}}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while upload history details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                    }
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                /* Send email to the candidates for with the password and link to download the app */
                if (dataToSave.email) {
                    let email;
                    try {
                        /* Create dynamic link */
                        const shortLink = await commonFunctions.Handlers.createFirebaseShortLink(dataToSave.email, '', '');
                        email = {
                            to: [{
                                email: dataToSave.email,
                                type: 'to'
                            }],
                            important: true,
                            subject: checkUser.employerInformation.companyName + ' has invited you to join them',
                            merge: true,
                            inline_css: true,
                            merge_language: 'mailchimp',
                            merge_vars: [{
                                rcpt: dataToSave.email,
                                vars: [
                                    {
                                        name: 'fname',
                                        content: dataToSave.firstName.trim()
                                    },
                                    {
                                        name: 'email',
                                        content: dataToSave.email
                                    },
                                    {
                                        name: 'password',
                                        content: dataToSave.tempPassword
                                    },
                                    {
                                        name: 'downloadURL',
                                        content: shortLink.shortLink
                                    }
                                ]
                            }]
                        };
                        try {
                            await mandrill.Handlers.sendTemplate('mail-to-consultants-ezpa', [], email, true);
                        } catch (e) {
                            logger.error('Error occurred while sending invitation email in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                        }
                    } catch (e) {
                        logger.error('Error in sending app download link to user %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }

            }
        }
    }

    /* Update upload data */
    try {
        await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: candidateCount, errorCount: totalCount - candidateCount, status: 'Complete'}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while upload history details in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter({}, 'Uploaded successfully', 'success', 200)).code(200);
};

paHandler.inviteEmployer = async (request, h) => {
    let checkUser, decoded, checkDuplicate;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in invite employer handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in invite employer handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user already exists with the given email */
    try {
        checkDuplicate = await userSchema.UserSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding duplicate user in invite employer handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (checkDuplicate) {
        return h.response(responseFormatter.responseFormatter({}, 'A user with the given email already exists.', 'error', 400)).code(400);
    }

    let email = {
        to: [{
            email: request.payload.email,
            type: 'to'
        }],
        important: true,
        merge: true,
        inline_css: true,
        merge_language: 'mailchimp',
        subject: 'Invitation from ' + checkUser.employerInformation.companyName + ' to signup with EZJobs',
        merge_vars: [{
            rcpt: request.payload.email,
            vars: [
                {
                    name: 'community',
                    content: checkUser.employerInformation.companyName
                },
                {
                    name: 'fname',
                    content: request.payload.companyName
                }
            ]
        }]
    };
    try {
        await mandrill.Handlers.sendTemplate('invitation-to-employers-not-in-communities-ezpa', [], email, true);
    } catch (e) {
        logger.error('Error occurred sending invitation data in invite employer handler %s:', JSON.stringify(e));
    }

    /* Save into invitation collection */
    const data = {
        userId: mongoose.Types.ObjectId(request.payload.userId),
        companyName: request.payload.companyName,
        email: request.payload.email,
        phone: request.payload.phone ? request.payload.countryCode + request.payload.phone : '',
        isInvited: true,
        isInvitationAccepted: false
    };
    try {
        await new invitationSchema.invitationSchema(data).save();
    } catch (e) {
        logger.error('Error occurred saving invitation data in invite employer handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter({}, 'Invitation sent.', 'success', 200)).code(200);
};

paHandler.inviteEmployers = async (request, h) => {
    let fileName = request.payload.file.filename, checkUser, decoded, result;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in invite employers data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in invite employers data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    const ext = fileName.split('.')[1];

    if (ext !== 'xls' && ext !== 'xlsx') {
        return h.response(responseFormatter.responseFormatter({}, 'The given file is not a xls file', 'error', 400)).code(400);
    }

    try {
        result = await commonFunctions.Handlers.parseExcelForPA(request.payload.file.path);
    } catch (e) {
        logger.error('Error occurred parsing excel file in invite employers data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error while parsing excel file', 'error', 500)).code(500);
    }

    const len = result.length;

    for (let i = 0; i < len; i++) {
        let checkEmployer;
        const data = result[i];

        /* Search whether this user is already present in the database or not */
        if (data['Email']) {
            try {
                checkEmployer = await userSchema.UserSchema.findOne({email: data['Email']}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding user in invite Employers PA handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if (!checkEmployer) {
                /* Send email to the employers for with the link to download the app */
                if (data['Email']) {
                    let email = {
                        to: [{
                            email: data['Email'],
                            type: 'to'
                        }],
                        important: true,
                        merge: true,
                        inline_css: true,
                        merge_language: 'mailchimp',
                        subject: 'Invitation from ' + checkUser.employerInformation.companyName + ' to signup with EZJobs',
                        merge_vars: [{
                            rcpt: data['Email'],
                            vars: [
                                {
                                    name: 'community',
                                    content: checkUser.employerInformation.companyName
                                },
                                {
                                    name: 'fname',
                                    content: data['Company Name']
                                }
                            ]
                        }]
                    };
                    try {
                        await mandrill.Handlers.sendTemplate('invitation-to-employers-not-in-communities-ezpa', [], email, true);
                    } catch (e) {
                        logger.error('Error occurred while sending invitation email in invite employers handler %s:', JSON.stringify(e));
                    }
                    let checkInvitation;

                    try {
                        checkInvitation = await invitationSchema.invitationSchema.findOne({userId: mongoose.Types.ObjectId(request.payload.userId)}, {}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while finding invitation in invite employers handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }

                    /* Save into invitation collection */
                    const dataToSave = {
                        userId: mongoose.Types.ObjectId(request.payload.userId),
                        companyName: data['Company Name'],
                        email: data['Email'],
                        phone: data['Phone'] ? data['Phone'] : '',
                        isInvited: true,
                        isInvitationAccepted: false
                    };
                    try {
                        await new invitationSchema.invitationSchema(dataToSave).save();
                    } catch (e) {
                        logger.error('Error occurred saving invitation data in invite employers handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }
            }
        }
    }

    return h.response(responseFormatter.responseFormatter({}, 'Uploaded successfully', 'success', 200)).code(200);
};

paHandler.getNetwork = async (request, h) => {
    let checkUser, decoded, searchCriteria, dataToReturn = [], aggregationCriteria = [], constantData, groups, allGroupMembers = [], members = [], tempMembers = [], tempSet;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get network handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa && !checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get network handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user is master or not */
    let masterUser;
    if (checkUser.isMaster) {
        checkUser.slaveUsers.push(mongoose.Types.ObjectId(checkUser._id));
    } else {
        try {
            masterUser = await userSchema.UserSchema.findById({_id: checkUser.paId}, {_id: 1, slaveUsers: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding master user in get network handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!masterUser) {
            return h.response(responseFormatter.responseFormatter({}, 'Something went wrong. Please contact support.', 'error', 400)).code(400);
        } else {
            masterUser.slaveUsers.push(mongoose.Types.ObjectId(masterUser._id));
        }
    }

    if (request.query.type === 'allNetwork') {
        searchCriteria = {
            _id: {$nin: (checkUser.isMaster ? checkUser.slaveUsers : masterUser.slaveUsers)},
            isPa: true,
            roles: 'Employer'
        }
    } else if (request.query.type === 'partnerNetwork') {
        if (!checkUser.membership || (!checkUser.additionalMemberships && !checkUser.additionalMemberships.length)) {
            return h.response(responseFormatter.responseFormatter([], 'Fetched successfully.', 'success', 200)).code(200);
        } else {
            checkUser.additionalMemberships.push(mongoose.Types.ObjectId(checkUser.membership));
            let allMemberships = checkUser.additionalMemberships, allMembershipsString = checkUser.membership;
            searchCriteria = {
                _id: {$nin: (checkUser.isMaster ? checkUser.slaveUsers : masterUser.slaveUsers)},
                isPa: true,
                roles: 'Employer',
                $or: [{membership: allMembershipsString}, {additionalMemberships: {$in: allMemberships}}]
            }
        }
    } else if (request.query.type === 'groupNetwork') {
        /* Get the list of groups */
        try {
            groups = await groupSchema.groupSchema.find({userId: mongoose.Types.ObjectId(checkUser._id), isActive: true}, {members: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding groups in get network handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        const groupLength = groups.length;

        for (let i = 0; i < groupLength; i++) {
            allGroupMembers = allGroupMembers.concat(groups[i].members);
        }
        searchCriteria = {
            _id: {$in: allGroupMembers},
            isPa: true,
            roles: 'Employer'
        }
    } else if (request.query.type === 'pending' || request.query.type === 'accepted' || request.query.type === 'received' || request.query.type === 'all') {
        let searchCriteriaInner = {};
        if (request.query.type === 'pending') {
            searchCriteriaInner = {sender: mongoose.Types.ObjectId(request.query.userId), $or: [{status: 'pending'}, {status: 'rejected'}]}
        } else if (request.query.type === 'accepted' || request.query.type === 'all') {
            searchCriteriaInner = {$or: [{sender: mongoose.Types.ObjectId(request.query.userId)}, {receiver: mongoose.Types.ObjectId(request.query.userId)}], status: 'accepted'};
        } else if (request.query.type === 'received') {
            searchCriteriaInner = {receiver: mongoose.Types.ObjectId(request.query.userId), status: 'pending'}
        }

        try {
            members = await networkSchema.networkSchema.find(searchCriteriaInner, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding members in get network handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        tempSet = new Set();
        if (request.query.type === 'accepted' || request.query.type === 'all') {
            let memberSet = new Set();
            for (let i = 0; i < members.length; i++) {
                if (members[i].sender.toString() === request.query.userId) {
                    memberSet.add(members[i].receiver);
                    tempSet.add({userId: members[i].receiver.toString(), status: members[i].status});
                } else if (members[i].receiver.toString() === request.query.userId) {
                    memberSet.add(members[i].sender);
                    tempSet.add({userId: members[i].sender.toString(), status: members[i].status});
                }
            }
            members = Array.from(memberSet);
            tempMembers = Array.from(tempSet);
        }
        if (members.length && !tempSet.size) {
            for (let i = 0; i < members.length; i++) {
                if (members[i].sender.toString() === request.query.userId) {
                    tempSet.add({userId: members[i].receiver.toString(), status: members[i].status});
                } else if (members[i].receiver.toString() === request.query.userId) {
                    tempSet.add({userId: members[i].sender.toString(), status: members[i].status});
                }
            }
            tempMembers = Array.from(tempSet);
            if (request.query.type === 'pending') {
                members = members.map(k => k.receiver);
            } else if (request.query.type === 'received') {
                members = members.map(k => k.sender);
            }
        }

        members = members.map(k => mongoose.Types.ObjectId(k));

        searchCriteria = {
            _id: {$in: members},
            isPa: true,
            roles: 'Employer'
        }
    } else {
        aggregationCriteria.push({
            $match: {
                userId: {$in: (checkUser.isMaster ? checkUser.slaveUsers : [checkUser._id])}
            }
        });

        if (request.query.searchText) {
            const text = decodeURIComponent(request.query.searchText);
            aggregationCriteria.push(
                {
                    $match: {
                        $or: [{companyName: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {email: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}]
                    }
                }
            );
        }

        if (request.query.appDownload) {
            aggregationCriteria.push({
                $match: {
                    isInvitationAccepted: (request.query.appDownload === 'downloaded')
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
            $group: {
                _id: '$userId',
                data: {$push: '$$ROOT'}
            }
        });
        try {
            dataToReturn = await invitationSchema.invitationSchema.aggregate(aggregationCriteria);
        } catch (e) {
            logger.error('Error occurred while finding invitations in get network handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        return h.response(responseFormatter.responseFormatter(dataToReturn[0] ? dataToReturn[0].data : [], 'Fetched successfully', 'success', 200)).code(200);
    }

    if (request.query.minOneJob || request.query.isFresher || request.query.isInternship) {
        if (request.query.minOneJob) {
            searchCriteria['employerInformation.numberOfJobsPosted'] = {$gt: 0}
        }
    }

    if (request.query.appDownload) {
        searchCriteria['hasOwned'] = request.query.appDownload === 'downloaded';
    }

    aggregationCriteria.push({
        $match: searchCriteria
    });

    if (request.query.searchText) {
        aggregationCriteria.push({$match: {'employerInformation.companyName': new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}});
    }

    if (request.query.groupId) {
        delete aggregationCriteria[0].$match._id;
        let group;
        /* Get group */
        try {
            group = await groupSchema.groupSchema.findById({_id: request.query.groupId}, {members: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding group in get network handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (group) {
            if (request.query.type === 'pending' || request.query.type === 'accepted' || request.query.type === 'received' || request.query.type === 'all') {
                /* This is for matching only matching members from groups and networks */
                let matchingMembers = [];
                for (let i = 0; i < members.length; i++) {
                    const idx = group.members.findIndex(k => k.toString() === members[i].toString());
                    if (idx !== -1) {
                        matchingMembers.push(mongoose.Types.ObjectId(members[i]));
                    }
                    aggregationCriteria.push({
                        $match: {
                            _id: {$in: matchingMembers}
                        }
                    });
                }
            } else {
                aggregationCriteria.push({
                    $match: {
                        _id: {$in: group.members}
                    }
                });
            }
        }
    }

    if (request.query.membershipId) {
        aggregationCriteria.push({
            $match: {
                $or: [{membership: request.query.membershipId}, {additionalMemberships: mongoose.Types.ObjectId(request.query.membershipId)}]
            }
        });
    }

    aggregationCriteria.push({
        $sort: {
            _id: -1
        }
    });

    if (!request.query.minOneJob && !request.query.isFresher && !request.query.isInternship) {
        aggregationCriteria.push({
            $skip: request.query.skip
        });

        aggregationCriteria.push({
            $limit: request.query.limit
        });
    }

    let matchCriteria = {
        $expr: {
            $and: [
                {
                    $or: [{$and: [{$eq: ['$userId', '$$userId']}, {$eq: ['$isVisible', true]}, {$eq: ['$isArchived', false]}, {$eq: ['$isTranslated', false]}]}]
                },
                {
                    $or: [{$eq: ['$isExposedToAll', true]}, {$in: [checkUser._id, '$exposedTo']}, {$and: [{$eq: ['$isExposedToCommunity', true]}, {$eq: ['$membership', checkUser.membership]}]}]
                }
                ]
        }
    };

    if (request.query.isFresher) {
        matchCriteria['$expr']['$and'][0]['$or'][0]['$and'].push({$lt: ['$experienceInMonths', 1]});
    }

    if (request.query.isInternship) {
        matchCriteria['$expr']['$and'][0]['$or'][0]['$and'].push({$eq: ['$isInternship', true]});
    }

    if (checkUser.isPaAdmin) {
        matchCriteria.$expr.$and.pop();
    }

    /*{$in: ['$userId', '$$slaves']}, */
    aggregationCriteria.push({
        $lookup: {
            from: 'Job',
            let: {userId: '$_id', slaves: '$slaveUsers'},
            pipeline: [
                {
                    $match: matchCriteria
                }
            ],
            as: 'jobs'
        }
    });

    if (request.query.minOneJob || request.query.isFresher || request.query.isInternship) {
        aggregationCriteria.push({
            $match: {
                'jobs.0': {$exists: true}
            }
        });

        aggregationCriteria.push({
            $skip: request.query.skip
        });

        aggregationCriteria.push({
            $limit: request.query.limit
        });
    }

    /*{$in: ['$paId', '$$slaves']}*/
    aggregationCriteria.push({
        $lookup: {
            from: 'User',
            let: {userId: '$_id'},
            pipeline: [
                {
                    $match: {
                        $expr: {
                            $or: [{$and: [{$eq: ['$paId', '$$userId']}, {$eq: ['$isPa', false]}]}]
                        }
                    }
                }
            ],
            as: 'candidates'
        }
    });

    aggregationCriteria.push({
        $lookup: {
            from: 'Chapter',
            localField: 'employerInformation.chapter',
            foreignField: '_id',
            as: 'chapter'
        }
    });

    aggregationCriteria.push({
        $unwind: {
            path: '$chapter',
            preserveNullAndEmptyArrays: true
        }
    });

    aggregationCriteria.push({
        $lookup: {
            from: 'Network',
            let: {userId: '$_id'},
            pipeline: [
                {$match: {$expr: {$or: [{$and: [{$eq: ["$sender", "$$userId"]}, {$eq: ["$receiver", checkUser._id]}]}, {$and: [{$eq: ["$receiver", "$$userId"]}, {$eq: ["$sender", checkUser._id]}]}]}}}
            ],
            as: 'network'
        }
    });

    aggregationCriteria.push({
        $unwind: {
            path: '$network',
            preserveNullAndEmptyArrays: true
        }
    });

    aggregationCriteria.push({
        $project: {
            firstName: 1,
            lastName: 1,
            companyName: '$employerInformation.companyName',
            companyLogo: '$employerInformation.companyProfilePhoto',
            skillsAvailable: '$employerInformation.skillsAvailable',
            skillsPreference: '$employerInformation.skillsPreference',
            jobs: {$size: '$jobs'},
            candidates: {$size: '$candidates'},
            membership: 1,
            additionalMemberships: 1,
            chapter: '$chapter.name',
            status: '$network.status',
            sender: '$network.sender',
            receiver: '$network.receiver',
            requestId: '$network._id'
        }
    });

    try {
        dataToReturn = await userSchema.UserSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred while aggregating user collection in get network handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (dataToReturn.length) {
        let groups;

        /* Get the memberships of each employers if any */
        try {
            constantData = await constantSchema.constantSchema.findOne({}, {memberships: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding constant info in get network handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        try {
            groups = await groupSchema.groupSchema.find({userId: mongoose.Types.ObjectId(request.query.userId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding groups in get network handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        const usersLen = dataToReturn.length, groupLen = groups.length;
        if (groupLen) {
            for (let i = 0; i < usersLen; i++) {
                for (let j = 0; j < groupLen; j++) {
                    const idx = groups[j].members.findIndex(k => k.toString() === dataToReturn[i]._id.toString());
                    if (idx !== -1) {
                        if (dataToReturn[i].groups) {
                            dataToReturn[i].groups.push(groups[j].groupName);
                        } else {
                            dataToReturn[i].groups = [groups[j].groupName];
                        }
                    }
                }
            }
        }
        for (let i = 0; i < usersLen; i++) {
            const idx = constantData.memberships.findIndex(k => k._id.toString() === dataToReturn[i].membership);
            if (tempMembers.length) {
                const idx1 = tempMembers.findIndex(k => k.userId === dataToReturn[i]._id.toString());
                if (idx1 !== -1) {
                    dataToReturn[i].status = tempMembers[idx1].status;
                }
            }
            if (idx !== -1) {
                dataToReturn[i].membership = constantData.memberships[idx].name;
            }
            if (dataToReturn[i].additionalMemberships && dataToReturn[i].additionalMemberships.length) {
                let extraMemberships = [];
                for (let j = 0; j < dataToReturn[i].additionalMemberships.length; j++) {
                    const idx = constantData.memberships.findIndex(k => k._id.toString() === dataToReturn[i].additionalMemberships[j].toString());
                    if (idx !== -1) {
                        extraMemberships.push(constantData.memberships[idx].name);
                    }
                }
                delete dataToReturn[i].additionalMemberships;
                dataToReturn[i].additionalMemberships = extraMemberships;
            }
        }
    }

    return h.response(responseFormatter.responseFormatter(dataToReturn, 'Fetched successfully', 'success', 200)).code(200);
};

paHandler.createGroup = async (request, h) => {
    let checkUser, decoded, employers, dataToReturn;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in create group handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to access the end point */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in create group handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    request.payload.members = request.payload.members.map(k => mongoose.Types.ObjectId(k));

    /* Check if candidate group is exposed */
    /*if (request.payload.isCandidate) {
        let bulk = userSchema.UserSchema.collection.initializeUnorderedBulkOp(), updateCriteria = {}, findCriteria = {_id: {$in: request.payload.members}};
        if (request.payload.isExposedToAll) {
            updateCriteria = {$set: {isExposedToAll: true, isExposedToGroups: false, isExposedToCommunity: false, groupIds: []}};
        } else if (request.payload.isExposedToCommunity) {
            request.payload.membership = checkUser.membership;
            updateCriteria = {$set: {isExposedToAll: false, isExposedToGroups: false, isExposedToCommunity: true, groupIds: []}};
        } else if (request.payload.isExposedToGroups) {
            if (request.payload.groupIds && request.payload.groupIds.length) {
                request.payload.groupIds = request.payload.groupIds.map(k => mongoose.Types.ObjectId(k));
                /!* Get all the members of group *!/
                let employers = [];
                try {
                    employers = await groupSchema.groupSchema.find({_id: {$in: request.payload.groupIds}, userId: mongoose.Types.ObjectId(request.payload.userId), isHotList: true}, {members: 1}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding group members in create job handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                const temp = employers.map(k => k.members);
                const exposedTo = [].concat.apply([], temp);
                request.payload.exposedTo = exposedTo;
                updateCriteria = {$set: {isExposedToAll: false, isExposedToGroups: true, isExposedToCommunity: false, exposedTo: exposedTo}};
            }
        }
        /!* Update candidate for exposure *!/
        bulk
            .find(findCriteria)
            .update(updateCriteria);
        try {
            await bulk.execute();
        } catch (e) {
            logger.error('Error occurred while updating users for groups in create group handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }*/

    /* Save the data into hotlist collection */
    let documentsToInsert = [], members;
    if (request.payload.isExposedToCommunity) {
        checkUser.slaveUsers.push(checkUser._id);
        try {
            members = await userSchema.UserSchema.find({_id: {$nin: checkUser.slaveUsers}, isPa: true, membership: checkUser.membership}, {_id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding community members in create group handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.payload.isExposedToGroups) {
        try {
            employers = await groupSchema.groupSchema.find({_id: {$in: request.payload.groupIds}, userId: mongoose.Types.ObjectId(request.payload.userId), isHotList: true}, {members: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding group members in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        const temp = employers.map(k => k.members);
        members = [].concat.apply([], temp);
    }

    if (request.payload.isExposedToCommunity || request.payload.isExposedToGroups) {
        for (let i = 0; i < members.length; i++) {
            let dataToPush = {
                paId: mongoose.Types.ObjectId(request.payload.userId),
                userId: '',
                groupName: request.payload.groupName,
                members: request.payload.members,
                createdAt: Date.now
            };
            let hotListData = new hotListSchema.hotListSchema(dataToPush);
            if (request.payload.isExposedToCommunity) {
                hotListData.userId = mongoose.Types.ObjectId(members[i]._id);
            } else if (request.payload.isExposedToGroups) {
                hotListData.userId = mongoose.Types.ObjectId(members[i]);
            }
            documentsToInsert.push({insertOne: {'document': hotListData}});
        }
        try {
            await hotListSchema.hotListSchema.collection.bulkWrite(documentsToInsert);
        } catch (e) {
            logger.error('Error occurred while saving hotlist data in create group handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Save data into group */
    try {
        dataToReturn = await new groupSchema.groupSchema(request.payload).save();
    } catch (e) {
        logger.error('Error occurred while saving groups in create group handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(dataToReturn, 'Group created.', 'success', 201)).code(201);
};

paHandler.getGroups = async (request, h) => {
    let checkUser, decoded, groups, searchCriteria = {};

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get groups handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to access the end point */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get groups handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    if (checkUser.isMaster) {
        checkUser.slaveUsers.push(mongoose.Types.ObjectId(checkUser._id));
        searchCriteria = {
            userId: {$in: checkUser.slaveUsers},
            isCandidate: !!request.query.isCandidate
        };
    } else {
        searchCriteria = {
            userId: {$in: [checkUser._id]},
            isCandidate: !!request.query.isCandidate
        };
    }

    if (request.query['isHotList'] !== undefined) {
        searchCriteria['isHotList'] = request.query.isHotList;
    }

    /* Get groups */
    if (request.query.searchText) {
        searchCriteria['groupName'] = new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi');
    }
    try {
        groups = await groupSchema.groupSchema.find(searchCriteria, {}, {lean: true}).sort({createdAt: -1}).populate('members groupIds', 'firstName lastName employerInformation.companyName groupName').skip(request.query.skip).limit(request.query.limit);
    } catch (e) {
        logger.error('Error occurred while finding user in get groups handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(groups, 'Fetched successfully.', 'success', 200)).code(200);
};

paHandler.updateGroup = async (request, h) => {
    let checkUser, decoded, checkGroup, employers;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in update group handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to access the end point */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update group handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if group exists */
    try {
        checkGroup = await groupSchema.groupSchema.findById({_id: request.payload.groupId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding group in update group handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkGroup) {
        return h.response(responseFormatter.responseFormatter({}, 'No such group.', 'error', 404)).code(404);
    } else if (checkGroup && checkGroup.userId && (checkGroup.userId.toString() !== request.payload.userId)) {
        return h.response(responseFormatter.responseFormatter({}, 'No such group.', 'error', 400)).code(400);
    }

    request.payload.members = request.payload.members.map(k => mongoose.Types.ObjectId(k));

    if (request.payload.groupIds && request.payload.groupIds.length) {
        request.payload.groupIds = request.payload.groupIds.map(k => mongoose.Types.ObjectId(k));
    }

    /* Update group */
    const dataToUpdate = {
        members: request.payload.members,
        isHotList: request.payload.isHotList,
        isJob: request.payload.isJob,
        groupName: request.payload.groupName,
        membership: request.payload.isExposedToCommunity ? checkUser.membership : '',
        exposedTo: request.payload.isExposedToGroups ? request.payload.members : [],
        groupIds: request.payload.groupIds ? request.payload.groupIds : [],
        isExposedToAll: !!request.payload.isExposedToAll,
        isExposedToGroups: !!request.payload.isExposedToGroups,
        isExposedToCommunity: !!request.payload.isExposedToCommunity
    };

    if (!request.payload.isActive) {
        try {
            await groupSchema.groupSchema.findByIdAndDelete({_id: request.payload.groupId});
        } catch (e) {
            logger.error('Error occurred while deleting group in update group handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        try {
            await groupSchema.groupSchema.findByIdAndUpdate({_id: request.payload.groupId}, {$set: dataToUpdate}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating group in update group handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Check if the group type is changed */
    if (request.payload.isJob) {
        let jobs;
        try {
            jobs = await jobSchema.jobSchema.find({groupIds: mongoose.Types.ObjectId(request.payload.groupId)}, {exposedTo: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding jobs in update group handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        const len = jobs.length, dataToUpdate = [];
        for (let i = 0; i < len; i++) {
            for (let j = 0; j < checkGroup.members.length; j++) {
                const idx = jobs[i].exposedTo.findIndex(k => k.toString() === checkGroup.members[j].toString());
                if (idx !== -1) {
                    jobs[i].exposedTo.splice(idx, 1);
                }
            }
            jobs[i].exposedTo = jobs[i].exposedTo.concat(request.payload.members);
            if (!request.payload.isActive) {
                dataToUpdate.push({_id: jobs[i]._id, update: {$set: {exposedTo: jobs[i].exposedTo}, $pull: {groupIds: checkGroup._id}}});
            } else {
                dataToUpdate.push({_id: jobs[i]._id, update: {$set: {exposedTo: jobs[i].exposedTo}, $pull: {groupIds: checkGroup._id}}});
            }
        }
        const promises = dataToUpdate.map(k => jobSchema.jobSchema.findByIdAndUpdate({_id: k._id}, k.update, {lean: true}));
        try {
            await Promise.all(promises);
        } catch (e) {
            logger.error('Error occurred while updating jobs in update group handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.payload.isCandidate) {
        /* Not using now */
        /*let candidates;
        try {
            candidates = await userSchema.UserSchema.find({groupIds: mongoose.Types.ObjectId(request.payload.groupId)}, {exposedTo: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding candidates in update group handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        const len = candidates.length, dataToUpdate = [];
        for (let i = 0; i < len; i++) {
            for (let j = 0; j < checkGroup.members.length; j++) {
                const idx = candidates[i].exposedTo.findIndex(k => k.toString() === checkGroup.members[j].toString());
                if (idx !== -1) {
                    candidates[i].exposedTo.splice(idx, 1);
                }
            }
            if (!request.payload.isActive) {
                dataToUpdate.push({_id: candidates[i]._id, update: {$set: {exposedTo: candidates[i].exposedTo}, $pull: {groupIds: checkGroup._id}}});
            } else {
                dataToUpdate.push({_id: candidates[i]._id, update: {$set: {exposedTo: candidates[i].exposedTo}, $pull: {groupIds: checkGroup._id}, $push: {exposedTo: request.payload.members}}});
            }
        }
        const promises = dataToUpdate.map(k => userSchema.UserSchema.findByIdAndUpdate({_id: k._id}, k.update, {lean: true}));
        try {
            await Promise.all(promises);
        } catch (e) {
            logger.error('Error occurred while updating candidates in update group handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }*/

        /* Save the data into hotlist collection */
        let documentsToInsert = [], members;
        if (request.payload.isExposedToCommunity) {
            checkUser.slaveUsers.push(checkUser._id);
            try {
                members = await userSchema.UserSchema.find({_id: {$nin: checkUser.slaveUsers}, isPa: true, membership: checkUser.membership}, {_id: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding community members in update group handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        } else if (request.payload.isExposedToGroups) {
            try {
                employers = await groupSchema.groupSchema.find({_id: {$in: request.payload.groupIds}, userId: mongoose.Types.ObjectId(request.payload.userId), isHotList: true}, {members: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding group members in update job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            const temp = employers.map(k => k.members);
            members = [].concat.apply([], temp);
        }

        if (request.payload.isExposedToCommunity || request.payload.isExposedToGroups) {
            for (let i = 0; i < members.length; i++) {
                let dataToPush = {
                    paId: mongoose.Types.ObjectId(request.payload.userId),
                    userId: '',
                    groupName: request.payload.groupName,
                    members: request.payload.members,
                    createdAt: Date.now
                };
                let hotListData = new hotListSchema.hotListSchema(dataToPush);
                if (request.payload.isExposedToCommunity) {
                    hotListData.userId = mongoose.Types.ObjectId(members[i]._id);
                } else if (request.payload.isExposedToGroups) {
                    hotListData.userId = mongoose.Types.ObjectId(members[i]);
                }
                documentsToInsert.push({insertOne: {'document': hotListData}});
            }
            try {
                await hotListSchema.hotListSchema.collection.bulkWrite(documentsToInsert);
            } catch (e) {
                logger.error('Error occurred while saving hotlist data in create group handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Group information updated.', 'success', 204)).code(200);
};

paHandler.listOfCompaniesForGroup = async (request, h) => {
    let checkUser, decoded, employers, aggregationCriteria = [];

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding users in list of companies for group handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to access the end point */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in list of companies for group handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Get list of companies for making group */
    if (request.query.onlyPartners) {
        if (!checkUser.membership) {
            return h.response(responseFormatter.responseFormatter({}, 'You do not have any partners.', 'error', 400)).code(400);
        } else {
            aggregationCriteria.push({
                $match: {
                    _id: {$ne: mongoose.Types.ObjectId(request.query.userId)},
                    isPa: true,
                    membership: checkUser.membership
                }
            });
        }
    } else {
        aggregationCriteria.push({
            $match: {
                _id: {$ne: mongoose.Types.ObjectId(request.query.userId)},
                isPa: true
            }
        });
    }

    if (request.query.searchText) {
        aggregationCriteria.push({
            $match: {
                'employerInformation.companyName': new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
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
        $project: {
            _id: 1,
            companyName: '$employerInformation.companyName',
            companyLogo: '$employerInformation.companyProfilePhoto',
            skillAvailable: '$employerInformation.skillsAvailable',
            skillsAvailable: {$size: '$employerInformation.skillsAvailable'},
            skillsNeeded: {$size: '$employerInformation.skillsPreference'}
        }
    })

    try {
        employers = await userSchema.UserSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred while aggregating users in list of companies for group handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Find number of active jobs and candidates for each employers */
    const len = employers.length;
    for (let i = 0; i < len; i++) {
        let jobCount, candidateCount;

        try {
            jobCount = await jobSchema.jobSchema.countDocuments({userId: mongoose.Types.ObjectId(employers[i]._id), isVisible: true, isArchived: false});
        } catch (e) {
            logger.error('Error occurred while counting jobs in list of companies for group handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        try {
            candidateCount = await userSchema.UserSchema.countDocuments({paId: mongoose.Types.ObjectId(employers[i]._id), isPa: false});
        } catch (e) {
            logger.error('Error occurred while counting candidates in list of companies for group handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        employers[i].jobCount = jobCount;
        employers[i].candidateCount = candidateCount;
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(employers, 'Fetched successfully.', 'success', 200)).code(200);
};

paHandler.companyDetails = async (request, h) => {
    let checkUser, decoded, employerData, jobsCount = 0, candidateCount = 0;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding users in get company details PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPa && !checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to access the end point */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get company details PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    try {
        employerData = await userSchema.UserSchema.aggregate([
            {
                $match: {
                    _id: mongoose.Types.ObjectId(request.query.companyId)
                }
            },
            {
                $lookup: {
                    localField: 'employerInformation.region',
                    foreignField: '_id',
                    from: 'Region',
                    as: 'region'
                }
            },
            {
                $unwind: {
                    path: '$region',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $lookup: {
                    localField: 'employerInformation.chapter',
                    foreignField: '_id',
                    from: 'Chapter',
                    as: 'chapter'
                }
            },
            {
                $unwind: {
                    path: '$chapter',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $lookup: {
                    localField: 'employerInformation.vendorType',
                    foreignField: '_id',
                    from: 'VendorType',
                    as: 'vendor'
                }
            },
            {
                $unwind: {
                    path: '$vendor',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $project: {
                    _id: 1,
                    companyName: '$employerInformation.companyName',
                    companyLogo: '$employerInformation.companyProfilePhoto',
                    companyWebsite: '$employerInformation.website',
                    membership: '$employerInformation.membership',
                    designation: '$employerInformation.designation',
                    phone: '$employerInformation.companyPhone',
                    companyDescription: '$employerInformation.companyDescription',
                    region: '$region.name',
                    regionId: '$region._id',
                    chapter: '$chapter.name',
                    chapterId: '$chapter._id',
                    address: '$employerInformation.companyAddress',
                    skillsAvailable: '$employerInformation.skillsAvailable',
                    skillsNeeded: '$employerInformation.skillsPreference',
                    vendorType: '$vendor.name',
                    vendorTypeId: '$vendor._id',
                    preferredVendorTo: '$employerInformation.preferredVendorTo',
                    firstName: 1,
                    lastName: 1,
                    memberSince: '$employerInformation.memberSince',
                    country: '$employerInformation.country'
                }
            }
        ])
    } catch (e) {
        logger.error('Error occurred while aggregating users in get company details PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get active jobs and number of candidates */
    let idsToCheck = [mongoose.Types.ObjectId(request.query.companyId)];

    if (checkUser.slaveUsers && checkUser.slaveUsers.length) {
        idsToCheck = idsToCheck.concat(checkUser.slaveUsers);
    }

    try {
        jobsCount = await jobSchema.jobSchema.countDocuments({userId: {$in: idsToCheck}, isArchived: false, isVisible: true});
    } catch (e) {
        logger.error('Error occurred while counting jobs in get company details PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get total number of candidates */
    try {
        candidateCount = await userSchema.UserSchema.countDocuments({paId: {$in: idsToCheck}, isPa: false});
    } catch (e) {
        logger.error('Error occurred while counting candidates in get company details PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    employerData[0].jobs = jobsCount;
    employerData[0].candidates = candidateCount;

    return h.response(responseFormatter.responseFormatter(employerData, 'Fetched successfully.', 'success', 200)).code(200);
};

paHandler.getRegions = async (request, h) => {
    let checkUser, decoded, regions = [], adminUser;

    /* Check if user is actually who is trying to utilize the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get regions data pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get regions data pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action.', 'error', 400)).code(400);
    } else if (!checkUser.isOrganization) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action.', 'error', 400)).code(400);
    }

    if (checkUser.membership) {
        checkUser.additionalMemberships.push(mongoose.Types.ObjectId(checkUser.membership));
    }
    let allMemberships = checkUser.additionalMemberships.map(k => mongoose.Types.ObjectId(k)), allMembershipsString = checkUser.additionalMemberships.map(k => k.toString());

    /* Get admin user id for fetching regions */
    try {
        adminUser = await userSchema.UserSchema.aggregate([
            {
                $match: {
                    $or: [{membership: {$in: allMembershipsString}}, {additionalMemberships: {$in: allMemberships}}],
                    isPaAdmin: true,
                    isMaster: true
                }
            },
            {
                $project: {
                    _id: 1
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred while finding admin user in get regions data pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (adminUser && adminUser.length) {
        let ids = [];
        for (let i = 0; i < adminUser.length; i++) {
            ids.push(mongoose.Types.ObjectId(adminUser[i]._id));
        }
        /* Get regions data */
        try {
            regions = await regionSchema.regionSchema.find({userId: {$in: ids}}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting regions in get regions data pa handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(regions, 'Fetched successfully.', 'success', 200)).code(200);
};

paHandler.getChapters = async (request, h) => {
    let checkUser, decoded, chapters = [], adminUser;

    /* Check if user is actually who is trying to utilize the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get chapters data pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get chapters data pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action.', 'error', 400)).code(400);
    }

    checkUser.additionalMemberships.push(mongoose.Types.ObjectId(checkUser.membership));
    let allMemberships = checkUser.additionalMemberships.map(k => mongoose.Types.ObjectId(k)), allMembershipsString = checkUser.additionalMemberships.map(k => k.toString());

    /* Get admin user id for fetching regions */
    try {
        adminUser = await userSchema.UserSchema.aggregate([
            {
                $match: {
                    $or: [{membership: {$in: allMembershipsString}}, {additionalMemberships: {$in: allMemberships}}],
                    isPaAdmin: true,
                    isMaster: true
                }
            },
            {
                $project: {
                    _id: 1
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred while finding admin user in get regions data pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (adminUser && adminUser.length) {
        let ids = [];
        for (let i = 0; i < adminUser.length; i++) {
            ids.push(mongoose.Types.ObjectId(adminUser[i]._id));
        }
        /* Get regions data */
        try {
            chapters = await chapterSchema.chapterSchema.find({userId: {$in: ids}, region: mongoose.Types.ObjectId(request.query.regionId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting regions in get chapters data pa handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(chapters, 'Fetched successfully.', 'success', 200)).code(200);
};

paHandler.getVendorTypes = async (request, h) => {
    let vendors;

    try {
        vendors = await vendorTypeSchema.vendorTypeSchema.find({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting vendor types in get vendors data pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter(vendors, 'Fetched successfully.', 'success', 200)).code(200);
};

paHandler.getJobs = async (request, h) => {
    let checkUser, decoded, jobs;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    let masterUser;
    if (checkUser.isMaster) {
        checkUser.slaveUsers.push(mongoose.Types.ObjectId(checkUser._id));
    } else {
        try {
            masterUser = await userSchema.UserSchema.findById({_id: checkUser.paId}, {_id: 1, slaveUsers: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding master user in get jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (masterUser) {
            masterUser.slaveUsers.push(mongoose.Types.ObjectId(masterUser._id));
        }
    }

    let ids = [], aggregationCriteria = [
        {
            $lookup: {
                from: 'Job',
                localField: '_id',
                foreignField: 'userId',
                as: 'job'
            }
        },
        {
            $unwind: '$job'
        },
        {
            $match: {
                'job.isArchived': false,
                'job.isTranslated': false,
                'job.isVisible': true
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
                from: 'Category',
                localField: 'job.categoryId',
                foreignField: '_id',
                as: 'category'
            }
        },
        {
            $unwind: '$category'
        },
        {
            $project: {
                _id: '$job._id',
                address: '$job.address',
                location: '$job.location',
                payRate: '$job.payRate',
                jobTitle: '$job.jobTitle',
                jobDescriptionText: '$job.jobDescriptionText',
                jobDescriptionVideo: '$job.jobDescriptionVideo',
                country: '$job.country',
                numberOfPositions: '$job.numberOfPositions',
                startDate: '$job.startDate',
                jobType: '$job.jobType',
                skills: '$job.skills',
                isNegotiable: '$job.isNegotiable',
                experienceInMonths: '$job.experienceInMonths',
                ageRequired: '$job.ageRequired',
                tags: '$job.tags',
                isClosed: '$job.isClosed',
                isArchived: '$job.isArchived',
                isExpired: '$job.isExpired',
                totalViews: '$job.totalViews',
                uniqueViewsArray: '$job.uniqueViews',
                uniqueViews: {$size: '$job.uniqueViews'},
                categoryName: '$category.categoryName',
                categoryId: '$category._id',
                userId: '$job.userId',
                companyName: '$employerInformation.companyName',
                companyAddress: '$employerInformation.companyAddress',
                companyLocation: '$employerInformation.companyLocation',
                companyDescription: '$employerInformation.companyDescription',
                companyType: '$employerInformation.companyType',
                companyLogo: '$employerInformation.companyProfilePhoto',
                currency: '$job.currency',
                interviewStartDateTime: '$job.interviewStartDateTime',
                interviewEndDateTime: '$job.interviewEndDateTime',
                interviewStartDate: '$job.interviewStartDate',
                interviewEndDate: '$job.interviewEndDate',
                interviewStartTime: '$job.interviewStartTime',
                interviewEndTime: '$job.interviewEndTime',
                isWorkFromHome: '$job.isWorkFromHome',
                shift: '$job.shift',
                isWalkInInterview: '$job.isWalkInInterview',
                isUnderReview: '$job.isUnderReview',
                phone: {
                    $cond: [{$and: [{$eq: ["$job.isAddedByBulkUpload", true]}, {$eq: ["$hasOwned", false]}]}, "$employeeInformation.phone", "$job.phone"]
                },
                countryCode: {
                    $cond: [{$and: [{$eq: ["$job.isAddedByBulkUpload", true]}, {$eq: ["$hasOwned", false]}]}, "$employeeInformation.countryCode", "$job.countryCode"]
                },
                walkInInterviewAddress: '$job.walkInInterviewAddress',
                walkInLatitude: '$job.walkInLatitude',
                walkInLongitude: '$job.walkInLongitude',
                isSame: '$job.isSame',
                receiveCalls: '$job.receiveCalls',
                isPhoneSame: '$job.isPhoneSame',
                displayCities: '$job.displayCities',
                isCompanyWebsite: '$job.isCompanyWebsite',
                companyWebsite: '$job.companyWebsite',
                isATS: '$job.isATS',
                atsEmail: '$job.atsEmail',
                isTranslated: '$job.isTranslated',
                translatedJobs: '$job.translatedJobs',
                isInternship: '$job.isInternship',
                membership: '$membership'
            }
        }
    ];
    if (request.query.type === 'all') {
        try {
            jobs = await jobSchema.jobSchema.aggregate([
                {
                    $match: {
                        userId: {$nin: checkUser.isMaster ? checkUser.slaveUsers : masterUser.slaveUsers},
                        isArchived: false,
                        country: checkUser.employerInformation.country,
                        isTranslated: false,
                        isVisible: true
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
                        address: 1,
                        location: 1,
                        payRate: 1,
                        jobTitle: 1,
                        jobDescriptionText: 1,
                        jobDescriptionVideo: 1,
                        country: 1,
                        numberOfPositions: 1,
                        startDate: 1,
                        jobType: 1,
                        skills: 1,
                        isNegotiable: 1,
                        experienceInMonths: 1,
                        ageRequired: 1,
                        tags: 1,
                        isClosed: 1,
                        isArchived: 1,
                        isExpired: 1,
                        totalViews: 1,
                        uniqueViewsArray: '$uniqueViews',
                        uniqueViews: {$size: '$uniqueViews'},
                        categoryName: '$category.categoryName',
                        categoryId: '$category._id',
                        userId: 1,
                        companyName: '$user.employerInformation.companyName',
                        companyAddress: '$user.employerInformation.companyAddress',
                        companyLocation: '$user.employerInformation.companyLocation',
                        companyDescription: '$user.employerInformation.companyDescription',
                        companyType: '$user.employerInformation.companyType',
                        companyLogo: '$user.employerInformation.companyProfilePhoto',
                        currency: 1,
                        interviewStartDateTime: 1,
                        interviewEndDateTime: 1,
                        interviewStartDate: 1,
                        interviewEndDate: 1,
                        interviewStartTime: 1,
                        interviewEndTime: 1,
                        isWorkFromHome: 1,
                        shift: 1,
                        isWalkInInterview: 1,
                        isUnderReview: 1,
                        phone: {
                            $cond: [{$and: [{$eq: ["$isAddedByBulkUpload", true]}, {$eq: ["$user.hasOwned", false]}]}, "$user.employeeInformation.phone", "$phone"]
                        },
                        countryCode: {
                            $cond: [{$and: [{$eq: ["$isAddedByBulkUpload", true]}, {$eq: ["$user.hasOwned", false]}]}, "$user.employeeInformation.countryCode", "$countryCode"]
                        },
                        walkInInterviewAddress: 1,
                        walkInLatitude: 1,
                        walkInLongitude: 1,
                        isSame: 1,
                        receiveCalls: 1,
                        isPhoneSame: 1,
                        displayCities: 1,
                        isCompanyWebsite: 1,
                        companyWebsite: 1,
                        isATS: 1,
                        atsEmail: 1,
                        isTranslated: 1,
                        translatedJobs: 1,
                        isInternship: 1,
                        membership: '$user.membership'
                    }
                }
            ]);
        } catch (e) {
            console.log(e);
            logger.error('Error occurred while aggregating jobs in get jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Success */
        return h.response(responseFormatter.responseFormatter(jobs, 'Fetched successfully.', 'success', 200)).code(200);

    } else if (request.query.type === 'partner') {
        if (checkUser.isMaster) {
            ids = ids.concat(checkUser.slaveUsers);
        } else {
            ids = ids.concat(masterUser.slaveUsers)
        }
        let dataToPush = {
            _id: {$nin: ids}
        };

        if (checkUser.membership) {
            dataToPush['$or'] = [{membership: checkUser.membership}, {additionalMemberships: mongoose.Types.ObjectId(checkUser.membership)}];
        }
        aggregationCriteria.unshift({
            $match: dataToPush
        });
    } else if (request.query.type === 'group') {
        let members;
        /* Get members of groups */
        try {
            members = await groupSchema.groupSchema.find({userId: mongoose.Types.ObjectId(checkUser._id), isActive: true}, {members: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding groups in get jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        for (let i = 0; i < members.length; i++) {
            members[i].members = members[i].members.map(k => k.toString());
            ids = commonFunctions.Handlers.arrayUnique(ids, members[i].members);
        }

        ids = ids.map(k => mongoose.Types.ObjectId(k));

        aggregationCriteria.unshift({
            $match: {
                _id: {$in: ids}
            }
        });
    }

    try {
        jobs = await userSchema.UserSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred while aggregating user collection in get jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(jobs, 'Fetched successfully.', 'success', 200)).code(200);
};

paHandler.updateUser = async (request, h) => {
    let checkPa, checkUser, decoded, updateCriteria = {};

    /* Check if PA exists */
    try {
        checkPa = await userSchema.UserSchema.findById({_id: request.payload.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding pa in update user pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPa) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found.', 'error', 404)).code(404);
    } else if (!checkPa.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user is actually who is trying to access the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update user pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if the user with the given email already exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in update user pa handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found.', 'error', 404)).code(404);
    } else if (checkUser.paId.toString() !== request.payload.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'This user is not associated with your account.', 'error', 400)).code(400);
    }

    /* Check if email is updated */ {
        if (checkUser.email.toLowerCase() !== request.payload.email.toLowerCase()) {
            updateCriteria['email'] = request.payload.email;
            updateCriteria['password'] = commonFunctions.Handlers.generatePassword();

            const mailOptions = {
                from: 'support@ezjobs.io',
                to: request.payload.email,
                subject: 'Account creation',
                text: 'Your temporary password is ' + updateCriteria.password
            };
            try {
                await commonFunctions.Handlers.nodeMailerEZJobs(mailOptions.from, mailOptions.subject, mailOptions.text, mailOptions.to);
            } catch (e) {
                logger.error('Error in sending create account email in update user pa admin handler %s:', JSON.stringify(e));
            }

        }
        updateCriteria['isActive'] = !!request.payload.isActive;
        updateCriteria['firstName'] = request.payload.firstName;
        updateCriteria['lastName'] = request.payload.lastName ? request.payload.lastName : '';

        /* SALT PASSWORD */
        if (updateCriteria.password) {
            try {
                updateCriteria.password = await bcrypt.hash(updateCriteria.password, 12);
            } catch (e) {
                logger.error('Error occurred while encrypting password in update user pa admin handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }

        /* Update user */
        try {
            await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$set: updateCriteria}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating user in update user pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Success */
        return h.response(responseFormatter.responseFormatter({}, 'User information updated.', 'success', 204)).code(200);
    }
};

paHandler.getConfiguration = async (request, h) => {
    let dataToReturn = [], decodedText = decodeURIComponent(request.query.searchText);

    if (request.query.isDegree) {
        try {
            dataToReturn = await degreeSchema.degreeSchema.find({degreeName: new RegExp(decodedText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {degreeName: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting degrees in get configuration pa handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.isMajor) {
        try {
            dataToReturn = await majorSchema.majorSchema.find({majorName: new RegExp(decodedText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {majorName: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting majors in get configuration pa handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    return h.response(responseFormatter.responseFormatter(dataToReturn, 'Fetched successfully.', 'success', 200)).code(200);
}

paHandler.getChats = async (request, h) => {
    let chats, searchCriteria, aggregationCriteria;

    /* Check if user is authorized */
    try {
        await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get chats PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check user chats in database */
    searchCriteria = {
        $or: [{$and: [{senderId: mongoose.Types.ObjectId(request.query.userId)}, {hasSenderDeleted: false}]},
            {$and: [{receiverId: mongoose.Types.ObjectId(request.query.userId)}, {hasReceiverDeleted: false}]}]
    };

    aggregationCriteria = [
        {
            $match: searchCriteria
        },
        {
            $lookup: {
                from: 'User',
                localField: 'senderId',
                foreignField: '_id',
                as: 'sender'
            }
        },
        {
            $unwind: '$sender'
        },
        {
            $lookup: {
                from: 'User',
                localField: 'receiverId',
                foreignField: '_id',
                as: 'receiver'
            }
        },
        {
            $unwind: '$receiver'
        },
        {
            $match: {
                'sender.isActive': true,
                'receiver.isActive': true
            }
        }
    ];

    aggregationCriteria.push({
        $project: {
            sender: 1,
            senderId: 1,
            receiver: 1,
            receiverId: 1,
            jobId: 1,
            chats: 1,
            updatedAt: 1,
            isSenderBlocked: 1,
            isReceiverBlocked: 1,
            isSender: {
                $cond: [
                    {
                        $eq: ['$senderId', mongoose.Types.ObjectId(request.query.userId)]
                    },
                    true,
                    false
                ]
            },
            isReceiver: {
                $cond: [
                    {
                        $eq: ['$receiverId', mongoose.Types.ObjectId(request.query.userId)]
                    },
                    true,
                    false
                ]
            }
        }
    });

    aggregationCriteria.push({
        $project: {
            firstName: {
                $cond: [
                    {
                        $eq: ['$isSender', true]
                    },
                    '$receiver.firstName',
                    '$sender.firstName',
                ]
            },
            lastName: {
                $cond: [
                    {
                        $eq: ['$isSender', true]
                    },
                    '$receiver.lastName',
                    '$sender.lastName',
                ]
            },
            companyName: {
                $cond: [
                    {
                        $eq: ['$isSender', true]
                    },
                    '$receiver.employerInformation.companyName',
                    '$sender.employerInformation.companyName',
                ]
            },
            senderId: 1,
            receiverId: 1,
            profilePhoto: {
                $cond: [
                    {
                        $eq: ['$isSender', true]
                    },
                    '$receiver.employeeInformation.profilePhoto',
                    '$sender.employeeInformation.profilePhoto',
                ]
            },
            lastMessageSender: {
                $filter: {
                    input: '$chats',
                    cond: {$and: [{$eq: ['$$this.isReceiverBlocked', false]}, {$eq: ['$$this.hasSenderDeleted', false]}]}
                }
            },
            lastMessageReceiver: {
                $filter: {
                    input: '$chats',
                    cond: {$and: [{$eq: ['$$this.isSenderBlocked', false]}, {$eq: ['$$this.hasReceiverDeleted', false]}]}
                }
            },
            unread: {
                $size: {
                    $filter: {
                        input: '$chats',
                        cond: { $and: [{$eq: ['$$this.isRead', false]}, {$eq: ['$$this.to', mongoose.Types.ObjectId(request.query.userId)]}, {$eq: ['$$this.isSenderBlocked', false]}, {$eq: ['$$this.isReceiverBlocked', false]}] }
                    }
                }
            },
            updatedAt: 1,
            isOnline: {
                $cond: [
                    {
                        $eq: ['$isSender', true]
                    },
                    '$receiver.isOnline',
                    '$sender.isOnline',
                ]
            },
            isSenderBlocked: 1,
            isReceiverBlocked: 1,
            chats: 1,
            jobId: 1
        }
    });

    /* If search text is given */
    if (request.query.searchText) {
        aggregationCriteria.push(
            {
                $match: {
                    $or: [
                        {
                            firstName: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                        },
                        {
                            lastName: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                        },
                        {
                            companyName: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                        }
                    ]
                }
            }
        );
    }

    aggregationCriteria.push({$project: {
            firstName: 1,
            lastName: 1,
            senderId: 1,
            receiverId: 1,
            profilePhoto: 1,
            companyName: 1,
            chats: 1,
            lastMessage: {
                $cond: [
                    {
                        $eq: ['$isSender', true]
                    },
                    {$slice: ['$lastMessageSender', -1]},
                    {$slice: ['$lastMessageReceiver', -1]}
                ]
            },
            unread: 1,
            updatedAt: 1,
            isOnline: 1,
            isSenderBlocked: 1,
            isReceiverBlocked: 1,
            jobId: 1
        }
    });

    aggregationCriteria.push({
        $lookup: {
            from: 'Job',
            localField: 'jobId',
            foreignField: '_id',
            as: 'job'
        }
    });
    aggregationCriteria.push({
        $unwind: {
            path: '$job',
            preserveNullAndEmptyArrays: true
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
            firstName: 1,
            lastName: 1,
            senderId: 1,
            receiverId: 1,
            profilePhoto: 1,
            companyName: 1,
            chats: 1,
            lastMessage: '$lastMessage.body',
            lastMessageOriginal: '$lastMessage.originalBody',
            lastMessageType: '$lastMessage.type',
            lastMessageEncrypted: '$lastMessage.isEncrypted',
            lastMessageDateTime: '$lastMessage.dateTime',
            lastMessageSenderId: '$lastMessage.from',
            unread: 1,
            updatedAt: 1,
            isOnline: 1,
            isSenderBlocked: 1,
            isReceiverBlocked: 1,
            jobId: 1,
            jobTitle: '$job.jobTitle',
            subJobTitle: '$job.subJobTitle'
        }
    });

    try {
        chats = await chatSchema.chatSchema.aggregate(aggregationCriteria);
    } catch (e) {
        console.log(e);
        logger.error('Error occurred while finding chats in get chats PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!chats.length) {
        return h.response(responseFormatter.responseFormatter([], 'No chats found', 'success', 200)).code(200);
    } else {
        for (let i = 0; i < chats.length; i++) {
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
                            ((chats[i].senderId.toString() === request.query.userId) ? ((k.hasSenderDeleted === false) && (k.isReceiverBlocked === false)) : ((k.hasReceiverDeleted === false) && (k.isSenderBlocked === false)))
                    });
                    if (index !== -1) {
                        chats[i].lastMessageType = chats[i].chats[index].type;
                        chats[i].lastMessageSenderId = chats[i].chats[index].from;
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

paHandler.getChatStatus = async (request, h) => {
    let checkSender, checkReceiver, conversations = {}, aggregationCriteria, sortedChats = {},
        arrayFilter, matchCriteria = {flag: true}, searchCriteria, status, isSenderBlocked, isReceiverBlocked;

    if (request.query.firstId) {
        matchCriteria = {
            'chats._id': {$lt: mongoose.Types.ObjectId(request.query.firstId)}
        };
    }

    /* Check whether sender is present in database or not */
    try {
        checkSender = await userSchema.UserSchema.findById({_id: request.query.senderId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding sender information in get chat status PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkSender) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether receiver is present in database or not */
    try {
        checkReceiver = await userSchema.UserSchema.findById({_id: request.query.receiverId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding candidate information in get chat status PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkReceiver) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Set all the chat messages of this user to isRead */
    if (request.query.jobId) {
        searchCriteria = {
            $or: [{$and: [{senderId: mongoose.Types.ObjectId(request.query.senderId)}, {receiverId: mongoose.Types.ObjectId(request.query.receiverId)}]}, {$and: [{senderId: mongoose.Types.ObjectId(request.query.receiverId)}, {receiverId: mongoose.Types.ObjectId(request.query.senderId)}]}],
            jobId: mongoose.Types.ObjectId(request.query.jobId)
        };
    } else {
        searchCriteria = {
            $or: [{$and: [{senderId: mongoose.Types.ObjectId(request.query.senderId)}, {receiverId: mongoose.Types.ObjectId(request.query.receiverId)}]}, {$and: [{senderId: mongoose.Types.ObjectId(request.query.receiverId)}, {receiverId: mongoose.Types.ObjectId(request.query.senderId)}]}]
        };
    }

    try {
        status = await chatSchema.chatSchema.findOne(searchCriteria, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching chat information in get chat details handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (status) {
        if (request.query.senderId === status.senderId.toString()) {
            matchCriteria['chats.isReceiverBlocked'] = false;
            matchCriteria['chats.hasSenderDeleted'] = false;
        } else {
           /* arrayFilter = {
                'elem.to': mongoose.Types.ObjectId(request.query.receiverId)
            };*/
            matchCriteria['chats.isSenderBlocked'] = false;
            matchCriteria['chats.hasReceiverDeleted'] = false;
        }
        arrayFilter = {
            'elem.to': mongoose.Types.ObjectId(request.query.senderId)
        };

        try {
            await chatSchema.chatSchema.updateMany(searchCriteria, {$set: {'chats.$[elem].isRead': true}}, {arrayFilters: [arrayFilter]});
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
                    localField: 'senderId',
                    foreignField: '_id',
                    as: 'sender'
                }
            },
            {
                $unwind: '$sender'
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'receiverId',
                    foreignField: '_id',
                    as: 'receiver'
                }
            },
            {
                $unwind: '$receiver'
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
                $unwind: {
                    path: '$job',
                    preserveNullAndEmptyArrays: true
                }
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
                    receiverFirstName: '$receiver.firstName',
                    receiverCompanyName: '$receiver.employerInformation.companyName',
                    receiverLastName: '$receiver.lastName',
                    receiverPhoto: '$receiver.employeeInformation.profilePhoto',
                    receiverId: 1,
                    senderFirstName: '$sender.firstName',
                    senderLastName: '$sender.lastName',
                    senderPhoto: '$sender.employeeInformation.profilePhoto',
                    senderId: 1,
                    chats: 1,
                    isSenderBlocked: 1,
                    isReceiverBlocked: 1,
                    isReceiverOnline: '$receiver.isOnline',
                    isSenderOnline: '$sender.isOnline',
                    receiverLastSeen: '$receiver.lastOnline',
                    senderLastSeen: '$sender.lastOnline',
                    jobTitle: '$job.jobTitle',
                    subJobTitle: '$job.subJobTitle',
                    candidateId: 1,
                    jobId: 1,
                    postedBy: '$job.userId'
                }
            }
        ];

        try {
            conversations = await chatSchema.chatSchema.aggregate(aggregationCriteria);
            if (conversations && conversations.length) {
                for (let i = 0; i < conversations.length; i++) {
                    if (i === 0) {
                        sortedChats = conversations[i];
                        sortedChats.chats = [sortedChats.chats];
                    } else {
                        sortedChats.chats.push(conversations[i].chats);
                    }
                }
                if (!sortedChats.chats) {
                    sortedChats.chats = [];
                }
                for (let i = 0; i < sortedChats.chats.length; i++) {
                    if (sortedChats.chats[i].isEncrypted) {
                        sortedChats.chats[i].body = aes256.decrypt(key, sortedChats.chats[i].body);
                        if (sortedChats.chats[i].originalBody) {
                            sortedChats.chats[i].originalBody = aes256.decrypt(key, sortedChats.chats[i].originalBody);
                        }
                    }
                }
            }
        } catch (e) {
            logger.error('Error occurred finding conversations information in get chat status PA handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(sortedChats, 'Fetched successfully', 'success', 200)).code(200);
};

paHandler.deleteChat = async (request, h) => {
    let checkUser, decoded, updateCriteria, checkChat;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in delete chat PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in delete chat PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check if chat exists */
    try {
        checkChat = await chatSchema.chatSchema.findById({_id: request.query.chatId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding chat in delete chat PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkChat) {
        return h.response(responseFormatter.responseFormatter({}, 'No such conversation.', 'error', 404)).code(404);
    }

    if (checkChat.senderId.toString() === request.query.userId) {
        updateCriteria = {
            hasSenderDeleted: true,
            'chats.$[].hasSenderDeleted': true
        };
    } else {
        updateCriteria = {
            hasReceiverDeleted: true,
            'chats.$[].hasReceiverDeleted': true
        };
    }

    try {
        await chatSchema.chatSchema.findByIdAndUpdate({_id: request.query.chatId}, {$set: updateCriteria}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in updating conversation in delete chat PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Chat deleted successfully.', 'success', 202)).code(202);
};

paHandler.blockUser = async (request, h) => {
    let checkBlocker, checkBlocked, checkChat, blockedBy, updateCriteria, role = '';

    /* Check whether blocked is present in database or not */
    try {
        checkBlocker = await userSchema.UserSchema.findById({_id: request.payload.blockingId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding blocker information in block user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkBlocker) {
        return h.response(responseFormatter.responseFormatter({}, 'Blocker user doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether blocked is present in database or not */
    try {
        checkBlocked = await userSchema.UserSchema.findById({_id: request.payload.blockedId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding blocked information in block user PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkBlocked) {
        return h.response(responseFormatter.responseFormatter({}, 'Blocked user doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether chat exists */
    const searchCriteria = {
        $or: [{senderId: mongoose.Types.ObjectId(request.payload.blockingId), receiverId: mongoose.Types.ObjectId(request.payload.blockedId)}, {senderId: mongoose.Types.ObjectId(request.payload.blockedId), receiverId: mongoose.Types.ObjectId(request.payload.blockingId)}]
    }
    try {
        checkChat = await chatSchema.chatSchema.findOne(searchCriteria, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding chat information in block user PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkChat) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not block this user as you have not started communication with this user.', 'error', 400)).code(400);
    }

    /* Get user who is blocking */
    if (checkChat.senderId.toString() === request.payload.blockingId) {
        blockedBy = checkChat.senderId;
        updateCriteria = {$set: {isReceiverBlocked: request.payload.isBlock}};
        role = 'receiver';
    } else if (checkChat.senderId.toString() === request.payload.blockedId) {
        blockedBy = checkChat.receiverId;
        updateCriteria = {$set: {isSenderBlocked: request.payload.isBlock}};
        role = 'sender';
    }

    /* Add this user to blocked by array list in user collection */
    if (request.payload.isBlock) {
        try {
            await userSchema.UserSchema.findByIdAndUpdate({_id: (blockedBy.toString() === checkChat.senderId.toString() ? checkChat.receiverId: checkChat.senderId)}, {$addToSet: {blockedBy: blockedBy}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred updating user information in block user PA handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Add block user data into collection */
        try {
            await blockUserSchema.blockSchema.findOneAndUpdate({userId: mongoose.Types.ObjectId(request.payload.blockingId)}, {$set: {userId: mongoose.Types.ObjectId(request.payload.blockingId), blockedUserId: mongoose.Types.ObjectId(request.payload.blockedUserId), blockReason: request.payload.reason ? request.payload.reason: ''}}, {lean: true, upsert: true});
        } catch (e) {
            logger.error('Error occurred updating block user information in block user PA handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        try {
            await userSchema.UserSchema.findByIdAndUpdate({_id: (blockedBy.toString() === checkChat.senderId.toString() ? checkChat.receiverId: checkChat.senderId)}, {$pull: {blockedBy: blockedBy}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred updating user information in block user PA handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Remove block user data into collection */
        try {
            await blockUserSchema.blockSchema.findOneAndDelete({userId: mongoose.Types.ObjectId(request.payload.blockingId)});
        } catch (e) {
            logger.error('Error occurred deleting block user information in block user PA handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Update the conversation */
    try {
        await chatSchema.chatSchema.findByIdAndUpdate({_id: checkChat._id}, updateCriteria, {lean: true});
    } catch (e) {
        logger.error('Error occurred updating conversation information in block user PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update all other conversations initiated by blocked user */
    let bulk = chatSchema.chatSchema.collection.initializeUnorderedBulkOp();

    if (role === 'receiver') {
        bulk
            .find({senderId: checkChat.senderId, receiverId: checkChat.receiverId})
            .update({$set: {isReceiverBlocked: request.payload.isBlock}});
        try {
            await bulk.execute();
        } catch (e) {
            logger.error('Error occurred updating conversation information in block user PA handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Update all other conversations done to blocked user */
        bulk
            .find({senderId: checkChat.receiverId, receiverId: checkChat.senderId})
            .update({$set: {isSenderBlocked: request.payload.isBlock}});
        try {
            await bulk.execute();
        } catch (e) {
            logger.error('Error occurred updating conversation information in block user PA handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (role === 'sender') {
        bulk
            .find({senderId: checkChat.senderId, receiverId: checkChat.receiverId})
            .update({$set: {isSenderBlocked: request.payload.isBlock}});
        try {
            await bulk.execute();
        } catch (e) {
            logger.error('Error occurred updating conversation information in block user PA handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Update all other conversations done to blocked user */
        bulk
            .find({senderId: checkChat.receiverId, receiverId: checkChat.senderId})
            .update({$set: {isReceiverBlocked: request.payload.isBlock}});
        try {
            await bulk.execute();
        } catch (e) {
            logger.error('Error occurred updating conversation information in block user PA handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, request.payload.isBlock? 'User blocked': 'User unblocked', 'success', 204)).code(200);
};

paHandler.resendInvitation = async (request, h) => {
    let checkUser, checkMembers, checkPa;

    request.payload.userIds = request.payload.userIds.map(k => mongoose.Types.ObjectId(k));

    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user data in resend invitation handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists.', 'error', 404)).code(404);
    } else if (!checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized.', 'error', 401)).code(401);
    }

    /* Check if this company is part of any organization */
    if (checkUser.isOrganization) {
        try {
            checkPa = await userSchema.UserSchema.findOne({paId: checkUser.paId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding pa data in resend invitation handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Get list of users */
    try {
        checkMembers = await userSchema.UserSchema.find({_id: {$in: request.payload.userIds}, paId: mongoose.Types.ObjectId(request.payload.paId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding members data in resend invitation handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send emails for invitation */
    if (request.payload.isUser) {
        for (let i = 0; i < checkMembers.length; i++) {
            try {
                /* Send app download email */
                let email = {
                    to: [{
                        email: checkMembers[i].email,
                        type: 'to'
                    }],
                    subject: checkUser.firstName + ' ' + checkUser.lastName + ' has invited you to join them in EZJobs',
                    important: true,
                    merge: true,
                    inline_css: true,
                    merge_language: 'mailchimp',
                    merge_vars: [{
                        rcpt: checkMembers[i].email,
                        vars: [
                            {
                                name: 'password',
                                content: checkMembers[i].tempPassword
                            },
                            {
                                name: 'fname',
                                content: checkMembers[i].firstName + ' ' + checkMembers[i].lastName
                            },
                            {
                                name: 'downloadURL',
                                content: 'https://pa.ezjobs.io'
                            },
                            {
                                name: 'community',
                                content: checkUser.isOrganization ? checkPa.employerInformation.companyName : checkUser.employerInformation.companyName
                            },
                            {
                                name: 'email',
                                content: checkMembers[i].email
                            }
                        ]
                    }]
                };

                if (process.env.NODE_ENV === 'production') {
                    if (checkUser.membership.toString() === '601b296b1518584fb3e1d52e') {
                        await mandrill.Handlers.sendTemplate('tie-champions', [], email, true);
                    } else if (checkUser.membership.toString() === '611aa6d519add1146d831b72') {
                        await mandrill.Handlers.sendTemplate('temple-champions', [], email, true);
                    } else {
                        await mandrill.Handlers.sendTemplate('its-champions', [], email, true);
                    }
                } else {
                    await mandrill.Handlers.sendTemplate('tie-champions', [], email, true);
                }
                try {
                    await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, {$set: {'employeeInformation.lastEmailSent': Date.now()}, $inc: {'employeeInformation.numberOfEmailsSent': 1}}, {lean: true, new: true});
                } catch (e) {
                    logger.error('Error occurred while updating user details in resend invitation handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            } catch (e) {
                logger.error('Error in sending app download link to user %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    } else {
        for (let i = 0; i < checkMembers.length; i++) {
            let email;
            if (checkUser.isNonProfit) {
                email = {
                    to: [{
                        email: checkMembers[i].email,
                        type: 'to'
                    }],
                    important: true,
                    subject: checkUser.employerInformation.companyName + ' has invited you to join them',
                    merge: true,
                    inline_css: true,
                    merge_language: 'mailchimp',
                    merge_vars: [{
                        rcpt: checkMembers[i].email,
                        vars: [
                            {
                                name: 'fname',
                                content: checkMembers[i].firstName.trim()
                            },
                            {
                                name: 'email',
                                content: checkMembers[i].email
                            },
                            {
                                name: 'password',
                                content: checkMembers[i].tempPassword
                            },
                            {
                                name: 'downloadURL',
                                content: shortLink.shortLink
                            },
                            {
                                name: 'paname',
                                content: checkUser.firstName
                            }
                        ]
                    }]
                };
                try {
                    await mandrill.Handlers.sendTemplate('invitation-mail-to-students-tie-to-join-ezpa', [], email, true);
                } catch (e) {
                    logger.error('Error occurred while sending invitation email in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                }
            } else {
                email = {
                    to: [{
                        email: checkMembers[i].email,
                        type: 'to'
                    }],
                    important: true,
                    subject: checkUser.employerInformation.companyName + ' has invited you to join them',
                    merge: true,
                    inline_css: true,
                    merge_language: 'mailchimp',
                    merge_vars: [{
                        rcpt: checkMembers[i].email,
                        vars: [
                            {
                                name: 'fname',
                                content: checkMembers[i].firstName.trim()
                            },
                            {
                                name: 'email',
                                content: checkMembers[i].email
                            },
                            {
                                name: 'password',
                                content: checkMembers[i].tempPassword
                            },
                            {
                                name: 'downloadURL',
                                content: shortLink.shortLink
                            }
                        ]
                    }]
                };
                try {
                    await mandrill.Handlers.sendTemplate('mail-to-consultants-ezpa', [], email, true);
                } catch (e) {
                    logger.error('Error occurred while sending invitation email in uploadBulkDataFromCSV handler %s:', JSON.stringify(e));
                }
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Invited successfully.', 'success', 200)).code(200);
};

paHandler.autocomplete = async (request, h) => {
    let checkUser, decoded, result, aggregationCriteria;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in autocomplete PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in autocomplete PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Define aggregation criteria based on parameters */
    if (request.query.isCourse) {
        aggregationCriteria = [
            {
                $match: {
                    userId: mongoose.Types.ObjectId(request.query.userId)
                }
            },
            {
                $unwind: '$courses'
            },
            {
                $match: {
                    courses: new RegExp(request.query.text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                }
            },
            {
                $project: {
                    batches: 0
                }
            }
        ];
    } else if (request.query.isBatch) {
        aggregationCriteria = [
            {
                $match: {
                    userId: mongoose.Types.ObjectId(request.query.userId)
                }
            },
            {
                $unwind: '$batches'
            },
            {
                $match: {
                    batches: new RegExp(request.query.text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                }
            },
            {
                $project: {
                    courses: 0
                }
            }
        ];
    }

    try {
        result = await autoCompleteTrainingInstituteSchema.autoCompleteTrainingInstituteSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred aggregating in auto complete PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(result, 'Fetched successfully', 'success', 200)).code(200);
};

paHandler.getAppVersion = async (request, h) => {
    let constantData = {};

    try {
        constantData = await constantSchema.constantSchema.findOne({}, {androidAppVersionPA: 1, iosAppVersionPA: 1, androidForceAppVersionPA: 1, iosForceAppVersionPA: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding constant data in get app version PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter(constantData, 'Fetched successfully.', 'success', 200)).code(200);
}

paHandler.configAutoComplete = async (request, h) => {
    let checkUser, decoded, result, aggregationCriteria, decodedText = decodeURIComponent(request.query.text);
    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({ _id: request.query.userId }, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding user information in autocomplete PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }
    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in autocomplete PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Define aggregation criteria based on parameters */
    if (request.query.key === 'course') {
        aggregationCriteria = [
            {
                $match: {
                    userId: mongoose.Types.ObjectId(request.query.userId)
                }
            },
            {
                $unwind: '$courses'
            },
            {
                $match: {
                    courses: new RegExp(request.query.text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                }
            },
            {
                $project: {
                    batches: 0
                }
            }
        ];
        try {
            result = await autoCompleteTrainingInstituteSchema.autoCompleteTrainingInstituteSchema.aggregate(aggregationCriteria);
        } catch (e) {
            console.log(e);
            logger.error('Error occurred aggregating in auto complete PA handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.key === 'batch') {
        aggregationCriteria = [
            {
                $match: {
                    userId: mongoose.Types.ObjectId(request.query.userId)
                }
            },
            {
                $unwind: '$batches'
            },
            {
                $match: {
                    batches: new RegExp(request.query.text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                }
            },
            {
                $project: {
                    courses: 0
                }
            }
        ];
        try {
            result = await autoCompleteTrainingInstituteSchema.autoCompleteTrainingInstituteSchema.aggregate(aggregationCriteria);
        } catch (e) {
            console.log(e);
            logger.error('Error occurred aggregating in auto complete PA handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.key === 'degreeName') {
        try {
            result = await degreeSchema.degreeSchema.find({ degreeName: new RegExp(decodedText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi') }, { degreeName: 1 }, { lean: true });
        } catch (e) {
            logger.error('Error occurred while getting degrees in get configuration pa handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.key === 'majorName') {
        try {
            result = await majorSchema.majorSchema.find({ majorName: new RegExp(decodedText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi') }, { majorName: 1 }, { lean: true });
        } catch (e) {
            logger.error('Error occurred while getting majors in get configuration pa handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.query.key === 'jobTitles') {
        aggregationCriteria = [
            {
                $match: { isJobTitle: true }
            },
            {
                $unwind: '$jobTitles'
            },
            {
                $match: {
                    jobTitles: new RegExp(request.query.text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')
                }
            }
        ];
        try {
            result = await searchSuggestionSchema.searchSuggestionSchema.aggregate(aggregationCriteria);
        } catch (e) {
            logger.error('Error occurred while getting majors in get configuration pa handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }
    /* Success */
    return h.response(responseFormatter.responseFormatter(result, 'Fetched successfully', 'success', 200)).code(200);
};

paHandler.updateNewPAConfig = async (request, h) => {
    let checkUser, decoded, dataToUpdate = {
        paId: mongoose.Types.ObjectId(request.payload.paId),
        degree: [],
        major: [],
        course: [],
        batch: [],
        jobTitles: [],
        isExposedToAll: []
    }, config, constantData, updatedData;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding user information in update new PA config handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in update new PA config handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Fetch constant data */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding constant data in update new PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    const len = request.payload.config.length;

    for (let i = 0; i < len; i++) {
        if (request.payload.config[i].key === 'degreeName') {
            if (request.payload.config[i].apiType && request.payload.config[i].apiType.toLowerCase() === 'array') {
                dataToUpdate.degree = request.payload.config[i].values;
            }
        } else if (request.payload.config[i].key === 'majorName') {
            if (request.payload.config[i].apiType && request.payload.config[i].apiType.toLowerCase() === 'array') {
                dataToUpdate.major = request.payload.config[i].values;
            }
        } else if (request.payload.config[i].key === 'batch') {
            if (request.payload.config[i].apiType && request.payload.config[i].apiType.toLowerCase() === 'array') {
                dataToUpdate.batch = request.payload.config[i].values;
            }
        } else if (request.payload.config[i].key === 'course') {
            if (request.payload.config[i].apiType && request.payload.config[i].apiType.toLowerCase() === 'array') {
                dataToUpdate.course = request.payload.config[i].values;
            }
        } else if (request.payload.config[i].key === 'jobTitles') {
            if (request.payload.config[i].apiType && request.payload.config[i].apiType.toLowerCase() === 'array') {
                dataToUpdate.jobTitles = request.payload.config[i].values;
            }
        } else if (request.payload.config[i].key === 'isExposedToAll') {
            if (request.payload.config[i].apiType && request.payload.config[i].apiType.toLowerCase() === 'boolean') {
                dataToUpdate.isExposedToAll = request.payload.config[i].values;
            }
        }
    }

    /* Save/Update this data into collection */
    try {
        updatedData = await paConfigSchema.paConfigSchema.findOneAndUpdate({paId: mongoose.Types.ObjectId(request.payload.paId)}, {$set: dataToUpdate}, {lean: true, upsert: true, new: true});
    } catch (e) {
        logger.error('Error occurred updating pa config in update new PA config handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Fetch configuration data*/
    try {
        config = await configurationSchema.configurationSchema.findOne({isUniversity: checkUser.isUniversity, isNonProfit: checkUser.isNonProfit, isTraining: checkUser.isTraining, isConsulting: checkUser.isConsulting}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding configuration data in  update new PA config handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (config) {
        const idx = config.filter.findIndex(k => k.key === 'network');
        let filters = config.filter[idx].filters;

        if (idx !== -1) {
            const idxMembership = filters.findIndex(k => k.key === 'membershipId');
            if (idxMembership !== -1) {
                let memberships = [];
                for (let i = 0; i < constantData.memberships.length; i++) {
                    memberships.push({key: constantData.memberships[i]._id, label: constantData.memberships[i].name});
                }
                config.filter[idx].filters[idxMembership].values = memberships;
            }

            const idxGroup = filters.findIndex(k => k.key === 'groupId');
            if (idxGroup !== -1) {
                let groups = [], temp = [];
                /* Get groups */
                try {
                    groups = await groupSchema.groupSchema.find({userId: checkUser._id, isCandidate: false}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred in finding groups data in update new PA config handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                for (let i = 0; i < groups.length; i++) {
                    temp.push({key: groups[i]._id, label: groups[i].groupName});
                }
                config.filter[idx].filters[idxGroup].values = temp;
            }
        }

        const idxCandidate = config.filter.findIndex(k => k.key === 'candidate');
        let candidateFilters = config.filter[idxCandidate].filters;
        if (idxCandidate !== -1) {
            const idxGroup = candidateFilters.findIndex(k => k.key === 'groupId');
            if (idxGroup !== -1) {
                let groups = [], temp = [];
                /* Get groups */
                try {
                    groups = await groupSchema.groupSchema.find({userId: checkUser._id, isCandidate: true}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred in finding groups data in update new PA config handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                for (let i = 0; i < groups.length; i++) {
                    temp.push({key: groups[i]._id, label: groups[i].groupName});
                }
                config.filter[idxCandidate].filters[idxGroup].values = temp;
            }

            const idxDegree = candidateFilters.findIndex(k => k.key === 'degreeName');
            if (idxDegree !== -1) {
                let temp = [];
                for (let i = 0; i < updatedData.degree.length; i++) {
                    temp.push({key: updatedData.degree[i].name, label: updatedData.degree[i].name});
                }
                config.filter[idxCandidate].filters[idxDegree].values = temp;
            }

            const idxMajor = candidateFilters.findIndex(k => k.key === 'majorName');
            if (idxMajor !== -1) {
                let temp = [];
                for (let i = 0; i < updatedData.major.length; i++) {
                    temp.push({key: updatedData.major[i], label: updatedData.major[i]});
                }
                config.filter[idxCandidate].filters[idxMajor].values = temp;
            }

            const idxBatch = candidateFilters.findIndex(k => k.key === 'batch');
            if (idxBatch !== -1) {
                let temp = [];
                for (let i = 0; i < updatedData.batch.length; i++) {
                    temp.push({key: updatedData.batch[i], label: updatedData.batch[i]});
                }
                config.filter[idxCandidate].filters[idxBatch].values = temp;
            }

            const idxCourse = candidateFilters.findIndex(k => k.key === 'course');
            if (idxCourse !== -1) {
                let temp = [];
                for (let i = 0; i < updatedData.course.length; i++) {
                    temp.push({key: updatedData.course[i], label: updatedData.course[i]});
                }
                config.filter[idxCandidate].filters[idxCourse].values = temp;
            }

            const idxJobTitles = candidateFilters.findIndex(k => k.key === 'jobTitles');
            if (idxJobTitles !== -1) {
                let temp = [];
                for (let i = 0; i < updatedData.jobTitles.length; i++) {
                    temp.push({key: updatedData.jobTitles[i], label: updatedData.jobTitles[i]});
                }
                config.filter[idxCandidate].filters[idxJobTitles].values = temp;
            }

            const idxGraduationYear = candidateFilters.findIndex(k => k.key === 'graduationYear');
            if (idxGraduationYear !== -1) {
                let temp = [], currentYear = new Date().getFullYear();
                for (let i = currentYear - 25; i < currentYear + 3; i++) {
                    temp.push({key: i, label: i});
                }
                config.filter[idxCandidate].filters[idxGraduationYear].values = temp;
            }
        }

        if (updatedData) {
            for (let i = 0; i < config.config.length; i++) {
                if (config.config[i].key === 'degreeName') {
                    config.config[i].values = updatedData.degree;
                } else if (config.config[i].key === 'majorName') {
                    config.config[i].values = updatedData.major;
                } else if (config.config[i].key === 'batch') {
                    config.config[i].values = updatedData.batch;
                } else if (config.config[i].key === 'course') {
                    config.config[i].values = updatedData.course;
                } else if (config.config[i].key === 'jobTitles') {
                    config.config[i].values = updatedData.jobTitles;
                } else if (config.config[i].key === 'isExposedToAll') {
                    config.config[i].values = updatedData.isExposedToAll;
                }
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(config, 'Updated successfully.', 'success', 204)).code(200);
};

paHandler.getDynamicFields = async (request, h) => {
    let fields, checkUser, searchCriteria = { country: request.query.country, type: request.query.type };

    if (request.query.userId) {
        /* Check whether user is present in database or not */
        try {
            checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding user information in get dynamic field handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!checkUser) {
            return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
        }

        if (request.query.type === 'campusInterview' && checkUser.isUniversity) {
            searchCriteria.isUniversity = true;
        }
        if (request.query.type === 'campusInterview' && checkUser.isTraining) {
            searchCriteria.isTraining = true;
        }
    }

    try {
        fields = await dynamicFieldSchema.dynamicFieldsSchema.findOne(searchCriteria, {fields: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding dynamic field data in get dynamic field handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!fields) {
        try {
            fields = await dynamicFieldSchema.dynamicFieldsSchema.findOne({country: 'IN', type: request.query.type}, {fields: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding dynamic field data in get dynamic field handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    return h.response(responseFormatter.responseFormatter(fields.fields, 'Fetched successfully.', 'success', 200)).code(200);
};

paHandler.getHotLists = async (request, h) => {
    let checkUser, decoded, list = [], searchCriteria;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding user information in get hot lists handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get hot lists handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /*searchCriteria = {
        isHotList: true,
        $or: [{membership: checkUser.membership}, {exposedTo: checkUser._id}]
    };*/

    searchCriteria = {
        userId: checkUser._id
    }

    if (request.query.searchText) {
        searchCriteria['groupName'] = new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi');
    }

    try {
        list = await hotListSchema.hotListSchema.find(searchCriteria, {_id: 1, groupName: 1, members: 1, paId: 1}, {lean: true}).sort({_id: -1}).skip(request.query.skip).limit(request.query.limit).populate('members paId', 'firstName lastName employeeInformation employerInformation.companyName');
    } catch (e) {
        logger.error('Error occurred finding groups in get hot lists handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(list, 'Fetched successfully.', 'success', 200)).code(200);
};

paHandler.getFilters = async (request, h) => {
    let checkUser, decoded, config = {}, constantData;


    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding user information in get filters handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get filters handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Fetch constant data */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding constant data in get filters handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get configuration data */
    try {
        config = await configurationSchema.configurationSchema.findOne({isUniversity: checkUser.isUniversity, isNonProfit: checkUser.isNonProfit, isTraining: checkUser.isTraining, isConsulting: checkUser.isConsulting}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding configuration data in get filters handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    let updatedData;
    try {
        updatedData = await paConfigSchema.paConfigSchema.findOne({paId: checkUser._id}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in finding configuration data in get filters handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (config) {
        const idx = config.filter.findIndex(k => k.key === 'network');
        if (idx !== -1) {
            let filters = config.filter[idx].filters;
            const idxMembership = filters.findIndex(k => k.key === 'membershipId');
            if (idxMembership !== -1) {
                let memberships = [];
                for (let i = 0; i < constantData.memberships.length; i++) {
                    memberships.push({key: constantData.memberships[i]._id, label: constantData.memberships[i].name});
                }
                config.filter[idx].filters[idxMembership].values = memberships;
            }
            const idxGroup = filters.findIndex(k => k.key === 'groupId');
            if (idxGroup !== -1) {
                let groups = [], temp = [];
                /* Get groups */
                try {
                    groups = await groupSchema.groupSchema.find({userId: checkUser._id, isCandidate: false}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred in finding groups data in get filters handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                for (let i = 0; i < groups.length; i++) {
                    temp.push({key: groups[i]._id, label: groups[i].groupName});
                }
                config.filter[idx].filters[idxGroup].values = temp;
            }
        }

        const idxCandidate = config.filter.findIndex(k => k.key === 'candidate');
        if (idxCandidate !== -1) {
            let filters = config.filter[idxCandidate].filters;
            const idxGroup = filters.findIndex(k => k.key === 'groupId');
            if (idxGroup !== -1) {
                let groups = [], temp = [];
                /* Get groups */
                try {
                    groups = await groupSchema.groupSchema.find({userId: checkUser._id, isCandidate: true}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred in finding groups data in get filters handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                for (let i = 0; i < groups.length; i++) {
                    temp.push({key: groups[i]._id, label: groups[i].groupName});
                }
                config.filter[idxCandidate].filters[idxGroup].values = temp;
            }

            const idxDegree = filters.findIndex(k => k.key === 'degreeName');
            if (idxDegree !== -1) {
                let temp = [];
                if (updatedData && updatedData.degree) {
                    for (let i = 0; i < updatedData.degree.length; i++) {
                        temp.push({key: updatedData.degree[i].name, label: updatedData.degree[i].name});
                    }
                }
                config.filter[idxCandidate].filters[idxDegree].values = temp;
            }

            const idxMajor = filters.findIndex(k => k.key === 'group');
            if (idxMajor !== -1) {
                let temp = [];
                if (updatedData && updatedData.major) {
                    for (let i = 0; i < updatedData.major.length; i++) {
                        temp.push({key: updatedData.major[i], label: updatedData.major[i]});
                    }
                }
                config.filter[idxCandidate].filters[idxMajor].values = temp;
            }

            const idxBatch = filters.findIndex(k => k.key === 'batch');
            if (idxBatch !== -1) {
                let temp = [];
                if (updatedData && updatedData.batch) {
                    for (let i = 0; i < updatedData.batch.length; i++) {
                        temp.push({key: updatedData.batch[i], label: updatedData.batch[i]});
                    }
                }
                config.filter[idxCandidate].filters[idxBatch].values = temp;
            }

            const idxCourse = filters.findIndex(k => k.key === 'course');
            if (idxCourse !== -1) {
                let temp = [];
                if (updatedData && updatedData.course) {
                    for (let i = 0; i < updatedData.course.length; i++) {
                        temp.push({key: updatedData.course[i], label: updatedData.course[i]});
                    }
                }
                config.filter[idxCandidate].filters[idxCourse].values = temp;
            }

            const idxJobTitles = filters.findIndex(k => k.key === 'jobTitles');
            if (idxJobTitles !== -1) {
                let temp = [];
                if (updatedData && updatedData.jobTitles) {
                    for (let i = 0; i < updatedData.jobTitles.length; i++) {
                        temp.push({key: updatedData.jobTitles[i], label: updatedData.jobTitles[i]});
                    }
                }
                config.filter[idxCandidate].filters[idxJobTitles].values = temp;
            }

            const idxGraduationYear = filters.findIndex(k => k.key === 'graduationYear');
            if (idxGraduationYear !== -1) {
                let temp = [], currentYear = new Date().getFullYear();
                for (let i = currentYear - 25; i < currentYear + 3; i++) {
                    temp.push({key: i, label: i});
                }
                config.filter[idxCandidate].filters[idxGraduationYear].values = temp;
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(config, 'Fetched successfully.', 'success', 200)).code(200);
};

paHandler.chatRequests = async (request, h) => {
    let checkUser, decoded, requests = [];

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding user information in get chat requests handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get chat requests handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get all the requests */
    try {
        requests = await chatRequestSchema.chatRequestSchema.aggregate([
            {
                $match: {
                    paId: mongoose.Types.ObjectId(request.query.userId)
                }
            },
            {
                $sort: {
                    updatedAt: -1
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
                    candidateFirstName: '$candidate.firstName',
                    candidateLastName: '$candidate.lastName',
                    candidatePhoto: '$candidate.employeeInformation.profilePhoto',
                    employerFirstName: '$employer.firstName',
                    employerLastName: '$employer.lastName',
                    companyName: '$employer.employerInformation.companyName',
                    companyLogo: '$employer.employerInformation.companyProfilePhoto',
                    jobTitle: '$job.jobTitle',
                    subJobTitle: '$job.subJobTitle',
                    jobId: '$job._id',
                    isAccepted: 1,
                    isRejected: 1,
                    employerId: 1,
                    currency: '$job.currency',
                    pastJobTitles: '$candidate.employeeInformation.pastJobTitles',
                    candidateId: 1
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred aggregating requests in get chat requests handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(requests, 'Fetched successfully.', 'success', 200)).code(200);
};

paHandler.updateChatRequest = async (request, h) => {
    let checkUser, decoded, checkRequest, candidateData, title;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding user information in update chat request handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in update chat request handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether chat request exists */
    try {
        checkRequest = await chatRequestSchema.chatRequestSchema.findById({_id: request.payload.requestId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding chat request in update chat request handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkRequest) {
        return h.response(responseFormatter.responseFormatter({}, 'No such request', 'error', 404)).code(404);
    } else if (checkRequest.isAccepted) {
        return h.response(responseFormatter.responseFormatter({}, 'You have already accepted this request', 'error', 400)).code(400);
    } else if (checkRequest.isRejected) {
        return h.response(responseFormatter.responseFormatter({}, 'You have already declined this reject', 'error', 400)).code(400);
    }

    /* Check if chat exists */
    let searchCriteria = {
        $or: [{roomId: checkRequest.paId + '' + checkRequest.employerId + '' + checkRequest.jobId}, {roomId: checkRequest.employerId + '' + checkRequest.paId + '' + checkRequest.jobId}]
    };

    /* Get the candidate data to send push */
    try {
        candidateData = await userSchema.UserSchema.findByIdAndUpdate({_id: checkRequest.candidateId}, {$addToSet: {exposedTo: checkRequest.employerId}}, {lean: true, new: true});
    } catch (e) {
        logger.error('Error occurred finding candidate data in update chat request handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!candidateData) {
        return h.response(responseFormatter.responseFormatter({}, 'No such candidate', 'error', 404)).code(404);
    }

    title = (candidateData.firstName.trim() + ' ' + candidateData.lastName.trim()).trim();

    /* Check if user is accepting or rejecting the request */
    if (request.payload.isAccepted) {
        /* Check if chat already exists then make isExposed parameter true */
        let checkChat;

        try {
            checkChat = await conversationSchema.conversationSchema.findOne({employerId: checkRequest.employerId, candidateId: checkRequest.candidateId, jobId: checkRequest.jobId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding chat between employer and candidate in update chat request handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (checkChat) {
            try {
                await conversationSchema.conversationSchema.findByIdAndUpdate({_id: checkChat._id}, {$set: {isExposed: true}}, {lean: true});
            } catch (e) {
                logger.error('Error occurred updating chat between employer and candidate in update chat request handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        } else {
            /* Create new chat thread between candidate and employer */
            const dataToSave = {
                roomId: checkRequest.candidateId + checkRequest.employerId + checkRequest.jobId,
                candidateId: checkRequest.candidateId,
                employerId: checkRequest.employerId,
                jobId: checkRequest.jobId,
                isApplied: true,
                hasEmployerDeleted: false,
                hasCandidateDeleted: false,
                isCandidateBlocked: false,
                isEmployerBlocked: false,
                chats: [{
                    from: checkRequest.candidateId,
                    to: checkRequest.employerId,
                    body: aes256.encrypt(key, 'I am interested in this position.'),
                    originalBody: aes256.encrypt(key, 'I am interested in this position.'),
                    type: 'isText',
                    duration: 0,
                    latitude: '',
                    longitude: '',
                    isRead: false,
                    hasEmployerDeleted: false,
                    hasCandidateDeleted: false,
                    isCandidateBlocked: false,
                    isEmployerBlocked: false,
                    isEncrypted: true,
                    isTranslated: false
                }],
                isExposed: true,
                paId: checkRequest.paId
            };


            /* Get the employer data to send push */
            let employerData;
            try {
                employerData = await userSchema.UserSchema.findById({_id: checkRequest.employerId}, {deviceType: 1, deviceToken: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred finding employer data in update chat request handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (!employerData) {
                return h.response(responseFormatter.responseFormatter({}, 'No such employer', 'error', 404)).code(404);
            }

            /* Save the data */
            let chatThread;
            try {
                chatThread = await new conversationSchema.conversationSchema(dataToSave).save();
            } catch (e) {
                logger.error('Error occurred saving chat between employer and candidate in update chat request handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            let payloadToSend = {
                employerId: checkRequest.employerId,
                candidateId: checkRequest.candidateId,
                jobId: checkRequest.jobId,
                role: 'employer',
                pushType: 'chat',
                chatId: chatThread._id,
                type: 'isText'
            };

            push.createMessage(employerData.deviceToken, [], payloadToSend, employerData.deviceType, title, 'I am interested in this position.', 'beep', 'chat_' + chatThread._id, 'EZJobs_chat');
        }
        /* Update all the requests */
        try {
            await chatRequestSchema.chatRequestSchema.updateMany({employerId: checkRequest.employerId}, {$set: {isAccepted: true}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred updating chat request in update chat request handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        try {
            await chatSchema.chatSchema.findOneAndUpdate(searchCriteria, {$addToSet: {candidateId: checkRequest.candidateId}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred updating chat request in update chat request handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

    } else {
        /* Send message to candidate from PA about the same */
        let messagesToPush = [], jobs, paJob, paConversation;

        try {
            paJob = await jobSchema.jobSchema.findOne({userId: checkUser._id, isVisible: false}, {_id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding pa job in update chat request handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (paJob) {
            try {
                paConversation = await conversationSchema.conversationSchema.findOne({employerId: checkUser._id, candidateId: checkRequest.candidateId, jobId: paJob._id}, {_id: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred finding conversation in update chat request handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }

        if (paConversation) {
            try {
                jobs = await chatRequestSchema.chatRequestSchema.find({employerId: checkRequest.employerId}, {
                    jobId: 1
                }, {lean: true}).populate('jobId', 'jobTitle');
            } catch (e) {
                logger.error('Error occurred finding chat request in update chat request handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            for (let i = 0; i < jobs.length; i++) {
                const messageToPush = {
                    from: checkUser._id,
                    to: checkRequest.candidateId,
                    body: aes256.encrypt(key, 'Your request to chat for the job of ' + jobs[i].jobId.jobTitle + ' has been rejected.'),
                    originalBody: aes256.encrypt(key, 'Your request to chat for the job of ' + jobs[i].jobId.jobTitle + ' has been rejected.'),
                    type: 'isText',
                    duration: 0,
                    latitude: '',
                    longitude: '',
                    isRead: false,
                    hasEmployerDeleted: false,
                    hasCandidateDeleted: false,
                    isCandidateBlocked: false,
                    isEmployerBlocked: false,
                    isEncrypted: true,
                    isTranslated: false
                };
                messagesToPush.push(messageToPush);
            }
            try {
                await conversationSchema.conversationSchema.findByIdAndUpdate({_id: paConversation._id}, {$push: {chats: messagesToPush}}, {lean: true});
            } catch (e) {
                logger.error('Error occurred updating conversation in update chat request handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            let payloadToSend = {
                employerId: checkUser._id,
                candidateId: candidateData._id,
                jobId: paJob._id,
                role: 'employer',
                pushType: 'chat',
                chatId: paConversation._id,
                type: 'isText'
            };
            push.createMessage(candidateData.deviceToken, [], payloadToSend, candidateData.deviceType, title, 'You have a new message from your recruiter.', 'beep', 'chat_' + paConversation._id, 'EZJobs_chat');
        }

        /* Update all the requests */
        try {
            await chatRequestSchema.chatRequestSchema.updateMany({employerId: checkRequest.employerId}, {$set: {isRejected: true}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred updating chat request in update chat request handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, request.payload.isAccepted ? 'Request has been accepted' : 'Request has been declined', 'success', 200)).code(200);
};

paHandler.releaseCandidates = async (request, h) => {
    let checkUser, decoded, checkChat, candidates;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding user information in release candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in release candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether the chat between PA and employer exists */
    try {
        checkChat = await chatSchema.chatSchema.findById({_id: request.payload.chatId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding chat in release candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkChat) {
        return h.response(responseFormatter.responseFormatter({}, 'No such conversation', 'error', 404)).code(404);
    }

    /* Get list of candidates which belongs to the PA */
    request.payload.candidateIds = request.payload.candidateIds.map(k => mongoose.Types.ObjectId(k));
    try {
        candidates = await userSchema.UserSchema.find({_id: {$in: request.payload.candidateIds}, paId: mongoose.Types.ObjectId(request.payload.userId)}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding candidates in release candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    let bulkUpdateCandidates = [], bulkUpdateConversations = [], employerId;
    employerId = checkChat.senderId.toString() === request.payload.userId ? checkChat.receiverId : checkChat.senderId;

    for (let i = 0; i < candidates.length; i++) {
        let checkCandidateChat;

        try {
            await chatSchema.chatSchema.findByIdAndUpdate({_id: request.payload.chatId}, {$addToSet: {candidateId: candidates[i]._id}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating chat in release candidate handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        bulkUpdateCandidates.push(await userSchema.UserSchema.findByIdAndUpdate({_id: candidates[i]._id}, {$addToSet: {exposedTo: employerId}}, {lean: true}));

        try {
            checkCandidateChat = await conversationSchema.conversationSchema.findOne({candidateId: candidates[i]._id, employerId: employerId, jobId: checkChat.jobId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while chat in release candidate handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (checkCandidateChat) {
            bulkUpdateConversations.push(await conversationSchema.conversationSchema.findByIdAndUpdate({_id: checkCandidateChat._id}, {$set: {isExposed: true}}, {lean: true}));
        } else {
            let chat;
            /* Create a new conversation between an employer and candidate */
            const dataToSave = {
                roomId: candidates[i]._id + employerId + checkChat.jobId,
                candidateId: mongoose.Types.ObjectId(candidates[i]._id),
                employerId: mongoose.Types.ObjectId(employerId),
                jobId: mongoose.Types.ObjectId(checkChat.jobId),
                isApplied: true,
                hasEmployerDeleted: false,
                hasCandidateDeleted: false,
                isCandidateBlocked: false,
                isEmployerBlocked: false,
                chats: [{
                    from: mongoose.Types.ObjectId(candidates[i]._id),
                    to: mongoose.Types.ObjectId(employerId),
                    body: aes256.encrypt(key, 'I am interested in the position.'),
                    originalBody: aes256.encrypt(key, 'I am interested in the position.'),
                    type: 'isText',
                    duration: 0,
                    latitude: '',
                    longitude: '',
                    isRead: false,
                    hasEmployerDeleted: false,
                    hasCandidateDeleted: false,
                    isCandidateBlocked: false,
                    isEmployerBlocked: false,
                    isEncrypted: true,
                    isTranslated: false
                }],
                paId: mongoose.Types.ObjectId(request.payload.userId)
            };

            try {
                chat = await new conversationSchema.conversationSchema(dataToSave).save();
            } catch (e) {
                logger.error('Error occurred while saving conversation in release candidate handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            /* Send push to employer */
            let payloadToSend = {
                employerId: employerId,
                candidateId: dataToSave.candidateId,
                jobId: dataToSave.jobId,
                role: 'employer',
                pushType: 'chat',
                chatId: chat._id,
                type: 'isText'
            };

            /* Get employer and candidate information to send in push */
            let employer, candidate;
            try {
                employer = await userSchema.UserSchema.findById({_id: employerId}, {deviceToken: 1, deviceType: 1}, {lean: true});
                candidate = await userSchema.UserSchema.findById({_id: dataToSave.candidateId}, {firstName: 1, lastName: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding candidate and employer data in release candidate handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if (employer && candidate) {
                const title = (candidate.firstName.trim() + ' ' + candidate.lastName.trim()).trim();
                push.createMessage(employer.deviceToken, [], payloadToSend, employer.deviceType, title, 'I am interested in the position.', 'beep', 'chat_' + candidate._id, 'EZJobs_chat');
            }
        }
    }

    /* Run promises in parallel */
    try {
        await Promise.all(bulkUpdateCandidates);
        await Promise.all(bulkUpdateConversations);
    } catch (e) {
        logger.error('Error occurred while parallel running promises in release candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Candidates released to employer successfully', 'success', 200)).code(200);
};

paHandler.assignDataToPA = async (request, h) => {
    let checkPa, decoded, checkDeactivatedUser, checkNewUser;

    /* Check whether user is present in database or not */
    try {
        checkPa = await userSchema.UserSchema.findById({_id: request.payload.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding user information in assign data to PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkPa) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    } else if (!checkPa.isMaster) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in assign data to PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkPa._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check if deactivated user exists */
    try {
        checkDeactivatedUser = await userSchema.UserSchema.findById({_id: request.payload.deActivatedUserId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding deactivated user information in assign data to PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkDeactivatedUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User you\'re trying to deactivate does not exists.', 'error', 404)).code(404);
    } else if (checkDeactivatedUser.paId.toString() !== request.payload.paId.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'User you\'re trying to deactivate does not exists.', 'error', 404)).code(404);
    }

    /* Check if new user exists */
    try {
        checkNewUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding new user information in assign data to PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkNewUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User you\'re trying to assign to does not exists.', 'error', 404)).code(404);
    }

    /* Assign all data to the new user (candidates, jobs, chats, conversations, chat requests) */
    let bulkCandidates = userSchema.UserSchema.collection.initializeUnorderedBulkOp();
    bulkCandidates.find({paId: mongoose.Types.ObjectId(request.payload.deActivatedUserId)}).update({$set: {paId: checkNewUser._id}});
    await bulkCandidates.execute();
    let bulkJobs = jobSchema.jobSchema.collection.initializeUnorderedBulkOp();
    bulkJobs.find({userId: mongoose.Types.ObjectId(request.payload.deActivatedUserId)}).update({$set: {userId: checkNewUser._id}});
    await bulkJobs.execute();
    let bulkChats1 = chatSchema.chatSchema.collection.initializeUnorderedBulkOp();
    bulkChats1.find({senderId: mongoose.Types.ObjectId(request.payload.deActivatedUserId)}).update({$set: {senderId: checkNewUser._id}});
    await bulkChats1.execute();
    let bulkChats2 = chatSchema.chatSchema.collection.initializeUnorderedBulkOp();
    bulkChats2.find({receiverId: mongoose.Types.ObjectId(request.payload.deActivatedUserId)}).update({$set: {receiverId: checkNewUser._id}});
    await bulkChats2.execute();
    let bulkConversations = conversationSchema.conversationSchema.collection.initializeUnorderedBulkOp();
    bulkConversations.find({employerId: mongoose.Types.ObjectId(request.payload.deActivatedUserId)}).update({$set: {employerId: checkNewUser._id}});
    await bulkConversations.execute();
    let bulkChatRequests1 = chatRequestSchema.chatRequestSchema.collection.initializeUnorderedBulkOp();
    bulkChatRequests1.find({paId: mongoose.Types.ObjectId(request.payload.deActivatedUserId)}).update({$set: {paId: checkNewUser._id}});
    await bulkChatRequests1.execute();
    let bulkChatRequests2 = chatRequestSchema.chatRequestSchema.collection.initializeUnorderedBulkOp();
    bulkChatRequests2.find({employerId: mongoose.Types.ObjectId(request.payload.deActivatedUserId)}).update({$set: {employerId: checkNewUser._id}});
    await bulkChatRequests2.execute();

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully.', 'success', 200)).code(200);
};

paHandler.getExposedCandidates = async (request, h) => {
    let checkChat;

    /* Get the chat details of PA */
    try {
        checkChat = await chatSchema.chatSchema.aggregate([
            {
                $match: {
                    _id: mongoose.Types.ObjectId(request.query.chatId)
                }
            },
            {
                $unwind: '$candidateId'
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
                $project: {
                    firstName: '$candidate.firstName',
                    lastName: '$candidate.lastName',
                    appDownloaded: '$candidate.hasOwned',
                    employeeInformation: {
                        _id: '$candidate._id',
                        profilePhoto: '$candidate.employeeInformation.profilePhoto',
                        resume: '$candidate.employeeInformation.resume',
                        profileCompleted: '$candidate.employeeInformation.isComplete',
                        description: '$candidate.employeeInformation.description'
                    }
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred finding chat in get exposed candidates PA handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkChat) {
        return h.response(responseFormatter.responseFormatter({}, 'No such chat found.', 'error', 404)).code(404);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(checkChat, 'Fetched successfully.', 'success', 200)).code(200);
};

paHandler.deleteGroups = async (request, h) => {
    let checkUser, decoded;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding user information in delete groups handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in delete groups handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Delete groups */
    request.payload.groupIds = request.payload.groupIds.map(k => mongoose.Types.ObjectId(k));

    try {
        await groupSchema.groupSchema.deleteMany({_id: {$in: request.payload.groupIds}, userId: checkUser._id});
    } catch (e) {
        logger.error('Error occurred deleting groups in delete groups handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Removed successfully', 'success', 202)).code(202);
};

paHandler.deleteSharedHotList = async (request, h) => {
    let checkUser, decoded;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding user information in delete shared hotlists handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in delete shared hotlists handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Delete groups */
    request.payload.hotListIds = request.payload.hotListIds.map(k => mongoose.Types.ObjectId(k));

    try {
        await hotListSchema.hotListSchema.deleteMany({_id: {$in: request.payload.hotListIds}, userId: checkUser._id});
    } catch (e) {
        logger.error('Error occurred deleting groups in delete shared hotlists handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Removed successfully', 'success', 202)).code(202);
};

paHandler.manualUploadFields = async (request, h) => {
    let checkUser, decoded, fields;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding user information in get manual upload fields handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get manual upload handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get list of fields based on role */
    try {
        fields = await dynamicFieldSchema.dynamicFieldsSchema.findOne({type: 'manualCandidateUpload', isUniversity: checkUser.isUniversity, isConsulting: checkUser.isConsulting, isNonProfit: checkUser.isNonProfit, isTraining: checkUser.isTraining, country: checkUser.employerInformation.country}, {fields: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding dynamic fields data in get manual upload handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(fields ? fields : {}, 'Fetched successfully', 'success', 200)).code(200);
};

module.exports = {
    Handlers: paHandler
};
