const mongoose = require('mongoose');
const responseFormatter = require('../utils/responseFormatter');
const commonFunctions = require('../utils/commonFunctions');
const userSchema = require('../schema/userSchema');
const bcrypt = require('bcrypt');
const tokenSchema = require('../schema/authToken');
const constantSchema = require('../schema/constantSchema');
const uploadHistorySchema = require('../schema/uploadHistory');
const regionSchema = require('../schema/regionSchema');
const chapterSchema = require('../schema/chapterSchema');
const mandrill = require('../utils/mandrill');
const logger = require('../utils/logger');
const categorySchema = require('../schema/categorySchema');
const jobSchema = require('../schema/jobSchema');
const mailServerSchema = require('../schema/mailServerSchema');
const menuConfigSchema = require('../schema/menuConfig');
const labelConfigSchema = require('../schema/labelConfig');
const packageSchema = require('../schema/packageSchema');
const subscriptionSchema = require('../schema/subscriptionSchema');
const languageSchema = require('../schema/languageSchema');
const paConfigSchema = require('../schema/paConfig');
const nodeMailer = require('nodemailer');

let paAdminHandler = {};

paAdminHandler.auth = async (request, h) => {
    let checkUser, match, constantData;

    /* Checking if user is logging in using email */
    try {
        checkUser = await userSchema.UserSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while checking user in auth user pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkUser) {
        if (!checkUser.isPaAdmin) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action.', 'error', 400)).code(400);
        } else if (!checkUser.isActive) {
            return h.response(responseFormatter.responseFormatter({}, 'Your account has been deactivated by the admin or EZJobs.', 'error', 400)).code(400);
        }
        /* Check if password is correct */
        if (request.payload.password) {
            try {
                match = await bcrypt.compare(request.payload.password, checkUser.password);
            } catch (e) {
                logger.error('Error occurred while comparing passwords in auth user pa admin handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (!match) {
                return h.response(responseFormatter.responseFormatter({}, 'Email or password is incorrect', 'error', 400)).code(400);
            }
        }
        if (!checkUser.isActive && checkUser.isSlave) {
            return h.response(responseFormatter.responseFormatter({}, 'Your account has been blocked by your parent account. Please contact them for more information', 'error', 400)).code(400);
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
            logger.error('Error occurred while saving user token in auth pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Fetch constant data */
        try {
            constantData = await constantSchema.constantSchema.findOne({}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding constant data in auth pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (constantData.memberships) {
            const idx = constantData.memberships.findIndex(k => k._id.toString() === checkUser.membership);
            if (idx !== -1) {
                checkUser.membership = constantData.memberships[idx].name;
                checkUser.membershipId = constantData.memberships[idx]._id;
            }
        }

        return h.response(responseFormatter.responseFormatter({authToken: token, userInfo: checkUser, constantData: constantData}, 'Logged in successfully', 'success', 200)).code(200);
    }

    return h.response(responseFormatter.responseFormatter({}, 'We do not find account with the given email', 'error', 404)).code(404);
};

paAdminHandler.getDashboardData = async (request, h) => {
    let checkUser, decoded, members = 0, signedUp = 0, recruiters = 0, jobs = 0, candidates = 0, studentMembers = 0, charteredMembers = 0, corporateMembers = 0, eliteMembers = 0, configData,
    dataToReturn = {
        members: 0,
        signedUp: 0,
        recruiters: 0,
        jobs: 0,
        candidates: 0
    };

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get dashboard data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get dashboard data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists', 'error', 404)).code(404);
    } else if (!checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action.', 'error', 400)).code(400);
    }

    /* Get dashboard data */
    checkUser.additionalMemberships.push(mongoose.Types.ObjectId(checkUser.membership));
    let allMemberships = checkUser.additionalMemberships, allMembershipsString = checkUser.membership;
    let matchCriteria = {
        $or: [{membership: allMembershipsString}, {additionalMemberships: {$in: allMemberships}}],
        isPaAdmin: false,
        isPa: true
    };

    if (request.query.chapter) {
        matchCriteria['employerInformation.chapter'] = mongoose.Types.ObjectId(request.query.chapter);
    }

    if (request.query.region) {
        matchCriteria['employerInformation.region'] = mongoose.Types.ObjectId(request.query.region);
    }

    /* Count total number of members */
    try {
        dataToReturn.members = await userSchema.UserSchema.countDocuments(matchCriteria);
    } catch (e) {
        logger.error('Error occurred while counting members in get dashboard data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get config data */
    const userIdToCheck = checkUser.isMaster ? checkUser._id : checkUser.paId;
    try {
        configData = await paConfigSchema.paConfigSchema.findOne({paId: userIdToCheck}, {memberTypes: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user config in get dashboard data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (configData && configData.memberTypes) {
        for (let i = 0; i < configData.memberTypes.length; i++) {
            matchCriteria['memberType'] = configData.memberTypes[i].key;
            try {
                dataToReturn[configData.memberTypes[i].key] = await userSchema.UserSchema.countDocuments(matchCriteria);
            } catch (e) {
                logger.error('Error occurred while counting members in get dashboard data pa admin handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }


    delete matchCriteria.memberType;

    /* Count signed up members */
    matchCriteria['hasOwned'] = true;

    try {
        dataToReturn.signedUp = await userSchema.UserSchema.countDocuments(matchCriteria);
    } catch (e) {
        logger.error('Error occurred while counting signed up members in get dashboard data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Count total number of recruiters */
    delete matchCriteria.hasOwned;
    matchCriteria['isMaster'] = false;

    try {
        dataToReturn.recruiters = await userSchema.UserSchema.countDocuments(matchCriteria);
    } catch (e) {
        logger.error('Error occurred while counting recruiters in get dashboard data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Count total number of candidates */
    delete matchCriteria.isMaster;
    delete matchCriteria.isPa;
    delete matchCriteria['employerInformation.chapter'];
    delete matchCriteria['employerInformation.region'];
    matchCriteria['isMaster'] = true;
    matchCriteria['isPa'] = false;
    matchCriteria['isPaEmployer'] = false;

    try {
        dataToReturn.candidates = await userSchema.UserSchema.countDocuments(matchCriteria);
    } catch (e) {
        logger.error('Error occurred while counting candidates in get dashboard data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Count total number of jobs */
    delete matchCriteria.isMaster;
    delete matchCriteria.isPa;
    delete matchCriteria.isPaEmployer;
    matchCriteria['isPa'] = true;

    try {
        jobs = await userSchema.UserSchema.aggregate([
            {
                $match: matchCriteria
            },
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
                    'job.isVisible': true,
                    'job.isTranslated': false
                }
            },
            {
                $count: 'totalJobs'
            }
        ]);
    } catch (e) {
        logger.error('Error occurred while counting active jobs in get dashboard data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    dataToReturn.jobs = jobs[0] ? jobs[0].totalJobs : 0;

    /* Success */
    /*const dataToReturn = {
        members: members,
        signedUp: signedUp,
        notSignedUp: members - signedUp,
        recruiters: recruiters,
        candidates: candidates,
        jobs: jobs[0] ? jobs[0].totalJobs : 0,
        studentMembers: studentMembers,
        charteredMembers: charteredMembers,
        corporateMembers: corporateMembers,
        eliteMembers: eliteMembers
    };*/

    return h.response(responseFormatter.responseFormatter(dataToReturn, 'Fetched successfully', 'success', 200)).code(200);
};

paAdminHandler.uploadMembers = async (request, h) => {
    let fileName = request.payload.file.filename, paCount = 0, checkUser, decoded, uploadData, result, totalCount = 0, jobData, category, chapters, regions;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in upload members data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in upload members data pa admin handler %s:', JSON.stringify(e));
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
        isEmployer: false,
        isAdmin: true
    };

    uploadData = new uploadHistorySchema.uploadHistory(uploadHistory);

    try {
        await uploadData.save();
    } catch (e) {
        logger.error('Error occurred while saving upload data in upload members data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get regions and chapters */
    try {
        chapters = await chapterSchema.chapterSchema.find({userId: checkUser.isMaster ? mongoose.Types.ObjectId(checkUser._id): mongoose.Types.ObjectId(checkUser.paId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting chapters data in upload members data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    try {
        regions = await regionSchema.regionSchema.find({userId: checkUser.isMaster ? mongoose.Types.ObjectId(checkUser._id): mongoose.Types.ObjectId(checkUser.paId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting regions data in upload members data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }


    for (let i = 0; i < len; i++) {
        let checkPa;
        const data = result[i];

        /* Search whether this user is already present in the database or not */
        if (data['Email']) {
            totalCount++;
            try {
                checkPa = await userSchema.UserSchema.findOne({email: data['Email']}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding user in upload members PA admin handler %s:', JSON.stringify(e));
                /* Update upload data */
                try {
                    await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: paCount, errorCount: totalCount - paCount, status: 'Error'}}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while upload history details in uploadEmployers handler %s:', JSON.stringify(e));
                }
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if (checkUser.companyEmailRequired) {
                const check = data['Email'].split('@');
                const domain = commonFunctions.Handlers.getDomain(checkUser.employerInformation.website);
                if (check[1].toLowerCase() !== domain.toLowerCase()) {
                    /* Update upload data */
                    try {
                        await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: paCount, errorCount: totalCount - paCount, status: 'Error'}}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while upload history details in uploadEmployers handler %s:', JSON.stringify(e));
                    }
                    continue;
                }
            }

            /* Get category for saving it into job */
            try {
                category = await categorySchema.categorySchema.findOne({isActive: true, categoryName: 'Others'}, {_id: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding category in upload members pa admin handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if (!checkPa) {
                let region, chapter;
                /* Check regions and chapters */
                if (data['Region']) {
                    const idx = regions.findIndex(k => k.name.toLowerCase() === data['Region'].toLowerCase());
                    if (idx !== -1) {
                        region = regions[idx]._id;
                    } else {
                        /* Update upload data */
                        try {
                            await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: paCount, errorCount: totalCount - paCount, status: 'Error'}}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred while upload history details in uploadEmployers handler %s:', JSON.stringify(e));
                        }
                        continue;
                    }
                }
                if (data['Chapter']) {
                    const idx = chapters.findIndex(k => k.name.toLowerCase() === data['Chapter'].toLowerCase());
                    if (idx !== -1) {
                        chapter = chapters[idx]._id;
                    } else {
                        /* Update upload data */
                        try {
                            await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: paCount, errorCount: totalCount - paCount, status: 'Error'}}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred while upload history details in uploadEmployers handler %s:', JSON.stringify(e));
                        }
                        continue;
                    }
                }

                const tempPassword = commonFunctions.Handlers.generatePassword();
                let dataToSave = {
                    firstName: data['First name'],
                    lastName: data['Last name'] ? data['Last name'] : '',
                    email: data['Email'],
                    roles: ['Employer'],
                    'employerInformation.companyLocation': checkUser.employerInformation.companyLocation,
                    'employeeInformation.location': checkUser.employerInformation.companyLocation,
                    'employeeInformation.country': checkUser.country,
                    'employerInformation.country': checkUser.country,
                    country: checkUser.country,
                    'employerInformation.countryCode': data['Country code'] ? data['Country code'] : '',
                    'employerInformation.companyPhone': data['Phone number'] ? data['Phone number'] : '',
                    'employerInformation.companyName': data['Company name'],
                    'employerInformation.region': region ? mongoose.Types.ObjectId(region) : undefined,
                    'employerInformation.chapter': chapter ? mongoose.Types.ObjectId(chapter) : undefined,
                    isPa: !!checkUser.isPaAdmin,
                    tempPassword: tempPassword,
                    password: tempPassword,
                    hasInstalled: false,
                    hasOwned: false,
                    isPaEmployer: false,
                    membership: checkUser.isPaAdmin ? (checkUser.membership ? checkUser.membership : '') : '',
                    isConsulting: !!checkUser.isConsulting,
                    isUniversity: !!checkUser.isUniversity,
                    isNonProfit: !!checkUser.isNonProfit,
                    isTraining: !!checkUser.isTraining,
                    isOrganization: true,
                    isIndividual: false,
                    paId: mongoose.Types.ObjectId(checkUser._id),
                    referralCode: commonFunctions.Handlers.generateReferralCode(data['First name']),
                    memberType: data['Member type'] ? data['Member type'] : ''
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

                /* Assign default language */
                let language;
                try {
                    language = await languageSchema.languageSchema.findOne({language: 'en', country: checkUser.country}, {_id: 1, name: 1}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred in finding language data in upload members PA admin handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (language) {
                    dataToSave.appLanguage = language._id;
                    dataToSave.chatLanguage = language._id;
                }

                /* Create free subscription for this users */
                let checkPackage;
                try {
                    checkPackage = await packageSchema.packageSchema.findOne({isFree: true, country: checkUser.country, isActive: true}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred in finding package in upload members PA admin handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (checkPackage) {
                    dataToSave.subscriptionInfo = {packageId: checkPackage._id};
                    /* Create free subscription & Check whether plan exists */
                    let subscriptionData, packageId;

                    try {
                        packageId = await packageSchema.packageSchema.findOne({country: checkUser.country, isFree: true, isActive: true}, {_id: 1}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while fetching package id in upload members PA admin handler %s:', JSON.stringify(e));
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
                        logger.error('Error occurred saving subscription information in upload members PA admin handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }

                    dataToSave.subscriptionInfo['subscriptionId'] = subscriptionData._id;
                }

                const saveData = new userSchema.UserSchema(dataToSave);
                try {
                    await saveData.save();
                } catch (e) {
                    logger.error('Error occurred saving user in upload members PA admin handler %s:', JSON.stringify(e));
                    /* Update upload data */
                    try {
                        await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: paCount, errorCount: totalCount - paCount, status: 'Error'}}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while upload history details in upload members admin handler %s:', JSON.stringify(e));
                    }
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                /* Create default PA config*/
                const configToSave = {
                    paId: saveData._id,
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
                jobData.jobTitle = checkUser.isUniversity ? 'Placement officer' : 'Consulting company';
                jobData.location.coordinates = [saveData.employeeInformation.location.coordinates[0], saveData.employeeInformation.location.coordinates[1]];
                jobData.displayLocation.coordinates = [[saveData.employeeInformation.location.coordinates[0], saveData.employeeInformation.location.coordinates[1]]];
                jobData.numberOfPositions = 1;
                jobData.isVisible = false;
                jobData.userId = mongoose.Types.ObjectId(saveData._id);
                jobData.categoryId = mongoose.Types.ObjectId(category._id);

                try {
                    await jobData.save();
                } catch (e) {
                    logger.error('Error occurred while saving job data in upload members pa admin handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                /* Add this user to the exposed list */
                let bulk = jobSchema.jobSchema.collection.initializeUnorderedBulkOp();
                bulk
                    .find({isExposedToCommunity: true, membership: checkUser.membership.toString()})
                    .update({$push: {exposedTo: saveData._id}});
                try {
                    await bulk.execute();
                } catch (e) {
                    logger.error('Error occurred while pushing exposed data in upload members pa admin handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                paCount++;

                /* Send email to the members for with the password and link to download the app */
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
                            subject: checkUser.firstName + ' is inviting you to join them on EZJobs',
                            merge_language: 'mailchimp',
                            merge_vars: [{
                                rcpt: dataToSave.email,
                                vars: [
                                    {
                                        name: 'fname',
                                        content: dataToSave.firstName.trim() + ' ' + dataToSave.lastName.trim()
                                    },
                                    {
                                        name: 'adminName',
                                        content: (checkUser.firstName + ' ' + checkUser.lastName).trim()
                                    },
                                    {
                                        name: 'community',
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
                                        name: 'url',
                                        content: 'https://pa.ezjobs.io'
                                    }
                                ]
                            }]
                        };
                        /*await mandrill.Handlers.sendTemplate('invitation-mail-to-employers-ezpa', [], email, true);*/
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
                            checkUser = await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, {$set: {'employeeInformation.lastEmailSent': Date.now()}, $inc: {'employeeInformation.numberOfEmailsSent': 1}}, {lean: true, new: true});
                        } catch (e) {
                            logger.error('Error occurred while updating user details in uploadEmployers handler %s:', JSON.stringify(e));
                            /* Update upload data */
                            try {
                                await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: paCount, errorCount: totalCount - paCount, status: 'Error'}}, {lean: true});
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
                /* Apply membership to the user */
                try {
                    await userSchema.UserSchema.findByIdAndUpdate({_id: checkPa._id}, {$addToSet: {additionalMemberships: checkUser.membership}, $set: {isPa: true, isConsulting: checkUser.isConsulting, isUniversity: checkUser.isUniversity, isOrganization: true}}, {lean: true});
                } catch (e) {
                    logger.error('Error in updating user data in invite members pa admin handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }

                /* Create a fake job so that PA can chat with his/her candidates */
                jobData = new jobSchema.jobSchema(request.payload);
                jobData.jobTitle = checkUser.isUniversity ? 'Placement officer' : 'Consulting company';
                jobData.location.coordinates = [checkPa.employeeInformation.location.coordinates[0], checkPa.employeeInformation.location.coordinates[1]];
                jobData.displayLocation.coordinates = [[checkPa.employeeInformation.location.coordinates[0], checkPa.employeeInformation.location.coordinates[1]]];
                jobData.numberOfPositions = 1;
                jobData.isVisible = false;
                jobData.userId = mongoose.Types.ObjectId(checkPa._id);
                jobData.categoryId = mongoose.Types.ObjectId(category._id);

                try {
                    await jobData.save();
                } catch (e) {
                    logger.error('Error occurred while saving job data in upload members pa admin handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            }
        }
    }

    /* Update upload data */
    try {
        await uploadHistorySchema.uploadHistory.findByIdAndUpdate({_id: uploadData._id}, {$set: {uploadCount: paCount, errorCount: totalCount - paCount, status: 'Complete'}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while upload history details in uploadEmployers handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter({}, 'Uploaded successfully', 'success', 200)).code(200);
};

paAdminHandler.manualUploadMembers = async (request, h) => {
    let checkUser, decoded, category, jobData;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in upload members data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in upload members data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    let checkPa;

    /* Search whether this user is already present in the database or not */
    try {
        checkPa = await userSchema.UserSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in upload members PA admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    /*&& (checkPa.paId.toString() === checkUser._id.toString())*/
    if (checkPa) {
        return h.response(responseFormatter.responseFormatter({}, 'User already exists.', 'error', 409)).code(409);
    }

    if (!checkPa) {

        if (checkUser.companyEmailRequired) {
            const check = request.payload.email.split('@');
            const domain = commonFunctions.Handlers.getDomain(checkUser.employerInformation.website);
            if (check[1].toLowerCase() !== domain.toLowerCase()) {
                return h.response(responseFormatter.responseFormatter({}, 'Please use email address of your organization\'s domain.', 'error', 400)).code(400);
            }
        }

        const tempPassword = commonFunctions.Handlers.generatePassword();
        let dataToSave = {
            firstName: request.payload.firstName,
            lastName: request.payload.lastName ? request.payload.lastName : '',
            email: request.payload.email,
            roles: ['Employer'],
            'employerInformation.companyLocation': checkUser.employerInformation.companyLocation,
            'employeeInformation.location': checkUser.employerInformation.companyLocation,
            'employeeInformation.country': checkUser.country,
            'employerInformation.country': checkUser.country,
            country: checkUser.country,
            'employerInformation.countryCode': request.payload.countryCode ? request.payload.countryCode : '',
            'employerInformation.companyPhone': request.payload.phone ? request.payload.phone : '',
            'employerInformation.companyName': request.payload.companyName,
            'employerInformation.chapter': request.payload.chapter,
            'employerInformation.region': request.payload.region,
            isPa: true,
            tempPassword: tempPassword,
            password: tempPassword,
            hasInstalled: false,
            hasOwned: false,
            isPaEmployer: false,
            membership: checkUser.membership,
            isUniversity: !!checkUser.isUniversity,
            isConsulting: !!checkUser.isConsulting,
            isNonProfit: !!checkUser.isNonProfit,
            isTraining: !!checkUser.isTraining,
            isOrganization: true,
            isIndividual: false,
            paId: mongoose.Types.ObjectId(checkUser._id),
            referralCode: commonFunctions.Handlers.generateReferralCode(request.payload.firstName),
            memberType: request.payload.memberType ? request.payload.memberType : ''
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

        /* Assign default language */
        let language;
        try {
            language = await languageSchema.languageSchema.findOne({language: 'en', country: checkUser.country}, {_id: 1, name: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding language data in upload members PA admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (language) {
            dataToSave.appLanguage = language._id;
            dataToSave.chatLanguage = language._id;
        }

        /* Create free subscription for this users */
        let checkPackage;
        try {
            checkPackage = await packageSchema.packageSchema.findOne({isFree: true, country: checkUser.country, isActive: true}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in finding package in upload members PA admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (checkPackage) {
            dataToSave.subscriptionInfo = {packageId: checkPackage._id};
            /* Create free subscription & Check whether plan exists */
            let subscriptionData, packageId;

            try {
                packageId = await packageSchema.packageSchema.findOne({country: checkUser.country, isFree: true, isActive: true}, {_id: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while fetching package id in upload members PA admin handler %s:', JSON.stringify(e));
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
                logger.error('Error occurred saving subscription information in upload members PA admin handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            dataToSave.subscriptionInfo['subscriptionId'] = subscriptionData._id;
        }

        const saveData = new userSchema.UserSchema(dataToSave);
        try {
            await saveData.save();
        } catch (e) {
            logger.error('Error occurred saving user in upload members PA admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Get category for saving it into job */
        try {
            category = await categorySchema.categorySchema.findOne({isActive: true, categoryName: 'Others'}, {_id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding category in upload members pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Create default PA config*/
        const configToSave = {
            paId: saveData._id,
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
        jobData.jobTitle = checkUser.isUniversity ? 'Placement officer' : 'Consulting company';
        jobData.location.coordinates = [saveData.employeeInformation.location.coordinates[0], saveData.employeeInformation.location.coordinates[1]];
        jobData.displayLocation.coordinates = [[saveData.employeeInformation.location.coordinates[0], saveData.employeeInformation.location.coordinates[1]]];
        jobData.numberOfPositions = 1;
        jobData.isVisible = false;
        jobData.userId = mongoose.Types.ObjectId(saveData._id);
        jobData.categoryId = mongoose.Types.ObjectId(category._id);

        try {
            await jobData.save();
        } catch (e) {
            logger.error('Error occurred while saving job data in upload members pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Add this user to the exposed list */
        let bulk = jobSchema.jobSchema.collection.initializeUnorderedBulkOp();
        bulk
            .find({isExposedToCommunity: true, membership: checkUser.membership.toString()})
            .update({$push: {exposedTo: saveData._id}});
        try {
            await bulk.execute();
        } catch (e) {
            logger.error('Error occurred while pushing exposed data in upload members pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

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
                    subject: checkUser.firstName + ' is inviting you to join them on EZJobs',
                    merge_language: 'mailchimp',
                    merge_vars: [{
                        rcpt: dataToSave.email,
                        vars: [
                            {
                                name: 'fname',
                                content: dataToSave.firstName.trim() + ' ' + dataToSave.lastName.trim()
                            },
                            {
                                name: 'adminName',
                                content: (checkUser.firstName + ' ' + checkUser.lastName).trim()
                            },
                            {
                                name: 'community',
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
                                name: 'url',
                                content: 'https://pa.ezjobs.io'
                            }
                        ]
                    }]
                };
                /*await mandrill.Handlers.sendTemplate('invitation-mail-to-employers-ezpa', [], email, true);*/
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
                    logger.error('Error occurred while updating user details in uploadEmployers handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            } catch (e) {
                logger.error('Error in sending app download link to user %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    } else {
        try {
            await userSchema.UserSchema.findOneAndUpdate({email: checkPa.email}, {$addToSet: {additionalMemberships: checkUser.membership}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating user details for additional memberships in uploadEmployers handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    return h.response(responseFormatter.responseFormatter({}, 'Uploaded successfully', 'success', 200)).code(200);
};

paAdminHandler.getRegions = async (request, h) => {
    let checkUser, decoded, regions;

    /* Check if user is actually who is trying to utilize the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get regions data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get regions data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists', 'error', 404)).code(404);
    } else if (!checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action.', 'error', 400)).code(400);
    }

    /* Get regions data */
    try {
        regions = await regionSchema.regionSchema.find({userId: checkUser.isMaster ? mongoose.Types.ObjectId(request.query.userId) : mongoose.Types.ObjectId(checkUser.paId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting regions in get regions data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(regions, 'Fetched successfully.', 'success', 200)).code(200);
};

paAdminHandler.getChapters = async (request, h) => {
    let checkUser, decoded, chapters;

    /* Check if user is actually who is trying to utilize the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get chapters data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get chapters data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists', 'error', 404)).code(404);
    } else if (!checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action.', 'error', 400)).code(400);
    }

    /* Get chapters data */
    try {
        chapters = await chapterSchema.chapterSchema.find({userId: checkUser.isMaster ? mongoose.Types.ObjectId(request.query.userId) : mongoose.Types.ObjectId(checkUser.paId)}, {}, {lean: true}).populate('region', 'name');
    } catch (e) {
        logger.error('Error occurred while getting regions in get regions chapters pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(chapters, 'Fetched successfully.', 'success', 200)).code(200);
};

paAdminHandler.updateRegion = async (request, h) => {
    let checkUser, decoded, adminUser;

    /* Check if user is actually who is trying to utilize the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update regions pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in update regions pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists', 'error', 404)).code(404);
    } else if (!checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action.', 'error', 400)).code(400);
    }

    if (!checkUser.isMaster) {
        try {
            adminUser = await userSchema.UserSchema.findOne({membership: checkUser.membership, isPaAdmin: true, isMaster: true}, {_id: 1}, {lean: true})
        } catch (e) {
            logger.error('Error occurred while finding admin user in update regions data pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (adminUser) {
            request.payload.userId = adminUser._id;
        }
    }

    /* Add/Update region data */
    if (request.payload.isNew) {
        try {
            await new regionSchema.regionSchema(request.payload).save();
        } catch (e) {
            logger.error('Error occurred while saving region in update regions pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.payload.isDelete) {
        let checkRegion, checkUserRegion;

        /* Check if this region is used in chapters */
        try {
            checkRegion = await chapterSchema.chapterSchema.findOne({region: mongoose.Types.ObjectId(request.payload.regionId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding region in update regions pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (checkRegion) {
            return h.response(responseFormatter.responseFormatter({}, 'You can not remove this region as it is associated with one or more chapters.', 'error', 400)).code(400);
        }

        /* Check if this region is associated with any user */
        try {
            checkUserRegion = await userSchema.UserSchema.findOne({'employerInformation.region': mongoose.Types.ObjectId(request.payload.regionId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding user having region in update regions pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (checkUserRegion) {
            return h.response(responseFormatter.responseFormatter({}, 'You can not remove this region as it is associated with one or more member(s) or user(s).', 'error', 400)).code(400);
        }

        try {
            await regionSchema.regionSchema.findByIdAndDelete({_id: request.payload.regionId});
        } catch (e) {
            logger.error('Error occurred while deleting region in update regions pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        try {
            await regionSchema.regionSchema.findByIdAndUpdate({_id: request.payload.regionId}, {$set: {name: request.payload.name}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating region in update regions pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, request.payload.isNew ? 'Added successfully.' : 'Updated successfully.', 'success', request.payload.isNew ? 201 : 204)).code(request.payload.isNew ? 201 : 200);
};

paAdminHandler.updateChapter = async (request, h) => {
    let checkUser, decoded, adminUser;

    /* Check if user is actually who is trying to utilize the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update chapters pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in update chapters pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists', 'error', 404)).code(404);
    } else if (!checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action.', 'error', 400)).code(400);
    }

    if (!checkUser.isMaster) {
        try {
            adminUser = await userSchema.UserSchema.findOne({membership: checkUser.membership, isPaAdmin: true, isMaster: true}, {_id: 1}, {lean: true})
        } catch (e) {
            logger.error('Error occurred while finding admin user in update chapters data pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (adminUser) {
            request.payload.userId = adminUser._id;
        }
    }

    /* Add/Update region data */
    if (request.payload.isNew) {
        try {
            await new chapterSchema.chapterSchema(request.payload).save();
        } catch (e) {
            logger.error('Error occurred while saving chapter in update chapters pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else if (request.payload.isDelete) {
        let checkUserChapter;

        /* Check if this chapter is associated with any user */
        try {
            checkUserChapter = await userSchema.UserSchema.findOne({'employerInformation.chapter': mongoose.Types.ObjectId(request.payload.chapterId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding user having chapter in update chapters pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (checkUserChapter) {
            return h.response(responseFormatter.responseFormatter({}, 'You can not remove this chapter as it is associated with one or more member(s) or user(s).', 'error', 400)).code(400);
        }
        try {
            await chapterSchema.chapterSchema.findByIdAndDelete({_id: request.payload.chapterId});
        } catch (e) {
            logger.error('Error occurred while deleting region in update chapters pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        try {
            await chapterSchema.chapterSchema.findByIdAndUpdate({_id: request.payload.chapterId}, {$set: {name: request.payload.name, region: mongoose.Types.ObjectId(request.payload.region)}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating chapter in update chapters pa admin handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, request.payload.isNew ? 'Added successfully.' : 'Updated successfully.', 'success', request.payload.isNew ? 201 : 204)).code(request.payload.isNew ? 201 : 200);
};

paAdminHandler.addUser = async (request, h) => {
    let checkPaAdmin, checkUser, decoded, user;

    /* Check if PA exists */
    try {
        checkPaAdmin = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding pa in add user pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found.', 'error', 404)).code(404);
    } else if (!checkPaAdmin.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user is actually who is trying to access the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in add user pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if the user with the given email already exists */
    try {
        checkUser = await userSchema.UserSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in add user pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User already exists.', 'error', 409)).code(409);
    }

    if (checkPaAdmin.companyEmailRequired) {
        const check = request.payload.email.split('@');
        const domain = commonFunctions.Handlers.getDomain(checkPaAdmin.employerInformation.website);
        if (check[1].toLowerCase() !== domain.toLowerCase()) {
            return h.response(responseFormatter.responseFormatter({}, 'Please use email address of your organization\'s domain.', 'error', 400)).code(400);
        }
    }

    /* Create user and save it into database */
    user = new userSchema.UserSchema(request.payload);
    user.employerInformation = checkPaAdmin.employerInformation;
    user.roles = checkPaAdmin.roles;
    user.password = commonFunctions.Handlers.generatePassword();
    user.tempPassword = user.password;
    user.referralCode = commonFunctions.Handlers.generateReferralCode(request.payload.firstName);
    user.employeeInformation.location = user.employerInformation.companyLocation;
    user.employeeInformation.preferredLocations = {
        type: 'MultiPoint',
        coordinates: [user.employerInformation.companyLocation.coordinates]
    }
    user.employerInformation.countryCode = request.payload.countryCode ? request.payload.countryCode : '';
    user.employerInformation.companyPhone = request.payload.phone ? request.payload.phone : '';
    user.isMaster = false;
    user.isSlave = true;
    user.isPa = false;
    user.isPaAdmin = true;
    user.paId = mongoose.Types.ObjectId(request.payload.userId);
    user.membership = checkPaAdmin.membership;
    user.isConsulting = !!checkPaAdmin.isConsulting;
    user.isUniversity = !!checkPaAdmin.isUniversity;
    user.isNonProfit = !!checkPaAdmin.isNonProfit;
    user.isTraining = !!checkPaAdmin.isTraining;
    user.isOrganization = !!checkPaAdmin.isOrganization;
    user.isTraining = !!checkPaAdmin.isTraining;
    user.isIndividual = false;
    user.employerInformation.designation = request.payload.designation;
    user.companyEmailRequired = checkPaAdmin.companyEmailRequired;
    user.phone = '';
    if (request.payload.chapter) {
        user.employerInformation.chapter = mongoose.Types.ObjectId(request.payload.chapter);
    }
    if (request.payload.region) {
        user.employerInformation.region = mongoose.Types.ObjectId(request.payload.region);
    }
    if (request.payload.address) {
        user.employerInformation.companyAddress = request.payload.address;
    }

    let email = {
        to: [{
            email: request.payload.email,
            type: 'to'
        }],
        subject: checkPaAdmin.firstName + ' ' + checkPaAdmin.lastName + ' has invited you to join them in EZJobs CA',
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
                    name: 'community',
                    content: checkPaAdmin.employerInformation.companyName
                },
                {
                    name: 'adminName',
                    content: (checkPaAdmin.firstName + ' ' + checkPaAdmin.lastName).trim()
                },
                {
                    name: 'email',
                    content: request.payload.email
                },
                {
                    name: 'url',
                    content: 'https://ca.ezjobs.io'
                }
            ]
        }]
    };

    try {
        /*await mandrill.Handlers.sendTemplate('admin-invitation-to-co-admins-ezca', [], email, true);*/
        if (process.env.NODE_ENV === 'production') {
            if (checkPaAdmin.membership.toString() === '601b296b1518584fb3e1d52e') {
                await mandrill.Handlers.sendTemplate('tie-champions', [], email, true);
            } else if (checkPaAdmin.membership.toString() === '611aa6d519add1146d831b72') {
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

    try {
        await user.save();
    } catch (e) {
        logger.error('Error occurred while saving user in add user pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update master account user */
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$push: {slaveUsers: user._id}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating user in add user pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(user, 'User added successfully', 'success', 201)).code(200);
};

paAdminHandler.updateUser = async (request, h) => {
    let checkPaAdmin, checkUser, decoded, updateCriteria = {};

    /* Check if PA exists */
    try {
        checkPaAdmin = await userSchema.UserSchema.findById({_id: request.payload.adminId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding pa in update user pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found.', 'error', 404)).code(404);
    } else if (!checkPaAdmin.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user is actually who is trying to access the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update user pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.adminId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if the user with the given email already exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in update user pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found.', 'error', 404)).code(404);
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
        if (checkUser.employerInformation.companyPhone !== request.payload.phone) {
            updateCriteria['employerInformation.companyPhone'] = request.payload.phone;
            updateCriteria['employerInformation.countryCode'] = request.payload.countryCode;
        }
        updateCriteria['isActive'] = !!request.payload.isActive;
        updateCriteria['employerInformation.region'] = request.payload.region;
        updateCriteria['employerInformation.chapter'] = request.payload.chapter;
        updateCriteria['employerInformation.designation'] = request.payload.designation;
        updateCriteria['employerInformation.companyAddress'] = request.payload.address;
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

paAdminHandler.getUsers = async (request, h) => {
    let checkPaAdmin, decoded, users;

    /* Check if PA exists */
    try {
        checkPaAdmin = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding pa in get users pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found.', 'error', 404)).code(404);
    } else if (!checkPaAdmin.isPaAdmin || checkPaAdmin.isSlave) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check if user is actually who is trying to access the API */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get users pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Get the added users */
    let aggregationCriteria = [];

    aggregationCriteria.push({
        $match: {
            paId: mongoose.Types.ObjectId(request.query.userId),
            isPaAdmin: true
        }
    });

    /* If search text is provided */
    if (request.query.searchText) {
        aggregationCriteria.push({$match: {$or : [{firstName: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {lastName: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')},
                    {email: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}]}});
    }

    /* If region is provided */
    if (request.query.region) {
        aggregationCriteria.push({
            $match: {
                'employerInformation.region': mongoose.Types.ObjectId(request.query.region)
            }
        });
    }

    /* If chapter is provided */
    if (request.query.chapter) {
        aggregationCriteria.push({
            $match: {
                'employerInformation.chapter': mongoose.Types.ObjectId(request.query.chapter)
            }
        });
    }

    aggregationCriteria.push({
        $skip: request.query.skip
    });

    aggregationCriteria.push({
        $limit: request.query.limit
    });

    /* Chapter and Region lookups */
    aggregationCriteria.push({
        $lookup: {
            from: 'Region',
            localField: 'employerInformation.region',
            foreignField: '_id',
            as: 'region'
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
            path: '$region',
            preserveNullAndEmptyArrays: true
        }
    });
    aggregationCriteria.push({
        $unwind: {
            path: '$chapter',
            preserveNullAndEmptyArrays: true
        }
    });

    /* Fields projection */
    aggregationCriteria.push({
        $project: {
            firstName: 1,
            lastName: 1,
            email: 1,
            countryCode: '$employerInformation.countryCode',
            phone: '$employerInformation.companyPhone',
            designation: '$employerInformation.designation',
            isActive: 1,
            regionName: '$region.name',
            regionId: '$region._id',
            chapterName: '$chapter.name',
            chapterId: '$chapter._id',
            address: '$employerInformation.companyAddress'
        }
    });

    try {
        users = await userSchema.UserSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred while aggregating users in get users pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(users, 'Fetched successfully.', 'success', 200)).code(200);
};

paAdminHandler.getUploadHistory = async (request, h) => {
    let checkUser, decoded, history;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in upload history data pa admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in upload history data p admin handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Get history data */
    try {
        history = await uploadHistorySchema.uploadHistory.find({paId: mongoose.Types.ObjectId(request.query.userId), isAdmin: true}, {}, {lean: true}).sort({createdAt: -1}).populate('paId', 'firstName lastName');
    } catch (e) {
        logger.error('Error occurred while finding history data in upload history data handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(history, 'Fetched successfully', 'success', 200)).code(200);
};

paAdminHandler.changeStatus = async (request, h) => {
    let checkUser, checkMembers, userIds = [];

    request.payload.userIds = request.payload.userIds.map(k => mongoose.Types.ObjectId(k));

    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user data in change status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists.', 'error', 404)).code(404);
    } else if (!checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized.', 'error', 401)).code(401);
    }

    /* Check if this admin is master user or not */
    if (checkUser.isMaster) {
        checkUser.slaveUsers.push(mongoose.Types.ObjectId(checkUser._id));
        userIds = checkUser.slaveUsers;
    } else {
        let parent;
        /* Get parent account */
        try {
            parent = await userSchema.UserSchema.findOne({membership: checkUser.membership, isPaAdmin: true, isMaster: true}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding parent user data in change status handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!parent) {
            return h.response(responseFormatter.responseFormatter({}, 'Something went wrong. Please contact support.', 'error', 400)).code(400);
        } else {
            parent.slaveUsers.push(mongoose.Types.ObjectId(checkUser._id));
            userIds = parent.slaveUsers;
        }
    }

    /* Get list of members */
    try {
        checkMembers = await userSchema.UserSchema.find({_id: {$in: request.payload.userIds}, paId: {$in: userIds}}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding members data in change status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    const len = checkMembers.length;
    let users = [];
    for (let i = 0; i < len; i++) {
        users.push(checkMembers[i]._id);
        users = users.concat(checkMembers[i].slaveUsers);
    }
    users = users.map(k => mongoose.Types.ObjectId(k));

    /* Activate / Deactivate all the users */
    let bulk = userSchema.UserSchema.collection.initializeUnorderedBulkOp();
    bulk
        .find({_id: {$in: users}})
        .update({$set: {isActive: request.payload.isActive}});
    try {
        await bulk.execute();
    } catch (e) {
        logger.error('Error occurred while updating members data in change status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Success.', 'success', 204)).code(200);
};

paAdminHandler.resendInvitation = async (request, h) => {
    let checkUser, checkMembers, userIds = [];

    request.payload.userIds = request.payload.userIds.map(k => mongoose.Types.ObjectId(k));

    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user data in resend invitation handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User does not exists.', 'error', 404)).code(404);
    } else if (!checkUser.isPaAdmin && !checkUser.isPa) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized.', 'error', 401)).code(401);
    }

    /* Check if this admin is master user or not */
    if (checkUser.isMaster) {
        checkUser.slaveUsers.push(mongoose.Types.ObjectId(checkUser._id));
        userIds = checkUser.slaveUsers;
    } else {
        let parent;
        /* Get parent account */
        try {
            parent = await userSchema.UserSchema.findOne({membership: checkUser.membership, isPaAdmin: true, isMaster: true}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding parent user data in resend invitation handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!parent) {
            return h.response(responseFormatter.responseFormatter({}, 'Something went wrong. Please contact support.', 'error', 400)).code(400);
        } else {
            parent.slaveUsers.push(mongoose.Types.ObjectId(checkUser._id));
            userIds = parent.slaveUsers;
        }
    }

    if (request.payload.isMember) {
        /* Get list of members */
        try {
            checkMembers = await userSchema.UserSchema.find({_id: {$in: request.payload.userIds}}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding members data in resend invitation handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        /* Get list of users */
        try {
            checkMembers = await userSchema.UserSchema.find({_id: {$in: request.payload.userIds}, paId: mongoose.Types.ObjectId(request.payload.paId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding users data in resend invitation handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Send emails for invitation */
    if (request.payload.isMember) {
        for (let i = 0; i < checkMembers.length; i++) {
            try {
                /* Create dynamic link */
                const shortLink = await commonFunctions.Handlers.createFirebaseShortLink(checkMembers[i].email, '', '');
                let email = {
                    to: [{
                        email: checkMembers[i].email,
                        type: 'to'
                    }],
                    important: true,
                    merge: true,
                    inline_css: true,
                    subject: checkUser.firstName + ' is inviting you to join them on EZJobs',
                    merge_language: 'mailchimp',
                    merge_vars: [{
                        rcpt: checkMembers[i].email,
                        vars: [
                            {
                                name: 'fname',
                                content: checkMembers[i].firstName.trim() + ' ' + checkMembers[i].lastName.trim()
                            },
                            {
                                name: 'adminName',
                                content: (checkUser.firstName + ' ' + checkUser.lastName).trim()
                            },
                            {
                                name: 'community',
                                content: checkUser.employerInformation.companyName
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
                                name: 'url',
                                content: 'https://pa.ezjobs.io'
                            }
                        ]
                    }]
                };
                /*await mandrill.Handlers.sendTemplate('invitation-mail-to-employers-ezpa', [], email, true);*/
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
            let email = {
                to: [{
                    email: checkMembers[i].email,
                    type: 'to'
                }],
                subject: checkUser.firstName + ' has invited you to join them in EZJobs CA',
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
                            content: checkMembers[i].firstName.trim() + ' ' + checkMembers[i].lastName.trim()
                        },
                        {
                            name: 'community',
                            content: checkUser.employerInformation.companyName
                        },
                        {
                            name: 'adminName',
                            content: (checkUser.firstName + ' ' + checkUser.lastName).trim()
                        },
                        {
                            name: 'email',
                            content: checkMembers[i].email
                        },
                        {
                            name: 'url',
                            content: 'https://ca.ezjobs.io'
                        }
                    ]
                }]
            };

            try {
                /*await mandrill.Handlers.sendTemplate('admin-invitation-to-co-admins-ezca', [], email, true);*/
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
            } catch (e) {
                logger.error('Error occurred while sending email in add user handler %s:', JSON.stringify(e));
            }

        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Invited successfully.', 'success', 200)).code(200);
};

paAdminHandler.sendMessage = async (request, h) => {
    let checkUser, decoded, checkJob, mailServer;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.paId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in send message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in send message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.paId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Get mail server data */
    try {
        mailServer = await mailServerSchema.mailServerSchema.findOne({userId: mongoose.Types.ObjectId(request.payload.paId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding mail server in send message handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send the message to the members */
    if (request.payload.isEmail) {
        if (!request.payload.subject) {
            return h.response(responseFormatter.responseFormatter({}, 'Subject is required for sending emails', 'error', 400)).code(400);
        }
    }

    const len = request.payload.memberIds.length;
    for (let i = 0; i < len; i++) {
        let memberData;

        /* Fetch candidate data */
        try {
            memberData = await userSchema.UserSchema.findById({_id: request.payload.memberIds[i]}, {paId: 1, deviceToken: 1, deviceType: 1, email: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding candidate in send message handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Check if PA is associated with the given candidate */
        if (!memberData) {
            return h.response(responseFormatter.responseFormatter({}, 'You can not send message to this member as he/she is not associated with your account.', 'error', 400)).code(400);
        }

        let status;
        if (!request.payload.password) {
            try {
                status = await commonFunctions.Handlers.nodeMailerEZJobs('support@ezjobs.io', request.payload.subject, request.payload.body, memberData.email);
            } catch (e) {
                logger.error('Error in sending email to members while sending message %s:', e);
            }
        } else {
            let sender = checkUser.employerInformation.companyName + ' <' + mailServer.email + '>';
            const mailOptions = {
                from: sender,
                to: memberData.email,
                subject: request.payload.subject,
                text: request.payload.body
            };
            try {
                status = await nodeMailer.createTransport({
                    host: mailServer.host,
                    port: mailServer.port,
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

    return h.response(responseFormatter.responseFormatter({}, 'Message sent successfully.', 'success', 200)).code(200);
};

paAdminHandler.getMenus = async (request, h) => {
    let checkUser, decoded, menus;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get menus handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get menus handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    let platform = checkUser.isPaAdmin ? 'CA' : (checkUser.isPa ? 'PA' : '');
    let type = checkUser.isUniversity ? 'University' : (checkUser.isConsulting ? 'Consulting' : (checkUser.isNonProfit ? 'Non-profit': (checkUser.isTraining ? 'Training' : '')));

    const searchCriteria = {
        type: type,
        platform: platform
    };

    try {
        menus = await menuConfigSchema.menuConfigSchema.findOne(searchCriteria, {}, {lean: true});
    } catch (e) {
        logger.error('Error in finding menus in get menus handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred.', 'error', 500)).code(500);
    }

    if (platform === 'PA' && checkUser.isIndividual) {
        if (menus) {
            const idx = menus.menus.findIndex(k => k.key === 'network');
            if (idx !== -1) {
                const idxSubMenu = menus.menus[idx].subMenus.findIndex(k => k.key === 'partnerNetwork');
                if (idxSubMenu !== -1) {
                    menus.menus[idx].subMenus.splice(idxSubMenu, 1);
                }
            }
        }
    }

    return h.response(responseFormatter.responseFormatter(menus, 'Fetched successfully.', 'success', 200)).code(200);
};

paAdminHandler.getLabels = async (request, h) => {
    let checkUser, decoded, labels;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get labels handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get labels handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    let platform = checkUser.isPaAdmin ? 'CA' : (checkUser.isPa ? 'PA' : '');
    let type = checkUser.isUniversity ? 'University' : (checkUser.isConsulting ? 'Consulting' : (checkUser.isNonProfit ? 'Non-profit': checkUser.isTraining ? 'Training': ''));

    const searchCriteria = {
        type: type,
        platform: platform
    };

    try {
        labels = await labelConfigSchema.labelConfigSchema.find(searchCriteria, {}, {lean: true});
    } catch (e) {
        logger.error('Error in finding menus in get menus handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred.', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter(labels, 'Fetched successfully.', 'success', 200)).code(200);
};

paAdminHandler.getAllCandidates = async (request, h) => {
    let checkUser, decoded, candidates;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get all candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get all candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Get candidates */
    checkUser.additionalMemberships.push(mongoose.Types.ObjectId(checkUser.membership));
    let allMemberships = checkUser.additionalMemberships, allMembershipsString = checkUser.membership;
    try {
        candidates = await userSchema.UserSchema.aggregate([
            {
                $match: {
                    $or: [{membership: allMembershipsString}, {additionalMemberships: {$in: allMemberships}}],
                    isPaAdmin: false,
                    isPa: true
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
                    from: "User",
                    let: { userId: "$_id" },
                    pipeline : [
                        { $match: { $expr: { $and: [{ $eq: [ "$paId", "$$userId" ] }, { $eq: [ "$isPa", false ] }] } }, },
                        { $project : { _id: 1, firstName: 1, lastName: 1, views: {$size: '$employeeInformation.uniqueViews'}, searchAppearances: '$employeeInformation.searchAppearances', profilePhoto: '$employeeInformation.profilePhoto', appDownloaded: '$hasOwned', description: '$employeeInformation.description', resume: '$employeeInformation.resume', profileCompleted: '$employeeInformation.isComplete', } }
                    ],
                    as: "candidates"
                }
            },
            {
                $project: {
                    firstName: 1,
                    lastName: 1,
                    companyName: '$employerInformation.companyName',
                    companyLogo: '$employeeInformation.profilePhoto',
                    email: 1,
                    companyPhone: '$employerInformation.companyPhone',
                    candidates: 1
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred while aggregating users in get all candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(candidates, 'Fetched successfully.', 'success', 200)).code(200);
};

paAdminHandler.updateMember = async (request, h) => {
    let checkUser, decoded, checkMember;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in update member handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update member handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check member */
    try {
        checkMember = await userSchema.UserSchema.findById({_id: request.payload.memberId}, {membership: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding member in update member handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkMember) {
        return h.response(responseFormatter.responseFormatter({}, 'No such member.', 'error', 404)).code(404);
    } else if (checkMember.membership !== checkUser.membership) {
        return h.response(responseFormatter.responseFormatter({}, 'This member is not associated with your account. Either other user has invited this member.', 'error', 400)).code(400);
    }

    /* Update user */
    try {
        await userSchema.UserSchema.findOneAndUpdate({_id: request.payload.memberId}, {$set: {memberType: request.payload.memberType}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating member in update member handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully.', 'success', 204)).code(200);
};

paAdminHandler.updateMemberType = async (request, h) => {
    let checkUser, decoded, checkConfig;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in update member type handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update member type handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check config for PA */
    const userIdToCheck = checkUser.isMaster ? checkUser._id : checkUser.paId;
    try {
        checkConfig = await paConfigSchema.paConfigSchema.findOne({paId: userIdToCheck}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding config in update member type handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkConfig) {
        const dataToSave = {
            paId: userIdToCheck,
            memberTypes: request.payload.memberTypes
        };
        try {
            await new paConfigSchema.paConfigSchema(dataToSave).save();
        } catch (e) {
            logger.error('Error occurred while saving config data in update member type handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        try {
            await paConfigSchema.paConfigSchema.findByIdAndUpdate({_id: checkConfig._id}, {$set: {memberTypes: request.payload.memberTypes}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding config in update member type handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Updated successfully.', 'success', 204)).code(200);
};

paAdminHandler.getMemberType = async (request, h) => {
    let checkUser, decoded, checkConfig;

    /* Check if user exists */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding user in get member type handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    } else if (!checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action.', 'error', 400)).code(400);
    }

    /* Check if user is actually who is trying to change the password */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get member type handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== request.query.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Unauthorized', 'error', 401)).code(401);
    }

    /* Check config for PA */
    const userIdToCheck = checkUser.isMaster ? checkUser._id : checkUser.paId;
    try {
        checkConfig = await paConfigSchema.paConfigSchema.findOne({paId: userIdToCheck}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding config in get member type handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(checkConfig ? checkConfig : {}, 'Fetched successfully.', 'success', 200)).code(200);
};

module.exports = {
    Handlers: paAdminHandler
};
