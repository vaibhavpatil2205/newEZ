'use strict';

const mongoose = require('mongoose');
const responseFormatter = require('../utils/responseFormatter');
const commonFunctions = require('../utils/commonFunctions');
const userSchema = require('../schema/userSchema');
const jobSchema = require('../schema/jobSchema');
const moment = require('moment');
const conversationSchema = require('../schema/conversationSchema');
const constantSchema = require('../schema/constantSchema');
const mandrill = require('../utils/mandrill');
const subscriptionSchema = require('../schema/subscriptionSchema');
const packageSchema = require('../schema/packageSchema');
const languageSchema = require('../schema/languageSchema');
const countryList = require('country-list');
const atsSchema = require('../schema/atsSchema');
const logger = require('../utils/logger');
const favouriteSchema = require('../schema/favouriteSchema');
const viewSchema = require('../schema/viewsSchema');
const pluralize = require('pluralize');

let handlers = {};

handlers.createJob = async (request, h) => {
    let checkUser, checkUserKey, dataToSave, dataToUpdate, constantData, jobData, englishLanguage, jobIds = [];

    /* Check whether user exists in database */
    try {
        checkUserKey = await atsSchema.atsSchema.findOne({
            secretKey: request.payload.secretKey,
            apiKey: request.payload.apiKey,
            accountKey: request.payload.accountKey
        }, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user data in create job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkUserKey && checkUserKey.isActive) {
        try {
            checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(checkUserKey.userId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching user data in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!checkUser) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not authorized', 'error', 401)).code(401);
        }
    } else {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action', 'error', 401)).code(401);
    }

    /* Check for the subscription package */
    for (let i = 0; i < request.payload.jobData.length; i++) {
        let subscriptionData, packageInfo;
        if (checkUser.subscriptionInfo && checkUser.subscriptionInfo.subscriptionId) {
            try {
                subscriptionData = await subscriptionSchema.subscriptionSchema.findById({_id: checkUser.subscriptionInfo.subscriptionId}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding subscription data in create job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
    
            try {
                packageInfo = await packageSchema.packageSchema.findById({_id: checkUser.subscriptionInfo.packageId}, {country: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding package data in create job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
    
            /*if (packageInfo.country.toLowerCase() !== request.payload.jobData[i].country.toLowerCase()) {
                return h.response(responseFormatter.responseFormatter({}, 'Your subscription is not valid.', 'error', 400)).code(400);
            }*/
    
            if (!subscriptionData) {
                return h.response(responseFormatter.responseFormatter({}, 'Something went wrong. Please contact support.', 'error', 400)).code(400);
            } else if (!subscriptionData.isPaid) {
                return h.response(responseFormatter.responseFormatter({}, 'Please purchase any subscription.', 'error', 400)).code(400);
            } else if (!subscriptionData.numberOfJobs.count && !subscriptionData.numberOfJobs.isUnlimited) {
                return h.response(responseFormatter.responseFormatter({}, 'You do not have sufficient job posting left in your current package.', 'error', 400)).code(400);
            } else if (subscriptionData)
    
            try {
                await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkUser.subscriptionInfo.subscriptionId}, {$inc: {'numberOfJobs.count': -1}}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while updating subscription data in create job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
        } else {
            /* Free package. Check the date of the last posted job */
            let lastJob;
            try {
                lastJob = await jobSchema.jobSchema.findOne({userId: checkUserKey.userId, createdAt: {$gt:  new Date(moment().subtract(1, 'month').toISOString())}}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding last posted job data in create job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (lastJob) {
                return h.response(responseFormatter.responseFormatter({}, 'You do not have sufficient job posting left in your current package.', 'error', 400)).code(400);
            }
        }

        
        /* Fetch constant information */
        try {
            constantData = await constantSchema.constantSchema.findOne({}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching constant data in create job handler %s:', JSON.stringify(e));
        }

        /* Get english language */
        try {
            englishLanguage = await languageSchema.languageSchema.findOne({language: 'en', country: request.payload.jobData[i].country}, {_id: 1}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding english language in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

         /* Create job payload and save it into database */
        dataToSave = new jobSchema.jobSchema(request.payload.jobData[i]);
        dataToSave.totalViews = 0;
        dataToSave.userId = checkUserKey.userId;
        dataToSave.platform = request.payload.platform;
        dataToSave.isATS = true;
        dataToSave.atsEmail = checkUser.email;
        dataToSave.isTranslated = false;
        dataToSave.translatedJobs = [];
        dataToSave.uniqueViews = [];
        dataToSave.translatedLanguage = englishLanguage._id;
        for (let j = 0; j < request.payload.jobData[i].skills.length; j++) {
            dataToSave.skillsLower.push(request.payload.jobData[i].skills[j].toLowerCase());
        }
        dataToSave.location.coordinates = [Number(request.payload.jobData[i].longitude), Number(request.payload.jobData[i].latitude)];
        dataToSave.displayLocation.coordinates = [[Number(request.payload.jobData[i].longitude), Number(request.payload.jobData[i].latitude)]];

        dataToSave.isPremium = false;
        dataToSave.ageRequired = request.payload.jobData[i].ageRequired ? request.payload.jobData[i].ageRequired : 18;
        dataToSave.numberOfPositions = request.payload.jobData[i].numberOfPositions ? request.payload.jobData[i].numberOfPositions : 1;

         /* Before saving check of this job includes bad words or not */
        let skill = request.payload.jobData[i].skills.join(' ');

        /*if (global.filter.isProfane(request.payload.jobData[i].jobTitle) || global.filter.isProfane(request.payload.jobData[i].jobDescriptionText) || global.filter.isProfane(skill)) {
            dataToSave.isUnderReview = true;
            dataToSave.reviewReason = 'Includes bad word(s)';
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
                            content: request.payload.jobData[i].jobTitle
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

        /* Translate all the job data in the given languages */

        try {
            jobData = await dataToSave.save();
        } catch (e) {
            logger.error('Error occurred while saving job data in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (jobData) {
            jobIds.push({jobId: jobData._id});
        }

         /* Increase posting count by one for the user */
        dataToUpdate = {
            $inc: {'employerInformation.numberOfJobsPosted': 1}
        };

        /*let source, contactSource, companyType = '', checkContact;
        if (checkUser.roles.indexOf('Employer') === -1) {
            dataToUpdate.$set = {roles: ['Employer']};
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
                } else {
                    contactSource = 'Web';
                }

                /!* Get company type *!/
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
            /!* Engage Bay *!/
            try {
                checkContact = await commonFunctions.Handlers.checkEngageBayContact(checkUser.email);
            } catch (e) {
                logger.error('Error occurred while checking contact existence %s:', e);
            }
    
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
    
                const engageSource = new commonFunctions.engageBay('Source', 'TEXT', 'CUSTOM', true, source);
                contactProperties.push(engageSource.getProperties());
    
                const engageContactSource = new commonFunctions.engageBay('Contact source', 'TEXT', 'CUSTOM', true, contactSource);
                contactProperties.push(engageContactSource.getProperties());
    
                contactData.properties = contactProperties;
    
                try {
                    checkCompany = await commonFunctions.Handlers.checkEngageBayCompany(checkUser.employerInformation.companyName);
                } catch (e) {
                    logger.error('Error occurred while checking company existence %s:', e);
                }
    
                if (checkCompany === 'NOTFOUND') {
                    /!* Create company in Engage Bay *!/
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

        /!* Update package info on hubspot *!/
        if (process.env.NODE_ENV === 'production') {
            let hubSpotProperties = [], packageData, activeJobs, engageBayProperties = [];

            /!* Get package data *!/
            try {
                packageData = await packageSchema.packageSchema.findById({_id: checkUser.subscriptionInfo.packageId}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while getting package information');
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



            /!* Get the job listings of the employer *!/
            try {
                activeJobs = await jobSchema.jobSchema.find({userId: checkUser._id, isVisible: true, isTranslated: false}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding job postings in create job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
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
                let status = await commonFunctions.Handlers.updateHubSpotContact(checkUser.email, hubSpotProperties);
                if (status === 404) {
                    console.log('HubSpot contact not found');
                }

                let statusEmployer = await commonFunctions.Handlers.updateHubSpotContactEmployer(checkUser.email, hubSpotProperties);
                if (statusEmployer === 404) {
                    console.log('HubSpot contact not found');
                }
            }

            if (engageBayProperties.length) {
                try {
                    await commonFunctions.Handlers.updateEngageBayContact({id: checkContact.data.id, properties: engageBayProperties});
                } catch (e) {
                    logger.error('Error occurred while updating user in engage bay %s:', JSON.stringify(e));
                }
            }
        }*/

        try {
            await userSchema.UserSchema.findByIdAndUpdate({_id: checkUserKey.userId}, dataToUpdate, {lean: true});
        } catch (e) {
            logger.error('Error occurred while incrementing job posting count in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(jobIds, 'Job posted successfully', 'success', 201)).code(201);
};

handlers.getCandidates = async (request, h) => {
    let checkUserKey, checkUser, candidates, searchCriteria, aggregationCriteria;
    try {
        checkUserKey = await atsSchema.atsSchema.findOne({secretKey: request.query.secretKey, apiKey: request.query.apiKey, accountKey: request.query.accountKey}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user data in create job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkUserKey && checkUserKey.isActive) {
        try {
            checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(checkUserKey.userId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching user data in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!checkUser) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not authorized', 'error', 401)).code(401);
        }
    } else {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action', 'error', 401)).code(401);
    }

    searchCriteria = {
        employerId: mongoose.Types.ObjectId(checkUserKey.userId),
        jobId: mongoose.Types.ObjectId(request.query.jobId)
    };

    aggregationCriteria = [
        {
            $match: searchCriteria
        },
        {
            $sort: {
                createdAt: -1
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
                localField: 'candidateId',
                foreignField: '_id',
                from: 'User',
                as: 'user'
            }
        },
        {
            $unwind: '$user'
        },
        {
            $project: {
                firstName: '$user.firstName',
                lastName: '$user.lastName',
                email: '$user.email',
                gender: '$user.gender',
                dob: '$user.employeeInformation.dob',
                profilePhoto: '$user.employeeInformation.profilePhoto',
                education: '$user.employeeInformation.education',
                address: '$user.employeeInformation.address',
                country: '$user.employeeInformation.country',
                languages: '$user.employeeInformation.languages',
                isStudent: '$user.employeeInformation.isStudent',
                skills: '$user.employeeInformation.skills',
                resume: '$user.employeeInformation.resume',
                expectedSalary: '$user.employeeInformation.expectedSalary',
                expectedSalaryType: '$user.employeeInformation.expectedSalaryType',
                isNegotiable: '$user.employeeInformation.isNegotiable',
                isInternship: '$user.employeeInformation.isInternship',
                homeTown: '$user.employeeInformation.homeTown',
                isRelocatable: '$user.employeeInformation.isRelocatable',
                isOnline: '$user.isOnline',
                jobType: '$user.employeeInformation.jobType'
            }
        }
    ];

    try {
        candidates = await conversationSchema.conversationSchema.aggregate(aggregationCriteria);
    } catch (e) {
        logger.error('Error occurred while aggregating jobs in get respective candidates handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    return h.response(responseFormatter.responseFormatter(candidates, 'Fetched successfully', 'success', 200)).code(200);
}

handlers.updateJob = async (request, h) => {
    let checkUser, checkJob, dataToUpdate, checkUserKey;

    /* Check whether user exists in database */
    try {
        checkUserKey = await atsSchema.atsSchema.findOne({secretKey: request.payload.secretKey, apiKey: request.payload.apiKey, accountKey: request.payload.accountKey}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user data in update job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkUserKey) {
        try {
            checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(checkUserKey.userId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching user data in update job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!checkUser) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not authorized', 'error', 401)).code(401);
        }
    } else {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action', 'error', 401)).code(401);
    }

    /* Check if job exists in database for the same user */
    try {
        checkJob = await jobSchema.jobSchema.findOne({_id: mongoose.Types.ObjectId(request.payload.jobId), userId: mongoose.Types.ObjectId(checkUserKey.userId)}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching job data in update job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!checkJob) {
        return h.response(responseFormatter.responseFormatter({}, 'Job not found', 'error', 404)).code(404);
    } else if (checkJob.isArchived) {
        return h.response(responseFormatter.responseFormatter({}, 'This job is already closed.', 'error', 400)).code(400);
    }

    /* Check for the subscription package */
    let subscriptionData;
    if (checkUser.subscriptionInfo && checkUser.subscriptionInfo.subscriptionId) {
        try {
            subscriptionData = await subscriptionSchema.subscriptionSchema.findById({_id: checkUser.subscriptionInfo.subscriptionId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while finding subscription data in update job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!subscriptionData) {
            return h.response(responseFormatter.responseFormatter({}, 'Something went wrong. Please contact support.', 'error', 400)).code(400);
        }
    }

    if (!request.payload.isUnderReview) {
        request.payload.isUnderReview = false;
    }

    /* Update job data */
    dataToUpdate = request.payload;

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

    dataToUpdate.ageRequired = request.payload.ageRequired ? request.payload.ageRequired : 18;
    dataToUpdate.numberOfPositions = request.payload.numberOfPositions ? request.payload.numberOfPositions : 1;

    /* Before saving check of this job includes bad words or not */
    /*if (global.filter.isProfane(request.payload.jobTitle) || global.filter.isProfane(request.payload.jobDescriptionText) || global.filter.isProfane(request.payload.skills.join(" "))) {
        dataToUpdate.isUnderReview = true;
        dataToUpdate.reviewReason = 'Includes bad word(s)';
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

    /* Update the already translated jobs */

    try {
        await jobSchema.jobSchema.findByIdAndUpdate({_id: request.payload.jobId}, {$set: dataToUpdate}, {lean: true, new: true}).populate('categoryId', 'categoryName');
    } catch (e) {
        logger.error('Error occurred while updating job data in update job handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (request.payload.isArchived) {
        /* Update chats to mark job as archived */
        let bulk = conversationSchema.conversationSchema.collection.initializeUnorderedBulkOp();
        bulk
            .find({jobId: mongoose.Types.ObjectId(request.payload.jobId), isHired: false})
            .update({$set: {isArchived: true, isRejected: true, isHired: true}});
        try {
            await bulk.execute();
        } catch (e) {
            logger.error('Error occurred while updating chats data in mark as archived handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Remove job from wish list as well */
        try {
            await favouriteSchema.favouriteSchema.deleteMany({jobId: mongoose.Types.ObjectId(request.payload.jobId)});
        } catch (e) {
            logger.error('Error occurred while deleting favourite data in mark as archived handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter({}, 'Job data updated successfully', 'success', 204)).code(200);
}

handlers.resumeSearch = async (request, h) => {
    let checkUserKey, checkUser, subscriptionData, candidates, totalCount;

    /* Check whether user exists in database */
    try {
        checkUserKey = await atsSchema.atsSchema.findOne({secretKey: request.query.secretKey, apiKey: request.query.apiKey, accountKey: request.query.accountKey}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user data in resume search handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkUserKey) {
        try {
            checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(checkUserKey.userId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching user data in resume search handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!checkUser) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not authorized', 'error', 401)).code(401);
        }
    } else {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action', 'error', 401)).code(401);
    }

    /* Check if subscription is there */
    try {
        subscriptionData = await subscriptionSchema.subscriptionSchema.findById({_id: checkUser.subscriptionInfo.subscriptionId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching subscription data in resume search handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!subscriptionData) {
        return h.response(responseFormatter.responseFormatter({}, 'You do not have any active subscription.', 'error', 404)).code(404);
    } else if (subscriptionData.numberOfViews && !subscriptionData.numberOfViews.isUnlimited && subscriptionData.numberOfViews.count < 1) {
        return h.response(responseFormatter.responseFormatter({}, 'You have consumed all of your views.', 'error', 400)).code(400);
    } else {
        let searchCriteria = {
            'email': {$ne: ''},
            'employeeInformation.isComplete': true,
            'employeeInformation.preferredLocationCities.country': request.query.country,
            isActive: true,
            privacyType: 'standard'
        }, aggregationCriteria = [];

        if (request.query.isStudent) {
            searchCriteria['employeeInformation.isStudent'] = true;
        }

        /* Salary based filtering */
        if (request.query.salaryType) {
            searchCriteria['employeeInformation.expectedSalaryType'] = new RegExp(request.query.salaryType, 'gi');
            searchCriteria['employeeInformation.expectedSalary'] = {
                $gte: request.query.salaryMin,
                $lte: request.query.salaryMax
            };
        }

        if (request.query.latitude && request.query.longitude) {
            aggregationCriteria.push({
                $geoNear: {
                    near: {
                        type: 'MultiPoint',
                        coordinates: [Number(request.query.longitude), Number(request.query.latitude)]
                    },
                    key: 'employeeInformation.preferredLocations',
                    distanceField: 'distance',
                    maxDistance: 50 * 1609.34,
                    spherical: true,
                    query: searchCriteria
                }
            });
        } else {
            aggregationCriteria.push({
                $match: searchCriteria
            });
        }

        /* Filters for profile based on experience */
        if (typeof (request.query.experienceMin) === 'number' && typeof request.query.experienceMax === 'number') {
            aggregationCriteria.push({
                $match: {
                    'employeeInformation.experienceInMonths': {
                        $lte: request.query.experienceMax,
                        $gte: request.query.experienceMin
                    }
                }
            });
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

        /* With keywords provided */
        if (request.query.keywords) {
            let criteria;
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
                    criteria.$match.$and.push({
                        $or: [
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
                        ]
                    });
                }
            }
            aggregationCriteria.push(criteria);
        }

        /* If isOnline filter is given */
        if (request.query.isOnline) {
            aggregationCriteria.push({$match: {isOnline: true}});
        }

        let converted = [], facetCriteria = [];
        converted.push(new RegExp((pluralize(request.query.searchText)).replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi'));
        converted.push(new RegExp((pluralize.singular(request.query.searchText)).replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), 'gi'));
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
        facetCriteria.push({$skip: request.query.skip});
        facetCriteria.push({$limit: request.query.limit});

        /* Project fields */
        facetCriteria.push({
            $project: {
                systemGeneratedId: 1,
                email: 1,
                firstName: 1,
                lastName: 1,
                experienceInMonths: '$employeeInformation.experienceInMonths',
                profilePhoto: '$employeeInformation.profilePhoto',
                description: '$employeeInformation.description.text',
                city: '$employeeInformation.address.city',
                state: '$employeeInformation.address.state',
                expectedSalary: '$employeeInformation.expectedSalary',
                expectedSalaryType: '$employeeInformation.expectedSalaryType',
                country: '$employeeInformation.country',
                skills: '$employeeInformation.skills'
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
            candidates = await userSchema.UserSchema.aggregate(aggregationCriteria).allowDiskUse(true);
        } catch (e) {
            logger.error('Error occurred while getting all users in resume search handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (candidates[0] && candidates[0].count) {
            totalCount = candidates[0].count[0]? candidates[0].count[0].count : 0;
            candidates = candidates[0].candidates;
        }

        /* Success */
        return h.response(responseFormatter.responseFormatter(candidates, 'Fetched successfully.', 'success', 200, totalCount)).code(200);
    }
}

handlers.getDetailedResume = async (request, h) => {
    let checkUserKey, checkUser, subscriptionData, candidateData, userIdsToCheck = [];

    /* Check whether user exists in database */
    try {
        checkUserKey = await atsSchema.atsSchema.findOne({secretKey: request.query.secretKey, apiKey: request.query.apiKey, accountKey: request.query.accountKey}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching user data in get detailed resume handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (checkUserKey) {
        try {
            checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(checkUserKey.userId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching user data in get detailed resume handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (!checkUser) {
            return h.response(responseFormatter.responseFormatter({}, 'You are not authorized', 'error', 401)).code(401);
        }
    } else {
        return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action', 'error', 401)).code(401);
    }

    /* Check if subscription is there */
    try {
        subscriptionData = await subscriptionSchema.subscriptionSchema.findById({_id: checkUser.subscriptionInfo.subscriptionId}, {}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while fetching subscription data in get detailed resume handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }
    if (!subscriptionData) {
        return h.response(responseFormatter.responseFormatter({}, 'You do not have any active subscription.', 'error', 404)).code(404);
    } else {
        let isViewed;
        /* Check whether the requested candidate is already viewed by the employer */
        if (checkUser.isMaster) {
            checkUser.slaveUsers.push(checkUser._id);
            userIdsToCheck = checkUser.slaveUsers;
        } else {
            userIdsToCheck = [checkUser._id];
        }
        try {
            isViewed = await viewSchema.viewsSchema.findOne({employerId: {$in: userIdsToCheck}, candidateId: mongoose.Types.ObjectId(request.query.applicantId)}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching viewed data in get detailed resume handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!isViewed) {
            /* Check views count of the employer */
            if (subscriptionData.numberOfViews) {
                if (!subscriptionData.numberOfViews.isUnlimited) {
                    if (subscriptionData.numberOfViews.count < 1) {
                        return h.response(responseFormatter.responseFormatter({}, 'You have exhausted all the resume views.', 'error', 400)).code(400);
                    } else {
                        /* Reduce the view count by 1 and add it into the collection at the same time */
                        try {
                            await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkUser.subscriptionInfo.subscriptionId}, {$inc: {'numberOfViews.count': -1}}, {lean: true});
                        } catch (e) {
                            logger.error('Error occurred while updating subscription data in get detailed resume handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }
                        const viewToSave = {
                            employerId: checkUser._id,
                            candidateId: mongoose.Types.ObjectId(request.query.applicantId)
                        };
                        try {
                            await new viewSchema.viewsSchema(viewToSave).save();
                        } catch (e) {
                            logger.error('Error occurred while saving views data in get detailed resume handler %s:', JSON.stringify(e));
                            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                        }
                    }
                }
            } else {
                return h.response(responseFormatter.responseFormatter({}, 'You have exhausted all the resume views.', 'error', 400)).code(400);
            }
        }
        try {
            candidateData = await userSchema.UserSchema.aggregate([
                {
                    $match: {
                        _id: mongoose.Types.ObjectId(request.query.applicantId)
                    }
                },
                {
                    $project: {
                        _id: 1,
                        systemGeneratedId: 1,
                        email: 1,
                        firstName: 1,
                        lastName: 1,
                        experienceInMonths: '$employeeInformation.experienceInMonths',
                        profilePhoto: '$employeeInformation.profilePhoto',
                        description: '$employeeInformation.description.text',
                        city: '$employeeInformation.address.city',
                        state: '$employeeInformation.address.state',
                        experience: '$employeeInformation.pastJobTitlesModified',
                        futureJobTitles: '$employeeInformation.futureJobTitles',
                        isStudent: '$employeeInformation.isStudent',
                        resume: '$employeeInformation.resume',
                        selfIntroductionVideo: '$employeeInformation.description.video',
                        expectedSalary: '$employeeInformation.expectedSalary',
                        expectedSalaryType: '$employeeInformation.expectedSalaryType',
                        country: '$employeeInformation.country',
                        skills: '$employeeInformation.skills',
                        preferredLocationCities: '$employeeInformation.preferredLocationCities',
                        education: '$employeeInformation.education',
                        countryCode: '$employeeInformation.countryCode',
                        phone: '$employeeInformation.phone'
                    }
                }
            ]);
        } catch (e) {
            logger.error('Error occurred while aggregating candidate data in get detailed resume handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        /* Success */
        return h.response(responseFormatter.responseFormatter(candidateData, 'Fetched successfully.', 'success', 200)).code(200);
    }
};

handlers.createJobFree = async (request, h) => {
    let checkUser, checkUserKey, checkCompany, dataToSave, dataToUpdate, jobData, jobIds = [], result, latitude,
        longitude, language, checkPackage;

    /* Check whether user exists in database */
    if (request.payload.secretKey && request.payload.apiKey && request.payload.accountKey) {
        try {
            checkUserKey = await atsSchema.atsSchema.findOne({
                secretKey: request.payload.secretKey,
                apiKey: request.payload.apiKey,
                accountKey: request.payload.accountKey
            }, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching user data in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (checkUserKey && checkUserKey.isActive) {
            try {
                checkUser = await userSchema.UserSchema.findById({_id: mongoose.Types.ObjectId(checkUserKey.userId)}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while fetching user data in create job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            if (!checkUser) {
                return h.response(responseFormatter.responseFormatter({}, 'You are not authorized', 'error', 401)).code(401);
            }
        } else {
            return h.response(responseFormatter.responseFormatter({}, 'You are not allowed to perform this action', 'error', 401)).code(401);
        }
    }

    /* Get english language */
    try {
        language = await languageSchema.languageSchema.findOne({
            language: 'en',
            country: request.payload.jobData[0].country
        }, {_id: 1}, {lean: true});
    } catch (e) {
        logger.error('Error occurred while finding english language in create job ats handler %s:', JSON.stringify(e));
        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
    }

    if (!checkUser) {
        /* Check if the company already exists */
        try {
            checkCompany = await userSchema.UserSchema.findOne({companyId: request.payload.companyId}, {}, {lean: true});
        } catch (e) {
            logger.error('Error occurred while fetching company data in create job handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (!checkCompany) {
            /* Check for free package */
            try {
                checkPackage = await packageSchema.packageSchema.findOne({
                    isFree: true,
                    country: request.payload.companyCountry,
                    isActive: true
                }, {_id: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in finding package in create job ats handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (!checkPackage) {
                return h.response(responseFormatter.responseFormatter({}, 'Job posting is currently not available in the given country.', 'error', 400)).code(400);
            }

            /* Create the user in EZJobs database */
            const userData = {
                firstName: request.payload.platform,
                lastName: '',
                email: commonFunctions.Handlers.generatePassword() + '@ezjobs.io',
                password: commonFunctions.Handlers.generatePassword(),
                employerInformation: {
                    companyName: request.payload.companyName,
                    companyAddress: {
                        address1: '',
                        address2: '',
                        city: request.payload.companyCity,
                        state: request.payload.companyState,
                        zipCode: '',
                        subLocality: ''
                    },
                    companyLocation: {
                        type: 'Point',
                        coordinates: []
                    },
                    companyType: mongoose.Types.ObjectId('5eb9a78e3cca7a028fbc2160'),
                    companyDescription: '',
                    country: request.payload.companyCountry,
                    countryCode: request.payload.companyCountry.toLowerCase() === 'us' ? '+1' : '+91'
                },
                employeeInformation: {
                    address: {
                        address1: '',
                        address2: '',
                        city: request.payload.companyCity,
                        state: request.payload.companyState,
                        zipCode: '',
                        subLocality: ''
                    },
                    country: request.payload.companyCountry,
                    location: {
                        type: 'Point',
                        coordinates: []
                    },
                    preferredLocations: {
                        type: 'MultiPoint',
                        coordinates: []
                    },
                    preferredLocationCities: []
                },
                roles: ['Employer'],
                companyId: request.payload.companyId,
                referralCode: commonFunctions.Handlers.generateReferralCode(request.payload.companyName),
                country: request.payload.companyCountry,
                subscriptionInfo: {},
                isRoleSet: true,
                appLanguage: '',
                chatLanguage: ''
            };

            /* Get the coordinates from lat long */
            try {
                result = await commonFunctions.Handlers.geocode(request.payload.companyCity + ', ' + request.payload.companyState + ', ' + request.payload.companyCountry);
            } catch (e) {
                logger.error('Error occurred while geo coding user address in create job ats handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (result && result.length) {
                latitude = result[0].latitude;
                longitude = result[0].longitude;

                userData.employeeInformation.location.coordinates = [longitude, latitude];
                userData.employerInformation.companyLocation.coordinates = [longitude, latitude];
                userData.employeeInformation.preferredLocations.coordinates = [[longitude, latitude]];
                userData.employeeInformation.preferredLocationCities = [{
                    city: request.payload.companyCity, state: request.payload.companyState,
                    country: request.payload.companyCountry, latitude: latitude, longitude: longitude
                }];
            }

            try {
                language = await languageSchema.languageSchema.findOne({
                    country: request.payload.companyCountry,
                    language: 'en'
                }, {_id: 1, name: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred in finding language data in create job ats handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }
            if (language) {
                userData.appLanguage = language._id;
                userData.chatLanguage = language._id;
            }

            const tempData = await new userSchema.UserSchema(userData).save();
            checkUser = tempData.toObject();

            if (checkPackage) {
                /* Create free subscription & Check whether plan exists */
                let checkPlan, subscriptionData;
                try {
                    checkPlan = await packageSchema.packageSchema.findOne({
                        isFree: 1,
                        country: request.payload.companyCountry,
                        isActive: true
                    }, {}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred finding packageF information in create job ats handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
                if (checkPlan) {
                    /* Save subscription in database */
                    delete checkPlan._id;
                    let subscriptionToSave = new subscriptionSchema.subscriptionSchema(checkPlan);
                    delete subscriptionToSave.createdAt;
                    delete subscriptionToSave.updatedAt;
                    subscriptionToSave.isActive = false;
                    subscriptionToSave.userId = checkUser._id;
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
                        checkUser = await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, {$set: dataToUpdate}, {
                            lean: true,
                            new: true
                        });
                    } catch (e) {
                        logger.error('Error occurred updating user information in create job ats handler %s:', JSON.stringify(e));
                        return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                    }
                }
            }
        } else {
            checkUser = checkCompany;
        }
    }

    /* Check for the subscription package */
    for (let i = 0; i < request.payload.jobData.length; i++) {
        let subscriptionData, packageInfo;
        if (checkUser.subscriptionInfo && checkUser.subscriptionInfo.subscriptionId) {
            try {
                subscriptionData = await subscriptionSchema.subscriptionSchema.findById({_id: checkUser.subscriptionInfo.subscriptionId}, {}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding subscription data in create job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            try {
                packageInfo = await packageSchema.packageSchema.findById({_id: checkUser.subscriptionInfo.packageId}, {country: 1}, {lean: true});
            } catch (e) {
                logger.error('Error occurred while finding package data in create job handler %s:', JSON.stringify(e));
                return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
            }

            /*if (packageInfo.country.toLowerCase() !== request.payload.jobData[i].country.toLowerCase()) {
                return h.response(responseFormatter.responseFormatter({}, 'Your subscription is not valid.', 'error', 400)).code(400);
            }*/

            if (!subscriptionData) {
                return h.response(responseFormatter.responseFormatter({}, 'Something went wrong. Please contact support.', 'error', 400)).code(400);
            } else if (!subscriptionData.isPaid) {
                return h.response(responseFormatter.responseFormatter({}, 'Please purchase any subscription.', 'error', 400)).code(400);
            } else if (!subscriptionData.numberOfJobs.count && !subscriptionData.numberOfJobs.isUnlimited) {
                return h.response(responseFormatter.responseFormatter({}, 'You do not have sufficient job posting left in your current package.', 'error', 400)).code(400);
            } else if (subscriptionData)
                try {
                    await subscriptionSchema.subscriptionSchema.findByIdAndUpdate({_id: checkUser.subscriptionInfo.subscriptionId}, {$inc: {'numberOfJobs.count': -1}}, {lean: true});
                } catch (e) {
                    logger.error('Error occurred while updating subscription data in create job handler %s:', JSON.stringify(e));
                    return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
                }
        }

        /* Create job payload and save it into database */
        dataToSave = new jobSchema.jobSchema(request.payload.jobData[i]);
        dataToSave.totalViews = 0;
        dataToSave.userId = checkUser.userId;
        dataToSave.platform = request.payload.platform;
        dataToSave.isATS = true;
        dataToSave.atsEmail = checkUser.email;
        dataToSave.isTranslated = false;
        dataToSave.translatedJobs = [];
        dataToSave.uniqueViews = [];
        dataToSave.translatedLanguage = language._id;
        for (let j = 0; j < request.payload.jobData[i].skills.length; j++) {
            dataToSave.skillsLower.push(request.payload.jobData[i].skills[j].toLowerCase());
        }

        /* Get the coordinates from lat long */
        let jobLocation;
        try {
            jobLocation = await commonFunctions.Handlers.geocode(request.payload.jobData[i].address.city + ', '
                + request.payload.jobData[i].address.state + ', ' + request.payload.jobData[i].address.country);
        } catch (e) {
            logger.error('Error occurred while geo coding job address in create job ats handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
        if (jobLocation && jobLocation.length) {
            latitude = jobLocation[0].latitude;
            longitude = jobLocation[0].longitude;
            dataToSave.location.coordinates = [longitude, latitude];
            dataToSave.displayLocation.coordinates = [[longitude, latitude]];
        }

        dataToSave.isPremium = false;
        dataToSave.ageRequired = request.payload.jobData[i].ageRequired ? request.payload.jobData[i].ageRequired : 18;
        dataToSave.numberOfPositions = request.payload.jobData[i].numberOfPositions ? request.payload.jobData[i].numberOfPositions : 1;

        try {
            jobData = await dataToSave.save();
        } catch (e) {
            logger.error('Error occurred while saving job data in create job ats handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }

        if (jobData) {
            jobIds.push({jobId: jobData._id});
        }

        /* Increase posting count by one for the user */
        dataToUpdate = {
            $inc: {'employerInformation.numberOfJobsPosted': 1}
        };

        try {
            await userSchema.UserSchema.findByIdAndUpdate({_id: checkUser._id}, dataToUpdate, {lean: true});
        } catch (e) {
            logger.error('Error occurred while incrementing job posting count in create job ats handler %s:', JSON.stringify(e));
            return h.response(responseFormatter.responseFormatter({}, 'An error occurred', 'error', 500)).code(500);
        }
    }

    /* Success */
    return h.response(responseFormatter.responseFormatter(jobIds, 'Job posted successfully', 'success', 201)).code(201);
};

module.exports = {
    Handlers: handlers
};
