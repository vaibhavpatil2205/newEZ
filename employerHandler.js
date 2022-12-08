'use strict';

const userSchema = require('../schema/userSchema');
const logger = require('../utils/logger');
const mongoose = require('mongoose');
const responseFormatter = require('../utils/responseFormatter');
const commonFunctions = require('../utils/commonFunctions');
const jobSchema = require('../schema/jobSchema');
const push = require('../utils/push');
const moment = require('moment');
const adminSchema = require('../schema/adminSchema');
const notificationSchema = require('../schema/notificationSchema');
const searchSchema = require('../schema/searchSchema');
const conversationSchema = require('../schema/conversationSchema');
const favouriteCandidateSchema = require('../schema/favouriteCandidateSchema');
const favouriteSchema = require('../schema/favouriteSchema');
const searchSuggestionSchema = require('../schema/searchSuggestionSchema');
const weightSchema = require('../schema/weightageSchema');
const constantSchema = require('../schema/constantSchema');
const mandrill = require('../utils/mandrill');
const pluralize = require('pluralize');
const minMaxSalarySchema = require('../schema/minMaxSalarySchema');
const pricingSchema = require('../schema/pricingSchema');
const subscriptionSchema = require('../schema/subscriptionSchema');
const packageSchema = require('../schema/packageSchema');
const citySchema = require('../schema/citiesSchema');
const languageSchema = require('../schema/languageSchema');
const aes256 = require('aes256');
const key = require('../config/aesSecretKey').key;
const tokenSchema = require('../schema/authToken');
const groupSchema = require('../schema/groupSchema');
const codeSchema = require('../schema/codeSchema');
const promoSchema = require('../schema/promoCodeSchema');
const rzrPay = require('../utils/paymentGatewayRzrpy');
const countryList = require('country-list');
const subscriptionRenewalSchema = require('../schema/subscriptionRenewal');
const dynamicFieldsSchema = require('../schema/dynamicFieldsSchema');
const verificationFields = require('../schema/verificationFields');
const companyVerificationSchema = require('../schema/companyVerificationSchema');
const atsSchema = require('../schema/atsSchema');
const internalParameterSchema = require('../schema/internalParameterSchema');
const viewsSchema = require("../schema/viewsSchema");
const fs = require('fs');
const path = require('path');
const zoneSchema = require("../schema/zoneSchema");
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

let employerHandler = {};

employerHandler.updateProfile = async (request, h) => {
    let checkUser, decoded, dataToUpdate, imageName, status, updatedUser, flag = false, hubSpotProperties = [], constantData;

    /* Check whether user exists in database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.userId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user data in update company profile handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    } else if (checkUser.isAddedByBulkUpload) {
        flag = true;
    }

    /* Check if user is the same who is trying to update location */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update company profile handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    if (checkUser.isSlave) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not update company profile. Please contact your account administrator.', 'error', 400)).code(400);
    }

    /* Get constant data */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {businessTypes: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching constant data in update company profile handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* If company profile photo is there upload it to s3 bucket */
    if (request.payload.companyProfilePhoto) {
        /* If profile photo is changed delete old one and update new one */
        if (checkUser.employerInformation.companyProfilePhoto) {
            try {
                status = await commonFunctions.Handlers.deleteImage(checkUser.employerInformation.companyProfilePhoto);
            } catch (e) {
                logger.error('Error occurred while deleting user image in update company profile handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (!status) {
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred while deleting profile photo', 'error', 500)).code(500);
            }
        }

        try {
            imageName = await commonFunctions.Handlers.uploadImage(request.payload.companyProfilePhoto.path, request.payload.companyProfilePhoto.filename);
        } catch (e) {
            logger.error('Error occurred while uploading user image in update company profile handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

/*    if (checkUser.employerInformation.panVerified) {
        if (checkUser.employerInformation.companyName !== request.payload.companyName) {
            return h.response(responseFormatter.responseFormatter({}, 'Can not update company name.', 'error', 400)).code(400);
        } else if (checkUser.employerInformation.companyType.toString() !== request.payload.companyType) {
            return h.response(responseFormatter.responseFormatter({}, 'Can not update company type.', 'error', 400)).code(400);
        }
    }*/


    /* Update employer data */
    dataToUpdate = {
        'employerInformation.companyAddress': request.payload.address,
        'employerInformation.country': request.payload.country,
        'employerInformation.companyLocation.coordinates': [Number(request.payload.longitude), Number(request.payload.latitude)],
        'employerInformation.companyPhone': request.payload.companyPhone ? request.payload.companyPhone : '',
        'employerInformation.countryCode': request.payload.countryCode ? request.payload.countryCode : '',
        'employerInformation.phoneVerified': checkUser.employerInformation.phoneVerified,
        'employerInformation.companyProfilePhoto': imageName ? imageName : checkUser.employerInformation.companyProfilePhoto,
        'employerInformation.companyDescription': request.payload.companyDescription ? request.payload.companyDescription : '',
        'employerInformation.isComplete': false,
        'employerInformation.bulkUploadProfileComplete': flag,
        'employerInformation.companyEmail': request.payload.companyEmail,
        'employerInformation.companyName': request.payload.companyName,
        'employerInformation.companyType': request.payload.companyType,
        'employerInformation.pan': request.payload.pan ? aes256.encrypt(key, request.payload.pan) : '',
        'employerInformation.website': request.payload.website ? request.payload.website : ''
    };

    if (checkUser.employerInformation.companyEmail) {
        if (checkUser.employerInformation.companyEmail !== request.payload.companyEmail) {
            dataToUpdate['employerInformation.companyEmailVerified'] = false;
        }
    }

    if (request.payload.countryCode && request.payload.companyPhone) {
        if (checkUser.employerInformation.countryCode && checkUser.employerInformation.companyPhone) {
            if ((checkUser.employerInformation.countryCode !== request.payload.countryCode) || (checkUser.employerInformation.companyPhone !== request.payload.companyPhone)) {
                dataToUpdate['employerInformation.phoneVerified'] = false;
                dataToUpdate['employerInformation.isComplete'] = false;
            }
        }
        hubSpotProperties.push({
            property: 'phone',
            value: request.payload.countryCode + request.payload.companyPhone
        });
    }

    /*if (request.payload.country === 'IN') {
        dataToUpdate["employerInformation.isComplete"] = !!dataToUpdate["employerInformation.companyName"] && !!dataToUpdate["employerInformation.companyAddress"].city && !!dataToUpdate["employerInformation.companyPhone"] && !!dataToUpdate['employerInformation.phoneVerified'];
    } else {
        dataToUpdate["employerInformation.isComplete"] = !!dataToUpdate["employerInformation.companyName"] && !!dataToUpdate["employerInformation.companyAddress"].city;
    }*/
    dataToUpdate["employerInformation.isComplete"] = !!dataToUpdate["employerInformation.companyName"] && !!dataToUpdate["employerInformation.companyAddress"].city && !!dataToUpdate["employerInformation.companyPhone"] && !!dataToUpdate['employerInformation.phoneVerified'];

    /* Update company profile data in slave accounts if any */
    if (checkUser.slaveUsers && checkUser.slaveUsers.length) {
        for (let i = 0; i < checkUser.slaveUsers.length; i++) {
            try {
                await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser.slaveUsers[i]}, {$set: dataToUpdate}, {
                    lean: true,
                    new: true
                });
            } catch (e) {
                logger.error('Error occurred while updating company information of slave users in update company profile handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }

    try {
        updatedUser = await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$set: dataToUpdate}, {lean: true, new: true}).populate('employerInformation.verificationData', 'status documentType documentNumber documents documentName');
    } catch (e) {
        logger.error('Error occurred while updating company information in update company profile handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (updatedUser.employerInformation.pan) {
        updatedUser.employerInformation.pan = aes256.decrypt(key, updatedUser.employerInformation.pan);
    }

    /* Get document type object */
    if (updatedUser.employerInformation.verificationData && updatedUser.employerInformation.verificationData.documentType) {
        let document;
        try {
            document = await verificationFields.verificationFields.findById({_id: updatedUser.employerInformation.verificationData.documentType}, {type: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting verification in update company profile handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (document) {
            updatedUser.employerInformation.verificationData.documentType = document;
        }
    }

    delete updatedUser.employeeInformation.card;

    if (request.payload.companyName) {
        hubSpotProperties.push({
            property: 'company',
            value: request.payload.companyName
        });
    }

    const idx = constantData.businessTypes.findIndex(k => k._id.toString() === request.payload.companyType);
    const dataToUpdateNew = {
        email: checkUser.email,
        companyName: request.payload.companyName,
        companyType: (idx === -1) ? '' : constantData.businessTypes[idx].name
    };

    if (request.payload.companyType) {
        hubSpotProperties.push({
            property: 'company_type',
            value: dataToUpdateNew.companyType
        });
    }

    /* Update hub spot contact */
    if (process.env.NODE_ENV === 'production') {
        if (hubSpotProperties.length) {
            let status = await commonFunctions.Handlers.updateHubSpotContact(checkUser.email, hubSpotProperties);
            if (status === 404) {
                console.log('HubSpot contact not found');
            }

            let statusEmployer = await commonFunctions.Handlers.updateHubSpotContactEmployer(checkUser.email, hubSpotProperties);
            if (statusEmployer === 404) {
                console.log('HubSpot contact not found');
            }
        }

        /*await commonFunctions.Handlers.updateMauticLeadCompany(dataToUpdateNew);*/
    }

    /* Update company profile for all the slave users */
    if (updatedUser.isMaster) {
        for (let i = 0; i < updatedUser.slaveUsers.length; i++) {
            try {
                await userSchema.UserSchema.findByIdAndUpdate({_id: updatedUser.slaveUsers[i]}, {$set: dataToUpdate}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while updating slave users company information in update company profile handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(updatedUser, 'Company information updated successfully', 'success', 204)).code(200);
};

employerHandler.createJob = async (request, h) => {
    let checkUser, decoded, dataToSave, dataToUpdate, constantData, postedJob, translatedJobIds = [], englishLanguage,
        zone;

    try {
        [checkUser, decoded, constantData, englishLanguage] = await Promise.all([
            userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.userId)}, {}, {lean: true}),
            commonFunctions.Handlers.decodeToken(request.auth.credentials.token),
            constantSchema.constantSchema.findOne({}, {}, {lean: true}),
            languageSchema.languageSchema.findOne({
                language: 'en',
                country: request.payload.country
            }, {_id: 1}, {lean: true})
        ]);
    } catch (e) {
        logger.error('Error occurred while performing parallel actions in create job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    } else if (checkUser.isPaAdmin) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action.', 'error', 400)).code(400);
    }

    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check for the subscription package */
    let subscriptionData, packageInfo;
    if (checkUser.subscriptionInfo && checkUser.subscriptionInfo.subscriptionId) {
        try {
            [subscriptionData, packageInfo] = await Promise.all([
                subscriptionSchema.subscriptionSchema.findById({_id: checkUser.subscriptionInfo.subscriptionId}, {}, {lean: true}),
                packageSchema.packageSchema.findById({_id: checkUser.subscriptionInfo.packageId}, {
                    country: 1,
                    isFree: 1
                }, {lean: true})
            ])
        } catch (e) {
            logger.error('Error occurred while performing parallel actions regarding subscription and package in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* If package is free then mark this job as free job posting */
        request.payload.isFree = !!packageInfo.isFree;

        if (!subscriptionData) {
            return h.response(responseFormatter.responseFormatter({}, 'Something went wrong. Please contact support.', 'error', 400)).code(400);
        } else if (!subscriptionData.isPaid) {
            return h.response(responseFormatter.responseFormatter({}, 'Please purchase any subscription.', 'error', 400)).code(400);
        } else if (subscriptionData.numberOfJobs.count < 1 && !subscriptionData.numberOfJobs.isUnlimited) {
            if (packageInfo.isFree) {
                return h.response(responseFormatter.responseFormatter({}, 'You do not have sufficient job posting left in your current package.', 'error', 400)).code(400);
            }/* else {
                request.payload.inQueue = true;
                request.payload.isVisible = false;
            }*/
            return h.response(responseFormatter.responseFormatter({}, 'You do not have sufficient job posting left in your current package.', 'error', 400)).code(400);
        } else if (subscriptionData) {
            if (request.payload.translatedLanguages && request.payload.translatedLanguages.length) {
                if (!subscriptionData.numberOfJobTranslations.isIncluded) {
                    return h.response(responseFormatter.responseFormatter({}, 'Your current package does not allow posting job in different language.', 'error', 400)).code(400);
                } else if (!subscriptionData.numberOfJobTranslations.isFree && !subscriptionData.numberOfJobTranslations.isUnlimited) {
                    if (subscriptionData.numberOfJobTranslations.count <= 0) {
                        return h.response(responseFormatter.responseFormatter({}, 'You have reached quota for posting jobs in different language.', 'error', 400)).code(400);
                    } else if ((request.payload.translatedLanguages.length) > subscriptionData.numberOfJobTranslations.count) {
                        return h.response(responseFormatter.responseFormatter({}, 'You have only ' + subscriptionData.numberOfJobTranslations.count + ' translation count left for translated job posting.', 'error', 400)).code(400);
                    }
                }
            }
        }

        /* Don't allow Cross country job postings */
        if ((request.payload.country.toLowerCase() !== packageInfo.country.toLowerCase()) && !checkUser.membership) {
            return h.response(responseFormatter.responseFormatter({}, 'Your subscription is not valid for posting the job in the selected country', 'error', 400)).code(400);
        }

        /* Check if the subscription is of type wallet */
        if (!!subscriptionData.isWallet) {
            let pricingInfo, amountToBeDeducted = 0;
            try {
                pricingInfo = await pricingSchema.pricingSchema.findOne({country: request.payload.country}, {
                    numberOfJobs: 1,
                    numberOfJobTranslations: 1,
                    jobsInAllLocalities: 1
                }, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding pricing information in create job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (!pricingInfo.numberOfJobs) {
                return h.response(responseFormatter.responseFormatter({}, 'Base price for the jobs is not found for the country', 'error', 404)).code(404);
            } else if (!pricingInfo.numberOfJobTranslations) {
                return h.response(responseFormatter.responseFormatter({}, 'Base price for the job translations is not found for the country', 'error', 404)).code(404);
            } else if (!pricingInfo.jobsInAllLocalities) {
                return h.response(responseFormatter.responseFormatter({}, 'Base price for the multiple job localities is not found for the country', 'error', 404)).code(404);
            }
            amountToBeDeducted += (pricingInfo.numberOfJobs.basePrice / pricingInfo.numberOfJobs.count);

            /*if (request.payload.displayCities && request.payload.displayCities.length) {
                amountToBeDeducted += pricingInfo.jobsInAllLocalities.basePrice;
            }*/

            if (request.payload.translatedLanguages && request.payload.translatedLanguages.length) {
                amountToBeDeducted += ((pricingInfo.numberOfJobTranslations.basePrice / pricingInfo.numberOfJobTranslations.count) * request.payload.translatedLanguages.length)
            }

            if (amountToBeDeducted > subscriptionData.walletAmount) {
                return h.response(responseFormatter.responseFormatter({}, 'Insufficient wallet balance', 'error', 400)).code(400);
            } else {
                const update = {
                    $inc: {
                        walletAmount: -1 * amountToBeDeducted,
                        'numberOfJobs.count': 1,
                        'numberOfJobTranslations.count': (request.payload.translatedLanguages ? request.payload.translatedLanguages.length : 0),
                        'jobsInAllLocalities.count': (request.payload.displayCities && request.payload.displayCities.length ? 1 : 0)
                    }
                };
                try {
                    await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: subscriptionData._id}, update, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while updating subscription data in create job handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            }

        } else {
            try {
                await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkUser.subscriptionInfo.subscriptionId}, {$inc: {'numberOfJobs.count': -1}}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while updating subscription data in create job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    } else {
        /* Free package. Check the date of the last posted job */
        let lastJob;
        try {
            lastJob = await jobSchema.jobSchema.findOne({userId: request.payload.userId, createdAt: {$gt:  new Date(moment().subtract(1, 'month').toISOString())}}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding last posted job data in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (lastJob) {
            return h.response(responseFormatter.responseFormatter({}, 'You do not have sufficient job posting left in your current package.', 'error', 400)).code(400);
        }
    }

    if (!englishLanguage) {
        try {
            englishLanguage = await languageSchema.languageSchema.findOne({language: 'en', country: 'IN'}, {_id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding english language in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Check if walk in interview flag is selected */
    if (request.payload.isWalkInInterview) {
        if (request.payload.interviewStartDateTime) {
            request.payload.interviewStartDateTime = new Date(request.payload.interviewStartDateTime);                  // Kept for pushing code to production
            request.payload.interviewEndDateTime = new Date(request.payload.interviewEndDateTime);                      // Kept for pushing code to production
        } else {
           if (!request.payload.interviewStartDate || !request.payload.interviewEndDate) {
                return h.response(responseFormatter.responseFormatter({}, 'Please select start date and end date for the walk in interview', 'error', 400)).code(400);
           }
           if (!request.payload.interviewStartTime || !request.payload.interviewEndTime) {
                return h.response(responseFormatter.responseFormatter({}, 'Please select start time and end time for the walk in interview', 'error', 400)).code(400);
           }
            request.payload.interviewStartDate = new Date(request.payload.interviewStartDate);
            request.payload.interviewEndDate = new Date(request.payload.interviewEndDate);
            request.payload.interviewStartTime = new Date(request.payload.interviewStartTime);
            request.payload.interviewEndTime = new Date(request.payload.interviewEndTime);
        }
    }

    /* Check if receive calls key is true */
    if (request.payload.receiveCalls) {
        if (request.payload.isPhoneSame) {
            request.payload.countryCode = checkUser.employerInformation.countryCode;
            request.payload.phone = checkUser.employerInformation.companyPhone;
        }
    }

    /* Create job payload and save it into database */
    dataToSave = new jobSchema.jobSchema(request.payload);
    dataToSave.totalViews = 0;
    dataToSave.isTranslated = false;
    dataToSave.translatedJobs = [];
    dataToSave.uniqueViews = [];
    dataToSave.translatedLanguage = englishLanguage._id;
    for (let i = 0; i < request.payload.skills.length; i++) {
        dataToSave.skillsLower.push(request.payload.skills[i].toLowerCase());
    }
    dataToSave.location.coordinates = [Number(request.payload.longitude), Number(request.payload.latitude)];
    dataToSave.displayLocation.coordinates = [[Number(request.payload.longitude), Number(request.payload.latitude)]];

    if (request.payload.latLongs && request.payload.latLongs.length) {
        if (!subscriptionData.jobsInAllLocalities.isIncluded) {
            return h.response(responseFormatter.responseFormatter({}, 'Your current package does not include premium postings.', 'error', 400)).code(400);
        } else {
            for (let i = 0; i < request.payload.latLongs.length; i++) {
                dataToSave.displayLocation.coordinates.push([request.payload.latLongs[i][0], request.payload.latLongs[i][1]]);
            }
            dataToSave.isPremium = true;
        }
    } else {
        dataToSave.isPremium = false;
    }

    /* Before saving check of this job includes bad words or not */
    let skill = request.payload.skills.join(' ');

    if (global.filter.isProfane(request.payload.jobTitle) || global.filter.isProfane(request.payload.jobDescriptionText) || global.filter.isProfane(skill)) {
        dataToSave.isUnderReview = true;
        dataToSave.reviewReason = 'Includes bad word(s)';
    }

    /* Translate all the job data in the given languages */
    const len = request.payload.translatedLanguages ? request.payload.translatedLanguages.length: 0;
    let jobIds = [];
    for (let i = 0; i < len; i++) {
        let checkLanguage;
        
        /* Check if the given language is provided by EZJobs */
        try {
            checkLanguage = await languageSchema.languageSchema.findById({_id: request.payload.translatedLanguages[i]}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding language data in create job handler %s:', JSON.stringify(e));
        }

        if (checkLanguage && checkLanguage.language !== 'en') {
            /* Translate data using google translator */
            let translatedJob = JSON.parse(JSON.stringify(dataToSave)), jobTitle, jobDescription, address1, address2, city,
            state, walkInAddress1, walkInAddress2, walkInCity, walkInState, jobType, payRate, skill;
            delete translatedJob._id;
            try {
                jobTitle = await commonFunctions.Handlers.translate(translatedJob.jobTitle, 'en', checkLanguage.language);
            } catch (e) {

            }
            if (jobTitle && jobTitle.translatedText) {
                translatedJob.jobTitle = jobTitle.translatedText;
            }

            try {
                jobDescription = await commonFunctions.Handlers.translate(translatedJob.jobDescriptionText, 'en', checkLanguage.language);
            } catch (e) {

            }
            if (jobDescription && jobDescription.translatedText) {
                translatedJob.jobDescriptionText = jobDescription.translatedText;
            }

            try {
                address1 = await commonFunctions.Handlers.translate(translatedJob.address.address1, 'en', checkLanguage.language);
            } catch (e) {

            }
            if (address1 && address1.translatedText) {
                translatedJob.address.address1 = address1.translatedText;
            }

            if (translatedJob.address.address2) {
                try {
                    address2 = await commonFunctions.Handlers.translate(translatedJob.address.address2, 'en', checkLanguage.language);
                } catch (e) {

                }
                if (address2 && address2.translatedText) {
                    translatedJob.address.address2 = address2.translatedText;
                }
            }

            try {
                city = await commonFunctions.Handlers.translate(translatedJob.address.city, 'en', checkLanguage.language);
            } catch (e) {

            }
            if (city && city.translatedText) {
                translatedJob.address.city = city.translatedText;
            }

            try {
                state = await commonFunctions.Handlers.translate(translatedJob.address.state, 'en', checkLanguage.language);
            } catch (e) {

            }
            if (state && state.translatedText) {
                translatedJob.address.state = state.translatedText;
            }
            if (translatedJob.isWalkInInterview) {
                if (!translatedJob.isSame) {
                    try {
                        walkInAddress1 = await commonFunctions.Handlers.translate(translatedJob.walkInInterviewAddress.address1, 'en', checkLanguage.language);
                    } catch (e) {

                    }
                    if (address1 && address1.translatedText) {
                        translatedJob.walkInInterviewAddress.address1 = address1.translatedText;
                    }

                    if (translatedJob.address.address2) {
                        try {
                            walkInAddress2 = await commonFunctions.Handlers.translate(translatedJob.walkInInterviewAddress.address2, 'en', checkLanguage.language);
                        } catch (e) {

                        }
                        if (address2 && address2.translatedText) {
                            translatedJob.walkInInterviewAddress.address2 = address2.translatedText;
                        }
                    }

                    try {
                        walkInCity = await commonFunctions.Handlers.translate(translatedJob.walkInInterviewAddress.city, 'en', checkLanguage.language);
                    } catch (e) {

                    }
                    if (city && city.translatedText) {
                        translatedJob.walkInInterviewAddress.city = city.translatedText;
                    }

                    try {
                        walkInState = await commonFunctions.Handlers.translate(translatedJob.walkInInterviewAddress.state, 'en', checkLanguage.language);
                    } catch (e) {

                    }
                    if (state && state.translatedText) {
                        translatedJob.walkInInterviewAddress.state = state.translatedText;
                    }
                } else {
                    translatedJob.walkInInterviewAddress = translatedJob.address;
                }
            }

            try {
                jobType = await commonFunctions.Handlers.translate(translatedJob.jobType, 'en', checkLanguage.language);
            } catch (e) {

            }
            if (jobType && jobType.translatedText) {
                translatedJob.jobType = jobType.translatedText;
            }

            try {
                payRate = await commonFunctions.Handlers.translate(translatedJob.payRate.type, 'en', checkLanguage.language);
            } catch (e) {

            }
            if (payRate && payRate.translatedText) {
                translatedJob.payRate.type = payRate.translatedText;
            }
            /* Translate all the skills */
            const skillsLen = translatedJob.skills.length;
            let translatedSkills = [];
            for (let i = 0; i < skillsLen; i++) {
                try {
                    skill = await commonFunctions.Handlers.translate(translatedJob.skills[i], 'en', checkLanguage.language);
                } catch (e) {

                }
                if (skill && skill.translatedText) {
                    translatedSkills.push(skill.translatedText);
                }
            }
            translatedJob.skills = translatedSkills;
            translatedJob.skillsLower = translatedSkills;
            translatedJob.isTranslated = true;
            translatedJob.translatedLanguage = checkLanguage._id;

            delete translatedJob._id;
            /* Save the translated job into database */
            let job;
            try {
                job = await new jobSchema.jobSchema(translatedJob).save();
            } catch (e) {
                logger.error('Error occurred while saving translated job data in create job handler %s:', JSON.stringify(e));
            }
            translatedJobIds.push(job._id);
            jobIds = translatedJobIds;

            /* Update subscription */
            if (!subscriptionData.numberOfJobTranslations.isUnlimited) {
                try {
                    await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: subscriptionData._id}, {$inc: {'numberOfJobTranslations.count': -1}}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while updating subscription data in create job handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            }
        }
    }

    dataToSave.translatedJobs = jobIds;

    /* Check to whom the job is exposed */
    if (request.payload.isExposedToAll) {
        dataToSave.isExposedToCommunity = false;
        dataToSave.isExposedToGroups = false;
    } else if (request.payload.isExposedToCommunity) {
        if (!checkUser.membership) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not part of any community. So, you can not post this job to any community.', 'error', 400)).code(400);
        }
        dataToSave.isExposedToAll = false;
        dataToSave.isExposedToGroups = false;
        dataToSave.membership = checkUser.membership;
    } else if (request.payload.isExposedToGroups) {
        dataToSave.isExposedToAll = false;
        dataToSave.isExposedToCommunity = false;
        if (request.payload.groupIds && request.payload.groupIds.length) {
            request.payload.groupIds = request.payload.groupIds.map(k => mongoose.Types.ObjectId(k));
            /* Get all the members of group */
            let employers = [];
            try {
                employers = await groupSchema.groupSchema.find({_id: {$in: request.payload.groupIds}, userId: mongoose.Types.ObjectId(request.payload.userId), isJob: true}, {members: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding group members in create job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            const temp = employers.map(k => k.members);
            dataToSave.exposedTo = [].concat.apply([], temp);
        }
    }

    try {
        postedJob = await dataToSave.save();
    } catch (e) {
        logger.error('Error occurred while saving job data in create job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get & Update min max salary collection */
    /*if (request.payload.payRate.type && request.payload.payRate.value) {
        try {
            salary = await minMaxSalarySchema.minMaxSalarySchema.findOne({country: request.payload.country, type: request.payload.payRate.type.toLowerCase(), role: 'job'}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting minmax salary counts in create job handler %s:', JSON.stringify(e));
        }
        if (salary) {
            if ((request.payload.payRate.value < salary.min) || (request.payload.payRate.value > salary.max)) {
                let updateValue = {};
                if (request.payload.payRate.value < salary.min) {
                    updateValue = {
                        $set: {min: request.payload.payRate.value, role: 'job', type: request.payload.payRate.type.toLowerCase()}
                    }
                } else {
                    updateValue = {
                        $set: {max: request.payload.payRate.value, role: 'job', type: request.payload.payRate.type.toLowerCase()}
                    }
                }
                try {
                    await minMaxSalarySchema.minMaxSalarySchema.findOneAndUpdate({country: request.payload.country, type: request.payload.payRate.type.toLowerCase(), role: 'job'}, updateValue, {lean: true, upsert: true});
                } catch (e) {
                    logger.error('Error occurred while updating minmax salary counts in create job handler %s:', JSON.stringify(e));
                }
            }
        } else {
            try {
                await minMaxSalarySchema.minMaxSalarySchema.findOneAndUpdate({country: request.payload.country, type: request.payload.payRate.type.toLowerCase(), role: 'job'}, {$set: {min: request.payload.payRate.value, role: 'job', type: request.payload.payRate.type.toLowerCase(), max: request.payload.payRate.value}}, {lean: true, upsert: true});
            } catch (e) {
                logger.error('Error occurred while updating minmax salary counts in create job handler %s:', JSON.stringify(e));
            }
        }
    }*/

    /* Increase posting count by one for the user */
    dataToUpdate = {
        $inc: {'employerInformation.numberOfJobsPosted': 1}
    };

    let source, contactSource, companyType = '', checkContact, verificationData;

    if (checkUser.employerInformation.verificationData) {
        try {
            verificationData = await companyVerificationSchema.companyVerificationSchema.findById({_id: checkUser.employerInformation.verificationData}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding verification data in create job handler %s:', JSON.stringify(e));
        }
    }

    if (checkUser.roles.indexOf('Employer') === -1) {
        dataToUpdate.$set = {roles: ['Employer']};
        if (process.env.NODE_ENV === 'production') {
            if (checkUser.facebookId.id) {
                source = 'Facebook';
            } else if (checkUser.googleId.id) {
                source = 'Google';
            } else if (checkUser.linkedInId.id) {
                source = 'Linkedin';
            } else if (checkUser.phone) {
                source = 'Phone';
            } else {
                source = 'Email';
            }
            if (checkUser.deviceType.toLowerCase() === 'android') {
                contactSource = 'Android App';
            } else if (checkUser.deviceType.toLowerCase() === 'ios') {
                contactSource = 'IOS App';
            } else {
                contactSource = 'Web';
            }

            /* Get company type */
            const idx = constantData.businessTypes.findIndex(k => k._id.toString() === checkUser.employerInformation.companyType);
            if (idx !== -1) {
                companyType = constantData.businessTypes[idx].name;
            }

            let status = await commonFunctions.Handlers.createHubSpotContactEmployer(checkUser.firstName, checkUser.lastName, checkUser.email, countryList.getName(checkUser.employeeInformation.country), contactSource, source, 'customer', checkUser.employeeInformation.address.city, checkUser.employeeInformation.address.state, checkUser.employerInformation.companyPhone, checkUser.employerInformation.companyName, companyType);
            if (status === 'error') {
                logger.error('Error occurred while creating hub spot contact');
            }
        }
    }

    if (process.env.NODE_ENV === 'production') {
        /* Engage Bay */
        let checkCompany;
        try {
            [checkContact, checkCompany] = await Promise.all([
                commonFunctions.Handlers.checkEngageBayContact(checkUser.email),
                commonFunctions.Handlers.checkEngageBayCompany(checkUser.employerInformation.companyName)
            ]);
        } catch (e) {
            logger.error('Error occurred while performing parallel actions regarding check engagebay contact and check engagebay company in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (checkContact && checkContact.status !== 200) {
            let contactProperties = [], contactData = {
                properties: [],
                companyIds: []
            }, zone;

            /* Get the zone data */
            try {
                zone = await zoneSchema.zoneSchema.findOne({states: {$in: [checkUser.employerInformation.companyAddress.state]}}, {
                    _id: 1,
                    abbreviation: 1
                }, {lean: true});
            } catch (e) {
                logger.error('Error occurred while getting zone data in create job handler %s:', JSON.stringify(e));
            }
            if (zone) {
                const zone = new commonFunctions.engageBay('Zone', 'TEXT', 'CUSTOM', true, zone.abbreviation);
                contactProperties.push(zone.getProperties());
            }

            const firstName = new commonFunctions.engageBay('name', 'TEXT', 'SYSTEM', true, checkUser.firstName);
            contactProperties.push(firstName.getProperties());

            const lastName = new commonFunctions.engageBay('last_name', 'TEXT', 'SYSTEM', true, checkUser.lastName);
            contactProperties.push(lastName.getProperties());

            const email = new commonFunctions.engageBay('email', 'TEXT', 'SYSTEM', true, checkUser.email);
            contactProperties.push(email.getProperties());

            const phone = new commonFunctions.engageBay('phone', 'TEXT', 'SYSTEM', true, checkUser.employerInformation.countryCode + checkUser.employerInformation.companyPhone);
            contactProperties.push(phone.getProperties());

            const engageSource = new commonFunctions.engageBay('Source', 'TEXT', 'CUSTOM', true, source);
            contactProperties.push(engageSource.getProperties());

            const engageContactSource = new commonFunctions.engageBay('Contact source', 'TEXT', 'CUSTOM', true, contactSource);
            contactProperties.push(engageContactSource.getProperties());

            const verification = verificationData ? verificationData.status : 0;

            const engageCompanyVerification = new commonFunctions.engageBay('Company_verification', 'TEXT', 'CUSTOM', true, verification === 2 ? 'Verified' : 'Not verified');
            contactProperties.push(engageCompanyVerification.getProperties());

            contactData.properties = contactProperties;

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

    /* Update package info on hubspot */
    if (process.env.NODE_ENV === 'production') {
        let hubSpotProperties = [], packageData, activeJobs, engageBayProperties = [];

        try {
            [packageData, activeJobs] = await Promise.all([
                packageSchema.packageSchema.findById({_id: checkUser.subscriptionInfo.packageId}, {}, {lean: true}),
                jobSchema.jobSchema.find({
                    userId: checkUser._id,
                    isVisible: true,
                    isTranslated: false
                }, {}, {lean: true})
            ]);
        } catch (e) {
            logger.error('Error occurred while performing parallel actions regarding package data and active jobs in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!subscriptionData.isFree) {
            hubSpotProperties.push({
                property: 'issubscribed',
                value: subscriptionData.isPaid
            });
            const isSubscribed = new commonFunctions.engageBay('Subscribed', 'CHECKBOX', 'CUSTOM', true, subscriptionData.isPaid);
            engageBayProperties.push(isSubscribed.getProperties());
        }

        if (packageData) {
            hubSpotProperties.push({
                property: 'plan_name',
                value: packageData.packageName
            });
            const planName = new commonFunctions.engageBay('Plan_name', 'TEXT', 'CUSTOM', true, packageData.packageName);
            engageBayProperties.push(planName.getProperties());
        }

        hubSpotProperties.push({
            property: 'plan_type',
            value: subscriptionData.planType === 'monthly' ? 'Monthly' : 'Yearly'
        });
        const planType = new commonFunctions.engageBay('Plan_type', 'LIST', 'CUSTOM', true, subscriptionData.planType === 'monthly' ? 'Monthly' : 'Yearly');
        engageBayProperties.push(planType.getProperties());

        hubSpotProperties.push({
            property: 'payment_type',
            value: subscriptionData.orderId ? 'OneTime' : 'Recurring'
        });
        const paymentType = new commonFunctions.engageBay('Payment_type', 'LIST', 'CUSTOM', true, subscriptionData.orderId ? 'OneTime' : 'Recurring');
        engageBayProperties.push(paymentType.getProperties());

        hubSpotProperties.push({
            property: 'subscription_start_date',
            value: subscriptionData.purchasedDate.setHours(0,0,0,0)
        });
        const startDate = new commonFunctions.engageBay('Subscription_start_date', 'DATE', 'CUSTOM', true, new Date(subscriptionData.purchasedDate).toLocaleDateString());
        engageBayProperties.push(startDate.getProperties());

        if (subscriptionData.expiresAt) {
            hubSpotProperties.push({
                property: 'subscription_end_date',
                value: subscriptionData.expiresAt.setHours(0,0,0,0)
            });
            const expiresAt = new commonFunctions.engageBay('Subscription_expiry_date', 'DATE', 'CUSTOM', true, new Date(subscriptionData.expiresAt).toLocaleDateString());
            engageBayProperties.push(expiresAt.getProperties());
        }

        if (subscriptionData.promoCode) {
            const promoCode = new commonFunctions.engageBay('Promo_code', 'TEXT', 'CUSTOM', true, subscriptionData.promoCode);
            engageBayProperties.push(promoCode.getProperties());

            /* Get promo code */
            let promo;
            try {
                promo = await promoSchema.promoCodeSchema.findOne({promoCode: subscriptionData.promoCode}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding promo code in create job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (promo) {
                const promoCodeAmount = new commonFunctions.engageBay('Promo_code_amount', 'TEXT', 'CUSTOM', true, promo.promoType === 'fixed' ? promo.amount : (promo.amount + '%'));
                engageBayProperties.push(promoCodeAmount.getProperties());
            }
        }

        const len = activeJobs.length;
        let jobsData = [];

        for (let i = 0; i < len; i++) {
            const shortLink = await commonFunctions.Handlers.createFirebaseShortLink('', activeJobs[i]._id, '', '', '', '', '', '', '');
            jobsData.push(activeJobs[i].jobTitle + ' : ' + shortLink.shortLink + '. ');
        }

        hubSpotProperties.push({
            property: 'job_posted_by_employer',
            value: jobsData.toString()
        });
        const jobs = new commonFunctions.engageBay('Jobs', 'TEXTAREA', 'CUSTOM', true, jobsData.toString());
        engageBayProperties.push(jobs.getProperties());

        if (hubSpotProperties.length) {
            try {
                await Promise.all([
                    commonFunctions.Handlers.updateHubSpotContact(checkUser.email, hubSpotProperties),
                    commonFunctions.Handlers.updateHubSpotContactEmployer(checkUser.email, hubSpotProperties)
                ]);
            } catch (e) {
                logger.error('Error occurred while performing parallel actions regardingupdate hubspot contact in create job handler %s:', JSON.stringify(e));
            }
        }

        if (engageBayProperties.length) {
            try {
                 await commonFunctions.Handlers.updateEngageBayContact({id: checkContact.data.id, properties: engageBayProperties});
            } catch (e) {
                logger.error('Error occurred while updating user in engage bay %s:', JSON.stringify(e));
            }
        }
    }

    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, dataToUpdate, {lean: true});
    } catch (e) {
        logger.error('Error occurred while incrementing job posting count in create job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (process.env.NODE_ENV === 'production') {
        if (postedJob && postedJob._id) {
            try {
                await commonFunctions.Handlers.submitForIndexing(postedJob._id, false);
            } catch (e) {
                logger.error('Error occurred while submitting the job to google for indexing %s:', JSON.stringify(e));
            }
        }
    }

    /* Commented for time being */
    /*if(!dataToSave.isUnderReview) {
        /!* Send push notification to all the users around for newly created job listing *!/
        aggregationCriteria = [
            {
                $geoNear: {
                    near: {type: 'Point', coordinates: [Number(request.payload.longitude), Number(request.payload.latitude)]},
                    key: 'employeeInformation.location',
                    maxDistance: (constantData ? constantData.addJobPushRadius: 10) * 1609.34,
                    distanceField: 'dist',
                    query: {
                        'notifications.suggestions': true,
                        isActive: true,
                        blockedBy: {$nin: [mongoose.Types.ObjectId(request.payload.userId)]},
                        _id: {
                            $ne: mongoose.Types.ObjectId(request.payload.userId),
                            $nin: checkUser.blockedBy
                        },
                        'employeeInformation.preference': {$in: [mongoose.Types.ObjectId(request.payload.categoryId)]}
                    },
                    spherical: true
                }
            },
            {
                $project: {
                    _id: 1,
                    deviceToken: 1,
                    deviceType: 1
                }
            }
        ];
        try {
            usersForPush = await userSchema.UserSchema.aggregate(aggregationCriteria);
        } catch (e) {
            logger.error('Error occurred while aggregating users in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /!* Get admin data for adding admin ID *!/
        try {
            adminData = await adminSchema.AdminSchema.findOne({email: 'swapglobal@gmail.com'}, {_id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding admin in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!adminData) {
            return h.response(responseFormatter.responseFormatter({}, 'No such admin found', 'error', 404)).code(404);
        }

        /!* Classify android device IDs and iOS device IDs and save them to notification collection *!/
        checkUser.blockedBy = checkUser.blockedBy.map(String);
        for (let i = 0; i < usersForPush.length; i++) {
            if (checkUser.blockedBy.indexOf(usersForPush[i]._id.toString()) === -1) {
                if (usersForPush[i]._id.toString() !== request.payload.userId) {
                    if (usersForPush[i].deviceType === 'ANDROID') {
                        deviceIdsAndroid.push(usersForPush[i].deviceToken);
                    } else {
                        deviceIdsIos.push(usersForPush[i].deviceToken);
                    }
                    insertDatas.push({
                        sentTo: mongoose.Types.ObjectId(usersForPush[i]._id),
                        isAdmin: true,
                        adminId: mongoose.Types.ObjectId(adminData._id),
                        message: 'New job has just been posted in your area',
                        jobId: dataToSave._id,
                        isRead: false,
                        pushType: 'job'
                    });
                }
            }
        }
        try {
            await notificationSchema.notificationSchema.insertMany(insertDatas);
        } catch (e) {
            logger.error('Error occurred while saving data into notifications collection in create job handler %s:', JSON.stringify(e));
        }

        /!* Now send push to both the devices *!/
        if (deviceIdsAndroid.length) {
            push.createMessage('', deviceIdsAndroid, {jobId: dataToSave._id, pushType: 'job'}, 'ANDROID', 'New Job', 'New job has just been posted in your area', '');
        }
        if (deviceIdsIos.length) {
            push.createMessage('', deviceIdsIos, {jobId: dataToSave._id, pushType: 'job'}, 'IOS', 'New Job', 'New job has just been posted in your area', '');
        }

        /!* Send push according to user search history *!/
        try {
            searchRelatedPush = await userSchema.UserSchema.aggregate([
                {
                    $geoNear: {
                        near: {type: 'Point', coordinates: [Number(request.payload.longitude), Number(request.payload.latitude)]},
                        maxDistance: (constantData ? constantData.addJobPushRadius: 10) * 1609.34,
                        distanceField: 'dist',
                        key: 'employeeInformation.location',
                        query: {
                            _id: {
                                $ne: mongoose.Types.ObjectId(request.payload.userId),
                                $nin: checkUser.blockedBy
                            },
                            'employeeInformation.country': checkUser.country,
                            'isActive': true,
                            'notifications.searchBased': true,
                            blockedBy: {$nin: [mongoose.Types.ObjectId(request.payload.userId)]}
                        },
                        spherical: true
                    }
                },
                {
                    $lookup: {
                        from: 'Search',
                        localField: '_id',
                        foreignField: 'userId',
                        as: 'search'
                    }
                },
                {
                    $unwind: '$search'
                },
                {
                    $match: {
                        $or: [
                            {
                                'search.searchText': {$all: [new RegExp(dataToSave.jobTitle.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                            },
                            {
                                'search.searchText': {$all: [new RegExp(dataToSave.jobDescriptionText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                            }
                        ]
                    }
                },
                {
                    $project: {
                        userId: '$_id',
                        deviceToken: 1,
                        deviceType: 1,
                        blockedBy: 1
                    }
                }
            ]);
        } catch (e) {
            console.log(e);
            logger.error('Error occurred while aggregating search data in create job handler %s:', JSON.stringify(e));
        }
        for (let i = 0; i < searchRelatedPush.length; i++) {
            if (checkUser.blockedBy.indexOf(mongoose.Types.ObjectId(searchRelatedPush[i].userId.toString())) === -1) {
                const idx = usersForPush.findIndex(j => j._id.toString() === searchRelatedPush[i].userId.toString());
                if (idx === -1) {
                    if (searchRelatedPush[i].deviceType === 'ANDROID') {
                        searchRelatedAndroid.push(searchRelatedPush[i].deviceToken);
                    } else {
                        searchRelatedIos.push(searchRelatedPush[i].deviceToken);
                    }
                    insertDatasSearchBased.push({
                        sentTo: mongoose.Types.ObjectId(searchRelatedPush[i].userId),
                        isAdmin: true,
                        adminId: mongoose.Types.ObjectId(adminData._id),
                        message: 'New job has just been posted in your area related to your past searches',
                        jobId: dataToSave._id,
                        isRead: false,
                        pushType: 'job'
                    });
                }
            }
        }

        try {
            await notificationSchema.notificationSchema.insertMany(insertDatasSearchBased);
        } catch (e) {
            logger.error('Error occurred while saving data 2 into notifications collection in create job handler %s:', JSON.stringify(e));
        }

        if (searchRelatedAndroid.length) {
            push.createMessage('', searchRelatedAndroid, {jobId: dataToSave._id, pushType: 'job'}, 'ANDROID', 'New Job', 'New job has just been posted in your area related to your past searched', '');
        }
        if (searchRelatedIos.length) {
            push.createMessage('', searchRelatedAndroid, {jobId: dataToSave._id, pushType: 'job'}, 'IOS', 'New Job', 'New job has just been posted in your area related to your past searches', '');
        }

        /!* Send push according to user favourites *!/
        try {
            favouriteBased = await userSchema.UserSchema.aggregate([
                {
                    $geoNear: {
                        near: {type: 'Point', coordinates: [Number(request.payload.longitude), Number(request.payload.latitude)]},
                        maxDistance: (constantData ? constantData.addJobPushRadius : 10) * 1609.34,
                        distanceField: 'dist',
                        key: 'employeeInformation.location',
                        query: {
                            _id: {
                                $ne: mongoose.Types.ObjectId(request.payload.userId),
                                $nin: checkUser.blockedBy
                            },
                            blockedBy: {$nin: [mongoose.Types.ObjectId(request.payload.userId)]}
                        },
                        spherical: true
                    }
                },
                {
                    $lookup: {
                        from: 'Favourite',
                        localField: '_id',
                        foreignField: 'userId',
                        as: 'favourite'
                    }
                },
                {
                    $unwind: '$favourite'
                },
                {
                    $lookup: {
                        from: 'Job',
                        localField: 'favourite.jobId',
                        foreignField: '_id',
                        as: 'job'
                    }
                },
                {
                    $unwind: '$job'
                },
                {
                    $match: {
                        'job.categoryId': mongoose.Types.ObjectId(dataToSave.categoryId)
                    }
                },
                {
                    $match: {
                        'isActive': true,
                        'notifications.similarToFavourites': true
                    }
                },
                {
                    "$group" : {
                        "_id" : {
                            "userId" : "$_id",
                            "deviceToken" : "$deviceToken",
                            "deviceType" : "$deviceType",
                            "blockedBy": "$blockedBy"
                        }
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while aggregating favourite data in add product handler %s:', JSON.stringify(e));
        }

        for (let i = 0; i < favouriteBased.length; i++) {
            if (checkUser.blockedBy.indexOf(mongoose.Types.ObjectId(favouriteBased[i]._id.userId.toString())) === -1) {
                const idx = usersForPush.findIndex(j => j._id.toString() === favouriteBased[i]._id.userId.toString());
                if (idx === -1) {
                    if (favouriteBased[i]._id.deviceType === 'ANDROID') {
                        favouriteBasedAndroid.push(favouriteBased[i]._id.deviceToken);
                    } else {
                        favouriteBasedIos.push(favouriteBased[i]._id.deviceToken);
                    }
                    insertDatasFavouriteBased.push({
                        sentTo: mongoose.Types.ObjectId(favouriteBased[i]._id.userId),
                        isAdmin: true,
                        adminId: mongoose.Types.ObjectId(adminData._id),
                        message: 'New job has just been posted in your area related to your favourites',
                        jobId: dataToSave._id,
                        isRead: false,
                        pushType: 'job'
                    });
                }
            }
        }
        /!* Concat two arrays to remove duplicate pushes *!/
        for (let i = 0; i < favouriteBased.length; i++) {
            usersForPush.push({userId: favouriteBased[i]._id.userId, deviceToken: favouriteBased[i]._id.deviceToken, deviceType: favouriteBased[i]._id.deviceType});
        }

        try {
            await notificationSchema.notificationSchema.insertMany(insertDatasFavouriteBased);
        } catch (e) {
            logger.error('Error occurred while saving data 2 into notifications collection in add product handler %s:', JSON.stringify(e));
        }

        if (favouriteBasedAndroid.length) {
            push.createMessage('', favouriteBasedAndroid, {jobId: dataToSave._id, pushType: 'job'}, 'ANDROID', 'New Job', 'New job has just been posted in your area related to your favourites', '');
        }
        if (favouriteBasedIos.length) {
            push.createMessage('', favouriteBasedIos, {jobId: dataToSave._id, pushType: 'job'}, 'IOS', 'New Job', 'New job has just been posted in your area related to your favourites', '');
        }

        /!* Send push notifications to user according to their chat preferences *!/
        try {
            chatBased = await userSchema.UserSchema.aggregate([
                {
                    $geoNear: {
                        near: {type: 'Point', coordinates: [Number(request.payload.longitude), Number(request.payload.latitude)]},
                        maxDistance: (constantData ? constantData.addJobPushRadius : 10) * 1609.34,
                        distanceField: 'dist',
                        key: 'employeeInformation.location',
                        query: {
                            _id: {
                                $ne: mongoose.Types.ObjectId(request.payload.userId),
                                $nin: checkUser.blockedBy
                            },
                            blockedBy: {$nin: [mongoose.Types.ObjectId(request.payload.userId)]}
                        },
                        spherical: true
                    }
                },
                {
                    $lookup: {
                        from: 'Conversation',
                        localField: '_id',
                        foreignField: 'candidateId',
                        as: 'chat'
                    }
                },
                {
                    $unwind: '$chat'
                },
                {
                    $lookup: {
                        from: 'Job',
                        localField: 'chat.jobId',
                        foreignField: '_id',
                        as: 'job'
                    }
                },
                {
                    $unwind: '$job'
                },
                {
                    $match: {
                        'job.categoryId': mongoose.Types.ObjectId(dataToSave.categoryId)
                    }
                },
                {
                    $match: {
                        'isActive': true,
                        'notifications.similarToChats': true
                    }
                },
                {
                    "$group" : {
                        "_id" : {
                            "userId" : "$_id",
                            "deviceToken" : "$deviceToken",
                            "deviceType" : "$deviceType",
                            "blockedBy": "$blockedBy"
                        }
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while aggregating chat data in add product handler %s:', JSON.stringify(e));
        }

        for (let i = 0; i < chatBased.length; i++) {
            if (checkUser.blockedBy.indexOf(mongoose.Types.ObjectId(chatBased[i]._id.userId.toString())) === -1) {
                const idx = usersForPush.findIndex(j => j._id.toString() === chatBased[i]._id.userId.toString());
                if (idx === -1) {
                    if (chatBased[i]._id.deviceType === 'ANDROID') {
                        chatBasedAndroid.push(chatBased[i]._id.deviceToken);
                    } else {
                        chatBasedIos.push(chatBased[i]._id.deviceToken);
                    }
                    insertDatasChatBased.push({
                        sentTo: mongoose.Types.ObjectId(chatBased[i]._id.userId),
                        isAdmin: true,
                        adminId: mongoose.Types.ObjectId(adminData._id),
                        message: 'New job has just been posted in your area related to your conversations',
                        jobId: dataToSave._id,
                        isRead: false,
                        pushType: 'job'
                    });
                }
            }
        }

        try {
            await notificationSchema.notificationSchema.insertMany(insertDatasChatBased);
        } catch (e) {
            logger.error('Error occurred while saving data 2 into notifications collection in add product handler %s:', JSON.stringify(e));
        }

        if (chatBasedAndroid.length) {
            push.createMessage('', chatBasedAndroid, {jobId: dataToSave._id, pushType: 'job'}, 'ANDROID', 'New Job', 'New job has just been posted in your area related to your conversations', '');
        }
        if (chatBasedIos.length) {
            push.createMessage('', chatBasedIos, {jobId: dataToSave._id, pushType: 'job'}, 'IOS', 'New Job', 'New job has just been posted in your area related to your conversations', '');
        }

        /!* Add skills into weight collection for complex matching algorithm *!/
        let skills, weightedSkills = [], jobTitles, weightedTitles = [];
        try {
            skills = await weightSchema.weightSchema.find({isSkill: true}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching skills data from weight collection in create job handler %s:', JSON.stringify(e));
        }
        try {
            jobTitles = await weightSchema.weightSchema.find({isSkill: false}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching titles data from weight collection in create job handler %s:', JSON.stringify(e));
        }

        for (let i = 0; i < request.payload.skills.length; i++) {
            if (skills.length) {
                const idx = skills[0].skills.findIndex(j => j.skill.toLowerCase() === request.payload.skills[i].toLowerCase());
                if (idx === -1) {
                    weightedSkills.push({skill: request.payload.skills[i], similarSkills: []});
                }
            } else {
                weightedSkills.push({skill: request.payload.skills[i], similarSkills: []});
            }
        }
        if (jobTitles.length) {
            const idx = jobTitles[0].jobTitles.findIndex(j => j.jobTitle.toLowerCase() === request.payload.jobTitle.toLowerCase());
            if (idx === -1) {
                weightedTitles.push({jobTitle: request.payload.jobTitle, similarJobTitles: []});
            }
        }
        /!* Push weighted skills array to weight collection *!/
        try {
            await weightSchema.weightSchema.findOneAndUpdate({isSkill: true}, {$set: {isSkill: true, isJobTitle: false, jobTitles: []}, $push: {skills: weightedSkills}}, {lean: true, upsert: true});
        } catch (e) {
            logger.error('Error occurred while updating skills data in weight collection in create job handler %s:', JSON.stringify(e));
        }
        /!* Push weighted titles array to weight collection *!/
        try {
            await weightSchema.weightSchema.findOneAndUpdate({isSkill: false}, {$set: {isJobTitle: true, isSkill: false, skills: []}, $push: {jobTitles: weightedTitles}}, {lean: true, upsert: true});
        } catch (e) {
            logger.error('Error occurred while updating titles data in weight collection in create job handler %s:', JSON.stringify(e));
        }
    }*/

    /* Send email if it is under review */
    if (dataToSave.isUnderReview) {
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
                        name: 'jobTitle',
                        content: request.payload.jobTitle
                    },
                    {
                        name: 'companyName',
                        content: checkUser.employerInformation.companyName
                    }
                ]
            }]
        };
        await mandrill.Handlers.sendTemplate('under-review', [], email, true);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({jobsCount: checkUser.employerInformation.numberOfJobsPosted + 1}, request.payload.inQueue ? 'Job is queued to be published when you close older postings.' : 'Job posted successfully', 'success', 201)).code(201);
};

employerHandler.updateJob = async (request, h) => {
    let checkUser, decoded, checkJob, status, dataToUpdate, englishLanguage;

    try {
        [checkUser, decoded, checkJob, englishLanguage] = await Promise.all([
            userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.userId)}, {}, {lean: true}),
            commonFunctions.Handlers.decodeToken(request.auth.credentials.token),
            jobSchema.jobSchema.findOne({
                _id: mongoose.Types.ObjectId(request.payload.jobId),
                userId: mongoose.Types.ObjectId(request.payload.userId)
            }, {}, {lean: true}),
            languageSchema.languageSchema.findOne({
                language: 'en',
                country: request.payload.country
            }, {_id: 1}, {lean: true})
        ])
    } catch (e) {
        logger.error('Error occurred while running parallel operations in update job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check whether user exists in database */
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check if user is the same who is trying to update location */
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check if job exists in database for the same user */
    if (!checkJob) {
        return h.response(responseFormatter.responseFormatter({}, 'Job not found', 'error', 404)).code(404);
    }

    /* Check for the subscription package */
    let subscriptionData, packageInfo;
    if (checkUser.subscriptionInfo && checkUser.subscriptionInfo.subscriptionId) {
        try {
            [subscriptionData, packageInfo] = await Promise.all([
                subscriptionSchema.subscriptionSchema.findById({_id: checkUser.subscriptionInfo.subscriptionId}, {}, {lean: true}),
                packageSchema.packageSchema.findById({_id: checkUser.subscriptionInfo.packageId}, {
                    country: 1,
                    isFree: 1
                }, {lean: true})
            ])
        } catch (e) {
            logger.error('Error occurred while performing parallel actions regarding subscription and package in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!subscriptionData) {
            return h.response(responseFormatter.responseFormatter({}, 'Something went wrong. Please contact support.', 'error', 400)).code(400);
        }

        /* Don't allow Cross country job postings */
        if ((request.payload.country.toLowerCase() !== packageInfo.country.toLowerCase()) && !checkUser.membership) {
            return h.response(responseFormatter.responseFormatter({}, 'Your subscription is not valid for posting the job in the selected country', 'error', 400)).code(400);
        }
    }

    if (!request.payload.isUnderReview) {
        request.payload.isUnderReview = false;
    }

    request.payload.translatedJobs = checkJob.translatedJobs ? checkJob.translatedJobs : [];

    /* Delete video if new one is uploaded or deleted */
    if (request.payload.jobDescriptionVideo) {
        if (checkJob.jobDescriptionVideo !== request.payload.jobDescriptionVideo) {
            if (checkJob.jobDescriptionVideo) {
                try {
                    status = await commonFunctions.Handlers.deleteImage(checkJob.jobDescriptionVideo);
                } catch (e) {
                    logger.error('Error occurred while deleting job in edit job handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (!status) {
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred while deleting job video', 'error', 500)).code(500);
                }
            }
        }
    }

     if (request.payload.isWalkInInterview) {
        if (request.payload.interviewStartDateTime) {
            request.payload.interviewStartDateTime = new Date(request.payload.interviewStartDateTime);                  // Kept for pushing code to production
            request.payload.interviewEndDateTime = new Date(request.payload.interviewEndDateTime);                      // Kept for pushing code to production
        } else {
            if (!request.payload.interviewStartDate || !request.payload.interviewEndDate) {
                return h.response(responseFormatter.responseFormatter({}, 'Please select start date and end date for the walk in interview', 'error', 400)).code(400);
            }
            if (!request.payload.interviewStartTime || !request.payload.interviewEndTime) {
                return h.response(responseFormatter.responseFormatter({}, 'Please select start time and end time for the walk in interview', 'error', 400)).code(400);
            }
            request.payload.interviewStartDate = new Date(request.payload.interviewStartDate);
            request.payload.interviewEndDate = new Date(request.payload.interviewEndDate);
            request.payload.interviewStartTime = new Date(request.payload.interviewStartTime);
            request.payload.interviewEndTime = new Date(request.payload.interviewEndTime);
        }
    } else {
        request.payload.interviewStartDateTime = null;
        request.payload.interviewEndDateTime = null;
        request.payload.interviewStartDate = null;
        request.payload.interviewEndDate = null;
        request.payload.interviewStartTime = null;
        request.payload.interviewEndTime = null;
        request.payload.walkInLatitude = null;
        request.payload.walkInLongitude = null;
        request.payload.walkInInterviewAddress = {
            address1: '',
            address2: '',
            city: '',
            state: '',
            zipCode: ''
        };
    }

    if (request.payload.receiveCalls) {
        if (request.payload.isPhoneSame) {
            request.payload.countryCode = checkUser.employerInformation.countryCode;
            request.payload.phone = checkUser.employerInformation.companyPhone;
        }
    }

    /* Update job data */
    dataToUpdate = request.payload;

    if (englishLanguage) {
        dataToUpdate.translatedLanguage = mongoose.Types.ObjectId(englishLanguage._id);
    }

    if (!request.payload.isATS) {
        dataToUpdate.atsEmail = '';
    }
    if (!request.payload.isCompanyWebsite) {
        dataToUpdate.companyWebsite = '';
    }

    if (!request.payload.shift) {
        dataToUpdate.shift = '';
    }

    dataToUpdate.skillsLower = [];
    for (let i = 0; i < request.payload.skills.length; i++) {
        dataToUpdate.skillsLower.push(request.payload.skills[i].toLowerCase());
    }
    dataToUpdate.location = {type: 'Point'};
    dataToUpdate.location.coordinates = [Number(request.payload.longitude), Number(request.payload.latitude)];

    dataToUpdate.displayLocation = {type: 'MultiPoint'};
    dataToUpdate.displayLocation.coordinates = [[Number(request.payload.longitude), Number(request.payload.latitude)]];

    if (request.payload.latLongs && request.payload.latLongs.length) {
        if (!subscriptionData.jobsInAllLocalities.isIncluded) {
            return h.response(responseFormatter.responseFormatter({}, 'Your current package does not include premium postings.', 'error', 400)).code(400);
        } else {
            for (let i = 0; i < request.payload.latLongs.length; i++) {
                dataToUpdate.displayLocation.coordinates.push([request.payload.latLongs[i][0], request.payload.latLongs[i][1]]);
            }
            dataToUpdate.isPremium = true;
        }
    } else {
        dataToUpdate.isPremium = false;
    }

    /* Before saving check of this job includes bad words or not */
    if (global.filter.isProfane(request.payload.jobTitle) || global.filter.isProfane(request.payload.jobDescriptionText) || global.filter.isProfane(request.payload.skills.join(" "))) {
        dataToUpdate.isUnderReview = true;
        dataToUpdate.reviewReason = 'Includes bad word(s)';
    }

    /* Fetch list of translated jobs */
    let translatedLanguages = [];
    if (checkJob.translatedJobs && checkJob.translatedJobs.length && !checkJob.isArchived) {
        for (let i = 0; i < checkJob.translatedJobs.length; i++) {
            let tJob;
            try {
                tJob = await jobSchema.jobSchema.findById({_id: checkJob.translatedJobs[i]}, {translatedLanguage: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding job in edit job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (tJob) {
                translatedLanguages.push(tJob.translatedLanguage);
            }
        }
    } else {
        checkJob.translatedJobs = [];
    }

    /* Check if the package is of type wallet */
    let pricingInfo;
    if (subscriptionData.isWallet) {
        try {
            pricingInfo = await pricingSchema.pricingSchema.findOne({country: request.payload.country}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding pricing info in edit job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (subscriptionData.isWallet) {
            if (pricingInfo.numberOfJobTranslations) {
                let amountToBeDeducted = +(((pricingInfo.numberOfJobTranslations.basePrice) / (pricingInfo.numberOfJobTranslations.count)) * (request.payload.translatedLanguages.length - checkJob.translatedJobs.length)).toFixed(2);

                if (checkJob.isArchived) {
                    amountToBeDeducted += +((pricingInfo.numberOfJobs.basePrice) / (pricingInfo.numberOfJobs.count)).toFixed(2);
                }

                console.log(amountToBeDeducted);

                if (amountToBeDeducted > subscriptionData.walletAmount) {
                    return h.response(responseFormatter.responseFormatter({}, 'Insufficient wallet balance', 'error', 400)).code(400);
                } else {
                    try {
                        subscriptionData = await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: subscriptionData._id}, {
                            $inc: {
                                'numberOfJobTranslations.count': (request.payload.translatedLanguages.length - checkJob.translatedJobs.length),
                                walletAmount: -1 * amountToBeDeducted
                            }
                        }, {lean: true, new: true});
                    } catch (e) {
                        logger.error('Error occurred while updating subscription info in edit job handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }
            }
        }
    }

    /* Translate all the job data in the given languages */
    const len = request.payload.translatedLanguages ? request.payload.translatedLanguages.length : 0;
    let jobIds = [];
    for (let i = 0; i < len; i++) {
        let checkLanguage;

        /* Check if the given language is provided by EZJobs */
        try {
            checkLanguage = await languageSchema.languageSchema.findById({_id: request.payload.translatedLanguages[i]}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding language data in edit job handler %s:', JSON.stringify(e));
        }

        const idx = translatedLanguages.findIndex(k => k.toString() === request.payload.translatedLanguages[i]);

        if (idx === -1) {
            if (subscriptionData.numberOfJobTranslations.count <= 0 && !subscriptionData.numberOfJobTranslations.isUnlimited && !subscriptionData.numberOfJobTranslations.isFree) {
                return h.response(responseFormatter.responseFormatter({}, 'You have reached quota for posting jobs in different language.', 'error', 400)).code(400);
            } else {
                if (checkLanguage && checkLanguage.language !== 'en') {

                    /* Translate data using google translator */
                    let translatedJob = JSON.parse(JSON.stringify(dataToUpdate)), jobTitle, jobDescription, address1, address2, city,
                        state, walkInAddress1, walkInAddress2, walkInCity, walkInState, jobType, payRate, skill;

                    delete translatedJob._id;

                    try {
                        jobTitle = await commonFunctions.Handlers.translate(translatedJob.jobTitle, 'en', checkLanguage.language);
                    } catch (e) {
                        console.log(e);
                    }
                    if (jobTitle && jobTitle.translatedText) {
                        translatedJob.jobTitle = jobTitle.translatedText;
                    }

                    try {
                        jobDescription = await commonFunctions.Handlers.translate(translatedJob.jobDescriptionText, 'en', checkLanguage.language);
                    } catch (e) {
                        console.log(e);
                    }
                    if (jobDescription && jobDescription.translatedText) {
                        translatedJob.jobDescriptionText = jobDescription.translatedText;
                    }

                    try {
                        address1 = await commonFunctions.Handlers.translate(translatedJob.address.address1, 'en', checkLanguage.language);
                    } catch (e) {
                        console.log(e);
                    }
                    if (address1 && address1.translatedText) {
                        translatedJob.address.address1 = address1.translatedText;
                    }

                    if (translatedJob.address.address2) {
                        try {
                            address2 = await commonFunctions.Handlers.translate(translatedJob.address.address2, 'en', checkLanguage.language);
                        } catch (e) {
                            console.log(e);
                        }
                        if (address2 && address2.translatedText) {
                            translatedJob.address.address2 = address2.translatedText;
                        }
                    }

                    try {
                        city = await commonFunctions.Handlers.translate(translatedJob.address.city, 'en', checkLanguage.language);
                    } catch (e) {
                        console.log(e);
                    }
                    if (city && city.translatedText) {
                        translatedJob.address.city = city.translatedText;
                    }

                    try {
                        state = await commonFunctions.Handlers.translate(translatedJob.address.state, 'en', checkLanguage.language);
                    } catch (e) {
                        console.log(e);
                    }
                    if (state && state.translatedText) {
                        translatedJob.address.state = state.translatedText;
                    }
                    if (translatedJob.isWalkInInterview) {
                        if (!translatedJob.isSame) {
                            try {
                                walkInAddress1 = await commonFunctions.Handlers.translate(translatedJob.walkInInterviewAddress.address1, 'en', checkLanguage.language);
                            } catch (e) {
                                console.log(e);
                            }
                            if (address1 && address1.translatedText) {
                                translatedJob.walkInInterviewAddress.address1 = address1.translatedText;
                            }

                            if (translatedJob.address.address2) {
                                try {
                                    walkInAddress2 = await commonFunctions.Handlers.translate(translatedJob.walkInInterviewAddress.address2, 'en', checkLanguage.language);
                                } catch (e) {
                                    console.log(e);
                                }
                                if (address2 && address2.translatedText) {
                                    translatedJob.walkInInterviewAddress.address2 = address2.translatedText;
                                }
                            }

                            try {
                                walkInCity = await commonFunctions.Handlers.translate(translatedJob.walkInInterviewAddress.city, 'en', checkLanguage.language);
                            } catch (e) {
                                console.log(e);
                            }
                            if (city && city.translatedText) {
                                translatedJob.walkInInterviewAddress.city = city.translatedText;
                            }

                            try {
                                walkInState = await commonFunctions.Handlers.translate(translatedJob.walkInInterviewAddress.state, 'en', checkLanguage.language);
                            } catch (e) {
                                console.log(e);
                            }
                            if (state && state.translatedText) {
                                translatedJob.walkInInterviewAddress.state = state.translatedText;
                            }
                        } else {
                            translatedJob.walkInInterviewAddress = translatedJob.address;
                        }
                    }

                    try {
                        jobType = await commonFunctions.Handlers.translate(translatedJob.jobType, 'en', checkLanguage.language);
                    } catch (e) {
                        console.log(e);
                    }
                    if (jobType && jobType.translatedText) {
                        translatedJob.jobType = jobType.translatedText;
                    }

                    try {
                        payRate = await commonFunctions.Handlers.translate(translatedJob.payRate.type, 'en', checkLanguage.language);
                    } catch (e) {
                        console.log(e);
                    }
                    if (payRate && payRate.translatedText) {
                        translatedJob.payRate.type = payRate.translatedText;
                    }
                    /* Translate all the skills */
                    const skillsLen = translatedJob.skills.length;
                    let translatedSkills = [];
                    for (let i = 0; i < skillsLen; i++) {
                        try {
                            skill = await commonFunctions.Handlers.translate(translatedJob.skills[i], 'en', checkLanguage.language);
                        } catch (e) {
                            console.log(e);
                        }
                        if (skill && skill.translatedText) {
                            translatedSkills.push(skill.translatedText);
                        }
                    }
                    translatedJob.skills = translatedSkills;
                    translatedJob.skillsLower = translatedSkills;
                    translatedJob.isTranslated = true;
                    translatedJob.translatedLanguage = checkLanguage._id;
                    translatedJob.translatedJobs = [];

                    delete translatedJob._id;
                    /* Save the translated job into database */
                    let job;
                    try {
                        job = await new jobSchema.jobSchema(translatedJob).save();
                    } catch (e) {
                        console.log(e);
                        logger.error('Error occurred while saving translated job data in edit job handler %s:', JSON.stringify(e));
                    }
                    jobIds.push(job._id);

                    /* Update subscription */
                    if (!subscriptionData.numberOfJobTranslations.isUnlimited) {
                        try {
                            await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: subscriptionData._id}, {$inc: {'numberOfJobTranslations.count': -1}}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred while updating subscription data in edit job handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }
                    }
                }
            }
        }
    }

    dataToUpdate.translatedJobs = (dataToUpdate.translatedJobs ? dataToUpdate.translatedJobs.concat(jobIds) : []);

    /* Update the already translated jobs */
    const alreadyTranslatedJobs = checkJob.translatedJobs.length;
    let jobTitleChanged, jobDescriptionChanged, addressChanged, walkInAddressChanged, skillsChanged,
        payRateChanged, jobTypeChanged;

    if (checkJob.jobTitle !== request.payload.jobTitle) {
        jobTitleChanged = true;
    }
    if (checkJob.jobDescriptionText !== request.payload.jobDescriptionText) {
        jobDescriptionChanged = true;
    }
    if ((checkJob.address.address1 !== request.payload.address.address1) ||
        (checkJob.address.address2 !== request.payload.address.address2) ||
        (checkJob.address.city !== request.payload.address.city) ||
        (checkJob.address.state !== request.payload.address.state)) {
        addressChanged = true;
    }
    if ((checkJob.walkInInterviewAddress.address1 !== request.payload.walkInInterviewAddress.address1) ||
        (checkJob.walkInInterviewAddress.address2 !== request.payload.walkInInterviewAddress.address2) ||
        (checkJob.walkInInterviewAddress.city !== request.payload.walkInInterviewAddress.city) ||
        (checkJob.walkInInterviewAddress.state !== request.payload.walkInInterviewAddress.state)) {
        walkInAddressChanged = true;
    }
    if (checkJob.payRate.type !== request.payload.payRate.type) {
        payRateChanged = true;
    }
    if (checkJob.jobType !== request.payload.jobType) {
        jobTypeChanged = true;
    }
    if (JSON.stringify(checkJob.skillsLower) !== JSON.stringify(dataToUpdate.skillsLower)) {
        skillsChanged = true;
    }

    if (checkJob.translatedJobs) {
        for (let i = 0; i < checkJob.translatedJobs.length; i++) {
            let jobData;
            try {
                jobData = await jobSchema.jobSchema.findById({_id: checkJob.translatedJobs[i]}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding job data in update job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (jobData) {
                let checkLanguage;

                /* Check if the given language is provided by EZJobs */
                try {
                    checkLanguage = await languageSchema.languageSchema.findById({_id: jobData.translatedLanguage}, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding language data in edit job handler %s:', JSON.stringify(e));
                }

                let translatedJob = JSON.parse(JSON.stringify(jobData)), jobTitle, jobDescription, address1, address2, city,
                    state, walkInAddress1, walkInAddress2, walkInCity, walkInState, jobType, payRate, skill;

                delete translatedJob._id;

                if (jobTitleChanged) {
                    try {
                        jobTitle = await commonFunctions.Handlers.translate(request.payload.jobTitle, 'en', checkLanguage.language);
                    } catch (e) {
                        console.log(e);
                    }
                    if (jobTitle && jobTitle.translatedText) {
                        translatedJob.jobTitle = jobTitle.translatedText;
                    }
                }

                if (jobDescriptionChanged) {
                    try {
                        jobDescription = await commonFunctions.Handlers.translate(request.payload.jobDescriptionText, 'en', checkLanguage.language);
                    } catch (e) {
                        console.log(e);
                    }
                    if (jobDescription && jobDescription.translatedText) {
                        translatedJob.jobDescriptionText = jobDescription.translatedText;
                    }
                }

                if (addressChanged) {
                    try {
                        address1 = await commonFunctions.Handlers.translate(request.payload.address.address1, 'en', checkLanguage.language);
                    } catch (e) {
                        console.log(e);
                    }
                    if (address1 && address1.translatedText) {
                        translatedJob.address.address1 = address1.translatedText;
                    }

                    if (translatedJob.address.address2) {
                        try {
                            address2 = await commonFunctions.Handlers.translate(request.payload.address.address2, 'en', checkLanguage.language);
                        } catch (e) {
                            console.log(e);
                        }
                        if (address2 && address2.translatedText) {
                            translatedJob.address.address2 = address2.translatedText;
                        }
                    }

                    try {
                        city = await commonFunctions.Handlers.translate(request.payload.address.city, 'en', checkLanguage.language);
                    } catch (e) {
                        console.log(e);
                    }
                    if (city && city.translatedText) {
                        translatedJob.address.city = city.translatedText;
                    }

                    try {
                        state = await commonFunctions.Handlers.translate(request.payload.address.state, 'en', checkLanguage.language);
                    } catch (e) {
                        console.log(e);
                    }
                    if (state && state.translatedText) {
                        translatedJob.address.state = state.translatedText;
                    }
                }

                if (request.payload.isWalkInInterview && walkInAddressChanged) {
                    if (!request.payload.isSame) {
                        try {
                            walkInAddress1 = await commonFunctions.Handlers.translate(request.payload.walkInInterviewAddress.address1, 'en', checkLanguage.language);
                        } catch (e) {
                            console.log(e);
                        }
                        if (address1 && address1.translatedText) {
                            translatedJob.walkInInterviewAddress.address1 = address1.translatedText;
                        }

                        if (request.payload.walkInInterviewAddress.address2) {
                            try {
                                walkInAddress2 = await commonFunctions.Handlers.translate(request.payload.walkInInterviewAddress.address2, 'en', checkLanguage.language);
                            } catch (e) {
                                console.log(e);
                            }
                            if (address2 && address2.translatedText) {
                                translatedJob.walkInInterviewAddress.address2 = address2.translatedText;
                            }
                        }

                        try {
                            walkInCity = await commonFunctions.Handlers.translate(request.payload.walkInInterviewAddress.city, 'en', checkLanguage.language);
                        } catch (e) {
                            console.log(e);
                        }
                        if (city && city.translatedText) {
                            translatedJob.walkInInterviewAddress.city = city.translatedText;
                        }

                        try {
                            walkInState = await commonFunctions.Handlers.translate(request.payload.walkInInterviewAddress.state, 'en', checkLanguage.language);
                        } catch (e) {
                            console.log(e);
                        }
                        if (state && state.translatedText) {
                            translatedJob.walkInInterviewAddress.state = state.translatedText;
                        }
                    } else {
                        translatedJob.walkInInterviewAddress = request.payload.address;
                    }
                }

                if (jobTypeChanged) {
                    try {
                        jobType = await commonFunctions.Handlers.translate(request.payload.jobType, 'en', checkLanguage.language);
                    } catch (e) {
                        console.log(e);
                    }
                    if (jobType && jobType.translatedText) {
                        translatedJob.jobType = jobType.translatedText;
                    }
                }

                if (payRateChanged) {
                    try {
                        payRate = await commonFunctions.Handlers.translate(request.payload.payRate.type, 'en', checkLanguage.language);
                    } catch (e) {
                        console.log(e);
                    }
                    if (payRate && payRate.translatedText) {
                        translatedJob.payRate.type = payRate.translatedText;
                    }
                }

                if (skillsChanged) {
                    /* Translate all the skills */
                    const skillsLen = request.payload.skills.length;
                    let translatedSkills = [];
                    for (let i = 0; i < skillsLen; i++) {
                        try {
                            skill = await commonFunctions.Handlers.translate(request.payload.skills[i], 'en', checkLanguage.language);
                        } catch (e) {
                            console.log(e);
                        }
                        if (skill && skill.translatedText) {
                            translatedSkills.push(skill.translatedText);
                        }
                    }
                    translatedJob.skills = translatedSkills;
                    translatedJob.skillsLower = translatedSkills;
                }


                delete translatedJob._id;
                /* Update the translated job into database */
                try {
                    await jobSchema.jobSchema.findByIdAndUpdate({_id: checkJob.translatedJobs[i]}, {$set: translatedJob}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while updating translated job data in edit job handler %s:', JSON.stringify(e));
                }
            }
        }
    }

    /* Check to whom the job is exposed */
    if (request.payload.isExposedToAll) {
        dataToUpdate.isExposedToCommunity = false;
        dataToUpdate.isExposedToGroups = false;
    } else if (request.payload.isExposedToCommunity) {
        if (!checkUser.membership) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not part of any community. So, you can not post this job to any community.', 'error', 400)).code(400);
        }
        dataToUpdate.isExposedToAll = false;
        dataToUpdate.isExposedToGroups = false;
        dataToUpdate.membership = checkUser.membership;

        /* Get all the members of community */
        let communityMembers = [];
        try {
            communityMembers = await userSchema.UserSchema.find({_id: {$ne: mongoose.Types.ObjectId(request.payload.userId)}, isPa: true, membership: checkUser.membership}, {_id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding community members in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        dataToUpdate.exposedTo = communityMembers.map(k => k._id);
    } else if (request.payload.isExposedToGroups) {
        dataToUpdate.isExposedToAll = false;
        dataToUpdate.isExposedToCommunity = false;
        if (request.payload.groupIds && request.payload.groupIds.length) {
            request.payload.groupIds = request.payload.groupIds.map(k => mongoose.Types.ObjectId(k));
            /* Get all the members of group */
            let employers = [];
            try {
                employers = await groupSchema.groupSchema.find({_id: {$in: request.payload.groupIds}, userId: mongoose.Types.ObjectId(request.payload.userId), isJob: true}, {members: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding group members in create job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            const temp = employers.map(k => k.members);
            dataToUpdate.exposedTo = [].concat.apply([], temp);
        }
    }

    try {
        await jobSchema.jobSchema.findByIdAndUpdate({_id: request.payload.jobId}, {$set: dataToUpdate}, {
            lean: true,
            new: true
        });
    } catch (e) {
        logger.error('Error occurred while updating job data in update job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get & Update min max salary collection */
    /*if (request.payload.payRate.type && request.payload.payRate.value) {
        try {
            salary = await minMaxSalarySchema.minMaxSalarySchema.findOne({country: request.payload.country, type: request.payload.payRate.type.toLowerCase(), role: 'job'}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting minmax salary counts in create job handler %s:', JSON.stringify(e));
        }
        if (salary) {
            if ((request.payload.payRate.value < salary.min) || (request.payload.payRate.value > salary.max)) {
                let updateValue = {};
                if (request.payload.payRate.value < salary.min) {
                    updateValue = {
                        $set: {min: request.payload.payRate.value, role: 'job', type: request.payload.payRate.type.toLowerCase()}
                    }
                } else {
                    updateValue = {
                        $set: {max: request.payload.payRate.value, role: 'job', type: request.payload.payRate.type.toLowerCase()}
                    }
                }
                try {
                    await minMaxSalarySchema.minMaxSalarySchema.findOneAndUpdate({country: request.payload.country, type: request.payload.payRate.type.toLowerCase(), role: 'job'}, updateValue, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while updating minmax salary counts in create job handler %s:', JSON.stringify(e));
                }
            }
        } else {
            try {
                await minMaxSalarySchema.minMaxSalarySchema.findOneAndUpdate({country: request.payload.country, type: request.payload.payRate.type.toLowerCase(), role: 'job'}, {$set: {min: request.payload.payRate.value, role: 'job', type: request.payload.payRate.type.toLowerCase(), max: request.payload.payRate.value}}, {lean: true, upsert: true});
            } catch (e) {
                logger.error('Error occurred while updating minmax salary counts in create job handler %s:', JSON.stringify(e));
            }
        }
    }*/

    /* Send email if it is under review */
    if (dataToUpdate.isUnderReview) {
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
                        name: 'jobTitle',
                        content: checkJob.jobTitle
                    },
                    {
                        name: 'companyName',
                        content: checkUser.employerInformation.companyName
                    }
                ]
            }]
        };
        await mandrill.Handlers.sendTemplate('under-review', [], email, true);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Job data updated successfully', 'success', 204)).code(200);
};

employerHandler.getCandidates = async (request, h) => {
    let aggregationCriteria = [], searchCriteria = {}, candidates = [], favourites, constantData, userData,
        totalCount = 0, masterUser;

    /* Get user data */
    if (request.query.userId) {
        try {
            userData = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding user data in get candidates handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (userData.isMaster) {
            userData.slaveUsers.push(userData._id);
        } else {
            try {
                masterUser = await userSchema.UserSchema.findOne({slaveUsers: mongoose.Types.ObjectId(request.query.userId)}, {
                    _id: 1,
                    slaveUsers: 1
                }, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding master user data in get candidates handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            masterUser.slaveUsers.push(masterUser._id);
        }
    }

    searchCriteria['employeeInformation.isComplete'] = true;
    searchCriteria['employeeInformation.preferredLocationCities.country'] = request.query.country;
    searchCriteria.isActive = true;
    searchCriteria.privacyType = 'standard';

    if (request.query.isStudent) {
        searchCriteria['employeeInformation.isStudent'] = true;
    }

    /* Salary based filtering */
    if (request.query.salaryType) {
        searchCriteria['employeeInformation.expectedSalaryType'] = new RegExp(request.query.salaryType, 'gi');
        searchCriteria['employeeInformation.expectedSalary'] = {$gte: request.query.salaryMin, $lte: request.query.salaryMax};
    }

    /* Check if memberships are provided */
    if (request.query.memberships && request.query.memberships.length) {
        searchCriteria['membership'] = {$in: request.query.memberships};
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
            ids = ids.concat(masterUser.slaveUsers)
        }
        searchCriteria['_id'] = {$nin: ids};

        if (userData.membership) {
            searchCriteria['$or'] = [{membership: userData.membership}, {additionalMemberships: mongoose.Types.ObjectId(userData.membership)}];
        }
    } else if (request.query.type === 'group') {
        let members;
        /* Get members of groups */
        try {
            members = await groupSchema.groupSchema.find({userId: mongoose.Types.ObjectId(userData._id), isActive: true}, {members: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding groups in get candidates handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        for (let i = 0; i < members.length; i++) {
            members[i].members = members[i].members.map(k => k.toString());
            ids = commonFunctions.Handlers.arrayUnique(ids, members[i].members);
        }

        ids = ids.map(k => mongoose.Types.ObjectId(k));
        searchCriteria['paId'] = {$in: ids};
    }

    /* Fetch constant data */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching constant data in update job handler %s:', JSON.stringify(e));
    }

    if (request.query.radius && !request.query.isEverywhere) {
        aggregationCriteria.push({
            $geoNear: {
                near: {
                    type: 'MultiPoint',
                    coordinates: [Number(request.query.longitude), Number(request.query.latitude)]
                },
                key: 'employeeInformation.preferredLocations',
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
                    type: 'MultiPoint',
                    coordinates: [Number(request.query.longitude), Number(request.query.latitude)]
                },
                key: 'employeeInformation.preferredLocations',
                distanceField: 'distance',
                spherical: true,
                query: searchCriteria
            }
        });
    }

    /* Filters for profile based on experience */
    if (typeof (request.query.experienceMin) === 'number' && typeof request.query.experienceMax === 'number') {
        aggregationCriteria.push({$match: {'employeeInformation.experienceInMonths': {$lte: request.query.experienceMax, $gte: request.query.experienceMin}}});
    }

    /* New criteria for preference screen */
    if (userData) {
        if (userData.employerInformation.preference && userData.employerInformation.preference.length && !request.query.searchText) {
            aggregationCriteria.push({
                $match: {
                    $or: [
                        {
                            'employeeInformation.preference': {$in: userData.employerInformation.preference}
                        }
                    ]
                }
            });
        }
    }


    /* Filter based on languages */
    if (request.query.languageIds && request.query.languageIds.length) {
        let criteria = {$match: {$or: []}};
        for (let i = 0 ; i < request.query.languageIds.length; i++) {
            criteria.$match.$or.push(
                {
                    'employeeInformation.languages._id': mongoose.Types.ObjectId(request.query.languageIds[i])
                }
            );
        }
        aggregationCriteria.push(criteria);
    }

    if (request.query.userId) {
        aggregationCriteria.push({$match: {_id: {$ne: mongoose.Types.ObjectId(request.query.userId)}, blockedBy: {$nin: [mongoose.Types.ObjectId(request.query.userId)]}}});
    }

    /* Job type filtering if any */
    if (request.query.jobType) {
        searchCriteria['employeeInformation.jobType'] = {$in: request.query.jobType};
    }

    /* Filter based on interns */
    if (request.query.isInternship) {
        searchCriteria['employeeInformation.isInternship'] = true;
    }

    /* Gender filtering */
    if (request.query.gender) {
        let criteria = {$match: {$or: []}};
        for (let i = 0; i < request.query.gender.length; i++) {
            criteria.$match.$or.push({gender: request.query.gender[i].toLowerCase()});
        }
        aggregationCriteria.push(criteria);
    }

    /* With resume filter */
    if (request.query.withResume) {
        aggregationCriteria.push({$match: {'employeeInformation.resume': {$ne: ''}}});
    }

    if (request.query.withPhoto && request.query.withVideo) {
        let criteria = {$match: {$or: []}};
        /*criteria.$match.$or.push({
            'employeeInformation.profilePhoto': {$ne: ''}
        });*/
        criteria.$match.$or.push({
            'employeeInformation.description.video': {$ne: ''}
        });
        aggregationCriteria.push(criteria);
    } else {
        /* With Photo filter */
        if (request.query.withPhoto) {
            aggregationCriteria.push({$match: {'employeeInformation.profilePhoto': {$ne: ''}}});
        }

        /* With Video introduction filter */
        if (request.query.withVideo) {
            aggregationCriteria.push({$match: {'employeeInformation.description.video': {$ne: ''}}});
        }
    }

    /* With education filter provided */
    if (request.query.education) {
        let criteria = {$match: {$or: []}};
        for (let i = 0; i < request.query.education.length; i++) {
            criteria.$match.$or.push({
                'employeeInformation.education.level': {$all: [new RegExp(request.query.education[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
            });
        }
        aggregationCriteria.push(criteria);
    }

    /* With keywords provided */
    if (request.query.keywords) {
        let criteria ;
        if (request.query.isAny) {
            criteria = {$match: {$or: []}};
            for (let i = 0; i < request.query.keywords.length; i++) {
                criteria.$match.$or.push(
                    {
                        'employeeInformation.skills': {$all: [new RegExp(request.query.keywords[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                    },
                    {
                        'employeeInformation.description.text': {$all: [new RegExp(request.query.keywords[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                    },
                    {
                        'employeeInformation.pastJobTitlesModified.designation': {$all: [new RegExp(request.query.keywords[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                    },
                    {
                        'employeeInformation.futureJobTitles': {$all: [new RegExp(request.query.keywords[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                    }
                );
            }
        } else {
            criteria = {$match: {$and: []}};
            for (let i = 0; i < request.query.keywords.length; i++) {
                criteria.$match.$and.push({$or: [
                        {
                            'employeeInformation.skills': {$all: [new RegExp(request.query.keywords[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                        },
                        {
                            'employeeInformation.description.text': {$all: [new RegExp(request.query.keywords[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                        },
                        {
                            'employeeInformation.pastJobTitles': {$all: [new RegExp(request.query.keywords[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                        },
                        {
                            'employeeInformation.futureJobTitles': {$all: [new RegExp(request.query.keywords[i].replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                        }
                    ]});
            }
        }
        aggregationCriteria.push(criteria);
    }

    /* If isOnline filter is given */
    if (request.query.isOnline) {
        aggregationCriteria.push({$match: {isOnline: true}});
    }

    /* Define skip, limit and sort for another view */
    if (request.query.sortCriteria === 'lastActive') {
        aggregationCriteria.push({
            $sort: {
                lastOnline: request.query.sortType === 'desc' ? 1 : -1
            }
        });
    } else if (request.query.sortCriteria === 'experience') {
        aggregationCriteria.push({
            $sort: {
                'employeeInformation.experienceInMonths': request.query.sortType === 'desc' ? -1 : 1
            }
        });
    } else if (request.query.sortCriteria === 'distance') {
        if (request.query.sortType === 'desc') {
            aggregationCriteria.push({
                $sort: {
                    'distance': -1
                }
            });
        }
    }

    /* Define search criteria if searching */
    let facetCriteria = [];
    if (request.query.searchText) {
        let converted = [], matchCriteria = [];
        converted.push(new RegExp((pluralize(request.query.searchText)).replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi'));
        converted.push(new RegExp((pluralize.singular(request.query.searchText)).replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi'));
        if (request.query.searchCriteria && request.query.searchCriteria.length) {
            for (let i = 0; i < request.query.searchCriteria.length; i++) {
                if (request.query.searchCriteria[i].key && request.query.searchCriteria[i].key === 'jobTitle' && request.query.searchCriteria[i].isSelected) {
                    matchCriteria.push({'employeeInformation.pastJobTitles': {$in: converted}});
                    matchCriteria.push({'employeeInformation.futureJobTitles': {$in: converted}});
                }
                if (request.query.searchCriteria[i].key && request.query.searchCriteria[i].key === 'skills' && request.query.searchCriteria[i].isSelected) {
                    matchCriteria.push({'employeeInformation.skills': {$in: converted}});
                }
                if (request.query.searchCriteria[i].key && request.query.searchCriteria[i].key === 'selfIntroduction' && request.query.searchCriteria[i].isSelected) {
                    matchCriteria.push({'employeeInformation.description.text': {$in: converted}});
                }
            }
            aggregationCriteria.push({
                $match: {$or: matchCriteria}
            });
        } else {
            aggregationCriteria.push({
                $match: {
                    $or: [
                        {
                            'employeeInformation.skills': {$in: converted}
                        },
                        {
                            'employeeInformation.description.text': {$in: converted}
                        },
                        {
                            'employeeInformation.pastJobTitles': {$in: converted}
                        },
                        {
                            'employeeInformation.futureJobTitles': {$in: converted}
                        }
                    ]
                }
            });
        }
    }

    if (request.query.isEverywhere) {
        aggregationCriteria.push({$skip: request.query.skip});
        aggregationCriteria.push({$limit: request.query.limit});


        aggregationCriteria.push({
            $lookup: {
                from: "Views",
                let: {userIds: userData.isMaster ? userData.slaveUsers : masterUser.slaveUsers, candidateId: '$_id'},
                pipeline: [
                    {$match: {$expr: {$and: [{$eq: ["$candidateId", "$$candidateId"]}, {$in: ["$employerId", '$$userIds']}]}}},
                    {$project: {_id: 1}}
                ],
                as: "view"
            }
        });

        /* Project fields */
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
                subLocality: '$employeeInformation.address.subLocality',
                pastJobTitles: '$employeeInformation.pastJobTitles',
                futureJobTitles: '$employeeInformation.futureJobTitles',
                isStudent: '$employeeInformation.isStudent',
                isOnline: 1,
                resume: '$employeeInformation.resume',
                selfIntroductionVideo: '$employeeInformation.description.video',
                membership: 1,
                expectedSalary: '$employeeInformation.expectedSalary',
                expectedSalaryType: '$employeeInformation.expectedSalaryType',
                country: '$employeeInformation.country',
                lastOnline: 1,
                skills: '$employeeInformation.skills',
                pastJobTitlesModified: '$employeeInformation.pastJobTitlesModified',
                preferredLocations: '$employeeInformation.preferredLocations.coordinates',
                preferredLocationCities: '$employeeInformation.preferredLocationCities',
                isViewed: {
                    $cond: [
                        {
                            $gt: [
                                {
                                    $size: '$view'
                                },
                                0
                            ]
                        },
                        true,
                        false
                    ]
                }
            }
        });
    } else {
        facetCriteria.push({$skip: request.query.skip});
        facetCriteria.push({$limit: request.query.limit});

        if (userData) {
            facetCriteria.push({
                $lookup: {
                    from: "Views",
                    let: {
                        userIds: userData.isMaster ? userData.slaveUsers : masterUser.slaveUsers,
                        candidateId: '$_id'
                    },
                    pipeline: [
                        {$match: {$expr: {$and: [{$eq: ["$candidateId", "$$candidateId"]}, {$in: ["$employerId", '$$userIds']}]}}},
                        {$project: {_id: 1}}
                    ],
                    as: "view"
                }
            });
        }

        /* Project fields */
        if (userData) {
            facetCriteria.push({
                $project: {
                    _id: 1,
                    firstName: 1,
                    lastName: 1,
                    experienceInMonths: '$employeeInformation.experienceInMonths',
                    profilePhoto: '$employeeInformation.profilePhoto',
                    description: '$employeeInformation.description.text',
                    city: '$employeeInformation.address.city',
                    state: '$employeeInformation.address.state',
                    subLocality: '$employeeInformation.address.subLocality',
                    pastJobTitles: '$employeeInformation.pastJobTitles',
                    futureJobTitles: '$employeeInformation.futureJobTitles',
                    isStudent: '$employeeInformation.isStudent',
                    isOnline: 1,
                    resume: '$employeeInformation.resume',
                    selfIntroductionVideo: '$employeeInformation.description.video',
                    membership: 1,
                    expectedSalary: '$employeeInformation.expectedSalary',
                    expectedSalaryType: '$employeeInformation.expectedSalaryType',
                    country: '$employeeInformation.country',
                    lastOnline: 1,
                    skills: '$employeeInformation.skills',
                    pastJobTitlesModified: '$employeeInformation.pastJobTitlesModified',
                    preferredLocations: '$employeeInformation.preferredLocations.coordinates',
                    preferredLocationCities: '$employeeInformation.preferredLocationCities',
                    isViewed: {
                        $cond: [
                            {
                                $gt: [
                                    {
                                        $size: '$view'
                                    },
                                    0
                                ]
                            },
                            true,
                            false
                        ]
                    }
                }
            });
        } else {
            facetCriteria.push({
                $project: {
                    _id: 1,
                    firstName: 1,
                    lastName: 1,
                    experienceInMonths: '$employeeInformation.experienceInMonths',
                    resume: '$employeeInformation.resume',
                    lastOnline: 1,
                    phone: '$employeeInformation.phone',
                    email: 1
                }
            });
        }

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
    }

    try {
        candidates = await userSchema.UserSchema.aggregate(aggregationCriteria).allowDiskUse(true);
    } catch (e) {
        logger.error('Error occurred while getting all users in get candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (candidates[0] && candidates[0].count) {
        totalCount = candidates[0].count[0]? candidates[0].count[0].count : 0;
        candidates = candidates[0].candidates;
    }

    let checkSubscription;
    if (userData && userData.country !== 'US') {
        /* Check if the employer is free employer or paid */
        try {
            checkSubscription = await packageSchema.packageSchema.findById({_id: userData.subscriptionInfo.packageId}, {isFree: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred checking user package in get candidates handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    let candidateIds = [], memberships = [];
    for (let i = 0; i < candidates.length; i++) {
        candidateIds.push(mongoose.Types.ObjectId(candidates[i]._id));
        /* Find memberships logo */
        if (candidates[i].membership) {
            const idx = memberships.findIndex(k => k._id === candidates[i].membership.toString());
            if (idx === -1) {
                let admin;
                try {
                    admin = await userSchema.UserSchema.findOne({isPaAdmin: true, membership: candidates[i].membership}, {employerInformation: 1}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding membership logo in get jobs handler %s:', JSON.stringify(e));
                }
                if (admin) {
                    memberships.push({_id: candidates[i].membership.toString(), photo: admin.employerInformation.companyProfilePhoto});
                    candidates[i].membershipLogo = admin.employerInformation.companyProfilePhoto;
                }
            } else {
                candidates[i].membershipLogo = memberships[idx].photo;
            }
        }

        /* Remove resume if free user */
        if ((!checkSubscription || checkSubscription.isFree) && (userData && userData.country !== 'US')) {
            candidates[i].resume = '';
        }
    }

    /* Increase the search count of all candidates by 1 */
    let bulk = userSchema.UserSchema.collection.initializeUnorderedBulkOp();
    bulk
        .find({_id: {$in: candidateIds}})
        .update({$inc: {'employeeInformation.searchAppearances': 1}});
    try {
        await bulk.execute();
    } catch (e) {
        logger.error('Error occurred while updating candidates search appearances count in get jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Fetch all the items in the favourite list of the user and update the jobs data */
    if (request.query.userId) {
        try {
            favourites = await favouriteCandidateSchema.favouriteCandidateSchema.find({userId: mongoose.Types.ObjectId(request.query.userId)}, {candidateId: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting all favourite list candidates in get jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (favourites && favourites.length) {
            for (let i = 0; i < candidates.length; i++) {
                const idx = favourites.findIndex(j => j.candidateId.toString() === candidates[i]._id.toString());
                candidates[i]['isFavourite'] = (idx !== -1);
            }
        }
    }

    return h.response(responseFormatter.responseFormatter(candidates, 'Fetched successfully', 'success', 200, totalCount)).code(200);
};

/*employerHandler.parseResume = async (request, h) => {
    let file, d;
    xxx.fromFileWithPath(request.payload.resume.path, {preserveLineBreaks: true}, function (err, text) {
        if (err) {
            return h.response(responseFormatter.responseFormatter({}, 'Error occurred', 'error', 500)).code(500);
        } else {
            console.log(Path.dirname(require.main.filename));
            fs.writeFile(Path.dirname(require.main.filename) + '/public/temp1.txt', text, async function (err) {
                if (err) {

                } else {
                    try {
                        file = await resumeParser.parseResume(Path.dirname(require.main.filename) + '/public/temp1.txt', Path.dirname(require.main.filename) + '/public');
                    } catch (e) {
                    }
                    if (file) {
                        fs.readFile(Path.dirname(require.main.filename) + '/public/temp1.txt.json', function (err, data) {
                            if (data) {
                                d = data;
                                return h.response(responseFormatter.responseFormatter(d, 'Fetched successfully', 'success', 200)).code(200);
                            }
                        })
                    }
                }
            });
        }
    });
};*/

employerHandler.getActiveJobs = async (request, h) => {
    let checkUser, decoded, jobs = [], matchCriteria;

    /* Check whether user exists in database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.userId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user data in get active jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check if user is the same who is trying to access */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get active jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check if account is master */
    let userIds = [];
    if (checkUser.isMaster) {
        userIds.push(checkUser._id);
        userIds = userIds.concat(checkUser.slaveUsers);
    } else {
        userIds.push(checkUser._id);
    }

    matchCriteria = {
        userId: {$in: userIds},
        isArchived: false,
        isExpired: false,
        isTranslated: false,
        isVisible: true
    };

    if (request.query.searchText) {
        matchCriteria.$or = [
            {
                'jobDescriptionText': {$all: [new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
            },
            {
                'jobTitle': {$all: [new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
            },
            {
                'subJobTitle': {$all: [new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
            }
        ];
    }

    /* If category id is provided */
    if (request.query.categoryId) {
        matchCriteria.categoryId = mongoose.Types.ObjectId(request.query.categoryId);
    }

    /* If filter criteria is provided */
    if (request.query.filterCriteria) {
        if (request.query.filterCriteria === '24hr') {
            matchCriteria.createdAt = {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(24, 'hours').toISOString())}
        } else if (request.query.filterCriteria === '7d') {
            matchCriteria.createdAt = {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(7, 'days').toISOString())}
        } else if (request.query.filterCriteria === '30d') {
            matchCriteria.createdAt = {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(30, 'days').toISOString())}
        }
    }

    /* Find all jobs posted by the user */
    try {
        jobs = await jobSchema.jobSchema.aggregate([
            {
                $match: matchCriteria
            },
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
                    from: 'User',
                    localField: 'userId',
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
                    userId: 1,
                    postedBy: {$concat: ['$employer.firstName', ' ', '$employer.lastName']},
                    location: 1,
                    city: '$address.city',
                    state: '$address.state',
                    subLocality: '$address.subLocality',
                    jobTitle: 1,
                    subJobTitle: 1,
                    totalViews: 1,
                    uniqueViews: {$size: '$uniqueViews'},
                    latitude: {$arrayElemAt: ['$location.coordinates', 1]},
                    longitude: {$arrayElemAt: ['$location.coordinates', 0]},
                    isUnderReview: 1,
                    isTranslated: 1,
                    numberOfPositions: 1,
                    jobType: 1,
                    address: 1
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred while aggregating on jobs in get active jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!jobs.length) {
        return h.response(responseFormatter.responseFormatter([], 'No active jobs yet', 'success', 200)).code(200);
    }

    /* Loop through all the jobs & Define aggregation criteria */
    for (let i = 0; i < jobs.length; i++) {
        let applications = 0;

        /* Counting number of applications */
        let applicationAggregationCriteria = [
            {
                $match: {
                    jobId: jobs[i]._id,
                    isApplied: true
                }
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
                $match: {
                    'candidate.isActive': true
                }
            },
            {
                $count: 'applications'
            }
        ];
        try {
            applications = await conversationSchema.conversationSchema.aggregate(applicationAggregationCriteria);
            if (applications && applications[0]) {
                applications = applications[0].applications;
            } else {
                applications = 0;
            }
        } catch (e) {
            logger.error('Error occurred while counting applied chats in get active jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Find favourites */

        jobs[i]['matchingProfiles'] = [];
        jobs[i]['applications'] = applications;
    }

    return h.response(responseFormatter.responseFormatter(jobs, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.updateFavouriteList = async (request, h) => {
    let checkUser, decoded, status;

    /* Check whether user exists in database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.userId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user data in update favourite candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check if it is already favourite */
    try {
        status = await favouriteCandidateSchema.favouriteCandidateSchema.findOne({ userId: mongoose.Types.ObjectId(request.payload.userId),
            candidateId: mongoose.Types.ObjectId(request.payload.candidateId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching favourite data in update favourite candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (request.payload.isFavourite && status) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not make this candidate as favourite more than once', 'error', 400)).code(400);
    }

    /* Check if user is the same who is trying to access */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update favourite candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* If isFavourite flag is false then remove thar listing from favourite list otherwise add it into the database */
    if (request.payload.isFavourite) {
        const dataToSave = {
            userId: mongoose.Types.ObjectId(request.payload.userId),
            candidateId: mongoose.Types.ObjectId(request.payload.candidateId)
        };
        try {
            await new favouriteCandidateSchema.favouriteCandidateSchema(dataToSave).save();
        } catch (e) {
            logger.error('Error occurred saving favourite list in update favourite candidate list handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        return h.response(responseFormatter.responseFormatter({}, 'Added to Shortlisted List', 'success', 201)).code(201);
    } else {
        const dataToRemove = {
            userId: mongoose.Types.ObjectId(request.payload.userId),
            candidateId: mongoose.Types.ObjectId(request.payload.candidateId)
        };
        let removed;
        try {
            removed = await favouriteCandidateSchema.favouriteCandidateSchema.findOneAndDelete(dataToRemove);
        } catch (e) {
            logger.error('Error occurred removing favourite list in update favourite candidate list handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!removed) {
            return h.response(responseFormatter.responseFormatter({}, 'Candidate not found in shortlisted list', 'error', 404)).code(404);
        }
        return h.response(responseFormatter.responseFormatter({}, 'Removed from Shortlisted List', 'success', 200)).code(200);
    }
};

employerHandler.getFavouriteList = async (request, h) => {
    let decoded, checkUser, favourite, aggregationCriteria, masterUser, addedUsers;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in get favourite list candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get favourite list candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    if (checkUser.isMaster) {
        checkUser.slaveUsers.push(checkUser._id);
        addedUsers = checkUser.slaveUsers;
    } else {
        try {
            masterUser = await userSchema.UserSchema.findOne({slaveUsers: mongoose.Types.ObjectId(request.query.userId)}, {
                _id: 1,
                slaveUsers: 1
            }, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding master user data in get favourite list candidate handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        masterUser.slaveUsers.push(masterUser._id);
        addedUsers = masterUser.slaveUsers;
    }

    /* Fetch all the listings from the favourite list for that user */
    if (!request.query.searchText) {
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
                    localField: 'candidateId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: '$user'
            },
            {
                $match: {
                    'user.privacyType': {$ne: 'limited'}
                }
            }
        ];

        /* If experience min/max value is given */
        if (Object.prototype.hasOwnProperty.call(request.query, 'experienceMax')) {
            aggregationCriteria.push({$match: {'user.employeeInformation.experienceInMonths': {$gte: request.query.experienceMin, $lte: request.query.experienceMax}}});
        }

        /* If Salary range is given */
        if (request.query.salaryMax) {
            aggregationCriteria.push({$match: {'user.employeeInformation.expectedSalary': {$gte: request.query.salaryMin, $lte: request.query.salaryMax}}});
        }

        /* If student parameter is given */
        if (request.query.isStudent) {
            aggregationCriteria.push({$match: {'user.employeeInformation.isStudent': request.query.isStudent}});
        }

        /* Gender filtering */
        if (request.query.gender) {
            aggregationCriteria.push({$match: {'user.gender': request.query.gender}});
        }

        aggregationCriteria.push({$sort: {_id: -1}});
        aggregationCriteria.push({$skip: request.query.skip});
        aggregationCriteria.push({$limit: request.query.limit});
        aggregationCriteria.push({
            $lookup: {
                from: "Views",
                let: {userIds: addedUsers, candidateId: '$candidateId'},
                pipeline: [
                    {$match: {$expr: {$and: [{$eq: ["$candidateId", "$$candidateId"]}, {$in: ["$employerId", '$$userIds']}]}}},
                    {$project: {_id: 1}}
                ],
                as: "view"
            }
        });
        aggregationCriteria.push({
            $project: {
                _id: 1,
                candidateId: 1,
                firstName: '$user.firstName',
                lastName: '$user.lastName',
                experienceInMonths: '$user.employeeInformation.experienceInMonths',
                profilePhoto: '$user.employeeInformation.profilePhoto',
                description: '$user.employeeInformation.description.text',
                city: '$user.employeeInformation.address.city',
                state: '$user.employeeInformation.address.state',
                subLocality: '$user.employeeInformation.address.subLocality',
                pastJobTitles: '$user.employeeInformation.pastJobTitles',
                pastJobTitlesModified: '$user.employeeInformation.pastJobTitlesModified',
                futureJobTitles: '$user.employeeInformation.futureJobTitles',
                isStudent: '$user.employeeInformation.isStudent',
                isFavourite: 1,
                preferredLocationCities: '$user.employeeInformation.preferredLocationCities',
                preferredLocations: '$user.employeeInformation.preferredLocations',
                isViewed: {
                    $cond: [
                        {
                            $gt: [
                                {
                                    $size: '$view'
                                },
                                0
                            ]
                        },
                        true,
                        false
                    ]
                }
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
                    localField: 'candidateId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: '$user'
            },
            {
                $match: {
                    $or: [{'user.firstName': new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {'user.lastName': {$all: [new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}}, {'user.employeeInformation.description.text': new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}]
                }
            },
            {
                $match: {
                    'user.privacyType': {$ne: 'limited'}
                }
            }
        ];

        /* Gender filtering */
        if (request.query.gender) {
            aggregationCriteria.push({$match: {'user.gender': request.query.gender}});
        }

        aggregationCriteria.push({$sort: {_id: -1}});
        aggregationCriteria.push({$skip: request.query.skip});
        aggregationCriteria.push({$limit: request.query.limit});
        aggregationCriteria.push({
            $lookup: {
                from: "Views",
                let: {userIds: addedUsers, candidateId: '$candidateId'},
                pipeline: [
                    {$match: {$expr: {$and: [{$eq: ["$candidateId", "$$candidateId"]}, {$in: ["$employerId", '$$userIds']}]}}},
                    {$project: {_id: 1}}
                ],
                as: "view"
            }
        });
        aggregationCriteria.push({
            $project: {
                _id: 1,
                candidateId: 1,
                firstName: '$user.firstName',
                lastName: '$user.lastName',
                experienceInMonths: '$user.employeeInformation.experienceInMonths',
                profilePhoto: '$user.employeeInformation.profilePhoto',
                description: '$user.employeeInformation.description.text',
                city: '$user.employeeInformation.address.city',
                state: '$user.employeeInformation.address.state',
                subLocality: '$user.employeeInformation.address.subLocality',
                pastJobTitles: '$user.employeeInformation.pastJobTitles',
                pastJobTitlesModified: '$user.employeeInformation.pastJobTitlesModified',
                futureJobTitles: '$user.employeeInformation.futureJobTitles',
                isStudent: '$user.employeeInformation.isStudent',
                isFavourite: 1,
                preferredLocationCities: '$user.employeeInformation.preferredLocationCities',
                preferredLocations: '$user.employeeInformation.preferredLocations',
                isViewed: {
                    $cond: [
                        {
                            $gt: [
                                {
                                    $size: '$view'
                                },
                                0
                            ]
                        },
                        true,
                        false
                    ]
                }
            }
        });
    }
    try {
        favourite = await favouriteCandidateSchema.favouriteCandidateSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred fetching favourite list in get favourite list candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(favourite, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.getInvitedList = async (request, h) => {
    let decoded, checkUser, invited, aggregationCriteria, checkJob;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in get invited list employer handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get invited list employer handler %s:', JSON.stringify(e));
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
                    employerId: mongoose.Types.ObjectId(request.query.userId),
                    isInvitationRejected: false,
                    isArchived: false,
                    isRejected: false,
                    isInvited: true,
                    isHired: false
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
                    $or: [{'user.firstName': new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}, {'user.lastName': {$all: [new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}}, {'user.employeeInformation.description.text': new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}]
                }
            }
        ];

        /* If job id is provided */
        if (request.query.jobId) {
            aggregationCriteria.push({$match: {'job._id': mongoose.Types.ObjectId(request.query.jobId)}});
        }

        /* If is student key is provided */
        if (request.query.isStudent) {
            aggregationCriteria.push({$match: {'user.employeeInformation.isStudent': true}});
        }

        /* If experience min/max value is provided */
        if (typeof request.query.experienceMax === 'number') {
            aggregationCriteria.push({
                $match: {
                    'user.employeeInformation.experienceInMonths': {
                        $gte: request.query.experienceMin,
                        $lte: request.query.experienceMax
                    }
                }
            });
        }

        /* Gender filtering */
        if (request.query.gender) {
            aggregationCriteria.push({$match: {'user.gender': request.query.gender}});
        }

        aggregationCriteria.push({$sort: {_id: -1}});
        aggregationCriteria.push({$skip: request.query.skip});
        aggregationCriteria.push({$limit: request.query.limit});
        aggregationCriteria.push({$project: {
                _id: 1,
                jobId: '$job._id',
                jobTitle: '$job.jobTitle',
                subJobTitle: '$job.subJobTitle',
                candidateId: 1,
                firstName: '$user.firstName',
                lastName: '$user.lastName',
                experienceInMonths: '$user.employeeInformation.experienceInMonths',
                profilePhoto: '$user.employeeInformation.profilePhoto',
                description: '$user.employeeInformation.description.text',
                city: '$user.employeeInformation.address.city',
                state: '$user.employeeInformation.address.state',
                subLocality: '$user.employeeInformation.address.subLocality',
                pastJobTitles: '$user.employeeInformation.pastJobTitles',
                pastJobTitlesModified: '$user.employeeInformation.pastJobTitlesModified',
                futureJobTitles: '$user.employeeInformation.futureJobTitles',
                isStudent: '$user.employeeInformation.isStudent',
                preferredLocationCities: '$user.employeeInformation.preferredLocationCities',
                preferredLocations: '$user.employeeInformation.preferredLocations'
        }});
    } else {
        aggregationCriteria = [
            {
                $match: {
                    employerId: mongoose.Types.ObjectId(request.query.userId),
                    isInvitationRejected: false,
                    isArchived: false,
                    isRejected: false,
                    isInvited: true,
                    isHired: false
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
        /* If job id is provided */
        if (request.query.jobId) {
            aggregationCriteria.push({$match: {'job._id': mongoose.Types.ObjectId(request.query.jobId)}});
        }

        /* If is student key is provided */
        if (request.query.isStudent) {
            aggregationCriteria.push({$match: {'user.employeeInformation.isStudent': true}});
        }

        /* If experience min/max value is provided */
        if (typeof request.query.experienceMax === 'number') {
            aggregationCriteria.push({
                $match: {
                    'user.employeeInformation.experienceInMonths': {
                        $gte: request.query.experienceMin,
                        $lte: request.query.experienceMax
                    }
                }
            });
        }

        /* Gender filtering */
        if (request.query.gender) {
            aggregationCriteria.push({$match: {'user.gender': request.query.gender}});
        }

        aggregationCriteria.push({$sort: {_id: -1}});
        aggregationCriteria.push({$skip: request.query.skip});
        aggregationCriteria.push({$limit: request.query.limit});
        aggregationCriteria.push({$project: {
                _id: 1,
                jobId: '$job._id',
                jobTitle: '$job.jobTitle',
                subJobTitle: '$job.subJobTitle',
                candidateId: 1,
                firstName: '$user.firstName',
                lastName: '$user.lastName',
                experienceInMonths: '$user.employeeInformation.experienceInMonths',
                profilePhoto: '$user.employeeInformation.profilePhoto',
                description: '$user.employeeInformation.description.text',
                city: '$user.employeeInformation.address.city',
                state: '$user.employeeInformation.address.state',
                subLocality: '$user.employeeInformation.address.subLocality',
                pastJobTitles: '$user.employeeInformation.pastJobTitles',
                pastJobTitlesModified: '$user.employeeInformation.pastJobTitlesModified',
                futureJobTitles: '$user.employeeInformation.futureJobTitles',
                isStudent: '$user.employeeInformation.isStudent',
                preferredLocationCities: '$user.employeeInformation.preferredLocationCities',
                preferredLocations: '$user.employeeInformation.preferredLocations'
        }});
    }
    try {
        invited = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
    } catch (e) {
        console.log(e);
        logger.error('Error occurred fetching applied list in get favourite list employer handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(invited, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.getJobDetails = async (request, h) => {
    let checkUser, jobData, aggregateCriteria, similarJobs = [], favourites = [], isFavourite = false, status, query, checkJob, dynamicFields = [];

    /* Check whether user is present in database or not */
    if (request.query.userId) {
        try {
            checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
        } catch (e) {
            logger.error('Error occurred finding user information in get job details employer handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkUser) {
            return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
        }
    }

    /* Check if job exists */
    try {
        checkJob =  await jobSchema.jobSchema.findById({_id: request.query.jobId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding job in get invited list employer handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkJob) {
        return h.response(responseFormatter.responseFormatter({}, 'Job not found', 'error', 404)).code(404);
    }

    /* Fetch job details */
    aggregateCriteria = [
        {
            $match: {
                _id: mongoose.Types.ObjectId(request.query.jobId)
            }
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
            $lookup: {
                from: 'Verification',
                localField: 'user.employerInformation.verificationData',
                foreignField: '_id',
                as: 'verification'
            }
        },
        {
            $unwind: {
                path: '$verification',
                preserveNullAndEmptyArrays: true
            }
        },
        {
            $project: {
                _id: 1,
                address: 1,
                location: 1,
                payRate: 1,
                jobTitle: 1,
                subJobTitle: 1,
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
                membership: '$user.membership',
                isExposedToAll: 1,
                isExposedToCommunity: 1,
                isExposedToGroups: 1,
                groupIds: 1,
                jobLength: 1,
                travel: 1,
                jobNotes: 1,
                workAuthorization: 1,
                subJobType: 1,
                companyVerified: '$verification.status',
                inApp: 1,
                createdAt: 1
            }
        },
        {
            $lookup: {
                from: 'Group',
                localField: 'groupIds',
                foreignField: '_id',
                as: 'group'
            }
        },
        {
            $project: {
                _id: 1,
                address: 1,
                location: 1,
                payRate: 1,
                jobTitle: 1,
                subJobTitle: 1,
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
                uniqueViewsArray: 1,
                uniqueViews: 1,
                categoryName: 1,
                categoryId: 1,
                userId: 1,
                companyName: 1,
                companyAddress: 1,
                companyLocation: 1,
                companyDescription: 1,
                companyType: 1,
                companyLogo: 1,
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
                phone: 1,
                countryCode: 1,
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
                membership: 1,
                isExposedToAll: 1,
                isExposedToCommunity: 1,
                isExposedToGroups: 1,
                groupIds: 1,
                group: 1,
                jobLength: 1,
                travel: 1,
                jobNotes: 1,
                workAuthorization: 1,
                subJobType: 1,
                companyVerified: 1,
                inApp: 1,
                createdAt: 1
            }
        }
    ];
    try {
        jobData = await jobSchema.jobSchema.aggregate(aggregateCriteria);
    } catch (e) {
        logger.error('Error occurred finding job in get job details employer handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (jobData.length) {

        /* Get the membership logo if any */
        if (jobData[0].membership) {
            let memberships = [];
            const idx = memberships.findIndex(k => k._id === jobData[0].membership.toString());
            if (idx === -1) {
                let admin;
                try {
                    admin = await userSchema.UserSchema.findOne({isPaAdmin: true, membership: jobData[0].membership}, {employerInformation: 1}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding membership logo in get job details handler %s:', JSON.stringify(e));
                }
                if (admin) {
                    memberships.push({_id: jobData[0].membership.toString(), photo: admin.employerInformation.companyProfilePhoto});
                    jobData[0].membershipLogo = admin.employerInformation.companyProfilePhoto;
                }
            } else {
                jobData[0].membershipLogo = memberships[idx].photo;
            }
        }

        jobData[0].latitude = jobData[0].location.coordinates[1].toString();
        jobData[0].longitude = jobData[0].location.coordinates[0].toString();
        if (jobData[0].companyLocation.coordinates.length) {
            jobData[0].companyLatitude = jobData[0].companyLocation.coordinates[1].toString();
            jobData[0].companyLongitude = jobData[0].companyLocation.coordinates[0].toString();
        }
        if (request.query.userId) {
            /* Check whether this job is marked as favourite or not */
            try {
                isFavourite = await favouriteSchema.favouriteSchema.findOne({userId: mongoose.Types.ObjectId(request.query.userId), jobId: mongoose.Types.ObjectId(request.query.jobId)}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred finding favourites in get job details employer handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            jobData[0].isFavourite = !!isFavourite;
            query = {country: jobData[0].country, categoryId: mongoose.Types.ObjectId(jobData[0].categoryId), _id: {$ne: mongoose.Types.ObjectId(jobData[0]._id)}, userId: {$ne: mongoose.Types.ObjectId(request.query.userId)}, isArchived: false, isTranslated: false};
        } else {
            query = {country: jobData[0].country, categoryId: mongoose.Types.ObjectId(jobData[0].categoryId), _id: {$ne: mongoose.Types.ObjectId(jobData[0]._id)}, isArchived: false, isTranslated: false};
        }

        /* Get translated languages if any */
        if (jobData.length) {
            for (let i = 0; i < jobData.length; i++) {
                let languages = [];
                if (jobData[i].translatedJobs) {
                    for (let j = 0; j < jobData[i].translatedJobs.length; j++) {
                        let lang;
                        try {
                            lang = await jobSchema.jobSchema.findById({_id: jobData[i].translatedJobs[j]}, {translatedLanguage: 1}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred finding jobs in get job details employer handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }
                        if (lang) {
                            languages.push(lang.translatedLanguage);
                        }
                    }
                }
                jobData[i].translatedLanguages = languages;
            }
        }
    }

    /* Check whether the user has already applied to the job or not */
    let conversations;
    if (request.query.userId) {
        try {
            conversations = await conversationSchema.conversationSchema.find({candidateId: mongoose.Types.ObjectId(request.query.userId)}, {jobId: 1, isApplied: 1, isInvited: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting all conversations of candidates in get job details employer handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        for (let i = 0; i < jobData.length; i++) {
            const idx = conversations.findIndex(j => j.jobId.toString() === jobData[i]._id.toString());
            jobData[i]['isApplied'] = (idx !== -1);
        }
    }

    /* Increase the count of total views */
    if (jobData.length) {
        let dataToSet = {};
        if (jobData[0].totalViews) {
            if (request.query.userId) {
                if (jobData[0].userId.toString() !== request.query.userId) {
                    dataToSet = {$inc: {totalViews: 1}};
                }
            } else {
                dataToSet = {$inc: {totalViews: 1}};
            }
        } else {
            if (request.query.userId) {
                if (jobData[0].userId.toString() !== request.query.userId) {
                    dataToSet = {$set: {totalViews: 1}};
                }
            }
        }
        if (request.query.userId) {
            if (jobData[0].uniqueViewsArray) {
                const idx = jobData[0].uniqueViewsArray.findIndex(i => i.toString() === checkUser._id.toString());
                if ((idx === -1) && (jobData[0].userId.toString() !== request.query.userId)) {
                    dataToSet.$push = {uniqueViews: checkUser._id};
                }
            } else {
                if (dataToSet.$set) {
                    dataToSet.$set.uniqueViews = [checkUser._id];
                } else {
                    dataToSet.$set = {uniqueViews: [checkUser._id]};
                }
            }
        }
        try {
            await jobSchema.jobSchema.findByIdAndUpdate({_id: request.query.jobId}, dataToSet, {lean: true});
        } catch (e) {
            logger.error('Error occurred updating views counter in get job details employer handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Get the dynamic fields for job */
    try {
        dynamicFields = await dynamicFieldsSchema.dynamicFieldsSchema.findOne({country: jobData[0].country, type: 'job'}, {fields: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred getting dynamic fields in get job details employer handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (dynamicFields) {
        jobData[0].dynamicFields = dynamicFields.fields;
    }

    /* Get similar jobs */
    if (jobData.length) {
        if (request.query.longitude && request.query.latitude) {
            try {
                similarJobs = await jobSchema.jobSchema.aggregate([
                    {
                        $geoNear: {
                            near: {
                                type: 'Point',
                                coordinates: [Number(request.query.longitude), Number(request.query.latitude)]
                            },
                            key: 'location',
                            distanceField: 'distance',
                            maxDistance: (50) * 1609.34,
                            spherical: true,
                            query: query
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
                        $sort: {distance: 1}
                    },
                    {
                        $limit: 20
                    },
                    {
                        $lookup: {
                            from: 'Verification',
                            localField: 'user.employerInformation.verificationData',
                            foreignField: '_id',
                            as: 'verification'
                        }
                    },
                    {
                        $unwind: {
                            path: '$verification',
                            preserveNullAndEmptyArrays: true
                        }
                    },
                    {
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
                            companyVerified: '$verification.status'
                        }
                    }
                ]);
                jobData[0].similarJobs = similarJobs;
            } catch (e) {
                logger.error('Error occurred while aggregating user for near by users in get user handler %s:', JSON.stringify(e));
            }

            /* Fetch all the items in the favourite list of the user and update the jobs data */
            if (request.query.userId) {
                try {
                    favourites = await favouriteSchema.favouriteSchema.find({userId: mongoose.Types.ObjectId(request.query.userId)}, {jobId: 1}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while getting all favourite list candidates in get jobs handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (favourites && favourites.length) {
                    for (let i = 0; i < jobData[0].similarJobs.length; i++) {
                        const idx = favourites.findIndex(j => j.jobId.toString() === jobData[0].similarJobs[i]._id.toString());
                        jobData[0].similarJobs[i]['isFavourite'] = (idx !== -1);
                    }
                }
            }
        }
    }

    /* Check if buyer is blocked by seller or not */
    if (jobData.length && request.query.userId) {
        try {
            status = await userSchema.UserSchema.findOne({_id: jobData[0]._id, blocked: {$nin: [mongoose.Types.ObjectId(request.query.userId)]}}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding blocked user in get job details handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        jobData[0].isBlockedByEmployer = !!status;
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(jobData.length ? jobData[0]: {}, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.getAllJobsByEmployer = async (request, h) => {
    let decoded, checkUser, jobs;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in get jobs by employer handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get jobs by employer handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get list of active jobs by the employer */
    try {
        jobs = await jobSchema.jobSchema.find({userId: mongoose.Types.ObjectId(request.query.userId), isUnderReview: false, isExpired: false, isArchived: false, isClosed: false}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding active jobs in get jobs by employer handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(jobs, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.markAsHired = async (request, h) => {
    let checkUser, decoded, job, updatedJob, users, iosDevices = [], androidDevices = [], notifications = [], adminData,
        numberOfPositions = 0;

    /* Check if user exists in EZJobs database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.userId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in mark as hired handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in mark as hired handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Find job details */
    let translatedJobs = [];
    try {
        job = await jobSchema.jobSchema.findOne({
            userId: mongoose.Types.ObjectId(request.payload.userId),
            _id: mongoose.Types.ObjectId(request.payload.jobId)
        }, {isClosed: 1, numberOfPositions: 1, _id: 1, hiredId: 1, country: 1, translatedJobs: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding product in mark as hired handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!job) {
        return h.response(responseFormatter.responseFormatter({}, 'Job not found', 'error', 404)).code(404);
    } else if (job.numberOfPositions === 0) {
        return h.response(responseFormatter.responseFormatter({}, 'All the positions have been filled for this listing', 'error', 400)).code(400);
    }
    translatedJobs = [job._id].concat(job.translatedJobs || []);

    /* Check if product has marked for sold already */
    if (job.isClosed) {
        return h.response(responseFormatter.responseFormatter({}, 'This job is already marked as hired', 'error', 400)).code(400);
    }

    /* Check for the open number of positions with hired candidates */
    if (request.payload.candidateIds) {
        let count = 0;
        for (let i = 0; i < request.payload.candidateIds.length; i++) {
            const index = job.hiredId.findIndex(k => k.toString() === request.payload.candidateIds[i].toString());
            if (index === -1) {
                count++;
            }
        }
        if (job.numberOfPositions < count) {
            return h.response(responseFormatter.responseFormatter({}, 'Number of positions available is less than selected candidates.', 'error', 400)).code(400);
        }
    }

    /* Set job as hired */
    let updateCriteria = {};
    if (request.payload.candidateIds) {
        updateCriteria = {
            $addToSet: {hiredId: request.payload.candidateIds}
        };
    }

    /* Update master job */
    try {
        updatedJob = await jobSchema.jobSchema.findByIdAndUpdate({_id: request.payload.jobId}, updateCriteria, {
            lean: true,
            new: true
        });
    } catch (e) {
        logger.error('Error occurred while updating job in mark as hired handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    try {
        await jobSchema.jobSchema.updateMany({_id: {$in: translatedJobs}}, updateCriteria, {
            lean: true,
            new: true
        });
    } catch (e) {
        logger.error('Error occurred while updating job in mark as hired handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (job.hiredId.length !== updatedJob.hiredId.length) {
        numberOfPositions = job.numberOfPositions + job.hiredId.length - updatedJob.hiredId.length;
    } else if (!request.payload.candidateIds) {
        numberOfPositions = 0;
    } else {
        numberOfPositions = updatedJob.numberOfPositions;
    }

    if (numberOfPositions) {
        updateCriteria = {
            $set: {numberOfPositions: numberOfPositions}
        }
    } else {
        let packageInfo;

        /* Check package whether it is free or not */
        try {
            packageInfo = await packageSchema.packageSchema.findById({_id: checkUser.subscriptionInfo.packageId}, {
                isFree: 1,
                isWallet: 1
            }, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding package info in mark as hired handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Increase the job post count by 1 */
        if (checkUser.subscriptionInfo.subscriptionId && (!packageInfo.isFree || job.country.toLowerCase() !== 'in') && !packageInfo.isWallet) {
            try {
                await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkUser.subscriptionInfo.subscriptionId}, {$inc: {'numberOfJobs.count': 1}}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding subscription info in mark as hired handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
        updateCriteria = {
            $set: {isClosed: true, isArchived: true, numberOfPositions: 0}
        }
        /* Get queue jobs and update it to be visible from the database for the same user if any */
        try {
            await jobSchema.jobSchema.findOneAndUpdate({
                userId: mongoose.Types.ObjectId(checkUser._id),
                inQueue: true,
                isArchived: false
            }, {$set: {inQueue: false, isVisible: true}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding queued job in mark as hired handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Update master job */
    try {
        updatedJob = await jobSchema.jobSchema.findByIdAndUpdate({_id: request.payload.jobId}, updateCriteria, {
            lean: true,
            new: true
        });
    } catch (e) {
        logger.error('Error occurred while updating job in mark as hired handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update job again with number of positions */
    try {
        await jobSchema.jobSchema.updateMany({_id: {$in: translatedJobs}}, updateCriteria, {
            lean: true,
            new: true
        });
    } catch (e) {
        logger.error('Error occurred while updating job in mark as hired handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Mark them as hired in conversation collection */
    for (let i = 0; i < updatedJob.hiredId.length; i++) {
        try {
            await conversationSchema.conversationSchema.updateOne({candidateId: mongoose.Types.ObjectId(updatedJob.hiredId[i]), jobId: mongoose.Types.ObjectId(request.payload.jobId)}, {$set: {isHired: true}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating conversation in mark as hired handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Send push to hired candidates */
    if (request.payload.candidateIds) {
        let candidates, idx;
        for (let i = 0; i < request.payload.candidateIds.length; i++) {
            idx = job.hiredId.findIndex(k => k.toString() === request.payload.candidateIds[i]);
            if (idx === -1) {
                /* Retrieve device token of the candidate and send push */
                try {
                    candidates = await userSchema.UserSchema.findById({_id: request.payload.candidateIds[i]}, {deviceType: 1, deviceToken: 1, _id: 1}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while fetching user information in mark as hired handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (candidates.deviceToken) {
                    /* Send push to candidate about the same */
                    push.createMessage(candidates.deviceToken, [], {pushType: 'job', jobId: request.payload.jobId}, candidates.deviceType, 'Congratulations!', 'You have been selected for the position of ' + (updatedJob.jobTitle === 'Others' ? updatedJob.subJobTitle: updatedJob.jobTitle), 'beep');

                    let notification = {
                        sentTo: mongoose.Types.ObjectId(request.payload.candidateIds[i]),
                        isAdmin: true,
                        adminId: '5ce54cd59266381ee8cad49b',
                        jobId: request.payload.jobId,
                        isRead: false,
                        message:  'You have been selected for the position of ' + (updatedJob.jobTitle === 'Others' ? updatedJob.subJobTitle: updatedJob.jobTitle),
                        image: 'https://images.onata.com/test/02RNd9alezj.png',
                        type: 'job'
                    };

                    /* Save notification into database */
                    try {
                        await new notificationSchema.notificationSchema(notification).save();
                    } catch (e) {
                        logger.error('Error occurred while saving notification in mark as hired handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }
            }
        }
    }

    /* Update chats to mark job as hired if number of positions are filled */
    if (!updatedJob.numberOfPositions) {
        let searchCriteria = {}, updateCriteria1 = {
            $set: {
                isRejected: true
            }
        };
        if (request.payload.candidateIds) {
            searchCriteria = {
                jobId: {$in: translatedJobs},
                candidateId: {$nin: updatedJob.hiredId}
            };
        } else {
            searchCriteria = {
                jobId: {$in: translatedJobs}
            };
        }

        let bulk = conversationSchema.conversationSchema.collection.initializeUnorderedBulkOp();
        bulk
            .find(searchCriteria)
            .update(updateCriteria1);
        try {
            await bulk.execute();
        } catch (e) {
            logger.error('Error occurred while updating chats data in mark as hired handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Remove job from wish list as well */
        try {
            await favouriteSchema.favouriteSchema.deleteMany({jobId: {$in: translatedJobs}});
        } catch (e) {
            logger.error('Error occurred while deleting wishlist data in mark as hired handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Send push to all the users about the same */
        let aggregationCriteria = [
            {
                $match: {
                    jobId: {$in: translatedJobs}
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
                $project: {
                    deviceToken: '$user.deviceToken',
                    deviceType: '$user.deviceType',
                    userId: '$user._id'
                }
            }
        ];
        if (request.payload.candidateIds) {
            aggregationCriteria[0].$match = {
                jobId: {$in: translatedJobs},
                candidateId: {$nin: updatedJob.hiredId}
            }
        }
        try {
            users = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
        } catch (e) {
            logger.error('Error occurred while aggregating conversations for sending push to rejected candidates in hire candidate handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Get admin data for adding admin ID */
        try {
            adminData = await adminSchema.AdminSchema.findOne({email: 'swapglobal@gmail.com'}, {_id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding admin in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!adminData) {
            return h.response(responseFormatter.responseFormatter({}, 'No such admin found', 'error', 404)).code(404);
        }

        for (let i = 0; i < users.length; i++) {
            notifications.push({
                sentTo: mongoose.Types.ObjectId(users[i].userId),
                isAdmin: true,
                adminId: adminData._id,
                jobId: job._id,
                isRead: false,
                message: (job.jobTitle === 'Others' ? job.subJobTitle : job.jobTitle) + ' position has been filled by the employer. Keep applying to new jobs.',
                image: 'https://images.onata.com/test/02RNd9alezj.png',
                type: 'positionFilled'
            });
            if (users[i].deviceType.toLowerCase() === 'ios') {
                iosDevices.push(users[i].deviceToken);
            } else {
                androidDevices.push(users[i].deviceToken);
            }
        }

        /* Send push to both the users */
        let title = 'Position filled',
            body = (job.jobTitle === 'Others' ? job.subJobTitle : job.jobTitle) + ' position has been filled by the employer. Keep applying to new jobs.',
            data = {pushType: 'positionFilled', jobId: request.payload.jobId};
        push.createMessage('', androidDevices, data, 'ANDROID', title, body, 'beep');
        push.createMessage('', iosDevices, data, 'IOS', title, body, 'beep');

        /* Save into database */
        try {
            await notificationSchema.notificationSchema.insertMany(notifications);
        } catch (e) {
            logger.error('Error occurred while inserting notifications in mark as hired handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (process.env.NODE_ENV === 'production') {
            try {
                await commonFunctions.Handlers.submitForIndexing(request.payload.jobId, true);
            } catch (e) {
                logger.error('Error occurred while submitting the job to google for indexing %s:', JSON.stringify(e));
            }
        }

        /* Success */
        return h.response(responseFormatter.responseFormatter({numberOfPositions: numberOfPositions}, 'Congratulations! Your job has been marked as hired now. Keep posting new jobs.', 'success', 204)).code(200);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({numberOfPositions: numberOfPositions}, 'Congratulations! You have hired ' + request.payload.candidateIds.length + ' candidates. You still have ' + numberOfPositions + ' available for this position.', 'success', 204)).code(200);
};

employerHandler.getArchivedList = async (request, h) => {
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
            $match: {isArchived: true, isTranslated: false, userId: mongoose.Types.ObjectId(request.query.userId)}
        },
        {
            $lookup: {
                from: 'User',
                localField: 'userId',
                foreignField: '_id',
                as: 'employer'
            }
        },
        {
            $unwind: '$employer'
        }
    ];

    /* If category id is given */
    if (request.query.categoryId) {
        aggregationCriteria.push({$match: {categoryId: mongoose.Types.ObjectId(request.query.categoryId)}});
    }

    /* If search text is given */
    if (request.query.searchText) {
        aggregationCriteria.push({$match: {$or:
                    [
                        {
                            'jobDescriptionText': {$all: [new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                        },
                        {
                            'jobTitle': {$all: [new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                        },
                        {
                            'subJobTitle': {$all: [new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
                        }
                    ]
        }});
    }

    aggregationCriteria.push({$skip: request.query.skip});
    aggregationCriteria.push({$limit: request.query.limit});
    aggregationCriteria.push({
        $project: {
            _id: 1,
            userId: 1,
            payRate: 1,
            currency: 1,
            startDate: 1,
            jobType: 1,
            totalViews: 1,
            uniqueViews: {$size: '$uniqueViews'},
            companyLogo: '$employer.employerInformation.companyProfilePhoto',
            companyName: '$employer.employerInformation.companyName',
            companyCity: '$employer.employerInformation.companyAddress.city',
            companyState: '$employer.employerInformation.companyAddress.state',
            companySubLocality: '$employer.employerInformation.companyAddress.subLocality',
            jobCity: '$address.city',
            jobState: '$address.state',
            jobSubLocality: '$address.subLocality',
            jobTitle: 1,
            subJobTitle: 1,
            isExpired: 1,
            isHired: 1,
            location: 1
        }
    });
    try {
        archived = await jobSchema.jobSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred aggregating on jobs in get archived list handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Loop through all the jobs & Define aggregation criteria */
    for (let i = 0; i < archived.length; i++) {
        let applications = 0, invitations = 0;

        /* Counting number of applications */
        try {
            applications = await conversationSchema.conversationSchema.find({jobId: archived[i]._id, isApplied: true}).countDocuments();
        } catch (e) {
            logger.error('Error occurred while counting applied chats in get active jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        /* Counting number of invitations */
        try {
            invitations = await conversationSchema.conversationSchema.find({jobId: archived[i]._id, isInvited: true, isApplied: false}).countDocuments();
        } catch (e) {
            logger.error('Error occurred while counting invited chats in get active jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        archived[i]['matchingProfiles'] = [];
        archived[i]['applications'] = applications;
        archived[i]['invitations'] = invitations;
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(archived, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.getActiveList = async (request, h) => {
    let decoded, checkUser, activeJobs;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in get active list jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in get active list jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get list of all active jobs by the employer */
    try {
        activeJobs = await jobSchema.jobSchema.find({userId: mongoose.Types.ObjectId(request.query.userId), isExpired: false, isArchived: false, isClosed: false, isUnderReview: false, isTranslated: false, isVisible: true}, {_id: 1, jobTitle: 1, subJobTitle: 1}, {lean: true}).sort({createdAt: 1}).skip(request.query.skip).limit(request.query.limit);
    } catch (e) {
        logger.error('Error occurred finding active jobs in get active list jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(activeJobs, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.hireCandidate = async (request, h) => {
    let decoded, checkUser, checkChat, updatedJob, job, candidate, adminData, notifications = [];

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in hire candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Get candidate device information to notify him/her about the same */
    try {
        candidate = await userSchema.UserSchema.findById({_id: request.payload.candidateId}, {deviceType: 1, deviceToken: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding candidate information in hire candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!candidate) {
        return h.response(responseFormatter.responseFormatter({}, 'Candidate not found', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in hire candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether chat is present in database or not */
    try {
        checkChat = await conversationSchema.conversationSchema.findById({_id: request.payload.chatId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding chat information in hire candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkChat) {
        return h.response(responseFormatter.responseFormatter({}, 'Chat doesn\'t exists', 'error', 404)).code(404);
    } else if (checkChat.employerId.toString() !== request.payload.userId) {
        return h.response(responseFormatter.responseFormatter({}, 'Chat doesn\'t exists', 'error', 400)).code(400);
    }

    /* Get admin data for adding admin ID */
    try {
        adminData = await adminSchema.AdminSchema.findOne({email: 'swapglobal@gmail.com'}, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding admin in create job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!adminData) {
        return h.response(responseFormatter.responseFormatter({}, 'No such admin found', 'error', 404)).code(404);
    }

    /* Get job details for number of open positions */
    try {
        job = await jobSchema.jobSchema.findById({_id: checkChat.jobId}, {numberOfPositions: 1, hiredId: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching job details in hire candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!job) {
        return h.response(responseFormatter.responseFormatter({}, 'Listing not found', 'error', 404)).code(404);
    } else if (!job.numberOfPositions) {
        return h.response(responseFormatter.responseFormatter({}, 'All the positions have been filled for this listing', 'error', 400)).code(400);
    }
    if (checkChat.isHired) {
        if (job.hiredId) {
            const idx = job.hiredId.findIndex(k => k.toString() === request.payload.candidateId);
            if (idx === -1) {
                return h.response(responseFormatter.responseFormatter({}, 'All the positions have been filled for this listing', 'error', 400)).code(400);
            } else {
                return h.response(responseFormatter.responseFormatter({}, 'You have already hired this candidate for the same position', 'error', 400)).code(400);
            }
        }
    }

    /* Decrease count of number of positions */
    try {
        updatedJob = await jobSchema.jobSchema.findByIdAndUpdate({_id: checkChat.jobId}, {$inc: {numberOfPositions: -1}, $addToSet: {hiredId:  mongoose.Types.ObjectId(request.payload.candidateId)}}, {lean: true, new: true});
    } catch (e) {
        logger.error('Error occurred while decreasing number of positions count in hire candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update this candidate as hired in conversation */
    try {
        await conversationSchema.conversationSchema.findByIdAndUpdate({_id: request.payload.chatId}, {$set: {isHired: true}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating conversation in hire candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Send push to candidate about the same */
    push.createMessage(candidate.deviceToken, [], {pushType: job, jobId: request.payload.jobId, chatId: request.payload.chatId}, candidate.deviceType, 'Congratulations!', 'You have been selected for the position of ' + (updatedJob.jobTitle === 'Others' ? updatedJob.subJobTitle: updatedJob.jobTitle), 'beep');

    let notification = {
        sentTo: mongoose.Types.ObjectId(request.payload.candidateId),
        isAdmin: true,
        adminId: adminData._id,
        jobId: checkChat.jobId,
        isRead: false,
        message:  'You have been selected for the position of ' + (updatedJob.jobTitle === 'Others' ? updatedJob.subJobTitle: updatedJob.jobTitle),
        image: 'https://images.onata.com/test/02RNd9alezj.png',
        type: 'job'
    };

    /* Save notification into database */
    try {
        await new notificationSchema.notificationSchema(notification).save();
    } catch (e) {
        logger.error('Error occurred while saving notification in hire candidate handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!updatedJob.numberOfPositions) {
        let users = [], androidDevices = [], iosDevices = [], packageInfo;

        /* Check package whether it is free or not */
        try {
            packageInfo = await packageSchema.packageSchema.findById({_id: checkUser.subscriptionInfo.packageId}, {
                isFree: 1,
                isWallet: 1
            }, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding package info in hire candidate handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Increase the job post count by 1 */
        if (checkUser.subscriptionInfo.subscriptionId && (!packageInfo.isFree || updatedJob.country.toLowerCase() !== 'in') && !packageInfo.isWallet) {
            try {
                await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkUser.subscriptionInfo.subscriptionId}, {$inc: {'numberOfJobs.count': 1}}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding subscription info in mark as hired handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }

        /* Update the conversation and job */
        try {
            await jobSchema.jobSchema.findByIdAndUpdate({_id: checkChat.jobId}, {$set: {isArchived: true, isClosed: true}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred updating job information in hire candidate handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        let bulk = conversationSchema.conversationSchema.collection.initializeUnorderedBulkOp();
        bulk
            .find({jobId: mongoose.Types.ObjectId(checkChat.jobId)})
            .update({$set: {isHired: true}});

        try {
            await bulk.execute();
        } catch (e) {
            logger.error('Error occurred updating chat information in hire candidate handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Set all other candidates to rejected */

        bulk
            .find({jobId: checkChat.jobId, candidateId: {$ne: mongoose.Types.ObjectId(request.payload.candidateId)}})
            .update({$set: {isRejected: true}});
        try {
            await bulk.execute();
        } catch (e) {
            logger.error('Error occurred updating chat information in hire candidate handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Remove job from wish list as well */
        try {
            await favouriteSchema.favouriteSchema.deleteMany({jobId: mongoose.Types.ObjectId(checkChat.jobId)});
        } catch (e) {
            logger.error('Error occurred while deleting wishlist data in hire candidate handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Send push to all the users about the same */
        try {
            users = await conversationSchema.conversationSchema.aggregate([
                {
                    $match: {
                        jobId: checkChat.jobId,
                        candidateId: {$ne: mongoose.Types.ObjectId(request.payload.candidateId)}
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
                    $project: {
                        userId: '$user._id',
                        deviceToken: '$user.deviceToken',
                        deviceType: '$user.deviceType'
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while aggregating conversations for sending push to rejected candidates in hire candidate handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        for (let i = 0; i < users.length; i++) {
            notifications.push({
               sentTo: mongoose.Types.ObjectId(users[i].userId),
               isAdmin: true,
               adminId: adminData._id,
               jobId: checkChat.jobId,
               isRead: false,
               message:  (updatedJob.jobTitle === 'Others' ? updatedJob.subJobTitle : updatedJob.jobTitle) + ' position has been filled by the employer. Keep applying to new jobs.',
                image: 'https://images.onata.com/test/02RNd9alezj.png',
                type: 'positionFilled'
            });
            if (users[i].deviceType.toLowerCase() === 'ios') {
                iosDevices.push(users[i].deviceToken);
            } else {
                androidDevices.push(users[i].deviceToken);
            }
        }

        /* Send push to both the users */
        let title = 'Position filled', body = (updatedJob.jobTitle === 'Others' ? updatedJob.subJobTitle : updatedJob.jobTitle) + ' position has been filled by the employer. Keep applying to new jobs.', data = {pushType: 'positionFilled', jobId: checkChat.jobId.jobId};
        push.createMessage('', androidDevices, data, 'ANDROID', title, body, 'beep');
        push.createMessage('', iosDevices, data, 'IOS', title, body, 'beep');

        /* Save into database */
        try {
            await notificationSchema.notificationSchema.insertMany(notifications);
        } catch (e) {
            logger.error('Error occurred while inserting notifications in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (process.env.NODE_ENV === 'production') {
            try {
                await commonFunctions.Handlers.submitForIndexing(checkChat.jobId, true);
            } catch (e) {
                logger.error('Error occurred while submitting the job to google for indexing %s:', JSON.stringify(e));
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Candidate marked as hired', 'success', 204)).code(200);
};

employerHandler.hiredCandidates = async (request, h) => {
    let decoded, checkUser, candidates, searchCriteria, aggregationCriteria;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in hired candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in hired candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get list of all the candidates who are hired */
    searchCriteria = {
        userId: mongoose.Types.ObjectId(request.query.userId),
        hiredId: {$ne: []}
    };
    aggregationCriteria = [
        {
            $match: searchCriteria
        },
        {
            $skip: request.query.skip
        },
        {
            $limit: request.query.limit
        },
        {
          $unwind: '$hiredId'
        },
        {
            $lookup: {
                from: 'User',
                localField: 'hiredId',
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
                localField: 'userId',
                foreignField: '_id',
                as: 'employer'
            }
        },
        {
            $unwind: '$employer'
        },
        {
            $project: {
                candidateId: '$candidate._id',
                firstName: '$candidate.firstName',
                lastName: '$candidate.lastName',
                experienceInMonths: '$candidate.employeeInformation.experienceInMonths',
                profilePhoto: '$candidate.employeeInformation.profilePhoto',
                jobTitle: 1,
                subJobTitle: 1,
                isStudent: '$candidate.employeeInformation.isStudent'
            }
        }
    ];

    /* Aggregation */
    try {
        candidates = await jobSchema.jobSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred aggregating chats in hired candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(candidates, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.republish = async (request, h) => {
    let checkUser, checkJob, decoded;

    /* Check whether user is present in database or not */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.payload.userId}, {}, {});
    } catch (e) {
        logger.error('Error occurred finding user information in republish job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user has valid authorization token */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred decoding token in republish job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether job exists */
    try {
        checkJob = await jobSchema.jobSchema.findOne({_id: mongoose.Types.ObjectId(request.payload.jobId), userId: mongoose.Types.ObjectId(request.payload.userId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred finding job in republish job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkJob) {
        return h.response(responseFormatter.responseFormatter({}, 'Job not found', 'error', 404)).code(404);
    } else if (!checkJob.isClosed) {
        return h.response(responseFormatter.responseFormatter({}, 'Job is already republished', 'error', 400)).code(400);
    }

    /* Check for the subscription package */
    let subscriptionData;
    if (checkUser.subscriptionInfo && checkUser.subscriptionInfo.subscriptionId) {
        try {
            subscriptionData = await subscriptionSchema.subscriptionSchema.findById({_id: checkUser.subscriptionInfo.subscriptionId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding subscription data in republish job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!subscriptionData) {
            return h.response(responseFormatter.responseFormatter({}, 'Something went wrong. Please contact support.', 'error', 400)).code(400);
        } else if (!subscriptionData.isPaid) {
            return h.response(responseFormatter.responseFormatter({}, 'Please purchase any subscription.', 'error', 400)).code(400);
        } else if (!subscriptionData.numberOfJobs.isUnlimited && subscriptionData.numberOfJobs.count <= 0) {
            return h.response(responseFormatter.responseFormatter({}, 'You do not have sufficient job posting left in your current package.', 'error', 400)).code(400);
        }

        if (!subscriptionData.isWallet) {
            try {
                await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkUser.subscriptionInfo.subscriptionId}, {$inc: {'numberOfJobs.count': -1}}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while updating subscription data in republish job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
    } else {
        /* Free package. Check the date of the last posted job */
        let lastJob;
        try {
            lastJob = await jobSchema.jobSchema.findOne({userId: request.payload.userId, createdAt: {$gt:  new Date(moment().subtract(1, 'month').toISOString())}}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding last posted job data in republish job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (lastJob) {
            return h.response(responseFormatter.responseFormatter({}, 'You do not have sufficient job posting left in your current package.', 'error', 400)).code(400);
        }
    }

    /* Check if the subscription is of type wallet */
    if (!!subscriptionData.isWallet) {
        /*let pricingInfo, amountToBeDeducted = 0;
        try {
            pricingInfo = await pricingSchema.pricingSchema.findOne({country: checkJob.country}, {
                numberOfJobs: 1,
                numberOfJobTranslations: 1,
                jobsInAllLocalities: 1
            }, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding pricing information in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!pricingInfo.numberOfJobs) {
            return h.response(responseFormatter.responseFormatter({}, 'Base price for the jobs is not found for the country', 'error', 404)).code(404);
        } else if (!pricingInfo.numberOfJobTranslations) {
            return h.response(responseFormatter.responseFormatter({}, 'Base price for the job translations is not found for the country', 'error', 404)).code(404);
        } else if (!pricingInfo.jobsInAllLocalities) {
            return h.response(responseFormatter.responseFormatter({}, 'Base price for the multiple job localities is not found for the country', 'error', 404)).code(404);
        }
        amountToBeDeducted += (pricingInfo.numberOfJobs.basePrice / pricingInfo.numberOfJobs.count);

        /!*if (request.payload.displayCities && request.payload.displayCities.length) {
            amountToBeDeducted += pricingInfo.jobsInAllLocalities.basePrice;
        }*!/

        if (checkJob.translatedLanguages && checkJob.translatedLanguages.length) {
            amountToBeDeducted += ((pricingInfo.numberOfJobTranslations.basePrice / pricingInfo.numberOfJobTranslations.count) * checkJob.translatedLanguages.length)
        }*/

        /*if (amountToBeDeducted > subscriptionData.walletAmount) {
            return h.response(responseFormatter.responseFormatter({}, 'Insufficient wallet balance', 'error', 400)).code(400);
        } else {

        }*/
        const update = {
            $inc: {
                'numberOfJobs.count': 1
            }
        };
        try {
            await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: subscriptionData._id}, update, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating subscription data in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

    }

    /* Create a new job and publish it */
    let dataToSave = checkJob;
    delete dataToSave._id;
    delete dataToSave.hiredId;
    delete dataToSave.createdAt;
    delete dataToSave.updatedAt;
    delete dataToSave.startDate;
    delete dataToSave.systemGeneratedId;
    dataToSave.isClosed = false;
    dataToSave.isArchived = false;
    dataToSave.totalViews = 0;
    dataToSave.uniqueViews = [];
    dataToSave.isExpired = false;
    dataToSave.reportReason = [];
    dataToSave.reportedBy = [];

    if (dataToSave.displayLocation.coordinates.length > 1) {
        if (!subscriptionData.jobsInAllLocalities.isIncluded) {
            return h.response(responseFormatter.responseFormatter({}, 'Your current package does not include premium postings.', 'error', 400)).code(400);
        }
    }

    /* Save new job in database */
    try {
        await new jobSchema.jobSchema(dataToSave).save();
    } catch (e) {
        logger.error('Error occurred in saving job in republish job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update user post count */
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.userId}, {$inc: {'employerInformation.numberOfJobsPosted': 1}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in updating employer job posting count in republish job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Congratulations! Your job has been republished.', 'success', 201)).code(201);
};

employerHandler.getMinMaxSalaries = async (request, h) => {
    // let [minHourlyResult, maxHourlyResult, minDailyResult, maxDailyResult, minWeeklyResult, maxWeeklyResult, minMonthlyResult, maxMonthlyResult, minYearlyResult, maxYearlyResult, minAnyResult, maxAnyResult] = await Promise.all([await minHourlyF(), await maxHourlyF(), await minDailyF(), await maxDailyF(), await minWeeklyF(), await maxWeeklyF(), await minMonthlyF(), await maxMonthlyF(), await minYearlyF(), await maxYearlyF(), await minAnyF(), await maxAnyF()]);
    /*let finalResult = [
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
        return jobSchema.jobSchema.aggregate([
            {
                $match: {
                    'payRate.type': new RegExp(/hourly/, 'gi'),
                    'country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    minValue: {$min: '$payRate.value'}
                }
            }
        ]);
    }

    function maxHourlyF() {
        return jobSchema.jobSchema.aggregate([
            {
                $match: {
                    'payRate.type': new RegExp(/hourly/, 'gi'),
                    'country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    maxValue: {$max: '$payRate.value'}
                }
            }
        ]);
    }

    function minDailyF() {
        return jobSchema.jobSchema.aggregate([
            {
                $match: {
                    'payRate.type': new RegExp(/daily/, 'gi'),
                    'country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    minValue: {$min: '$payRate.value'}
                }
            }
        ]);
    }

    function maxDailyF() {
        return jobSchema.jobSchema.aggregate([
            {
                $match: {
                    'payRate.type': new RegExp(/daily/, 'gi'),
                    'country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    maxValue: {$max: '$payRate.value'}
                }
            }
        ]);
    }

    function minWeeklyF() {
        return jobSchema.jobSchema.aggregate([
            {
                $match: {
                    'payRate.type': new RegExp(/weekly/, 'gi'),
                    'country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    minValue: {$min: '$payRate.value'}
                }
            }
        ]);
    }

    function maxWeeklyF() {
        return jobSchema.jobSchema.aggregate([
            {
                $match: {
                    'payRate.type': new RegExp(/weekly/, 'gi'),
                    'country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    maxValue: {$max: '$payRate.value'}
                }
            }
        ]);
    }

    function minMonthlyF() {
        return jobSchema.jobSchema.aggregate([
            {
                $match: {
                    'payRate.type': new RegExp(/monthly/, 'gi'),
                    'country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    minValue: {$min: '$payRate.value'}
                }
            }
        ]);
    }

    function maxMonthlyF() {
        return jobSchema.jobSchema.aggregate([
            {
                $match: {
                    'payRate.type': new RegExp(/monthly/, 'gi'),
                    'country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    maxValue: {$max: '$payRate.value'}
                }
            }
        ]);
    }

    function minYearlyF() {
        return jobSchema.jobSchema.aggregate([
            {
                $match: {
                    'payRate.type': new RegExp(/yearly/, 'gi'),
                    'country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    minValue: {$min: '$payRate.value'}
                }
            }
        ]);
    }

    function maxYearlyF() {
        return jobSchema.jobSchema.aggregate([
            {
                $match: {
                    'payRate.type': new RegExp(/yearly/, 'gi'),
                    'country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    maxValue: {$max: '$payRate.value'}
                }
            }
        ]);
    }

    function minAnyF() {
        return jobSchema.jobSchema.aggregate([
            {
                $match: {
                    'country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    minValue: {$min: '$payRate.value'}
                }
            }
        ]);
    }

    function maxAnyF() {
        return jobSchema.jobSchema.aggregate([
            {
                $match: {
                    'country': request.query.country
                }
            },
            {
                $group: {
                    _id: {},
                    maxValue: {$max: '$payRate.value'}
                }
            }
        ]);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(finalResult, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.markAsArchived = async (request, h) => {
    let checkUser, decoded, job, updatedJob, users,iosDevices = [], androidDevices = [], notifications = [], packageInfo, adminData, uniqueJobIds;

    /* Check if user exists in EZJobs database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.userId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in mark as archived handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in mark as archived handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }
    if (!request.payload.jobId) {
        if (!request.payload.jobIds) {
            return h.response(responseFormatter.responseFormatter({}, 'Either jobId/ jobIds is required', 'error', 400)).code(401);
        } else if (request.payload.jobIds) {
            if (!request.payload.jobIds.length) {
                return h.response(responseFormatter.responseFormatter({}, 'Either jobId/ jobIds is required', 'error', 400)).code(401);
            }
        }
    }

    /* Check package whether it is free or not */
    try {
        packageInfo = await packageSchema.packageSchema.findById({_id: checkUser.subscriptionInfo.packageId}, {
            isFree: 1,
            isWallet: 1
        }, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding package info in mark as archived handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (request.payload.jobIds && request.payload.jobIds.length) {
        uniqueJobIds = Array.from(new Set([...request.payload.jobIds]));
        for (let j = 0; j < request.payload.jobIds.length; j++) {
            let translatedJobs = [];
            /* Find job details */
            try {
                job = await jobSchema.jobSchema.findOne({
                    userId: mongoose.Types.ObjectId(request.payload.userId),
                    _id: mongoose.Types.ObjectId(request.payload.jobIds[j])
                    }, {isArchived: 1, _id: 1, hiredId: 1, country: 1, translatedJobs: 1}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding job in mark as archived handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (!job) {
                    return h.response(responseFormatter.responseFormatter({}, 'Job not found', 'error', 404)).code(404);
                } else if (job.isArchived) {
                    return h.response(responseFormatter.responseFormatter({}, 'You can not archive already archived job', 'error', 400)).code(400);
                }
                translatedJobs = [job._id].concat(job.translatedJobs || []);
    
                /* Increase the job post count by 1 */
                if (checkUser.subscriptionInfo && checkUser.subscriptionInfo.subscriptionId && (!packageInfo.isFree || job.country.toLowerCase() !== 'in') && !packageInfo.isWallet) {
                    try {
                        await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkUser.subscriptionInfo.subscriptionId}, {$inc: {'numberOfJobs.count': 1}}, {lean: true});
                    } catch (e) {
                        logger.error('Error occurred while finding subscription info in mark as hired handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }
                /* Set job as archived */
                try {
                    updatedJob = await jobSchema.jobSchema.updateMany({_id: {$in: translatedJobs}}, {
                        $set: {
                            isArchived: true,
                            isClosed: true,
                            numberOfPositions: 0
                        }
                    }, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while updating job in mark as archived handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
    
                /* Update chats to mark job as archived */
                let bulk = conversationSchema.conversationSchema.collection.initializeUnorderedBulkOp();
                bulk
                    .find({jobId: {$in: translatedJobs}, isHired: false})
                    .update({$set: {isArchived: true, isRejected: true, isHired: true}});
                try {
                    await bulk.execute();
                } catch (e) {
                    logger.error('Error occurred while updating chats data in mark as archived handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
    
                /* Remove job from wish list as well */
                try {
                    await favouriteSchema.favouriteSchema.deleteMany({jobId: {$in: translatedJobs}});
                } catch (e) {
                    logger.error('Error occurred while deleting favourite data in mark as archived handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
    
                /* Send push to all the users about the same */
                let aggregationCriteria = [
                    {
                        $match: {
                            jobId: {$in: translatedJobs}
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
                        $project: {
                            deviceToken: '$user.deviceToken',
                            deviceType: '$user.deviceType'
                        }
                    }
                ];
    
                try {
                    users = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
                } catch (e) {
                    logger.error('Error occurred while aggregating conversations for sending push to all candidates in archived candidate handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
    
                /* Get admin data for adding admin ID */
                try {
                    adminData = await adminSchema.AdminSchema.findOne({email: 'swapglobal@gmail.com'}, {_id: 1}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while finding admin in mark as archived handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (!adminData) {
                    return h.response(responseFormatter.responseFormatter({}, 'No such admin found', 'error', 404)).code(404);
                }
    
                for (let i = 0; i < users.length; i++) {
                    notifications.push({
                        sentTo: mongoose.Types.ObjectId(users[i].userId),
                        isAdmin: true,
                        adminId: adminData._id,
                        jobId: job._id,
                        isRead: false,
                        message:  (updatedJob.jobTitle === 'Others' ? updatedJob.subJobTitle : updatedJob.jobTitle) + ' position has been closed by the employer. Keep applying to new jobs.',
                        image: 'https://images.onata.com/test/02RNd9alezj.png',
                        type: 'positionFilled'
                    });
                    if (users[i].deviceType.toLowerCase() === 'ios') {
                        iosDevices.push(users[i].deviceToken);
                    } else {
                        androidDevices.push(users[i].deviceToken);
                    }
                }
    
                /* Send push to both the users */
                let title = 'Position filled', body = (updatedJob.jobTitle === 'Others' ? updatedJob.subJobTitle : updatedJob.jobTitle) + ' position has been closed by the employer. Keep applying to new jobs.', data = {pushType: 'positionFilled', jobId: request.payload.jobId};
                push.createMessage('', androidDevices, data, 'ANDROID', title, body, 'beep');
                push.createMessage('', iosDevices, data, 'IOS', title, body, 'beep');
    
                /* Save into database */
                try {
                    await notificationSchema.notificationSchema.insertMany(notifications);
                } catch (e) {
                    logger.error('Error occurred while inserting notifications in mark as archived handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
            }
    } else {
        uniqueJobIds = ["one"];
        let translatedJobs = [];

        /* Find job details */
        try {
            job = await jobSchema.jobSchema.findOne({
                userId: mongoose.Types.ObjectId(request.payload.userId),
                _id: mongoose.Types.ObjectId(request.payload.jobId)
            }, {isArchived: 1, _id: 1, hiredId: 1, country: 1, translatedJobs: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding job in mark as archived handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!job) {
            return h.response(responseFormatter.responseFormatter({}, 'Job not found', 'error', 404)).code(404);
        } else if (job.isArchived) {
            return h.response(responseFormatter.responseFormatter({}, 'You can not archive already archived job', 'error', 400)).code(400);
        }
        translatedJobs = [job._id].concat(job.translatedJobs || []);

        /* Increase the job post count by 1 */
        if (checkUser.subscriptionInfo && checkUser.subscriptionInfo.subscriptionId && (!packageInfo.isFree || job.country.toLowerCase() !== 'in') && !packageInfo.isWallet) {
            try {
                await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkUser.subscriptionInfo.subscriptionId}, {$inc: {'numberOfJobs.count': 1}}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding subscription info in mark as hired handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }
        /* Set job as archived */
        try {
            updatedJob = await jobSchema.jobSchema.updateMany({_id: {$in: translatedJobs}}, {
                $set: {
                    isArchived: true,
                    isClosed: true,
                    numberOfPositions: 0
                }
            }, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating job in mark as archived handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Update chats to mark job as archived */
        let bulk = conversationSchema.conversationSchema.collection.initializeUnorderedBulkOp();
        bulk
            .find({jobId: {$in: translatedJobs}, isHired: false})
            .update({$set: {isArchived: true, isRejected: true, isHired: true}});
        try {
            await bulk.execute();
        } catch (e) {
            logger.error('Error occurred while updating chats data in mark as archived handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Remove job from wish list as well */
        try {
            await favouriteSchema.favouriteSchema.deleteMany({jobId: {$in: translatedJobs}});
        } catch (e) {
            logger.error('Error occurred while deleting favourite data in mark as archived handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Send push to all the users about the same */
        let aggregationCriteria = [
            {
                $match: {
                    jobId: {$in: translatedJobs}
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
                $project: {
                    deviceToken: '$user.deviceToken',
                    deviceType: '$user.deviceType'
                }
            }
        ];

        try {
            users = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
        } catch (e) {
            logger.error('Error occurred while aggregating conversations for sending push to all candidates in archived candidate handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Get admin data for adding admin ID */
        try {
            adminData = await adminSchema.AdminSchema.findOne({email: 'swapglobal@gmail.com'}, {_id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding admin in mark as archived handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!adminData) {
            return h.response(responseFormatter.responseFormatter({}, 'No such admin found', 'error', 404)).code(404);
        }

        for (let i = 0; i < users.length; i++) {
            notifications.push({
                sentTo: mongoose.Types.ObjectId(users[i].userId),
                isAdmin: true,
                adminId: adminData._id,
                jobId: job._id,
                isRead: false,
                message: (job.jobTitle === 'Others' ? job.subJobTitle : job.jobTitle) + ' position has been closed by the employer. Keep applying to new jobs.',
                image: 'https://images.onata.com/test/02RNd9alezj.png',
                type: 'positionFilled'
            });
            if (users[i].deviceType.toLowerCase() === 'ios') {
                iosDevices.push(users[i].deviceToken);
            } else {
                androidDevices.push(users[i].deviceToken);
            }
        }

        /* Send push to both the users */
        let title = 'Position filled',
            body = (job.jobTitle === 'Others' ? job.subJobTitle : job.jobTitle) + ' position has been closed by the employer. Keep applying to new jobs.',
            data = {pushType: 'positionFilled', jobId: request.payload.jobId};
        push.createMessage('', androidDevices, data, 'ANDROID', title, body, 'beep');
        push.createMessage('', iosDevices, data, 'IOS', title, body, 'beep');

        /* Save into database */
        try {
            await notificationSchema.notificationSchema.insertMany(notifications);
        } catch (e) {
            logger.error('Error occurred while inserting notifications in mark as archived handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Get all the queued jobs and make visible flag to true */
    let queuedJobs = [];
    try {
        queuedJobs = await jobSchema.jobSchema.find({userId: mongoose.Types.ObjectId(request.payload.userId), inQueue: true, isArchived: false}, {_id: 1}, {lean: true}).limit(uniqueJobIds.length);
    } catch (e) {
        logger.error('Error occurred while finding queued jobs in mark as archived handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Make all the queued jobs visible and make the inQueue flag as false */
    for (let i = 0; i < queuedJobs.length; i++) {
        try {
            await jobSchema.jobSchema.findByIdAndUpdate({_id: queuedJobs[i]._id}, {
                $set: {
                    inQueue: false,
                    isVisible: true
                }
            }, {lean: true});
        } catch (e) {
            logger.error('Error occurred while making queued job as published in mark as archived handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Notify google to remove the same from the indexing */
    if (process.env.NODE_ENV === 'production') {
        if (request.payload.jobId) {
            try {
                await commonFunctions.Handlers.submitForIndexing(request.payload.jobId, true);
            } catch (e) {
                logger.error('Error occurred while submitting the job to google for indexing %s:', JSON.stringify(e));
            }
        } else if (request.payload.jobIds.length) {
            for (let i = 0; i < request.payload.jobIds.length; i++) {
                try {
                    await commonFunctions.Handlers.submitForIndexing(request.payload.jobIds[i], true);
                } catch (e) {
                    logger.error('Error occurred while submitting the job to google for indexing %s:', JSON.stringify(e));
                }
            }
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Your job(s) has been marked as archived now.', 'success', 204)).code(200);
};

employerHandler.uploadVideo = async (request, h) => {
    let checkUser, decoded, videoUrl;

    /* Check if user exists in EZJobs database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in upload video handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in upload video handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Upload video and generate URL */
    try {
        videoUrl = await commonFunctions.Handlers.uploadImage(request.payload.video.path, request.payload.video.filename);
    } catch (e) {
        logger.error('Error occurred while uploading video in upload video handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (videoUrl) {
        return h.response(responseFormatter.responseFormatter({url: videoUrl}, 'Uploaded successfully', 'success', 201)).code(200);
    } else {
        return h.response(responseFormatter.responseFormatter({}, 'Error occurred while uploading video', 'error', 500)).code(500);
    }
};

employerHandler.getAddressesForChat = async (request, h) => {
    let checkEmployer, checkJob, decoded;

    /* Check if user exists in EZJobs database */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get addresses for chat handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get addresses for chat handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Find job details */
    try {
        checkJob = await jobSchema.jobSchema.findOne({userId: mongoose.Types.ObjectId(request.query.employerId), _id: mongoose.Types.ObjectId(request.query.jobId)}, {address: 1, walkInInterviewAddress: 1, isWalkInInterview: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding job in get addresses for chats handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkJob) {
        return h.response(responseFormatter.responseFormatter({}, 'Job not found', 'error', 404)).code(404);
    } else if (!checkJob.isWalkInInterview) {
        checkJob.walkInInterviewAddress = {
            address1 : '',
            address2 : '',
            city : '',
            state : '',
            zipCode : '',
            subLocality : ''
        };
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({jobAddress: checkJob.address, walkInAddress: checkJob.walkInInterviewAddress, companyAddress: checkEmployer.employerInformation.companyAddress}, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.getMinMaxSalariesTest = async (request, h) => {
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
        data = await minMaxSalarySchema.minMaxSalarySchema.find({country: request.query.country, role: 'job'}, {country: 0, _id: 0, createdAt: 0, updatedAt: 0, role: 0}, {lean: true});
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

employerHandler.changeTranslationStatus = async (request, h) => {
    let checkEmployer, decoded, checkChat, checkSubscription, checkPackage;

    /* Check if user exists in EZJobs database */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in change translation status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in change translation status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Find subscription details */
    if (checkEmployer.subscriptionInfo && checkEmployer.subscriptionInfo.subscriptionId) {
        try {
            checkSubscription = await subscriptionSchema.subscriptionSchema.findById({_id: checkEmployer.subscriptionInfo.subscriptionId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding subscription in change translation status handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Find package details */
    if (!checkSubscription && checkEmployer.subscriptionInfo) {
        try {
            checkPackage = await packageSchema.packageSchema.findById({_id: checkEmployer.subscriptionInfo.packageId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding package in change translation status handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!checkPackage) {
            return h.response(responseFormatter.responseFormatter({}, 'Package not found!', 'error', 404)).code(404);
        }
    }

    if (checkPackage) {
        if (!checkPackage.numberOfTextTranslations.isIncluded) {
            return h.response(responseFormatter.responseFormatter({}, 'This feature is not available in your package!', 'error', 400)).code(400);
        }
    }

    if (checkSubscription) {
        if (checkSubscription.numberOfTextTranslations.isIncluded && !checkSubscription.numberOfTextTranslations.isUnlimited && request.payload.status) {
            if (checkSubscription.numberOfTextTranslations.count < 1) {
                return h.response(responseFormatter.responseFormatter({}, 'You have used all translation quota for your current package', 'error', 400)).code(400);
            }
        } else if (checkSubscription.isWallet && checkSubscription.walletAmount <= 0) {
            return h.response(responseFormatter.responseFormatter({}, 'Insufficient wallet balance for translation', 'error', 400)).code(400);
        }
    }

    /* Find job details */
    try {
        checkChat = await conversationSchema.conversationSchema.findById({_id: mongoose.Types.ObjectId(request.payload.chatId)}, {isTranslationAccepted: 1, isNotified: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding chat in change translation status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkChat) {
        return h.response(responseFormatter.responseFormatter({}, 'Chat not found', 'error', 404)).code(404);
    } /*else if (!checkChat.isTranslationAccepted && !request.payload.status) {
        return h.response(responseFormatter.responseFormatter({}, 'Please allow the translation first to stop it.', 'error', 400)).code(400);
    }*/ else if (checkChat.isTranslationAccepted && request.payload.status) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not active already activated translation.', 'error', 400)).code(400);
    }

    /*
    * Update conversation
    * */
    try {
        await conversationSchema.conversationSchema.findByIdAndUpdate({_id: request.payload.chatId}, {$set: {isTranslationAccepted: !!request.payload.status, isNotified: true}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating chat in change translation status handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter({}, 'Preference updated', 'success', 204)).code(200);
};

employerHandler.calculatePricing = async (request, h) => {
    let pricing, totalMonthly = 0, totalYearly = 0, features = request.payload.features, total = 0, packageInfo;

    try {
        pricing = await pricingSchema.pricingSchema.findOne({country: request.payload.country, isActive: true}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting pricing data in calculate pricing handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!pricing) {
        return h.response(responseFormatter.responseFormatter({}, 'No pricing information found to customize a package', 'error', 400)).code(400);
    } else if (request.payload.days && request.payload.isAddOn) {
        return h.response(responseFormatter.responseFormatter({}, 'You can not specify days while adding add-ons to your existing subscription', 'error', 400)).code(400);
    }

    /* Get package information if package id is provided */
    if (request.payload.packageId) {
        try {
            packageInfo = await packageSchema.packageSchema.findById({_id: request.payload.packageId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in getting package data in calculate pricing handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!packageInfo) {
            return h.response(responseFormatter.responseFormatter({}, 'No such package', 'error', 404)).code(404);
        }

        request.payload.days = packageInfo.validity || 0;
        total = packageInfo.total * (request.payload.multiplier || 1);
    } else {
        /* Loop through all the features for calculating price */
        const len = features.length;
        for (let i = 0; i < len; i++) {

            if (features[i].key === 'numberOfJobs') {
                if (!features[i].isFree || !features[i].isUnlimited) {
                    if (request.payload.days) {
                        total += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfJobs.basePrice, pricing.numberOfJobs.count, features[i].count, 'fixed', 0, request.payload.days);
                    } else {
                        totalMonthly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfJobs.basePrice, pricing.numberOfJobs.count, features[i].monthlyCount, 'monthly', 0);
                        totalYearly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfJobs.basePrice, pricing.numberOfJobs.count, features[i].yearlyCount * 12, 'yearly', 0);
                    }
                }
            }

            if (features[i].key === 'numberOfUsers') {
                if ((!features[i].isFree || !features[i].isUnlimited) && (features[i].monthlyCount || features[i].yearlyCount)) {
                    if (request.payload.days) {
                        total += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfUsers.basePrice, pricing.numberOfUsers.count, features[i].count, 'fixed', 0, request.payload.days);
                    } else {
                        totalMonthly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfUsers.basePrice, pricing.numberOfUsers.count, features[i].monthlyCount, 'monthly', 0);
                        totalYearly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfUsers.basePrice, pricing.numberOfUsers.count, features[i].yearlyCount, 'yearly', 0);
                    }
                }
            }

            if (features[i].key === 'numberOfViews') {
                if (!features[i].isFree || !features[i].isUnlimited) {
                    if (request.payload.days) {
                        total += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfViews.basePrice, pricing.numberOfViews.count, features[i].count, 'fixed', 0, request.payload.days);
                    } else {
                        totalMonthly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfViews.basePrice, pricing.numberOfViews.count, features[i].monthlyCount, 'monthly', 0);;
                        totalYearly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfViews.basePrice, pricing.numberOfViews.count, features[i].yearlyCount, 'yearly', 0);
                    }
                }
            }

            if (features[i].key === 'numberOfTextTranslations') {
                if (!features[i].isFree || !features[i].isUnlimited) {
                    if (request.payload.days) {
                        total += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfTextTranslations.basePrice, pricing.numberOfTextTranslations.count, features[i].count, 'fixed', 0, request.payload.days);
                    } else {
                        totalMonthly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfTextTranslations.basePrice, pricing.numberOfTextTranslations.count, features[i].monthlyCount, 'monthly', 0);
                        totalYearly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfTextTranslations.basePrice, pricing.numberOfTextTranslations.count, features[i].yearlyCount, 'yearly', 0);
                    }
                }
            }

            if (features[i].key === 'numberOfJobTranslations') {
                if (!features[i].isFree || !features[i].isUnlimited) {
                    if (request.payload.days) {
                        total += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfJobTranslations.basePrice, pricing.numberOfJobTranslations.count, features[i].count, 'fixed', 0, request.payload.days);
                    } else {
                        totalMonthly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfJobTranslations.basePrice, pricing.numberOfJobTranslations.count, features[i].monthlyCount, 'monthly', 0);
                        totalYearly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfJobTranslations.basePrice, pricing.numberOfJobTranslations.count, features[i].yearlyCount, 'yearly', 0);
                    }
                }
            }

            if (features[i].key === 'videoCall') {
                if (!features[i].isFree || !features[i].isUnlimited) {
                    if (request.payload.days) {
                        total += commonFunctions.Handlers.calculatePricing(pricing.videoCall.basePrice, 0, 'fixed');
                    } else {
                        totalMonthly += commonFunctions.Handlers.calculatePricing(pricing.videoCall.basePrice, 0, 'monthly');
                        totalYearly += commonFunctions.Handlers.calculatePricing(pricing.videoCall.basePrice, 0, 'yearly');
                    }
                }
            }

            if (features[i].key === 'audioCall') {
                if (!features[i].isFree || !features[i].isUnlimited) {
                    if (request.payload.days) {
                        total += commonFunctions.Handlers.calculatePricing(pricing.audioCall.basePrice, 0, 'fixed');
                    } else {
                        totalMonthly += commonFunctions.Handlers.calculatePricing(pricing.audioCall.basePrice, 0, 'monthly');
                        totalYearly += commonFunctions.Handlers.calculatePricing(pricing.audioCall.basePrice, 0, 'yearly');
                    }
                }
            }

            if (features[i].key === 'jobsInAllLocalities') {
                if (!features[i].isFree || !features[i].isUnlimited) {
                    if (request.payload.days) {
                        total += commonFunctions.Handlers.calculatePricing(pricing.jobsInAllLocalities.basePrice, 0, 'fixed');
                    } else {
                        totalMonthly += commonFunctions.Handlers.calculatePricing(pricing.jobsInAllLocalities.basePrice, 0, 'monthly');
                        totalYearly += commonFunctions.Handlers.calculatePricing(pricing.jobsInAllLocalities.basePrice, 0, 'yearly');
                    }
                }
            }

            if (features[i].key === 'showOnline') {
                if (!features[i].isFree || !features[i].isUnlimited) {
                    if (request.payload.days) {
                        total += commonFunctions.Handlers.calculatePricing(pricing.showOnline.basePrice, 0, 'fixed');
                    } else {
                        totalMonthly += commonFunctions.Handlers.calculatePricing(pricing.showOnline.basePrice, 0, 'monthly');
                        totalYearly += commonFunctions.Handlers.calculatePricing(pricing.showOnline.basePrice, 0, 'yearly');
                    }
                }
            }
        }

        if (request.payload.days) {
            total = parseFloat(total.toFixed(2));
        } else {
            totalMonthly = parseFloat(totalMonthly.toFixed(2));
            totalYearly = parseFloat(totalYearly.toFixed(2));
        }
    }

    return h.response(responseFormatter.responseFormatter(request.payload.days ? {total: total} : {totalMonthly: totalMonthly, totalYearly: totalYearly}, 'Fetched successfully.', 'success', 204)).code(200);
};

employerHandler.createCustomSubscription = async (request, h) => {
    let checkEmployer, decoded, checkSubscription, pricing, totalMonthly = 0, totalYearly = 0, features = request.payload.features, currency, taxBracket, checkPromoCode, amount,
    subscriptionData = {
        userId: mongoose.Types.ObjectId(request.payload.userId),
        planId: '',
        planType: request.payload.planType.toLowerCase() === 'monthly' ? 'monthly' : 'yearly',
        razorSubscriptionId: '',
        razorpay_payment_id: '',
        isSignatureVerified: false,
        isPaid: false,
        purchasedDate: new Date(),
        isEnded: true,
        isActive: false,
        startDate: new Date(),
        numberOfJobs: {
            count: 0,
            isUnlimited: false,
            isFree: false,
            isIncluded: false
        },
        numberOfViews: {
            count: 0,
            isUnlimited: false,
            isFree: false,
            isIncluded: false
        },
        numberOfUsers: {
            count: 0,
            isUnlimited: false,
            isFree: false,
            isIncluded: false
        },
        numberOfTextTranslations: {
            count: 0,
            isUnlimited: false,
            isFree: false,
            isIncluded: false
        },
        numberOfJobTranslations: {
            count: 0,
            isUnlimited: false,
            isFree: false,
            isIncluded: false
        },
        jobsInAllLocalities: {
            count: 0,
            isUnlimited: false,
            isFree: false,
            isIncluded: false
        },
        audioCall: {
            isUnlimited: false,
            isFree: false,
            isIncluded: false
        },
        videoCall: {
            isUnlimited: false,
            isFree: false,
            isIncluded: false
        },
        showOnline: {
            isUnlimited: false,
            isFree: false,
            isIncluded: false
        },
        history: [],
        errs: [],
        customerId: '',
        isFree: false,
        startAt: 0,
        orderId: '',
        taxAmount: 0,
        taxType: '',
        promoCode: '',
        expiresAt: null,
        isPromoApplied: false,
        extras: [],
        chargeAt: 0,
        totalAmountPaid: 0
    }, subscription, order, activeJobs, constantData, dataToReturn = {
        orderId: '',
        subscriptionId: '',
        planValue: 0,
        planDiscount: 0,
        monthlyDiscount: 0,
        yearlyDiscount: 0,
        promoDiscount: 0,
        subTotal: 0,
        tax: 0,
        total: 0
    };

    console.log(features);

    /* Check if user exists in EZJobs database */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.userId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in create custom subscription handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in create custom subscription handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    } else if (checkEmployer.isSlave) {
        return h.response(responseFormatter.responseFormatter({}, 'You cannot perform this action as your account does not have that privilege', 'error', 400)).code(400);
    }

    /* Check if subscription */
    try {
        checkSubscription = await subscriptionSchema.subscriptionSchema.findById({_id: checkEmployer.subscriptionInfo.subscriptionId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting subscription information in create custom subscription handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!request.payload.isExtend) {
        if (!checkSubscription.isFree && checkSubscription.isActive) {
            return h.response(responseFormatter.responseFormatter({}, 'You have already purchased a subscription.', 'error', 400)).code(400);
        }

    }

    try {
        pricing = await pricingSchema.pricingSchema.findOne({country: request.payload.country, isActive: true}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred in getting pricing data in create custom subscription handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!pricing) {
        return h.response(responseFormatter.responseFormatter({}, 'No pricing information found to customize a package', 'error', 400)).code(400);
    }

    /* Fetch constant data for taxes */
    try {
        constantData = await constantSchema.constantSchema.findOne({}, {taxes: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding constant data in create custom subscription handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Loop through all the features for calculating price */

    const len = features.length;
    for (let i = 0; i < len; i++) {
        if (features[i].key === 'numberOfJobs') {
            if (!features[i].isFree) {
                totalMonthly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfJobs.basePrice, pricing.numberOfJobs.count, features[i].monthlyCount, 'monthly', 0);
                totalYearly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfJobs.basePrice, pricing.numberOfJobs.count, features[i].yearlyCount * 12, 'yearly', 0);

                subscriptionData.numberOfJobs.count = request.payload.planType.toLowerCase() === 'monthly' ? features[i].monthlyCount : features[i].yearlyCount * 12;
            } else {
                subscriptionData.numberOfJobs.isFree = features[i].isFree;
            }
            subscriptionData.numberOfJobs.isUnlimited = features[i].isUnlimited;
            subscriptionData.numberOfJobs.isIncluded = true;
        }

        if (features[i].key === 'numberOfUsers') {
            if ((!features[i].isFree) && (features[i].monthlyCount || features[i].yearlyCount)) {
                totalMonthly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfUsers.basePrice, pricing.numberOfUsers.count, features[i].monthlyCount, 'monthly', 0);
                totalYearly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfUsers.basePrice, pricing.numberOfUsers.count, features[i].yearlyCount, 'yearly', 0);

                subscriptionData.numberOfUsers.count = request.payload.planType.toLowerCase() === 'monthly' ? features[i].monthlyCount : features[i].yearlyCount;
            } else {
                subscriptionData.numberOfUsers.isFree = features[i].isFree;
            }
            subscriptionData.numberOfUsers.isUnlimited = features[i].isUnlimited;
            subscriptionData.numberOfUsers.isIncluded = true;
        }

        if (features[i].key === 'numberOfViews') {
            if (!features[i].isFree) {
                totalMonthly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfViews.basePrice, pricing.numberOfViews.count, features[i].monthlyCount, 'monthly', 0);;
                totalYearly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfViews.basePrice, pricing.numberOfViews.count, features[i].yearlyCount, 'yearly', 0);

                subscriptionData.numberOfViews.count = request.payload.planType.toLowerCase() === 'monthly' ? features[i].monthlyCount : features[i].yearlyCount;
            } else {
                subscriptionData.numberOfViews.isFree = features[i].isFree;
            }
            subscriptionData.numberOfViews.isUnlimited = features[i].isUnlimited;
            subscriptionData.numberOfViews.isIncluded = true;
        }

        if (features[i].key === 'numberOfTextTranslations') {
            if (!features[i].isFree) {
                totalMonthly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfTextTranslations.basePrice, pricing.numberOfTextTranslations.count, features[i].monthlyCount, 'monthly', 0);
                totalYearly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfTextTranslations.basePrice, pricing.numberOfTextTranslations.count, features[i].yearlyCount, 'yearly', 0);

                subscriptionData.numberOfTextTranslations.count = request.payload.planType.toLowerCase() === 'monthly' ? features[i].monthlyCount : features[i].yearlyCount;
            } else {
                subscriptionData.numberOfTextTranslations.isFree = features[i].isFree;
            }
            subscriptionData.numberOfTextTranslations.isUnlimited = features[i].isUnlimited;
            subscriptionData.numberOfTextTranslations.isIncluded = true;
        }

        if (features[i].key === 'numberOfJobTranslations') {
            if (!features[i].isFree) {
                totalMonthly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfJobTranslations.basePrice, pricing.numberOfJobTranslations.count, features[i].monthlyCount, 'monthly', 0);
                totalYearly += commonFunctions.Handlers.calculateFinalPrice(pricing.numberOfJobTranslations.basePrice, pricing.numberOfJobTranslations.count, features[i].yearlyCount, 'yearly', 0);

                subscriptionData.numberOfJobTranslations.count = request.payload.planType.toLowerCase() === 'monthly' ? features[i].monthlyCount : features[i].yearlyCount;
            } else {
                subscriptionData.numberOfJobTranslations.isFree = features[i].isFree;
            }
            subscriptionData.numberOfJobTranslations.isUnlimited = features[i].isUnlimited;
            subscriptionData.numberOfJobTranslations.isIncluded = true;
        }

        if (features[i].key === 'videoCall') {
            if (!features[i].isFree) {
                totalMonthly += commonFunctions.Handlers.calculatePricing(pricing.videoCall.basePrice, 0, 'monthly');
                totalYearly += commonFunctions.Handlers.calculatePricing(pricing.videoCall.basePrice, 0, 'yearly');
            } else {
                subscriptionData.videoCall.isFree = features[i].isFree;
            }
            subscriptionData.videoCall.isUnlimited = true;
            subscriptionData.videoCall.isIncluded = true;
        }

        if (features[i].key === 'audioCall') {
            if (!features[i].isFree) {
                totalMonthly += commonFunctions.Handlers.calculatePricing(pricing.audioCall.basePrice, 0, 'monthly');
                totalYearly += commonFunctions.Handlers.calculatePricing(pricing.audioCall.basePrice, 0, 'yearly');
            } else {
                subscriptionData.audioCall.isFree = features[i].isFree;
            }
            subscriptionData.audioCall.isUnlimited = true;
            subscriptionData.audioCall.isIncluded = true;
        }

        if (features[i].key === 'jobsInAllLocalities') {
            if (!features[i].isFree) {
                totalMonthly += commonFunctions.Handlers.calculatePricing(pricing.jobsInAllLocalities.basePrice, 0, 'monthly');
                totalYearly += commonFunctions.Handlers.calculatePricing(pricing.jobsInAllLocalities.basePrice, 0, 'yearly');
            } else {
                subscriptionData.jobsInAllLocalities.isFree = features[i].isFree;
            }
            subscriptionData.jobsInAllLocalities.isUnlimited = true;
            subscriptionData.jobsInAllLocalities.isIncluded = true;
        }

        if (features[i].key === 'showOnline') {
            if (!features[i].isFree) {
                totalMonthly += commonFunctions.Handlers.calculatePricing(pricing.showOnline.basePrice, 0, 'monthly');
                totalYearly += commonFunctions.Handlers.calculatePricing(pricing.showOnline.basePrice, 0, 'yearly');
            } else {
                subscriptionData.showOnline.isFree = features[i].isFree;
            }
            subscriptionData.showOnline.isUnlimited = true;
            subscriptionData.showOnline.isIncluded = true;
        }
    }

    totalMonthly = parseFloat(totalMonthly.toFixed(2));
    totalYearly = parseFloat(totalYearly.toFixed(2));

    if (request.payload.country) {
        try {
            currency = await codeSchema.CodeSchema.findOne({countryISOName: request.payload.country}, {currencyName: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred in getting currency data in create custom subscription handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Get tax bracket */
    if (request.payload.country) {
        const taxIndex = constantData.taxes.findIndex(k => k.country.toLowerCase() === request.payload.country.toLowerCase());
        if (taxIndex !== -1) {
            taxBracket = constantData.taxes[taxIndex];
        } else {
            taxBracket = {
                taxType: 'NA',
                taxAmount: 0
            }
        }
        subscriptionData.taxAmount = taxBracket.taxAmount;
        subscriptionData.taxType = taxBracket.taxType;
    }

    const notes = {
        customerId: checkEmployer._id,
        customerName: checkEmployer.firstName + ' ' + checkEmployer.lastName,
        email: checkEmployer.email,
        phone: checkEmployer.employerInformation.companyPhone ? checkEmployer.employerInformation.companyPhone : 'NA',
        extended: request.payload.isExtend
    };

    if (request.payload.promoCode) {
        try {
            checkPromoCode = await promoSchema.promoCodeSchema.findOne({promoCode: request.payload.promoCode, planType: request.payload.planType.toLowerCase()}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred finding promo code information in create custom package handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkPromoCode || !checkPromoCode.count) {
            return h.response(responseFormatter.responseFormatter({}, 'Promo is not valid.', 'error', 400)).code(400);
        } else if (checkPromoCode.planType.toLowerCase() !== request.payload.planType.toLowerCase()) {
            return h.response(responseFormatter.responseFormatter({}, 'Promo is not valid.', 'error', 400)).code(400);
        } else {
            if (currency.currencyName !== checkPromoCode.currency) {
                return h.response(responseFormatter.responseFormatter({}, 'Promo is not valid.', 'error', 400)).code(400);
            }
            amount = request.payload.planType.toLowerCase() === 'monthly' ? totalMonthly : totalYearly;
            dataToReturn.planValue = amount;
            if (checkPromoCode.promoType === 'fixed') {
                dataToReturn.promoDiscount = checkPromoCode.amount;
                amount = amount - checkPromoCode.amount;
            } else {
                dataToReturn.promoDiscount = amount * (checkPromoCode.amount / 100);
                amount = amount * (1 - (checkPromoCode.amount / 100));
            }
            subscriptionData.promoCode = request.payload.promoCode;
        }
    } else {
        amount = request.payload.planType.toLowerCase() === 'monthly' ? totalMonthly : totalYearly;
        dataToReturn.planValue = amount;
    }
    dataToReturn.subTotal = amount;
    dataToReturn.tax = amount * (taxBracket.taxAmount / 100);
    amount = amount * (1 + (taxBracket.taxAmount / 100));
    dataToReturn.total = amount;

    amount = amount.toFixed(2) * 100;
    if (request.payload.isFinal) {
        order = await rzrPay.Handler.createOrder(amount, currency.currencyName, notes);
        if (order.statusCode && order.statusCode !== 200) {
            return h.response(responseFormatter.responseFormatter({}, order.error.error.description, 'error', order.statusCode)).code(order.statusCode);
        }
        subscriptionData.orderId = order.id;
        subscriptionData.totalAmountPaid = dataToReturn.total;

        /* Get posted jobs */
        try {
            activeJobs = await jobSchema.jobSchema.countDocuments({userId: mongoose.Types.ObjectId(request.payload.userId), isArchived: false, isTranslated: false});
        } catch (e) {
            logger.error('Error occurred finding active jobs count information in create custom package handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Create subscription */
        if (!request.payload.isExtend) {
            subscriptionData.numberOfJobs.count -= activeJobs;
        } else {
            subscriptionData.numberOfJobs.count = checkSubscription.numberOfJobs.count;
            subscriptionData.numberOfUsers.count = checkSubscription.numberOfUsers.count;
        }
        subscriptionData.isExtend = !!request.payload.isExtend;
        try {
            subscription = await new subscriptionSchema.subscriptionSchema(subscriptionData).save();
        } catch (e) {
            logger.error('Error occurred saving subscription information in create custom package handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        dataToReturn.subscriptionId = subscription._id;
        dataToReturn.orderId = subscription.orderId;
    }

    /* Send email to the app support for the created subscription */
    if (process.env.NODE_ENV === 'production') {
        let companyType, constant;

        try {
            constant = await constantSchema.constantSchema.findOne({}, {businessTypes: 1}, {lean: true});
        } catch (e) {
            logger.error('Error in finding constant data while creating custom subscription %s:', JSON.stringify(e));
        }

        if (constant.businessTypes) {
            const idx = constant.businessTypes.findIndex(k => k._id.toString() === checkEmployer.employerInformation.companyType);
            if (idx !== -1) {
                companyType = constant.businessTypes[idx].name;
            }
        }

        const mailOptions = {
            from: 'support@ezjobs.io',
            to: 'sales@ezjobs.io',
            subject: 'Payment screen visited',
            text: 'Email: ' + checkEmployer.email + '\n' +
                'Name: ' + checkEmployer.firstName + ' ' + checkEmployer.lastName + '\n' +
                'Phone: ' + checkEmployer.employerInformation.countryCode + (checkEmployer.employerInformation.companyPhone ? checkEmployer.employerInformation.companyPhone : 'N/A') + '\n' +
                'Package: Custom' + '\n' +
                'Price: ' + (request.payload.planType.toLowerCase() === 'monthly' ? totalMonthly : totalYearly) + '\n' +
                'Company Name: ' + checkEmployer.employerInformation.companyName + '\n' +
                'Company Type: ' + (companyType ? companyType : 'NA') + '\n' +
                'Payment Type: One-time'
        };
        try {
            await commonFunctions.Handlers.nodeMailerEZJobs(mailOptions.from, mailOptions.subject, mailOptions.text, mailOptions.to);
        } catch (e) {
            logger.error('Error in sending email to support while creating custom subscription %s:', JSON.stringify(e));
        }

        let statusEmployer = await commonFunctions.Handlers.updateHubSpotContactEmployer(checkEmployer.email, [{property: 'plan_visited', value: 'Custom'}, {property: 'plan_visited_date', value: new Date().setHours(0, 0, 0, 0)}]);
        if (statusEmployer === 404) {
            console.log('HubSpot contact not found');
        }
    }

    return h.response(responseFormatter.responseFormatter(dataToReturn, request.payload.isFinal ? 'Order created' : 'Price updated.', 'success', 201)).code(200);
};

employerHandler.addUser = async (request, h) => {
    let checkEmployer, decoded, user, checkDuplicate, checkSubscription, packageData, pricing;

    /* Check if user exists in EZJobs database */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in add user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in add user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    } else if (checkEmployer.isSlave) {
        return h.response(responseFormatter.responseFormatter({}, 'You cannot add users as your account does not have that privilege', 'error', 400)).code(400);
    }

    /* Check if subscription */

    try {
        [checkSubscription, packageData] = await Promise.all([
            subscriptionSchema.subscriptionSchema.findById({_id: checkEmployer.subscriptionInfo.subscriptionId}, {}, {lean: true}),
            packageSchema.packageSchema.findById({_id: checkEmployer.subscriptionInfo.packageId}, {}, {lean: true})
        ]);
    } catch (e) {
        logger.error('Error occurred while getting subscription information in add user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkSubscription && checkSubscription.isPaid) {
        if (!checkSubscription.numberOfUsers.isIncluded) {
            return h.response(responseFormatter.responseFormatter({}, 'You can not add users in your current package.', 'error', 400)).code(400);
        } else if (!checkSubscription.numberOfUsers.count && !checkSubscription.numberOfUsers.isUnlimited) {
            return h.response(responseFormatter.responseFormatter({}, 'You have reached quota for adding users.', 'error', 400)).code(400);
        }
    }

    try {
        pricing = await pricingSchema.pricingSchema.findOne({country: packageData.country}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting pricing information in add user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check for duplicate user */
    try {
        checkDuplicate = await userSchema.UserSchema.findOne({email: new RegExp('^' + request.payload.email.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") + '$', 'gi')}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding duplicate in add user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (checkDuplicate) {
        return h.response(responseFormatter.responseFormatter({}, 'Account already exists', 'error', 400)).code(400);
    }

    const cost = (pricing.numberOfUsers.basePrice / pricing.numberOfUsers.count) || 0;
    if (checkSubscription.isWallet && checkSubscription.walletAmount < cost) {
        return h.response(responseFormatter.responseFormatter({}, 'Insufficient wallet balance', 'error', 400)).code(400);
    }

    /* Create user and save it into database */
    user = new userSchema.UserSchema(request.payload);
    user.employerInformation = checkEmployer.employerInformation;
    user.employerInformation.numberOfJobsPosted = 0;
    user.subscriptionInfo = checkEmployer.subscriptionInfo;
    user.roles = checkEmployer.roles;
    user.password = commonFunctions.Handlers.generatePassword();
    user.referralCode = commonFunctions.Handlers.generateReferralCode(request.payload.firstName);
    user.employeeInformation.location = user.employerInformation.companyLocation;
    user.employeeInformation.preferredLocations = {
        type: 'MultiPoint',
        coordinates: [user.employerInformation.companyLocation.coordinates]
    };
    user.isMaster = false;
    user.isSlave = true;
    user.isRoleSet = true;
    user.isPreferenceSet = true;
    user.phone = '';

    /* Send app download email */
    let email = {
        to: [{
            email: request.payload.email,
            type: 'to'
        }],
        subject: user.firstName + ' ' + user.lastName + ' has invited you to join them in EZJobs',
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
                    name: 'name',
                    content: user.firstName + ' ' + user.lastName
                },
                {
                    name: 'url',
                    content: 'https://employer.ezjobs.io/#/login'
                }
            ]
        }]
    };

    try {
        await mandrill.Handlers.sendTemplate('ezjobs-portal-invite', [], email, true);
    } catch (e) {
        logger.error('Error occurred while sending email in add user handler %s:', JSON.stringify(e));
    }

    try {
        await user.save();
    } catch (e) {
        logger.error('Error occurred while saving user in add user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Update subscription */
    if (checkSubscription.isWallet) {
        try {
            await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkEmployer.subscriptionInfo.subscriptionId}, {
                $inc: {
                    'numberOfUsers.count': 1,
                    walletAmount: -cost
                }
            }, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating subscription in add user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        try {
            await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkEmployer.subscriptionInfo.subscriptionId}, {$inc: {'numberOfUsers.count': -1}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating subscription in add user handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Update master account user */
    try {
        await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.employerId}, {$push: {slaveUsers: user._id}}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while updating user in add user handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(user, 'User added successfully', 'success', 201)).code(200);
};

employerHandler.getUsers = async (request, h) => {
    let checkEmployer, decoded, users, subscriptionData, jobPipeline = [], viewPipeline, pricingInfo, packageInfo;

    /* Check if user exists in EZJobs database */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get package information and subscription information */
    try {
        [packageInfo, subscriptionData] = await Promise.all([
            packageSchema.packageSchema.findById({_id: checkEmployer.subscriptionInfo.packageId}, {country: 1}, {lean: true}),
            subscriptionSchema.subscriptionSchema.findById({_id: checkEmployer.subscriptionInfo.subscriptionId}, {}, {lean: true})
        ]);
    } catch (e) {
        logger.error('Error occurred while finding subscription and package information in get users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (subscriptionData.isWallet) {
        jobPipeline = [
            {
                $match: {
                    $expr: {
                        $and: [
                            {
                                $gt: ["$createdAt", subscriptionData.purchasedDate]
                            },
                            {
                                $eq: ["$$slaveUsers", "$userId"]
                            },
                            {
                                $and: [{$eq: ["$isVisible", true]}, {$eq: ["$isTranslated", false]}]
                            }
                        ]
                    }
                }
            },
            {
                $project: {
                    _id: 1
                }
            }
        ];
    } else {
        jobPipeline = [
            {
                $match: {
                    $expr: {
                        $and: [
                            {
                                $gt: ["$createdAt", subscriptionData.purchasedDate]
                            },
                            {
                                $eq: ["$$slaveUsers", "$userId"]
                            },
                            {
                                $and: [{$eq: ["$isArchived", false]}, {$eq: ["$isVisible", true]}, {$eq: ["$isTranslated", false]}]
                            }
                        ]
                    }
                }
            },
            {
                $project: {
                    _id: 1
                }
            }
        ];
    }

    viewPipeline = [
        {
            $match: {
                $expr: {
                    $and: [
                        {
                            $gt: ["$createdAt", subscriptionData.purchasedDate]
                        },
                        {
                            $eq: ["$$slaveUsers", "$employerId"]
                        }
                    ]
                }
            }
        },
        {
            $project: {
                _id: 1
            }
        }
    ];

    /* Get user information */
    try {
        users = await userSchema.UserSchema.aggregate([
            {
                $match: {
                    _id: mongoose.Types.ObjectId(request.query.employerId)
                }
            },
            {
                $unwind: {
                    path: '$slaveUsers'
                }
            },
            {
                $lookup: {
                    from: 'Views',
                    let: {slaveUsers: '$slaveUsers'},
                    pipeline: viewPipeline,
                    as: 'views'
                }
            },
            {
                $lookup: {
                    from: 'User',
                    localField: 'slaveUsers',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: {
                    path: '$user'
                }
            },
            {
                $lookup: {
                    from: 'Job',
                    let: {slaveUsers: '$slaveUsers'},
                    pipeline: jobPipeline,
                    as: 'jobs'
                }
            },
            {
                $project: {
                    _id: '$user._id',
                    profilePhoto: '$user.employeeInformation.profilePhoto',
                    email: '$user.email',
                    firstName: '$user.firstName',
                    lastName: '$user.lastName',
                    isActive: '$user.isActive',
                    hasOwned: '$user.hasOwned',
                    views: {
                        $size: '$views'
                    },
                    jobs: {
                        $size: '$jobs'
                    }
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred while aggregating user in get users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get pricing information for total spent amount */
    if (subscriptionData.isWallet) {
        try {
            pricingInfo = await pricingSchema.pricingSchema.findOne({country: packageInfo.country}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching pricing information in get users handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        for (let i = 0; i < users.length; i++) {
            users[i].totalSpent = (users[i].views * (pricingInfo.numberOfViews.basePrice / pricingInfo.numberOfViews.count)) +
                (users[i].jobs * (pricingInfo.numberOfJobs.basePrice / pricingInfo.numberOfJobs.count))
        }
    }

    return h.response(responseFormatter.responseFormatter(users, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.removeUser = async (request, h) => {
    let checkEmployer, decoded;

    /* Check if user exists in EZJobs database */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get users handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    const idx = checkEmployer.slaveUsers.findIndex(i => i.toString() === request.payload.userId);
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
    return h.response(responseFormatter.responseFormatter({}, request.payload.isActive ? 'User activated successfully': 'User removed successfully', 'success', 204)).code(200);
};

employerHandler.getSubscriptionInfo = async (request, h) => {
    let checkEmployer, decoded, subscriptionData, pricing, currency;

    /* Check if user exists in EZJobs database */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get subscription info handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get subscription info handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    try {
        subscriptionData = await userSchema.UserSchema.aggregate([
            {
                $match: {
                    _id: mongoose.Types.ObjectId(request.query.employerId)
                }
            },
            {
                $lookup: {
                    localField: 'subscriptionInfo.packageId',
                    foreignField: '_id',
                    from: 'Package',
                    as: 'package'
                }
            },
            {
                $unwind: '$package'
            },
            {
                $lookup: {
                    localField: 'subscriptionInfo.subscriptionId',
                    foreignField: '_id',
                    from: 'Subscription',
                    as: 'subscription'
                }
            },
            {
                $unwind: {
                    path: '$subscription'
                }
            }
        ]);
    } catch (e) {
        logger.error('Error occurred while aggregating user collection in get subscription info handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    let extendRenewal, newExpiry;
    try {
        extendRenewal = await subscriptionRenewalSchema.subscriptionRenewalSchema.findOne({userId: mongoose.Types.ObjectId(request.query.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting expiry of extension subscription in get subscription info handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (extendRenewal) {
        try {
            newExpiry = await subscriptionSchema.subscriptionSchema.findById({_id: extendRenewal.subscriptionId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting expiry of new extension subscription in get subscription info handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    let finalData = {};
    if (subscriptionData.length) {
        subscriptionData = subscriptionData[0];

        /* Get pricing information and currency for the given country */
        try {
            [pricing, currency] = await Promise.all([
                await pricingSchema.pricingSchema.findOne({country: subscriptionData.package.country}, {}, {lean: true}),
                await codeSchema.CodeSchema.findOne({countryISOName: subscriptionData.package.country}, {currency: 1}, {lean: true})
            ]);
        } catch (e) {
            logger.error('Error occurred while getting pricing information in get subscription info handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        finalData = {
            package: {
                packageName: subscriptionData.package.packageName,
                features: [],
                totalMonthly: subscriptionData.package.totalMonthly,
                totalYearly: subscriptionData.package.totalYearly,
                country: subscriptionData.package.country,
                colorCode: subscriptionData.package.colorCode,
                isWallet: !!subscriptionData.package.isWallet,
                packageAmount: subscriptionData.package.total || 0,
                customText: subscriptionData.package.customText || '',
                currency: currency.currency
            },
            subscription: {
                packageName: subscriptionData.package.packageName,
                features: [],
                planType: subscriptionData.subscription.planType,
                startDate: subscriptionData.subscription.startDate,
                endDate: newExpiry ? newExpiry.expiresAt : subscriptionData.subscription.expiresAt,
                expiresAt: subscriptionData.subscription.expiresAt,
                idx: 0,
                applicationValidity: subscriptionData.subscription.applicationValidity || 0,
                walletAmount: subscriptionData.subscription.walletAmount || 0
            },
            isFree: false,
            startAt: subscriptionData.subscription.startAt,
            trialPeriod: subscriptionData.package.trialPeriod,
            isCustom: subscriptionData.package.isCustom,
            isOneTime: !!subscriptionData.subscription.orderId,
            taxType: subscriptionData.subscription.taxType,
            taxAmount: subscriptionData.subscription.taxAmount,
            planId: subscriptionData.subscription.planId,
            totalMonthlyBeforeTax: subscriptionData.package.totalMonthlyBeforeTax,
            totalYearlyBeforeTax: subscriptionData.package.totalYearlyBeforeTax
        };
        finalData.isFree = subscriptionData.package.isFree;
        finalData.subscription.idx = subscriptionData.package.idx;
        if (subscriptionData.package.numberOfJobs.isIncluded) {
            finalData.package.features.push({
                label: subscriptionData.package.numberOfJobs.label,
                key: 'numberOfJobs',
                isUnlimited: subscriptionData.package.numberOfJobs.isUnlimited,
                count: subscriptionData.package.numberOfJobs.count,
                basePrice: pricing.numberOfJobs.basePrice
            });
        }
        if (subscriptionData.package.numberOfUsers.isIncluded) {
            finalData.package.features.push({
                label: subscriptionData.package.numberOfUsers.label,
                key: 'numberOfUsers',
                isUnlimited: subscriptionData.package.numberOfUsers.isUnlimited,
                count: subscriptionData.package.numberOfUsers.count,
                basePrice: pricing.numberOfUsers.basePrice
            });
        }
        if (subscriptionData.package.numberOfViews.isIncluded) {
            finalData.package.features.push({
                label: subscriptionData.package.numberOfViews.label,
                key: 'numberOfViews',
                isUnlimited: subscriptionData.package.numberOfViews.isUnlimited,
                count: subscriptionData.package.numberOfViews.count,
                basePrice: pricing.numberOfViews.basePrice
            });
        }
        if (subscriptionData.package.videoCall.isIncluded) {
            finalData.package.features.push({
                label: subscriptionData.package.videoCall.label,
                key: 'videoCall',
                isUnlimited: subscriptionData.package.videoCall.isUnlimited,
                basePrice: pricing.videoCall.basePrice
            });
        }
        if (subscriptionData.package.audioCall.isIncluded) {
            finalData.package.features.push({
                label: subscriptionData.package.audioCall.label,
                key: 'audioCall',
                isUnlimited: subscriptionData.package.audioCall.isUnlimited,
                basePrice: pricing.audioCall.basePrice
            });
        }
        if (subscriptionData.package.numberOfTextTranslations.isIncluded) {
            finalData.package.features.push({
                label: subscriptionData.package.numberOfTextTranslations.label,
                key: 'numberOfTextTranslations',
                isUnlimited: subscriptionData.package.numberOfTextTranslations.isUnlimited,
                count: subscriptionData.package.numberOfTextTranslations.count,
                basePrice: pricing.numberOfTextTranslations.basePrice
            });
        }
        if (subscriptionData.package.numberOfJobTranslations.isIncluded) {
            finalData.package.features.push({
                label: subscriptionData.package.numberOfJobTranslations.label,
                key: 'numberOfJobTranslations',
                isUnlimited: subscriptionData.package.numberOfJobTranslations.isUnlimited,
                count: subscriptionData.package.numberOfJobTranslations.count,
                basePrice: pricing.numberOfJobTranslations.basePrice
            });
        }
        if (subscriptionData.package.showOnline.isIncluded) {
            finalData.package.features.push({
                label: subscriptionData.package.showOnline.label,
                key: 'showOnline',
                isUnlimited: subscriptionData.package.showOnline.isUnlimited,
                basePrice: pricing.showOnline.basePrice
            });
        }
        if (subscriptionData.package.jobsInAllLocalities.isIncluded) {
            finalData.package.features.push({
                label: subscriptionData.package.jobsInAllLocalities.label,
                key: 'jobsInAllLocalities',
                isUnlimited: subscriptionData.package.jobsInAllLocalities.isUnlimited,
                basePrice: pricing.jobsInAllLocalities.basePrice
            });
        }
        if (subscriptionData.package.customerSupport && subscriptionData.package.customerSupport.isIncluded) {
            finalData.package.features.push({
                label: subscriptionData.package.customerSupport.label,
                key: 'customerSupport',
                isUnlimited: true,
                basePrice: pricing.customerSupport.basePrice || 0
            });
        }
        if (subscriptionData.package.dedicatedManager && subscriptionData.package.dedicatedManager.isIncluded) {
            finalData.package.features.push({
                label: subscriptionData.package.dedicatedManager.label,
                key: 'dedicatedManager',
                isUnlimited: true,
                basePrice: pricing.dedicatedManager.basePrice || 0
            });
        }
        if (subscriptionData.subscription) {
            if (subscriptionData.subscription.numberOfJobs.isIncluded) {
                finalData.subscription.features.push({
                    label: subscriptionData.package.numberOfJobs.label,
                    key: 'numberOfJobs',
                    isFree: subscriptionData.subscription.numberOfJobs.isFree,
                    isUnlimited: subscriptionData.subscription.numberOfJobs.isUnlimited,
                    count: subscriptionData.subscription.numberOfJobs.count
                });
            }
            if (subscriptionData.subscription.numberOfUsers.isIncluded) {
                finalData.subscription.features.push({
                    label: subscriptionData.package.numberOfUsers.label,
                    key: 'numberOfUsers',
                    isFree: subscriptionData.subscription.numberOfUsers.isFree,
                    isUnlimited: subscriptionData.subscription.numberOfUsers.isUnlimited,
                    count: subscriptionData.subscription.numberOfUsers.count
                });
            }
            if (subscriptionData.subscription.numberOfViews.isIncluded) {
                finalData.subscription.features.push({
                    label: subscriptionData.package.numberOfViews.label,
                    key: 'numberOfViews',
                    isFree: subscriptionData.subscription.numberOfViews.isFree,
                    isUnlimited: subscriptionData.subscription.numberOfViews.isUnlimited,
                    count: subscriptionData.subscription.numberOfViews.count
                });
            }
            if (subscriptionData.subscription.videoCall.isIncluded) {
                finalData.subscription.features.push({
                    label: subscriptionData.package.videoCall.label,
                    key: 'videoCall',
                    isUnlimited: subscriptionData.subscription.videoCall.isUnlimited,
                    isFree: subscriptionData.subscription.videoCall.isFree
                });
            }
            if (subscriptionData.subscription.audioCall.isIncluded) {
                finalData.subscription.features.push({
                    label: subscriptionData.package.audioCall.label,
                    key: 'audioCall',
                    isUnlimited: subscriptionData.subscription.audioCall.isUnlimited,
                    isFree: subscriptionData.subscription.audioCall.isFree
                });
            }
            if (subscriptionData.subscription.numberOfTextTranslations.isIncluded) {
                finalData.subscription.features.push({
                    label: subscriptionData.package.numberOfTextTranslations.label,
                    key: 'numberOfTextTranslations',
                    isFree: subscriptionData.subscription.numberOfTextTranslations.isFree,
                    isUnlimited: subscriptionData.subscription.numberOfTextTranslations.isUnlimited,
                    count: subscriptionData.subscription.numberOfTextTranslations.count
                });
            }
            if (subscriptionData.subscription.numberOfJobTranslations.isIncluded) {
                finalData.subscription.features.push({
                    label: subscriptionData.package.numberOfJobTranslations.label,
                    key: 'numberOfJobTranslations',
                    isFree: subscriptionData.subscription.numberOfJobTranslations.isFree,
                    isUnlimited: subscriptionData.subscription.numberOfJobTranslations.isUnlimited,
                    count: subscriptionData.subscription.numberOfJobTranslations.count
                });
            }
            if (subscriptionData.subscription.showOnline.isIncluded) {
                finalData.subscription.features.push({
                    label: subscriptionData.package.showOnline.label,
                    key: 'showOnline',
                    isUnlimited: subscriptionData.subscription.showOnline.isUnlimited,
                    isFree: subscriptionData.subscription.showOnline.isFree,
                });
            }
            if (subscriptionData.subscription.jobsInAllLocalities.isIncluded) {
                finalData.subscription.features.push({
                    label: subscriptionData.package.jobsInAllLocalities.label,
                    key: 'jobsInAllLocalities',
                    isFree: subscriptionData.subscription.jobsInAllLocalities.isFree,
                    isUnlimited: subscriptionData.subscription.jobsInAllLocalities.isUnlimited,
                    count: subscriptionData.subscription.jobsInAllLocalities.count
                });
            }
            if (subscriptionData.subscription.customerSupport && subscriptionData.subscription.customerSupport.isIncluded) {
                finalData.subscription.features.push({
                    label: subscriptionData.package.customerSupport.label,
                    key: 'customerSupport',
                    isFree: subscriptionData.subscription.customerSupport.isFree,
                    isUnlimited: true,
                    count: 0
                });
            }
            if (subscriptionData.subscription.dedicatedManager && subscriptionData.subscription.dedicatedManager.isIncluded) {
                finalData.subscription.features.push({
                    label: subscriptionData.package.dedicatedManager.label,
                    key: 'jobsInAllLocalities',
                    isUnlimited: true,
                    count: 0
                });
            }
        }
    }

    return h.response(responseFormatter.responseFormatter(finalData, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.getCities = async (request, h) => {
    let cities, searchCriteria, text;

    if (request.query.searchText) {
        text = decodeURIComponent(request.query.searchText);
        searchCriteria = {
            city: new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi'),
            country: request.query.country
        };
    } else {
        searchCriteria = {
            country: request.query.country
        }
    }

    try {
        cities = await citySchema.citySchema.aggregate([
            {
                $geoNear: {
                    near: {type: 'Point', coordinates: [Number(request.query.longitude), Number(request.query.latitude)]},
                    key: 'location',
                    distanceField: 'dist',
                    query: searchCriteria,
                    spherical: true
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
                    _id: 1,
                    city: 1,
                    country: 1,
                    latitude: {$arrayElemAt: ["$location.coordinates", 1]},
                    longitude: {$arrayElemAt: ["$location.coordinates", 0]}
                }
            }
        ])
    } catch (e) {
        logger.error('Error occurred while finding cities in get cities handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter(cities, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.listOfJobs = async (request, h) => {
    let checkEmployer, decoded, jobs, searchCriteria;

    /* Check if user exists in EZJobs database */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in list of jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in list of jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    if (request.query.searchText) {
        searchCriteria = {
            userId: mongoose.Types.ObjectId(request.query.employerId),
            isTranslated: false,
            isVisible: true,
            jobTitle: new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi'),
        }
    } else {
        searchCriteria = {
            userId: mongoose.Types.ObjectId(request.query.employerId),
            isTranslated: false,
            isVisible: true
        }
    }

    try {
        jobs = await jobSchema.jobSchema.aggregate([
            {
                $match: searchCriteria
            },
            {
                $sort: {
                    isArchived: 1
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
                    subJobTitle: 1,
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
                    categoryName: '$category.categoryName',
                    categoryId: '$category._id',
                    userId: 1,
                    totalViews: 1,
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
                    phone: 1,
                    countryCode: 1,
                    walkInInterviewAddress: 1,
                    walkInLatitude: 1,
                    walkInLongitude: 1,
                    isSame: 1,
                    receiveCalls: 1,
                    isPhoneSame: 1,
                    displayCities: 1,
                    isPremium: 1,
                    latitude: {$toString: {$arrayElemAt: ['$location.coordinates', 1]}},
                    longitude: {$toString: {$arrayElemAt: ['$location.coordinates', 0]}},
                    isATS: 1,
                    atsEmail: 1,
                    isCompanyWebsite: 1,
                    companyWebsite: 1,
                    inApp: 1
                }
            }
        ])
    } catch (e) {
        logger.error('Error occurred while aggregating jobs in list of jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter(jobs, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.getAllJobs = async (request, h) => {
    let checkEmployer, decoded, jobs, searchCriteria, sortCriteria;

    /* Check if user exists in EZJobs database */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get all jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get all jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check if account is master */
    let userIds = [];
    if (checkEmployer.isMaster) {
        userIds.push(checkEmployer._id);
        userIds = userIds.concat(checkEmployer.slaveUsers);
    } else {
        userIds.push(checkEmployer._id);
    }

    searchCriteria = {
        userId: {$in: userIds},
        isTranslated: false,
        isVisible: true
    };
    if (request.query.isArchived) {
        searchCriteria['isArchived'] = true;
    } else if (request.query.isUnderReview) {
        searchCriteria['isUnderReview'] = true;
    } else if (request.query.isPremium) {
        searchCriteria['isPremium'] = true;
    } else if (request.query.isActive) {
        searchCriteria['isArchived'] = false;
        searchCriteria['isUnderReview'] = false;
    }

    if (request.query.categoryId) {
        searchCriteria['categoryId'] = mongoose.Types.ObjectId(request.query.categoryId);
    }

    if (request.query.searchText) {
        const text = decodeURIComponent(request.query.searchText);
        searchCriteria.$or = [
            {
                'jobTitle': {$all: [new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
            },
            {
                'subJobTitle': {$all: [new RegExp(text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')]}
            }
        ];
    }

    if (request.query.sortCriteria) {
        if (request.query.sortCriteria === 'jobTitle') {
            sortCriteria = {
                $sort: {
                    jobTitle: request.query.sortType === 'asc' ? 1 : -1
                }
            }
        } else if (request.query.sortCriteria === 'numberOfPositions') {
            sortCriteria = {
                $sort: {
                    numberOfPositions: request.query.sortType === 'asc' ? 1 : -1
                }
            }
        } else if (request.query.sortCriteria === 'views') {
            sortCriteria = {
                $sort: {
                    totalViews: request.query.sortType === 'asc' ? 1 : -1
                }
            }
        }
    } else {
        sortCriteria = {
            $sort: {
                createdAt: -1
            }
        }
    }

    if (request.query.postedWithin) {
        if (request.query.postedWithin === '24hr') {
            searchCriteria['createdAt'] = {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(24, 'hours').toISOString())};
        } else if (request.query.postedWithin === '7d') {
            searchCriteria['createdAt'] = {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(7, 'days').toISOString())};
        } else if (request.query.postedWithin === '30d') {
            searchCriteria['createdAt'] = {$lt: new Date(new Date().toISOString()), $gt: new Date(moment().subtract(30, 'days').toISOString())};
        }
    }

    /* Aggregate job collection */
    try {
        jobs = await jobSchema.jobSchema.aggregate([
            {
                $match: searchCriteria
            },
            sortCriteria,
            {
                $skip: request.query.skip
            },
            {
                $limit: request.query.limit
            },
            {
                $lookup: {
                    localField: 'userId',
                    foreignField: '_id',
                    from: 'User',
                    as: 'user'
                }
            },
            {
                $unwind: '$user'
            },
            {
                $lookup: {
                    localField: '_id',
                    foreignField: 'jobId',
                    from: 'Conversation',
                    as: 'chat'
                }
            },
            {
                $project: {
                    _id: 1,
                    location: 1,
                    jobTitle: 1,
                    subJobTitle: 1,
                    totalViews: 1,
                    jobDescriptionVideo: 1,
                    numberOfPositions: 1,
                    address: 1,
                    payRate: 1,
                    isNegotiable: 1,
                    isArchived: 1,
                    isPremium: 1,
                    isUnderReview: 1,
                    userId: 1,
                    candidatesCount: {$size: '$chat'},
                    postedBy: {
                        $concat: ['$user.firstName', ' ', '$user.lastName']
                    },
                    profilePhoto: '$user.employerInformation.companyProfilePhoto',
                    currency: 1
                }
            }
        ])
    } catch (e) {
        logger.error('Error occurred while aggregating jobs in get all jobs handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    const len = jobs.length;

/*    for (let i = 0; i < len; i++) {
        let matchingProfiles = [];
        let aggregationCriteria = [
            {
                $geoNear: {
                    near: {type: 'Point', coordinates: [Number(jobs[i].location.coordinates[0]), Number(jobs[i].location.coordinates[1])]},
                    key: 'employeeInformation.location',
                    maxDistance: 50 * 1609.34,
                    distanceField: 'dist',
                    query: {
                        isActive: true,
                        'employeeInformation.isComplete': true,
                        _id: {$ne: mongoose.Types.ObjectId(request.query.employerId)}
                    },
                    spherical: true
                }
            },
            {
                $lookup: {
                    from: 'Job',
                    localField: 'employeeInformation.country',
                    foreignField: 'country',
                    as: 'job'
                }
            },
            {
                $unwind: '$job'
            },
            {
                $match: {
                    'job.userId': mongoose.Types.ObjectId(request.query.employerId),
                    'job.isClosed': false,
                    'job.isArchived': false,
                    'job._id': jobs[i]._id
                }
            },
            {
                $project: {
                    firstName: 1,
                    lastName: 1,
                    experienceInMonths: '$employeeInformation.experienceInMonths',
                    profilePhoto: '$employeeInformation.profilePhoto',
                    description: '$employeeInformation.description.text',
                    city: '$employeeInformation.address.city',
                    state: '$employeeInformation.address.state',
                    subLocality: '$employeeInformation.address.subLocality',
                    /!*recentJobTitle: '$employeeInformation.recentJobTitle',*!/
                    pastJobTitles: '$employeeInformation.pastJobTitles',
                    futureJobTitles: '$employeeInformation.futureJobTitles',
                    isStudent: '$employeeInformation.isStudent',
                    size: {$size: {$setIntersection: ['$job.skillsLower', '$employeeInformation.skillsLower']}},
                    totalSize: {$size: '$job.skills'},
                    jobId: '$job._id'
                }
            },
            {
                $match: {
                    size: {$gt: 0}
                }
            },
            {
                $project: {
                    firstName: 1,
                    lastName: 1,
                    experienceInMonths: 1,
                    profilePhoto: 1,
                    description: 1,
                    city: 1,
                    state: 1,
                    subLocality: 1,
                    /!*recentJobTitle: 1,*!/
                    pastJobTitles: 1,
                    futureJobTitles: 1,
                    isStudent: 1,
                    matchRate: {$floor: {$multiply: [{$divide: ['$size', '$totalSize']}, 100]}},
                    jobId: 1
                }
            },
            {
                $group: {
                    _id: '$jobId',
                    employeeInfo: {$push: {_id: '$_id', firstName: '$firstName', lastName: '$lastName', experienceInMonths: '$experienceInMonths',
                            profilePhoto: '$profilePhoto', description: '$description',
                            city: '$city', state: '$state', subLocality: '$subLocality', pastJobTitles: '$pastJobTitles', futureJobTitles: '$futureJobTitles',
                            isStudent: '$isStudent',  matchRate: "$matchRate"}}
                }
            }
        ];

        try {
            matchingProfiles = await userSchema.UserSchema.aggregate(aggregationCriteria);
        } catch (e) {
            logger.error('Error occurred while aggregating on user collection in get active jobs handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        jobs[i]['matchingProfiles'] = [];
    }*/

    return h.response(responseFormatter.responseFormatter(jobs, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.getRespectiveCandidates = async (request, h) => {
    let checkEmployer, decoded, candidates, searchCriteria, sortCriteria, aggregationCriteria, checkSubscription, flag = false;

    /* Check if user exists in EZJobs database */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get respective candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get respective candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    if (checkEmployer && checkEmployer.country !== 'US') {
        /* Check if the employer is free employer or paid */
        try {
            checkSubscription = await packageSchema.packageSchema.findById({_id: checkEmployer.subscriptionInfo.packageId}, {isFree: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred checking user package in get respective candidates handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (checkSubscription && checkSubscription.isFree) {
            flag = true;
        }
    }

    searchCriteria = {
        employerId: mongoose.Types.ObjectId(request.query.employerId),
        jobId: mongoose.Types.ObjectId(request.query.jobId)
    };
    if (request.query.isInvited) {
        searchCriteria['isInvited'] = true;
    } else if (request.query.isApplied) {
        searchCriteria['isApplied'] = true;
    } else if (request.query.isHired) {
        searchCriteria['isHired'] = true;
    }

    if (request.query.sortCriteria) {
        if (request.query.sortCriteria === 'candidateName') {
            sortCriteria = {
                $sort: {
                    candidateName: request.query.sortType === 'asc' ? 1 : -1
                }
            }
        } else if (request.query.sortCriteria === 'experience') {
            sortCriteria = {
                $sort: {
                    experienceInMonths: request.query.sortType === 'asc' ? 1 : -1
                }
            }
        }
    }

    if (!request.query.isShortListed) {
        aggregationCriteria = [
            {
                $match: searchCriteria
            },
            {
                $sort: {
                    createdAt: -1
                }
            }
        ];
        if (request.query.experienceMin || request.query.experienceMax || request.query.isStudent) {
            aggregationCriteria.push({
                $lookup: {
                    localField: 'candidateId',
                    foreignField: '_id',
                    from: 'User',
                    as: 'user'
                }
            });
            aggregationCriteria.push({
                $unwind: '$user'
            });
            if (request.query.experienceMin || request.query.experienceMax) {
                aggregationCriteria.push({
                    $match: {
                        $and: [{'user.employeeInformation.experienceInMonths': {$gt: request.query.experienceMin}}, { 'user.employeeInformation.experienceInMonths': {$lt: request.query.experienceMax}}]
                    }
                });
            }
            if (request.query.isStudent) {
                aggregationCriteria.push({
                    $match: {
                        'user.employeeInformation.isStudent': true
                    }
                });
            }
            aggregationCriteria.push({
                $skip: request.query.skip
            });
            aggregationCriteria.push({
                $limit: request.query.limit
            });
        } else {
            aggregationCriteria.push({
                $skip: request.query.skip
            });
            aggregationCriteria.push({
                $limit: request.query.limit
            });
            aggregationCriteria.push({
                $lookup: {
                    localField: 'candidateId',
                    foreignField: '_id',
                    from: 'User',
                    as: 'user'
                }
            });
            aggregationCriteria.push({
                $unwind: '$user'
            });
        }
        /*aggregationCriteria.push({
            $lookup: {
                localField: 'candidateId',
                foreignField: 'candidateId',
                from: 'FavouriteCandidate',
                as: 'favourite'
            }
        });*/
        /*
        * isFavourite: {
                    $in: [mongoose.Types.ObjectId(request.query.employerId), '$favourite.userId']
                },
        * */

        aggregationCriteria.push({
            $project: {
                _id: 1,
                candidateName: {
                    $concat: ['$user.firstName', ' ', '$user.lastName']
                },
                profilePhoto: '$user.employeeInformation.profilePhoto',
                isApplied: 1,
                candidateId: '$user._id',
                isInvited: 1,
                isHired: 1,
                isStudent: '$user.employeeInformation.isStudent',

                experienceInMonths: '$user.employeeInformation.experienceInMonths',
                selfIntroductionVideo: '$user.employeeInformation.description.video',
                address: '$user.employeeInformation.address',
                resume: '$user.employeeInformation.resume',
                isOnline: '$user.isOnline',
                pastJobTitles: '$user.employeeInformation.pastJobTitles',
                futureJobTitles: '$user.employeeInformation.futureJobTitles'
            }
        });

        if (sortCriteria) {
            aggregationCriteria.push(sortCriteria);
        }
        /* Aggregate conversation collection */
        try {
            candidates = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
        } catch (e) {
            console.log(e);
            logger.error('Error occurred while aggregating jobs in get respective candidates handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        aggregationCriteria = [
            {
                $match: {
                    userId: mongoose.Types.ObjectId(request.query.employerId)
                }
            },
            {
                $sort: {
                    createdAt: -1
                }
            }
        ];
        if (request.query.experienceMin || request.query.experienceMax || request.query.isStudent) {
            aggregationCriteria.push({
                $lookup: {
                    localField: 'candidateId',
                    foreignField: '_id',
                    from: 'User',
                    as: 'user'
                }
            });
            aggregationCriteria.push({
                $unwind: '$user'
            });
            if (request.query.experienceMin || request.query.experienceMax) {
                aggregationCriteria.push({
                    $match: {
                        $and: [{'user.employeeInformation.experienceInMonths': {$gt: request.query.experienceMin}}, {'user.employeeInformation.experienceInMonths': {$lt: request.query.experienceMax}}]
                    }
                });
            }
            if (request.query.isStudent) {
                aggregationCriteria.push({
                    $match: {
                        'user.employeeInformation.isStudent': true
                    }
                });
            }
            aggregationCriteria.push({
                $skip: request.query.skip
            });
            aggregationCriteria.push({
                $limit: request.query.limit
            });
        } else {
            aggregationCriteria.push({
                $skip: request.query.skip
            });
            aggregationCriteria.push({
                $limit: request.query.limit
            });
            aggregationCriteria.push({
                $lookup: {
                    localField: 'candidateId',
                    foreignField: '_id',
                    from: 'User',
                    as: 'user'
                }
            });
            aggregationCriteria.push({
                $unwind: '$user'
            });
        }
        aggregationCriteria.push({
            $project: {
                _id: 1,
                candidateName: {
                    $concat: ['$user.firstName', ' ', '$user.lastName']
                },
                profilePhoto: '$user.employeeInformation.profilePhoto',
                isApplied: {
                    $cond: [{$eq: [1, 0]}, true, false]
                },
                candidateId: 1,
                employerId: 1,
                jobId: 1,
                isStudent: '$user.employeeInformation.isStudent',
                isInvited: {
                    $cond: [{$eq: [1, 0]}, true, false]
                },
                isHired: {
                    $cond: [{$eq: [1, 0]}, true, false]
                },
                isFavourite: 1,
                experienceInMonths: '$user.employeeInformation.experienceInMonths',
                selfIntroductionVideo: '$user.employeeInformation.description.video',
                address: '$user.employeeInformation.address',
                resume: {
                    $cond: [{$eq: [flag, true]}, '', '$user.employeeInformation.resume']
                },
                isOnline: '$user.isOnline',
                pastJobTitles: '$user.employeeInformation.pastJobTitles',
                futureJobTitles: '$user.employeeInformation.futureJobTitles'
            }
        });

        if (sortCriteria) {
            aggregationCriteria.push(sortCriteria);
        }
        /* Aggregate conversation collection */
        try {
            candidates = await favouriteCandidateSchema.favouriteCandidateSchema.aggregate(aggregationCriteria);
        } catch (e) {
            console.log(e);
            logger.error('Error occurred while aggregating jobs in get respective candidates handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    return h.response(responseFormatter.responseFormatter(candidates, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.verifyPAN = async (request, h) => {
    let checkEmployer, decoded, token, panData, totalAttempts, currentAttempts, oldPan, categories, companyType;

    /* Check if user exists in EZJobs database */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in verify PAN handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in verify PAN handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get the categories from the constant */
    try {
        categories = await constantSchema.constantSchema.findOne({}, {businessTypes: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting constant information in verify PAN handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (categories) {
        categories = categories.businessTypes;
        const idx = categories.findIndex(k => k._id.toString() === request.payload.companyType);
        if (idx !== -1) {
            companyType = categories[idx].name;
        }
    }

    if (checkEmployer.employerInformation.pan) {
        oldPan = aes256.decrypt(key, checkEmployer.employerInformation.pan);
    }

    if (checkEmployer.employerInformation.panVerified) {
        return h.response(responseFormatter.responseFormatter({}, 'PAN already verified', 'error', 400)).code(400);
    }

    if (checkEmployer.employerInformation.lastTried) {
        let hours = Math.abs(new Date(checkEmployer.employerInformation.lastTried).getTime() - new Date().getTime()) / 36e5;
        if (hours < 24 && checkEmployer.employerInformation.currentAttempts && checkEmployer.employerInformation.currentAttempts > 2) {
            if (oldPan === request.payload.pan) {

            } else {
                return h.response(responseFormatter.responseFormatter({}, 'Daily verification quota limit has been reached.', 'error', 400)).code(400);
            }
        } else if (hours >= 24) {
            currentAttempts = 0;
        }
    } else {
        totalAttempts = 1;
        currentAttempts = 1;
    }

    /* Get token for quicko */
    if (checkEmployer.employerInformation.pan) {
        if (oldPan !== request.payload.pan) {
            token = await commonFunctions.Handlers.createQuickoToken();
            panData = await commonFunctions.Handlers.verifyPAN(request.payload.pan, token.token);
            totalAttempts = checkEmployer.employerInformation.hasOwnProperty('totalAttempts') ? (++checkEmployer.employerInformation.totalAttempts) : 0;
            currentAttempts = (checkEmployer.employerInformation.hasOwnProperty('currentAttempts'))
                ? (++checkEmployer.employerInformation.currentAttempts) : 0;
            if (checkEmployer.employerInformation.verification) {
                panData.pan = aes256.encrypt(key, panData.pan);
                checkEmployer.employerInformation.verification.push(panData);
            } else {
                checkEmployer.employerInformation.verification = [];
            }
        } else {
            panData = checkEmployer.employerInformation.verification[checkEmployer.employerInformation.verification.length - 1];
        }
    } else {
        token = await commonFunctions.Handlers.createQuickoToken();
        panData = await commonFunctions.Handlers.verifyPAN(request.payload.pan, token.token);
        if (panData) {
            panData.pan = aes256.encrypt(key, panData.pan);
        }
        checkEmployer.employerInformation.verification = [panData];
    }

    let dataToUpdate = {};

    if (panData) {
        if (panData.status && panData.status === 'VALID') {
            const fullName = panData.full_name.toLowerCase().replace(/\s/g,'');
            const companyName = request.payload.companyName.toLowerCase().replace(/\s/g,'');
            dataToUpdate = {
                'employerInformation.verification': checkEmployer.employerInformation.verification,
                'employerInformation.lastTried': (oldPan !== request.payload.pan) ? Date.now() : checkEmployer.employerInformation.lastTried,
                'employerInformation.panVerified': (panData.category.toLowerCase() === companyType.toLowerCase()) && (fullName === companyName),
                'employerInformation.pan': aes256.encrypt(key, request.payload.pan),
                'employerInformation.companyName': request.payload.companyName,
                'employerInformation.companyType': request.payload.companyType,
                'employerInformation.totalAttempts': totalAttempts ? totalAttempts : checkEmployer.employerInformation.totalAttempts,
                'employerInformation.currentAttempts': currentAttempts ? currentAttempts : checkEmployer.employerInformation.currentAttempts
            };
            /* Update user data */
            try {
                await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.employerId}, {$set: dataToUpdate}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while updating user data in verify PAN handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if (panData.category.toLowerCase() !== companyType.toLowerCase()) {
                return h.response(responseFormatter.responseFormatter({}, 'Business type does not match with the PAN data.', 'error', 400)).code(400);
            }
            if (fullName !== companyName) {
                return h.response(responseFormatter.responseFormatter({}, 'Company name / Individual name as mentioned in the PAN card does not name with the PAN data.', 'error', 400)).code(400);
            }
        } else {
            dataToUpdate = {
                'employerInformation.verification': checkEmployer.employerInformation.verification,
                'employerInformation.lastTried': (oldPan !== request.payload.pan) ? Date.now() : checkEmployer.employerInformation.lastTried,
                'employerInformation.panVerified': false,
                'employerInformation.pan': aes256.encrypt(key, request.payload.pan),
                'employerInformation.companyName': request.payload.companyName,
                'employerInformation.companyType': request.payload.companyType,
                'employerInformation.totalAttempts': totalAttempts ? totalAttempts : checkEmployer.employerInformation.totalAttempts,
                'employerInformation.currentAttempts': currentAttempts ? currentAttempts : checkEmployer.employerInformation.currentAttempts
            };
            /* Update user data */
            try {
                await userSchema.UserSchema.findByIdAndUpdate({_id: request.payload.employerId}, {$set: dataToUpdate}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while updating user data in verify PAN handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            return h.response(responseFormatter.responseFormatter({}, 'Invalid PAN status: ' + panData.status, 'error', 400)).code(400);
        }
    }

    /* Update hub spot contact */
    if (process.env.NODE_ENV === 'production') {
        let hubSpotProperties = [];

        if (request.payload.companyName) {
            hubSpotProperties.push({
                property: 'company',
                value: request.payload.companyName
            });
        }

        if (request.payload.companyType) {
            hubSpotProperties.push({
                property: 'company_type',
                value: companyType
            });
        }
        if (hubSpotProperties.length) {
            let status = await commonFunctions.Handlers.updateHubSpotContact(checkEmployer.email, hubSpotProperties);
            if (status === 404) {
                console.log('HubSpot contact not found');
            }
        }
    }

    return h.response(responseFormatter.responseFormatter({}, 'PAN verified', 'success', 200)).code(200);

};

employerHandler.sendCompanyEmailVerification = async (request, h) => {
    let checkEmployer, decoded;

    /* Check if user exists in EZJobs database */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in send company email verification handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in send company email verification handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Removed for now */
    /*const emailCheckRegex = new RegExp('^([\\w.-]+)@(\\[(\\d{1,3}\\.){3}|(?!hotmail|gmail|googlemail|yahoo|gmx|ymail|outlook|bluewin|protonmail|t\\-online|web\\.|online\\.|aol\\.|live\\.)(([a-zA-Z\\d-]+\\.)+))([a-zA-Z]{2,4}|\\d{1,3})(\\]?)$');
    const isValid = emailCheckRegex.test(request.payload.companyEmail);
    if (!isValid) {
        return h.response(responseFormatter.responseFormatter({}, 'Can not use public domain.', 'error', 400)).code(400);
    }*/

    const tokenWithExpiry = commonFunctions.Handlers.createAuthTokenWithExpiryForCompany(request.payload.employerId, 'Employer', request.payload.companyEmail);
    /* Send verification email to employer */
    const verificationUrl = emailVerificationUrl + '/user/verify?token=' + tokenWithExpiry;
    try {
        let email = {
            to: [{
                email: request.payload.companyEmail,
                name: (checkEmployer.firstName + ' ' + checkEmployer.lastName).trim(),
                type: 'to'
            }],
            important: false,
            merge: true,
            inline_css: false,
            merge_language: 'mailchimp',
            merge_vars: [{
                rcpt: request.payload.companyEmail,
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
        logger.error('Error in sending verification link to employer %s:', JSON.stringify(e));
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Email sent successfully', 'success', 200)).code(200);
};

employerHandler.getWalkIns = async (request, h) => {
    let checkEmployer, decoded, jobs, walkIns = [];

    /* Check if user exists in EZJobs database */
    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.employerId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get walk in handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get walk in handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Get interview start date/time and end date/time for walk-ins */
    try {
        jobs = await jobSchema.jobSchema.find({userId: mongoose.Types.ObjectId(request.query.employerId), interviewStartDate: {$gt: new Date()}}, {interviewStartDate: 1, interviewEndDate: 1, interviewStartTime: 1, interviewEndTime: 1, jobTitle: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding jobs in get walk in handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Extract interview timings from the array and assign it to the variable */
    for (let i = 0; i < jobs.length; i++) {
        walkIns.push({
            interviewStartTime: jobs[i].interviewStartTime,
            interviewEndTime: jobs[i].interviewEndTime,
            interviewStartDate: jobs[i].interviewStartDate,
            interviewEndDate: jobs[i].interviewEndDate,
            jobTitle: jobs[i].jobTitle
        });
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(walkIns, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.resumeServices = async (request, h) => {

    const mailOptions = {
        from: 'support@ezjobs.io',
        to: 'support@ezjobs.io',
        subject: 'Resume services form',
        text: 'First name: ' + request.payload.firstName + '. Email: ' + request.payload.email + '. Phone: ' + request.payload.phone + '. Service need: ' + request.payload.services + '. Message: ' + request.payload.message
    };
    try {
        await commonFunctions.Handlers.nodeMailerEZJobs(mailOptions.from, mailOptions.subject, mailOptions.text, mailOptions.to);
    } catch (e) {
        logger.error('Error in sending resume services email in add user handler %s:', JSON.stringify(e));
    }

    return h.response(responseFormatter.responseFormatter({}, 'Email sent successfully', 'success', 200)).code(200);
};

employerHandler.verificationFields = async (request, h) => {
    let fields;

    /* Get the company verification fields */
    try {
        fields = await verificationFields.verificationFields.find({country: request.query.country}, {country: 0}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding verification fields in get verification fields handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!fields.length) {
        try {
            fields = await verificationFields.verificationFields.find({nameRequired: true}, {country: 0}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding verification fields in get verification fields handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(fields, 'Fetched successfully.', 'success', 200)).code(200);
};

employerHandler.uploadDocuments = async (request, h) => {
    let checkUser, decoded, documents = [], checkVerificationData, masterUser, addedUsers = [];

    /* Check if user exists in EZJobs database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.payload.userId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in upload documents handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
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
            logger.error('Error occurred while getting master user in upload documents handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        masterUser.slaveUsers.push(masterUser._id);
        addedUsers = masterUser.slaveUsers;
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in upload documents handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    const len = request.payload.documents.length;
    for (let i = 0; i < len; i++) {
        let doc;
        /* Upload document to s3 bucket */
        try {
            doc = await commonFunctions.Handlers.uploadImage(request.payload.documents[i].path, request.payload.documents[i].filename);
        } catch (e) {
            logger.error('Error occurred while uploading document in upload documents handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (doc) {
            documents.push(doc);
        }
    }

    /* Check if verification data exists */
    try {
        checkVerificationData = await companyVerificationSchema.companyVerificationSchema.findOne({userId: checkUser._id}, {userId: 0, verifiedBy: 0, additionalNotes: 0}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding verification documents in upload documents handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    let update = {};
    if (!checkVerificationData) {
        const dataToSave = new companyVerificationSchema.companyVerificationSchema(request.payload);
        dataToSave.status = 1;
        dataToSave.documents = documents;
        update['employerInformation.verificationData'] = dataToSave._id;
        try {
           await dataToSave.save();
        } catch (e) {
            logger.error('Error occurred while saving verification documents in upload documents handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Get document type from verification collection */
        let document;
        try {
            document = await verificationFields.verificationFields.findById({_id: request.payload.documentType}, {type: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while getting verification in upload documents handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (document) {
            try {
                checkVerificationData = await companyVerificationSchema.companyVerificationSchema.findById({_id: dataToSave._id}, {
                    __v: 0,
                    additionalNotes: 0
                }, {lean: true}).populate('documentType', 'type');
            } catch (e) {
                logger.error('Error occurred while updating verification documents in upload documents handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        }

        /* Update user data */
        try {
            await userSchema.UserSchema.updateMany({_id: {$in: addedUsers}}, {$set: update}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating user data in upload documents handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    } else {
        const dataToUpdate = {
            status: 1,
            documents: documents,
            documentType: request.payload.documentType,
            documentNumber: request.payload.documentNumber,
            documentName: request.payload.documentName ? request.payload.documentName : '',
        };
        try {
            checkVerificationData = await companyVerificationSchema.companyVerificationSchema.findByIdAndUpdate({_id: checkVerificationData._id}, {$set: dataToUpdate}, {
                lean: true,
                new: true
            }).populate('documentType', 'type');
        } catch (e) {
            logger.error('Error occurred while updating verification documents in upload documents handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    delete checkVerificationData.userId;
    delete checkVerificationData.verifiedBy;
    delete checkVerificationData.additionalNotes;

    /* Success */
    return h.response(responseFormatter.responseFormatter(checkVerificationData, 'Information submitted. It may take upto 24 hours to verify the documents by EZJobs team.', 'success', 204)).code(200);
};

employerHandler.matchingProfiles = async (request, h) => {
    let checkUser, decoded, matchingProfiles = [], aggregationCriteria, checkJob;

    /* Check if user exists in EZJobs database */
    try {
        checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.userId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while getting user in get matching profiles handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get matching profiles handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check whether job exists */
    try {
        checkJob = await jobSchema.jobSchema.findById({_id: request.query.jobId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding job in get matching profiles handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkJob) {
        return h.response(responseFormatter.responseFormatter({}, 'No such job.', 'error', 404)).code(404);
    }

    aggregationCriteria = [
        {
            $match: {
                isActive: true,
                'employeeInformation.isComplete': true,
                _id: {$ne: mongoose.Types.ObjectId(request.query.userId)},
                'employeeInformation.country': checkJob.country
            }
        },
        {
            $lookup: {
                from: 'Job',
                let: {jobId: checkJob._id},
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $eq: ["$$jobId", "$_id"]
                            }
                        }
                    }
                ],
                as: 'job'
            }
        },
        {
            $unwind: '$job'
        },
        {
            $project: {
                firstName: 1,
                lastName: 1,
                experienceInMonths: '$employeeInformation.experienceInMonths',
                profilePhoto: '$employeeInformation.profilePhoto',
                description: '$employeeInformation.description.text',
                city: '$employeeInformation.address.city',
                state: '$employeeInformation.address.state',
                subLocality: '$employeeInformation.address.subLocality',
                pastJobTitles: '$employeeInformation.pastJobTitles',
                pastJobTitlesModified: '$employeeInformation.pastJobTitlesModified',
                futureJobTitles: '$employeeInformation.futureJobTitles',
                isStudent: '$employeeInformation.isStudent',
                size: {$size: {$setIntersection: ['$job.skillsLower', '$employeeInformation.skillsLower']}},
                totalSize: {$size: '$job.skills'},
                preferredLocationCities: '$employeeInformation.preferredLocationCities',
                preferredLocations: '$employeeInformation.preferredLocations'
            }
        },
        {
            $match: {
                size: {$gt: 0}
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
                experienceInMonths: 1,
                profilePhoto: 1,
                description: 1,
                city: 1,
                state: 1,
                subLocality: 1,
                pastJobTitles: 1,
                pastJobTitlesModified: 1,
                futureJobTitles: 1,
                isStudent: 1,
                matchRate: {$floor: {$multiply: [{$divide: ['$size', '$totalSize']}, 100]}},
                preferredLocationCities: 1,
                preferredLocations: 1
            }
        }
    ];

    try {
        matchingProfiles = await userSchema.UserSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred while aggregating user collection in get matching profiles handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter(matchingProfiles, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.generateKeysForATS = async (request, h) => {
    let checkEmployer, decoded, atsKeys;

    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: request.payload.userId}, {_id:  1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding employer in generate keys for ATS handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in generate keys for ATS handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found.', 'error', 404)).code(404);
    }

    /* Generate all three keys for the user */
    const keys = {
        platform: request.payload.platform,
        userId: mongoose.Types.ObjectId(request.payload.userId),
        name: request.payload.name || '',
        secretKey: commonFunctions.Handlers.resetToken(),
        apiKey: commonFunctions.Handlers.resetToken(),
        accountKey: commonFunctions.Handlers.resetToken(),
        isActive: true
    };

    try {
        atsKeys = await new atsSchema.atsSchema(keys).save();
    } catch (e) {
        logger.error('Error occurred while saving ats keys in get matching profiles handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    atsKeys = atsKeys.toObject();

    delete atsKeys.userId;
    delete atsKeys.platform;

    /* Return all generated keys */
    return h.response(responseFormatter.responseFormatter(atsKeys, 'Keys generated successfully.', 'success', 201)).code(200);
};

employerHandler.updateKeysForATS = async (request, h) => {
    let checkEmployer, decoded, checkKey, message = 'Success.', updatedKeys, userIdsToCheck;

    try {
        checkEmployer = await userSchema.UserSchema.findById({_id: request.payload.userId}, {_id:  1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding employer in update keys for ATS handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in update keys for ATS handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found.', 'error', 404)).code(404);
    } else if (checkEmployer.isMaster) {
        checkEmployer.slaveUsers.push(checkEmployer._id);
        userIdsToCheck = checkEmployer.slaveUsers;
    } else {
        userIdsToCheck = [mongoose.Types.ObjectId(checkEmployer._id)];
    }

    /* Check if key exists */
    try {
        checkKey = await atsSchema.atsSchema.findOne({_id: mongoose.Types.ObjectId(request.payload.keyId), userId: {$in: userIdsToCheck}}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding ats key in update keys for ATS handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkKey) {
        return h.response(responseFormatter.responseFormatter({}, 'No such key.', 'error', 404)).code(404);
    }

    /* Check if deactivate tag is there */
    if (typeof request.payload.isActive === 'boolean') {
        try {
            await atsSchema.atsSchema.findByIdAndUpdate({_id: request.payload.keyId}, {$set: {isActive: request.payload.isActive}}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while updating ats key in update keys for ATS handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        message = request.payload.isActive ? 'Key activated successfully.' : 'Key deactivated successfully.';
    } else if (request.payload.isDelete) {
        try {
            await atsSchema.atsSchema.findByIdAndDelete({_id: request.payload.keyId});
        } catch (e) {
            logger.error('Error occurred while removing in update keys for ATS handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        message = 'Key removed successfully.';
    } else if (request.payload.isRegenerate) {
        /* Regenerate all three keys */
        const keys = {
            apiKey: commonFunctions.Handlers.resetToken(),
            secretKey: commonFunctions.Handlers.resetToken(),
            accountKey: commonFunctions.Handlers.resetToken()
        };
        try {
            updatedKeys = await atsSchema.atsSchema.findByIdAndUpdate({_id: request.payload.keyId}, {$set: keys}, {lean: true, new: true});
        } catch (e) {
            logger.error('Error occurred while regenerating keys in update keys for ATS handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        delete updatedKeys.userId;
        delete updatedKeys.platform;
        message = 'Key regenerated successfully.';
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(updatedKeys ? updatedKeys : {}, message, 'success', 200)).code(200)
};

employerHandler.getAPIKeys = async (request, h) => {
    let checkUser, decoded, userIdsToCheck, keys, platforms;

    try {
        checkUser = await userSchema.UserSchema.findById({_id: request.query.userId}, {_id:  1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding employer in get keys for ATS handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Check whether user is the one who is trying to update one */
    try {
        decoded = await commonFunctions.Handlers.decodeToken(request.auth.credentials.token);
    } catch (e) {
        logger.error('Error occurred while decoding token in get keys for ATS handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'No such user.', 'error', 404)).code(404);
    }

    /* Get all the keys of the user and it's child users */
    if (checkUser.isMaster) {
        checkUser.slaveUsers.push(checkUser._id);
        userIdsToCheck = checkUser.slaveUsers;
    } else {
        userIdsToCheck = [checkUser._id];
    }

    try {
        keys = await atsSchema.atsSchema.find({userId: {$in: userIdsToCheck}}, {}, {lean: true}).populate('userId', 'firstName lastName');
    } catch (e) {
        logger.error('Error occurred while finding keys in get keys for ATS handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Get list of platforms */
    try {
        platforms = await internalParameterSchema.internalParameterSchema.findOne({}, {atsPlatforms: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding platforms in get keys for ATS handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    for (let i = 0; i < keys.length; i++) {
        const idx = platforms.atsPlatforms.findIndex(k => k.key === keys[i].platform);
        if (idx !== -1) {
            keys[i].platform = platforms.atsPlatforms[idx];
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(keys, 'Fetched successfully.', 'success', 200)).code(200);
}

employerHandler.getPlatforms = async (request, h) => {
    let internalParameters;

    try {
        internalParameters = await internalParameterSchema.internalParameterSchema.find({}, {atsPlatforms: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding internal parameters in get platforms for ATS handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(internalParameters[0].atsPlatforms, 'Fetched successfully.', 'success', 200)).code(200);
};

employerHandler.getSubscriptionInfoNew = async (request, h) => {
    let checkEmployer, decoded, subscriptionData, packages, finalPackageData = [], currency, pricing;

    /* Check if user exists in EZJobs database */
    try {
        [checkEmployer, decoded] = await Promise.all([
            userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(request.query.employerId)}, {}, {lean: true}),
            commonFunctions.Handlers.decodeToken(request.auth.credentials.token)
        ]);
    } catch (e) {
        logger.error('Error occurred while getting user in get subscription info new handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkEmployer) {
        return h.response(responseFormatter.responseFormatter({}, 'User doesn\'t exists', 'error', 404)).code(404);
    }
    if (decoded.userId !== checkEmployer._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    try {
        [packages, subscriptionData] = await Promise.all([
            packageSchema.packageSchema.findById({_id: checkEmployer.subscriptionInfo.packageId}, {}, {lean: true}),
            subscriptionSchema.subscriptionSchema.findById({_id: checkEmployer.subscriptionInfo.subscriptionId}, {}, {lean: true})
        ]);
    } catch (e) {
        logger.error('Error occurred while fetching packages information in get subscription info new handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!packages) {
        return h.response(responseFormatter.responseFormatter({}, 'Package not found', 'error', 404)).code(404);
    }
    if (!subscriptionData) {
        return h.response(responseFormatter.responseFormatter({}, 'Subscription data not found', 'error', 404)).code(404);
    }

    /* Get base prices and currency */
    try {
        [pricing, currency] = await Promise.all([
            pricingSchema.pricingSchema.findOne({country: packages.country}, {}, {lean: true}),
            codeSchema.CodeSchema.findOne({countryISOName: packages.country}, {currency: 1}, {lean: true})
        ]);
    } catch (e) {
        logger.error('Error occurred while fetching pricing information in get subscription info new handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!pricing) {
        return h.response(responseFormatter.responseFormatter({}, 'Pricing information not found', 'error', 404)).code(404);
    }
    if (!currency) {
        return h.response(responseFormatter.responseFormatter({}, 'Sorry this information is not available in your region.', 'error', 400)).code(400);
    }

    if (packages) {
        const features = Object.keys(subscriptionData);
        const objectsToInclude = ['numberOfJobs', 'numberOfViews', 'numberOfUsers', 'numberOfTextTranslations', 'numberOfJobTranslations', 'jobsInAllLocalities', 'audioCall', 'videoCall', 'showOnline', 'customerSupport', 'dedicatedManager'];
        let dataToPush = {};
        let feature = [];
        for (let j = 0; j < features.length; j++) {
            if (typeof subscriptionData[features[j]] === 'object' && objectsToInclude.includes(features[j])) {
                feature.push({
                    name: packages[features[j]].label,
                    heading: packages[features[j]].heading,
                    isFree: subscriptionData[features[j]].isFree,
                    isUnlimited: subscriptionData[features[j]].isUnlimited,
                    isIncluded: subscriptionData[features[j]].isIncluded,
                    totalCount: packages[features[j]].count,
                    count: subscriptionData[features[j]].count,
                    multiple: pricing[features[j]].multiple,
                    key: features[j],
                    basePrice: pricing[features[j]].basePrice || 0,
                    baseCount: pricing[features[j]].count || 0,
                    minCount: packages[features[j]].minCount || 0,
                    featureInfo: packages[features[j]].featureInfo,
                    unit: pricing[features[j]].unit || '',
                    expiryAfterPackageExpiry: subscriptionData[features[j]].expiryAfterPackageExpiry || 0
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

        dataToPush['features'] = subFeatures;
        finalPackageData = dataToPush;
        finalPackageData.packageName = packages.packageName;
        finalPackageData.total = packages.total || 0;
        finalPackageData.currency = currency.currency;
        finalPackageData.applicationValidity = subscriptionData.applicationValidity;
        finalPackageData.expiresAt = subscriptionData.expiresAt;
        finalPackageData.purchasedDate = subscriptionData.purchasedDate;
        finalPackageData.isWallet = !!subscriptionData.isWallet;
        finalPackageData.walletAmount = subscriptionData.walletAmount ? +subscriptionData.walletAmount.toFixed(2) : 0;
        finalPackageData.customText = packages.customText;
        finalPackageData.colorCode = packages.colorCode;
        finalPackageData.validity = packages.validity;
        finalPackageData.quantity = subscriptionData.quantity;
        finalPackageData.packageId = packages._id;
        finalPackageData.country = packages.country;
        finalPackageData.taxType = packages.taxType;
        finalPackageData.taxAmount = packages.taxAmount;
        finalPackageData.subscriptionId = subscriptionData._id;
        finalPackageData.isFree = packages.isFree;
    }

    return h.response(responseFormatter.responseFormatter(finalPackageData, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.getViewedCandidates = async (request, h) => {
    let checkUser, decoded, userIds, aggregationCriteria = [], views;

    try {
        [checkUser, decoded] = await Promise.all([
            await userSchema.UserSchema.findById({_id: request.query.userId}, {
                _id: 1,
                slaveUsers: 1,
                isSlave: 1
            }, {lean: true}),
            await commonFunctions.Handlers.decodeToken(request.auth.credentials.token)
        ]);
    } catch (e) {
        logger.error('Error occurred while finding user and verifying token in get viewed candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check if user is master user or slave user */
    if (checkUser.isSlave) {
        let masterUser;
        try {
            masterUser = await userSchema.UserSchema.findOne({slaveUsers: mongoose.Types.ObjectId(checkUser._id)}, {
                _id: 1,
                slaveUsers: 1
            }, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding master user in get viewed candidates handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        masterUser.slaveUsers.push(masterUser._id);
        userIds = masterUser.slaveUsers;
    } else {
        checkUser.slaveUsers.push(checkUser._id);
        userIds = checkUser.slaveUsers;
    }

    /* Get views data along with the employer data */
    aggregationCriteria = [
        {
            $match: {
                employerId: {$in: userIds}
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
        }
    ];

    /* If experience min/max value is given */
    if (Object.prototype.hasOwnProperty.call(request.query, 'experienceMax')) {
        aggregationCriteria.push({
            $match: {
                'user.employeeInformation.experienceInMonths': {
                    $gte: request.query.experienceMin,
                    $lte: request.query.experienceMax
                }
            }
        });
    }

    /* If student parameter is given */
    if (request.query.isStudent) {
        aggregationCriteria.push({$match: {'user.employeeInformation.isStudent': request.query.isStudent}});
    }

    if (request.query.searchText) {
        aggregationCriteria.push(
            {
                $match: {
                    $or: [{'user.firstName': new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')},
                        {'user.lastName': new RegExp(request.query.searchText.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi')}]
                }
            });
    }

    aggregationCriteria.push(
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
            $lookup: {
                from: 'FavouriteCandidate',
                let: {userIds: userIds, candidateId: '$candidateId'},
                pipeline: [{
                    $match: {
                        $expr: {
                            $and: [
                                {$eq: ['$candidateId', '$$candidateId']},
                                {$eq: ['$userId', checkUser._id]}
                            ]
                        }
                    }
                }],
                as: 'favourite'
            }
        },
        {
            $project: {
                _id: 1,
                candidateId: 1,
                firstName: '$user.firstName',
                lastName: '$user.lastName',
                experienceInMonths: '$user.employeeInformation.experienceInMonths',
                profilePhoto: '$user.employeeInformation.profilePhoto',
                description: '$user.employeeInformation.description.text',
                city: '$user.employeeInformation.address.city',
                state: '$user.employeeInformation.address.state',
                subLocality: '$user.employeeInformation.address.subLocality',
                pastJobTitles: '$user.employeeInformation.pastJobTitles',
                pastJobTitlesModified: '$user.employeeInformation.pastJobTitlesModified',
                futureJobTitles: '$user.employeeInformation.futureJobTitles',
                isStudent: '$user.employeeInformation.isStudent',
                isFavourite: {
                    $cond: [
                        {
                            $gt: [
                                {
                                    $size: '$favourite'
                                },
                                0
                            ]
                        },
                        true,
                        false
                    ]
                },
                preferredLocationCities: '$user.employeeInformation.preferredLocationCities',
                preferredLocations: '$user.employeeInformation.preferredLocations',
                skills: '$user.employeeInformation.skills',
                expectedSalary: '$user.employeeInformation.expectedSalary',
                expectedSalaryType: '$user.employeeInformation.expectedSalaryType',
                resume: '$user.employeeInformation.resume',
                videoDescription: '$user.employeeInformation.description.video',
                expiration: 1,
                employerId: 1,
                employerFirstName: '$employer.firstName',
                employerLastName: '$employer.lastName'
            }
        }
    );

    try {
        views = await viewsSchema.viewsSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred while finding views of user in get viewed candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(views, 'Fetched successfully', 'success', 200)).code(200);
};

employerHandler.downloadViewedCandidates = async (request, h) => {
    let checkUser, decoded, userIds, aggregationCriteria = [], views, url;

    try {
        [checkUser, decoded] = await Promise.all([
            await userSchema.UserSchema.findById({_id: request.query.userId}, {
                _id: 1,
                slaveUsers: 1,
                isSlave: 1
            }, {lean: true}),
            await commonFunctions.Handlers.decodeToken(request.auth.credentials.token)
        ]);
    } catch (e) {
        logger.error('Error occurred while finding user and verifying token in get viewed candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        return h.response(responseFormatter.responseFormatter({}, 'User not found', 'error', 404)).code(404);
    }
    if (decoded.userId !== checkUser._id.toString()) {
        return h.response(responseFormatter.responseFormatter({}, 'You are not authorized to perform this action', 'error', 401)).code(401);
    }

    /* Check if user is master user or slave user */
    if (checkUser.isSlave) {
        let masterUser;
        try {
            masterUser = await userSchema.UserSchema.findOne({slaveUsers: mongoose.Types.ObjectId(checkUser._id)}, {
                _id: 1,
                slaveUsers: 1
            }, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding master user in get viewed candidates handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        masterUser.slaveUsers.push(masterUser._id);
        userIds = masterUser.slaveUsers;
    } else {
        checkUser.slaveUsers.push(checkUser._id);
        userIds = checkUser.slaveUsers;
    }

    /* Get views data along with the employer data */
    aggregationCriteria = [
        {
            $match: {
                employerId: {$in: userIds}
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
        }
    ];

    aggregationCriteria.push(
        {
            $sort: {
                _id: -1
            }
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
                firstName: '$user.firstName',
                lastName: '$user.lastName',
                email: '$user.email',
                phone: '$user.employeeInformation.phone',
                resume: '$user.employeeInformation.resume',
                lastOnline: '$user.lastOnline'
            }
        }
    );

    try {
        views = await viewsSchema.viewsSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred while finding views of user in get viewed candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!views.length) {
        return h.response(responseFormatter.responseFormatter(views, 'No data Found', 'error', 404)).code(404);
    }

    if (views && views.length) {
        let result, dataToWrite = [];
        const len = views.length;
        for (let i = 0; i < len; i++) {
            dataToWrite.push({
                email: views[i].email,
                firstName: views[i].firstName,
                lastName: views[i].lastName,
                phone: views[i].phone,
                resume: views[i].resume.length ? await commonFunctions.Handlers.createFirebaseShortLinkForExcel(views[i].resume): '',
                lastOnline: views[i].lastOnline ? views[i].lastOnline.toString(): ''
            });
        }
        try {
            result = await commonFunctions.Handlers.createViewsExcelFile('views.xlsx', dataToWrite);
        } catch (e) {
            console.log(e);
        }

        if (result) {
            const file = {
                fileName: 'views.xlsx',
                path: path.resolve(__dirname, '../views.xlsx')
            }
            try {
                url = await commonFunctions.Handlers.uploadExcel(file.path, file.fileName);
            } catch (e) {
                console.log(e);
            }

            if (url) {
                try {
                    fs.unlinkSync(file.path);
                    console.log("Successfully deleted the file.")
                } catch(e) {
                    console.log(e);
                }
            }
            /* Success */
            return h.response(responseFormatter.responseFormatter(url, 'Fetched successfully', 'success', 200)).code(200);
        }
    }
};

module.exports = {
    Handler: employerHandler
};
